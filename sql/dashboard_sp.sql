-- Dashboard Statistics Stored Procedure

CREATE OR REPLACE FUNCTION sp_get_dashboard_stats()
RETURNS TABLE(plants_count bigint, employees_count bigint, active_stoppages bigint, lines_count bigint) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM "plant" WHERE "del_status"='N'),
    (SELECT COUNT(*) FROM "Mst_Employee" WHERE "Del_Status"='N'),
    (SELECT COUNT(*) FROM "Trn_LineStoppage" WHERE "Status"='O' AND "Del_Status"='N'),
    (SELECT COUNT(*) FROM "Mst_Line" WHERE "Del_Status"='N');
END;
$$ LANGUAGE plpgsql;
