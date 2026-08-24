const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { generateToken } = require('../utils/jwtHelper');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    let { rows } = await db.query(
      'SELECT * FROM "Mst_Employee" WHERE TRIM("Emp_No") = TRIM($1) AND ("Password" = $2 OR "pwd" = $2) AND ("Del_Status" = \'N\' OR "Del_Status" IS NULL) LIMIT 1',
      [username, password]
    );

    if (rows.length === 0) {
      // Fallback to sp_authenticate_user with Emp_No check
      const spRes = await db.query('SELECT * FROM sp_authenticate_user($1, $2)', [username, password]);
      rows = spRes.rows;
    }

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid EMP Code or password.' });
    }

    const employee = rows[0];

    let plantName = '';
    if (employee.plant_code) {
      try {
        const pRes = await db.query('SELECT plant_name FROM plant WHERE CAST(plant_code AS VARCHAR) = CAST($1 AS VARCHAR) LIMIT 1', [employee.plant_code]);
        if (pRes.rows.length > 0) {
          plantName = pRes.rows[0].plant_name;
        }
      } catch (pErr) {
        console.warn('Could not fetch plant_name for login user:', pErr.message);
      }
    }

    const payload = {
      empId: employee.emp_id,
      empNo: employee.emp_no,
      empName: employee.emp_name,
      username: employee.username,
      plantCode: employee.plant_code,
      plantName: plantName,
      isAdmin: Number(employee.is_admin || 0),
      empGroup: employee.emp_group || (Number(employee.is_admin) === 1 ? 'Super Admin' : 'Plant Admin'),
      role: employee.emp_group || (Number(employee.is_admin) === 1 ? 'Super Admin' : 'Plant Admin'),
    };

    const token = generateToken(payload);

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: payload
    });
  } catch (error) {
    console.error('Login router error:', error);
    return res.status(500).json({ message: 'Database validation error during login.' });
  }
});

module.exports = router;
