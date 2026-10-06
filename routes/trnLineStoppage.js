const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const { handleLineStoppageCreateFTP, handleLineStoppageCloseFTP } = require('../utils/ftpService');

// GET all line stoppage transactions (filtered by user's plant for performance)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const plantCode = req.user?.plantCode || null;

    // Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD (both inclusive). Without it: every open ticket plus the
    // tickets closed today / yesterday (T and T-1). With it: open tickets started, and closed tickets
    // closed, inside the range. See sp_get_line_stoppages in sql/01_migration.sql.
    const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const from = isDay(req.query.from) ? req.query.from : null;
    const to = isDay(req.query.to) ? req.query.to : null;

    let rows;
    try {
      ({ rows } = await db.query(
        'SELECT * FROM sp_get_line_stoppages($1, $2::timestamp, $3::timestamp)', [plantCode, from, to]
      ));
    } catch (fnErr) {
      // 42883 = the 3-argument function isn't installed yet (01_migration.sql not run): use the old one.
      if (fnErr.code !== '42883') throw fnErr;
      ({ rows } = await db.query('SELECT * FROM sp_get_line_stoppages($1)', [plantCode]));
    }

    try {
      const flRes = await db.query('SELECT "Line_Code", "Plant_Code", "Functional_Location" FROM "mst_Functional_Location"');
      const flMap = new Map();
      flRes.rows.forEach(r => {
        const flVal = (r.Functional_Location || '').trim();
        if (flVal) {
          flMap.set(`${String(r.Plant_Code || '').trim()}_${String(r.Line_Code || '').trim()}`, flVal);
          flMap.set(String(r.Line_Code || '').trim(), flVal);
        }
      });

      const enrichedRows = rows.map(r => {
        const key = `${String(r.plant_code || '').trim()}_${String(r.line_code || '').trim()}`;
        const fl = r.functional_location || r.Functional_Location || flMap.get(key) || flMap.get(String(r.line_code || '').trim()) || '-';

        // SAP Remark: only meaningful for MACHINE-type, non-Service tickets — the same
        // condition trnLineStoppage.jsx uses to gate the Close button on Notification_No.
        // "Waiting SAP Notification" until SAP's OUT ack (via notificationSyncService.js)
        // fills in Notification_No, then it flips to "Notification Recived" automatically.
        const typeDesc = String(r.type_desc || r.Type_Desc || r.problem_type || '').trim().toLowerCase();
        const isService = r.servicetype === 'Service';
        const notificationNo = r.notification_no || r.Notification_No || '';
        const sapRemark = (!isService && typeDesc === 'machine')
          ? (notificationNo ? 'Notification Recived' : 'Waiting SAP Notification')
          : '';

        return { ...r, functional_location: fl, sap_remark: sapRemark };
      });
      return res.status(200).json(enrichedRows);
    } catch (enrichErr) {
      console.warn('Could not enrich line stoppages with functional location:', enrichErr.message);
      return res.status(200).json(rows);
    }
  } catch (error) {
    console.error('Error fetching line stoppages:', error);
    res.status(500).json({ message: 'Error retrieving line stoppage transactions.' });
  }
});

