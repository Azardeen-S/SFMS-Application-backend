-- Update Employee Creation & Reactivation SPs to include User_Name column

CREATE OR REPLACE FUNCTION sp_create_employee(
  p_emp_no varchar, p_emp_name varchar, p_dept varchar, p_designation varchar,
  p_mail_id varchar, p_mobile_no varchar, p_is_admin integer, p_password varchar,
  p_plant_code varchar
) RETURNS void AS $$
BEGIN
  INSERT INTO "Mst_Employee" (
    "Emp_No", "Emp_Name", "Dept", "Designation", "Mail_Id", "Mobile_No",
    is_admin, "Password", "Plant_Code", "Del_Status", "User_Name", "CreatedDt"
  ) VALUES (
    p_emp_no, p_emp_name, p_dept, p_designation, p_mail_id, p_mobile_no,
    p_is_admin, p_password, p_plant_code, 'N', p_emp_no, NOW()
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_reactivate_employee(
  p_emp_no varchar, p_emp_name varchar, p_dept varchar, p_designation varchar,
  p_mail_id varchar, p_mobile_no varchar, p_is_admin integer, p_password varchar,
  p_plant_code varchar
) RETURNS void AS $$
BEGIN
  UPDATE "Mst_Employee" SET
    "Emp_Name" = p_emp_name, "Dept" = p_dept, "Designation" = p_designation,
    "Mail_Id" = p_mail_id, "Mobile_No" = p_mobile_no, is_admin = p_is_admin,
    "Password" = p_password, "Plant_Code" = p_plant_code, "User_Name" = p_emp_no,
    "Del_Status" = 'N', "ModifiedDt" = NOW()
  WHERE "Emp_No" = p_emp_no;
END;
$$ LANGUAGE plpgsql;
