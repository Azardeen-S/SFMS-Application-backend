const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');

function getExactTableName(tableParam) {
  if (!tableParam) return tableParam;
  const map = {
    'mst_subgroup': 'mst_SubGroup',
    'mst_category': 'Mst_Category',
    'mst_group': 'mst_group',
    'phenomena': 'Phenomena',
    'mst_closure': 'Mst_Closure',
    'mst_gap': 'Mst_Gap',
    'mst_type': 'Mst_Type',
    'mst_breakdown': 'Mst_BreakDown',
    'mst_shift_hours': 'Mst_Shift_Hours',
    'mst_shift': 'Mst_Shift_Hours',
    'mst_functional_location': 'mst_Functional_Location',
    'mst_empl_smssetting': 'Mst_Empl_SMSSetting',
    'mst_empl_automailsetting': 'Mst_Empl_AutoMailSetting',
    'mst_typereason_mapping': 'Mst_TypeReason_Mapping',
    'mst_doclist': 'doc_doclist',
    'vendor': 'VENDOR',
    'plant': 'plant',
    'shop': 'Mst_Shop',
    'module': 'Mst_Module',
    'line': 'Mst_Line',
    'machine': 'Mst_Machine',
    'employee': 'Mst_Employee'
  };
  return map[tableParam.toLowerCase()] || tableParam;
}

// Helper to get PK and delete columns for each table
function getTableMeta(tableName) {
  const name = tableName.toLowerCase();
  if (name === 'mst_shift_hours' || name === 'mst_shift') return { pk: 'id', delCol: 'Del_Status' };
  if (name === 'mst_breakdown') return { pk: 'BD_ID', delCol: 'Del_Status' };
  if (name === 'mst_category') return { pk: 'Category_ID', delCol: 'Del_Status' };
  if (name === 'mst_group') return { pk: 'ID', delCol: 'del_status' };
  if (name === 'mst_subgroup') return { pk: 'Id', delCol: 'Del_Status' };
  if (name === 'phenomena') return { pk: 'Id', delCol: 'Del_status' };
  if (name === 'mst_closure') return { pk: 'Closure_ID', delCol: 'Del_Status' };
  if (name === 'mst_typereason_mapping' || name === 'mst_linestoppagereasonmapping' || name === 'mst_linestoppage_reasonmapping') return { pk: 'Id', delCol: 'Del_Status' };
  if (name === 'mst_functional_location') return { pk: 'Id', delCol: 'Del_Status' };
  if (name === 'mst_empl_automailsetting') return { pk: 'ID', delCol: 'Del_Status' };
  if (name === 'mst_empl_smssetting') return { pk: 'sms_id', delCol: 'Del_Status' };
  if (name === 'doc_doclist' || name === 'mst_doclist') return { pk: 'DOCID', delCol: 'Del_Status' };
  if (name === 'vendor') return { pk: 'Vendor_Id', delCol: 'Is_Active' };
  return { pk: 'Id', delCol: 'Del_Status' };
}

function isPlantMatch(row, userPlantCode, userPlantName) {
  if (!userPlantCode || userPlantCode === 'all' || userPlantCode === '*' || userPlantCode === 'ADMIN') {
    return true;
  }
  const rowCode = String(row.plant_code || row.Plant_Code || row.Plant_code || '').trim();
  const rowName = String(row.plant_name || row.Plant_Name || row.Plant_name || '').trim();

  const userCode = String(userPlantCode || '').trim();
  const userName = String(userPlantName || '').trim().toLowerCase();

  if (rowCode && rowCode === userCode) return true;
  if (rowName && userName && rowName.toLowerCase() === userName) return true;

  return false;
}

