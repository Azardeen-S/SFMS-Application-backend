const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const { isCrossCompanyRole } = require('../utils/companyScope');

// GET all employees with join to plant and dept (including inactive for toggle view)
// Only a true cross-company role (Super Admin) sees every employee across
// every company - everyone else, including a BU Admin at the primary company,
// is scoped to their own company's employees only.
router.get('/', authMiddleware, async (req, res) => {
  try {
    const params = [];
    let companyFilter = '';
    if (!isCrossCompanyRole(req.user)) {
      companyFilter = 'WHERE e."company_code" = $1';
      params.push(req.user.companyCode);
    }

    const { rows } = await db.query(`
      SELECT
        e."Emp_Id" AS emp_id,
        TRIM(e."Emp_No") AS emp_no,
        e."Emp_Name" AS emp_name,
        CASE
          WHEN e."User_Name" IS NULL
            OR TRIM(e."User_Name") = ''
            OR UPPER(TRIM(e."User_Name")) = 'NULL'
            OR TRIM(e."User_Name") = '-'
          THEN TRIM(e."Emp_No")
          ELSE TRIM(e."User_Name")
        END AS username,
        e."Dept" AS dept,
        e."Designation" AS designation,
        e."Mail_Id" AS mail_id,
        e."Mobile_No" AS mobile_no,
        e.emp_group,
        e.emp_level,
        e.is_admin,
        e."Plant_Code" AS plant_code,
        e."Del_Status" AS del_status,
        COALESCE(p.plant_name, e."Plant_Code") AS plant_name,
        COALESCE(d.dept_name, e."Dept"::varchar) AS dept_name
      FROM "Mst_Employee" e
      LEFT JOIN "plant" p ON CAST(e."Plant_Code" AS VARCHAR) = CAST(p.plant_code AS VARCHAR)
      -- CASE guarantees the cast only runs when Dept is actually numeric - unlike
      -- "regex AND cast", which Postgres does NOT guarantee to short-circuit and
      -- which 500s this whole endpoint the moment any employee has a non-numeric
      -- (or empty/NULL) Dept value.
      LEFT JOIN "mst_dept" d ON d.dept_id = (CASE WHEN e."Dept" ~ '^[0-9]+$' THEN e."Dept"::bigint ELSE NULL END)
      ${companyFilter}
      ORDER BY e."Emp_Name" ASC
    `, params);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ message: 'Error retrieving employee data.' });
  }
});

// POST create new employee
router.post('/', authMiddleware, async (req, res) => {
  const { 
    empNo, empName, dept, designation, mailId, mobileNo, isAdmin, password, plantCode,
    empGroup, typeCode, empLevel, companyCode, accessVisit, master
  } = req.body;

  if (!empNo || !empName || !plantCode) {
    return res.status(400).json({ message: 'Employee number, name, and plant code are required.' });
  }

  try {
    const check = await db.query('SELECT * FROM "Mst_Employee" WHERE LOWER(TRIM("Emp_No")) = LOWER(TRIM($1))', [empNo]);
    if (check.rows.length > 0) {
      return res.status(400).json({ message: 'Employee number already registered.' });
    }

    const maxRes = await db.query('SELECT COALESCE(MAX("Emp_Id"), 0) + 1 AS next_id FROM "Mst_Employee"');
    const nextId = maxRes.rows[0].next_id;

    await db.query(`
      INSERT INTO "Mst_Employee" (
        "Emp_Id", "Emp_No", "Emp_Name", "Dept", "Designation", "Mail_Id", "Mobile_No",
        "is_admin", "Password", "pwd", "Plant_Code", "Del_Status", "User_Name", "CreatedDt",
        "emp_group", "Type_Code", "emp_level", "company_code", "access_visit", "master"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $9, $10, 'N', $3, NOW(),
        $11, $12, $13, $14, $15, $16
      )
    `, [
      nextId, empNo, empName, dept, designation, mailId, mobileNo,
      isAdmin ? 1 : 0, password, plantCode,
      empGroup || '1', typeCode ? parseInt(typeCode, 10) || null : null, empLevel || 'Level1', companyCode,
      accessVisit ? 1 : 0, master ? 1 : 0
    ]);

    res.status(201).json({ message: 'Employee profile created successfully.' });
  } catch (error) {
    console.error('Error creating employee:', error);
    res.status(500).json({ message: 'Database error saving employee profile.' });
  }
});

// PUT update employee details or toggle status
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { empName, dept, designation, mailId, mobileNo, isAdmin, password, plantCode, del_status, empGroup } = req.body;

  try {
    if (del_status !== undefined && !empName) {
      const statusRes = await db.query('UPDATE "Mst_Employee" SET "Del_Status" = $2 WHERE "Emp_Id" = $1', [id, del_status]);
      if (statusRes.rowCount === 0) {
        return res.status(404).json({ message: 'Employee not found.' });
      }
      // Cascade to SMS settings: an employee marked inactive here should stop
      // receiving SMS alerts, and should show as inactive in the SMS Settings
      // list rather than just vanishing from it. Only cascades the inactive
      // direction (reactivating the employee does not auto-reactivate their
      // SMS settings) - Emp_Id is stored as text in Mst_Empl_SMSSetting.
      if (String(del_status).toUpperCase() !== 'N') {
        await db.query(
          'UPDATE "Mst_Empl_SMSSetting" SET "Del_Status" = \'Y\' WHERE "Emp_Id"::text = $1::text',
          [id]
        );
      }
      return res.status(200).json({ message: 'Employee status updated.' });
    }

    const updateRes = await db.query('SELECT sp_update_employee($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
      id, empName, dept, designation, mailId, mobileNo, isAdmin ? 1 : 0, password, plantCode
    ]);

    // Ensure User_Name = empName in DB
    await db.query('UPDATE "Mst_Employee" SET "User_Name" = $2 WHERE "Emp_Id" = $1', [id, empName]);

    if (empGroup !== undefined) {
      await db.query('UPDATE "Mst_Employee" SET "emp_group" = $2 WHERE "Emp_Id" = $1', [id, empGroup]);
    }

    if (updateRes.rowCount === 0) {
      return res.status(404).json({ message: 'Employee not found.' });
    }
    res.status(200).json({ message: 'Employee profile updated successfully.' });
  } catch (error) {
    console.error('Error updating employee:', error);
    res.status(500).json({ message: 'Database error updating employee.' });
  }
});


