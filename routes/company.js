const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');

// GET all companies (active + inactive)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM "Mst_Company" ORDER BY "Company_Code" ASC');
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({ message: 'Error retrieving company data.' });
  }
});

// POST create new company
router.post('/', authMiddleware, async (req, res) => {
  const { Company_Code, Company_Name, Company_Short_Name } = req.body;

  if (!Company_Code || !Company_Name) {
    return res.status(400).json({ message: 'Company Code and Company Name are required.' });
  }

  const shortName = Company_Short_Name || Company_Name;

  try {
    // 1. Check duplicate Company Code
    const codeCheck = await db.query('SELECT * FROM "Mst_Company" WHERE LOWER(TRIM("Company_Code")) = LOWER(TRIM($1))', [Company_Code]);
    if (codeCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Company Code already exists.' });
    }

    // 2. Check duplicate Company Full Name
    const nameCheck = await db.query('SELECT * FROM "Mst_Company" WHERE LOWER(TRIM("Company_Name")) = LOWER(TRIM($1))', [Company_Name]);
    if (nameCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Company Full Name already exists.' });
    }

    // 3. Check duplicate Company Short Name
    const shortCheck = await db.query('SELECT * FROM "Mst_Company" WHERE LOWER(TRIM("Company_Short_Name")) = LOWER(TRIM($1))', [shortName]);
    if (shortCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Company Short Name already exists.' });
    }

    // Generate next Company_Id since Company_Id has no sequence default in database schema
    const maxRes = await db.query('SELECT COALESCE(MAX("Company_Id"), 0) + 1 AS next_id FROM "Mst_Company"');
    const nextId = maxRes.rows[0].next_id;

    await db.query('INSERT INTO "Mst_Company" ("Company_Id", "Company_Code", "Company_Name", "Company_Short_Name", "Is_active") VALUES ($1, $2, $3, $4, true)', [nextId, Company_Code, Company_Name, shortName]);
    res.status(201).json({ message: 'Company created successfully.' });
  } catch (error) {
    console.error('Error creating company:', error);
    res.status(500).json({ message: 'Database error saving company details.' });
  }
});

// PUT update company details or status
router.put('/:code', authMiddleware, async (req, res) => {
  const { code } = req.params;
  const { Company_Name, Company_Short_Name, Is_active } = req.body;

  try {
    // If updating Is_active status only
    if (Is_active !== undefined && !Company_Name) {
      const statusRes = await db.query('UPDATE "Mst_Company" SET "Is_active" = $2 WHERE "Company_Code" = $1', [code, Is_active]);
      if (statusRes.rowCount === 0) {
        return res.status(404).json({ message: 'Company not found.' });
      }
      return res.status(200).json({ message: `Company status updated to ${Is_active ? 'Active' : 'Inactive'}.` });
    }

    if (!Company_Name) {
      return res.status(400).json({ message: 'Company Name is required.' });
    }

    const shortName = Company_Short_Name || Company_Name;

    // Check duplicate Company Full Name for another company
    const nameCheck = await db.query('SELECT * FROM "Mst_Company" WHERE LOWER(TRIM("Company_Name")) = LOWER(TRIM($1)) AND "Company_Code" <> $2', [Company_Name, code]);
    if (nameCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Company Full Name already exists for another company.' });
    }

    // Check duplicate Company Short Name for another company
    const shortCheck = await db.query('SELECT * FROM "Mst_Company" WHERE LOWER(TRIM("Company_Short_Name")) = LOWER(TRIM($1)) AND "Company_Code" <> $2', [shortName, code]);
    if (shortCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Company Short Name already exists for another company.' });
    }

    const activeStatus = Is_active !== undefined ? Is_active : true;
    const updateRes = await db.query('UPDATE "Mst_Company" SET "Company_Name" = $2, "Company_Short_Name" = $3, "Is_active" = $4 WHERE "Company_Code" = $1', [code, Company_Name, shortName, activeStatus]);

    if (updateRes.rowCount === 0) {
      return res.status(404).json({ message: 'Company not found.' });
    }

    res.status(200).json({ message: 'Company updated successfully.' });
  } catch (error) {
    console.error('Error updating company:', error);
    res.status(500).json({ message: 'Database error updating company details.' });
  }
});

// DELETE toggle / soft delete company
router.delete('/:code', authMiddleware, async (req, res) => {
  const { code } = req.params;

  try {
    const deleteRes = await db.query('UPDATE "Mst_Company" SET "Is_active" = false WHERE "Company_Code" = $1', [code]);

    if (deleteRes.rowCount === 0) {
      return res.status(404).json({ message: 'Company not found.' });
    }

    res.status(200).json({ message: 'Company status set to Inactive.' });
  } catch (error) {
    console.error('Error deleting company:', error);
    res.status(500).json({ message: 'Database error updating company status.' });
  }
});

module.exports = router;
