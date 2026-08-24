const db = require('./config/database');
async function test() {
  try {
    const res = await db.query('SELECT * FROM "SFMS_Auto"');
    console.log('SFMS_Auto:', res.rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
test();
