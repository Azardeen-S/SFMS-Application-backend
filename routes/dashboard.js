const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const { isCrossCompanyRole } = require('../utils/companyScope');

// GET dashboard statistics
// Scoped by who's asking:
//   - Plant-level users (not admin) - only their own plant.
//   - Every company admin, including a BU Admin at the primary/master
//     company - only their own company's plants.
//   - Only a true cross-company role (Super Admin) - everything, unscoped.
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const isAdmin = Number(req.user?.isAdmin) === 1
      || req.user?.role === 'BU Admin'
      || req.user?.empGroup === 'BU Admin'
      || isCrossCompanyRole(req.user);

    let allowedPlantCodes = null; // null = unrestricted (Super Admin only)
    if (!isAdmin) {
      allowedPlantCodes = req.user?.plantCode ? [req.user.plantCode] : [];
    } else if (!isCrossCompanyRole(req.user)) {
      const plantsRes = await db.query(
        `SELECT plant_code FROM "plant" WHERE "Company_Id" = (SELECT "Company_Id" FROM "Mst_Company" WHERE "Company_Code" = $1)`,
        [req.user.companyCode]
      );
      allowedPlantCodes = plantsRes.rows.map(r => r.plant_code);
    }

    const scoped = allowedPlantCodes !== null;
    const params = scoped ? [allowedPlantCodes] : [];

    const [plantsRow, empRow, stopRow, lineRow] = await Promise.all([
      db.query(`SELECT COUNT(*) AS c FROM "plant" WHERE "del_status" = 'N' ${scoped ? 'AND plant_code = ANY($1::varchar[])' : ''}`, params),
      db.query(`SELECT COUNT(*) AS c FROM "Mst_Employee" WHERE "Del_Status" = 'N' ${scoped ? 'AND "Plant_Code" = ANY($1::varchar[])' : ''}`, params),
      db.query(`SELECT COUNT(*) AS c FROM "Trn_LineStoppage" WHERE "Close_Date" IS NULL AND "Del_Status" = 'N' ${scoped ? 'AND "Plant_Code"::text = ANY($1::varchar[])' : ''}`, params),
      db.query(`SELECT COUNT(*) AS c FROM "Mst_Line" WHERE "Del_Status" = 'N' ${scoped ? 'AND "Plant_code" = ANY($1::varchar[])' : ''}`, params),
    ]);

    res.status(200).json({
      plantsCount: parseInt(plantsRow.rows[0].c),
      employeesCount: parseInt(empRow.rows[0].c),
      activeStoppages: parseInt(stopRow.rows[0].c),
      linesCount: parseInt(lineRow.rows[0].c)
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ message: 'Error retrieving dashboard statistics.' });
  }
});

// Helper for SQL filters
function buildWhereClause(reqUser, fdt, tdt, plant_code, p_status, dtype, bd) {
  let whereClause = `WHERE tls."Del_Status" = 'N'`;
  const params = [];
  let paramIdx = 1;

  const userPlantCode = reqUser?.plantCode || reqUser?.plant_code;
  const userPlantName = reqUser?.plantName || reqUser?.plant_name;
  const isAdmin = Number(reqUser?.isAdmin) === 1
    || reqUser?.role === 'BU Admin'
    || reqUser?.empGroup === 'BU Admin'
    || isCrossCompanyRole(reqUser);

  // Non-admin users are locked to their own plant; admins can use the
  // plant filter (or see all plants in their own company when none is selected).
  let effectivePlant = isAdmin ? plant_code : (userPlantCode || plant_code);

  // Anyone other than a true cross-company role (Super Admin) is always
  // bounded to their own company's plants, admin or not - otherwise a BU
  // Admin at the primary company with no plant filter selected would see
  // every company's data.
  if (!isCrossCompanyRole(reqUser)) {
    whereClause += ` AND p."Company_Id" = (SELECT "Company_Id" FROM "Mst_Company" WHERE "Company_Code" = $${paramIdx})`;
    params.push(reqUser.companyCode);
    paramIdx++;
  }

  if (fdt) {
    whereClause += ` AND tls."Entry_Date" >= $${paramIdx}::timestamp`;
    params.push(fdt);
    paramIdx++;
  }
  if (tdt) {
    whereClause += ` AND tls."Entry_Date" <= $${paramIdx}::timestamp`;
    params.push(tdt);
    paramIdx++;
  }
  if (effectivePlant && effectivePlant !== 'Select' && effectivePlant !== 'All') {
    whereClause += ` AND (tls."Plant_Code"::text = $${paramIdx}::text OR p.plant_code::text = $${paramIdx}::text OR p.plant_name = $${paramIdx})`;
    params.push(effectivePlant);
    paramIdx++;
  }
  if (dtype && dtype !== 'Select') {
    whereClause += ` AND tp."Type_Desc" = $${paramIdx}`;
    params.push(dtype);
    paramIdx++;
  }
  if (p_status === 'Closed') {
    whereClause += ` AND tls."Close_Date" IS NOT NULL`;
  } else if (p_status === 'Open') {
    whereClause += ` AND tls."Close_Date" IS NULL`;
  }
  if (bd && bd !== '--Select--') {
    const hours = parseInt(bd);
    if (!isNaN(hours)) {
      whereClause += ` AND (EXTRACT(EPOCH FROM (COALESCE(tls."Close_Date", NOW()) - tls."Entry_Date")) / 3600) > $${paramIdx}`;
      params.push(hours);
      paramIdx++;
    }
  }

  return { whereClause, params };
}

