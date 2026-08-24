const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function testEmp() {
  try {
    const q1 = await pool.query('SELECT * FROM sp_get_active_employees()');
    console.log('sp_get_active_employees success, count:', q1.rows.length);

    const q2 = await pool.query(`
      SELECT 
        e.emp_id,
        e.emp_no,
        e.emp_name,
        e.dept,
        e.designation,
        e.mail_id,
        e.mobile_no,
        e.is_admin,
        e.plant_code,
        e."Del_Status" AS del_status,
        COALESCE(p.plant_name, e.plant_code) AS plant_name,
        COALESCE(d.dept_name, e.dept::varchar) AS dept_name
      FROM "Mst_Employee" e
      LEFT JOIN plant p ON CAST(e.plant_code AS VARCHAR) = CAST(p.plant_code AS VARCHAR)
      LEFT JOIN mst_dept d ON CAST(e.dept AS VARCHAR) = CAST(d.dept_id AS VARCHAR)
      ORDER BY e.emp_name ASC
    `);
    console.log('custom query success, count:', q2.rows.length);
  } catch (err) {
    console.error('Error testEmp:', err);
  } finally {
    process.exit(0);
  }
}

testEmp();
