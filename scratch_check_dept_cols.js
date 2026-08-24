const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function checkDeptTable() {
  try {
    const cols = await pool.query("SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'mst_dept'");
    console.log('mst_dept columns:', cols.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

checkDeptTable();
