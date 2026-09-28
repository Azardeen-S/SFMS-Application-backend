-- Add created/closure emp code & name to sp_get_line_stoppages.
-- Frontend was showing "-" for Emp No / Emp Name even though
-- Created_Empcode/Created_Empname/Closure_Empcode/Closure_Empname
-- are populated correctly in Trn_LineStoppage; the function just
-- never returned them.

DROP FUNCTION IF EXISTS sp_get_line_stoppages(varchar);

CREATE OR REPLACE FUNCTION sp_get_line_stoppages(p_plant_code varchar DEFAULT NULL)
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
         t."Reason", t."Loto", t."Status",
         t."Entry_Date", t."Close_Date", t."Close_Date",
         t."Closure", t."Spares",
         ROUND((EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date"))/3600)::numeric, 2),
         FLOOR(MOD((EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date"))/60)::numeric, 60))::bigint,
         t.servicetype, t."Breakdowntype",
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
  WHERE t."Del_Status" = 'N'
    AND (p_plant_code IS NULL OR t."Plant_Code" = p_plant_code)
  ORDER BY t."Id" DESC, t."Entry_Date" DESC NULLS LAST
  LIMIT 200;
END;
$$ LANGUAGE plpgsql;
