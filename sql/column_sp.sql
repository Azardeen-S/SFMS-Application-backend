-- Column Metadata Stored Procedure

CREATE OR REPLACE FUNCTION sp_get_table_columns(p_table text)
RETURNS TABLE(column_name varchar) AS $$
BEGIN
  RETURN QUERY
  SELECT c.column_name::varchar
  FROM information_schema.columns c
  WHERE c.table_name = p_table;
END;
$$ LANGUAGE plpgsql;
