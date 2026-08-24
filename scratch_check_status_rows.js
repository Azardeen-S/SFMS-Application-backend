const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function checkQueries() {
  try {
    const c = await pool.query('SELECT * FROM "Mst_Company"');
    console.log('Companies:', c.rows);
    const p = await pool.query('SELECT plant_code, plant_name, del_status FROM plant');
    console.log('Plants:', p.rows);
    const d = await pool.query('SELECT dept_id, dept_name, plant_code, del_status FROM mst_dept');
    console.log('Depts:', d.rows);
    const e = await pool.query('SELECT emp_id, emp_no, emp_name, "Del_Status" FROM "Mst_Employee" LIMIT 5');
    console.log('Employees:', e.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

checkQueries();