// GET all records from generic table
router.get('/:table', authMiddleware, async (req, res) => {
  const tableName = getExactTableName(req.params.table);
  const userPlantCode = req.user?.plantCode || req.user?.plant_code;
  const userPlantName = req.user?.plantName || req.user?.plant_name;

  try {
    let rows;
    if (tableName.toLowerCase() === 'mst_typereason_mapping' || tableName.toLowerCase() === 'mst_linestoppagereasonmapping' || tableName.toLowerCase() === 'mst_linestoppage_reasonmapping') {
      try {
        const queryPlant = req.query.plant_code || (userPlantCode && userPlantCode !== 'all' && userPlantCode !== '*' && userPlantCode !== 'ADMIN' ? userPlantCode : null);
        let whereClause = '';
        const params = [];

        if (queryPlant) {
          whereClause = `WHERE CAST(m."Plant_Code" AS VARCHAR) = $1`;
          params.push(String(queryPlant).trim());
        }

        const joinedRes = await db.query(`
          SELECT 
            m."Id",
            m."Group_Code",
            m."Type_Code",
            m."Reason_Code",
            m."Plant_Code",
            m."Del_Status",
            p."plant_name" AS "Plant_Name",
            g."Groupname" AS "Group_Name",
            t."Type_Desc" AS "Problem_Type",
            r."Gap_Name" AS "Reason_Name"
          FROM "Mst_TypeReason_Mapping" m
          LEFT JOIN "plant" p ON CAST(m."Plant_Code" AS VARCHAR) = CAST(p."plant_code" AS VARCHAR)
          LEFT JOIN "mst_group" g ON CAST(m."Group_Code" AS VARCHAR) = CAST(g."ID" AS VARCHAR)
          LEFT JOIN "Mst_Type" t ON CAST(m."Type_Code" AS VARCHAR) = CAST(t."Id" AS VARCHAR) AND CAST(m."Plant_Code" AS VARCHAR) = CAST(t."Plant_Code" AS VARCHAR)
          LEFT JOIN "Mst_Gap" r ON CAST(m."Reason_Code" AS VARCHAR) = CAST(r."Id" AS VARCHAR) AND CAST(m."Plant_Code" AS VARCHAR) = CAST(r."Plant_Code" AS VARCHAR)
          ${whereClause}
          ORDER BY m."Id" DESC
        `, params);
        return res.status(200).json(joinedRes.rows);
      } catch (jErr) {
        console.warn('Joined query failed for Mst_TypeReason_Mapping:', jErr.message);
      }
    }
    if (tableName.toLowerCase() === 'phenomena') {
      try {
        const joinedRes = await db.query(`
          SELECT 
            ph."Id",
            ph."Name",
            ph."Del_status" AS "Del_Status",
            ph."Plant_Code",
            p.plant_name AS "Plant_Name"
          FROM "Phenomena" ph
          LEFT JOIN "plant" p ON CAST(ph."Plant_Code" AS VARCHAR) = CAST(p."plant_code" AS VARCHAR)
          ORDER BY ph."Id" DESC
        `);
        let data = joinedRes.rows;
        if (userPlantCode && userPlantCode !== 'all' && userPlantCode !== '*' && userPlantCode !== 'ADMIN') {
          data = data.filter(r => isPlantMatch(r, userPlantCode, userPlantName));
        }
        return res.status(200).json(data);
      } catch (jErr) {
        console.warn('Joined query failed for Phenomena:', jErr.message);
      }
    }
    if (tableName.toLowerCase() === 'mst_closure') {
      try {
        const joinedRes = await db.query(`
          SELECT 
            c."Closure_ID",
            c."Reason",
            c."Del_Status",
            c."Dept",
            c."Type",
            c."Plant_Code",
            p.plant_name AS "Plant_Name",
            COALESCE(d.dept_name, c."Dept") AS "Dept_Name",
            COALESCE(t."Type_Desc", c."Type") AS "Problem_Type"
          FROM "Mst_Closure" c
          LEFT JOIN "plant" p ON CAST(c."Plant_Code" AS VARCHAR) = CAST(p."plant_code" AS VARCHAR)
          LEFT JOIN "mst_dept" d ON CAST(c."Dept" AS VARCHAR) = CAST(d."dept_id" AS VARCHAR) AND CAST(c."Plant_Code" AS VARCHAR) = CAST(d."Plant_Code" AS VARCHAR)
          LEFT JOIN "Mst_Type" t ON CAST(c."Type" AS VARCHAR) = CAST(t."Id" AS VARCHAR) AND CAST(c."Plant_Code" AS VARCHAR) = CAST(t."Plant_Code" AS VARCHAR)
          ORDER BY c."Closure_ID" DESC
        `);
        let data = joinedRes.rows;
        if (userPlantCode && userPlantCode !== 'all' && userPlantCode !== '*' && userPlantCode !== 'ADMIN') {
          data = data.filter(r => isPlantMatch(r, userPlantCode, userPlantName));
        }
        return res.status(200).json(data);
      } catch (jErr) {
        console.warn('Joined query failed for Mst_Closure:', jErr.message);
      }
    }
    if (tableName.toLowerCase() === 'mst_functional_location') {
      try {
        const joinedRes = await db.query(`
          SELECT 
            l.*,
            l."Del_Status",
            m."Module_Name" AS "Module",
            line."Line_Name" AS "Line",
            s."Shop_Name" AS "Shop"
          FROM "mst_Functional_Location" l
          LEFT JOIN "Mst_Module" m ON CAST(l."Module_Code" AS VARCHAR) = CAST(m."Module_Code" AS VARCHAR) AND l."Plant_Code" = m."Plant_code"
          LEFT JOIN "Mst_Line" line ON CAST(l."Line_Code" AS VARCHAR) = CAST(line."Line_code" AS VARCHAR) AND l."Plant_Code" = line."Plant_code"
          LEFT JOIN "Mst_Shop" s ON CAST(m."Shop_code" AS VARCHAR) = CAST(s."Shop_code" AS VARCHAR) AND l."Plant_Code" = s."Plant_Code"
        `);
        let data = joinedRes.rows;
        if (userPlantCode && userPlantCode !== 'all' && userPlantCode !== '*' && userPlantCode !== 'ADMIN') {
          data = data.filter(r => isPlantMatch(r, userPlantCode, userPlantName));
        }
        return res.status(200).json(data);
      } catch (jErr) {
        console.warn('Joined query failed for mst_functional_location, falling back:', jErr.message);
      }
    }

    if (tableName.toLowerCase() === 'mst_empl_smssetting') {
      try {
        const joinedRes = await db.query(`
          SELECT 
            DISTINCT ON (s."sms_id")
            s."sms_id",
            s."Sms_Type",
            s."Level_Name",
            s."Del_Status",
            COALESCE(e."Emp_Name"::varchar, s."Emp_Id"::varchar) AS "Emp_Name",
            COALESCE(d."dept_name"::varchar, s."Dept"::varchar) AS "Dept_Name",
            COALESCE(p."plant_name"::varchar, s."Plant_Code"::varchar) AS "Plant_Name",
            COALESCE(sh."Shop_Name"::varchar, s."Shop_Code"::varchar) AS "Shop_Name",
            s."Mobile_No",
            s."Plant_Code"
          FROM "Mst_Empl_SMSSetting" s
          LEFT JOIN "Mst_Employee" e ON (CAST(s."Emp_Id" AS VARCHAR) = CAST(e."Emp_No" AS VARCHAR) OR CAST(s."Emp_Id" AS VARCHAR) = CAST(e."Emp_Id" AS VARCHAR)) AND s."Plant_Code"::text = e."Plant_Code"::text
          LEFT JOIN "mst_dept" d ON CAST(s."Dept" AS VARCHAR) = CAST(d."dept_id" AS VARCHAR) AND s."Plant_Code"::text = d."Plant_Code"::text
          LEFT JOIN "plant" p ON CAST(s."Plant_Code" AS VARCHAR) = CAST(p."plant_code" AS VARCHAR)
          LEFT JOIN "Mst_Shop" sh ON CAST(s."Shop_Code" AS VARCHAR) = CAST(sh."Shop_code" AS VARCHAR) AND s."Plant_Code"::text = sh."Plant_Code"::text
          WHERE (e."Del_Status" = 'N' OR e."Del_Status" IS NULL OR e."Emp_Id" IS NULL)
          ORDER BY s."sms_id" DESC
        `);
        let data = joinedRes.rows;
        if (userPlantCode && userPlantCode !== 'all' && userPlantCode !== '*' && userPlantCode !== 'ADMIN') {
          data = data.filter(r => isPlantMatch(r, userPlantCode, userPlantName));
        }
        return res.status(200).json(data);
      } catch (jErr) {
        console.warn('Joined query failed for mst_empl_smssetting, falling back:', jErr.message);
      }
    }

    if (tableName.toLowerCase() === 'mst_empl_automailsetting') {
      try {
        const joinedRes = await db.query(`
          SELECT 
            a."ID",
            a."Plant_Code",
            a."Shop_Code",
            a."Dept",
            a."Emp_Id",
            a."Level_Name",
            a."EmailID",
            a."Del_Status",
            COALESCE(p."plant_name"::varchar, a."Plant_Code"::varchar) AS "Plant_Name",
            COALESCE(d."dept_name"::varchar, a."Dept"::varchar) AS "Dept_Name",
            COALESCE(e."Emp_Name"::varchar, a."Emp_Id"::varchar) AS "Emp_Name",
            COALESCE(sh."Shop_Name"::varchar, a."Shop_Code"::varchar) AS "Shop_Name"
          FROM "Mst_Empl_AutoMailSetting" a
          LEFT JOIN "plant" p ON CAST(a."Plant_Code" AS VARCHAR) = CAST(p."plant_code" AS VARCHAR)
          LEFT JOIN "mst_dept" d ON CAST(a."Dept" AS VARCHAR) = CAST(d."dept_id" AS VARCHAR) AND a."Plant_Code"::text = d."Plant_Code"::text
          LEFT JOIN "Mst_Employee" e ON CAST(a."Emp_Id" AS VARCHAR) = CAST(e."Emp_Id" AS VARCHAR) OR CAST(a."Emp_Id" AS VARCHAR) = CAST(e."Emp_No" AS VARCHAR)
          LEFT JOIN "Mst_Shop" sh ON CAST(a."Shop_Code" AS VARCHAR) = CAST(sh."Shop_code" AS VARCHAR) AND a."Plant_Code"::text = sh."Plant_Code"::text
          ORDER BY a."ID" DESC
        `);
        let data = joinedRes.rows;
        if (userPlantCode && userPlantCode !== 'all' && userPlantCode !== '*' && userPlantCode !== 'ADMIN') {
          data = data.filter(r => isPlantMatch(r, userPlantCode, userPlantName));
        }
        return res.status(200).json(data);
      } catch (jErr) {
        console.warn('Joined query failed for Mst_Empl_AutoMailSetting:', jErr.message);
      }
    }

    if (tableName.toLowerCase() === 'vendor') {
      try {
        const joinedRes = await db.query(`
          SELECT 
            v.*,
            COALESCE(p."plant_name"::varchar, v."Plant_Code"::varchar) AS "Plant_Name"
          FROM "VENDOR" v
          LEFT JOIN "plant" p ON CAST(v."Plant_Code" AS VARCHAR) = CAST(p."plant_code" AS VARCHAR)
        `);
        let data = joinedRes.rows;
        if (userPlantCode && userPlantCode !== 'all' && userPlantCode !== '*' && userPlantCode !== 'ADMIN') {
          data = data.filter(r => isPlantMatch(r, userPlantCode, userPlantName));
        }
        return res.status(200).json(data);
      } catch (jErr) {
        console.warn('Joined query failed for VENDOR, falling back:', jErr.message);
      }
    }

    if (tableName.toLowerCase() === 'mst_shift_hours' || tableName.toLowerCase() === 'mst_shift') {
      try {
        const joinedRes = await db.query(`
          SELECT 
            s.*,
            s."Shift" AS "Shift",
            s."Hours" AS "Hours",
            COALESCE(p."plant_name"::varchar, s."Plant_Code"::varchar) AS "Plant_Name"
          FROM "Mst_Shift_Hours" s
          LEFT JOIN "plant" p ON CAST(s."Plant_Code" AS VARCHAR) = CAST(p."plant_code" AS VARCHAR)
        `);
        let data = joinedRes.rows;
        if (userPlantCode && userPlantCode !== 'all' && userPlantCode !== '*' && userPlantCode !== 'ADMIN') {
          data = data.filter(r => isPlantMatch(r, userPlantCode, userPlantName));
        }
        return res.status(200).json(data);
      } catch (jErr) {
        console.warn('Joined query failed for Mst_Shift_Hours, falling back:', jErr.message);
      }
    }

    try {
      const rawRes = await db.query(`SELECT to_jsonb(t) AS row_data FROM "${tableName}" t`);
      rows = rawRes.rows;
    } catch (rawErr) {
      console.warn(`Raw select failed for ${tableName}:`, rawErr.message);
      return res.status(200).json([]);
    }
    let data = rows.map(r => r.row_data);

    if (userPlantCode && userPlantCode !== 'all' && userPlantCode !== '*' && userPlantCode !== 'ADMIN' && data.length > 0) {
      data = data.filter(r => isPlantMatch(r, userPlantCode, userPlantName));
    }

    if (data.length > 0) {
      const keys = Object.keys(data[0]);
      const nameCol = keys.find(k => {
        const name = k.toLowerCase();
        return name.includes('name') || name.includes('vendor') || name.includes('location') || name.includes('groupname');
      });

      const { pk } = getTableMeta(tableName);
      if (nameCol) {
        data.sort((a, b) => String(a[nameCol] || '').localeCompare(String(b[nameCol] || '')));
      } else {
        data.sort((a, b) => (b[pk] || 0) - (a[pk] || 0));
      }
    }

    res.status(200).json(data);
  } catch (error) {
    console.error(`Error fetching from ${tableName}:`, error);
    res.status(500).json({ message: `Error retrieving data from ${tableName}.` });
  }
});