// 1 & 2: GET Plantwise Count & Avg Closure Time
router.get('/plantwisecount', authMiddleware, async (req, res) => {
  const { fdt, tdt, plant_code, p_status, dtype, bd, gtype } = req.query;

  try {
    const { whereClause, params } = buildWhereClause(req.user, fdt, tdt, plant_code, p_status, dtype, bd);

    const isAvg = gtype === 'Avg';

    const sql = `
      WITH counts AS (
        SELECT 
          p.plant_name,
          tp."Type_Desc" AS type_desc,
          ${isAvg 
            ? `ROUND((SUM(EXTRACT(EPOCH FROM (COALESCE(tls."Close_Date", NOW()) - tls."Entry_Date"))/3600) / NULLIF(COUNT(tls."Id"), 0))::numeric, 2) AS val` 
            : `COUNT(tls."Id") AS val`}
        FROM "Trn_LineStoppage" tls
        JOIN "plant" p ON tls."Plant_Code"::text = p.plant_code::text
        LEFT JOIN "Mst_Type" tp ON tls."Type_Code"::text = tp."Id"::text
        ${whereClause}
        GROUP BY p.plant_name, tp."Type_Desc"
      )
      SELECT 
        c.plant_name AS plant_code,
        COALESCE(SUM(CASE WHEN c.type_desc ILIKE 'Man%' THEN c.val ELSE 0 END), 0)::float AS "MAN",
        COALESCE(SUM(CASE WHEN c.type_desc ILIKE 'Machine%' THEN c.val ELSE 0 END), 0)::float AS "MACHINE",
        COALESCE(SUM(CASE WHEN c.type_desc ILIKE 'Material%' THEN c.val ELSE 0 END), 0)::float AS "MATERIAL",
        COALESCE(SUM(CASE WHEN c.type_desc ILIKE 'Method%' THEN c.val ELSE 0 END), 0)::float AS "METHOD",
        COALESCE(SUM(CASE WHEN c.type_desc ILIKE 'Quality%' THEN c.val ELSE 0 END), 0)::float AS "QUALITY",
        COALESCE(SUM(c.val), 0)::float AS total
      FROM counts c
      GROUP BY c.plant_name
      ORDER BY c.plant_name
    `;

    const result = await db.query(sql, params);

    if (result.rows.length === 0) {
      // Fallback if no counts match where clause, return empty list or plant placeholder
      return res.status(200).json([]);
    }

    res.status(200).json(result.rows.map(r => ({
      plant_code: r.plant_code,
      total: parseFloat(r.total || 0),
      MAN: parseFloat(r.MAN || 0),
      MACHINE: parseFloat(r.MACHINE || 0),
      MATERIAL: parseFloat(r.MATERIAL || 0),
      METHOD: parseFloat(r.METHOD || 0),
      QUALITY: parseFloat(r.QUALITY || 0)
    })));
  } catch (error) {
    console.error('Error fetching plantwise data:', error);
    res.status(500).json({ message: 'Error retrieving plantwise breakdown.' });
  }
});

