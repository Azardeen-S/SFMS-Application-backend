const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');

// GET datewise report data
router.get('/datewise', authMiddleware, async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ message: 'Start date and end date are required.' });
  }

  try {
    let rows;
    try {
      const spResult = await db.query('SELECT * FROM sp_rpt_datewise($1::timestamp, $2::timestamp)', [startDate, endDate]);
      rows = spResult.rows;
    } catch (spErr) {
      console.warn('SP datewise failed, executing fallback query:', spErr.message);
      const rawSql = `
        SELECT 
          t."Id" AS "Id",
          p.plant_name,
          s."Shop_Name" AS shop_name,
          m."Module_Name" AS module_name,
          l."Line_Name" AS line_name,
          mc."Mchn_Name" AS mchn_name,
          tp."Type_Desc" AS type_desc,
          g."Gap_Name" AS gap_name,
          t."Status" AS "Status",
          t."Entry_Date" AS "Start_Time",
          t."Close_Date" AS "End_Time",
          t."Closure"::text AS "Closure",
          ROUND((EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date"))/3600)::numeric, 2) AS hours,
          FLOOR(MOD((EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date"))/60)::numeric, 60)) AS mins
        FROM "Trn_LineStoppage" t
        LEFT JOIN "plant" p ON t."Plant_Code" = p.plant_code
        LEFT JOIN "Mst_Shop" s ON t."Shop_Code" = s."Shop_code"
        LEFT JOIN "Mst_Module" m ON t."Module_Code" = m."Module_Code"
        LEFT JOIN "Mst_Line" l ON t."Line_Code" = l."Line_code"
        LEFT JOIN "Mst_Machine" mc ON t."Machine_Code" = mc."Mchn_code"
        LEFT JOIN "Mst_Type" tp ON t."Type_Code"::text = tp."Id"::text AND t."Plant_Code"::text = tp."Plant_Code"::text
        LEFT JOIN "Mst_Gap" g ON t."LineReason_Code"::text = g."Id"::text AND t."Plant_Code"::text = g."Plant_Code"::text
        WHERE t."Del_Status" = 'N'
          AND t."Entry_Date" >= $1::timestamp
          AND t."Entry_Date" <= $2::timestamp
        ORDER BY t."Entry_Date" DESC
        LIMIT 5000
      `;
      const fallbackResult = await db.query(rawSql, [startDate, endDate]);
      rows = fallbackResult.rows;
    }

    res.status(200).json(rows.map((r, idx) => ({
      id: r.Id || r.id || idx + 1,
      plant_name: r.plant_name || '-',
      shop_name: r.shop_name || '-',
      module_name: r.module_name || '-',
      line_name: r.line_name || '-',
      mchn_name: r.mchn_name || '-',
      type_desc: r.type_desc || '-',
      gap_name: r.gap_name || '-',
      status: r.Status || r.status || 'O',
      entry_date: r.Start_Time || r.entry_date || null,
      close_date: r.End_Time || r.close_date || null,
      closure: r.Closure || r.closure || '-',
      hours: r.hours || 0,
      mins: r.mins || 0
    })));
  } catch (error) {
    console.error('Error fetching datewise report:', error);
    res.status(500).json({ message: 'Error retrieving datewise report data.' });
  }
});

// GET machine-wise stoppage report summary
router.get('/machinewise', authMiddleware, async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ message: 'Start date and end date are required.' });
  }

  try {
    const { rows } = await db.query('SELECT * FROM sp_rpt_machinewise($1::timestamp, $2::timestamp)', [startDate, endDate]);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching machine-wise report:', error);
    res.status(500).json({ message: 'Error retrieving machine-wise report data.' });
  }
});

// GET gap-wise stoppage report summary
router.get('/gapwise', authMiddleware, async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ message: 'Start date and end date are required.' });
  }

  try {
    const { rows } = await db.query('SELECT * FROM sp_rpt_gapwise($1::timestamp, $2::timestamp)', [startDate, endDate]);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching gap-wise report:', error);
    res.status(500).json({ message: 'Error retrieving gap-wise report data.' });
  }
});

// GET shift-wise stoppage report summary
router.get('/shiftwise', authMiddleware, async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ message: 'Start date and end date are required.' });
  }

  try {
    const { rows } = await db.query('SELECT * FROM sp_rpt_shiftwise($1::timestamp, $2::timestamp)', [startDate, endDate]);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching shift-wise report:', error);
    res.status(500).json({ message: 'Error retrieving shift-wise report data.' });
  }
});

// GET Employee Level SMS Settings
router.get('/sms-time-mapping', authMiddleware, async (req, res) => {
  const { plantcode } = req.query;
  try {
    const sql = `
      SELECT 
        e."Id",
        t."Type_Desc" AS "Type",
        e."Level1",
        e."Level2",
        e."Level3",
        e."Level4",
        e."Plant_Code",
        e."Type_Code"
      FROM "Mst_Employee_SMS" e
      LEFT JOIN "Mst_Type" t ON e."Type_Code"::text = t."Id"::text AND e."Plant_Code"::text = t."Plant_Code"::text
      WHERE ($1::text IS NULL OR $1::text = '' OR e."Plant_Code"::text = $1::text)
      ORDER BY e."Id" ASC
    `;
    const { rows } = await db.query(sql, [plantcode || null]);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching SMS time mapping:', error);
    res.status(500).json({ message: 'Error retrieving SMS level time mapping data.' });
  }
});

