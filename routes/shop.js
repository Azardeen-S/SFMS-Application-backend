const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');

// GET all shops (including inactive for master table toggle)
router.get('/', authMiddleware, async (req, res) => {
  const { plantCode } = req.query;
  try {
    const { rows } = await db.query(`
      SELECT 
        s."Shop_code" AS shop_code,
        s."Shop_Name" AS shop_name,
        s."Plant_Code" AS plant_code,
        s."Del_Status" AS del_status,
        p.plant_name
      FROM "Mst_Shop" s
      LEFT JOIN "plant" p ON s."Plant_Code" = p.plant_code
      ORDER BY s."Shop_Name" ASC
    `);
    let data = rows;
    if (plantCode) {
      data = data.filter(s => String(s.plant_code) === String(plantCode));
    }
    res.status(200).json(data);
  } catch (error) {
    console.error('Error fetching shops:', error);
    res.status(500).json({ message: 'Error retrieving shop data.' });
  }
});

// POST create shop
router.post('/', authMiddleware, async (req, res) => {
  const { shop_code, shop_name, plant_code } = req.body;
  if (!shop_code || !shop_name || !plant_code) {
    return res.status(400).json({ message: 'Shop code, name, and plant code are required.' });
  }
  try {
    const check = await db.query('SELECT * FROM sp_get_shop_by_code($1)', [shop_code]);
    if (check.rows.length > 0) {
      if (check.rows[0].del_status === 'Y') {
        await db.query('SELECT sp_reactivate_shop($1, $2, $3)', [shop_code, shop_name, plant_code]);
        return res.status(200).json({ message: 'Shop reactivated successfully.' });
      }
      return res.status(400).json({ message: 'Shop code already exists.' });
    }

    await db.query('SELECT sp_create_shop($1, $2, $3)', [shop_code, shop_name, plant_code]);
    res.status(201).json({ message: 'Shop created successfully.' });
  } catch (error) {
    console.error('Error creating shop:', error);
    res.status(500).json({ message: 'Database error saving shop.' });
  }
});

// PUT update shop
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { shop_name, plant_code, del_status } = req.body;
  try {
    if (del_status !== undefined) {
      await db.query('UPDATE "Mst_Shop" SET "Del_Status" = $1 WHERE TRIM("Shop_code"::text) = TRIM($2::text)', [del_status, id]);
      return res.status(200).json({ message: 'Shop status updated successfully.' });
    }
    await db.query('UPDATE "Mst_Shop" SET "Shop_Name" = $1, "Plant_Code" = $2, "ModifiedDt" = NOW() WHERE TRIM("Shop_code"::text) = TRIM($3::text)', [shop_name, plant_code, id]);
    res.status(200).json({ message: 'Shop updated successfully.' });
  } catch (error) {
    console.error('Error updating shop:', error);
    res.status(500).json({ message: 'Database error updating shop.' });
  }
});

// DELETE soft delete shop
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const del = await db.query('SELECT sp_delete_shop($1)', [id]);
    if (del.rowCount === 0) return res.status(404).json({ message: 'Shop not found.' });
    res.status(200).json({ message: 'Shop removed successfully.' });
  } catch (error) {
    console.error('Error deleting shop:', error);
    res.status(500).json({ message: 'Database error deleting shop.' });
  }
});

module.exports = router;
