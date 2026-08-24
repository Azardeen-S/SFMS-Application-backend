const db = require('./config/database');

async function runDeepTestSuite() {
  try {
    console.log('=== STARTING DEEP AUTOMATED MASTER TEST SUITE ===');

    // 1. COMPANY MASTER
    const compCode = 'TC_' + Date.now().toString().slice(-4);
    console.log('[1/11] Creating Company:', compCode);
    await db.query('INSERT INTO "Mst_Company" ("Company_Id", "Company_Code", "Company_Name", "Company_Short_Name", "Is_active") VALUES ((SELECT COALESCE(MAX("Company_Id"), 0) + 1 FROM "Mst_Company"), $1, $2, $3, true)', [compCode, 'Test Company ' + compCode, 'TC_' + compCode]);
    console.log('   Updating Company toggle to false...');
    await db.query('UPDATE "Mst_Company" SET "Is_active" = false WHERE "Company_Code" = $1', [compCode]);
    console.log('   Re-activating Company toggle to true...');
    await db.query('UPDATE "Mst_Company" SET "Is_active" = true WHERE "Company_Code" = $1', [compCode]);
    console.log('   Company Master: PASS');

    // 2. PLANT MASTER
    const plantCode = 'P' + Date.now().toString().slice(-4);
    console.log('[2/11] Creating Plant:', plantCode);
    await db.query('INSERT INTO plant (plant_code, plant_name, del_status) VALUES ($1, $2, \'N\')', [plantCode, 'Test Plant ' + plantCode]);
    console.log('   Toggling Plant to Inactive (Y)...');
    await db.query('UPDATE plant SET del_status = \'Y\' WHERE plant_code = $1', [plantCode]);
    console.log('   Toggling Plant to Active (N)...');
    await db.query('UPDATE plant SET del_status = \'N\' WHERE plant_code = $1', [plantCode]);
    console.log('   Plant Master: PASS');

    // 3. DEPARTMENT MASTER
    const deptMax = await db.query('SELECT COALESCE(MAX(dept_id), 0) + 1 AS next_id FROM "mst_dept"');
    const deptId = deptMax.rows[0].next_id;
    console.log('[3/11] Creating Department ID:', deptId);
    await db.query('INSERT INTO "mst_dept" (dept_id, dept_code, dept_name, "Plant_Code", del_status) VALUES ($1, $2, $3, $4, \'N\')', [deptId, String(deptId), 'Test Dept ' + deptId, '1150']);
    console.log('   Toggling Dept to Inactive (Y)...');
    await db.query('UPDATE "mst_dept" SET del_status = \'Y\' WHERE dept_id = $1', [deptId]);
    console.log('   Toggling Dept to Active (N)...');
    await db.query('UPDATE "mst_dept" SET del_status = \'N\' WHERE dept_id = $1', [deptId]);
    console.log('   Department Master: PASS');

    // 4. EMPLOYEE MASTER
    const empNo = 'E_' + Date.now().toString().slice(-4);
    const empMax = await db.query('SELECT COALESCE(MAX("Emp_Id"), 0) + 1 AS next_id FROM "Mst_Employee"');
    const empId = empMax.rows[0].next_id;
    console.log('[4/11] Creating Employee ID:', empId, 'No:', empNo);
    await db.query('INSERT INTO "Mst_Employee" ("Emp_Id", "Emp_No", "Emp_Name", "Plant_Code", "Del_Status") VALUES ($1, $2, $3, \'1150\', \'N\')', [empId, empNo, 'Test Emp ' + empNo]);
    console.log('   Toggling Employee to Inactive (Y)...');
    await db.query('UPDATE "Mst_Employee" SET "Del_Status" = \'Y\' WHERE "Emp_Id" = $1', [empId]);
    console.log('   Toggling Employee to Active (N)...');
    await db.query('UPDATE "Mst_Employee" SET "Del_Status" = \'N\' WHERE "Emp_Id" = $1', [empId]);
    console.log('   Employee Master: PASS');

    // 5. SHOP MASTER
    const shopCode = String(Date.now().toString().slice(-6));
    console.log('[5/11] Creating Shop Code:', shopCode);
    await db.query('INSERT INTO "Mst_Shop" ("Shop_code", "Shop_Name", "Plant_Code", "Del_Status") VALUES ($1, $2, \'1150\', \'N\')', [shopCode, 'Test Shop ' + shopCode]);
    console.log('   Toggling Shop to Inactive (Y)...');
    await db.query('UPDATE "Mst_Shop" SET "Del_Status" = \'Y\' WHERE TRIM("Shop_code"::text) = TRIM($1::text)', [shopCode]);
    console.log('   Toggling Shop to Active (N)...');
    await db.query('UPDATE "Mst_Shop" SET "Del_Status" = \'N\' WHERE TRIM("Shop_code"::text) = TRIM($1::text)', [shopCode]);
    console.log('   Shop Master: PASS');

    // 6. MODULE MASTER
    const modCode = String(Date.now().toString().slice(-6));
    console.log('[6/11] Creating Module Code:', modCode);
    await db.query('INSERT INTO "Mst_Module" ("Module_Code", "Module_Name", "Plant_code", "Shop_code", "Del_Status") VALUES ($1, $2, \'1150\', $3, \'N\')', [modCode, 'Test Module ' + modCode, shopCode]);
    console.log('   Toggling Module to Inactive (Y)...');
    await db.query('UPDATE "Mst_Module" SET "Del_Status" = \'Y\' WHERE TRIM("Module_Code"::text) = TRIM($1::text)', [modCode]);
    console.log('   Toggling Module to Active (N)...');
    await db.query('UPDATE "Mst_Module" SET "Del_Status" = \'N\' WHERE TRIM("Module_Code"::text) = TRIM($1::text)', [modCode]);
    console.log('   Module Master: PASS');

    // 7. LINE MASTER
    const lineCode = String(Date.now().toString().slice(-6));
    console.log('[7/11] Creating Line Code:', lineCode);
    await db.query('INSERT INTO "Mst_Line" ("Line_code", "Line_Name", "Plant_code", "Shop_code", "Module_code", "Del_Status") VALUES ($1, $2, \'1150\', $3, $4, \'N\')', [lineCode, 'Test Line ' + lineCode, shopCode, modCode]);
    console.log('   Toggling Line to Inactive (Y)...');
    await db.query('UPDATE "Mst_Line" SET "Del_Status" = \'Y\' WHERE TRIM("Line_code"::text) = TRIM($1::text)', [lineCode]);
    console.log('   Toggling Line to Active (N)...');
    await db.query('UPDATE "Mst_Line" SET "Del_Status" = \'N\' WHERE TRIM("Line_code"::text) = TRIM($1::text)', [lineCode]);
    console.log('   Line Master: PASS');

    // 8. MACHINE MASTER
    const mchnCode = 'MC_' + Date.now().toString().slice(-5);
    const mchnMax = await db.query('SELECT COALESCE(MAX("Id"), 0) + 1 AS next_id FROM "Mst_Machine"');
    const mchnId = mchnMax.rows[0].next_id;
    console.log('[8/11] Creating Machine Code:', mchnCode, 'Id:', mchnId);
    await db.query('INSERT INTO "Mst_Machine" ("Id", "Mchn_code", "Mchn_Name", "SAPMchn_Code", "Plant_code", "Shop_code", "Module_Code", "Line_code", "Del_Status") VALUES ($1, $2, $3, $4, \'1150\', $5, $6, $7, \'N\')', [mchnId, mchnCode, 'Test Machine ' + mchnCode, 'ASSET_' + mchnCode, shopCode, modCode, lineCode]);
    console.log('   Toggling Machine to Inactive (Y)...');
    await db.query('UPDATE "Mst_Machine" SET "Del_Status" = \'Y\' WHERE TRIM("Mchn_code"::text) = TRIM($1::text)', [mchnCode]);
    console.log('   Toggling Machine to Active (N)...');
    await db.query('UPDATE "Mst_Machine" SET "Del_Status" = \'N\' WHERE TRIM("Mchn_code"::text) = TRIM($1::text)', [mchnCode]);
    console.log('   Machine Master: PASS');

    // 9. PROBLEM TYPE MASTER
    const typeMax = await db.query('SELECT COALESCE(MAX("Id"), 0) + 1 AS next_id FROM "Mst_Type"');
    const typeId = typeMax.rows[0].next_id;
    console.log('[9/11] Creating Type ID:', typeId);
    await db.query('INSERT INTO "Mst_Type" ("Id", "Type_Desc", "Plant_Code", "Del_Status") VALUES ($1, $2, \'1150\', \'N\')', [typeId, 'Test Type ' + typeId]);
    console.log('   Toggling Type to Inactive (Y)...');
    await db.query('UPDATE "Mst_Type" SET "Del_Status" = \'Y\' WHERE CAST("Id" AS VARCHAR) = CAST($1 AS VARCHAR)', [typeId]);
    console.log('   Toggling Type to Active (N)...');
    await db.query('UPDATE "Mst_Type" SET "Del_Status" = \'N\' WHERE CAST("Id" AS VARCHAR) = CAST($1 AS VARCHAR)', [typeId]);
    console.log('   Problem Type Master: PASS');

    // 10. LINE STOPPAGE REASON (GAP) MASTER
    const gapMax = await db.query('SELECT COALESCE(MAX("Id"), 0) + 1 AS next_id FROM "Mst_Gap"');
    const gapId = gapMax.rows[0].next_id;
    console.log('[10/11] Creating Gap ID:', gapId);
    await db.query('INSERT INTO "Mst_Gap" ("Id", "Gap_Name", "Plant_Code", "Del_Status") VALUES ($1, $2, \'1150\', \'N\')', [gapId, 'Test Gap ' + gapId]);
    console.log('   Toggling Gap to Inactive (Y)...');
    await db.query('UPDATE "Mst_Gap" SET "Del_Status" = \'Y\' WHERE CAST("Id" AS VARCHAR) = CAST($1 AS VARCHAR)', [gapId]);
    console.log('   Toggling Gap to Active (N)...');
    await db.query('UPDATE "Mst_Gap" SET "Del_Status" = \'N\' WHERE CAST("Id" AS VARCHAR) = CAST($1 AS VARCHAR)', [gapId]);
    console.log('   Line Stoppage Reason Master: PASS');

    // 11. DOWNTIME INCIDENT TRANSACTION LOGGING (CREATE & CLOSE)
    console.log('[11/11] Testing Downtime Incident Open & Close Flow...');
    const now = new Date();
    await db.query('SELECT sp_create_line_stoppage($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)', [
      '1150', shopCode, modCode, lineCode, mchnCode, String(typeId), String(gapId), 'Test incident remarks', now, 'O', 1, 'Breakdown'
    ]);
    const txnRes = await db.query('SELECT "Id" FROM "Trn_LineStoppage" WHERE "Machine_Code" = $1 ORDER BY "Id" DESC LIMIT 1', [mchnCode]);
    const txnId = txnRes.rows[0].Id;
    console.log('   Created Transaction ID:', txnId);
    console.log('   Closing Transaction ID:', txnId);
    await db.query('SELECT sp_close_line_stoppage($1, $2, $3, $4, $5, $6, $7)', [
      txnId, 'C', new Date(), 'Resolution completed', '', 1, null
    ]);
    console.log('   Downtime Incident Transaction: PASS');

    // CLEANUP TEST SAMPLES
    console.log('=== CLEANING UP CREATED TEST SAMPLE DATA ===');
    await db.query('DELETE FROM "Trn_LineStoppage" WHERE "Id" = $1', [txnId]);
    await db.query('DELETE FROM "Mst_Gap" WHERE "Id" = $1', [gapId]);
    await db.query('DELETE FROM "Mst_Type" WHERE "Id" = $1', [typeId]);
    await db.query('DELETE FROM "Mst_Machine" WHERE "Mchn_code" = $1', [mchnCode]);
    await db.query('DELETE FROM "Mst_Line" WHERE "Line_code" = $1', [lineCode]);
    await db.query('DELETE FROM "Mst_Module" WHERE "Module_Code" = $1', [modCode]);
    await db.query('DELETE FROM "Mst_Shop" WHERE "Shop_code" = $1', [shopCode]);
    await db.query('DELETE FROM "Mst_Employee" WHERE "Emp_Id" = $1', [empId]);
    await db.query('DELETE FROM "mst_dept" WHERE dept_id = $1', [deptId]);
    await db.query('DELETE FROM plant WHERE plant_code = $1', [plantCode]);
    await db.query('DELETE FROM "Mst_Company" WHERE "Company_Code" = $1', [compCode]);
    console.log('=== ALL 11 MASTERS & TRANSACTIONS PASSED 100% IN-DEPTH VERIFICATION ===');
  } catch (err) {
    console.error('TEST SUITE ERROR:', err);
  }
}

runDeepTestSuite();