// POST Save Employee Level SMS Settings
router.post('/sms-time-mapping/save', authMiddleware, async (req, res) => {
  const { masterdata, listvals } = req.body;
  const plantCode = masterdata?.plant_code;

  try {
    if (plantCode) {
      await db.query('DELETE FROM "Mst_Employee_SMS" WHERE "Plant_Code" = $1', [plantCode]);
    }

    if (Array.isArray(listvals)) {
      for (const item of listvals) {
        if (item.Type_Code || item.Type) {
          let typeCode = item.Type_Code;
          if (!typeCode && item.Type) {
            const typeRes = await db.query(
              'SELECT "Id" FROM "Mst_Type" WHERE "Type_Desc" = $1 AND "Plant_Code" = $2 LIMIT 1',
              [item.Type, plantCode]
            );
            if (typeRes.rows.length > 0) typeCode = typeRes.rows[0].Id;
          }

          await db.query(`
            INSERT INTO "Mst_Employee_SMS"
              ("Id", "Plant_Code", "Type_Code", "Level1", "Level2", "Level3", "Level4", "CreatedDt", "Created_By")
            VALUES
              ((SELECT COALESCE(MAX("Id"), 0) + 1 FROM "Mst_Employee_SMS"), $1, $2, $3, $4, $5, $6, NOW(), '0')
          `, [
            plantCode || item.Plant_Code,
            typeCode || '0',
            String(item.Level1 ?? '0'),
            String(item.Level2 ?? '0'),
            String(item.Level3 ?? '0'),
            String(item.Level4 ?? '0')
          ]);
        }
      }
    }
    res.status(200).json({ message: 'Data Saved Successfully' });
  } catch (error) {
    console.error('Error saving SMS time mapping:', error);
    res.status(500).json({ message: 'Error saving SMS level time mapping.' });
  }
});

// POST Save SMS Settings Create form
router.post('/sms-settings/save', authMiddleware, async (req, res) => {
  const { plantCode, smsType, levelName, dept, empId, mobileNo, shopCode, types, modules } = req.body;
  // Edit mode identifies the group being replaced by its ORIGINAL Plant/Emp/
  // Level/Shop (the values the form was loaded with), which is not
  // necessarily the same as the current form fields if the user changed any
  // of them before saving. Without this, changing e.g. the Shop while
  // editing meant the delete-then-recreate below searched for the NEW shop
  // code, never found the original row (still sitting under the OLD shop
  // code), left it orphaned, and inserted a second/duplicate row instead of
  // replacing it. Falls back to the current values for a genuine create
  // (nothing to delete there anyway).
  const {
    originalPlantCode = plantCode,
    originalEmpId = empId,
    originalLevelName = levelName,
    originalShopCode = shopCode,
  } = req.body;

  try {
    const selectedTypes = Array.isArray(types) ? types : [];
    const selectedModules = Array.isArray(modules) ? modules : [];

    // One Mst_Empl_SMSSetting row is written per selected Module below - with
    // none selected that loop is a no-op, so this used to return 200 "Data
    // Saved Successfully" having written nothing at all, and the setting
    // would just never appear in the SMS Settings list with no indication
    // why. Fail loudly instead of succeeding silently.
    if (selectedModules.length === 0) {
      return res.status(400).json({ message: 'Select at least one Target Module.' });
    }

    // Clean up the Dtls rows for whatever settings we're about to replace -
    // Mst_Empl_SMSSettingDtls has no ON DELETE CASCADE, so skipping this leaves
    // orphaned rows behind every time this employee's settings are re-saved.
    const oldRows = await db.query(
      `SELECT "sms_id" FROM "Mst_Empl_SMSSetting"
       WHERE "Plant_Code" = $1 AND "Emp_Id" = $2 AND "Level_Name" = $3 AND "Shop_Code" = $4
         AND "sms_id" IS NOT NULL`,
      [originalPlantCode, originalEmpId, originalLevelName, originalShopCode]
    );
    const oldSmsIds = oldRows.rows.map((r) => r.sms_id);
    if (oldSmsIds.length > 0) {
      await db.query('DELETE FROM "Mst_Empl_SMSSettingDtls" WHERE "Empl_SmsID" = ANY($1::bigint[])', [oldSmsIds]);
    }

    await db.query(`
      DELETE FROM "Mst_Empl_SMSSetting"
      WHERE "Plant_Code" = $1 AND "Emp_Id" = $2 AND "Level_Name" = $3 AND "Shop_Code" = $4
    `, [originalPlantCode, originalEmpId, originalLevelName, originalShopCode]);

    for (const modCode of selectedModules) {
      // "ID" has no DB-side default (not serial/identity), so it must be supplied
      // explicitly - compute it in the same statement to avoid a race between a
      // separate SELECT and this INSERT. "sms_id" is set to the same generated
      // value so the Mst_Empl_SMSSettingDtls rows inserted below (one per
      // selected problem type) can find this row back via Empl_SmsID - without
      // this, sms_id stayed NULL and smsNotificationService.js's Dtls join
      // (which is how it resolves Type_Code for a recipient) never matched,
      // so nobody created through this form ever actually received an SMS.
      const insertRes = await db.query(`
        INSERT INTO "Mst_Empl_SMSSetting"
          ("ID", "sms_id", "Sms_Type", "Level_Name", "Emp_Id", "Mobile_No", "Dept", "Shop_Code", "Module_Code", "Plant_Code", "CreatedDt")
        VALUES
          ((SELECT COALESCE(MAX("ID"), 0) + 1 FROM "Mst_Empl_SMSSetting"),
           (SELECT COALESCE(MAX("ID"), 0) + 1 FROM "Mst_Empl_SMSSetting"),
           $1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING "ID" AS id
      `, [smsType, levelName, empId, mobileNo, dept, shopCode, modCode, plantCode]);

      const newSmsId = insertRes.rows[0].id;

      for (const typeCode of selectedTypes) {
        await db.query(`
          INSERT INTO "Mst_Empl_SMSSettingDtls"
            ("ID", "Empl_SmsID", "Type_Code", "Plant_Code", "CreatedDt")
          VALUES
            ((SELECT COALESCE(MAX("ID"), 0) + 1 FROM "Mst_Empl_SMSSettingDtls"), $1, $2, $3, NOW())
        `, [newSmsId, typeCode, plantCode]);
      }
    }

    res.status(200).json({ message: 'Data Saved Successfully' });
  } catch (error) {
    console.error('Error saving SMS settings:', error);
    res.status(500).json({ message: 'Error saving SMS settings.' });
  }
});

