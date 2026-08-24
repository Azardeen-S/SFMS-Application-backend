const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function addShiftColumns() {
  try {
    await pool.query('ALTER TABLE "Mst_Shift_Hours" ADD COLUMN IF NOT EXISTS "Start_Time" VARCHAR(50)');
    await pool.query('ALTER TABLE "Mst_Shift_Hours" ADD COLUMN IF NOT EXISTS "End_Time" VARCHAR(50)');
    console.log('Columns Start_Time and End_Time added to Mst_Shift_Hours');
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

addShiftColumns();
