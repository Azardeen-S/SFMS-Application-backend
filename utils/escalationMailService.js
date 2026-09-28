// Ports RaneSMSNew's daily 9:00-9:30 AM escalation-mail block
// (Mail_LineStopPending_Level1_2 / _Level3 / _Level4) into a JSON-config-driven
// Node job, same pattern as notificationSyncService.js / smsNotificationService.js.
//
// Legacy: SP usp_Trnlinestoppage_template -> tmp_mailingdata, then per plant/level
// query Mst_Empl_AutoMailSetting + Mst_Empl_AutomailSettingDtls_Reason for
// recipients and mail a table of pending stoppages, filtered by hours-pending
// (Level1/2 = all pending, Level3 = >24h, Level4 = >72h).
// tmp_mailingdata is replaced by a direct query against Trn_LineStoppage with
// hrs computed from Entry_Date, joined the same way sp_get_line_stoppages joins
// plant/Mst_Shop/Mst_Module/Mst_Line/Mst_Type (columns confirmed from
// sql/fix_stoppage_emp_fields.sql). Mail_Status (once-a-day guard) is now a
// real Postgres table (01_sms_automail_schema.sql) instead of the legacy one.
//
// Requires 01_sms_automail_schema.sql to have been run, and nodemailer:
//   npm install nodemailer
// Leave "enabled": false in escalationMail.json until recipients are migrated
// into Mst_Empl_AutoMailSetting / Mst_Empl_AutomailSettingDtls_Reason and the
// SMTP host below is confirmed still live.

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const db = require('../config/database');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'escalationMail.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function getTransport(config) {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: false,
    tls: { rejectUnauthorized: false },
  });
}

// Mail_Status already exists in this DB with columns (MailType, Dateval) - no
// SentDate/Id/unique constraint, so guard with a plain existence check instead
// of ON CONFLICT.
async function alreadySentToday(config) {
  const res = await db.query(
    `SELECT 1 FROM "Mail_Status" WHERE "MailType" = $1 AND "Dateval" = CURRENT_DATE`,
    [config.mailType]
  );
  return res.rows.length > 0;
}

async function markSentToday(config) {
  if (await alreadySentToday(config)) return;
  await db.query(`INSERT INTO "Mail_Status" ("MailType", "Dateval") VALUES ($1, CURRENT_DATE)`, [config.mailType]);
}

function inSendWindow(config) {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  if (h < config.windowStartHour) return false;
  if (h > config.windowEndHour) return false;
  if (h === config.windowEndHour && m > config.windowEndMinute) return false;
  return true;
}

async function getRecipients(plantCode, level) {
  const res = await db.query(
    `SELECT DISTINCT a."ID", a."EmailID"
     FROM "Mst_Empl_AutoMailSetting" a
     WHERE a."Plant_Code" = $1 AND a."Level_Name" = $2 AND a."Del_Status" = 'N'`,
    [plantCode, level]
  );
  return res.rows;
}

async function getReasonTypes(automailId, plantCode) {
  const res = await db.query(
    `SELECT DISTINCT r."Reason_Code", r."Reason_Name"
     FROM "Mst_Empl_AutomailSettingDtls_Reason" r
     WHERE r."ID" = $1 AND r."Plant_Code" = $2`,
    [automailId, plantCode]
  );
  return res.rows;
}

// Mirrors sp_get_line_stoppages' joins (plant/Mst_Shop/Mst_Module/Mst_Line/Mst_Type)
// so this reports the same names the ticket list already shows.
async function getPendingRows(plantCode, typeCode, minHours) {
  const res = await db.query(
    `SELECT t."Id", t.servicetype, s."Shop_Name", m."Module_Name", l."Line_Name",
            (SELECT mc."Mchn_Name" FROM "Mst_Machine" mc WHERE TRIM(mc."Mchn_code"::text) = TRIM(t."Machine_Code"::text) LIMIT 1) AS mchn_name,
            t."Entry_Date", t."Reason",
            EXTRACT(EPOCH FROM (now() - t."Entry_Date")) / 3600.0 AS hrs
     FROM "Trn_LineStoppage" t
     LEFT JOIN "Mst_Shop" s ON t."Shop_Code" = s."Shop_code"
     LEFT JOIN "Mst_Module" m ON t."Module_Code" = m."Module_Code"
     LEFT JOIN "Mst_Line" l ON t."Line_Code" = l."Line_code"
     WHERE t."Del_Status" = 'N' AND t."Plant_Code" = $1 AND t."Type_Code"::text = $2::text
       AND t."Close_Date" IS NULL
       AND EXTRACT(EPOCH FROM (now() - t."Entry_Date")) / 3600.0 > $3
     ORDER BY t."Entry_Date"`,
    [plantCode, typeCode, minHours]
  );
  return res.rows;
}