// GET existing SMS Settings for one employee/level/shop group, for the Edit
// screen - aggregates every Module_Code row saved for this group plus the
// union of problem-Type_Codes assigned across their Mst_Empl_SMSSettingDtls
// rows, so the Create/Edit form (which is one row per module, but a single
// shared Types selection in the .NET original) can pre-check both panels.
router.get('/sms-settings/detail', authMiddleware, async (req, res) => {
  const { plantCode, empId, levelName, shopCode } = req.query;
  if (!plantCode || !empId || !levelName || !shopCode) {
    return res.status(400).json({ message: 'plantCode, empId, levelName and shopCode are required.' });
  }

  try {
    const rowsRes = await db.query(
      `SELECT "sms_id", "Sms_Type", "Mobile_No", "Dept", "Module_Code"
       FROM "Mst_Empl_SMSSetting"
       WHERE "Plant_Code" = $1 AND "Emp_Id" = $2 AND "Level_Name" = $3 AND "Shop_Code" = $4`,
      [plantCode, empId, levelName, shopCode]
    );

    if (rowsRes.rows.length === 0) {
      return res.status(404).json({ message: 'No SMS setting found for this employee/level/shop.' });
    }

    const smsIds = rowsRes.rows.map((r) => r.sms_id).filter((v) => v !== null && v !== undefined);
    let types = [];
    if (smsIds.length > 0) {
      const typesRes = await db.query(
        'SELECT DISTINCT "Type_Code" FROM "Mst_Empl_SMSSettingDtls" WHERE "Empl_SmsID" = ANY($1::bigint[])',
        [smsIds]
      );
      types = typesRes.rows.map((r) => r.Type_Code);
    }

    res.status(200).json({
      plantCode,
      smsType: rowsRes.rows[0].Sms_Type,
      levelName,
      dept: rowsRes.rows[0].Dept,
      empId,
      mobileNo: rowsRes.rows[0].Mobile_No,
      shopCode,
      modules: rowsRes.rows.map((r) => r.Module_Code),
      types
    });
  } catch (error) {
    console.error('Error fetching SMS setting detail:', error);
    res.status(500).json({ message: 'Error retrieving SMS setting detail.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// MIS REPORTS ENDPOINTS (Migrated from .NET application)
// ─────────────────────────────────────────────────────────────────────────────

// GET Line Stoppage Report - Breakdown (Closed Breakdowns)
router.get('/breakdown', authMiddleware, async (req, res) => {
  const { plantCode, shopCode, moduleCode, lineCode, machineCode, typeCode, startDate, endDate } = req.query;
  const userPlant = req.user?.plantCode || req.user?.plant_code;
  const effectivePlantCode = (userPlant && userPlant !== 'all' && userPlant !== '*' && userPlant !== 'ADMIN') ? userPlant : (plantCode || null);

  try {
    const sql = `
      SELECT 
        a."Id",
        pl.plant_name,
        tp."Type_Desc" AS problem_name,
        s."Shop_Name" AS shop_name,
        m."Module_Name" AS module_name,
        l."Line_Name" AS line_name,
        mc."Mchn_Name" AS machine_name,
        a.servicetype,
        mc."SAPMchn_Code" AS sapmchn_code,
        CASE 
          WHEN CAST(a."Entry_Date" AS time) >= '06:15:00' AND CAST(a."Entry_Date" AS time) <= '14:44:00' THEN 'A'
          WHEN CAST(a."Entry_Date" AS time) >= '14:45:00' AND CAST(a."Entry_Date" AS time) <= '22:45:00' THEN 'B'
          ELSE 'C' 
        END AS shift_name,
        TO_CHAR(a."Entry_Date", 'YYYY-MM-DD') AS start_date,
        TO_CHAR(a."Entry_Date", 'HH24:MI:SS') AS start_time,
        TO_CHAR(a."Close_Date", 'YYYY-MM-DD') AS end_date,
        TO_CHAR(a."Close_Date", 'HH24:MI:SS') AS end_time,
        1 AS occur,
        g."Gap_Name" AS reason_desc,
        bd."BD_Name" AS breakdown_type,
        a."Notification_No" AS notification_no,
        a."SAP_FileName_Notification" AS sap_filename_notification,
        a."SAP_Status" AS sap_status,
        a."SAP_FileName_Status" AS sap_filename_status,
        a."SAP_Remarks" AS sap_remarks,
        sg."Name" AS subgroup
      FROM "Trn_LineStoppage" a
      LEFT JOIN "plant" pl ON a."Plant_Code" = pl.plant_code
      LEFT JOIN "Mst_Shop" s ON a."Shop_Code" = s."Shop_code" AND a."Plant_Code" = s."Plant_Code"
      LEFT JOIN "Mst_Module" m ON a."Module_Code" = m."Module_Code" AND a."Plant_Code" = m."Plant_code"
      LEFT JOIN "Mst_Line" l ON a."Line_Code" = l."Line_code" AND a."Plant_Code" = l."Plant_code"
      LEFT JOIN "Mst_Machine" mc ON a."Machine_Code" = mc."Mchn_code" AND a."Plant_Code" = mc."Plant_code"
      LEFT JOIN "Mst_Type" tp ON a."Type_Code"::text = tp."Id"::text AND a."Plant_Code"::text = tp."Plant_Code"::text
      LEFT JOIN "Mst_Gap" g ON a."LineReason_Code"::text = g."Id"::text AND a."Plant_Code"::text = g."Plant_Code"::text
      LEFT JOIN "Mst_BreakDown" bd ON a."Breakdowntype"::text = bd."BD_ID"::text AND a."Plant_Code"::text = bd."Plant_Code"::text
      LEFT JOIN "mst_SubGroup" sg ON mc."SubGroup_Code"::text = sg."Id"::text AND mc."Plant_code"::text = sg."Plant_Code"::text
      WHERE a."Del_Status" = 'N'
        AND a."Close_Date" IS NOT NULL
        AND (a.servicetype <> 'Service' OR a.servicetype IS NULL)
        AND ($1::text IS NULL OR $1::text = '' OR a."Plant_Code"::text = $1::text)
        AND ($2::text IS NULL OR $2::text = '' OR $2::text = '0' OR a."Shop_Code"::text = $2::text)
        AND ($3::text IS NULL OR $3::text = '' OR $3::text = '0' OR a."Module_Code"::text = $3::text)
        AND ($4::text IS NULL OR $4::text = '' OR $4::text = '0' OR a."Line_Code"::text = $4::text)
        AND ($5::text IS NULL OR $5::text = '' OR $5::text = '0' OR a."Machine_Code"::text = $5::text)
        AND ($6::text IS NULL OR $6::text = '' OR $6::text = '0' OR a."Type_Code"::text = $6::text)
        AND ($7::timestamp IS NULL OR a."Entry_Date" >= $7::timestamp)
        AND ($8::timestamp IS NULL OR a."Entry_Date" <= $8::timestamp)
      ORDER BY a."Entry_Date" DESC
    `;
    const { rows } = await db.query(sql, [
      effectivePlantCode || null,
      shopCode || null,
      moduleCode || null,
      lineCode || null,
      machineCode || null,
      typeCode || null,
      startDate ? `${startDate} 00:00:00` : null,
      endDate ? `${endDate} 23:59:59` : null,
    ]);

    res.status(200).json(rows.map((r, index) => ({
      slno: index + 1,
      plant_name: r.plant_name || '-',
      problem_name: r.problem_name || '-',
      shop_name: r.shop_name || '-',
      module_name: r.module_name || '-',
      line_name: r.line_name || '-',
      machine_name: r.machine_name || '-',
      servicetype: r.servicetype || 'Breakdown',
      sapmchn_code: r.sapmchn_code || '-',
      shift_name: r.shift_name || 'A',
      start_date: r.start_date || '-',
      start_time: r.start_time || '-',
      end_date: r.end_date || '-',
      end_time: r.end_time || '-',
      occur: r.occur || 1,
      reason_desc: r.reason_desc || '-',
      breakdown_type: r.breakdown_type || '-',
      notification_no: r.notification_no || '-',
      sap_filename_notification: r.sap_filename_notification || '-',
      sap_status: r.sap_status || '-',
      sap_filename_status: r.sap_filename_status || '-',
      sap_remarks: r.sap_remarks || '-',
      subgroup: r.subgroup || '-'
    })));
  } catch (error) {
    console.error('Error fetching breakdown report:', error);
    res.status(500).json({ message: 'Error retrieving breakdown report.' });
  }
});

// GET Line Stoppage Report - Breakdown Pending
router.get('/pending', authMiddleware, async (req, res) => {
  const { plantCode, shopCode, moduleCode, lineCode, machineCode, typeCode, startDate, endDate } = req.query;
  const userPlant = req.user?.plantCode || req.user?.plant_code;
  const effectivePlantCode = (userPlant && userPlant !== 'all' && userPlant !== '*' && userPlant !== 'ADMIN') ? userPlant : (plantCode || null);

  try {
    const sql = `
      SELECT 
        a."Id",
        pl.plant_name,
        tp."Type_Desc" AS problem_name,
        s."Shop_Name" AS shop_name,
        m."Module_Name" AS module_name,
        l."Line_Name" AS line_name,
        mc."Mchn_Name" AS machine_name,
        a.servicetype,
        mc."SAPMchn_Code" AS sapmchn_code,
        CASE 
          WHEN CAST(a."Entry_Date" AS time) >= '06:15:00' AND CAST(a."Entry_Date" AS time) <= '14:44:00' THEN 'A'
          WHEN CAST(a."Entry_Date" AS time) >= '14:45:00' AND CAST(a."Entry_Date" AS time) <= '22:45:00' THEN 'B'
          ELSE 'C' 
        END AS shift_name,
        TO_CHAR(a."Entry_Date", 'YYYY-MM-DD') AS start_date,
        TO_CHAR(a."Entry_Date", 'HH24:MI:SS') AS start_time,
        1 AS occur,
        g."Gap_Name" AS reason_desc,
        bd."BD_Name" AS breakdown_type,
        a."Notification_No" AS notification_no,
        a."SAP_FileName_Notification" AS sap_filename_notification,
        a."SAP_Status" AS sap_status,
        a."SAP_FileName_Status" AS sap_filename_status,
        a."SAP_Remarks" AS sap_remarks,
        sg."Name" AS subgroup
      FROM "Trn_LineStoppage" a
      LEFT JOIN "plant" pl ON a."Plant_Code" = pl.plant_code
      LEFT JOIN "Mst_Shop" s ON a."Shop_Code" = s."Shop_code" AND a."Plant_Code" = s."Plant_Code"
      LEFT JOIN "Mst_Module" m ON a."Module_Code" = m."Module_Code" AND a."Plant_Code" = m."Plant_code"
      LEFT JOIN "Mst_Line" l ON a."Line_Code" = l."Line_code" AND a."Plant_Code" = l."Plant_code"
      LEFT JOIN "Mst_Machine" mc ON a."Machine_Code" = mc."Mchn_code" AND a."Plant_Code" = mc."Plant_code"
      LEFT JOIN "Mst_Type" tp ON a."Type_Code"::text = tp."Id"::text AND a."Plant_Code"::text = tp."Plant_Code"::text
      LEFT JOIN "Mst_Gap" g ON a."LineReason_Code"::text = g."Id"::text AND a."Plant_Code"::text = g."Plant_Code"::text
      LEFT JOIN "Mst_BreakDown" bd ON a."Breakdowntype"::text = bd."BD_ID"::text AND a."Plant_Code"::text = bd."Plant_Code"::text
      LEFT JOIN "mst_SubGroup" sg ON mc."SubGroup_Code"::text = sg."Id"::text AND mc."Plant_code"::text = sg."Plant_Code"::text
      WHERE a."Del_Status" = 'N'
        AND a."Close_Date" IS NULL
        AND (a.servicetype <> 'Service' OR a.servicetype IS NULL)
        AND ($1::text IS NULL OR $1::text = '' OR a."Plant_Code"::text = $1::text)
        AND ($2::text IS NULL OR $2::text = '' OR $2::text = '0' OR a."Shop_Code"::text = $2::text)
        AND ($3::text IS NULL OR $3::text = '' OR $3::text = '0' OR a."Module_Code"::text = $3::text)
        AND ($4::text IS NULL OR $4::text = '' OR $4::text = '0' OR a."Line_Code"::text = $4::text)
        AND ($5::text IS NULL OR $5::text = '' OR $5::text = '0' OR a."Machine_Code"::text = $5::text)
        AND ($6::text IS NULL OR $6::text = '' OR $6::text = '0' OR a."Type_Code"::text = $6::text)
        AND ($7::timestamp IS NULL OR a."Entry_Date" >= $7::timestamp)
        AND ($8::timestamp IS NULL OR a."Entry_Date" <= $8::timestamp)
      ORDER BY a."Entry_Date" DESC
    `;
    const { rows } = await db.query(sql, [
      effectivePlantCode || null,
      shopCode || null,
      moduleCode || null,
      lineCode || null,
      machineCode || null,
      typeCode || null,
      startDate ? `${startDate} 00:00:00` : null,
      endDate ? `${endDate} 23:59:59` : null,
    ]);

    res.status(200).json(rows.map((r, index) => ({
      slno: index + 1,
      plant_name: r.plant_name || '-',
      problem_name: r.problem_name || '-',
      shop_name: r.shop_name || '-',
      module_name: r.module_name || '-',
      line_name: r.line_name || '-',
      machine_name: r.machine_name || '-',
      servicetype: r.servicetype || 'Breakdown',
      sapmchn_code: r.sapmchn_code || '-',
      shift_name: r.shift_name || 'A',
      start_date: r.start_date || '-',
      start_time: r.start_time || '-',
      occur: r.occur || 1,
      reason_desc: r.reason_desc || '-',
      breakdown_type: r.breakdown_type || '-',
      notification_no: r.notification_no || '-',
      sap_filename_notification: r.sap_filename_notification || '-',
      sap_status: r.sap_status || '-',
      sap_filename_status: r.sap_filename_status || '-',
      sap_remarks: r.sap_remarks || '-',
      subgroup: r.subgroup || '-'
    })));
  } catch (error) {
    console.error('Error fetching breakdown pending report:', error);
    res.status(500).json({ message: 'Error retrieving breakdown pending report.' });
  }
});

// GET Line Stoppage Report Method3
router.get('/method3', authMiddleware, async (req, res) => {
  const { plantCode, startDate, endDate, typeCode } = req.query;
  const userPlant = req.user?.plantCode || req.user?.plant_code;
  const effectivePlantCode = (userPlant && userPlant !== 'all' && userPlant !== '*' && userPlant !== 'ADMIN') ? userPlant : (plantCode || null);

  try {
    const sql = `
      SELECT 
        pl.plant_name,
        m."Module_Name" AS module_name,
        l."Line_Name" AS line_name,
        
        COUNT(CASE WHEN UPPER(tp."Type_Desc") = 'MAN' THEN 1 END) AS man_occ,
        ROUND(COALESCE(SUM(CASE WHEN UPPER(tp."Type_Desc") = 'MAN' THEN EXTRACT(EPOCH FROM (COALESCE(a."Close_Date", NOW()) - a."Entry_Date"))/3600 END), 0)::numeric, 2) AS man_hrs,
        
        COUNT(CASE WHEN UPPER(tp."Type_Desc") = 'MACHINE' THEN 1 END) AS machine_occ,
        ROUND(COALESCE(SUM(CASE WHEN UPPER(tp."Type_Desc") = 'MACHINE' THEN EXTRACT(EPOCH FROM (COALESCE(a."Close_Date", NOW()) - a."Entry_Date"))/3600 END), 0)::numeric, 2) AS machine_hrs,

        COUNT(CASE WHEN UPPER(tp."Type_Desc") = 'METHOD' THEN 1 END) AS method_occ,
        ROUND(COALESCE(SUM(CASE WHEN UPPER(tp."Type_Desc") = 'METHOD' THEN EXTRACT(EPOCH FROM (COALESCE(a."Close_Date", NOW()) - a."Entry_Date"))/3600 END), 0)::numeric, 2) AS method_hrs,

        COUNT(CASE WHEN UPPER(tp."Type_Desc") = 'MATERIAL' THEN 1 END) AS material_occ,
        ROUND(COALESCE(SUM(CASE WHEN UPPER(tp."Type_Desc") = 'MATERIAL' THEN EXTRACT(EPOCH FROM (COALESCE(a."Close_Date", NOW()) - a."Entry_Date"))/3600 END), 0)::numeric, 2) AS material_hrs,

        COUNT(CASE WHEN UPPER(tp."Type_Desc") = 'QUALITY' THEN 1 END) AS quality_occ,
        ROUND(COALESCE(SUM(CASE WHEN UPPER(tp."Type_Desc") = 'QUALITY' THEN EXTRACT(EPOCH FROM (COALESCE(a."Close_Date", NOW()) - a."Entry_Date"))/3600 END), 0)::numeric, 2) AS quality_hrs,

        COUNT(CASE WHEN UPPER(tp."Type_Desc") NOT IN ('MAN', 'MACHINE', 'METHOD', 'MATERIAL', 'QUALITY') OR tp."Type_Desc" IS NULL THEN 1 END) AS others_occ,
        ROUND(COALESCE(SUM(CASE WHEN UPPER(tp."Type_Desc") NOT IN ('MAN', 'MACHINE', 'METHOD', 'MATERIAL', 'QUALITY') OR tp."Type_Desc" IS NULL THEN EXTRACT(EPOCH FROM (COALESCE(a."Close_Date", NOW()) - a."Entry_Date"))/3600 END), 0)::numeric, 2) AS others_hrs

      FROM "Trn_LineStoppage" a
      LEFT JOIN "plant" pl ON a."Plant_Code" = pl.plant_code
      LEFT JOIN "Mst_Module" m ON a."Module_Code" = m."Module_Code" AND a."Plant_Code" = m."Plant_code"
      LEFT JOIN "Mst_Line" l ON a."Line_Code" = l."Line_code" AND a."Plant_Code" = l."Plant_code"
      LEFT JOIN "Mst_Type" tp ON a."Type_Code"::text = tp."Id"::text AND a."Plant_Code"::text = tp."Plant_Code"::text
      WHERE a."Del_Status" = 'N'
        AND (a.servicetype <> 'Service' OR a.servicetype IS NULL)
        AND ($1::text IS NULL OR $1::text = '' OR a."Plant_Code"::text = $1::text)
        AND ($2::timestamp IS NULL OR a."Entry_Date" >= $2::timestamp)
        AND ($3::timestamp IS NULL OR a."Entry_Date" <= $3::timestamp)
        AND ($4::text IS NULL OR $4::text = '' OR $4::text = '0' OR tp."Type_Desc"::text = $4::text OR a."Type_Code"::text = $4::text)
      GROUP BY pl.plant_name, m."Module_Name", l."Line_Name"
      ORDER BY pl.plant_name, m."Module_Name", l."Line_Name"
    `;
    const { rows } = await db.query(sql, [
      effectivePlantCode || null,
      startDate ? `${startDate} 00:00:00` : null,
      endDate ? `${endDate} 23:59:59` : null,
      typeCode || null
    ]);

    res.status(200).json(rows.map((r, index) => ({
      key: index + 1,
      plant_name: r.plant_name || '-',
      module_name: r.module_name || '-',
      line_name: r.line_name || '-',
      man_occ: Number(r.man_occ || 0),
      man_hrs: Number(r.man_hrs || 0),
      machine_occ: Number(r.machine_occ || 0),
      machine_hrs: Number(r.machine_hrs || 0),
      method_occ: Number(r.method_occ || 0),
      method_hrs: Number(r.method_hrs || 0),
      material_occ: Number(r.material_occ || 0),
      material_hrs: Number(r.material_hrs || 0),
      quality_occ: Number(r.quality_occ || 0),
      quality_hrs: Number(r.quality_hrs || 0),
      others_occ: Number(r.others_occ || 0),
      others_hrs: Number(r.others_hrs || 0)
    })));
  } catch (error) {
    console.error('Error fetching method3 report:', error);
    res.status(500).json({ message: 'Error retrieving method3 report.' });
  }
});

// GET Line Stoppage Report Method2
router.get('/method2', authMiddleware, async (req, res) => {
  const { plantCode, shopCode, moduleCode, lineCode, machineCode, startDate, endDate } = req.query;
  const userPlant = req.user?.plantCode || req.user?.plant_code;
  const effectivePlantCode = (userPlant && userPlant !== 'all' && userPlant !== '*' && userPlant !== 'ADMIN') ? userPlant : (plantCode || null);

  try {
    const sql = `
      SELECT 
        pl.plant_name,
        s."Shop_Name" AS shop_name,
        m."Module_Name" AS module_name,
        l."Line_Name" AS line_name,
        mc."Mchn_Name" AS machine_name,
        COUNT(CASE WHEN (EXTRACT(EPOCH FROM (COALESCE(a."Close_Date", NOW()) - a."Entry_Date"))/3600) <= 2 THEN 1 END) AS hrs_0_2,
        COUNT(CASE WHEN (EXTRACT(EPOCH FROM (COALESCE(a."Close_Date", NOW()) - a."Entry_Date"))/3600) > 2 AND (EXTRACT(EPOCH FROM (COALESCE(a."Close_Date", NOW()) - a."Entry_Date"))/3600) <= 4 THEN 1 END) AS hrs_2_4,
        COUNT(CASE WHEN (EXTRACT(EPOCH FROM (COALESCE(a."Close_Date", NOW()) - a."Entry_Date"))/3600) > 4 AND (EXTRACT(EPOCH FROM (COALESCE(a."Close_Date", NOW()) - a."Entry_Date"))/3600) <= 6 THEN 1 END) AS hrs_4_6,
        COUNT(CASE WHEN (EXTRACT(EPOCH FROM (COALESCE(a."Close_Date", NOW()) - a."Entry_Date"))/3600) > 6 AND (EXTRACT(EPOCH FROM (COALESCE(a."Close_Date", NOW()) - a."Entry_Date"))/3600) <= 8 THEN 1 END) AS hrs_6_8,
        COUNT(CASE WHEN (EXTRACT(EPOCH FROM (COALESCE(a."Close_Date", NOW()) - a."Entry_Date"))/3600) > 8 THEN 1 END) AS hrs_gt_8,
        COUNT(a."Id") AS total
      FROM "Trn_LineStoppage" a
      LEFT JOIN "plant" pl ON a."Plant_Code" = pl.plant_code
      LEFT JOIN "Mst_Shop" s ON a."Shop_Code" = s."Shop_code" AND a."Plant_Code" = s."Plant_Code"
      LEFT JOIN "Mst_Module" m ON a."Module_Code" = m."Module_Code" AND a."Plant_Code" = m."Plant_code"
      LEFT JOIN "Mst_Line" l ON a."Line_Code" = l."Line_code" AND a."Plant_Code" = l."Plant_code"
      LEFT JOIN "Mst_Machine" mc ON a."Machine_Code" = mc."Mchn_code" AND a."Plant_Code" = mc."Plant_code"
      WHERE a."Del_Status" = 'N'
        AND ($1::text IS NULL OR $1::text = '' OR a."Plant_Code"::text = $1::text)
        AND ($2::text IS NULL OR $2::text = '' OR $2::text = '0' OR a."Shop_Code"::text = $2::text)
        AND ($3::text IS NULL OR $3::text = '' OR $3::text = '0' OR a."Module_Code"::text = $3::text)
        AND ($4::text IS NULL OR $4::text = '' OR $4::text = '0' OR a."Line_Code"::text = $4::text)
        AND ($5::text IS NULL OR $5::text = '' OR $5::text = '0' OR a."Machine_Code"::text = $5::text)
        AND ($6::timestamp IS NULL OR a."Entry_Date" >= $6::timestamp)
        AND ($7::timestamp IS NULL OR a."Entry_Date" <= $7::timestamp)
      GROUP BY pl.plant_name, s."Shop_Name", m."Module_Name", l."Line_Name", mc."Mchn_Name"
      ORDER BY pl.plant_name, s."Shop_Name", m."Module_Name", l."Line_Name", mc."Mchn_Name"
    `;
    const { rows } = await db.query(sql, [
      effectivePlantCode || null,
      shopCode || null,
      moduleCode || null,
      lineCode || null,
      machineCode || null,
      startDate ? `${startDate} 00:00:00` : null,
      endDate ? `${endDate} 23:59:59` : null
    ]);

    res.status(200).json(rows.map((r, index) => ({
      slno: index + 1,
      plant_name: r.plant_name || '-',
      shop_name: r.shop_name || '-',
      module_name: r.module_name || '-',
      line_name: r.line_name || '-',
      machine_name: r.machine_name || '-',
      hrs_0_2: Number(r.hrs_0_2 || 0),
      hrs_2_4: Number(r.hrs_2_4 || 0),
      hrs_4_6: Number(r.hrs_4_6 || 0),
      hrs_6_8: Number(r.hrs_6_8 || 0),
      hrs_gt_8: Number(r.hrs_gt_8 || 0),
      total: Number(r.total || 0)
    })));
  } catch (error) {
    console.error('Error fetching method2 report:', error);
    res.status(500).json({ message: 'Error retrieving method2 report.' });
  }
});

// GET Line Stoppage Report Service
router.get('/service', authMiddleware, async (req, res) => {
  const { plantCode, shopCode, moduleCode, lineCode, machineCode, shift, startDate, endDate } = req.query;
  const userPlant = req.user?.plantCode || req.user?.plant_code;
  const effectivePlantCode = (userPlant && userPlant !== 'all' && userPlant !== '*' && userPlant !== 'ADMIN') ? userPlant : (plantCode || null);

  try {
    const sql = `
      SELECT 
        a."Id",
        pl.plant_name,
        s."Shop_Name" AS shop_name,
        m."Module_Name" AS module_name,
        l."Line_Name" AS line_name,
        mc."Mchn_Name" AS machine_name,
        TO_CHAR(a."Entry_Date", 'YYYY-MM-DD') AS start_date,
        TO_CHAR(a."Entry_Date", 'HH24:MI:SS') AS start_time,
        TO_CHAR(a."Close_Date", 'YYYY-MM-DD') AS end_date,
        TO_CHAR(a."Close_Date", 'HH24:MI:SS') AS end_time,
        tp."Type_Desc" AS type_desc,
        g."Gap_Name" AS reason_desc,
        mc."SAPMchn_Code" AS sapmchn_code,
        CASE 
          WHEN CAST(a."Entry_Date" AS time) >= '06:15:00' AND CAST(a."Entry_Date" AS time) <= '14:44:00' THEN 'A'
          WHEN CAST(a."Entry_Date" AS time) >= '14:45:00' AND CAST(a."Entry_Date" AS time) <= '22:45:00' THEN 'B'
          ELSE 'C' 
        END AS shift_name,
        a.servicetype,
        a."Reason" AS reason,
        bd."BD_Name" AS breakdown_type
      FROM "Trn_LineStoppage" a
      LEFT JOIN "plant" pl ON a."Plant_Code" = pl.plant_code
      LEFT JOIN "Mst_Shop" s ON a."Shop_Code" = s."Shop_code" AND a."Plant_Code" = s."Plant_Code"
      LEFT JOIN "Mst_Module" m ON a."Module_Code" = m."Module_Code" AND a."Plant_Code" = m."Plant_code"
      LEFT JOIN "Mst_Line" l ON a."Line_Code" = l."Line_code" AND a."Plant_Code" = l."Plant_code"
      LEFT JOIN "Mst_Machine" mc ON a."Machine_Code" = mc."Mchn_code" AND a."Plant_Code" = mc."Plant_code"
      LEFT JOIN "Mst_Type" tp ON a."Type_Code"::text = tp."Id"::text AND a."Plant_Code"::text = tp."Plant_Code"::text
      LEFT JOIN "Mst_Gap" g ON a."LineReason_Code"::text = g."Id"::text AND a."Plant_Code"::text = g."Plant_Code"::text
      LEFT JOIN "Mst_BreakDown" bd ON a."Breakdowntype"::text = bd."BD_ID"::text AND a."Plant_Code"::text = bd."Plant_Code"::text
      WHERE a."Del_Status" = 'N'
        AND a.servicetype = 'Service'
        AND ($1::text IS NULL OR $1::text = '' OR a."Plant_Code"::text = $1::text)
        AND ($2::text IS NULL OR $2::text = '' OR $2::text = '0' OR a."Shop_Code"::text = $2::text)
        AND ($3::text IS NULL OR $3::text = '' OR $3::text = '0' OR a."Module_Code"::text = $3::text)
        AND ($4::text IS NULL OR $4::text = '' OR $4::text = '0' OR a."Line_Code"::text = $4::text)
        AND ($5::text IS NULL OR $5::text = '' OR $5::text = '0' OR a."Machine_Code"::text = $5::text)
        AND ($6::timestamp IS NULL OR a."Entry_Date" >= $6::timestamp)
        AND ($7::timestamp IS NULL OR a."Entry_Date" <= $7::timestamp)
      ORDER BY a."Entry_Date" DESC
    `;
    const { rows } = await db.query(sql, [
      effectivePlantCode || null,
      shopCode || null,
      moduleCode || null,
      lineCode || null,
      machineCode || null,
      startDate ? `${startDate} 00:00:00` : null,
      endDate ? `${endDate} 23:59:59` : null
    ]);

    res.status(200).json(rows.map((r, index) => ({
      slno: index + 1,
      plant_name: r.plant_name || '-',
      shop_name: r.shop_name || '-',
      module_name: r.module_name || '-',
      line_name: r.line_name || '-',
      machine_name: r.machine_name || '-',
      start_date: r.start_date || '-',
      start_time: r.start_time || '-',
      end_date: r.end_date || '-',
      end_time: r.end_time || '-',
      type_desc: r.type_desc || '-',
      reason_desc: r.reason_desc || '-',
      sapmchn_code: r.sapmchn_code || '-',
      shift_name: r.shift_name || 'A',
      servicetype: r.servicetype || 'Service',
      reason: r.reason || '-',
      breakdown_type: r.breakdown_type || '-'
    })));
  } catch (error) {
    console.error('Error fetching service report:', error);
    res.status(500).json({ message: 'Error retrieving service report.' });
  }
});

// GET Line Stoppage Reason Report
router.get('/reason', authMiddleware, async (req, res) => {
  const { plantCode, typeCode, groupCode, reasonCode } = req.query;
  const userPlant = req.user?.plantCode || req.user?.plant_code;
  const effectivePlantCode = (userPlant && userPlant !== 'all' && userPlant !== '*' && userPlant !== 'ADMIN') ? userPlant : (plantCode || null);

  try {
    const sql = `
      SELECT 
        a."Id",
        pl.plant_name,
        tp."Type_Desc" AS type_name,
        g."Groupname" AS group_name,
        gap."Gap_Name" AS reason_name
      FROM "Mst_TypeReason_Mapping" a
      LEFT JOIN "plant" pl ON a."Plant_Code" = pl.plant_code
      LEFT JOIN "mst_group" g ON a."Group_Code"::text = g."ID"::text AND a."Plant_Code"::text = g."Plant_Code"::text
      LEFT JOIN "Mst_Type" tp ON a."Type_Code"::text = tp."Id"::text AND a."Plant_Code"::text = tp."Plant_Code"::text
      LEFT JOIN "Mst_Gap" gap ON a."Reason_Code"::text = gap."Id"::text AND a."Plant_Code"::text = gap."Plant_Code"::text
      WHERE ($1::text IS NULL OR $1::text = '' OR a."Plant_Code"::text = $1::text)
        AND ($2::text IS NULL OR $2::text = '' OR $2::text = '0' OR a."Type_Code"::text = $2::text)
        AND ($3::text IS NULL OR $3::text = '' OR $3::text = '0' OR a."Group_Code"::text = $3::text)
        AND ($4::text IS NULL OR $4::text = '' OR $4::text = '0' OR a."Reason_Code"::text = $4::text)
      ORDER BY a."Id" ASC
    `;
    const { rows } = await db.query(sql, [
      effectivePlantCode || null,
      typeCode || null,
      groupCode || null,
      reasonCode || null
    ]);

    res.status(200).json(rows.map((r, index) => ({
      slno: index + 1,
      plant_name: r.plant_name || '-',
      type_name: r.type_name || '-',
      group_name: r.group_name || '-',
      reason_name: r.reason_name || '-'
    })));
  } catch (error) {
    console.error('Error fetching reason report:', error);
    res.status(500).json({ message: 'Error retrieving reason report.' });
  }
});

module.exports = router;


