// Ports RaneSMSNew's Timer1_Tick -> LineStoppageNavigate() / LineStartNavigate()
// into a JSON-config-driven Node background job, same pattern as notificationSyncService.js.
//
// Legacy flow being replaced (read from the legacy SQL Server database script):
//   VB timer -> SP Usp_LineStoppage_SmsSend1New -> temp_sms     -> GET smartsms.net.in  ("STOP:" SMS)
//   VB timer -> SP Usp_LineStoppage_StartSms_K1 -> temp_smsdtl  -> GET smartsms.net.in  ("LINE RUNNING:" SMS)
//
// Same behaviour here, on Trn_LineStoppage:
//  * ESCALATION (processStops). An open ticket (Close_Date IS NULL, Start_status IS NULL) moves through
//    "Status" = NULL -> Level1 -> Level2 -> Level3 -> Level4. Each step happens once the ticket has been
//    open for that level's minutes (Mst_Employee_SMS.Level1..Level4, per problem type + plant; usually
//    0 / 240 / 1440 / 4320). One level per run. Level2+ never apply to servicetype = 'Service'.
//    When a level is reached its Status is saved and an SMS goes to that level's recipients
//    (Mst_Empl_SMSSetting rows with Level_Name = that level, Sms_Type = 'Line Stoppage', same
//    plant/shop/module/problem type, employee active in Mst_Employee by Emp_No).
//  * RESTORATION (processStarts). A closed ticket whose Start_status IS NULL gets a "LINE RUNNING:" SMS to
//    the recipients of every level it reached (Level1 .. its final level; Level1 if it never escalated),
//    then Start_status = 'Sent'. Closed tickets older than the start watermark are just marked 'Sent'.
//  * "Status" therefore means "escalation level reached", exactly as in the .NET database - it is not an
//    open/closed flag (use Close_Date for that). trnLineStoppage.js leaves it NULL on create and
//    untouched on close.
//
// Config (config/smsNotification.json): "stopFromDate" / "startFromDate" are the legacy watermarks
// (Entry_Date >= / Close_Date >=) below which tickets are ignored. The .NET values were
// 2023-05-15 15:20 and 2025-05-14 09:00. SET THEM TO THE GO-LIVE DATE when this app takes over from the
// .NET job, otherwise old still-open tickets imported from the legacy database are escalated again.
//
// Requires SMS_GATEWAY_UNAME / SMS_GATEWAY_PWD set in .env. Leave "enabled": false in
// smsNotification.json until you've confirmed the gateway URL/creds are still correct.

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const db = require('../config/database');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'smsNotification.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function httpGet(url) {
  const client = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    client
      .get(url, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(body));
      })
      .on('error', reject);
  });
}

async function sendSms(config, mobile, message, tempId) {
  const uname = process.env.SMS_GATEWAY_UNAME;
  const pwd = process.env.SMS_GATEWAY_PWD;
  if (!uname || !pwd) {
    console.error('[SmsNotification] SMS_GATEWAY_UNAME / SMS_GATEWAY_PWD not set in .env - skipping send');
    return;
  }
  const url =
    `${config.gatewayBaseUrl}?uname=${encodeURIComponent(uname)}&pwd=${encodeURIComponent(pwd)}` +
    `&senderid=${config.senderId}&to=${encodeURIComponent(mobile)}&msg=${encodeURIComponent(message)}` +
    `&route=${config.route}&peid=${config.peid}&tempid=${tempId}`;
  try {
    const responseBody = await httpGet(url);
    console.log(`[SmsNotification] Gateway response for ${mobile}: ${responseBody}`);
    return responseBody;
  } catch (err) {
    console.error(`[SmsNotification] Failed to send to ${mobile}:`, err.message);
    return null;
  }
}

