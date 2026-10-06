const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const { isCrossCompanyRole, getCompanyPlantCodes } = require('../utils/companyScope');

// Resolves the plant codes this caller may see: null = unrestricted (Super
// Admin / cross-company), otherwise the exact set of plant codes belonging
// to their own company (BU Admin - "only their Company Data").
async function resolveAllowedPlantCodes(req) {
  if (isCrossCompanyRole(req.user)) return null;
  if (!req.user?.companyCode) return new Set();
  return getCompanyPlantCodes(db, req.user.companyCode);
}

function buildPlantFilter(allowedPlantCodes, paramIdx) {
  if (allowedPlantCodes === null) return { clause: '', param: null };
  return {
    clause: `AND LOWER(TRIM("Plant_Code")) = ANY($${paramIdx}::text[])`,
    param: Array.from(allowedPlantCodes),
  };
}

// Builds the combined role-scope + optional user-picked plant/company filter
// clauses for a query against Trn_SMS_Log aliased as "s". User-picked filters
// narrow WITHIN whatever the role is already allowed to see - they can never
// widen it (a company-scoped user picking another company's plant simply
// matches nothing, not an escalation).
async function buildScopeAndFilters(req, params) {
  const clauses = [];
  const allowedPlantCodes = await resolveAllowedPlantCodes(req);
  if (allowedPlantCodes !== null) {
    params.push(Array.from(allowedPlantCodes));
    clauses.push(`LOWER(TRIM(s."Plant_Code")) = ANY($${params.length}::text[])`);
  }

  const { plantCode, companyCode } = req.query;
  if (plantCode) {
    params.push(String(plantCode));
    clauses.push(`LOWER(TRIM(s."Plant_Code")) = LOWER(TRIM($${params.length}))`);
  }
  if (companyCode) {
    params.push(String(companyCode));
    clauses.push(
      `s."Plant_Code" IN (SELECT plant_code::text FROM "plant" WHERE "Company_Id" = (SELECT "Company_Id" FROM "Mst_Company" WHERE "Company_Code" = $${params.length}))`
    );
  }
  return clauses.length ? `AND ${clauses.join(' AND ')}` : '';
}

// Clamps a caller-supplied date range to at most 90 days, defaulting to
// "today only" when no range is given - used by the raw log list (dashboard
// table shows today only) and honored as an explicit override for Excel
// export (up to the 90-day cap).
function resolveDateRange(req) {
  const { from, to } = req.query;
  if (!from && !to) {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }
  let start = from ? new Date(`${from}T00:00:00`) : null;
  let end = to ? new Date(`${to}T23:59:59.999`) : null;
  if (!start) start = new Date((end || new Date()).getTime() - 90 * 24 * 60 * 60 * 1000);
  if (!end) end = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
  const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
  if (end.getTime() - start.getTime() > MAX_RANGE_MS) {
    start = new Date(end.getTime() - MAX_RANGE_MS);
  }
  return { start, end };
}

// Every message is written by smsNotificationService.js with one of two
// fixed prefixes - "STOP:" when a line goes down, "LINE RUNNING:" once it's
// resolved - so the type can be derived from the message text itself rather
// than needing a new column. Parameterized by alias since different queries
// reference the table as bare columns or as "s".
function messageTypeSql(col) {
  return `CASE
  WHEN ${col} LIKE 'STOP:%' THEN 'Not Running'
  WHEN ${col} LIKE 'LINE RUNNING:%' THEN 'Solved'
  ELSE 'Other'
END`;
}
const MESSAGE_TYPE_SQL = messageTypeSql('"Message"');

// Both processStops()/processStarts() in smsNotificationService.js embed the
// stoppage's problem type as the first token right after "STOP:"/"LINE RUNNING:"
// (the .NET format: "STOP:Machine - Module - Line - ..."; older rows carry the
// numeric Type_Code instead), before " - ". Pull that token back out so it can
// be joined to Mst_Type (by Id or by Type_Desc) for a human-readable BD Type name.
function extractedTypeCodeSql(col) {
  return `TRIM(SPLIT_PART(SPLIT_PART(${col}, ':', 2), ' - ', 1))`;
}

