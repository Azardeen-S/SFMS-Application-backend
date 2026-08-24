const db = require('./config/database');

async function testDeptInsert() {
  try {
    const maxRes = await db.query('SELECT COALESCE(MAX(dept_id), 0) + 1 AS next_id FROM "mst_dept"');
    const nextId = maxRes.rows[0].next_id;
    const deptCode = String(nextId);
    console.log('Next dept_id:', nextId, 'deptCode:', deptCode);

    const testRes = await db.query(
      'INSERT INTO "mst_dept" (dept_id, dept_code, dept_name, "Plant_Code", del_status, "CreatedDt") VALUES ($1, $2, $3, $4, \'N\', NOW()) RETURNING *',
      [nextId, deptCode, 'Test Dept', '1150']
    );
    console.log('Insert test success:', testRes.rows[0]);

    await db.query('DELETE FROM "mst_dept" WHERE dept_id = $1', [nextId]);
    console.log('Cleaned up test row.');
  } catch (err) {
    console.error('Test error:', err.message);
  } finally {
    process.exit(0);
  }
}

testDeptInsert();
