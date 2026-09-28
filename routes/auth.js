const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { generateToken } = require('../utils/jwtHelper');
const { authenticateAD } = require('../utils/adAuth');
const { isCrossCompanyRole } = require('../utils/companyScope');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  const cleanUsername = String(username).trim();
  const empCode = cleanUsername.includes('@') ? cleanUsername.split('@')[0] : cleanUsername;
  const isAdEnabled = String(process.env.ENABLE_AD_AUTH || 'true').toLowerCase() === 'true';

  try {
    // Auto-generated company admin logins (Emp_No = "<Company_Code>ADMIN",
    // created in routes/company.js) only exist in SFMS, never in AD - skip AD
    // entirely for them and go straight to local password auth below.
    // (Role names were swapped: this checked emp_group = 'Super Admin'
    // before - see 01_migration.sql's role-swap section. These accounts are
    // company-scoped, which is now the "BU Admin" label.)
    const autoAdminCheck = await db.query(
      `SELECT 1 FROM "Mst_Employee"
       WHERE TRIM("Emp_No") = TRIM($1) AND "emp_group" = 'BU Admin' AND "company_code" IS NOT NULL
         AND UPPER(TRIM("Emp_No")) = UPPER(TRIM("company_code")) || 'ADMIN'
       LIMIT 1`,
      [empCode]
    );
    const isAutoCompanyAdmin = autoAdminCheck.rows.length > 0;

    let adAuthenticated = false;

    if (isAdEnabled && !isAutoCompanyAdmin) {
      const adResult = await authenticateAD(cleanUsername, password);

      if (adResult.authenticated) {
        adAuthenticated = true;
      } else {
        // If AD authentication failed, check if user exists in DB for emergency fallback
        console.warn(`AD authentication failed for user: ${cleanUsername}. Checking local fallback...`);
      }
    }

    let rows = [];

    if (adAuthenticated) {
      // Fetch employee profile from Mst_Employee matching Emp_No
      const dbRes = await db.query(
        'SELECT * FROM "Mst_Employee" WHERE TRIM("Emp_No") = TRIM($1) AND ("Del_Status" = \'N\' OR "Del_Status" IS NULL) LIMIT 1',
        [empCode]
      );
      rows = dbRes.rows;

      if (rows.length === 0) {
        // Retry with sp_authenticate_user or broader search
        const spRes = await db.query('SELECT * FROM "Mst_Employee" WHERE LOWER(TRIM("Emp_No")) = LOWER(TRIM($1)) LIMIT 1', [empCode]);
        rows = spRes.rows;
      }

      if (rows.length === 0) {
        return res.status(401).json({
          message: 'Active Directory authentication succeeded, but employee record was not found in SFMS database.'
        });
      }
    } else {
      // Local Database Password authentication (Fallback or when AD is disabled)
      const dbRes = await db.query(
        'SELECT * FROM "Mst_Employee" WHERE TRIM("Emp_No") = TRIM($1) AND ("Password" = $2 OR "pwd" = $2) AND ("Del_Status" = \'N\' OR "Del_Status" IS NULL) LIMIT 1',
        [empCode, password]
      );
      rows = dbRes.rows;

      if (rows.length === 0) {
        // Fallback to sp_authenticate_user with Emp_No check
        const spRes = await db.query('SELECT * FROM sp_authenticate_user($1, $2)', [empCode, password]);
        rows = spRes.rows;
      }

      if (rows.length === 0) {
        return res.status(401).json({ message: 'Invalid EMP Code or password.' });
      }
    }

    const employee = rows[0];

    let plantName = '';
    if (employee.Plant_Code) {
      try {
        const pRes = await db.query('SELECT plant_name FROM plant WHERE CAST(plant_code AS VARCHAR) = CAST($1 AS VARCHAR) LIMIT 1', [employee.Plant_Code]);
        if (pRes.rows.length > 0) {
          plantName = pRes.rows[0].plant_name;
        }
      } catch (pErr) {
        console.warn('Could not fetch plant_name for login user:', pErr.message);
      }
    }

    let companyShortName = '';
    let companyName = '';
    try {
      // Prefer the company tied to the employee's plant (authoritative for regular
      // employees); fall back to Mst_Employee.company_code (set on auto-provisioned
      // company Super Admins, which have no other employees' plant to join through).
      const cRes = await db.query(
        `SELECT c."Company_Name", c."Company_Short_Name"
         FROM "Mst_Company" c
         LEFT JOIN plant p ON p."Company_Id" = c."Company_Id"
         WHERE CAST(p.plant_code AS VARCHAR) = CAST($1 AS VARCHAR) OR c."Company_Code" = $2
         LIMIT 1`,
        [employee.Plant_Code, employee.company_code]
      );
      if (cRes.rows.length > 0) {
        companyName = cRes.rows[0].Company_Name;
        companyShortName = cRes.rows[0].Company_Short_Name || cRes.rows[0].Company_Name;
      }
    } catch (cErr) {
      console.warn('Could not fetch company name for login user:', cErr.message);
    }

    // Blank emp_group + is_admin=1 defaults to the safer, company-scoped
    // admin tier (now labeled "BU Admin" - role names were swapped, see
    // 01_migration.sql), never to the cross-company "Super Admin" tier -
    // that must be explicitly set via emp_group.
    const empGroup = employee.emp_group || (Number(employee.is_admin) === 1 ? 'BU Admin' : 'Plant Admin');
    // Super Admin has no plant/company restriction at all - show that in the
    // token rather than whatever incidental Plant_Code/company_code happens
    // to be on their employee record, which the frontend header displays as-is.
    const isCrossCompany = isCrossCompanyRole({ role: empGroup, empGroup });

    const payload = {
      empId: employee.Emp_Id,
      empNo: employee.Emp_No,
      empName: employee.Emp_Name,
      username: employee.User_Name || employee.Emp_No,
      plantCode: isCrossCompany ? 'Global' : employee.Plant_Code,
      plantName: isCrossCompany ? 'Global' : plantName,
      companyCode: employee.company_code || null,
      companyName: isCrossCompany ? 'All Companies' : companyName,
      companyShortName: isCrossCompany ? 'Global' : companyShortName,
      // The cross-company role (Super Admin) always presents as admin,
      // regardless of the raw is_admin column on the employee row - it's the
      // top-level, unrestricted role and must never be gated out by an
      // isAdmin===1 check.
      isAdmin: isCrossCompany ? 1 : Number(employee.is_admin || 0),
      empGroup: empGroup,
      role: empGroup,
      mustChangePassword: employee.must_change_password === true,
    };

    const token = generateToken(payload);

    return res.status(200).json({
      message: 'Authenticated successfully',
      token: token,
      user: payload,
      data: payload
    });
  } catch (error) {
    console.error('Login router error:', error);
    return res.status(500).json({ message: 'Authentication error during login.' });
  }
});