function buildTableHtml(rows, typeDesc, level) {
  let html = `<br/><center><table style="width:80%;border-collapse:collapse;"><tr>` +
    `<th colspan="9" style="background-color:#A7C942;color:#fff;">${typeDesc} - ${level}</th></tr>` +
    `<tr>${['SlNo', 'Type', 'Shop', 'Module', 'Line', 'Machine', 'Entry Date', 'Reason', 'Hrs.']
      .map((h) => `<th style="background-color:#A7C942;color:#fff;padding:3px 7px;">${h}</th>`)
      .join('')}</tr>`;
  let totalHrs = 0;
  rows.forEach((row, i) => {
    totalHrs += Number(row.hrs) || 0;
    html += `<tr>` +
      `<td align="center">${i + 1}</td>` +
      `<td align="center">${row.servicetype || ''}</td>` +
      `<td align="center">${row.Shop_Name || ''}</td>` +
      `<td align="center">${row.Module_Name || ''}</td>` +
      `<td align="center">${row.Line_Name || ''}</td>` +
      `<td align="center">${row.mchn_name || ''}</td>` +
      `<td align="center">${row.Entry_Date || ''}</td>` +
      `<td align="center">${row.Reason || ''}</td>` +
      `<td align="center">${(row.hrs || 0).toFixed(1)}</td>` +
      `</tr>`;
  });
  html += `<tr><th colspan="8" align="right">Total Hours</th><td align="center">${totalHrs.toFixed(1)}</td></tr></table></center>`;
  return html;
}

async function sendLevelMail(transport, config, plantCode, plantName, level, minHours, closingLine) {
  const recipients = await getRecipients(plantCode, level);
  for (const recip of recipients) {
    const reasonTypes = await getReasonTypes(recip.ID, plantCode);
    let body = '';
    for (const rt of reasonTypes) {
      const rows = await getPendingRows(plantCode, rt.Reason_Code, minHours);
      if (rows.length > 0) {
        body += buildTableHtml(rows, rt.Reason_Name, level);
      }
    }
    if (!body) continue;

    const subject = `${plantName} - SFMS-Line Stoppage Escalation as on ${new Date().toLocaleDateString('en-GB')} - 9:00 AM ( ${level} )`;
    const html =
      `<html><body><p>Dear Sir / Madam,</p><p>The enclosed list of machines are not started due to ` +
      `line stoppage intimations are not responded on time.</p><p>${closingLine}</p>${body}</body></html>`;

    try {
      await transport.sendMail({ from: config.fromAddress, to: recip.EmailID, subject, html });
      console.log(`[EscalationMail] Sent ${level} mail for ${plantCode} to ${recip.EmailID}`);
    } catch (err) {
      console.error(`[EscalationMail] Failed to send to ${recip.EmailID}:`, err.message);
    }
  }
}

async function getPlants() {
  const res = await db.query(`SELECT plant_code, plant_name FROM "plant" WHERE del_status = 'N'`);
  return res.rows;
}

async function runOnce() {
  const config = loadConfig();
  if (!config.enabled) return;
  if (!inSendWindow(config)) return;
  if (await alreadySentToday(config)) return;

  const transport = getTransport(config);
  try {
    const plants = await getPlants();
    for (const p of plants) {
      await sendLevelMail(transport, config, p.plant_code, p.plant_name, 'Level1', -1, 'Kindly take appropriate action and close the stoppages immediately in SFMS.');
      await sendLevelMail(transport, config, p.plant_code, p.plant_name, 'Level2', -1, 'Kindly take appropriate action and close the stoppages immediately in SFMS.');
      await sendLevelMail(transport, config, p.plant_code, p.plant_name, 'Level3', 24, 'Kindly review & take appropriate actions to start the machines.');
      await sendLevelMail(transport, config, p.plant_code, p.plant_name, 'Level4', 72, 'Kindly review & take appropriate actions to start the machines.');
    }
    await markSentToday(config);
  } catch (err) {
    console.error('[EscalationMail] Run error:', err.message);
  }
}

let timer = null;

function scheduleNext() {
  const config = loadConfig();
  const delayMs = Math.max(30, config.checkIntervalSeconds) * 1000;
  timer = setTimeout(async () => {
    await runOnce();
    scheduleNext();
  }, delayMs);
}

function startEscalationMail() {
  const config = loadConfig();
  console.log(`[EscalationMail] Starting (enabled=${config.enabled}, window ${config.windowStartHour}:00-${config.windowEndHour}:${config.windowEndMinute}). Config: config/escalationMail.json`);
  scheduleNext();
}

function stopEscalationMail() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { startEscalationMail, stopEscalationMail, runOnce, loadConfig };
