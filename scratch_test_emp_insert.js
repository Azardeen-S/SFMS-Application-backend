const db = require('./config/database');

async function testEmpInsert() {
  try {
    const maxRes = await db.query('SELECT COALESCE(MAX("Emp_Id"), 0) + 1 AS next_id FROM "Mst_Employee"');
    const nextId = maxRes.rows[0].next_id;
    console.log('Next Emp_Id:', nextId);

    const testRes = await db.query(`
      INSERT INTO "Mst_Employee" (
        "Emp_Id", "Emp_No", "Emp_Name", "Dept", "Designation", "Mail_Id", "Mobile_No",
        "is_admin", "Password", "pwd", "Plant_Code", "Del_Status", "User_Name", "CreatedDt",
        "emp_group", "Type_Code", "emp_level", "company_code", "access_visit", "master"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $9, $10, 'N', $2, NOW(),
        $11, $12, $13, $14, $15, $16
      ) RETURNING *
    `, [
      nextId, '999999', 'Test User', '1', 'Engineer', 'test@test.com', '9876543210',
      0, 'pass123', '1150',
      '1', null, 'Level1', '1000',
      0, 0
    ]);
    console.log('Insert test success:', testRes.rows[0].Emp_Id);

    await db.query('DELETE FROM "Mst_Employee" WHERE "Emp_Id" = $1', [nextId]);
    console.log('Cleaned up test employee row.');
  } catch (err) {
    console.error('Test error:', err.message);
  } finally {
    process.exit(0);
  }
}

testEmpInsert();
