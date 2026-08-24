-- SFMS PostgreSQL Stored Procedures Setup Script

-- 1. PLANT FUNCTIONS
CREATE OR REPLACE FUNCTION sp_get_active_plants()
RETURNS TABLE(plant_code varchar, plant_name varchar, del_status varchar) AS $$
BEGIN
  RETURN QUERY SELECT p.plant_code, p.plant_name, p.del_status FROM "plant" p WHERE p.del_status = 'N' ORDER BY p.plant_name ASC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_create_plant(p_code varchar, p_name varchar)
RETURNS void AS $$
BEGIN
  INSERT INTO "plant" ("plant_code", "plant_name", "del_status", "CreatedDt")
  VALUES (p_code, p_name, 'N', NOW());
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_update_plant(p_code varchar, p_name varchar)
RETURNS void AS $$
BEGIN
  UPDATE "plant" SET "plant_name" = p_name, "ModifiedDt" = NOW() WHERE "plant_code" = p_code AND "del_status" = 'N';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_delete_plant(p_code varchar)
RETURNS void AS $$
BEGIN
  UPDATE "plant" SET "del_status" = 'Y', "ModifiedDt" = NOW() WHERE "plant_code" = p_code;
END;
$$ LANGUAGE plpgsql;


-- 2. DEPARTMENT FUNCTIONS
CREATE OR REPLACE FUNCTION sp_get_active_departments()
RETURNS TABLE(dept_id bigint, dept_name varchar, plant_code varchar, plant_name varchar) AS $$
BEGIN
  RETURN QUERY 
  SELECT d.dept_id, d.dept_name, d."Plant_Code", p.plant_name 
  FROM "mst_dept" d
  JOIN "plant" p ON d."Plant_Code" = p.plant_code
  WHERE d.del_status = 'N'
  ORDER BY d.dept_name ASC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_create_department(p_name varchar, p_plant_code varchar)
RETURNS void AS $$
BEGIN
  INSERT INTO "mst_dept" (dept_name, "Plant_Code", del_status, "CreatedDt")
  VALUES (p_name, p_plant_code, 'N', NOW());
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_update_department(p_id bigint, p_name varchar, p_plant_code varchar)
RETURNS void AS $$
BEGIN
  UPDATE "mst_dept" SET dept_name = p_name, "Plant_Code" = p_plant_code, "ModifiedDt" = NOW()
  WHERE dept_id = p_id AND del_status = 'N';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_delete_department(p_id bigint)
RETURNS void AS $$
BEGIN
  UPDATE "mst_dept" SET del_status = 'Y', "ModifiedDt" = NOW() WHERE dept_id = p_id;
END;
$$ LANGUAGE plpgsql;