// POST create line stoppage
router.post('/', authMiddleware, async (req, res) => {
  const {
    plant_code, shop_code, module_code, line_code, machine_code,
    type_code, linereason_code, reason, entry_date, starttime, status, user_id,
    servicetype, emp_no, emp_name, functional_location
  } = req.body;

  if (!plant_code || !shop_code || !module_code || !line_code || !machine_code) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  try {
    // .NET stamps Entry_Date with the SERVER's own clock (DateTime.Now) and ignores the browser's time.
    // The browser sends a UTC string, which used to be saved as-is - 5.5 hours behind the database's
    // local clock (and behind every legacy ticket), so ticket ages, the SMS escalation timers and the
    // reports were all off. Take the time from the database clock, like Close_Date, so they agree.
    const clockRes = await db.query('SELECT LOCALTIMESTAMP(3) AS now_local');
    const actualStartTime = clockRes.rows[0].now_local;

    // 1. Fetch Problem Type Description
    const typeRes = await db.query(
      'SELECT "Type_Desc" FROM "Mst_Type" WHERE "Id"::text = $1 AND "Plant_Code"::text = $2 LIMIT 1',
      [String(type_code), String(plant_code)]
    );
    const typeDesc = (typeRes.rows[0]?.Type_Desc || '').trim().toUpperCase();

    // 2. Determine Service Type override (matching .NET line 119)
    let finalServiceType = servicetype || 'Breakdown';
    if (typeDesc === 'MAN' || typeDesc === 'MATERIAL' || typeDesc === 'QUALITY') {
      finalServiceType = 'Breakdown';
    }

    // 3. Duplicate Stoppage Check (Machine already stopped check, matching .NET lines 85-98)
    let checkQry = `SELECT COUNT("Id") AS count FROM "Trn_LineStoppage"
                    WHERE "Shop_Code"::text = $1 AND "Module_Code"::text = $2 AND "Line_Code"::text = $3
                      AND "Type_Code"::text = $4 AND "Machine_Code"::text = $5 AND "Close_Date" IS NULL AND COALESCE("Del_Status", 'N') = 'N'`;
    const queryParams = [String(shop_code), String(module_code), String(line_code), String(type_code), String(machine_code)];

    if (typeDesc === 'MACHINE' && finalServiceType === 'Service') {
      checkQry += ` AND "servicetype" = 'Service'`;
    } else {
      checkQry += ` AND ("servicetype" <> 'Service' OR "servicetype" IS NULL)`;
    }

    const checkRes = await db.query(checkQry, queryParams);
    if (parseInt(checkRes.rows[0]?.count || '0', 10) > 0) {
      return res.status(400).json({ message: 'Selected Machine is stopped already' });
    }

    // 4. Determine Shift Code (matching .NET lines 107-118)
    const entryMoment = new Date(actualStartTime);
    const timeStr = `${String(entryMoment.getHours()).padStart(2, '0')}:${String(entryMoment.getMinutes()).padStart(2, '0')}`;
    let shiftCode = '1';
    if (timeStr > '06:14' && timeStr <= '14:44') {
      shiftCode = '1';
    } else if (timeStr > '14:44' && timeStr <= '22:45') {
      shiftCode = '2';
    } else {
      shiftCode = '3';
    }

    // 5 & 6. Start Serial Number and SAP Machine Code don't depend on each other - run them
    //    concurrently instead of as two sequential round trips to the DB.
    const [slRes, mchnRes] = await Promise.all([
      db.query(
        `SELECT COALESCE(MAX("Start_slno"), 0) + 1 AS next_slno FROM "Trn_LineStoppage"
         WHERE "Machine_Code" = $1 AND CAST("Entry_Date" AS DATE) = CAST($2 AS DATE)`,
        [String(machine_code), actualStartTime]
      ),
      db.query(
        'SELECT "SAPMchn_Code" FROM "Mst_Machine" WHERE "Plant_code" = $1 AND "Shop_code" = $2 AND "Module_Code" = $3 AND "Line_code" = $4 AND "Mchn_code" = $5 LIMIT 1',
        [String(plant_code), String(shop_code), String(module_code), String(line_code), String(machine_code)]
      ),
    ]);
    const startSlNo = parseInt(slRes.rows[0]?.next_slno || '1', 10);
    const sapMchnCode = mchnRes.rows.length > 0 ? (mchnRes.rows[0].SAPMchn_Code || '') : '';

    // 7. Notification_No is intentionally left NULL at creation, matching .NET:
    //    the .NET Create action never assigns Notification_No — it stays blank until SAP's
    //    acknowledgement is written back to the record by a separate process. The Create grid
    //    even disables the Close/STOP button for MACHINE-type tickets while this is blank
    //    (see Create.cshtml). Do NOT generate a local number here.

    // 8. Insert record into Trn_LineStoppage, stored exactly as the .NET app stores a new ticket
    //    (verified against the legacy SFMS database's own rows):
    //      - Status / Start_status stay NULL: "Status" is the SMS escalation level (Level1..Level4),
    //        set later by smsNotificationService.js, never an open/closed flag. Open = Close_Date IS NULL.
    //      - "Reason" holds the LineReason_Code (.NET: cls.Reason = cls.LineReason_Code); the typed
    //        remarks go in "Details". The close step later overwrites "Reason" with the resolution text.
    //      - CreatedDt = Entry_Date, Created_By = 0, ShortClose_Status = 0, Loto/Stop_SlNo NULL.
    //    "Del_Status" = 'N' is kept (this app's own soft-delete flag; legacy rows were loaded as 'N').
    const insertRes = await db.query(
      `INSERT INTO "Trn_LineStoppage" (
        "Plant_Code", "Shop_Code", "Module_Code", "Line_Code", "Machine_Code",
        "Type_Code", "LineReason_Code", "Reason", "Details", "Entry_Date",
        "Del_Status", "Created_By", "CreatedDt", "servicetype",
        "Start_slno", "Shift_code", "SAPMchn_Code", "Function_Location",
        "Created_Empcode", "Created_Empname", "OEEReason_Code", "ShortClose_Status"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::text, $7::text, $8, $9::timestamp, 'N', 0, $9::timestamp, $10, $11, $12, $13, $14, $15, $16, '0', 0)
      RETURNING "Id"`,
      [
        String(plant_code), String(shop_code), String(module_code), String(line_code), String(machine_code),
        String(type_code), String(linereason_code), reason || '', actualStartTime,
        finalServiceType, startSlNo, shiftCode, sapMchnCode, functional_location || '',
        emp_no || '', emp_name || ''
      ]
    );

    const createdId = insertRes.rows[0].Id;

    // 9. Trigger FTP file creation & upload. The DB row is already committed at this point,
    //    so the ticket is real regardless of what SAP/FTP does next - the FTP hop itself is a
    //    real network round trip (can run 500ms-plus) and has no bearing on whether the ticket
    //    was created. Fire it in the background instead of blocking the response on it, so the
    //    user gets an immediate confirmation; any FTP failure is still logged server-side.
    handleLineStoppageCreateFTP(createdId, req.body).catch((err) => {
      console.error(`[FTP Error] Background FTP upload failed for stoppage ${createdId}:`, err);
    });

    res.status(201).json({ message: 'Line stoppage transaction logged successfully.', id: createdId });
  } catch (error) {
    console.error('Error logging line stoppage:', error);
    res.status(500).json({ message: 'Database error logging line stoppage.' });
  }
});

