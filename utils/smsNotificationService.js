// Ports RaneSMSNew's Timer1_Tick -> LineStoppageNavigate() / LineStartNavigate()
// into a JSON-config-driven Node background job, same pattern as notificationSyncService.js.
//
// Legacy flow being replaced:
//   VB timer (30s) -> SP Usp_LineStoppage_SmsSend1New -> temp_sms -> GET smartsms.net.in
//   VB timer (30s) -> SP Usp_LineStoppage_StartSms_K1 -> temp_smsdtl -> GET smartsms.net.in
// Here both SPs + staging tables are replaced by direct queries against
// Trn_LineStoppage (real columns confirmed from sql/fix_create_stoppage_sp.sql /
// fix_stoppage_missing_fields.sql: Id, Plant_Code, Shop_Code, Module_Code,
// Line_Code, Machine_Code, Type_Code, LineReason_Code, Reason, Entry_Date,
// Close_Date, Del_Status) joined to Mst_Empl_SMSSetting for the mobile number.
// The legacy "id >= 373335" watermark hack is replaced by the Sms_Sent_Stop /
// Sms_Sent_Start flag columns (added by 01_sms_automail_schema.sql).
//
// Requires 01_sms_automail_schema.sql to have been run, and SMS_GATEWAY_UNAME /
// SMS_GATEWAY_PWD set in .env. Leave "enabled": false in smsNotification.json
// until you've confirmed the gateway URL/creds are still correct.

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

// Matches Mst_Empl_SMSSetting the same way the legacy config UI scoped it:
// by plant + type-code, with Module_Code as an optional (NULL = wildcard) filter.
// Real column types confirmed via information_schema: sms_id/Module_Code are
// bigint, Type_Code (dtls) is bigint, Del_Status is 'N'/'Y' like elsewhere in
// this schema - Trn_LineStoppage.Type_Code/Module_Code are cast to match.
// Also excludes employees marked inactive in Mst_Employee (Del_Status <> 'N'),
// joined via Mst_Empl_SMSSetting.Emp_Id = Mst_Employee.Emp_Id - an inactive
// employee stops receiving SMS even if their SMSSetting row is still Del_Status='N'.
async function findMobiles(plantCode, typeCode, moduleCode) {
  const res = await db.query(
    `SELECT DISTINCT s."Mobile_No", e."Emp_Name"
     FROM "Mst_Empl_SMSSetting" s
     INNER JOIN "Mst_Empl_SMSSettingDtls" d
       ON d."Empl_SmsID" = s."sms_id" AND d."Plant_Code" = s."Plant_Code"
     INNER JOIN "Mst_Employee" e
       ON e."Emp_Id"::text = s."Emp_Id"::text
     WHERE s."Plant_Code" = $1
       AND s."Del_Status" = 'N'
       AND e."Del_Status" = 'N'
       AND d."Type_Code"::text = $2::text
       AND (s."Module_Code" IS NULL OR s."Module_Code" = $3::bigint)`,
    [plantCode, typeCode, moduleCode]
  );
  return res.rows.filter((r) => r.Mobile_No).map((r) => ({ mobile: r.Mobile_No, empName: r.Emp_Name }));
}

async function processStops() {
  const res = await db.query(
    `SELECT t."Id", t."Plant_Code", t."Line_Code", t."Machine_Code", t."Type_Code", t."Module_Code",
            t."Reason", t."Entry_Date", l."Line_Name",
            (SELECT mc."Mchn_Name" FROM "Mst_Machine" mc WHERE TRIM(mc."Mchn_code"::text) = TRIM(t."Machine_Code"::text) LIMIT 1) AS mchn_name
     FROM "Trn_LineStoppage" t
     LEFT JOIN "Mst_Line" l ON t."Line_Code" = l."Line_code"
     WHERE t."Del_Status" = 'N' AND t."Close_Date" IS NULL
       AND (t."Sms_Sent_Stop" IS NULL OR t."Sms_Sent_Stop" = false)`
  );

  for (const row of res.rows) {
    const mobiles = await findMobiles(row.Plant_Code, row.Type_Code, row.Module_Code);
    if (mobiles.length === 0) continue;

    const message =
      `STOP:${row.Type_Code || ''} - ${row.Line_Name || row.Line_Code || ''} - ` +
      `${row.mchn_name || row.Machine_Code || ''} is not running due to ${row.Reason || ''} - ` +
      `${row.Entry_Date ? new Date(row.Entry_Date).toISOString().slice(0, 16).replace('T', ' ') : ''} - RML SMS`;

    for (const { mobile, empName } of mobiles) {
      const config = loadConfig();
      const gatewayResponse = await sendSms(config, mobile, message, config.tempIdStop);
      await logSms(row.Plant_Code, empName, mobile, message, gatewayResponse);
    }
    await db.query('UPDATE "Trn_LineStoppage" SET "Sms_Sent_Stop" = true WHERE "Id" = $1', [row.Id]);
  }
}

async function processStarts() {
  const res = await db.query(
    `SELECT t."Id", t."Plant_Code", t."Line_Code", t."Machine_Code", t."Type_Code", t."Module_Code",
            t."Entry_Date", t."Close_Date", l."Line_Name",
            (SELECT mc."Mchn_Name" FROM "Mst_Machine" mc WHERE TRIM(mc."Mchn_code"::text) = TRIM(t."Machine_Code"::text) LIMIT 1) AS mchn_name,
            EXTRACT(EPOCH FROM (t."Close_Date" - t."Entry_Date")) / 3600.0 AS total_hrs
     FROM "Trn_LineStoppage" t
     LEFT JOIN "Mst_Line" l ON t."Line_Code" = l."Line_code"
     WHERE t."Del_Status" = 'N' AND t."Close_Date" IS NOT NULL
       AND (t."Sms_Sent_Start" IS NULL OR t."Sms_Sent_Start" = false)`
  );

  for (const row of res.rows) {
    const mobiles = await findMobiles(row.Plant_Code, row.Type_Code, row.Module_Code);
    if (mobiles.length === 0) continue;

    const message =
      `LINE RUNNING:${row.Type_Code || ''} - ${row.Line_Name || row.Line_Code || ''} - ` +
      `${row.mchn_name || row.Machine_Code || ''} M/C Problem - Solved from-` +
      `${row.Entry_Date ? new Date(row.Entry_Date).toISOString().slice(0, 16).replace('T', ' ') : ''} ` +
      `Onwards and B/D HRS -${(Number(row.total_hrs) || 0).toFixed(1)} - RML SMS`;

    for (const { mobile, empName } of mobiles) {
      const config = loadConfig();
      const gatewayResponse = await sendSms(config, mobile, message, config.tempIdStart);
      await logSms(row.Plant_Code, empName, mobile, message, gatewayResponse);
    }
    await db.query('UPDATE "Trn_LineStoppage" SET "Sms_Sent_Start" = true WHERE "Id" = $1', [row.Id]);
  }
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
