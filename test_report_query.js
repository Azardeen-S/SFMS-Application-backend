const db = require('./config/database');

async function testReportQuery() {
  const startDate = '2026-05-31T18:30:00.000Z';
  const endDate = '2026-09-08T18:29:59.999Z';

  console.log('Testing stored procedure sp_rpt_datewise...');
  try {
    const res1 = await db.query('SELECT * FROM sp_rpt_datewise($1::timestamp, $2::timestamp)', [startDate, endDate]);
    console.log('SP Success! Count:', res1.rows.length);
    console.log('First row sample:', res1.rows[0]);
  } catch (err1) {
    console.error('SP Failed with error:', err1.message, err1.detail, err1.hint);
  }

  console.log('\nTesting raw SQL query fallback...');
  try {
    const rawSql = `
      SELECT 
        t."Id" AS id,
        p.plant_name,
        s."Shop_Name" AS shop_name,
        m."Module_Name" AS module_name,
        l."Line_Name" AS line_name,
        mc."Mchn_Name" AS mchn_name,
        tp."Type_Desc" AS type_desc,
        g."Gap_Name" AS gap_name,
        t."Status" AS status,
        t."Entry_Date" AS entry_date,
        t."Close_Date" AS close_date,
        t."Closure" AS closure,
        ROUND((EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date"))/3600)::numeric, 2) AS hours,
        FLOOR(MOD((EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date"))/60)::numeric, 60)) AS mins
      FROM "Trn_LineStoppage" t
      LEFT JOIN "plant" p ON t."Plant_Code" = p.plant_code
      LEFT JOIN "Mst_Shop" s ON t."Shop_Code" = s."Shop_code"
      LEFT JOIN "Mst_Module" m ON t."Module_Code" = m."Module_Code"
      LEFT JOIN "Mst_Line" l ON t."Line_Code" = l."Line_code"
      LEFT JOIN "Mst_Machine" mc ON t."Machine_Code" = mc."Mchn_code"
      LEFT JOIN "Mst_Type" tp ON t."Type_Code"::text = tp."Id"::text AND t."Plant_Code"::text = tp."Plant_Code"::text
      LEFT JOIN "Mst_Gap" g ON t."LineReason_Code"::text = g."Id"::text AND t."Plant_Code"::text = g."Plant_Code"::text
      WHERE t."Del_Status" = 'N'
        AND t."Entry_Date" >= $1::timestamp
        AND t."Entry_Date" <= $2::timestamp
      ORDER BY t."Entry_Date" DESC
      LIMIT 100
    `;
    const res2 = await db.query(rawSql, [startDate, endDate]);
    console.log('Raw SQL Success! Count:', res2.rows.length);
    console.log('First raw row sample:', res2.rows[0]);
  } catch (err2) {
    console.error('Raw SQL Failed with error:', err2.message, err2.detail, err2.hint);
  }
  process.exit(0);
}

testReportQuery();