// 3: GET Monthwise Line Stoppages
router.get('/monthwise', authMiddleware, async (req, res) => {
  const { fdt, tdt, plant_code, p_status, dtype, bd } = req.query;
  try {
    const { whereClause, params } = buildWhereClause(req.user, fdt, tdt, plant_code, p_status, dtype, bd);

    const sql = `
      SELECT 
        TO_CHAR(tls."Entry_Date", 'Mon-YYYY') AS mnthyr,
        DATE_TRUNC('month', tls."Entry_Date") AS month_date,
        COUNT(tls."Id")::int AS total,
        COUNT(CASE WHEN p.plant_name ILIKE '%VARANAVASI%' OR tls."Plant_Code"::text = '1150' THEN tls."Id" END)::int AS varanavasi,
        COUNT(CASE WHEN p.plant_name ILIKE '%MYSORE-SLD%' OR tls."Plant_Code"::text = '1200' THEN tls."Id" END)::int AS mysore_sld,
        COUNT(CASE WHEN p.plant_name ILIKE '%MYSORE-HYD%' OR tls."Plant_Code"::text = '1210' THEN tls."Id" END)::int AS mysore_hyd,
        COUNT(CASE WHEN p.plant_name ILIKE '%UTL%' OR tls."Plant_Code"::text = '1250' THEN tls."Id" END)::int AS utl,
        COUNT(CASE WHEN p.plant_name ILIKE '%PONDICHERRY%' OR p.plant_name ILIKE '%PONDY%' OR tls."Plant_Code"::text = '1300' THEN tls."Id" END)::int AS pondy
      FROM "Trn_LineStoppage" tls
      JOIN "plant" p ON tls."Plant_Code"::text = p.plant_code::text
      LEFT JOIN "Mst_Type" tp ON tls."Type_Code"::text = tp."Id"::text
      ${whereClause}
      GROUP BY TO_CHAR(tls."Entry_Date", 'Mon-YYYY'), DATE_TRUNC('month', tls."Entry_Date")
      ORDER BY month_date ASC
    `;

    const result = await db.query(sql, params);
    
    // If no records in filtered range, fetch top monthly summaries - but still
    // scoped to the same plant/company (dropping only the date range), never
    // a global cross-company fallback.
    if (result.rows.length === 0) {
      const { whereClause: fbWhereClause, params: fbParams } = buildWhereClause(req.user, null, null, plant_code, p_status, dtype, bd);
      const fallbackSql = `
        SELECT
          TO_CHAR(tls."Entry_Date", 'Mon-YYYY') AS mnthyr,
          DATE_TRUNC('month', tls."Entry_Date") AS month_date,
          COUNT(tls."Id")::int AS total,
          COUNT(CASE WHEN p.plant_name ILIKE '%VARANAVASI%' THEN tls."Id" END)::int AS varanavasi,
          COUNT(CASE WHEN p.plant_name ILIKE '%MYSORE-SLD%' THEN tls."Id" END)::int AS mysore_sld,
          COUNT(CASE WHEN p.plant_name ILIKE '%MYSORE-HYD%' THEN tls."Id" END)::int AS mysore_hyd,
          0::int AS utl,
          COUNT(CASE WHEN p.plant_name ILIKE '%PONDICHERRY%' OR p.plant_name ILIKE '%PONDY%' THEN tls."Id" END)::int AS pondy
        FROM "Trn_LineStoppage" tls
        JOIN "plant" p ON tls."Plant_Code"::text = p.plant_code::text
        LEFT JOIN "Mst_Type" tp ON tls."Type_Code"::text = tp."Id"::text
        ${fbWhereClause}
        GROUP BY TO_CHAR(tls."Entry_Date", 'Mon-YYYY'), DATE_TRUNC('month', tls."Entry_Date")
        ORDER BY month_date DESC
        LIMIT 6
      `;
      const fallbackRes = await db.query(fallbackSql, fbParams);
      return res.status(200).json(fallbackRes.rows.reverse());
    }

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching monthwise data:', error);
    res.status(500).json({ message: 'Error retrieving monthwise data.' });
  }
});

