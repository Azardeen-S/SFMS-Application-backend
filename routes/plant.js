const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');

// GET all plants joined with Mst_Company (including inactive plants for toggle view)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        p.plant_code,
        p.plant_name,
        p.del_status,
        p."Company_Id",
        c."Company_Code"
      FROM plant p
      LEFT JOIN "Mst_Company" c ON p."Company_Id" = c."Company_Id"
      ORDER BY p.plant_name ASC
    `);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching plants:', error);
    res.status(500).json({ message: 'Error retrieving plant data.' });
  }
});

// POST create new plant
router.post('/', authMiddleware, async (req, res) => {
  const { plant_code, plant_name, company_code } = req.body;

  if (!plant_code || !plant_name) {
    return res.status(400).json({ message: 'Plant code and name are required.' });
  }

  try {
    let companyId = null;
    if (company_code) {
      const compRes = await db.query('SELECT "Company_Id" FROM "Mst_Company" WHERE "Company_Code" = $1', [company_code]);
      if (compRes.rows.length > 0) {
        companyId = compRes.rows[0].Company_Id;
      }
    }

    const checkRes = await db.query('SELECT * FROM sp_get_plant_by_code($1)', [plant_code]);
    if (checkRes.rows.length > 0) {
      return res.status(400).json({ message: 'Plant code already exists.' });
    }

    await db.query('INSERT INTO plant (plant_code, plant_name, del_status, "Company_Id", "CreatedDt") VALUES ($1, $2, \'N\', $3, NOW())', [plant_code, plant_name, companyId]);
    res.status(201).json({ message: 'Plant registered successfully.' });
  } catch (error) {
    console.error('Error creating plant:', error);
    res.status(500).json({ message: 'Database error saving plant details.' });
  }
});

// PUT update plant details or toggle status
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { plant_name, del_status } = req.body;

  try {
    if (del_status !== undefined && !plant_name) {
      const statusRes = await db.query('UPDATE plant SET del_status = $2, "ModifiedDt" = NOW() WHERE plant_code = $1', [id, del_status]);
      if (statusRes.rowCount === 0) {
        return res.status(404).json({ message: 'Plant not found.' });
      }
      return res.status(200).json({ message: 'Plant status updated.' });
    }

    if (!plant_name) {
      return res.status(400).json({ message: 'Plant name is required.' });
    }

    const updateRes = await db.query('UPDATE plant SET plant_name = $2, "ModifiedDt" = NOW() WHERE plant_code = $1', [id, plant_name]);

    if (updateRes.rowCount === 0) {
      return res.status(404).json({ message: 'Plant not found.' });
    }

    res.status(200).json({ message: 'Plant updated successfully.' });
  } catch (error) {
    console.error('Error updating plant:', error);
    res.status(500).json({ message: 'Database error updating plant details.' });
  }
});

// DELETE toggle status to Y
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const deleteRes = await db.query('UPDATE plant SET del_status = \'Y\', "ModifiedDt" = NOW() WHERE plant_code = $1', [id]);

    if (deleteRes.rowCount === 0) {
      return res.status(404).json({ message: 'Plant not found.' });
    }

    res.status(200).json({ message: 'Plant status set to Inactive.' });
  } catch (error) {
    console.error('Error deleting plant:', error);
    res.status(500).json({ message: 'Database error updating plant status.' });
  }
});

module.exports = router;