// GET the raw log list, scoped by role + optional plantCode/companyCode
// filters, defaulting to TODAY ONLY (the dashboard table's requirement) -
// pass from/to (YYYY-MM-DD) to widen the range for Excel export, capped at
// 90 days server-side regardless of what the client requests.
// Gateway_Response is optional - if that column hasn't been migrated in yet,
// this falls back to selecting without it instead of failing the whole
// request (which, via the frontend's Promise.all, would otherwise blank out
// the entire SMS Log dashboard - KPI and trending included - over one
// missing column).
router.get('/', authMiddleware, async (req, res) => {
  try {
    const params = [];
    const filterClause = await buildScopeAndFilters(req, params);
    const { start, end } = resolveDateRange(req);
    params.push(start, end);
    const dateClause = `AND s."Date_Time" >= $${params.length - 1} AND s."Date_Time" < $${params.length}`;

    let rows;
    try {
      ({ rows } = await db.query(
        `SELECT s."Id", s."Date_Time", s."Plant_Code", s."User_Name", s."Mobile_No", s."Message", s."Gateway_Response",
                ${messageTypeSql('s."Message"')} AS "Message_Type"
         FROM "Trn_SMS_Log" s
         WHERE 1=1 ${filterClause} ${dateClause}
         ORDER BY s."Date_Time" DESC
         LIMIT 5000`,
        params
      ));
    } catch (colErr) {
      if (colErr.code !== '42703') throw colErr;
      ({ rows } = await db.query(
        `SELECT s."Id", s."Date_Time", s."Plant_Code", s."User_Name", s."Mobile_No", s."Message",
                ${messageTypeSql('s."Message"')} AS "Message_Type"
         FROM "Trn_SMS_Log" s
         WHERE 1=1 ${filterClause} ${dateClause}
         ORDER BY s."Date_Time" DESC
         LIMIT 5000`,
        params
      ));
    }
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching SMS log:', error);
    res.status(500).json({ message: 'Error retrieving SMS log.' });
  }
});

// GET per-plant KPI counts, scoped by role - split into Not Running (STOP)
// vs Solved (LINE RUNNING) counts, plus the total, per plant.
router.get('/kpi', authMiddleware, async (req, res) => {
  try {
    const allowedPlantCodes = await resolveAllowedPlantCodes(req);
    const { clause, param } = buildPlantFilter(allowedPlantCodes, 1);
    const params = param ? [param] : [];
    const { rows } = await db.query(
      `SELECT
         s."Plant_Code",
         COALESCE(p.plant_name, s."Plant_Code") AS plant_name,
         COUNT(*) AS message_count,
         COUNT(*) FILTER (WHERE ${messageTypeSql('s."Message"')} = 'Not Running') AS not_running_count,
         COUNT(*) FILTER (WHERE ${messageTypeSql('s."Message"')} = 'Solved') AS solved_count
       FROM "Trn_SMS_Log" s
       LEFT JOIN "plant" p ON CAST(s."Plant_Code" AS VARCHAR) = CAST(p.plant_code AS VARCHAR)
       WHERE 1=1 ${clause}
       GROUP BY s."Plant_Code", p.plant_name
       ORDER BY message_count DESC`,
      params
    );
    res.status(200).json(rows.map((r) => ({
      ...r,
      message_count: Number(r.message_count),
      not_running_count: Number(r.not_running_count),
      solved_count: Number(r.solved_count),
    })));
  } catch (error) {
    console.error('Error fetching SMS log KPI:', error);
    res.status(500).json({ message: 'Error retrieving SMS log KPI data.' });
  }
});

