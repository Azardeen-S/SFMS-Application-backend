const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function checkCols() {
  const cols = await pool.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('Mst_Shift_Hours', 'Mst_Shift', 'VENDOR')");
  console.log(cols.rows);
  process.exit(0);
}

checkCols();
