-- ============================================================================
-- 01_migration.sql
-- Run manually in production. Each change below is additive/nullable and
-- safe to run on a live table (no data loss, no rewrite of existing rows).
-- ============================================================================

-- Sub Group Master (mst_SubGroup) has no column to store which Group it
-- belongs to. The Add/Edit form's "Group" dropdown submits Group_code, but
-- routes/generic.js only writes columns that actually exist on the table -
-- so the Group selection has always been silently dropped on save. This is
-- why "Group Name" shows "-" in the Sub Group Master list and why the Group
-- can never be restored/prefilled when editing an existing row.
--
-- Fix: add a Group_Code column (matches mst_group."ID", bigint) to store the
-- FK. Existing rows will have Group_Code = NULL (still show "-" until
-- re-edited and saved with a Group selected - same as the earlier Phenomena
-- fix in this project).
ALTER TABLE "mst_SubGroup" ADD COLUMN IF NOT EXISTS "Group_Code" bigint;

-- ============================================================================
-- Role-based dynamic sidebar screens (Mst_Role / Mst_Screen / Mst_Access)
-- ============================================================================
-- Sidebar menu visibility was 100% hardcoded per role name in Sidebar.jsx.
-- This adds a real Role_ID on Mst_Employee and a Role -> Screen access table,
-- seeded so every employee's visible menu stays EXACTLY the same as before -
-- this only changes where the data lives, not who currently sees what.