// SMS Log (Trn_SMS_Log): one row per message actually sent, for the SMS Log
// dashboard (trending + per-plant KPI counts). "Id" has no DB-side default,
// same convention as every other table in this schema. Gateway_Response is
// optional - falls back to inserting without it if that column hasn't been
// migrated in yet, so logging never blocks (or looks broken) either way.
async function logSms(plantCode, userName, mobile, message, gatewayResponse) {
  try {
    await db.query(
      `INSERT INTO "Trn_SMS_Log" ("Id", "Date_Time", "Plant_Code", "User_Name", "Mobile_No", "Message", "Gateway_Response")
       VALUES ((SELECT COALESCE(MAX("Id"), 0) + 1 FROM "Trn_SMS_Log"), NOW(), $1, $2, $3, $4, $5)`,
      [plantCode, userName || null, mobile || null, message, gatewayResponse || null]
    );
  } catch (err) {
    if (err.code === '42703') {
      // Gateway_Response column not migrated in yet - retry without it.
      try {
        await db.query(
          `INSERT INTO "Trn_SMS_Log" ("Id", "Date_Time", "Plant_Code", "User_Name", "Mobile_No", "Message")
           VALUES ((SELECT COALESCE(MAX("Id"), 0) + 1 FROM "Trn_SMS_Log"), NOW(), $1, $2, $3, $4)`,
          [plantCode, userName || null, mobile || null, message]
        );
        return;
      } catch (retryErr) {
        console.warn('[SmsNotification] Could not write to Trn_SMS_Log:', retryErr.message);
        return;
      }
    }
    // Trn_SMS_Log may not exist yet in an environment that hasn't run
    // 01_migration.sql - never let logging failure block the actual SMS send.
    console.warn('[SmsNotification] Could not write to Trn_SMS_Log:', err.message);
  }
}

// The .NET watermarks were Entry_Date >= 2023-05-15 15:20 (stops) and Close_Date >= 2025-05-14 09:00 (starts).
// If config/smsNotification.json has no stopFromDate / startFromDate, fall back to the moment this service
// started instead - so a missing setting can never re-escalate the thousands of old tickets in the table.
// Taken from the DATABASE clock (as text, no time zone), because Entry_Date / Close_Date are stored in the
// database's local time - comparing them with a Node-side Date would shift the cutoff by the time zone.
let serviceStartedWall = null;
async function serviceStarted() {
  if (!serviceStartedWall) {
    const r = await db.query(`SELECT to_char(LOCALTIMESTAMP(3), 'YYYY-MM-DD HH24:MI:SS.MS') AS n`);
    serviceStartedWall = r.rows[0].n;
  }
  return serviceStartedWall;
}

