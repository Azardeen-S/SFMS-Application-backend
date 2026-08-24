const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Admin%40123@127.0.0.1:5432/SFMS' });

async function testSpInsertUpdate() {
  try {
    const table = 'Mst_Shift_Hours';
    const colsRes = await pool.query('SELECT column_name FROM sp_get_table_columns($1)', [table]);
    const columns = colsRes.rows.map(r => r.column_name);
    console.log('Columns for Mst_Shift_Hours via sp_get_table_columns:', columns);

    const body = {
      Plant_Code: '1150',
      Shift: 'SHIFT I',
      Hours: '8',
      Start_Time: '06:00 AM',
      End_Time: '02:00 PM',
      Del_Status: 'N'
    };

    body.id = 999;
    const insertKeys = Object.keys(body).filter(key => {
      if (!columns.includes(key)) return false;
      const lKey = key.toLowerCase();
      return lKey !== 'del_status' && lKey !== 'createddt' && lKey !== 'modifieddt';
    });
    const insertVals = insertKeys.map(key => String(body[key]));
    console.log('Keys:', insertKeys);
    console.log('Vals:', insertVals);

    try {
      const insRes = await pool.query('SELECT sp_generic_insert($1, $2, $3)', [table, insertKeys, insertVals]);
      console.log('sp_generic_insert success:', insRes.rows);
    } catch (e) {
      console.error('sp_generic_insert error:', e.message);
    }

    try {
      const updRes = await pool.query('SELECT sp_generic_update($1, $2, $3, $4, $5)', [table, ['Shift', 'Hours'], ['SHIFT I EDIT', '8.5'], 'id', '1']);
      console.log('sp_generic_update success:', updRes.rows);
    } catch (e) {
      console.error('sp_generic_update error:', e.message);
    }

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

testSpInsertUpdate();
