const db = require('./config/database');

async function addDelStatusColumns() {
  const tables = [
    'Mst_Empl_AutoMailSetting',
    'Mst_Empl_SMSSetting',
    'Mst_Employee_SMS',
    'mst_Functional_Location',
    'Mst_TypeReason_Mapping'
  ];

  for (const table of tables) {
    try {
      await db.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "Del_Status" varchar(10) DEFAULT 'N'`);
      await db.query(`UPDATE "${table}" SET "Del_Status" = 'N' WHERE "Del_Status" IS NULL`);
      console.log(`✅ Del_Status column ensured on table "${table}"`);
    } catch (err) {
      console.error(`Error adding Del_Status to ${table}:`, err.message);
    }
  }
}

addDelStatusColumns();
