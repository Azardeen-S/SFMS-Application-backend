const fs = require('fs');
const path = require('path');
const db = require('./config/database');

async function applyReportSps() {
  try {
    const sqlPath = path.join(__dirname, 'sql', 'fix_report_sps.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    await db.query(sqlContent);
    console.log('Report stored procedures updated successfully in database!');

    const datewisePath = path.join(__dirname, 'sql', 'fix_datewise_sp.sql');
    const datewiseSql = fs.readFileSync(datewisePath, 'utf8');
    await db.query(datewiseSql);
    console.log('Datewise stored procedure updated successfully!');
    
    process.exit(0);
  } catch (err) {
    console.error('Error executing report stored procedures:', err);
    process.exit(1);
  }
}

applyReportSps();
