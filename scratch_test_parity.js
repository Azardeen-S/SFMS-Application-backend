const db = require('./config/database');

async function testBackendParity() {
  console.log('Testing DB connection and query structure for parity...');
  try {
    const res = await db.query('SELECT COUNT("Id") AS count FROM "Trn_LineStoppage" WHERE "Del_Status" = \'N\'');
    console.log('Total Stoppages in DB:', res.rows[0].count);
    process.exit(0);
  } catch (err) {
    console.error('Error testing DB query:', err);
    process.exit(1);
  }
}

testBackendParity();
