const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');

// GET all departments (all records for status toggle view)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        d.dept_id,
        d.dept_name,
        d."Plant_Code" AS plant_code,
        d.del_status,
        COALESCE(p.plant_name, d."Plant_Code") AS plant_name
      FROM "mst_dept" d
      LEFT JOIN "plant" p ON CAST(d."Plant_Code" AS VARCHAR) = CAST(p.plant_code AS VARCHAR)
      ORDER BY d.dept_name ASC
    `);
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
