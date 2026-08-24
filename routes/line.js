const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');

// GET all lines (including inactive for master table toggle)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        l."Line_code" AS line_code,
        l."Line_Name" AS line_name,
        l."Plant_code" AS plant_code,
        l."Shop_code" AS shop_code,
        l."Module_code" AS module_code,
        l."Del_Status" AS del_status,
        p.plant_name,
        s."Shop_Name" AS shop_name,
        m."Module_Name" AS module_name
      FROM "Mst_Line" l
      LEFT JOIN "plant" p ON l."Plant_code" = p.plant_code
      LEFT JOIN "Mst_Shop" s ON CAST(l."Shop_code" AS VARCHAR) = CAST(s."Shop_code" AS VARCHAR) AND l."Plant_code" = s."Plant_Code"
      LEFT JOIN "Mst_Module" m ON CAST(l."Module_code" AS VARCHAR) = CAST(m."Module_Code" AS VARCHAR) AND l."Plant_code" = m."Plant_code"
      ORDER BY l."Line_Name" ASC
    `);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching lines:', error);
    res.status(500).json({ message: 'Error retrieving line data.' });
  }
});

// POST create line
router.post('/', authMiddleware, async (req, res) => {
  let { line_code, line_name, plant_code, shop_code, module_code } = req.body;
  if (!line_name || !plant_code) {
    return res.status(400).json({ message: 'Line name and plant code are required.' });
  }
  try {
    if (!line_code) {
      const maxRes = await db.query('SELECT COALESCE(MAX(CASE WHEN "Line_code" ~ \'^[0-9]+$\' THEN "Line_code"::bigint ELSE 0 END), 0) + 1 AS next_code FROM "Mst_Line"');
      line_code = String(maxRes.rows[0].next_code);
    }

    const check = await db.query('SELECT * FROM sp_get_line_by_code($1)', [line_code]);
    if (check.rows.length > 0) {
      if (check.rows[0].del_status === 'Y') {
        await db.query('SELECT sp_reactivate_line($1, $2, $3, $4, $5)', [line_code, line_name, plant_code, shop_code, module_code]);
        return res.status(200).json({ message: 'Line reactivated successfully.' });
      }
      return res.status(400).json({ message: 'Line code already exists.' });
    }

    await db.query('SELECT sp_create_line($1, $2, $3, $4, $5)', [line_code, line_name, plant_code, shop_code, module_code]);
    res.status(201).json({ message: 'Production line created successfully.' });
  } catch (error) {
    console.error('Error creating line:', error);
    res.status(500).json({ message: 'Database error saving production line.' });
  }
});

// PUT update line
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { line_name, plant_code, shop_code, module_code, del_status } = req.body;
  try {
    if (del_status !== undefined) {
      await db.query('UPDATE "Mst_Line" SET "Del_Status" = $1 WHERE TRIM("Line_code"::text) = TRIM($2::text)', [del_status, id]);
      return res.status(200).json({ message: 'Line status updated successfully.' });
    }
    await db.query('UPDATE "Mst_Line" SET "Line_Name" = $1, "Plant_code" = $2, "Shop_code" = $3, "Module_code" = $4, "ModifiedDt" = NOW() WHERE TRIM("Line_code"::text) = TRIM($5::text)', [line_name, plant_code, shop_code, module_code, id]);
    res.status(200).json({ message: 'Production line updated successfully.' });
  } catch (error) {
    console.error('Error updating line:', error);
    res.status(500).json({ message: 'Database error updating production line.' });
  }
});

// DELETE soft delete line
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const del = await db.query('SELECT sp_delete_line($1)', [id]);
    if (del.rowCount === 0) return res.status(404).json({ message: 'Line not found.' });
    res.status(200).json({ message: 'Production line removed successfully.' });
  } catch (error) {
    console.error('Error deleting line:', error);
    res.status(500).json({ message: 'Database error deleting production line.' });
  }
});

module.exports = router;
