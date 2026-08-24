-- Additional Stored Procedures for SFMS

-- Auth / Authentication
CREATE OR REPLACE FUNCTION sp_authenticate_user(p_username varchar, p_password varchar)
RETURNS TABLE(
  emp_id bigint, emp_no varchar, emp_name varchar, username varchar, 
  plant_code varchar, is_admin integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT e."Emp_Id", e."Emp_No", e."Emp_Name", e."User_Name", e."Plant_Code", e.is_admin
  FROM "Mst_Employee" e
  WHERE e."User_Name" = p_username AND e."Password" = p_password AND e."Del_Status" = 'N';
END;
$$ LANGUAGE plpgsql;

-- Plant helper checkers
CREATE OR REPLACE FUNCTION sp_get_plant_by_code(p_code varchar)
RETURNS TABLE(plant_code varchar, plant_name varchar, del_status varchar) AS $$
BEGIN
  RETURN QUERY SELECT p.plant_code, p.plant_name, p.del_status FROM "plant" p WHERE p.plant_code = p_code;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_reactivate_plant(p_code varchar, p_name varchar)
RETURNS void AS $$
BEGIN
  UPDATE "plant" SET "plant_name" = p_name, "del_status" = 'N', "ModifiedDt" = NOW() WHERE "plant_code" = p_code;
END;
$$ LANGUAGE plpgsql;

-- Employee helper checkers
CREATE OR REPLACE FUNCTION sp_get_employee_by_no(p_emp_no varchar)
RETURNS TABLE(emp_id bigint, emp_no varchar, del_status varchar) AS $$
BEGIN
  RETURN QUERY SELECT e."Emp_Id", e."Emp_No", e."Del_Status" FROM "Mst_Employee" e WHERE e."Emp_No" = p_emp_no;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_get_employee_by_username(p_username varchar)
RETURNS TABLE(emp_id bigint, username varchar) AS $$
BEGIN
  RETURN QUERY SELECT e."Emp_Id", e."User_Name" FROM "Mst_Employee" e WHERE e."User_Name" = p_username;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_reactivate_employee(p_emp_no varchar, p_emp_name varchar, p_dept varchar, p_designation varchar, p_mail_id varchar, p_mobile_no varchar, p_is_admin integer, p_password varchar, p_plant_code varchar)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Employee" SET
    "Emp_Name" = p_emp_name, "Dept" = p_dept, "Designation" = p_designation,
    "Mail_Id" = p_mail_id, "Mobile_No" = p_mobile_no, is_admin = p_is_admin,
    "Password" = p_password, "Plant_Code" = p_plant_code, "Del_Status" = 'N', "ModifiedDt" = NOW()
  WHERE "Emp_No" = p_emp_no;
END;
$$ LANGUAGE plpgsql;

-- Shop checker helper
CREATE OR REPLACE FUNCTION sp_get_shop_by_code(p_code bigint)
RETURNS TABLE(shop_code bigint, shop_name varchar, del_status varchar) AS $$
BEGIN
  RETURN QUERY SELECT s."Shop_code", s."Shop_Name", s."Del_Status" FROM "Mst_Shop" s WHERE s."Shop_code" = p_code;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_reactivate_shop(p_code bigint, p_name varchar, p_plant_code varchar)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Shop" SET "Shop_Name" = p_name, "Plant_Code" = p_plant_code, "Del_Status" = 'N', "ModifiedDt" = NOW() WHERE "Shop_code" = p_code;
END;
$$ LANGUAGE plpgsql;

-- Module checker helper
CREATE OR REPLACE FUNCTION sp_get_module_by_code(p_code bigint)
RETURNS TABLE(module_code bigint, module_name varchar, del_status varchar) AS $$
BEGIN
  RETURN QUERY SELECT m."Module_Code", m."Module_Name", m."Del_Status" FROM "Mst_Module" m WHERE m."Module_Code" = p_code;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_reactivate_module(p_code bigint, p_name varchar, p_plant_code varchar, p_shop_code bigint)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Module" SET "Module_Name" = p_name, "Plant_code" = p_plant_code, "Shop_code" = p_shop_code, "Del_Status" = 'N', "ModifiedDt" = NOW() WHERE "Module_Code" = p_code;
END;
$$ LANGUAGE plpgsql;

-- Line checker helper
CREATE OR REPLACE FUNCTION sp_get_line_by_code(p_code bigint)
RETURNS TABLE(line_code bigint, line_name varchar, del_status varchar) AS $$
BEGIN
  RETURN QUERY SELECT l."Line_code", l."Line_Name", l."Del_Status" FROM "Mst_Line" l WHERE l."Line_code" = p_code;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_reactivate_line(p_code bigint, p_name varchar, p_plant_code varchar, p_shop_code bigint, p_module_code bigint)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Line" SET "Line_Name" = p_name, "Plant_code" = p_plant_code, "Shop_code" = p_shop_code, "Module_code" = p_module_code, "Del_Status" = 'N', "ModifiedDt" = NOW() WHERE "Line_code" = p_code;
END;
$$ LANGUAGE plpgsql;

-- Machine checker helper
CREATE OR REPLACE FUNCTION sp_get_machine_by_code(p_code bigint)
RETURNS TABLE(mchn_code bigint, mchn_name varchar, del_status varchar) AS $$
BEGIN
  RETURN QUERY SELECT mc."Mchn_code", mc."Mchn_Name", mc."Del_Status" FROM "Mst_Machine" mc WHERE mc."Mchn_code" = p_code;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_reactivate_machine(p_code bigint, p_name varchar, p_asset varchar, p_plant_code varchar, p_shop_code bigint, p_module_code bigint, p_line_code bigint)
RETURNS void AS $$
BEGIN
  UPDATE "Mst_Machine" SET "Mchn_Name" = p_name, "Asset_No" = p_asset, "Plant_code" = p_plant_code, "Shop_code" = p_shop_code, "Module_code" = p_module_code, "Line_code" = p_line_code, "Del_Status" = 'N', "ModifiedDt" = NOW() WHERE "Mchn_code" = p_code;
END;
$$ LANGUAGE plpgsql;
