const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function checkAllPhenomena() {
  try {
    const res = await pool.query('SELECT * FROM "Phenomena"');
    console.log('Total Phenomena rows:', res.rows.length);
    console.log('Sample rows:', res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

checkAllPhenomena();