// POST create record
router.post('/:table', authMiddleware, async (req, res) => {
  const tableName = getExactTableName(req.params.table);
  const body = { ...req.body };
  const plantCode = req.user?.plantCode || req.user?.plant_code;

  try {
    const checkCols = await db.query('SELECT column_name FROM sp_get_table_columns($1)', [tableName]);
    const columns = checkCols.rows.map(r => r.column_name);
    const lowerColumns = columns.map(c => c.toLowerCase());

    // Inject plant code if needed
    if (plantCode && lowerColumns.includes('plant_code')) {
      const plantColName = columns.find(c => c.toLowerCase() === 'plant_code');
      if (!body[plantColName]) {
        body[plantColName] = plantCode;
      }
    }

    // Inject CreatedDt / Created_By if columns exist
    if (lowerColumns.includes('createddt')) {
      const colName = columns.find(c => c.toLowerCase() === 'createddt');
      if (!body[colName]) body[colName] = new Date().toISOString();
    }
    if (lowerColumns.includes('created_by')) {
      const colName = columns.find(c => c.toLowerCase() === 'created_by');
      if (!body[colName]) body[colName] = req.user?.empId || 'system';
    }

    // Auto-generate PK if PK is not present in body
    const { pk, delCol } = getTableMeta(tableName);
    const actualPk = columns.find(c => c.toLowerCase() === pk.toLowerCase()) || pk;

    if (!body[actualPk] && !body[actualPk.toLowerCase()] && !body.id && !body.Id && !body.ID) {
      try {
        const maxRes = await db.query(`SELECT COALESCE(MAX("${actualPk}"), 0) + 1 AS next_id FROM "${tableName}"`);
        if (maxRes.rows.length > 0 && maxRes.rows[0].next_id) {
          body[actualPk] = maxRes.rows[0].next_id;
        }
      } catch (maxErr) {
        console.warn(`Could not calculate MAX(${actualPk}) for ${tableName}:`, maxErr.message);
      }
    }

    if (delCol && lowerColumns.includes(delCol.toLowerCase())) {
      const hasDelInBody = Object.keys(body).some(k => k.toLowerCase() === delCol.toLowerCase());
      if (!hasDelInBody) {
        const actualDelCol = columns.find(c => c.toLowerCase() === delCol.toLowerCase());
        body[actualDelCol] = delCol === 'Is_Active' || delCol === 'Is_active' ? 'Y' : 'N';
      }
    }

    // Build normalized body with case-insensitive column matching
    const normalizedBody = {};
    for (const key of Object.keys(body)) {
      const matchCol = columns.find(c => c.toLowerCase() === key.toLowerCase());
      if (matchCol) {
        normalizedBody[matchCol] = body[key];
      } else {
        normalizedBody[key] = body[key];
      }
    }

    const insertKeys = Object.keys(normalizedBody).filter(key => columns.includes(key));
    if (insertKeys.length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for creation.' });
    }

    const colNames = insertKeys.map(k => `"${k}"`).join(', ');
    const placeholders = insertKeys.map((_, idx) => `$${idx + 1}`).join(', ');
    const insertVals = insertKeys.map(key => normalizedBody[key]);

    const sql = `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`;
    await db.query(sql, insertVals);
    res.status(201).json({ message: 'Record created successfully.' });
  } catch (error) {
    console.error(`Error inserting into ${tableName}:`, error);
    res.status(500).json({ message: error.message || 'Database error saving record details.' });
  }
});

