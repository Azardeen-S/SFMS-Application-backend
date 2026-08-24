const db = require('./config/database');

async function checkMstTypeCols() {
  try {
    const res = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='Mst_Type' OR table_name='mst_type'`);
    console.log('Mst_Type columns:', res.rows.map(r => r.column_name));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkMstTypeCols();
