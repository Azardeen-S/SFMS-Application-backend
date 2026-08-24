const fs = require('fs');
const path = require('path');
const ftp = require('basic-ftp');
const db = require('../config/database');

/**
 * Upload a local file to FTP server
 * @param {string} localFilePath Absolute or relative path to local file
 * @param {string} remoteFileName File name on the FTP server
 */
async function uploadFileToFTP(localFilePath, remoteFileName) {
  const client = new ftp.Client(20000); // 20 seconds timeout
  client.ftp.verbose = false;

  try {
    // const ftpHost = process.env.FTP_HOST || '10.102.2.10';
    const ftpHost = process.env.FTP_HOST || '172.51.51.12';
    const ftpPort = parseInt(process.env.FTP_PORT || '21', 10);
    // const ftpUser = process.env.FTP_USER || 'rmlvlcyinhouse';
    // const ftpPass = process.env.FTP_PASS || process.env.FTP_PWD || 'Password@123';
    // const ftpPath = process.env.FTP_PATH || '/PM-SAP/IN/';
    const ftpPath = process.env.FTP_PATH || 'D:\PM-SAP\IN';

    await client.access({
      host: ftpHost,
      port: ftpPort,
      user: ftpUser,
      password: ftpPass,
      secure: false
    });

    const targetRemotePath = path.posix.join(ftpPath, remoteFileName);
    await client.uploadFrom(localFilePath, targetRemotePath);
    console.log(`[FTP Success] File uploaded successfully: ${remoteFileName} -> ${targetRemotePath}`);
    return { success: true, remotePath: targetRemotePath };
  } catch (err) {
    console.error(`[FTP Error] Failed to upload ${remoteFileName}:`, err.message);
    return { success: false, error: err.message };
  } finally {
    client.close();
  }
}

/**
 * Format Date as ddMMyyyy
 */
