const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function checkSps() {
  try {
    const spList = ['sp_get_active_plants', 'sp_create_plant', 'sp_update_plant', 'sp_delete_plant', 'sp_get_plant_by_code', 'sp_reactivate_plant'];
    for (const sp of spList) {
      const res = await pool.query("SELECT routine_definition FROM information_schema.routines WHERE routine_name = $1", [sp]);
      console.log(`=== ${sp} ===`);
      console.log(res.rows[0]?.routine_definition);
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

checkSps();