// 4: GET Avg Closure - Monthwise
router.get('/monthwise_avg', authMiddleware, async (req, res) => {
  const { fdt, tdt, plant_code, p_status, dtype, bd } = req.query;
  try {
    const { whereClause, params } = buildWhereClause(req.user, fdt, tdt, plant_code, p_status, dtype, bd);

    const sql = `
      SELECT 
        TO_CHAR(tls."Entry_Date", 'Mon-YYYY') AS mnthyr,
        DATE_TRUNC('month', tls."Entry_Date") AS month_date,
        ROUND((AVG(CASE WHEN tp."Type_Desc" ILIKE 'Man%' THEN EXTRACT(EPOCH FROM (COALESCE(tls."Close_Date", NOW()) - tls."Entry_Date"))/3600 END))::numeric, 2) AS "MAN",
        ROUND((AVG(CASE WHEN tp."Type_Desc" ILIKE 'Machine%' THEN EXTRACT(EPOCH FROM (COALESCE(tls."Close_Date", NOW()) - tls."Entry_Date"))/3600 END))::numeric, 2) AS "MACHINE",
        ROUND((AVG(CASE WHEN tp."Type_Desc" ILIKE 'Material%' THEN EXTRACT(EPOCH FROM (COALESCE(tls."Close_Date", NOW()) - tls."Entry_Date"))/3600 END))::numeric, 2) AS "MATERIAL",
        ROUND((AVG(CASE WHEN tp."Type_Desc" ILIKE 'Method%' THEN EXTRACT(EPOCH FROM (COALESCE(tls."Close_Date", NOW()) - tls."Entry_Date"))/3600 END))::numeric, 2) AS "METHOD",
        ROUND((AVG(CASE WHEN tp."Type_Desc" ILIKE 'Quality%' THEN EXTRACT(EPOCH FROM (COALESCE(tls."Close_Date", NOW()) - tls."Entry_Date"))/3600 END))::numeric, 2) AS "QUALITY"
      FROM "Trn_LineStoppage" tls
      JOIN "plant" p ON tls."Plant_Code"::text = p.plant_code::text
      LEFT JOIN "Mst_Type" tp ON tls."Type_Code"::text = tp."Id"::text
      ${whereClause}
      GROUP BY TO_CHAR(tls."Entry_Date", 'Mon-YYYY'), DATE_TRUNC('month', tls."Entry_Date")
      ORDER BY month_date ASC
    `;

    const result = await db.query(sql, params);
    res.status(200).json(result.rows.map(r => ({
      mnthyr: r.mnthyr,
      MAN: parseFloat(r.MAN || 0),
      MACHINE: parseFloat(r.MACHINE || 0),
      MATERIAL: parseFloat(r.MATERIAL || 0),
      METHOD: parseFloat(r.METHOD || 0),
      QUALITY: parseFloat(r.QUALITY || 0)
    })));
  } catch (error) {
    console.error('Error fetching monthwise avg data:', error);
    res.status(500).json({ message: 'Error retrieving monthwise average data.' });
  }
});

// 5: GET Line Stoppage Trend - Monthwise
router.get('/trend_monthwise', authMiddleware, async (req, res) => {
  const { fdt, tdt, plant_code, p_status, dtype, bd } = req.query;
  try {
    const { whereClause, params } = buildWhereClause(req.user, fdt, tdt, plant_code, p_status, dtype, bd);

    const sql = `
      SELECT 
        TO_CHAR(tls."Entry_Date", 'Mon-YYYY') AS mnthyr,
        DATE_TRUNC('month', tls."Entry_Date") AS month_date,
        COUNT(tls."Id") AS total,
        COUNT(CASE WHEN tp."Type_Desc" ILIKE 'Man%' THEN tls."Id" END) AS "MAN",
        COUNT(CASE WHEN tp."Type_Desc" ILIKE 'Machine%' THEN tls."Id" END) AS "MACHINE",
        COUNT(CASE WHEN tp."Type_Desc" ILIKE 'Material%' THEN tls."Id" END) AS "MATERIAL",
        COUNT(CASE WHEN tp."Type_Desc" ILIKE 'Method%' THEN tls."Id" END) AS "METHOD",
        COUNT(CASE WHEN tp."Type_Desc" ILIKE 'Quality%' THEN tls."Id" END) AS "QUALITY"
      FROM "Trn_LineStoppage" tls
      JOIN "plant" p ON tls."Plant_Code"::text = p.plant_code::text
      LEFT JOIN "Mst_Type" tp ON tls."Type_Code"::text = tp."Id"::text
      ${whereClause}
      GROUP BY TO_CHAR(tls."Entry_Date", 'Mon-YYYY'), DATE_TRUNC('month', tls."Entry_Date")
      ORDER BY month_date ASC
    `;

    const result = await db.query(sql, params);
    res.status(200).json(result.rows.map(r => ({
      mnthyr: r.mnthyr,
      total: parseInt(r.total || 0),
      MAN: parseInt(r.MAN || 0),
      MACHINE: parseInt(r.MACHINE || 0),
      MATERIAL: parseInt(r.MATERIAL || 0),
      METHOD: parseInt(r.METHOD || 0),
      QUALITY: parseInt(r.QUALITY || 0)
    })));
  } catch (error) {
    console.error('Error fetching trend monthwise data:', error);
    res.status(500).json({ message: 'Error retrieving trend monthwise data.' });
  }
});