// DELETE toggle soft delete employee
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const del = await db.query('UPDATE "Mst_Employee" SET "Del_Status" = \'Y\' WHERE "Emp_Id" = $1', [id]);
    if (del.rowCount === 0) return res.status(404).json({ message: 'Employee not found.' });
    // Same cascade as the PUT status-toggle above.
    await db.query(
      'UPDATE "Mst_Empl_SMSSetting" SET "Del_Status" = \'Y\' WHERE "Emp_Id"::text = $1::text',
      [id]
    );
    res.status(200).json({ message: 'Employee status set to Inactive.' });
  } catch (error) {
    console.error('Error deleting employee:', error);
    res.status(500).json({ message: 'Database error deleting employee.' });
  }
});

// POST bulk-create employees from a parsed spreadsheet (the frontend reads
// the .xlsx client-side with the same "xlsx" library it already uses for
// exports, and posts the parsed rows here as plain JSON - no file upload
// handling needed on this side). Restricted to BU Admin only, per request -
// a company-scoped full admin bulk-loading their own company's employees.
router.post('/bulk-upload', authMiddleware, async (req, res) => {
  const role = String(req.user?.role || req.user?.empGroup || '').trim().toLowerCase();
  if (role !== 'bu admin') {
    return res.status(403).json({ message: 'Bulk employee upload is restricted to BU Admin.' });
  }

  const { employees } = req.body;
  if (!Array.isArray(employees) || employees.length === 0) {
    return res.status(400).json({ message: 'No employee rows provided.' });
  }

  const results = [];
  for (const [index, row] of employees.entries()) {
    const rowNum = index + 2; // +2: header row + 1-based
    const empNo = String(row.empNo || row.Emp_No || '').trim();
    const empName = String(row.empName || row.Emp_Name || '').trim();
    const plantCode = String(row.plantCode || row.Plant_Code || '').trim();

    if (!empNo || !empName || !plantCode) {
      results.push({ row: rowNum, empNo, success: false, message: 'Emp_No, Emp_Name, and Plant_Code are required.' });
      continue;
    }

    try {
      const check = await db.query('SELECT 1 FROM "Mst_Employee" WHERE LOWER(TRIM("Emp_No")) = LOWER(TRIM($1))', [empNo]);
      if (check.rows.length > 0) {
        results.push({ row: rowNum, empNo, success: false, message: 'Employee number already registered.' });
        continue;
      }

      const designation = row.designation || row.Designation || null;
      const mailId = row.mailId || row.Mail_Id || null;
      const mobileNo = row.mobileNo || row.Mobile_No ? String(row.mobileNo || row.Mobile_No) : null;
      const password = row.password || row.Password || 'Welcome@123';
      const empGroup = String(row.empGroup || row.Emp_Group || 'Plant Admin').trim();
      const companyCode = row.companyCode || row.Company_Code || null;
      const isAdmin = empGroup.toLowerCase() === 'super admin' || empGroup.toLowerCase() === 'bu admin';

      // Department is entered by NAME in the template (dept_id is an internal
      // auto-generated PK nobody should have to look up first) - resolve it
      // to the actual dept_id for this row's plant.
      const deptName = String(row.dept || row.Dept || row.deptName || row.Dept_Name || '').trim();
      let dept = null;
      if (deptName) {
        const deptRes = await db.query(
          'SELECT dept_id FROM "mst_dept" WHERE LOWER(TRIM(dept_name)) = LOWER(TRIM($1)) AND "Plant_Code" = $2 LIMIT 1',
          [deptName, plantCode]
        );
        if (deptRes.rows.length === 0) {
          results.push({ row: rowNum, empNo, success: false, message: `Department "${deptName}" not found for plant ${plantCode}.` });
          continue;
        }
        dept = deptRes.rows[0].dept_id;
      }

      const maxRes = await db.query('SELECT COALESCE(MAX("Emp_Id"), 0) + 1 AS next_id FROM "Mst_Employee"');
      const nextId = maxRes.rows[0].next_id;

      await db.query(`
        INSERT INTO "Mst_Employee" (
          "Emp_Id", "Emp_No", "Emp_Name", "Dept", "Designation", "Mail_Id", "Mobile_No",
          "is_admin", "Password", "pwd", "Plant_Code", "Del_Status", "User_Name", "CreatedDt",
          "emp_group", "company_code"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $9, $10, 'N', $3, NOW(),
          $11, $12
        )
      `, [nextId, empNo, empName, dept, designation, mailId, mobileNo, isAdmin ? 1 : 0, password, plantCode, empGroup, companyCode]);

      results.push({ row: rowNum, empNo, success: true, message: 'Created' });
    } catch (error) {
      console.error(`Bulk upload row ${rowNum} (${empNo}) failed:`, error.message);
      results.push({ row: rowNum, empNo, success: false, message: error.message || 'Database error.' });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  res.status(200).json({
    message: `${successCount} of ${employees.length} employee(s) created successfully.`,
    results,
  });
});

module.exports = router;
