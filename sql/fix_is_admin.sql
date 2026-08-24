-- Fix is_admin type casts in Employee Stored Procedures

CREATE OR REPLACE FUNCTION sp_authenticate_user(p_username varchar, p_password varchar)
RETURNS TABLE(
  emp_id bigint, emp_no varchar, emp_name varchar, username varchar, 
  plant_code varchar, is_admin integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT e."Emp_Id", e."Emp_No", e."Emp_Name", e."User_Name", e."Plant_Code", e.is_admin::integer
  FROM "Mst_Employee" e
  WHERE e."User_Name" = p_username AND e."Password" = p_password AND e."Del_Status" = 'N';
END;
$$ LANGUAGE plpgsql;

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
    e.is_admin::integer, e."Password", e."Plant_Code", 
    p.plant_name, d.dept_name
  FROM "Mst_Employee" e
  JOIN "plant" p ON e."Plant_Code" = p.plant_code
  LEFT JOIN "mst_dept" d ON (e."Dept" ~ '^[0-9]+$' AND e."Dept"::bigint = d.dept_id)
  WHERE e."Del_Status" = 'N'
  ORDER BY e."Emp_Name" ASC;
END;
$$ LANGUAGE plpgsql;
