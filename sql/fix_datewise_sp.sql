-- Fix sp_rpt_datewise: Trn_LineStoppage."Id" is integer, not bigint
-- Also add DISTINCT ON to prevent duplicate rows from type/gap joins

DROP FUNCTION IF EXISTS sp_rpt_datewise(timestamp, timestamp);

CREATE OR REPLACE FUNCTION sp_rpt_datewise(p_start timestamp, p_end timestamp)
RETURNS TABLE(
  "Id" integer, plant_name varchar, shop_name varchar, module_name varchar,
  line_name varchar, mchn_name varchar, type_desc varchar, gap_name varchar,
  "Status" varchar, "Start_Time" timestamp, "End_Time" timestamp,
  "Closure" text, hours numeric, mins numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (t."Id")
         t."Id",
         p.plant_name, s."Shop_Name" AS shop_name, m."Module_Name" AS module_name,
         l."Line_Name" AS line_name,
         (SELECT mc."Mchn_Name" FROM "Mst_Machine" mc WHERE mc."Mchn_code" = t."Machine_Code" LIMIT 1) AS mchn_name,
         tp."Type_Desc" AS type_desc, g."Gap_Name" AS gap_name,
         t."Status", t."Entry_Date", t."Close_Date", t."Closure"::text,
         ROUND((EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date"))/3600)::numeric, 2) AS hours,
         FLOOR(MOD((EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date"))/60)::numeric, 60)) AS mins
  FROM "Trn_LineStoppage" t
  JOIN "plant" p ON t."Plant_Code" = p.plant_code
  LEFT JOIN "Mst_Shop" s ON t."Shop_Code" = s."Shop_code"
  LEFT JOIN "Mst_Module" m ON t."Module_Code" = m."Module_Code"
  LEFT JOIN "Mst_Line" l ON t."Line_Code" = l."Line_code"
  LEFT JOIN "Mst_Type" tp ON t."Type_Code"::text = tp."Id"::text AND t."Plant_Code"::text = tp."Plant_Code"::text
  LEFT JOIN "Mst_Gap" g ON t."LineReason_Code"::text = g."Id"::text AND t."Plant_Code"::text = g."Plant_Code"::text
  WHERE t."Del_Status" = 'N'
    AND t."Entry_Date" >= p_start
    AND t."Entry_Date" <= p_end
  ORDER BY t."Id" DESC, t."Entry_Date" DESC
  LIMIT 5000;
END;
$$ LANGUAGE plpgsql;