// PUT change password (used both for the forced first-login change and voluntary changes)
router.put('/change-password', async (req, res) => {
  const { empNo, oldPassword, newPassword } = req.body;

  if (!empNo || !oldPassword || !newPassword) {
    return res.status(400).json({ message: 'Employee number, current password, and new password are required.' });
  }

  const pwd = String(newPassword);
  const meetsPolicy =
    pwd.length >= 8 &&
    /[a-zA-Z]/.test(pwd) &&
    /[0-9]/.test(pwd) &&
    /[^a-zA-Z0-9]/.test(pwd);

  if (!meetsPolicy) {
    return res.status(400).json({
      message: 'New password must be at least 8 characters and include letters, numbers, and a special character.',
    });
  }

  try {
    const empRes = await db.query(
      'SELECT * FROM "Mst_Employee" WHERE TRIM("Emp_No") = TRIM($1) AND ("Password" = $2 OR "pwd" = $2) AND ("Del_Status" = \'N\' OR "Del_Status" IS NULL) LIMIT 1',
      [empNo, oldPassword]
    );

    if (empRes.rows.length === 0) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }

    await db.query(
      'UPDATE "Mst_Employee" SET "Password" = $2, "pwd" = $2, "must_change_password" = false WHERE TRIM("Emp_No") = TRIM($1)',
      [empNo, newPassword]
    );

    res.status(200).json({ message: 'Password changed successfully.' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Database error changing password.' });
  }
});

router.get('/API_CHECK', (req, res) => {
  console.log('🔥 API_CHECK ROUTE HIT');

  res.status(200).json({
    success: true,
    message: 'Hello From Backend',
    server: '10.51.11.49',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
