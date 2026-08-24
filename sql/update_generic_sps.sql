-- Update Dynamic Generic CRUD stored procedures to handle Is_Active and standard table schema structures

DROP FUNCTION IF EXISTS sp_generic_select(text);
DROP FUNCTION IF EXISTS sp_generic_delete(text, text, text);

CREATE OR REPLACE FUNCTION sp_generic_select(p_table text)
RETURNS TABLE(row_data jsonb) AS $$
DECLARE
  v_has_del_status boolean;
  v_has_is_active boolean;
  v_query text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = p_table AND (column_name = 'Del_Status' OR column_name = 'Del_status' OR column_name = 'del_status')
  ) INTO v_has_del_status;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = p_table AND (column_name = 'Is_Active' OR column_name = 'is_active' OR column_name = 'Is_active')
  ) INTO v_has_is_active;

  IF v_has_del_status THEN
    v_query := format('SELECT to_jsonb(t) FROM %I t WHERE t."Del_Status" = ''N'' OR t."Del_status" = ''N'' OR t.del_status = ''N''', p_table);
  ELSIF v_has_is_active THEN
    v_query := format('SELECT to_jsonb(t) FROM %I t WHERE t."Is_Active" = ''Y'' OR t.is_active = ''Y''', p_table);
  ELSE
    v_query := format('SELECT to_jsonb(t) FROM %I t', p_table);
  END IF;

  RETURN QUERY EXECUTE v_query;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_generic_delete(p_table text, p_key_col text, p_key_val text)
RETURNS void AS $$
DECLARE
  v_has_del_status boolean;
  v_has_is_active boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = p_table AND (column_name = 'Del_Status' OR column_name = 'Del_status' OR column_name = 'del_status')
  ) INTO v_has_del_status;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = p_table AND (column_name = 'Is_Active' OR column_name = 'is_active' OR column_name = 'Is_active')
  ) INTO v_has_is_active;

  IF v_has_del_status THEN
    EXECUTE format('UPDATE %I SET "Del_Status" = ''Y'', "ModifiedDt" = NOW() WHERE %I = %L', p_table, p_key_col, p_key_val);
  ELSIF v_has_is_active THEN
    EXECUTE format('UPDATE %I SET "Is_Active" = ''N'', "ModifiedDt" = NOW() WHERE %I = %L', p_table, p_key_col, p_key_val);
  ELSE
    EXECUTE format('DELETE FROM %I WHERE %I = %L', p_table, p_key_col, p_key_val);
  END IF;
END;
$$ LANGUAGE plpgsql;
