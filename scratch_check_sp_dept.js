const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function checkSpCreateDept() {
  try {
    const res = await pool.query("SELECT routine_definition FROM information_schema.routines WHERE routine_name = 'sp_create_department'");
    console.log('sp_create_department definition:\n', res.rows[0]?.routine_definition);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

checkSpCreateDept();