// "yyyy/MM/dd HH:mm" in local time - the .NET service's CDate(...).ToString("yyyy/MM/dd HH:mm").
function fmtDateTime(d) {
  if (!d) return '';
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}/${p(x.getMonth() + 1)}/${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}`;
}

const trim = (v) => (v === null || v === undefined ? '' : String(v).trim());

// Recipients of one escalation level. Port of the legacy lookup: Mst_Empl_SMSSetting joined to its
// problem-type rows, same plant / shop / module, Level_Name = the level and Sms_Type = 'Line Stoppage'.
// Mst_Empl_SMSSetting.Emp_Id holds the employee NUMBER in the legacy rows (matched to Mst_Employee.Emp_No)
// but the internal Mst_Employee.Emp_Id in rows saved from this app's SMS Settings screen - so the employee
// is looked up by number first and by internal id second. Only active employees (Del_Status = 'N') of
// that plant get the SMS.
async function findMobiles(plantCode, typeCode, shopCode, moduleCode, level) {
  const res = await db.query(
    `SELECT DISTINCT s."Mobile_No", COALESCE(e1."Emp_Name", e2."Emp_Name") AS "Emp_Name"
     FROM "Mst_Empl_SMSSetting" s
     INNER JOIN "Mst_Empl_SMSSettingDtls" d
       ON d."Empl_SmsID" = s."sms_id" AND d."Plant_Code" = s."Plant_Code"
     LEFT JOIN "Mst_Employee" e1
       ON e1."Emp_No"::text = s."Emp_Id"::text AND e1."Plant_Code" = s."Plant_Code"
     LEFT JOIN "Mst_Employee" e2
       ON e1."Emp_Id" IS NULL AND e2."Emp_Id"::text = s."Emp_Id"::text AND e2."Plant_Code" = s."Plant_Code"
     WHERE s."Plant_Code" = $1
       AND d."Type_Code"::text = $2::text
       AND s."Shop_Code"::text = $3::text
       AND s."Module_Code"::text = $4::text
       AND s."Level_Name" = $5
       AND s."Sms_Type" = 'Line Stoppage'
       AND COALESCE(s."Del_Status", 'N') = 'N'
       AND COALESCE(e1."Del_Status", e2."Del_Status") = 'N'`,
    [plantCode, typeCode, shopCode, moduleCode, level]
  );
  return res.rows.filter((r) => r.Mobile_No).map((r) => ({ mobile: String(r.Mobile_No).trim(), empName: r.Emp_Name }));
}

// Display names used in the message text (the legacy SP resolved the same ones into temp_sms).
async function ticketNames(row) {
  const res = await db.query(
    `SELECT
       (SELECT tp."Type_Desc" FROM "Mst_Type" tp WHERE tp."Id"::text = $1::text AND tp."Plant_Code"::text = $2::text LIMIT 1) AS type_desc,
       (SELECT mc."Mchn_Name" FROM "Mst_Machine" mc WHERE TRIM(mc."Mchn_code"::text) = TRIM($3::text) AND mc."Plant_code"::text = $2::text LIMIT 1) AS mchn_name,
       (SELECT m."Module_Name" FROM "Mst_Module" m WHERE m."Module_Code"::text = $4::text LIMIT 1) AS module_name,
       (SELECT l."Line_Name" FROM "Mst_Line" l WHERE l."Line_code"::text = $5::text LIMIT 1) AS line_name,
       (SELECT g."Gap_Name" FROM "Mst_Gap" g WHERE g."Id"::text = $6::text AND g."Plant_Code"::text = $2::text LIMIT 1) AS reason_name`,
    [row.Type_Code, row.Plant_Code, row.Machine_Code, row.Module_Code, row.Line_Code, row.LineReason_Code]
  );
  return res.rows[0] || {};
}

async function sendAll(row, mobiles, message, tempIdKey) {
  for (const { mobile, empName } of mobiles) {
    const config = loadConfig();
    const gatewayResponse = await sendSms(config, mobile, message, config[tempIdKey]);
    await logSms(row.Plant_Code, empName, mobile, message, gatewayResponse);
  }
}

// ---- Escalation: Level1 -> Level4 (port of Usp_LineStoppage_SmsSend1New) -----------------------------
async function processStops() {
  const config = loadConfig();
  const res = await db.query(
    `WITH c AS (
       SELECT t."Id", t."Plant_Code", t."Type_Code", t."Shop_Code", t."Module_Code", t."Line_Code",
              t."Machine_Code", t."LineReason_Code", t."Entry_Date", t."Status", t."servicetype",
              CASE
                WHEN COALESCE(NULLIF(TRIM(t."Status"), ''), 'Nil status') ILIKE 'nil status' THEN 'Level1'
                WHEN TRIM(t."Status") = 'Level1' THEN 'Level2'
                WHEN TRIM(t."Status") = 'Level2' THEN 'Level3'
                WHEN TRIM(t."Status") = 'Level3' THEN 'Level4'
              END AS next_level
       FROM "Trn_LineStoppage" t
       WHERE t."Close_Date" IS NULL AND t."Start_status" IS NULL
         AND t."Entry_Date" >= $1::timestamp
         AND COALESCE(t."Del_Status", 'N') = 'N'
     )
     SELECT DISTINCT ON (c."Id") c.*
     FROM c
     INNER JOIN "Mst_Employee_SMS" es
       ON es."Type_Code"::text = c."Type_Code"::text AND es."Plant_Code"::text = c."Plant_Code"::text
     WHERE c.next_level IS NOT NULL
       AND (c.next_level = 'Level1' OR COALESCE(c."servicetype", '') <> 'Service')
       AND c."Entry_Date" + NULLIF(TRIM((CASE c.next_level
             WHEN 'Level1' THEN es."Level1" WHEN 'Level2' THEN es."Level2"
             WHEN 'Level3' THEN es."Level3" ELSE es."Level4" END)::text), '')::numeric * INTERVAL '1 minute' <= NOW()
     ORDER BY c."Id"`,
    [config.stopFromDate || (await serviceStarted())]
  );

  for (const row of res.rows) {
    // Claim the level first (only if nobody advanced the ticket meanwhile), like the legacy SP's UPDATE.
    const claim = await db.query(
      `UPDATE "Trn_LineStoppage" SET "Status" = $1
       WHERE "Id" = $2 AND "Plant_Code" = $3 AND "Status" IS NOT DISTINCT FROM $4::varchar`,
      [row.next_level, row.Id, row.Plant_Code, row.Status]
    );
    if (claim.rowCount === 0) continue;

    const mobiles = await findMobiles(row.Plant_Code, row.Type_Code, row.Shop_Code, row.Module_Code, row.next_level);
    console.log(`[SmsNotification] Ticket ${row.Id} reached ${row.next_level} (plant ${row.Plant_Code}, type ${row.Type_Code}, shop ${row.Shop_Code}, module ${row.Module_Code}): ${mobiles.length} recipient(s)`);
    if (mobiles.length === 0) continue;
    const n = await ticketNames(row);
    if (!trim(n.reason_name)) {
      console.warn(`[SmsNotification] Ticket ${row.Id}: no Mst_Gap name for reason code ${row.LineReason_Code} - not sent (as the legacy SP)`);
      continue; // legacy only sent rows that had a resolved reason
    }

    const message =
      `STOP:${trim(n.type_desc)} - ${trim(n.module_name)} - ${trim(n.line_name)} - ${trim(n.mchn_name)} ` +
      `is not running due to ${trim(n.reason_name)}-- ${fmtDateTime(row.Entry_Date)} - RML SMS`;
    await sendAll(row, mobiles, message, 'tempIdStop');
  }
}

// ---- Restoration SMS (port of Usp_LineStoppage_StartSms_K1) -------------------------------------------
async function processStarts() {
  const config = loadConfig();
  const from = config.startFromDate || (await serviceStarted());
  const res = await db.query(
    `SELECT t."Id", t."Plant_Code", t."Type_Code", t."Shop_Code", t."Module_Code", t."Line_Code",
            t."Machine_Code", t."LineReason_Code", t."Close_Date", t."Status",
            FLOOR(EXTRACT(EPOCH FROM (t."Close_Date" - t."Entry_Date")) / 3600)::int AS hrs,
            MOD(FLOOR(EXTRACT(EPOCH FROM (t."Close_Date" - t."Entry_Date")) / 60)::int, 60) AS mins
     FROM "Trn_LineStoppage" t
     WHERE t."Close_Date" IS NOT NULL AND t."Start_status" IS NULL
       AND t."Close_Date" >= $1::timestamp
       AND COALESCE(t."Del_Status", 'N') = 'N'
     ORDER BY t."Id"`,
    [from]
  );

  for (const row of res.rows) {
    const claim = await db.query(
      `UPDATE "Trn_LineStoppage" SET "Start_status" = 'Sent' WHERE "Id" = $1 AND "Start_status" IS NULL`,
      [row.Id]
    );
    if (claim.rowCount === 0) continue;

    // Everybody who was alerted on the way up gets told the line is running again:
    // Level1 .. the last level reached (just Level1 if the ticket never escalated).
    const m = /^Level(\d)$/.exec(trim(row.Status));
    const lastLevel = m ? Math.min(Number(m[1]), 4) : 1;
    const seen = new Set();
    const mobiles = [];
    for (let i = 1; i <= lastLevel; i++) {
      for (const r of await findMobiles(row.Plant_Code, row.Type_Code, row.Shop_Code, row.Module_Code, `Level${i}`)) {
        if (!seen.has(r.mobile)) { seen.add(r.mobile); mobiles.push(r); }
      }
    }
    console.log(`[SmsNotification] Ticket ${row.Id} closed (reached up to Level${lastLevel}): ${mobiles.length} recipient(s) for the restoration SMS`);
    if (mobiles.length === 0) continue;
    const n = await ticketNames(row);

    const totalHrs = `${row.hrs}:${String(row.mins).padStart(2, '0')}`;
    const message =
      `LINE RUNNING:${trim(n.type_desc)} - ${trim(n.module_name)} - ${trim(n.line_name)} - ${trim(n.mchn_name)} ` +
      `M/C Problem -- Solved from-${fmtDateTime(row.Close_Date)}  Onwards and B/D HRS -${totalHrs} - RML SMS`;
    await sendAll(row, mobiles, message, 'tempIdStart');
  }

  // As the legacy SP did: tickets closed before the watermark are never texted, just marked as done.
  await db.query(
    `UPDATE "Trn_LineStoppage" SET "Start_status" = 'Sent'
     WHERE "Close_Date" IS NOT NULL AND "Start_status" IS NULL AND "Close_Date" < $1::timestamp`,
    [from]
  );
}

async function runOnce() {
  const config = loadConfig();
  if (!config.enabled) return;
  try {
    await processStops();
    await processStarts();
  } catch (err) {
    console.error('[SmsNotification] Run error:', err.message);
  }
}

let timer = null;

function scheduleNext() {
  const config = loadConfig();
  const delayMs = Math.max(5, config.intervalSeconds) * 1000;
  timer = setTimeout(async () => {
    await runOnce();
    scheduleNext();
  }, delayMs);
}

function startSmsNotification() {
  const config = loadConfig();
  console.log(`[SmsNotification] Starting (enabled=${config.enabled}, every ${config.intervalSeconds}s). Config: config/smsNotification.json`);
  scheduleNext();
}

function stopSmsNotification() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { startSmsNotification, stopSmsNotification, runOnce, loadConfig };