// Resolves the [start, end) day range for a given month/year query pair,
// defaulting to the CURRENT month when neither is supplied.
function resolveMonthRange(req) {
  const now = new Date();
  const year = Number(req.query.year) || now.getFullYear();
  const month = Number(req.query.month) || (now.getMonth() + 1); // 1-12
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return { start, end };
}

// GET daily trending counts for the "Monthly SMS Usage Trend" chart - scoped
// by role, defaulting to the CURRENT month, with optional plantCode/
// companyCode filters (in addition to, not instead of, the role scope).
// Falls back to a rolling N-day window (legacy ?days= param) only when no
// month/year is given, so nothing else that already calls this breaks.
router.get('/trending', authMiddleware, async (req, res) => {
  try {
    const params = [];
    const filterClause = await buildScopeAndFilters(req, params);

    let start, end;
    if (req.query.month || req.query.year) {
      ({ start, end } = resolveMonthRange(req));
    } else if (req.query.days) {
      const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
      end = new Date();
      start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    } else {
      ({ start, end } = resolveMonthRange(req));
    }
    params.push(start, end);
    const dateClause = `AND s."Date_Time" >= $${params.length - 1} AND s."Date_Time" < $${params.length}`;

    const { rows } = await db.query(
      `SELECT
         TO_CHAR(s."Date_Time", 'YYYY-MM-DD') AS day,
         COUNT(*) AS message_count,
         COUNT(*) FILTER (WHERE ${messageTypeSql('s."Message"')} = 'Not Running') AS not_running_count,
         COUNT(*) FILTER (WHERE ${messageTypeSql('s."Message"')} = 'Solved') AS solved_count
       FROM "Trn_SMS_Log" s
       WHERE 1=1 ${dateClause} ${filterClause}
       GROUP BY day
       ORDER BY day ASC`,
      params
    );
    res.status(200).json(rows.map((r) => ({
      day: r.day,
      message_count: Number(r.message_count),
      not_running_count: Number(r.not_running_count),
      solved_count: Number(r.solved_count),
    })));
  } catch (error) {
    console.error('Error fetching SMS log trending data:', error);
    res.status(500).json({ message: 'Error retrieving SMS log trending data.' });
  }
});

// GET BD (problem) Type-wise SMS counts for the selected month/year, scoped
// by role with optional plantCode/companyCode filters - the Type_Code is
// recovered from the message text (see extractedTypeCodeSql) and resolved to
// its Type_Desc via Mst_Type. Rows whose type can't be resolved (blank code,
// or a plant/type combo no longer in Mst_Type) are grouped under "Other"
// rather than dropped, so the chart's total still matches the KPI total.
router.get('/bd-type-wise', authMiddleware, async (req, res) => {
  try {
    const params = [];
    const filterClause = await buildScopeAndFilters(req, params);
    const { start, end } = resolveMonthRange(req);
    params.push(start, end);
    const dateClause = `AND s."Date_Time" >= $${params.length - 1} AND s."Date_Time" < $${params.length}`;

    const { rows } = await db.query(
      `SELECT
         COALESCE(t."Type_Desc", 'Other') AS type_desc,
         COUNT(*) AS message_count
       FROM "Trn_SMS_Log" s
       LEFT JOIN "Mst_Type" t
         ON (t."Id"::text = ${extractedTypeCodeSql('s."Message"')}
             OR LOWER(TRIM(t."Type_Desc")) = LOWER(${extractedTypeCodeSql('s."Message"')}))
         AND t."Plant_Code"::text = s."Plant_Code"::text
       WHERE 1=1 ${dateClause} ${filterClause}
       GROUP BY COALESCE(t."Type_Desc", 'Other')
       ORDER BY message_count DESC`,
      params
    );
    res.status(200).json(rows.map((r) => ({
      type_desc: r.type_desc,
      message_count: Number(r.message_count),
    })));
  } catch (error) {
    console.error('Error fetching SMS log BD type-wise data:', error);
    res.status(500).json({ message: 'Error retrieving SMS log BD type-wise data.' });
  }
});

module.exports = router;
