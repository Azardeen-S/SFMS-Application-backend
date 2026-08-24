const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const { handleLineStoppageCreateFTP, handleLineStoppageCloseFTP } = require('../utils/ftpService');

// GET all line stoppage transactions (filtered by user's plant for performance)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const plantCode = req.user?.plantCode || null;
    const { rows } = await db.query('SELECT * FROM sp_get_line_stoppages($1)', [plantCode]);

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
        return { ...r, functional_location: fl };
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

  const actualStartTime = entry_date || starttime || new Date();

  if (!plant_code || !shop_code || !module_code || !line_code || !machine_code || !actualStartTime) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  try {
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
                      AND "Type_Code"::text = $4 AND "Machine_Code"::text = $5 AND "Close_Date" IS NULL AND "Del_Status" = 'N'`;
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

    // 5. Calculate Start Serial Number (Start_slno) for entry date (matching .NET line 125)
    const slRes = await db.query(
      `SELECT COALESCE(MAX("Start_slno"), 0) + 1 AS next_slno FROM "Trn_LineStoppage" 
       WHERE "Machine_Code" = $1 AND CAST("Entry_Date" AS DATE) = CAST($2 AS DATE)`,
      [String(machine_code), actualStartTime]
    );
    const startSlNo = parseInt(slRes.rows[0]?.next_slno || '1', 10);

    // 6. Fetch SAP Machine Code
    let sapMchnCode = '';
    const mchnRes = await db.query(
      'SELECT "SAPMchn_Code" FROM "Mst_Machine" WHERE "Plant_code" = $1 AND "Shop_code" = $2 AND "Module_Code" = $3 AND "Line_code" = $4 AND "Mchn_code" = $5 LIMIT 1',
      [String(plant_code), String(shop_code), String(module_code), String(line_code), String(machine_code)]
    );
    if (mchnRes.rows.length > 0) {
      sapMchnCode = mchnRes.rows[0].SAPMchn_Code || '';
    }

    // 7. Insert record into Trn_LineStoppage
    const insertRes = await db.query(
      `INSERT INTO "Trn_LineStoppage" (
        "Plant_Code", "Shop_Code", "Module_Code", "Line_Code", "Machine_Code",
        "Type_Code", "LineReason_Code", "Reason", "Entry_Date", "Status",
        "Del_Status", "Created_By", "CreatedDt", "servicetype",
        "Start_slno", "Shift_code", "SAPMchn_Code", "Function_Location",
        "Created_Empcode", "Created_Empname", "OEEReason_Code"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'N', $11, NOW(), $12, $13, $14, $15, $16, $17, $18, '0')
      RETURNING "Id"`,
      [
        String(plant_code), String(shop_code), String(module_code), String(line_code), String(machine_code),
        String(type_code), String(linereason_code), reason || '', actualStartTime, status || 'O',
        user_id || 1, finalServiceType, startSlNo, shiftCode, sapMchnCode, functional_location || '',
        emp_no || '', emp_name || ''
      ]
    );

    const createdId = insertRes.rows[0].Id;

    // 8. Trigger FTP file creation & upload asynchronously (matching .NET lines 154-177)
    handleLineStoppageCreateFTP(createdId, req.body).catch(err => {
      console.error('Asynchronous FTP Create error:', err);
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
  const {
    status, close_date, endtime, closure, spares, user_id, breakdowntype,
    closed_by_emp_no, closed_by_emp_name, shortclose
  } = req.body;

  const actualEndTime = close_date || endtime || new Date();

  try {
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

    // 3. Update record in Trn_LineStoppage (matching .NET lines 412-418)
    await db.query(
      `UPDATE "Trn_LineStoppage"
       SET "Status" = $1,
           "Close_Date" = $2,
           "Closure" = $3,
           "Spares" = $4,
           "ModifiedBy" = $5,
           "ModifiedDt" = NOW(),
           "Breakdowntype" = $6,
           "Stop_SlNo" = $7,
           "Closure_Empcode" = $8,
           "Closure_Empname" = $9,
           "ShortClose_Status" = $10
       WHERE "Id" = $11 AND "Del_Status" = 'N'`,
      [
        status || 'C', actualEndTime, closure || '', spares || '', user_id || 1, breakdowntype || null,
        stopSlNo, closed_by_emp_no || '', closed_by_emp_name || '', shortCloseVal, id
      ]
    );

    // 4. Trigger FTP file creation & upload for closure asynchronously (matching .NET lines 428-444)
    handleLineStoppageCloseFTP(id, req.body).catch(err => {
      console.error('Asynchronous FTP Close error:', err);
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
