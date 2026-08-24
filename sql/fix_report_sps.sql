-- Drop and recreate MIS report stored procedures to return exact column formats for the frontend

DROP FUNCTION IF EXISTS sp_rpt_datewise(timestamp, timestamp);
DROP FUNCTION IF EXISTS sp_rpt_machinewise(timestamp, timestamp);
DROP FUNCTION IF EXISTS sp_rpt_gapwise(timestamp, timestamp);
DROP FUNCTION IF EXISTS sp_rpt_shiftwise(timestamp, timestamp);

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

CREATE OR REPLACE FUNCTION sp_rpt_machinewise(p_start timestamp, p_end timestamp)
RETURNS TABLE(
  mchn_name varchar, stoppage_count bigint, total_hours numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT mc."Mchn_Name" AS mchn_name,
         COUNT(t."Id") AS stoppage_count,
         ROUND(SUM(EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date"))/3600)::numeric, 2) AS total_hours
  FROM "Trn_LineStoppage" t
  JOIN "Mst_Machine" mc ON t."Machine_Code" = mc."Mchn_code"
  WHERE t."Del_Status" = 'N'
    AND t."Entry_Date" >= p_start
    AND t."Entry_Date" <= p_end
  GROUP BY mc."Mchn_Name"
  ORDER BY total_hours DESC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_rpt_gapwise(p_start timestamp, p_end timestamp)
RETURNS TABLE(
  gap_name varchar, stoppage_count bigint, total_hours numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT g."Gap_Name" AS gap_name,
         COUNT(t."Id") AS stoppage_count,
         ROUND(SUM(EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date"))/3600)::numeric, 2) AS total_hours
  FROM "Trn_LineStoppage" t
  JOIN "Mst_Gap" g ON t."LineReason_Code"::text = g."Id"::text AND t."Plant_Code"::text = g."Plant_Code"::text
  WHERE t."Del_Status" = 'N'
    AND t."Entry_Date" >= p_start
    AND t."Entry_Date" <= p_end
  GROUP BY g."Gap_Name"
  ORDER BY stoppage_count DESC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_rpt_shiftwise(p_start timestamp, p_end timestamp)
RETURNS TABLE(
  shift_code varchar, stoppage_count bigint, total_hours numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT COALESCE(t."Shift_code"::text, 'Unknown')::varchar AS shift_code,
         COUNT(t."Id") AS stoppage_count,
         ROUND(SUM(EXTRACT(EPOCH FROM (COALESCE(t."Close_Date", NOW()) - t."Entry_Date"))/3600)::numeric, 2) AS total_hours
  FROM "Trn_LineStoppage" t
  WHERE t."Del_Status" = 'N'
    AND t."Entry_Date" >= p_start
    AND t."Entry_Date" <= p_end
  GROUP BY t."Shift_code"
  ORDER BY shift_code ASC;
END;
$$ LANGUAGE plpgsql;
