const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function check() {
  try {
    const plantCols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='plant'");
    console.log('plant cols:', plantCols.rows);

    const companyCols = await pool.query('SELECT column_name, data_type FROM information_schema.columns WHERE table_name=\'Mst_Company\'');
    console.log('Mst_Company cols:', companyCols.rows);

    const plantSample = await pool.query('SELECT * FROM plant LIMIT 5');
    console.log('plant sample:', plantSample.rows);

    const companySample = await pool.query('SELECT * FROM "Mst_Company" LIMIT 5');
    console.log('Mst_Company sample:', companySample.rows);

    const sps = await pool.query("SELECT routine_name FROM information_schema.routines WHERE routine_name LIKE '%plant%' OR routine_name LIKE '%company%'");
    console.log('stored procedures:', sps.rows.map(r => r.routine_name));

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

check();
