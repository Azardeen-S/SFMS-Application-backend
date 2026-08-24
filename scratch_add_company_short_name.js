const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function migrateCompany() {
  try {
    await pool.query('ALTER TABLE "Mst_Company" ADD COLUMN IF NOT EXISTS "Company_Short_Name" VARCHAR(255)');
    console.log('✅ Added Company_Short_Name column to Mst_Company');
    const res = await pool.query('SELECT column_name, data_type FROM information_schema.columns WHERE table_name=\'Mst_Company\'');
    console.log('Current Mst_Company columns:', res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

migrateCompany();
