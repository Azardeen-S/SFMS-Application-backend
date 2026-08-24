-- Fix sp_get_active_machines: no Asset_No column, use correct column names
-- Fix sp_generic_select: use exact column casing from information_schema

DROP FUNCTION IF EXISTS sp_get_active_machines();
DROP FUNCTION IF EXISTS sp_generic_select(text);
DROP FUNCTION IF EXISTS sp_generic_delete(text, text, text);

-- Fixed machine function including SAPMchn_Code (SAP Machine Code)
CREATE OR REPLACE FUNCTION sp_get_active_machines()
RETURNS TABLE(
  id bigint, mchn_code varchar, mchn_name varchar, sap_mchn_code varchar,
  plant_code varchar, plant_name varchar,
  shop_code bigint, shop_name varchar,
  module_code bigint, module_name varchar,
  line_code bigint, line_name varchar,
  group_id varchar, subgroup_id varchar, category_id varchar,
  output_per_hr numeric, is_rml_input boolean, utility boolean, critical_machine boolean,
  del_status varchar
) AS $$
BEGIN
  RETURN QUERY
  SELECT mc."Id", mc."Mchn_code"::varchar, mc."Mchn_Name"::varchar, mc."SAPMchn_Code"::varchar,
         mc."Plant_code"::varchar, p.plant_name::varchar,
         mc."Shop_code", s."Shop_Name"::varchar,
         mc."Module_Code", m."Module_Name"::varchar,
         mc."Line_code", l."Line_Name"::varchar,
         mc."Group_code"::varchar, mc."SubGroup_Code"::varchar, mc."Cat_id"::varchar,
         mc."outputperhr"::numeric,
         (CASE WHEN mc."Is_RM_Input"::text = '1' OR mc."Is_RM_Input"::text ILIKE 'true' OR mc."Is_RM_Input"::text ILIKE 'y' THEN true ELSE false END) AS is_rml_input,
         (CASE WHEN mc."Utility"::text = '1' OR mc."Utility"::text ILIKE 'true' OR mc."Utility"::text ILIKE 'y' THEN true ELSE false END) AS utility,
         (CASE WHEN mc."criticalmchn"::text = '1' OR mc."criticalmchn"::text ILIKE 'true' OR mc."criticalmchn"::text ILIKE 'y' THEN true ELSE false END) AS critical_machine,
         mc."Del_Status"::varchar
  FROM "Mst_Machine" mc
  LEFT JOIN "plant" p ON mc."Plant_code" = p.plant_code
  LEFT JOIN "Mst_Shop" s ON CAST(mc."Shop_code" AS VARCHAR) = CAST(s."Shop_code" AS VARCHAR) AND mc."Plant_code" = s."Plant_Code"
  LEFT JOIN "Mst_Module" m ON CAST(mc."Module_Code" AS VARCHAR) = CAST(m."Module_Code" AS VARCHAR) AND mc."Plant_code" = m."Plant_code"
  LEFT JOIN "Mst_Line" l ON CAST(mc."Line_code" AS VARCHAR) = CAST(l."Line_code" AS VARCHAR) AND mc."Plant_code" = l."Plant_code"
  WHERE mc."Del_Status" = 'N'
  ORDER BY mc."Mchn_Name" ASC;
END;
$$ LANGUAGE plpgsql;

-- Fixed generic select: dynamically look up the actual column name from information_schema first, then build query
CREATE OR REPLACE FUNCTION sp_generic_select(p_table text)
RETURNS TABLE(row_data jsonb) AS $$
DECLARE
  v_col_name text;
  v_query text;
BEGIN
  -- Check for Del_Status (any casing)
  SELECT column_name INTO v_col_name
  FROM information_schema.columns
  WHERE table_name = p_table
    AND lower(column_name) = 'del_status'
  LIMIT 1;

  IF v_col_name IS NOT NULL THEN
    v_query := format('SELECT to_jsonb(t) FROM %I t WHERE t.%I = ''N''', p_table, v_col_name);
    RETURN QUERY EXECUTE v_query;
    RETURN;
  END IF;

  -- Check for Is_Active (any casing)
  SELECT column_name INTO v_col_name
  FROM information_schema.columns
  WHERE table_name = p_table
    AND lower(column_name) = 'is_active'
  LIMIT 1;

  IF v_col_name IS NOT NULL THEN
    v_query := format('SELECT to_jsonb(t) FROM %I t WHERE t.%I = ''Y''', p_table, v_col_name);
    RETURN QUERY EXECUTE v_query;
    RETURN;
  END IF;

  -- No filter column, return all
  v_query := format('SELECT to_jsonb(t) FROM %I t', p_table);
  RETURN QUERY EXECUTE v_query;
END;
$$ LANGUAGE plpgsql;

-- Fixed generic delete: look up exact column name the same way
CREATE OR REPLACE FUNCTION sp_generic_delete(p_table text, p_key_col text, p_key_val text)
RETURNS void AS $$
DECLARE
  v_col_name text;
BEGIN
  -- Check for Del_Status
  SELECT column_name INTO v_col_name
  FROM information_schema.columns
  WHERE table_name = p_table
    AND lower(column_name) = 'del_status'
  LIMIT 1;

  IF v_col_name IS NOT NULL THEN
    EXECUTE format('UPDATE %I SET %I = ''Y'' WHERE %I = %L', p_table, v_col_name, p_key_col, p_key_val);
    RETURN;
  END IF;

  -- Check for Is_Active
  SELECT column_name INTO v_col_name
  FROM information_schema.columns
  WHERE table_name = p_table
    AND lower(column_name) = 'is_active'
  LIMIT 1;

  IF v_col_name IS NOT NULL THEN
    EXECUTE format('UPDATE %I SET %I = ''N'' WHERE %I = %L', p_table, v_col_name, p_key_col, p_key_val);
    RETURN;
  END IF;

  -- Hard delete fallback
  EXECUTE format('DELETE FROM %I WHERE %I = %L', p_table, p_key_col, p_key_val);
END;
$$ LANGUAGE plpgsql;
