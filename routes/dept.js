const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const { isCrossCompanyRole } = require('../utils/companyScope');

// GET all departments (all records for status toggle view)
// Only a true cross-company role (Super Admin) sees every department across
// every company - everyone else, including a BU Admin at the primary
// company, is scoped to their own company's departments only.
router.get('/', authMiddleware, async (req, res) => {
  try {
    const params = [];
    let companyFilter = '';
    if (!isCrossCompanyRole(req.user)) {
      companyFilter = 'WHERE p."Company_Id" = (SELECT "Company_Id" FROM "Mst_Company" WHERE "Company_Code" = $1)';
      params.push(req.user.companyCode);
    }

    const { rows } = await db.query(`
      SELECT
        d.dept_id,
        d.dept_name,
        d."Plant_Code" AS plant_code,
        d.del_status,
        COALESCE(p.plant_name, d."Plant_Code") AS plant_name
      FROM "mst_dept" d
      LEFT JOIN "plant" p ON CAST(d."Plant_Code" AS VARCHAR) = CAST(p.plant_code AS VARCHAR)
      ${companyFilter}
      ORDER BY d.dept_name ASC
    `, params);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({ message: 'Error retrieving department data.' });
  }
});

// POST create new department
router.post('/', authMiddleware, async (req, res) => {
  const { dept_name, plant_code } = req.body;

  if (!dept_name || !plant_code) {
    return res.status(400).json({ message: 'Department name and plant code are required.' });
  }

  try {
    const maxRes = await db.query('SELECT COALESCE(MAX(dept_id), 0) + 1 AS next_id FROM "mst_dept"');
    const nextId = maxRes.rows[0].next_id;
    const deptCode = String(nextId);

    await db.query(
      'INSERT INTO "mst_dept" (dept_id, dept_code, dept_name, "Plant_Code", del_status, "CreatedDt") VALUES ($1, $2, $3, $4, \'N\', NOW())',
      [nextId, deptCode, dept_name, plant_code]
    );
    res.status(201).json({ message: 'Department registered successfully.' });
  } catch (error) {
    console.error('Error creating department:', error);
    res.status(500).json({ message: 'Database error saving department details.' });
  }
});

// PUT update department details or toggle status
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { dept_name, plant_code, del_status } = req.body;

  try {
    if (del_status !== undefined && !dept_name) {
      const statusRes = await db.query('UPDATE "mst_dept" SET del_status = $2 WHERE dept_id = $1', [id, del_status]);
      if (statusRes.rowCount === 0) {
        return res.status(404).json({ message: 'Department not found.' });
      }
      return res.status(200).json({ message: 'Department status updated.' });
    }

    if (!dept_name || !plant_code) {
      return res.status(400).json({ message: 'Department name and plant code are required.' });
    }

    const updateRes = await db.query('UPDATE "mst_dept" SET dept_name = $2, "Plant_Code" = $3 WHERE dept_id = $1', [id, dept_name, plant_code]);

    if (updateRes.rowCount === 0) {
      return res.status(404).json({ message: 'Department not found.' });
    }

    res.status(200).json({ message: 'Department updated successfully.' });
  } catch (error) {
    console.error('Error updating department:', error);
    res.status(500).json({ message: 'Database error updating department details.' });
  }
});

// POST bulk-create departments from a parsed spreadsheet - same pattern as
// employee/bulk-upload: the frontend parses the .xlsx client-side and posts
// plain JSON rows here. Restricted to BU Admin only, matching the same
// restriction on employee bulk upload.
router.post('/bulk-upload', authMiddleware, async (req, res) => {
  const role = String(req.user?.role || req.user?.empGroup || '').trim().toLowerCase();
  if (role !== 'bu admin') {
    return res.status(403).json({ message: 'Bulk department upload is restricted to BU Admin.' });
  }

  const { departments } = req.body;
  if (!Array.isArray(departments) || departments.length === 0) {
    return res.status(400).json({ message: 'No department rows provided.' });
  }

  const results = [];
  for (const [index, row] of departments.entries()) {
    const rowNum = index + 2;
    const deptName = String(row.deptName || row.Dept_Name || '').trim();
    const plantCode = String(row.plantCode || row.Plant_Code || '').trim();

    if (!deptName || !plantCode) {
      results.push({ row: rowNum, deptName, success: false, message: 'Dept_Name and Plant_Code are required.' });
      continue;
    }

    try {
      const check = await db.query(
        'SELECT 1 FROM "mst_dept" WHERE LOWER(TRIM(dept_name)) = LOWER(TRIM($1)) AND "Plant_Code" = $2',
        [deptName, plantCode]
      );
      if (check.rows.length > 0) {
        results.push({ row: rowNum, deptName, success: false, message: 'Department already exists for this plant.' });
        continue;
      }

      const maxRes = await db.query('SELECT COALESCE(MAX(dept_id), 0) + 1 AS next_id FROM "mst_dept"');
      const nextId = maxRes.rows[0].next_id;

      await db.query(
        'INSERT INTO "mst_dept" (dept_id, dept_code, dept_name, "Plant_Code", del_status, "CreatedDt") VALUES ($1, $2, $3, $4, \'N\', NOW())',
        [nextId, String(nextId), deptName, plantCode]
      );

      results.push({ row: rowNum, deptName, success: true, message: 'Created' });
    } catch (error) {
      console.error(`Bulk upload row ${rowNum} (${deptName}) failed:`, error.message);
      results.push({ row: rowNum, deptName, success: false, message: error.message || 'Database error.' });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  res.status(200).json({
    message: `${successCount} of ${departments.length} department(s) created successfully.`,
    results,
  });
});

// DELETE soft delete department
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const deleteRes = await db.query('UPDATE "mst_dept" SET del_status = \'Y\' WHERE dept_id = $1', [id]);

    if (deleteRes.rowCount === 0) {
      return res.status(404).json({ message: 'Department not found.' });
    }

    res.status(200).json({ message: 'Department status set to Inactive.' });
  } catch (error) {
    console.error('Error deleting department:', error);
    res.status(500).json({ message: 'Database error deleting department.' });
  }
});

module.exports = router;
