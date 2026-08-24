const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function checkDeleteCols() {
  const tables = ['Mst_Company', 'plant', 'mst_dept', 'Mst_Employee', 'VENDOR', 'Mst_Shift_Hours', 'Mst_BreakDown', 'Mst_Category', 'mst_group', 'mst_SubGroup', 'Phenomena', 'mst_Functional_Location', 'Mst_Tool'];
  for (const t of tables) {
    const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1", [t]);
    const cols = res.rows.map(r => r.column_name);
    console.log(`${t}:`, cols.filter(c => c.toLowerCase().includes('del') || c.toLowerCase().includes('active') || c.toLowerCase().includes('status')));
  }
  process.exit(0);
}

checkDeleteCols();
