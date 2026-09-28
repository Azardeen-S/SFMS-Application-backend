const fs = require('fs');
const path = require('path');
const { Writable } = require('stream');
const ftp = require('basic-ftp');
const db = require('../config/database');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'notificationSync.json');

/**
 * Notification-No sync job.
 *
 * Replaces the Windows Task Scheduler step the .NET side relied on. SAP reads the
 * CR/CL file we drop into PM-SAP/IN, generates/confirms the SAP notification number,
 * and writes an acknowledgement file back into PM-SAP/OUT using the SAME filename we
 * used to upload it (this is how we match the ack back to a specific ticket - see
 * "SAP_FileName_Notification" / "SAP_FileName_Status", which ftpService.js already
 * stores on the Trn_LineStoppage row at upload time).
 *
 * Confirmed sample (CL ack), pipe-delimited:
 *   NOT_SFSM_CL_10000505_12092024_1.txt
 *   12092024|160133|Wrong notification |000101219436|N|Notification Completed
 *   [0]=date [1]=time [2]=reason [3]=SAP notification number [4]=short-close flag [5]=status text
 *
 * The CR ack's exact field order has not been confirmed yet. Until a real CR sample
 * is seen, this job first tries the same index-3 position, then falls back to
 * regex-scanning the line for a long numeric token (SAP notification numbers are
 * long digit strings, e.g. 000101219436). Any CR ack processed this way is logged
 * with a warning so it's easy to spot and verify to that format.
 *
 * Config lives in config/notificationSync.json and is re-read every tick, so you can
 * flip "enabled" or change "intervalSeconds"/"outPath" without restarting the app.
 */

function loadConfig() {
  const defaults = {
    enabled: true,
    intervalSeconds: 60,
    outPath: '/OUT',
    archiveSubfolder: 'Processed',
    unmatchedSubfolder: 'Unmatched',
    filePattern: '^NOT_SFSM_(CR|CL)_.+\\.txt$',
    deleteAfterProcessing: false
  };
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch (err) {
    console.warn(`[NotificationSync] Could not read ${CONFIG_PATH}, using defaults:`, err.message);
    return defaults;
  }
}

function extractNotificationNo(ackType, fields, rawContent) {
  // Confirmed layout for CL acks: index 3.
  // Confirmed layout for CR acks: the original 6-field CR line echoed back with the
  // SAP-generated notification number appended as a 7th field, index 6. e.g.
  //   M2|Stop E-Electric: Accidents caused by electrical contact|10007441|23092026|071418|566919|0001702975
  //   [0]=breakdown [1]=reason [2]=sapMchnCode [3]=slipdt [4]=strtime [5]=stoppageId [6]=SAP notification number
  const idx = ackType === 'CR' ? 6 : 3;
  if (fields[idx] && /^\d{6,}$/.test(fields[idx].trim())) {
    return fields[idx].trim();
  }
  console.warn(`[NotificationSync] Could not find a valid notification number at field index ${idx} of ${ackType} ack "${rawContent}".`);
  return null;
}

async function downloadFileContent(client, remotePath) {
  const chunks = [];
  const writable = new Writable({
    write(chunk, enc, cb) {
      chunks.push(chunk);
      cb();
    }
  });
  await client.downloadTo(writable, remotePath);
  return Buffer.concat(chunks).toString('utf8');
}

async function ensureRemoteDir(client, baseDir, subfolder) {
  const original = await client.pwd();
  try {
    await client.cd(baseDir);
    await client.ensureDir(subfolder);
  } finally {
    await client.cd(original);
  }
}

