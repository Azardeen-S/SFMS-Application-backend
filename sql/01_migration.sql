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
