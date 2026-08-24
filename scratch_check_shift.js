const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function checkShift() {
  const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%shift%'");
  console.log('shift tables:', tables.rows);
  for (const t of tables.rows) {
    const cols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1", [t.table_name]);
    console.log(`cols for ${t.table_name}:`, cols.rows);
    const sample = await pool.query(`SELECT * FROM "${t.table_name}" LIMIT 3`);
    console.log(`sample for ${t.table_name}:`, sample.rows);
  }
  process.exit(0);
}

checkShift();