// PUT update / close line stoppage
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  // closure       = the typed resolution remarks (.NET overwrites "Reason" with it on close)
  // closure_type  = Mst_Closure.Closure_ID,  analysis = Mst_BreakDown.BD_ID (saved as "Breakdowntype"),
  // phenomena     = Phenomena.Id,            vendor   = VENDOR.Vendor code,  loto = 1/2/3 (or its label)
  const {
    closure, closure_type, analysis, phenomena, spares, loto, vendor, material,
    user_id, breakdowntype, closed_by_emp_no, closed_by_emp_name, shortclose
  } = req.body;

  const clean = (v) => {
    const s = v === undefined || v === null ? '' : String(v).trim();
    return s === '' ? null : s;
  };
  const LOTO_CODES = { 'lock out': 1, 'tag out': 2, 'lock out/tag out': 3 };
  const lotoCode = (v) => {
    const s = clean(v);
    if (s === null) return null;
    if (/^[123]$/.test(s)) return Number(s);
    return LOTO_CODES[s.toLowerCase()] ?? null;
  };

  try {
    // .NET always stamps Close_Date = DateTime.Now on the server — it ignores any client-supplied
    // close date/time entirely. Match that exactly: do not accept close_date/endtime from the request.
    // Taken from the database clock so it agrees with Entry_Date and NOW() (see the create route).
    const clockRes = await db.query('SELECT LOCALTIMESTAMP(3) AS now_local');
    const actualEndTime = clockRes.rows[0].now_local;

    // 1. Fetch current stoppage record to get Machine_Code & Entry_Date
    const curRes = await db.query('SELECT * FROM "Trn_LineStoppage" WHERE "Id" = $1', [id]);
    if (!curRes.rows || curRes.rows.length === 0) {
      return res.status(404).json({ message: 'Line stoppage record not found.' });
    }
    const row = curRes.rows[0];

    // 2. Calculate Stop Serial Number (Stop_SlNo) (matching .NET line 408)
    const stopRes = await db.query(
      `SELECT COALESCE(MAX("Stop_SlNo"), 0) + 1 AS stopslno FROM "Trn_LineStoppage"
       WHERE "Machine_Code" = $1 AND CAST("Entry_Date" AS DATE) = CAST($2 AS DATE)`,
      [row.Machine_Code, actualEndTime]
    );
    const stopSlNo = parseInt(stopRes.rows[0]?.stopslno || '1', 10);
    const shortCloseVal = (shortclose === true || shortclose === 'Y' || shortclose === 'true' || shortclose === 1) ? 1 : 0;

    // Material-type tickets close with Vendor + Material (no Loto / Spares / Closure type / Analysis);
    // every other type closes with those and no Vendor / Material - as the .NET close form does.
    const typeRes = await db.query(
      'SELECT "Type_Desc" FROM "Mst_Type" WHERE "Id"::text = $1 AND "Plant_Code"::text = $2 LIMIT 1',
      [String(row.Type_Code), String(row.Plant_Code)]
    );
    const isMaterial = String(typeRes.rows[0]?.Type_Desc || '').toLowerCase().includes('material');

    // 3. Update record in Trn_LineStoppage, stored as the .NET close stores it (verified against the
    //    legacy SFMS database's own closed tickets):
    //      - "Status" is NOT touched: it keeps the SMS escalation level (Level1..Level4) the ticket reached.
    //        Closed = Close_Date IS NOT NULL.
    //      - "Reason" is overwritten with the typed resolution remarks; the creation remarks stay in "Details".
    //      - Closure / Phenomena / Breakdowntype / Vendor / Loto hold lookup CODES, not labels.
    //      - "M_Status" = 'C'.
    await db.query(
      `UPDATE "Trn_LineStoppage"
       SET "Close_Date" = $1,
           "Reason" = COALESCE($2, "Reason"),
           "Closure" = $3,
           "Spares" = $4,
           "Phenomena" = $5,
           "Breakdowntype" = $6,
           "Loto" = $7,
           "Vendor" = $8,
           "Material" = $9,
           "Stop_SlNo" = $10,
           "Closure_Empcode" = $11,
           "Closure_Empname" = $12,
           "ShortClose_Status" = $13,
           "M_Status" = 'C',
           "ModifiedBy" = $14,
           "ModifiedDt" = NOW()
       WHERE "Id" = $15 AND COALESCE("Del_Status", 'N') = 'N'`,
      [
        actualEndTime, clean(closure),
        isMaterial ? null : clean(closure_type), isMaterial ? null : clean(spares),
        clean(phenomena), isMaterial ? null : clean(analysis || breakdowntype),
        isMaterial ? null : lotoCode(loto),
        isMaterial ? clean(vendor) : null, isMaterial ? clean(material) : null,
        stopSlNo, closed_by_emp_no || '', closed_by_emp_name || '', shortCloseVal,
        user_id || 1, id
      ]
    );

    // 4. Trigger FTP file creation & upload for closure — same reasoning as Create: the DB
    //    update is already committed, so fire the FTP hop in the background instead of making
    //    the user wait on a real network round trip for it.
    handleLineStoppageCloseFTP(id, req.body).catch((err) => {
      console.error(`[FTP Error] Background FTP upload failed for stoppage close ${id}:`, err);
    });

    res.status(200).json({ message: 'Line stoppage closed successfully.' });
  } catch (error) {
    console.error('Error closing line stoppage:', error);
    res.status(500).json({ message: 'Database error closing line stoppage.' });
  }
});

// DELETE soft delete transaction
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('SELECT sp_delete_line_stoppage($1)', [id]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Record not found.' });
    res.status(200).json({ message: 'Stoppage log deleted successfully.' });
  } catch (error) {
    console.error('Error deleting stoppage log:', error);
    res.status(500).json({ message: 'Database error deleting stoppage log.' });
  }
});

module.exports = router;
