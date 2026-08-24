const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');

// GET all employees with join to plant and dept (including inactive for toggle view)
router.get('/', authMiddleware, async (req, res) => {
  try {
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
      LEFT JOIN "mst_dept" d ON (e."Dept" ~ '^[0-9]+$' AND e."Dept"::bigint = d.dept_id)
      ORDER BY e."Emp_Name" ASC
    `);
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
  const { empName, dept, designation, mailId, mobileNo, isAdmin, password, plantCode, del_status } = req.body;

  try {
    if (del_status !== undefined && !empName) {
      const statusRes = await db.query('UPDATE "Mst_Employee" SET "Del_Status" = $2 WHERE "Emp_Id" = $1', [id, del_status]);
      if (statusRes.rowCount === 0) {
        return res.status(404).json({ message: 'Employee not found.' });
      }
      return res.status(200).json({ message: 'Employee status updated.' });
    }

    const updateRes = await db.query('SELECT sp_update_employee($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
      id, empName, dept, designation, mailId, mobileNo, isAdmin ? 1 : 0, password, plantCode
    ]);

    // Ensure User_Name = empName in DB
    await db.query('UPDATE "Mst_Employee" SET "User_Name" = $2 WHERE "Emp_Id" = $1', [id, empName]);

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
    res.status(200).json({ message: 'Employee status set to Inactive.' });
  } catch (error) {
    console.error('Error deleting employee:', error);
    res.status(500).json({ message: 'Database error deleting employee.' });
  }
});

module.exports = router;