function formatDateDDMMYYYY(dateObj) {
  const d = new Date(dateObj);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}${month}${year}`;
}

/**
 * Format Time as HHmmss without colons
 */
function formatTimeHHMMSS(dateObj) {
  const d = new Date(dateObj);
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  const secs = String(d.getSeconds()).padStart(2, '0');
  return `${hours}${mins}${secs}`;
}

/**
 * Handle FTP file creation and upload when a Line Stoppage is logged (Create / Start Downtime)
 * Matches .NET WritedataCR & UploadFile logic in TrnLineStoppageController.cs
 */
async function handleLineStoppageCreateFTP(stoppageId, params = {}) {
  try {
    // 1. Fetch stoppage record details if not fully provided
    const res = await db.query('SELECT * FROM "Trn_LineStoppage" WHERE "Id" = $1', [stoppageId]);
    if (!res.rows || res.rows.length === 0) return;
    const row = res.rows[0];

    const typeCode = String(row.Type_Code || params.type_code || '');
    const plantCode = String(row.Plant_Code || params.plant_code || '');
    const machineCode = String(row.Machine_Code || params.machine_code || '');
    const lineReasonCode = String(row.LineReason_Code || params.linereason_code || '');
    const shopCode = String(row.Shop_Code || params.shop_code || '');
    const notificationNo = row.Notification_No || params.notification_no || '';
    const serviceType = row.servicetype || params.servicetype || 'Breakdown';
    const entryDate = row.Entry_Date || new Date();

    // 2. Check problem type description from Mst_Type / mst_types
    const typeRes = await db.query(
      'SELECT "Type_Desc" FROM "Mst_Type" WHERE "Id"::text = $1 AND "Plant_Code"::text = $2 LIMIT 1',
      [typeCode, plantCode]
    );
    const typeDesc = (typeRes.rows[0]?.Type_Desc || '').trim().toUpperCase();

    // FTP creation only applies for MACHINE problem type
    if (typeDesc !== 'MACHINE') {
      return;
    }

    // 3. Check SFMS_Auto status
    let autoStatus = 'Start';
    try {
      const autoRes = await db.query('SELECT "Status" FROM "SFMS_Auto" LIMIT 1');
      if (autoRes.rows.length > 0 && autoRes.rows[0].Status) {
        autoStatus = String(autoRes.rows[0].Status).trim();
      }
    } catch (e) {
      console.warn('[FTP Warning] Could not fetch SFMS_Auto status, defaulting to Start:', e.message);
    }

    if (autoStatus !== 'Start') {
      console.log('[FTP Info] SFMS_Auto status is not Start. Skipping FTP creation.');
      return;
    }

    // 4. Calculate / Fetch SAP Machine Code & Start Serial No
    let sapMchnCode = row.SAPMchn_Code;
    if (!sapMchnCode) {
      const mchnRes = await db.query('SELECT "SAPMchn_Code" FROM "Mst_Machine" WHERE "Mchn_code" = $1 LIMIT 1', [machineCode]);
      sapMchnCode = mchnRes.rows[0]?.SAPMchn_Code || '';
    }

    let startSlNo = row.Start_slno;
    if (!startSlNo) {
      const slRes = await db.query(
        'SELECT COALESCE(MAX("Start_slno"), 0) + 1 AS next_slno FROM "Trn_LineStoppage" WHERE "Machine_Code" = $1 AND CAST("Entry_Date" AS DATE) = CAST($2 AS DATE)',
        [machineCode, entryDate]
      );
      startSlNo = slRes.rows[0]?.next_slno || 1;
    }

    // Update SAPMchn_Code and Start_slno in DB record
    await db.query(
      'UPDATE "Trn_LineStoppage" SET "SAPMchn_Code" = COALESCE("SAPMchn_Code", $1), "Start_slno" = COALESCE("Start_slno", $2) WHERE "Id" = $3',
      [sapMchnCode, startSlNo, stoppageId]
    );

    // 5. Fetch Stoppage Reason Name (Gap_Name) from Mst_Gap
    let reasonName = '';
    if (lineReasonCode) {
      const gapRes = await db.query('SELECT "Gap_Name" FROM "Mst_Gap" WHERE "Id"::text = $1 LIMIT 1', [lineReasonCode]);
      reasonName = (gapRes.rows[0]?.Gap_Name || '').trim();
    }

    // 6. Format filename & content string
    const slipdt = formatDateDDMMYYYY(entryDate);
    const strtime = formatTimeHHMMSS(entryDate);
    const filename = `NOT_SFSM_CR_${sapMchnCode}_${slipdt}_${startSlNo}.txt`;

    let breakdown = serviceType;
    if (serviceType === 'Service') breakdown = 'M1';
    else if (serviceType === 'Breakdown') breakdown = 'M2';

    const breakdownFull = `${breakdown}|${reasonName}`;
    const fileContent = `${breakdownFull}|${sapMchnCode}|${slipdt}|${strtime}|${stoppageId}`;

    // 7. Ensure local directory exists & write file
    const localDirPath = path.join(__dirname, '..', 'Line_Start_Notepad');
    if (!fs.existsSync(localDirPath)) {
      fs.mkdirSync(localDirPath, { recursive: true });
    }
    const localFilePath = path.join(localDirPath, filename);
    fs.writeFileSync(localFilePath, fileContent, 'utf8');
    console.log(`[FTP File Created] ${localFilePath} -> ${fileContent}`);

    // Update filename in DB
    await db.query(
      'UPDATE "Trn_LineStoppage" SET "SAP_FileName_Notification" = $1 WHERE "Id" = $2',
      [filename, stoppageId]
    );

    // 8. Upload file via FTP
    const uploadRes = await uploadFileToFTP(localFilePath, filename);
    if (uploadRes.success) {
      await db.query('UPDATE "Trn_LineStoppage" SET "SAP_Status" = \'Uploaded\' WHERE "Id" = $1', [stoppageId]);
    }
  } catch (err) {
    console.error('[FTP Error] Error in handleLineStoppageCreateFTP:', err);
  }
}

/**
 * Handle FTP file creation and upload when a Line Stoppage is resolved/closed (Edit / Close Downtime)
 * Matches .NET WritedataCL & UploadFile logic in TrnLineStoppageController.cs
 */
async function handleLineStoppageCloseFTP(stoppageId, params = {}) {
  try {
    // 1. Fetch stoppage record details
    const res = await db.query('SELECT * FROM "Trn_LineStoppage" WHERE "Id" = $1', [stoppageId]);
    if (!res.rows || res.rows.length === 0) return;
    const row = res.rows[0];

    const typeCode = String(row.Type_Code || params.type_code || '');
    const plantCode = String(row.Plant_Code || params.plant_code || '');
    const machineCode = String(row.Machine_Code || params.machine_code || '');
    const closeDate = row.Close_Date || new Date();
    const notificationNo = row.Notification_No || params.notification_no || '';
    const closureReason = row.Closure || params.closure || '';
    const shortCloseStatus = row.ShortClose_Status || params.shortclose || false;

    // 2. Check problem type description
    const typeRes = await db.query(
      'SELECT "Type_Desc" FROM "Mst_Type" WHERE "Id"::text = $1 AND "Plant_Code"::text = $2 LIMIT 1',
      [typeCode, plantCode]
    );
    const typeDesc = (typeRes.rows[0]?.Type_Desc || '').trim().toUpperCase();

    if (typeDesc !== 'MACHINE') {
      return;
    }

    // 3. Check SFMS_Auto status
    let autoStatus = 'Start';
    try {
      const autoRes = await db.query('SELECT "Status" FROM "SFMS_Auto" LIMIT 1');
      if (autoRes.rows.length > 0 && autoRes.rows[0].Status) {
        autoStatus = String(autoRes.rows[0].Status).trim();
      }
    } catch (e) {
      console.warn('[FTP Warning] Could not fetch SFMS_Auto status:', e.message);
    }

    if (autoStatus !== 'Start') {
      return;
    }

    // 4. Get SAP Machine Code & Start Serial No
    let sapMchnCode = row.SAPMchn_Code;
    if (!sapMchnCode) {
      const mchnRes = await db.query('SELECT "SAPMchn_Code" FROM "Mst_Machine" WHERE "Mchn_code" = $1 LIMIT 1', [machineCode]);
      sapMchnCode = mchnRes.rows[0]?.SAPMchn_Code || '';
    }

    const startSlNo = row.Start_slno || 1;

    // 5. Format filename & content string
    const slipdt = formatDateDDMMYYYY(closeDate);
    const strtime = formatTimeHHMMSS(closeDate);
    const filename = `NOT_SFSM_CL_${sapMchnCode}_${slipdt}_${startSlNo}.txt`;

    const sc = (shortCloseStatus === true || shortCloseStatus === 'Y' || shortCloseStatus === 'true') ? 'Y' : 'N';
    const fileContent = `${slipdt}|${strtime}|${closureReason}|${notificationNo}|${sc}`;

    // 6. Ensure local directory exists & write file
    const localDirPath = path.join(__dirname, '..', 'Line_Start_Notepad');
    if (!fs.existsSync(localDirPath)) {
      fs.mkdirSync(localDirPath, { recursive: true });
    }
    const localFilePath = path.join(localDirPath, filename);
    fs.writeFileSync(localFilePath, fileContent, 'utf8');
    console.log(`[FTP File Created] ${localFilePath} -> ${fileContent}`);

    // Update filename in DB
    await db.query(
      'UPDATE "Trn_LineStoppage" SET "SAP_FileName_Status" = $1 WHERE "Id" = $2',
      [filename, stoppageId]
    );

    // 7. Upload file via FTP
    const uploadRes = await uploadFileToFTP(localFilePath, filename);
    if (uploadRes.success) {
      await db.query('UPDATE "Trn_LineStoppage" SET "SAP_Status" = \'Closed_Uploaded\' WHERE "Id" = $1', [stoppageId]);
    }
  } catch (err) {
    console.error('[FTP Error] Error in handleLineStoppageCloseFTP:', err);
  }
}

module.exports = {
  uploadFileToFTP,
  handleLineStoppageCreateFTP,
  handleLineStoppageCloseFTP
};
