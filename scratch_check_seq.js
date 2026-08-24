const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function checkSeq() {
  try {
    const res = await pool.query("SELECT pg_get_expr(d.adbin, d.adrelid) as default_value FROM pg_attribute a JOIN pg_attrdef d ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE a.attrelid = '\"Mst_Shift_Hours\"'::regclass AND a.attname = 'id'");
    console.log('id column default expression:', res.rows[0]);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

checkSeq();