-- 3. EMPLOYEE FUNCTIONS
CREATE OR REPLACE FUNCTION sp_get_active_employees()
RETURNS TABLE(
  emp_id bigint, emp_no varchar, emp_name varchar, dept varchar, 
  designation varchar, mail_id varchar, mobile_no varchar, 
  is_admin integer, password varchar, plant_code varchar, 
  plant_name varchar, dept_name varchar
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e."Emp_Id", e."Emp_No", e."Emp_Name", e."Dept", 
    e."Designation", e."Mail_Id", e."Mobile_No", 
    e.is_admin, e."Password", e."Plant_Code", 
    p.plant_name, d.dept_name
  FROM "Mst_Employee" e
  JOIN "plant" p ON e."Plant_Code" = p.plant_code
  LEFT JOIN "mst_dept" d ON (e."Dept" ~ '^[0-9]+$' AND e."Dept"::bigint = d.dept_id)
  WHERE e."Del_Status" = 'N'
  ORDER BY e."Emp_Name" ASC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_create_employee(
  p_emp_no varchar, p_emp_name varchar, p_dept varchar, p_designation varchar,
  p_mail_id varchar, p_mobile_no varchar, p_is_admin integer, p_password varchar,
  p_plant_code varchar
) RETURNS void AS $$
BEGIN
  INSERT INTO "Mst_Employee" (
    "Emp_No", "Emp_Name", "Dept", "Designation", "Mail_Id", "Mobile_No",
    is_admin, "Password", "Plant_Code", "Del_Status", "CreatedDt"
  ) VALUES (
    p_emp_no, p_emp_name, p_dept, p_designation, p_mail_id, p_mobile_no,
    p_is_admin, p_password, p_plant_code, 'N', NOW()
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_update_employee(
  p_emp_id bigint, p_emp_name varchar, p_dept varchar, p_designation varchar,
  p_mail_id varchar, p_mobile_no varchar, p_is_admin integer, p_password varchar,
  p_plant_code varchar
) RETURNS void AS $$
BEGIN
  UPDATE "Mst_Employee" SET
    "Emp_Name" = p_emp_name, "Dept" = p_dept, "Designation" = p_designation,
    "Mail_Id" = p_mail_id, "Mobile_No" = p_mobile_no, is_admin = p_is_admin,
    "Password" = p_password, "Plant_Code" = p_plant_code, "ModifiedDt" = NOW()
  WHERE "Emp_Id" = p_emp_id AND "Del_Status" = 'N';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_delete_employee(p_emp_id bigint)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Employee" SET "Del_Status" = 'Y', "ModifiedDt" = NOW() WHERE "Emp_Id" = p_emp_id;
END;
$$ LANGUAGE plpgsql;


-- 4. SHOP FUNCTIONS
CREATE OR REPLACE FUNCTION sp_get_active_shops()
RETURNS TABLE(shop_code bigint, shop_name varchar, plant_code varchar, plant_name varchar) AS $$
BEGIN
  RETURN QUERY
  SELECT s."Shop_code", s."Shop_Name", s."Plant_Code", p.plant_name
  FROM "Mst_Shop" s
  JOIN "plant" p ON s."Plant_Code" = p.plant_code
  WHERE s."Del_Status" = 'N'
  ORDER BY s."Shop_Name" ASC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_create_shop(p_code bigint, p_name varchar, p_plant_code varchar)
RETURNS void AS $$
BEGIN
  INSERT INTO "Mst_Shop" ("Shop_code", "Shop_Name", "Plant_Code", "Del_Status", "CreatedDt")
  VALUES (p_code, p_name, p_plant_code, 'N', NOW());
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_update_shop(p_code bigint, p_name varchar, p_plant_code varchar)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Shop" SET "Shop_Name" = p_name, "Plant_Code" = p_plant_code, "ModifiedDt" = NOW()
  WHERE "Shop_code" = p_code AND "Del_Status" = 'N';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_delete_shop(p_code bigint)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Shop" SET "Del_Status" = 'Y', "ModifiedDt" = NOW() WHERE "Shop_code" = p_code;
END;
$$ LANGUAGE plpgsql;


-- 5. MODULE FUNCTIONS
CREATE OR REPLACE FUNCTION sp_get_active_modules()
RETURNS TABLE(
  module_code bigint, module_name varchar, 
  plant_code varchar, plant_name varchar, 
  shop_code bigint, shop_name varchar
) AS $$
BEGIN
  RETURN QUERY
  SELECT m."Module_Code", m."Module_Name", m."Plant_code", p.plant_name, m."Shop_code", s."Shop_Name"
  FROM "Mst_Module" m
  JOIN "plant" p ON m."Plant_code" = p.plant_code
  LEFT JOIN "Mst_Shop" s ON m."Shop_code" = s."Shop_code"
  WHERE m."Del_Status" = 'N'
  ORDER BY m."Module_Name" ASC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_create_module(p_code bigint, p_name varchar, p_plant_code varchar, p_shop_code bigint)
RETURNS void AS $$
BEGIN
  INSERT INTO "Mst_Module" ("Module_Code", "Module_Name", "Plant_code", "Shop_code", "Del_Status", "CreatedDt")
  VALUES (p_code, p_name, p_plant_code, p_shop_code, 'N', NOW());
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_update_module(p_code bigint, p_name varchar, p_plant_code varchar, p_shop_code bigint)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Module" SET "Module_Name" = p_name, "Plant_code" = p_plant_code, "Shop_code" = p_shop_code, "ModifiedDt" = NOW()
  WHERE "Module_Code" = p_code AND "Del_Status" = 'N';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_delete_module(p_code bigint)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Module" SET "Del_Status" = 'Y', "ModifiedDt" = NOW() WHERE "Module_Code" = p_code;
END;
$$ LANGUAGE plpgsql;


-- 6. PRODUCTION LINE FUNCTIONS
CREATE OR REPLACE FUNCTION sp_get_active_lines()
RETURNS TABLE(
  line_code bigint, line_name varchar,
  plant_code varchar, plant_name varchar,
  shop_code bigint, shop_name varchar,
  module_code bigint, module_name varchar
) AS $$
BEGIN
  RETURN QUERY
  SELECT l."Line_code", l."Line_Name", l."Plant_code", p.plant_name, l."Shop_code", s."Shop_Name", l."Module_code", m."Module_Name"
  FROM "Mst_Line" l
  JOIN "plant" p ON l."Plant_code" = p.plant_code
  LEFT JOIN "Mst_Shop" s ON l."Shop_code" = s."Shop_code"
  LEFT JOIN "Mst_Module" m ON l."Module_code" = m."Module_Code"
  WHERE l."Del_Status" = 'N'
  ORDER BY l."Line_Name" ASC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_create_line(p_code bigint, p_name varchar, p_plant_code varchar, p_shop_code bigint, p_module_code bigint)
RETURNS void AS $$
BEGIN
  INSERT INTO "Mst_Line" ("Line_code", "Line_Name", "Plant_code", "Shop_code", "Module_code", "Del_Status", "CreatedDt")
  VALUES (p_code, p_name, p_plant_code, p_shop_code, p_module_code, 'N', NOW());
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_update_line(p_code bigint, p_name varchar, p_plant_code varchar, p_shop_code bigint, p_module_code bigint)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Line" SET "Line_Name" = p_name, "Plant_code" = p_plant_code, "Shop_code" = p_shop_code, "Module_code" = p_module_code, "ModifiedDt" = NOW()
  WHERE "Line_code" = p_code AND "Del_Status" = 'N';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_delete_line(p_code bigint)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Line" SET "Del_Status" = 'Y', "ModifiedDt" = NOW() WHERE "Line_code" = p_code;
END;
$$ LANGUAGE plpgsql;


-- 7. MACHINE FUNCTIONS
CREATE OR REPLACE FUNCTION sp_get_active_machines()
RETURNS TABLE(
  mchn_code bigint, mchn_name varchar, asset_no varchar,
  plant_code varchar, plant_name varchar,
  shop_code bigint, shop_name varchar,
  module_code bigint, module_name varchar,
  line_code bigint, line_name varchar
) AS $$
BEGIN
  RETURN QUERY
  SELECT mc."Mchn_code", mc."Mchn_Name", mc."Asset_No", mc."Plant_code", p.plant_name, mc."Shop_code", s."Shop_Name", mc."Module_code", m."Module_Name", mc."Line_code", l."Line_Name"
  FROM "Mst_Machine" mc
  JOIN "plant" p ON mc."Plant_code" = p.plant_code
  LEFT JOIN "Mst_Shop" s ON mc."Shop_code" = s."Shop_code"
  LEFT JOIN "Mst_Module" m ON mc."Module_code" = m."Module_Code"
  LEFT JOIN "Mst_Line" l ON mc."Line_code" = l."Line_code"
  WHERE mc."Del_Status" = 'N'
  ORDER BY mc."Mchn_Name" ASC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_create_machine(p_code bigint, p_name varchar, p_asset varchar, p_plant_code varchar, p_shop_code bigint, p_module_code bigint, p_line_code bigint)
RETURNS void AS $$
BEGIN
  INSERT INTO "Mst_Machine" ("Mchn_code", "Mchn_Name", "Asset_No", "Plant_code", "Shop_code", "Module_code", "Line_code", "Del_Status", "CreatedDt")
  VALUES (p_code, p_name, p_asset, p_plant_code, p_shop_code, p_module_code, p_line_code, 'N', NOW());
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_update_machine(p_code bigint, p_name varchar, p_asset varchar, p_plant_code varchar, p_shop_code bigint, p_module_code bigint, p_line_code bigint)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Machine" SET "Mchn_Name" = p_name, "Asset_No" = p_asset, "Plant_code" = p_plant_code, "Shop_code" = p_shop_code, "Module_code" = p_module_code, "Line_code" = p_line_code, "ModifiedDt" = NOW()
  WHERE "Mchn_code" = p_code AND "Del_Status" = 'N';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_delete_machine(p_code bigint)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Machine" SET "Del_Status" = 'Y', "ModifiedDt" = NOW() WHERE "Mchn_code" = p_code;
END;
$$ LANGUAGE plpgsql;


-- 8. PROBLEM TYPES
CREATE OR REPLACE FUNCTION sp_get_active_types()
RETURNS TABLE(id bigint, type_desc varchar, plant_code varchar, plant_name varchar) AS $$
BEGIN
  RETURN QUERY
  SELECT t."Id", t."Type_Desc", t."Plant_Code", p.plant_name
  FROM "Mst_Type" t
  JOIN "plant" p ON t."Plant_Code" = p.plant_code
  WHERE t."Del_Status" = 'N'
  ORDER BY t."Type_Desc" ASC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_create_type(p_desc varchar, p_plant_code varchar)
RETURNS void AS $$
BEGIN
  INSERT INTO "Mst_Type" ("Type_Desc", "Plant_Code", "Del_Status", "CreatedDt")
  VALUES (p_desc, p_plant_code, 'N', NOW());
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_update_type(p_id bigint, p_desc varchar, p_plant_code varchar)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Type" SET "Type_Desc" = p_desc, "Plant_Code" = p_plant_code, "ModifiedDt" = NOW()
  WHERE "Id" = p_id AND "Del_Status" = 'N';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_delete_type(p_id bigint)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Type" SET "Del_Status" = 'Y', "ModifiedDt" = NOW() WHERE "Id" = p_id;
END;
$$ LANGUAGE plpgsql;


-- 9. GAP STOPPAGE REASONS
CREATE OR REPLACE FUNCTION sp_get_active_gaps()
RETURNS TABLE(id bigint, gap_name varchar, plant_code varchar, plant_name varchar) AS $$
BEGIN
  RETURN QUERY
  SELECT g."Id", g."Gap_Name", g."Plant_Code", p.plant_name
  FROM "Mst_Gap" g
  JOIN "plant" p ON g."Plant_Code" = p.plant_code
  WHERE g."Del_Status" = 'N'
  ORDER BY g."Gap_Name" ASC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_create_gap(p_name varchar, p_plant_code varchar)
RETURNS void AS $$
BEGIN
  INSERT INTO "Mst_Gap" ("Gap_Name", "Plant_Code", "Del_Status", "CreatedDt")
  VALUES (p_name, p_plant_code, 'N', NOW());
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_update_gap(p_id bigint, p_name varchar, p_plant_code varchar)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Gap" SET "Gap_Name" = p_name, "Plant_Code" = p_plant_code, "ModifiedDt" = NOW()
  WHERE "Id" = p_id AND "Del_Status" = 'N';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_delete_gap(p_id bigint)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Gap" SET "Del_Status" = 'Y', "ModifiedDt" = NOW() WHERE "Id" = p_id;
END;
$$ LANGUAGE plpgsql;


-- 10. LINE STOPPAGE TRANSACTIONS
CREATE OR REPLACE FUNCTION sp_get_line_stoppages()
RETURNS TABLE(
  id bigint, plant_code varchar, plant_name varchar,
  shop_code bigint, shop_name varchar,
  module_code bigint, module_name varchar,
  line_code bigint, line_name varchar,
  machine_code bigint, mchn_name varchar,
  type_code bigint, type_desc varchar,
  linereason_code bigint, gap_name varchar,
  reason varchar, loto integer, status varchar,
  starttime timestamp, endtime timestamp,
  closure varchar, spares varchar,
  hours numeric, mins bigint,
  servicetype varchar, breakdowntype varchar
) AS $$
BEGIN
  RETURN QUERY
  SELECT t."Id", t."Plant_Code", p.plant_name,
         t."Shop_Code", s."Shop_Name",
         t."Module_Code", m."Module_Name",
         t."Line_Code", l."Line_Name",
         t."Machine_Code", mc."Mchn_Name",
         t."Type_Code", tp."Type_Desc",
         t."LineReason_Code", g."Gap_Name",
         t."Reason", t."Loto", t."Status",
         t."Entry_Date", t."Close_Date",
         t."Closure", t."Spares",
         (EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date"))/3600)::numeric,
         FLOOR(MOD((EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date"))/60)::numeric, 60))::bigint,
         t.servicetype, t."Breakdowntype"
  FROM "Trn_LineStoppage" t
  JOIN "plant" p ON t."Plant_Code" = p.plant_code
  LEFT JOIN "Mst_Shop" s ON t."Shop_Code" = s."Shop_code"
  LEFT JOIN "Mst_Module" m ON t."Module_Code" = m."Module_Code"
  LEFT JOIN "Mst_Line" l ON t."Line_Code" = l."Line_code"
  LEFT JOIN "Mst_Machine" mc ON t."Machine_Code" = mc."Mchn_code"
  LEFT JOIN "Mst_Type" tp ON t."Type_Code"::text = tp."Id"::text AND t."Plant_Code"::text = tp."Plant_Code"::text
  LEFT JOIN "Mst_Gap" g ON t."LineReason_Code"::text = g."Id"::text AND t."Plant_Code"::text = g."Plant_Code"::text
  WHERE t."Del_Status" = 'N'
  ORDER BY t."Entry_Date" DESC NULLS LAST
  LIMIT 200;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_create_line_stoppage(
  p_plant_code varchar, p_shop_code bigint, p_module_code bigint, p_line_code bigint, p_machine_code bigint,
  p_type_code bigint, p_linereason_code bigint, p_reason varchar, p_starttime timestamp, p_status varchar,
  p_created_by bigint, p_servicetype varchar
) RETURNS void AS $$
BEGIN
  INSERT INTO "Trn_LineStoppage" (
    "Plant_Code", "Shop_Code", "Module_Code", "Line_Code", "Machine_Code",
    "Type_Code", "LineReason_Code", "Reason", "Entry_Date", "Status",
    "Del_Status", "Created_By", "CreatedDt", "servicetype"
  ) VALUES (
    p_plant_code, p_shop_code, p_module_code, p_line_code, p_machine_code,
    p_type_code, p_linereason_code, p_reason, p_starttime, p_status,
    'N', p_created_by, NOW(), p_servicetype
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_close_line_stoppage(
  p_id bigint, p_status varchar, p_close_date timestamp, p_closure varchar, p_spares varchar,
  p_modified_by bigint, p_breakdowntype varchar
) RETURNS void AS $$
BEGIN
  UPDATE "Trn_LineStoppage"
  SET "Status" = p_status,
      "Close_Date" = p_close_date,
      "Closure" = p_closure,
      "Spares" = p_spares,
      "ModifiedBy" = p_modified_by,
      "ModifiedDt" = NOW(),
      "Breakdowntype" = p_breakdowntype
  WHERE "Id" = p_id AND "Del_Status" = 'N';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_delete_line_stoppage(p_id bigint)
RETURNS void AS $$
BEGIN
  UPDATE "Trn_LineStoppage" SET "Del_Status" = 'Y', "ModifiedDt" = NOW() WHERE "Id" = p_id;
END;
$$ LANGUAGE plpgsql;


-- 11. MIS REPORT FUNCTIONS
CREATE OR REPLACE FUNCTION sp_rpt_datewise(p_start timestamp, p_end timestamp)
RETURNS TABLE(
  plant_name varchar, shop_name varchar, line_name varchar, mchn_name varchar,
  stoppage_date date, duration numeric, incidents bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT p.plant_name, s."Shop_Name" AS shop_name, l."Line_Name" AS line_name, mc."Mchn_Name" AS mchn_name,
         CAST(t."Entry_Date" AS date) AS stoppage_date,
         ROUND(SUM(EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date")) / 3600)::numeric, 2) AS duration,
         COUNT(t."Id") AS incidents
      FROM "Trn_LineStoppage" t
      JOIN "plant" p ON t."Plant_Code" = p.plant_code
      LEFT JOIN "Mst_Shop" s ON t."Shop_Code" = s."Shop_code"
      LEFT JOIN "Mst_Line" l ON t."Line_Code" = l."Line_code"
      LEFT JOIN "Mst_Machine" mc ON t."Machine_Code" = mc."Mchn_code"
      WHERE t."Entry_Date" >= p_start AND t."Entry_Date" <= p_end AND t."Del_Status" = 'N'
      GROUP BY p.plant_name, s."Shop_Name", l."Line_Name", mc."Mchn_Name", CAST(t."Entry_Date" AS date)
      ORDER BY stoppage_date ASC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_rpt_machinewise(p_start timestamp, p_end timestamp)
RETURNS TABLE(
  plant_name varchar, shop_name varchar, line_name varchar, mchn_name varchar,
  duration numeric, incidents bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT p.plant_name, s."Shop_Name" AS shop_name, l."Line_Name" AS line_name, mc."Mchn_Name" AS mchn_name,
         ROUND(SUM(EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date")) / 3600)::numeric, 2) AS duration,
         COUNT(t."Id") AS incidents
      FROM "Trn_LineStoppage" t
      JOIN "plant" p ON t."Plant_Code" = p.plant_code
      LEFT JOIN "Mst_Shop" s ON t."Shop_Code" = s."Shop_code"
      LEFT JOIN "Mst_Line" l ON t."Line_Code" = l."Line_code"
      LEFT JOIN "Mst_Machine" mc ON t."Machine_Code" = mc."Mchn_code"
      WHERE t."Entry_Date" >= p_start AND t."Entry_Date" <= p_end AND t."Del_Status" = 'N'
      GROUP BY p.plant_name, s."Shop_Name", l."Line_Name", mc."Mchn_Name"
      ORDER BY duration DESC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_rpt_gapwise(p_start timestamp, p_end timestamp)
RETURNS TABLE(
  gap_name varchar, duration numeric, incidents bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT g."Gap_Name" AS gap_name,
         ROUND(SUM(EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date")) / 3600)::numeric, 2) AS duration,
         COUNT(t."Id") AS incidents
      FROM "Trn_LineStoppage" t
      LEFT JOIN "Mst_Gap" g ON t."LineReason_Code"::text = g."Id"::text AND t."Plant_Code"::text = g."Plant_Code"::text
      WHERE t."Entry_Date" >= p_start AND t."Entry_Date" <= p_end AND t."Del_Status" = 'N'
      GROUP BY g."Gap_Name"
      ORDER BY duration DESC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_rpt_shiftwise(p_start timestamp, p_end timestamp)
RETURNS TABLE(
  shift_name varchar, duration numeric, incidents bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT COALESCE(sh."Shift_Name", 'General')::varchar AS shift_name,
         ROUND(SUM(EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date")) / 3600)::numeric, 2) AS duration,
         COUNT(t."Id") AS incidents
      FROM "Trn_LineStoppage" t
      LEFT JOIN "Mst_Shift" sh ON (
        (EXTRACT(HOUR FROM t."Entry_Date")*60 + EXTRACT(MINUTE FROM t."Entry_Date")) >= 
        (EXTRACT(HOUR FROM sh."Start_Time")*60 + EXTRACT(MINUTE FROM sh."Start_Time"))
        AND
        (EXTRACT(HOUR FROM t."Entry_Date")*60 + EXTRACT(MINUTE FROM t."Entry_Date")) <= 
        (EXTRACT(HOUR FROM sh."End_Time")*60 + EXTRACT(MINUTE FROM sh."End_Time"))
      )
      WHERE t."Entry_Date" >= p_start AND t."Entry_Date" <= p_end AND t."Del_Status" = 'N'
      GROUP BY sh."Shift_Name"
      ORDER BY duration DESC;
END;
$$ LANGUAGE plpgsql;


-- 12. DYNAMIC GENERIC CRUD FUNCTIONS
CREATE OR REPLACE FUNCTION sp_generic_select(p_table text)
RETURNS TABLE(row_data jsonb) AS $$
BEGIN
  RETURN QUERY EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE t."Del_Status" = ''N''', p_table);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_generic_insert(p_table text, p_columns text[], p_values text[])
RETURNS void AS $$
DECLARE
  v_col_str text := '';
  v_val_str text := '';
  i integer;
BEGIN
  FOR i IN 1..array_length(p_columns, 1) LOOP
    v_col_str := v_col_str || quote_ident(p_columns[i]) || ',';
    v_val_str := v_val_str || quote_literal(p_values[i]) || ',';
  END LOOP;
  v_col_str := rtrim(v_col_str, ',');
  v_val_str := rtrim(v_val_str, ',');
  EXECUTE format('INSERT INTO %I (%s, "Del_Status", "CreatedDt") VALUES (%s, ''N'', NOW())', p_table, v_col_str, v_val_str);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_generic_update(p_table text, p_columns text[], p_values text[], p_key_col text, p_key_val text)
RETURNS void AS $$
DECLARE
  v_set_str text := '';
  i integer;
BEGIN
  FOR i IN 1..array_length(p_columns, 1) LOOP
    v_set_str := v_set_str || quote_ident(p_columns[i]) || ' = ' || quote_literal(p_values[i]) || ',';
  END LOOP;
  v_set_str := rtrim(v_set_str, ',');
  EXECUTE format('UPDATE %I SET %s, "ModifiedDt" = NOW() WHERE %I = %L AND "Del_Status" = ''N''', p_table, v_set_str, p_key_col, p_key_val);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_generic_delete(p_table text, p_key_col text, p_key_val text)
RETURNS void AS $$
BEGIN
  EXECUTE format('UPDATE %I SET "Del_Status" = ''Y'', "ModifiedDt" = NOW() WHERE %I = %L', p_table, p_key_col, p_key_val);
END;
$$ LANGUAGE plpgsql;
