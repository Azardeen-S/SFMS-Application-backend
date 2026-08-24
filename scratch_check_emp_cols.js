const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function checkEmpTable() {
  try {
    const cols = await pool.query("SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name = 'Mst_Employee'");
    console.log('Mst_Employee columns:', cols.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

checkEmpTable();
