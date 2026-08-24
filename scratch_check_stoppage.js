const db = require('./config/database');
async function test() {
  try {
    const res = await db.query('SELECT "Id", "Plant_Code", "Shop_Code", "Module_Code", "Line_Code", "Machine_Code", "Type_Code", "LineReason_Code", "SAPMchn_Code", "Start_slno" FROM "Trn_LineStoppage" ORDER BY "Id" DESC LIMIT 5');
    console.log('Recent stoppage records:', res.rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
test();
