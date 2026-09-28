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

// Every message is written by smsNotificationService.js with one of two
// fixed prefixes - "STOP:" when a line goes down, "LINE RUNNING:" once it's
// resolved - so the type can be derived from the message text itself rather
// than needing a new column.
const MESSAGE_TYPE_SQL = `CASE
  WHEN "Message" LIKE 'STOP:%' THEN 'Not Running'
  WHEN "Message" LIKE 'LINE RUNNING:%' THEN 'Solved'
  ELSE 'Other'
END`;

// GET the raw log list (most recent first), scoped by role. Gateway_Response
// is optional - if that column hasn't been migrated in yet, this falls back
// to selecting without it instead of failing the whole request (which, via
// the frontend's Promise.all, would otherwise blank out the entire SMS Log
// dashboard - KPI and trending included - over one missing column).
router.get('/', authMiddleware, async (req, res) => {
  try {
    const allowedPlantCodes = await resolveAllowedPlantCodes(req);
    const { clause, param } = buildPlantFilter(allowedPlantCodes, 1);
    const params = param ? [param] : [];
    let rows;
    try {
      ({ rows } = await db.query(
        `SELECT "Id", "Date_Time", "Plant_Code", "User_Name", "Mobile_No", "Message", "Gateway_Response",
                ${MESSAGE_TYPE_SQL} AS "Message_Type"
         FROM "Trn_SMS_Log"
         WHERE 1=1 ${clause}
         ORDER BY "Date_Time" DESC
         LIMIT 500`,
        params
      ));
    } catch (colErr) {
      if (colErr.code !== '42703') throw colErr;
      ({ rows } = await db.query(
        `SELECT "Id", "Date_Time", "Plant_Code", "User_Name", "Mobile_No", "Message",
                ${MESSAGE_TYPE_SQL} AS "Message_Type"
         FROM "Trn_SMS_Log"
         WHERE 1=1 ${clause}
         ORDER BY "Date_Time" DESC
         LIMIT 500`,
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
         COUNT(*) FILTER (WHERE ${MESSAGE_TYPE_SQL.replace(/"Message"/g, 's."Message"')} = 'Not Running') AS not_running_count,
         COUNT(*) FILTER (WHERE ${MESSAGE_TYPE_SQL.replace(/"Message"/g, 's."Message"')} = 'Solved') AS solved_count
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

// GET daily trending counts (last N days, default 30), scoped by role -
// split into Not Running (STOP) vs Solved (LINE RUNNING) per day.
router.get('/trending', authMiddleware, async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  try {
    const allowedPlantCodes = await resolveAllowedPlantCodes(req);
    const { clause, param } = buildPlantFilter(allowedPlantCodes, 2);
    const params = param ? [days, param] : [days];
    const { rows } = await db.query(
      `SELECT
         TO_CHAR("Date_Time", 'YYYY-MM-DD') AS day,
         COUNT(*) AS message_count,
         COUNT(*) FILTER (WHERE ${MESSAGE_TYPE_SQL} = 'Not Running') AS not_running_count,
         COUNT(*) FILTER (WHERE ${MESSAGE_TYPE_SQL} = 'Solved') AS solved_count
       FROM "Trn_SMS_Log"
       WHERE "Date_Time" >= NOW() - ($1::int || ' days')::interval ${clause}
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

module.exports = router;