async function processAckFile(client, config, filename) {
  const ackType = filename.startsWith('NOT_SFSM_CR_') ? 'CR' : filename.startsWith('NOT_SFSM_CL_') ? 'CL' : null;
  if (!ackType) return;

  const remoteFilePath = path.posix.join(config.outPath, filename);
  let content;
  try {
    content = await downloadFileContent(client, remoteFilePath);
  } catch (err) {
    console.error(`[NotificationSync] Failed to download ${filename}:`, err.message);
    return;
  }

  const fields = content.split('|');
  const notificationNo = extractNotificationNo(ackType, fields, content);

  const matchColumn = ackType === 'CR' ? 'SAP_FileName_Notification' : 'SAP_FileName_Status';
  const findRes = await db.query(
    `SELECT "Id", "Notification_No" FROM "Trn_LineStoppage" WHERE "${matchColumn}" = $1 LIMIT 1`,
    [filename]
  );

  if (!findRes.rows || findRes.rows.length === 0) {
    console.warn(`[NotificationSync] No Trn_LineStoppage row matches ${matchColumn} = "${filename}" - moving to ${config.unmatchedSubfolder}`);
    await archiveFile(client, config, filename, config.unmatchedSubfolder);
    return;
  }

  const row = findRes.rows[0];
  if (!notificationNo) {
    console.warn(`[NotificationSync] Could not extract a notification number from ${filename} ("${content}") - moving to ${config.unmatchedSubfolder}`);
    await archiveFile(client, config, filename, config.unmatchedSubfolder);
    return;
  }

  if (!row.Notification_No) {
    await db.query('UPDATE "Trn_LineStoppage" SET "Notification_No" = $1 WHERE "Id" = $2', [notificationNo, row.Id]);
    console.log(`[NotificationSync] Updated Notification_No = ${notificationNo} for Trn_LineStoppage.Id = ${row.Id} (from ${filename})`);
  } else {
    console.log(`[NotificationSync] Trn_LineStoppage.Id = ${row.Id} already has Notification_No = ${row.Notification_No}; leaving as-is (ack: ${filename})`);
  }

  await archiveFile(client, config, filename, config.archiveSubfolder);
}

async function archiveFile(client, config, filename, subfolder) {
  const remoteFilePath = path.posix.join(config.outPath, filename);
  if (config.deleteAfterProcessing) {
    await client.remove(remoteFilePath);
    return;
  }
  try {
    await ensureRemoteDir(client, config.outPath, subfolder);
    const destPath = path.posix.join(config.outPath, subfolder, filename);
    await client.rename(remoteFilePath, destPath);
  } catch (err) {
    console.error(`[NotificationSync] Failed to archive ${filename} into ${subfolder}:`, err.message);
  }
}

async function runOnce(config) {
  const client = new ftp.Client(20000);
  client.ftp.verbose = false;

  const ftpHost = process.env.FTP_HOST || '10.51.12.45';
  const ftpPort = parseInt(process.env.FTP_PORT || '21', 10);
  const ftpUser = process.env.FTP_USER || 'Rane/16221';
  const ftpPass = process.env.FTP_PASS || process.env.FTP_PWD || 'Ayaaz@001';

  try {
    await client.access({ host: ftpHost, port: ftpPort, user: ftpUser, password: ftpPass, secure: false });

    let list;
    try {
      list = await client.list(config.outPath);
    } catch (err) {
      console.error(`[NotificationSync] Could not list "${config.outPath}" on ${ftpHost} - check config/notificationSync.json's outPath:`, err.message);
      return;
    }

    const pattern = new RegExp(config.filePattern);
    const ackFiles = list.filter((item) => !item.isDirectory && pattern.test(item.name));

    if (ackFiles.length === 0) return;

    console.log(`[NotificationSync] Found ${ackFiles.length} ack file(s) in ${config.outPath}`);
    for (const item of ackFiles) {
      await processAckFile(client, config, item.name);
    }
  } catch (err) {
    console.error('[NotificationSync] FTP connection/run error:', err.message);
  } finally {
    client.close();
  }
}

let timer = null;

function scheduleNext() {
  const config = loadConfig();
  const delayMs = Math.max(5, config.intervalSeconds) * 1000;

  timer = setTimeout(async () => {
    const cfg = loadConfig();
    if (cfg.enabled) {
      try {
        await runOnce(cfg);
      } catch (err) {
        console.error('[NotificationSync] Unexpected error:', err);
      }
    }
    scheduleNext();
  }, delayMs);
}

function startNotificationSync() {
  const config = loadConfig();
  console.log(`[NotificationSync] Starting (enabled=${config.enabled}, every ${config.intervalSeconds}s, watching ${config.outPath}). Config: config/notificationSync.json`);
  scheduleNext();
}

function stopNotificationSync() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { startNotificationSync, stopNotificationSync, runOnce, loadConfig };
