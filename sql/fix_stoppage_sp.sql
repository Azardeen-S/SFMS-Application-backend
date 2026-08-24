-- Drop and recreate sp_get_line_stoppages to align precisely with table column data types

DROP FUNCTION IF EXISTS sp_get_line_stoppages();

CREATE OR REPLACE FUNCTION sp_get_line_stoppages()
RETURNS TABLE(
  id integer, plant_code varchar, plant_name varchar,
  shop_code bigint, shop_name varchar,
  module_code bigint, module_name varchar,
  line_code bigint, line_name varchar,
  machine_code varchar, mchn_name varchar,
  type_code varchar, type_desc varchar,
  linereason_code varchar, gap_name varchar,
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
