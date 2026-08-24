-- Fix sp_create_line_stoppage: Machine_Code, Type_Code, LineReason_Code are all varchar in Trn_LineStoppage
-- Also check sp_close_line_stoppage and sp_delete_line_stoppage

DROP FUNCTION IF EXISTS sp_create_line_stoppage(varchar, bigint, bigint, bigint, bigint, bigint, bigint, varchar, timestamp, varchar, bigint, varchar);

CREATE OR REPLACE FUNCTION sp_create_line_stoppage(
  p_plant_code varchar,
  p_shop_code bigint,
  p_module_code bigint,
  p_line_code bigint,
  p_machine_code varchar,   -- varchar, not bigint
  p_type_code varchar,      -- varchar, not bigint
  p_linereason_code varchar, -- varchar, not bigint
  p_reason varchar,
  p_starttime timestamp,
  p_status varchar,
  p_created_by bigint,
  p_servicetype varchar
) RETURNS void AS $$
BEGIN
  INSERT INTO "Trn_LineStoppage" (
    "Plant_Code", "Shop_Code", "Module_Code", "Line_Code", "Machine_Code",
    "Type_Code", "LineReason_Code", "Reason", "Entry_Date", "Status",
    "Del_Status", "Created_By", "CreatedDt", "servicetype"
  ) VALUES (
    p_plant_code, p_shop_code, p_module_code, p_line_code, p_machine_code,
    p_type_code, p_linereason_code, p_reason, p_starttime, p_status,
    'N', p_created_by, NOW(), p_servicetype
  );
END;
$$ LANGUAGE plpgsql;
