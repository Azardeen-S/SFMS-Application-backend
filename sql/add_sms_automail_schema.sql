-- Mst_Empl_SMSSetting, Mst_Empl_SMSSettingDtls, Mst_Empl_AutoMailSetting,
-- Mst_Empl_AutomailSettingDtls_Reason and Mail_Status already exist in this
-- database with live data (confirmed via information_schema.columns) - no
-- CREATE TABLE needed for them. This file only adds what's still missing:
-- the sent-flag columns on Trn_LineStoppage that replace the legacy
-- "id >= 373335" watermark hack from RaneSMSNew.

ALTER TABLE "Trn_LineStoppage" ADD COLUMN IF NOT EXISTS "Sms_Sent_Stop"  BOOLEAN DEFAULT false;
ALTER TABLE "Trn_LineStoppage" ADD COLUMN IF NOT EXISTS "Sms_Sent_Start" BOOLEAN DEFAULT false;
