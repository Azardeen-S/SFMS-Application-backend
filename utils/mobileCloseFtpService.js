// Ports the legacy "Mobile App FTP file drop" clmobilefile.js / Get_CL_Mobile_app poller.
// The mobile APK closes a ticket by writing Close_Date and M_Status = 'Y' straight into
// Trn_LineStoppage. This job finds those rows, sends the same CL file the web close sends
// (handleLineStoppageCloseFTP), then sets M_Status = 'C'. Config: config/mobileCloseFtp.json
// (re-read every tick). A row stays 'Y' until the upload succeeds, so failures retry.

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { handleLineStoppageCloseFTP } = require('./ftpService');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'mobileCloseFtp.json');

function loadConfig() {
  const defaults = { enabled: true, intervalSeconds: 60, batchSize: 20 };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch (err) {
    console.warn(`[MobileCloseFtp] Could not read ${CONFIG_PATH}, using defaults:`, err.message);
    return defaults;
  }
}

async function findPending(limit) {
  const res = await db.query(
    `SELECT t."Id"
     FROM "Trn_LineStoppage" t
     WHERE t."M_Status" = 'Y'
       AND t."Close_Date" IS NOT NULL
       AND COALESCE(t."Del_Status", 'N') = 'N'
       AND t."SAP_Remarks" IS NULL
       AND COALESCE(t."SAP_Status", '') <> 'Closed_Uploaded'
       AND t."Notification_No" ~ '^[0-9]{6,}$'
       AND t."Notification_No" NOT IN ('100874761','100874763','100874762','100874760')
       AND COALESCE(t."Breakdowntype"::text, '') <> '0'
       AND t."Entry_Date" >= DATE '2022-05-01'
       AND COALESCE(NULLIF(TRIM(t."SAPMchn_Code"::text), ''),
             (SELECT NULLIF(TRIM(m."SAPMchn_Code"::text), '') FROM "Mst_Machine" m
              WHERE TRIM(m."Mchn_code"::text) = TRIM(t."Machine_Code"::text) LIMIT 1)) IS NOT NULL
       AND EXISTS (SELECT 1 FROM "Mst_Type" ty
                   WHERE ty."Id"::text = t."Type_Code"::text
                     AND ty."Plant_Code"::text = t."Plant_Code"::text
                     AND UPPER(TRIM(ty."Type_Desc")) = 'MACHINE')
     ORDER BY t."Close_Date"
     LIMIT $1`,
    [limit]
  );
  return res.rows.map((r) => r.Id);
}

let running = false;

async function runOnce() {
  const config = loadConfig();
  if (!config.enabled || running) return;
  running = true;
  try {
    const ids = await findPending(config.batchSize);
    for (const id of ids) {
      await handleLineStoppageCloseFTP(id, {});
      const chk = await db.query('SELECT "SAP_Status" FROM "Trn_LineStoppage" WHERE "Id" = $1', [id]);
      if (chk.rows[0]?.SAP_Status === 'Closed_Uploaded') {
        await db.query(`UPDATE "Trn_LineStoppage" SET "M_Status" = 'C' WHERE "Id" = $1`, [id]);
        console.log(`[MobileCloseFtp] CL file sent for Trn_LineStoppage.Id = ${id}; M_Status set to C`);
      } else {
        console.warn(`[MobileCloseFtp] CL file for Trn_LineStoppage.Id = ${id} not uploaded; will retry next tick`);
      }
    }
  } catch (err) {
    console.error('[MobileCloseFtp] Run error:', err.message);
  } finally {
    running = false;
  }
}

let timer = null;

function scheduleNext() {
  const delayMs = Math.max(10, loadConfig().intervalSeconds) * 1000;
  timer = setTimeout(async () => {
    await runOnce();
    scheduleNext();
  }, delayMs);
}

function startMobileCloseFtp() {
  const config = loadConfig();
  console.log(`[MobileCloseFtp] Starting (enabled=${config.enabled}, every ${config.intervalSeconds}s). Config: config/mobileCloseFtp.json`);
  scheduleNext();
}

function stopMobileCloseFtp() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { startMobileCloseFtp, stopMobileCloseFtp, runOnce, loadConfig };
