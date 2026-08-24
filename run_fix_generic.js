const fs = require('fs');
const path = require('path');
const db = require('./config/database');

const sqlPath = path.join(__dirname, 'sql', 'fix_generic_sps.sql');
const sqlContent = fs.readFileSync(sqlPath, 'utf8');

db.query(sqlContent)
  .then(() => {
    console.log('Fixed stored procedures applied successfully!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error applying fixes:', err);
    process.exit(1);
  });