// 6: GET Line Stoppage Trend Typewise and Hr Wise
router.get('/trend_typewise_hrs', authMiddleware, async (req, res) => {
  const { fdt, tdt, plant_code, p_status, dtype, bd } = req.query;
  try {
    const { whereClause, params } = buildWhereClause(req.user, fdt, tdt, plant_code, p_status, dtype, bd);

    const sql = `
      SELECT 
        TO_CHAR(tls."Entry_Date", 'Mon-YYYY') AS mnthyr,
        DATE_TRUNC('month', tls."Entry_Date") AS month_date,
        ROUND((SUM(CASE WHEN tp."Type_Desc" ILIKE 'Man%' THEN EXTRACT(EPOCH FROM (COALESCE(tls."Close_Date", NOW()) - tls."Entry_Date"))/3600 ELSE 0 END))::numeric, 2) AS "MAN",
        ROUND((SUM(CASE WHEN tp."Type_Desc" ILIKE 'Machine%' THEN EXTRACT(EPOCH FROM (COALESCE(tls."Close_Date", NOW()) - tls."Entry_Date"))/3600 ELSE 0 END))::numeric, 2) AS "MACHINE",
        ROUND((SUM(CASE WHEN tp."Type_Desc" ILIKE 'Material%' THEN EXTRACT(EPOCH FROM (COALESCE(tls."Close_Date", NOW()) - tls."Entry_Date"))/3600 ELSE 0 END))::numeric, 2) AS "MATERIAL",
        ROUND((SUM(CASE WHEN tp."Type_Desc" ILIKE 'Method%' THEN EXTRACT(EPOCH FROM (COALESCE(tls."Close_Date", NOW()) - tls."Entry_Date"))/3600 ELSE 0 END))::numeric, 2) AS "METHOD",
        ROUND((SUM(CASE WHEN tp."Type_Desc" ILIKE 'Quality%' THEN EXTRACT(EPOCH FROM (COALESCE(tls."Close_Date", NOW()) - tls."Entry_Date"))/3600 ELSE 0 END))::numeric, 2) AS "QUALITY"
      FROM "Trn_LineStoppage" tls
      JOIN "plant" p ON tls."Plant_Code"::text = p.plant_code::text
      LEFT JOIN "Mst_Type" tp ON tls."Type_Code"::text = tp."Id"::text
      ${whereClause}
      GROUP BY TO_CHAR(tls."Entry_Date", 'Mon-YYYY'), DATE_TRUNC('month', tls."Entry_Date")
      ORDER BY month_date ASC
    `;

    const result = await db.query(sql, params);
    res.status(200).json(result.rows.map(r => ({
      mnthyr: r.mnthyr,
      MAN: parseFloat(r.MAN || 0),
      MACHINE: parseFloat(r.MACHINE || 0),
      MATERIAL: parseFloat(r.MATERIAL || 0),
      METHOD: parseFloat(r.METHOD || 0),
      QUALITY: parseFloat(r.QUALITY || 0)
    })));
  } catch (error) {
    console.error('Error fetching trend typewise hrs data:', error);
    res.status(500).json({ message: 'Error retrieving trend typewise hrs data.' });
  }
});

module.exports = router;