// PUT update record
router.put('/:table/:id', authMiddleware, async (req, res) => {
  const tableName = getExactTableName(req.params.table);
  const { id } = req.params;
  const body = req.body;
  const { pk } = getTableMeta(tableName);

  try {
    const checkCols = await db.query('SELECT column_name FROM sp_get_table_columns($1)', [tableName]);
    const columns = checkCols.rows.map(r => r.column_name);
    const lowerColumns = columns.map(c => c.toLowerCase());

    // Inject ModifiedDt / ModifiedBy if they exist
    if (lowerColumns.includes('modifieddt')) {
      const colName = columns.find(c => c.toLowerCase() === 'modifieddt');
      body[colName] = new Date().toISOString();
    }
    if (lowerColumns.includes('modifiedby')) {
      const colName = columns.find(c => c.toLowerCase() === 'modifiedby');
      body[colName] = req.user?.empId || 'system';
    }

    const normalizedBody = {};
    for (const key of Object.keys(body)) {
      const matchCol = columns.find(c => c.toLowerCase() === key.toLowerCase());
      if (matchCol) {
        normalizedBody[matchCol] = body[key];
      } else {
        normalizedBody[key] = body[key];
      }
    }

    const actualPk = columns.find(c => c.toLowerCase() === pk.toLowerCase()) || pk;
    const updateKeys = Object.keys(normalizedBody).filter(key => columns.includes(key) && key.toLowerCase() !== actualPk.toLowerCase());

    if (updateKeys.length === 0) {
      return res.status(200).json({ message: 'No fields to update.' });
    }

    const setClauses = updateKeys.map((key, idx) => `"${key}" = $${idx + 1}`);
    const values = updateKeys.map(key => normalizedBody[key]);
    values.push(id);

    const sql = `UPDATE "${tableName}" SET ${setClauses.join(', ')} WHERE "${actualPk}" = $${values.length}`;
    await db.query(sql, values);
    res.status(200).json({ message: 'Record updated successfully.' });
  } catch (error) {
    console.error(`Error updating ${tableName}:`, error);
    res.status(500).json({ message: error.message || 'Database error updating record details.' });
  }
});

