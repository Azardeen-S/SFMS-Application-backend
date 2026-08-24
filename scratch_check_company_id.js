const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function checkSeq() {
  try {
    const res = await pool.query(`
      SELECT column_name, column_default 
      FROM information_schema.columns 
      WHERE table_name='Mst_Company' AND column_name='Company_Id'
    `);
    console.log('Company_Id column details:', res.rows);
    const maxRes = await pool.query('SELECT MAX("Company_Id") FROM "Mst_Company"');
    console.log('Max Company_Id:', maxRes.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

checkSeq();
