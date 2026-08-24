const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function dumpCompany() {
  const res = await pool.query('SELECT * FROM "Mst_Company"');
  console.log('Mst_Company rows:', res.rows);
  process.exit(0);
}

dumpCompany();