// DELETE soft delete or hard delete
router.delete('/:table/:id', authMiddleware, async (req, res) => {
  const tableName = getExactTableName(req.params.table);
  const { id } = req.params;
  const { pk, delCol } = getTableMeta(tableName);

  try {
    const checkCols = await db.query('SELECT column_name FROM sp_get_table_columns($1)', [tableName]);
    const columns = checkCols.rows.map(r => r.column_name);
    const actualPk = columns.find(c => c.toLowerCase() === pk.toLowerCase()) || pk;

    const actualDelCol = delCol && columns.find(c => c.toLowerCase() === delCol.toLowerCase());
    if (actualDelCol) {
      const softVal = actualDelCol.toLowerCase() === 'is_active' ? 'N' : 'Y';
      await db.query(`UPDATE "${tableName}" SET "${actualDelCol}" = $1 WHERE "${actualPk}" = $2`, [softVal, id]);
    } else {
      await db.query(`DELETE FROM "${tableName}" WHERE "${actualPk}" = $1`, [id]);
    }
    res.status(200).json({ message: 'Record deleted successfully.' });
  } catch (error) {
    console.error(`Error deleting from ${tableName}:`, error);
    res.status(500).json({ message: error.message || 'Database error deleting record.' });
  }
});
router.post('/vendor/bulk', authMiddleware, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'No vendor items provided for bulk upload.' });
  }

  const errors = [];
  let successCount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const rowNum = i + 1;
    const plant = String(item.Plant || item.plant_code || item.Plant_Code || item.plant || '').trim();
    const vendorCode = String(item['Vendor Code'] || item.Vendor || item.vendor_code || item.vendor || '').trim();
    const vendorName = String(item['Vendor Name'] || item.Vendor_Name || item.vendor_name || '').trim();

    if (!plant || !vendorCode || !vendorName) {
      errors.push(`Row ${rowNum}: Plant, Vendor Code, and Vendor Name are required.`);
      continue;
    }

    try {
      // Validate plant exists
      const plantCheck = await db.query('SELECT plant_code FROM plant WHERE CAST(plant_code AS VARCHAR) = CAST($1 AS VARCHAR) LIMIT 1', [plant]);
      if (plantCheck.rows.length === 0) {
        errors.push(`Row ${rowNum}: Plant "${plant}" does not exist.`);
        continue;
      }

      // Check duplicate Vendor Code for plant
      const dupCheck = await db.query('SELECT * FROM "VENDOR" WHERE CAST("Plant_Code" AS VARCHAR) = CAST($1 AS VARCHAR) AND UPPER(TRIM("Vendor"::text)) = UPPER(TRIM($2::text)) LIMIT 1', [plant, vendorCode]);
      if (dupCheck.rows.length > 0) {
        errors.push(`Row ${rowNum}: Vendor Code "${vendorCode}" already exists for Plant "${plant}".`);
        continue;
      }

      const maxRes = await db.query('SELECT COALESCE(MAX("Vendor_Id"), 0) + 1 AS next_id FROM "VENDOR"');
      const nextId = maxRes.rows[0].next_id;

      await db.query(
        'INSERT INTO "VENDOR" ("Vendor_Id", "Plant_Code", "Vendor", "Vendor_Name", "Is_Active", "Create_Date") VALUES ($1, $2, $3, $4, true, NOW())',
        [nextId, plant, vendorCode, vendorName]
      );
      successCount++;
    } catch (rowErr) {
      errors.push(`Row ${rowNum}: Database error - ${rowErr.message}`);
    }
  }

  return res.status(200).json({
    message: `Bulk upload completed. ${successCount} vendor(s) uploaded successfully.`,
    successCount,
    errorCount: errors.length,
    errors
  });
});

module.exports = router;
