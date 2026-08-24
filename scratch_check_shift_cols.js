const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function checkShiftPK() {
  try {
    const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'Mst_Shift_Hours'");
    console.log('Mst_Shift_Hours columns:', res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

checkShiftPK();
