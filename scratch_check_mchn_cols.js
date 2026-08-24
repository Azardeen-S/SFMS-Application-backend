const db = require('./config/database');

async function checkCols() {
  try {
    const res = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='Mst_Machine' OR table_name='mst_machine'`);
    console.log('Mst_Machine columns:', res.rows.map(r => r.column_name));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkCols();
