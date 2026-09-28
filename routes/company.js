const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const { isMasterCompanyUser, isCrossCompanyRole } = require('../utils/companyScope');

// Company Master manages every tenant's company record, so only the primary
// company's (RML-SLD) users may access it - other companies' admins must not
// be able to see or edit it, even by calling the API directly.
function requireMasterCompany(req, res, next) {
  if (!isMasterCompanyUser(req.user)) {
    return res.status(403).json({ message: 'Company Master is restricted to the primary company administrators.' });
  }
  next();
}

// GET all companies (active + inactive).
// Only a true cross-company role (Super Admin) sees every tenant - everyone
// else, including a BU Admin whose own employee record happens to belong to
// the primary/master company, only ever sees their own company's row (not
// blocked outright, so it stays safe for any screen that just needs "my
// company" - e.g. a dropdown - without tripping a frontend auto-logout on a 403).
router.get('/', authMiddleware, async (req, res) => {
  try {
    if (isCrossCompanyRole(req.user)) {
      const { rows } = await db.query('SELECT * FROM "Mst_Company" ORDER BY "Company_Code" ASC');
      return res.status(200).json(rows);
    }
    const { rows } = await db.query('SELECT * FROM "Mst_Company" WHERE "Company_Code" = $1', [req.user.companyCode]);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({ message: 'Error retrieving company data.' });
  }
});

// POST create new company
router.post('/', authMiddleware, requireMasterCompany, async (req, res) => {
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

    // plant.plant_code / Mst_Employee.Plant_Code are varchar(5), so the default HQ
    // plant code must be derived, not just "<Company_Code>-HQ" (overflows for any
    // Company_Code longer than ~2 chars and throws a DB error on save).
    const codeBase = String(Company_Code).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 3) || 'PLT';
    let defaultPlantCode = `${codeBase}HQ`.slice(0, 5);
    for (let suffix = 1; suffix <= 9; suffix++) {
      const existing = await db.query('SELECT 1 FROM plant WHERE plant_code = $1', [defaultPlantCode]);
      if (existing.rows.length === 0) break;
      defaultPlantCode = `${codeBase.slice(0, 4)}${suffix}`.slice(0, 5);
    }

    const defaultAdminEmpNo = `${Company_Code}ADMIN`;
    const DEFAULT_ADMIN_PASSWORD = 'password@123';

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'INSERT INTO "Mst_Company" ("Company_Id", "Company_Code", "Company_Name", "Company_Short_Name", "Is_active") VALUES ($1, $2, $3, $4, true)',
        [nextId, Company_Code, Company_Name, shortName]
      );

      // Auto-create a default HQ plant so the new company's Super Admin has a Plant_Code to log in under
      await client.query(
        'INSERT INTO plant (plant_code, plant_name, del_status, "Company_Id", "CreatedDt") VALUES ($1, $2, \'N\', $3, NOW())',
        [defaultPlantCode, `${shortName} HQ`, nextId]
      );

      // Auto-create a company-scoped admin login for this company with a
      // default password that must be changed on first login. This role is
      // company-scoped (not cross-company), which is the "BU Admin" label
      // after the Super Admin / BU Admin name swap - see 01_migration.sql.
      const empIdRes = await client.query('SELECT COALESCE(MAX("Emp_Id"), 0) + 1 AS next_id FROM "Mst_Employee"');
      const nextEmpId = empIdRes.rows[0].next_id;

      await client.query(`
        INSERT INTO "Mst_Employee" (
          "Emp_Id", "Emp_No", "Emp_Name", "Dept", "Designation", "Mail_Id", "Mobile_No",
          "is_admin", "Password", "pwd", "Plant_Code", "Del_Status", "User_Name", "CreatedDt",
          "emp_group", "company_code", "must_change_password"
        ) VALUES (
          $1, $2, $3, NULL, 'BU Admin', NULL, NULL,
          1, $4, $4, $5, 'N', $3, NOW(),
          'BU Admin', $6, true
        )
      `, [nextEmpId, defaultAdminEmpNo, 'BU Admin', DEFAULT_ADMIN_PASSWORD, defaultPlantCode, Company_Code]);

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.status(201).json({
      message: 'Company created successfully.',
      defaultAdmin: {
        username: defaultAdminEmpNo,
        password: DEFAULT_ADMIN_PASSWORD,
        plantCode: defaultPlantCode,
      },
    });
  } catch (error) {
    console.error('Error creating company:', error);
    res.status(500).json({ message: 'Database error saving company details.' });
  }
});

// PUT update company details or status
router.put('/:code', authMiddleware, requireMasterCompany, async (req, res) => {
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
router.delete('/:code', authMiddleware, requireMasterCompany, async (req, res) => {
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