CREATE TABLE IF NOT EXISTS "Mst_Role" (
  "Role_ID" bigint NOT NULL PRIMARY KEY,
  "Role_Name" varchar(100) NOT NULL,
  "Active_Status" smallint NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS "Mst_Screen" (
  "Screen_ID" bigint NOT NULL PRIMARY KEY,
  "Screen_Code" varchar(100) NOT NULL UNIQUE,
  "Screen_Name" varchar(200) NOT NULL,
  "Screen_Type" varchar(100),
  "Active_Status" smallint NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS "Mst_Access" (
  "Access_ID" bigint NOT NULL PRIMARY KEY,
  "Role_ID" bigint NOT NULL REFERENCES "Mst_Role"("Role_ID"),
  "Screen_ID" bigint NOT NULL REFERENCES "Mst_Screen"("Screen_ID"),
  "Active_Status" smallint NOT NULL DEFAULT 1,
  UNIQUE ("Role_ID", "Screen_ID")
);

ALTER TABLE "Mst_Employee" ADD COLUMN IF NOT EXISTS "Role_ID" bigint;

-- Roles: the 4 role names already in use throughout the app (auth.js,
-- Sidebar.jsx, roleMaster.jsx, mst_role_permissions).
INSERT INTO "Mst_Role" ("Role_ID", "Role_Name", "Active_Status") VALUES
  (1, 'BU Admin', 1),
  (2, 'Super Admin', 1),
  (3, 'Plant Admin', 1),
  (4, 'User', 1)
ON CONFLICT ("Role_ID") DO NOTHING;

-- Screens: same Screen_Code keys already used as the "mod" key in
-- Sidebar.jsx / MODULE_LIST in roleMaster.jsx, so no new identifiers are
-- invented - Screen_Type mirrors that same file's "category" grouping.
INSERT INTO "Mst_Screen" ("Screen_ID", "Screen_Code", "Screen_Name", "Screen_Type", "Active_Status") VALUES
  (1,  'dashboard',             'Reports Dashboard',              'Analytics',        1),
  (2,  'company',                'Company Master',                 'General Masters',  1),
  (3,  'plant',                  'Plant Master',                   'General Masters',  1),
  (4,  'vendor',                 'Vendor Master',                  'General Masters',  1),
  (5,  'dept',                   'Department Master',              'General Masters',  1),
  (6,  'employee',                'Employee Master',                'General Masters',  1),
  (7,  'shift',                  'Shift Master',                   'General Masters',  1),
  (8,  'breakdown',              'Breakdown Master',               'General Masters',  1),
  (9,  'category',               'Category Master',                'General Masters',  1),
  (10, 'group',                  'Group Master',                   'General Masters',  1),
  (11, 'subgroup',               'Sub Group Master',               'General Masters',  1),
  (12, 'problem_type',           'Problem Type Master',            'System Masters',   1),
  (13, 'phenomena_mchn',         'Phenomena (Machine)',            'General Masters',  1),
  (14, 'phenomena_others',       'Phenomena (Closure)',            'General Masters',  1),
  (15, 'gap',                    'Line Stoppage Reason Master',    'System Masters',   1),
  (16, 'linestoppage_mapping',   'Line Stoppage Reason Mapping',   'General Masters',  1),
  (17, 'shop',                   'Shop Master',                    'Masters',          1),
  (18, 'module',                 'Module Master',                  'Masters',          1),
  (19, 'line',                   'Line Master',                    'Masters',          1),
  (20, 'machine',                'Machine Master',                 'Masters',          1),
  (21, 'machine_oee',            'Machine OEE Mapping',            'Masters',          1),
  (22, 'location',               'Functional Location',            'System Masters',   1),
  (23, 'sms_level_time',         'SMS Level and Time Mapping',     'Masters',          1),
  (24, 'sms_settings',           'SMS Settings',                   'Masters',          1),
  (25, 'automail',               'Automail Settings',              'Masters',          1),
  (26, 'trn_line_stoppage',      'Line Stoppage Transaction',      'Transactions',     1),
  (27, 'mis_reports',            'MIS Reports',                    'Reports',          1),
  (28, 'role_master',            'Role Master',                    'System Masters',   1)
ON CONFLICT ("Screen_ID") DO NOTHING;

-- Access: seeded 1:1 from the "view" flag already stored per role in
-- mst_role_permissions, so this migration does not change anyone's current
-- effective menu - it only moves the same access decisions into the new
-- Role/Screen/Access tables. role_master isn't in mst_role_permissions (it
-- gates itself, not a module) - kept BU-Admin-only, matching Sidebar.jsx's
-- existing hardcoded `item.mod === 'role_master' ? isBUAdmin` check.
INSERT INTO "Mst_Access" ("Access_ID", "Role_ID", "Screen_ID", "Active_Status")
SELECT
  ROW_NUMBER() OVER (ORDER BY r."Role_ID", s."Screen_ID"),
  r."Role_ID",
  s."Screen_ID",
  CASE
    WHEN s."Screen_Code" = 'role_master' THEN (CASE WHEN r."Role_Name" = 'BU Admin' THEN 1 ELSE 0 END)
    ELSE COALESCE(
      (SELECT (p."permissions" -> s."Screen_Code" ->> 'view')::boolean
       FROM "mst_role_permissions" p
       WHERE p."role_name" = r."Role_Name"),
      false
    )::int
  END
FROM "Mst_Role" r
CROSS JOIN "Mst_Screen" s
WHERE NOT EXISTS (
  SELECT 1 FROM "Mst_Access" a WHERE a."Role_ID" = r."Role_ID" AND a."Screen_ID" = s."Screen_ID"
);

-- Populate every employee's Role_ID using the exact same effective-role
-- logic routes/auth.js already computes at login time (emp_group if it's a
-- real role name, otherwise is_admin decides Super Admin vs Plant Admin) -
-- most emp_group values in this table are blank/legacy numeric codes, not
-- real role names, which is why this can't be a simple text match.
UPDATE "Mst_Employee" e
SET "Role_ID" = (
  SELECT r."Role_ID" FROM "Mst_Role" r
  WHERE r."Role_Name" = (
    CASE
      WHEN LOWER(TRIM(e."emp_group")) = 'bu admin' THEN 'BU Admin'
      WHEN LOWER(TRIM(e."emp_group")) = 'super admin' THEN 'Super Admin'
      WHEN LOWER(TRIM(e."emp_group")) = 'user' THEN 'User'
      WHEN LOWER(TRIM(e."emp_group")) = 'plant admin' THEN 'Plant Admin'
      WHEN COALESCE(e."is_admin", 0) = 1 THEN 'Super Admin'
      ELSE 'Plant Admin'
    END
  )
)
WHERE e."Role_ID" IS NULL;

-- ============================================================================
-- Swap "Super Admin" and "BU Admin" role identities
-- ============================================================================
-- Whoever is currently BU Admin (cross-company/global access) becomes
-- Super Admin and keeps that exact same global power under the new name.
-- Whoever is currently Super Admin (their own company only) becomes BU
-- Admin and keeps that exact same company-scoped power under the new name.
-- This only relabels existing rows/text - nobody's actual access level
-- changes, only what it's called. Matching code changes are required in
-- utils/companyScope.js, routes/auth.js, routes/company.js, routes/dashboard.js
-- (already applied in this deploy) so the swapped labels are interpreted
-- with the swapped meaning consistently everywhere.

-- Mst_Role: rename the buckets but keep Role_ID (and every Mst_Access row
-- tied to it) exactly as-is, so Sidebar screen access follows the renamed
-- bucket intact - the person doesn't move to a different bucket, the
-- bucket's own name changes.
UPDATE "Mst_Role" SET "Role_Name" = '__TEMP_ROLE_SWAP__' WHERE "Role_Name" = 'BU Admin';
UPDATE "Mst_Role" SET "Role_Name" = 'BU Admin' WHERE "Role_Name" = 'Super Admin';
UPDATE "Mst_Role" SET "Role_Name" = 'Super Admin' WHERE "Role_Name" = '__TEMP_ROLE_SWAP__';

-- mst_role_permissions: same relabeling, same reasoning - the create/edit/
-- view permissions stay attached to the renamed row.
UPDATE "mst_role_permissions" SET "role_name" = '__TEMP_ROLE_SWAP__' WHERE "role_name" = 'BU Admin';
UPDATE "mst_role_permissions" SET "role_name" = 'BU Admin' WHERE "role_name" = 'Super Admin';
UPDATE "mst_role_permissions" SET "role_name" = 'Super Admin' WHERE "role_name" = '__TEMP_ROLE_SWAP__';

-- Mst_Employee.emp_group: relabel each employee's own stored role text so
-- the login flow and every legacy role check across the app see the
-- correct, swapped name for the same person. Mst_Employee.Role_ID is
-- deliberately left untouched here (see Mst_Role rename above).
UPDATE "Mst_Employee" SET "emp_group" = '__TEMP_ROLE_SWAP__' WHERE TRIM("emp_group") = 'BU Admin';
UPDATE "Mst_Employee" SET "emp_group" = 'BU Admin' WHERE TRIM("emp_group") = 'Super Admin';
UPDATE "Mst_Employee" SET "emp_group" = 'Super Admin' WHERE TRIM("emp_group") = '__TEMP_ROLE_SWAP__';

-- ============================================================================
-- SMS Log (new feature): stores every SMS actually sent when a Line Stoppage
-- ticket is created (STOP message) or closed (LINE RUNNING message), so
-- Super Admin/BU Admin can see a trending + per-plant dashboard of message
-- volume. Written to by utils/smsNotificationService.js.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "Trn_SMS_Log" (
  "Id" bigint NOT NULL PRIMARY KEY,
  "Date_Time" timestamp NOT NULL DEFAULT NOW(),
  "Plant_Code" varchar(20),
  "User_Name" varchar(200),
  "Mobile_No" varchar(20),
  "Message" text,
  "Gateway_Response" text
);

-- Additive in case Trn_SMS_Log was already created by an earlier run of this
-- file, before Gateway_Response existed - lets you see exactly what the SMS
-- gateway said for each message (e.g. a DLT template/route mismatch, which
-- looks like a normal 200 OK response but silently never delivers).
ALTER TABLE "Trn_SMS_Log" ADD COLUMN IF NOT EXISTS "Gateway_Response" text;

-- New Screen for the dynamic Sidebar (see Mst_Role/Mst_Screen/Mst_Access
-- from the earlier role-based access migration above). Only Super Admin and
-- BU Admin get access; everyone else does not.
INSERT INTO "Mst_Screen" ("Screen_ID", "Screen_Code", "Screen_Name", "Screen_Type", "Active_Status")
VALUES (29, 'sms_log', 'SMS Log', 'Analytics', 1)
ON CONFLICT ("Screen_ID") DO NOTHING;

INSERT INTO "Mst_Access" ("Access_ID", "Role_ID", "Screen_ID", "Active_Status")
SELECT
  (SELECT COALESCE(MAX("Access_ID"), 0) FROM "Mst_Access") + ROW_NUMBER() OVER (ORDER BY r."Role_ID"),
  r."Role_ID",
  (SELECT "Screen_ID" FROM "Mst_Screen" WHERE "Screen_Code" = 'sms_log'),
  CASE WHEN r."Role_Name" IN ('Super Admin', 'BU Admin') THEN 1 ELSE 0 END
FROM "Mst_Role" r
WHERE NOT EXISTS (
  SELECT 1 FROM "Mst_Access" a
  WHERE a."Role_ID" = r."Role_ID"
    AND a."Screen_ID" = (SELECT "Screen_ID" FROM "Mst_Screen" WHERE "Screen_Code" = 'sms_log')
);

-- Machine OEE Mapping menu/screen removed from the app (route, sidebar entry,
-- and page deleted). Deactivate rather than delete, so Access_ID history and
-- any FK references stay intact - Mst_Access/Mst_Screen are both read with
-- "Active_Status = 1" filters, so this fully hides it everywhere (Sidebar,
-- Role Master) without touching other screens' rows.
UPDATE "Mst_Access" SET "Active_Status" = 0
WHERE "Screen_ID" = (SELECT "Screen_ID" FROM "Mst_Screen" WHERE "Screen_Code" = 'machine_oee');

UPDATE "Mst_Screen" SET "Active_Status" = 0
WHERE "Screen_Code" = 'machine_oee';

-- ----------------------------------------------------------------------------
-- Production is missing three audit columns on "Mst_Line" that exist in quality
-- (found by transfer_quality_to_prod.ps1's schema check). Without them the
-- data-only load from quality fails on Mst_Line ("column does not exist").
-- Additive and idempotent - safe to run once on production before the transfer.
-- ----------------------------------------------------------------------------
ALTER TABLE "Mst_Line" ADD COLUMN IF NOT EXISTS "CreatedDt"  timestamp without time zone;
ALTER TABLE "Mst_Line" ADD COLUMN IF NOT EXISTS "ModifiedBy" bigint;
ALTER TABLE "Mst_Line" ADD COLUMN IF NOT EXISTS "ModifiedDt" timestamp without time zone;

-- ----------------------------------------------------------------------------
-- LINE STOPPAGE - store and read tickets exactly like the .NET application.
-- Run ONLY this block (not the whole file) on production, after deploying the backend change that
-- matches it (routes/trnLineStoppage.js, utils/smsNotificationService.js).
--
-- What the .NET database actually does (read from the legacy database script):
--   * "Status" is the SMS escalation level (NULL -> Level1 -> Level2 -> Level3 -> Level4), never an
--     open/closed flag. A ticket is open while "Close_Date" IS NULL.
--   * A new ticket stores the reason CODE in "Reason" and the typed remarks in "Details"; closing
--     overwrites "Reason" with the typed resolution remarks.
--   * "Closure", "Phenomena", "Breakdowntype", "Vendor" hold lookup CODES (Mst_Closure.Closure_ID,
--     Phenomena.Id, Mst_BreakDown.BD_ID, VENDOR.Vendor); the screens show their names.
--
-- sp_get_line_stoppages (the ticket list) is redefined for that: same columns as before, but
--   reason  = the creation remarks ("Details", falling back to a non-numeric "Reason"),
--   closure = the resolution remarks when closed, else the Closure name,
--   breakdowntype = the Breakdown name, and a NULL "Del_Status" counts as active.
-- Which tickets are returned (the Open / Closed ticket tabs):
--   * no date range given (default): EVERY open ticket however old, so unresolved work never drops off
--     the Open tab, plus the tickets CLOSED today or yesterday (T and T-1).
--   * a date range given (from / to, both inclusive): open tickets STARTED in the range and tickets
--     CLOSED in the range (at most the newest 5000 closed ones).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS sp_get_line_stoppages(varchar);
DROP FUNCTION IF EXISTS sp_get_line_stoppages(varchar, timestamp, timestamp);

CREATE OR REPLACE FUNCTION sp_get_line_stoppages(
  p_plant_code varchar DEFAULT NULL,
  p_from timestamp DEFAULT NULL,
  p_to timestamp DEFAULT NULL
)
RETURNS TABLE(
  id integer, plant_code varchar, plant_name varchar,
  shop_code bigint, shop_name varchar,
  module_code bigint, module_name varchar,
  line_code bigint, line_name varchar,
  machine_code varchar, mchn_name varchar, sap_mchn_code varchar,
  type_code varchar, type_desc varchar,
  linereason_code varchar, gap_name varchar,
  reason varchar, loto integer, status varchar,
  starttime timestamp, endtime timestamp, close_date timestamp,
  closure text, spares varchar,
  hours numeric, mins bigint,
  servicetype varchar, breakdowntype varchar,
  notification_no varchar, closedstatus text,
  emp_no varchar, emp_name varchar,
  closure_emp_no varchar, closure_emp_name varchar
) AS $$
DECLARE
  v_custom boolean := (p_from IS NOT NULL OR p_to IS NOT NULL);
  v_from   timestamp := COALESCE(p_from, (CURRENT_DATE - 1)::timestamp);   -- T-1, 00:00
  v_to     timestamp := CASE WHEN p_to IS NULL THEN NULL ELSE date_trunc('day', p_to) + INTERVAL '1 day' END;
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (t."Id")
         t."Id", t."Plant_Code", p.plant_name,
         t."Shop_Code", s."Shop_Name",
         t."Module_Code", m."Module_Name",
         t."Line_Code", l."Line_Name",
         t."Machine_Code",
         (SELECT mc."Mchn_Name"::varchar FROM "Mst_Machine" mc WHERE TRIM(mc."Mchn_code"::text) = TRIM(t."Machine_Code"::text) LIMIT 1),
         (SELECT mc."SAPMchn_Code"::varchar FROM "Mst_Machine" mc WHERE TRIM(mc."Mchn_code"::text) = TRIM(t."Machine_Code"::text) LIMIT 1),
         t."Type_Code", tp."Type_Desc",
         t."LineReason_Code", g."Gap_Name",
         COALESCE(NULLIF(TRIM(t."Details"), ''),
                  CASE WHEN TRIM(t."Reason") ~ '^[0-9]+$' THEN NULL ELSE t."Reason" END)::varchar,
         t."Loto", t."Status",
         t."Entry_Date", t."Close_Date", t."Close_Date",
         COALESCE(
           CASE WHEN t."Close_Date" IS NOT NULL AND NULLIF(TRIM(t."Reason"), '') IS NOT NULL AND TRIM(t."Reason") !~ '^[0-9]+$'
                THEN t."Reason" END,
           (SELECT cl."Reason" FROM "Mst_Closure" cl WHERE cl."Closure_ID"::text = TRIM(t."Closure"::text) LIMIT 1),
           t."Closure"
         )::text,
         t."Spares",
         ROUND((EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date"))/3600)::numeric, 2),
         FLOOR(MOD((EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date"))/60)::numeric, 60))::bigint,
         t.servicetype,
         COALESCE((SELECT bd."BD_Name" FROM "Mst_BreakDown" bd WHERE bd."BD_ID"::text = TRIM(t."Breakdowntype"::text) LIMIT 1),
                  t."Breakdowntype")::varchar,
         t."Notification_No", t."closedstatus"::text,
         t."Created_Empcode"::varchar, t."Created_Empname"::varchar,
         t."Closure_Empcode"::varchar, t."Closure_Empname"::varchar
  FROM "Trn_LineStoppage" t
  JOIN "plant" p ON t."Plant_Code" = p.plant_code
  LEFT JOIN "Mst_Shop" s ON t."Shop_Code" = s."Shop_code"
  LEFT JOIN "Mst_Module" m ON t."Module_Code" = m."Module_Code"
  LEFT JOIN "Mst_Line" l ON t."Line_Code" = l."Line_code"
  LEFT JOIN "Mst_Type" tp ON t."Type_Code"::text = tp."Id"::text AND t."Plant_Code"::text = tp."Plant_Code"::text
  LEFT JOIN "Mst_Gap" g ON t."LineReason_Code"::text = g."Id"::text AND t."Plant_Code"::text = g."Plant_Code"::text
  WHERE COALESCE(t."Del_Status", 'N') = 'N'
    AND (p_plant_code IS NULL OR t."Plant_Code" = p_plant_code)
    AND (
         -- OPEN tickets: all of them by default; judged by START time when a range is given
         (t."Close_Date" IS NULL
          AND (NOT v_custom OR (t."Entry_Date" >= v_from AND (v_to IS NULL OR t."Entry_Date" < v_to))))
         OR
         -- CLOSED tickets: judged by CLOSE time (default: since yesterday 00:00)
         t."Id" IN (SELECT x."Id" FROM "Trn_LineStoppage" x
                    WHERE COALESCE(x."Del_Status", 'N') = 'N'
                      AND x."Close_Date" IS NOT NULL
                      AND x."Close_Date" >= v_from AND (v_to IS NULL OR x."Close_Date" < v_to)
                      AND (p_plant_code IS NULL OR x."Plant_Code" = p_plant_code)
                    ORDER BY x."Close_Date" DESC LIMIT 5000)
        )
  ORDER BY t."Id" DESC, t."Entry_Date" DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql;
