import pyodbc
import psycopg2
from psycopg2.extras import execute_values
import datetime

# ─── Connections ───────────────────────────────────────────────────────────
sql_conn_str = "Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=SFMS;Trusted_Connection=yes;"
pg_conn_params = {
    "host": "127.0.0.1",
    "port": 5432,
    "database": "SFMS",
    "user": "postgres",
    "password": "Admin@123"
}

def to_int(val):
    if val is None:
        return None
    s = str(val).strip()
    if s.isdigit():
        return int(s)
    # If it's a decimal number represented as string, convert to float then int
    try:
        return int(float(s))
    except ValueError:
        return None

def migrate():
    print("Starting migration from SQL Server to PostgreSQL...")
    sql_conn = pyodbc.connect(sql_conn_str)
    sql_cursor = sql_conn.cursor()

    pg_conn = psycopg2.connect(**pg_conn_params)
    pg_conn.autocommit = False
    pg_cursor = pg_conn.cursor()

    try:
        # ─── 1. Recreate "plant" ───────────────────────────────────────────
        print("Migrating table 'plant'...")
        pg_cursor.execute("DROP TABLE IF EXISTS \"plant\" CASCADE;")
        pg_cursor.execute("""
            CREATE TABLE "plant" (
                "plant_code" VARCHAR(5) PRIMARY KEY,
                "plant_name" VARCHAR(100) NOT NULL,
                "del_status" VARCHAR(1) DEFAULT 'N' NOT NULL,
                "Created_By" BIGINT,
                "CreatedDt" TIMESTAMP,
                "ModifiedBy" BIGINT,
                "ModifiedDt" TIMESTAMP,
                "Company_Id" INTEGER
            );
        """)
        
        sql_cursor.execute("SELECT plant_code, plant_name, del_status, Created_By, CreatedDt, ModifiedBy, ModifiedDt, Company_Id FROM plant;")
        rows = sql_cursor.fetchall()
        insert_query = """
            INSERT INTO "plant" ("plant_code", "plant_name", "del_status", "Created_By", "CreatedDt", "ModifiedBy", "ModifiedDt", "Company_Id")
            VALUES %s;
        """
        data = [tuple(row) for row in rows]
        if data:
            execute_values(pg_cursor, insert_query, data)
        print(f"Migrated {len(data)} rows for 'plant'.")

        # ─── 2. Recreate "mst_dept" ─────────────────────────────────────────
        print("Migrating table 'mst_dept'...")
        pg_cursor.execute("DROP TABLE IF EXISTS \"mst_dept\" CASCADE;")
        pg_cursor.execute("""
            CREATE TABLE "mst_dept" (
                "dept_id" BIGINT PRIMARY KEY,
                "dept_code" VARCHAR(50),
                "dept_name" VARCHAR(256) NOT NULL,
                "del_status" VARCHAR(1) DEFAULT 'N' NOT NULL,
                "plant_code" VARCHAR(5) NOT NULL,
                "Created_By" BIGINT,
                "CreatedDt" TIMESTAMP,
                "ModifiedBy" BIGINT,
                "ModifiedDt" TIMESTAMP
            );
        """)
        sql_cursor.execute("SELECT dept_id, dept_code, dept_name, del_status, Plant_Code, Created_By, CreatedDt, ModifiedBy, ModifiedDt FROM mst_dept;")
        rows = sql_cursor.fetchall()
        insert_query = """
            INSERT INTO "mst_dept" ("dept_id", "dept_code", "dept_name", "del_status", "plant_code", "Created_By", "CreatedDt", "ModifiedBy", "ModifiedDt")
            VALUES %s;
        """
        data = [tuple(row) for row in rows]
        if data:
            execute_values(pg_cursor, insert_query, data)
        print(f"Migrated {len(data)} rows for 'mst_dept'.")

        # ─── 3. Recreate "Mst_Employee" ─────────────────────────────────────
        print("Migrating table 'Mst_Employee'...")
        pg_cursor.execute("DROP TABLE IF EXISTS \"Mst_Employee\" CASCADE;")
        pg_cursor.execute("""
            CREATE TABLE "Mst_Employee" (
                "Emp_Id" BIGINT PRIMARY KEY,
                "Emp_No" VARCHAR(50) NOT NULL,
                "Emp_Name" VARCHAR(200),
                "Dept" VARCHAR(50),
                "Designation" VARCHAR(50),
                "Mail_Id" VARCHAR(200),
                "Mobile_No" VARCHAR(50),
                "Del_Status" VARCHAR(1) DEFAULT 'N',
                "emp_group" VARCHAR(50),
                "emp_level" VARCHAR(50),
                "is_admin" SMALLINT,
                "Password" VARCHAR(100),
                "access_visit" SMALLINT,
                "User_Name" VARCHAR(50),
                "master" SMALLINT,
                "Plant_Code" VARCHAR(5) NOT NULL,
                "Created_By" BIGINT,
                "CreatedDt" TIMESTAMP,
                "ModifiedBy" BIGINT,
                "ModifiedDt" TIMESTAMP
            );
        """)
        sql_cursor.execute("""
            SELECT Emp_Id, Emp_No, Emp_Name, Dept, Designation, Mail_Id, Mobile_No, Del_Status, 
                   emp_group, emp_level, is_admin, Password, access_visit, User_Name, master, 
                   Plant_Code, Created_By, CreatedDt, ModifiedBy, ModifiedDt 
            FROM Mst_Employee;
        """)
        rows = sql_cursor.fetchall()
        insert_query = """
            INSERT INTO "Mst_Employee" (
                "Emp_Id", "Emp_No", "Emp_Name", "Dept", "Designation", "Mail_Id", "Mobile_No", "Del_Status",
                "emp_group", "emp_level", "is_admin", "Password", "access_visit", "User_Name", "master",
                "Plant_Code", "Created_By", "CreatedDt", "ModifiedBy", "ModifiedDt"
            ) VALUES %s;
        """
        data = [tuple(row) for row in rows]
        if data:
            execute_values(pg_cursor, insert_query, data)
        print(f"Migrated {len(data)} rows for 'Mst_Employee'.")

        # ─── 4. Recreate "Mst_Shop" ─────────────────────────────────────────
        print("Migrating table 'Mst_Shop'...")
        pg_cursor.execute("DROP TABLE IF EXISTS \"Mst_Shop\" CASCADE;")
        pg_cursor.execute("""
            CREATE TABLE "Mst_Shop" (
                "Shop_Code" BIGINT PRIMARY KEY,
                "Shop_Name" VARCHAR(100),
                "Del_Status" VARCHAR(1) DEFAULT 'N',
                "Plant_Code" VARCHAR(5) NOT NULL,
                "Created_By" BIGINT,
                "CreatedDt" TIMESTAMP,
                "ModifiedBy" BIGINT,
                "ModifiedDt" TIMESTAMP
            );
        """)
        sql_cursor.execute("SELECT Shop_code, Shop_Name, Del_Status, Plant_Code, Created_By, CreatedDt, ModifiedBy, ModifiedDt FROM Mst_Shop;")
        rows = sql_cursor.fetchall()
        insert_query = """
            INSERT INTO "Mst_Shop" ("Shop_Code", "Shop_Name", "Del_Status", "Plant_Code", "Created_By", "CreatedDt", "ModifiedBy", "ModifiedDt")
            VALUES %s;
        """
        data = [tuple(row) for row in rows]
        if data:
            execute_values(pg_cursor, insert_query, data)
        print(f"Migrated {len(data)} rows for 'Mst_Shop'.")

        # ─── 5. Recreate "Mst_Module" ───────────────────────────────────────
        print("Migrating table 'Mst_Module'...")
        pg_cursor.execute("DROP TABLE IF EXISTS \"Mst_Module\" CASCADE;")
        pg_cursor.execute("""
            CREATE TABLE "Mst_Module" (
                "Module_Code" BIGINT PRIMARY KEY,
                "Module_Name" VARCHAR(100),
                "Shop_Code" BIGINT,
                "Del_Status" VARCHAR(1) DEFAULT 'N',
                "email" SMALLINT,
                "Plant_Code" VARCHAR(5) NOT NULL,
                "Created_By" BIGINT,
                "CreatedDt" TIMESTAMP,
                "ModifiedBy" BIGINT,
                "ModifiedDt" TIMESTAMP
            );
        """)
        sql_cursor.execute("SELECT Module_Code, Module_Name, Shop_code, Del_Status, email, Plant_code, Created_By, CreatedDt, ModifiedBy, ModifiedDt FROM Mst_Module;")
        rows = sql_cursor.fetchall()
        insert_query = """
            INSERT INTO "Mst_Module" ("Module_Code", "Module_Name", "Shop_Code", "Del_Status", "email", "Plant_Code", "Created_By", "CreatedDt", "ModifiedBy", "ModifiedDt")
            VALUES %s;
        """
        data = []
        for r in rows:
            data.append((
                r[0], r[1], to_int(r[2]), r[3], r[4], r[5], r[6], r[7], r[8], r[9]
            ))
        if data:
            execute_values(pg_cursor, insert_query, data)
        print(f"Migrated {len(data)} rows for 'Mst_Module'.")

        # ─── 6. Recreate "Mst_Line" ─────────────────────────────────────────
        print("Migrating table 'Mst_Line'...")
        pg_cursor.execute("DROP TABLE IF EXISTS \"Mst_Line\" CASCADE;")
        pg_cursor.execute("""
            CREATE TABLE "Mst_Line" (
                "Line_Code" BIGINT PRIMARY KEY,
                "Line_Name" VARCHAR(100),
                "Shop_Code" BIGINT,
                "Module_Code" BIGINT,
                "Del_Status" VARCHAR(1) DEFAULT 'N',
                "Plant_Code" VARCHAR(5) NOT NULL,
                "Created_By" BIGINT,
                "CreatedDt" TIMESTAMP,
                "ModifiedBy" BIGINT,
                "ModifiedDt" TIMESTAMP
            );
        """)
        sql_cursor.execute("SELECT Line_code, Line_Name, Shop_code, Module_code, Del_Status, Plant_code, Created_By, created_on, modified_by, modified_on FROM Mst_Line;")
        rows = sql_cursor.fetchall()
        insert_query = """
            INSERT INTO "Mst_Line" ("Line_Code", "Line_Name", "Shop_Code", "Module_Code", "Del_Status", "Plant_Code", "Created_By", "CreatedDt", "ModifiedBy", "ModifiedDt")
            VALUES %s;
        """
        data = []
        for r in rows:
            data.append((
                r[0], r[1], to_int(r[2]), to_int(r[3]), r[4], r[5], r[6], r[7], r[8], r[9]
            ))
        if data:
            execute_values(pg_cursor, insert_query, data)
        print(f"Migrated {len(data)} rows for 'Mst_Line'.")

        # ─── 7. Recreate "Mst_Machine" ──────────────────────────────────────
        print("Migrating table 'Mst_Machine'...")
        pg_cursor.execute("DROP TABLE IF EXISTS \"Mst_Machine\" CASCADE;")
        pg_cursor.execute("""
            CREATE TABLE "Mst_Machine" (
                "Id" BIGINT PRIMARY KEY,
                "Mchn_Code" VARCHAR(50),
                "Cat_Id" BIGINT,
                "Mchn_Name" VARCHAR(100) NOT NULL,
                "Shop_Code" BIGINT,
                "Module_Code" BIGINT,
                "Line_Code" BIGINT,
                "Del_Status" VARCHAR(1) DEFAULT 'N',
                "displayarea" VARCHAR(50),
                "Asset_No" VARCHAR(100),
                "Group_code" VARCHAR(100),
                "outputperhr" DOUBLE PRECISION,
                "criticalmchn" SMALLINT,
                "SubGroup_Code" VARCHAR(100),
                "Utility" SMALLINT,
                "Plant_Code" VARCHAR(5) NOT NULL,
                "Created_By" BIGINT,
                "CreatedDt" TIMESTAMP,
                "ModifiedBy" BIGINT,
                "ModifiedDt" TIMESTAMP,
                "Is_RM_Input" SMALLINT
            );
        """)
        sql_cursor.execute("""
            SELECT Id, Mchn_code, Cat_id, Mchn_Name, Shop_code, Module_Code, Line_code, Del_Status, displayarea, 
                   SAPMchn_Code, Group_code, outputperhr, criticalmchn, SubGroup_Code, Utility, Plant_code, 
                   Created_By, CreatedDt, ModifiedBy, ModifiedDt, Is_RM_Input 
            FROM Mst_Machine;
        """)
        rows = sql_cursor.fetchall()
        insert_query = """
            INSERT INTO "Mst_Machine" (
                "Id", "Mchn_Code", "Cat_Id", "Mchn_Name", "Shop_Code", "Module_Code", "Line_Code", "Del_Status", "displayarea",
                "Asset_No", "Group_code", "outputperhr", "criticalmchn", "SubGroup_Code", "Utility", "Plant_Code",
                "Created_By", "CreatedDt", "ModifiedBy", "ModifiedDt", "Is_RM_Input"
            ) VALUES %s;
        """
        data = []
        for r in rows:
            data.append((
                r[0], r[1], r[2], r[3], to_int(r[4]), to_int(r[5]), to_int(r[6]), r[7], r[8],
                r[9], r[10], r[11], r[12], r[13], r[14], r[15], r[16], r[17], r[18], r[19], r[20]
            ))
        if data:
            execute_values(pg_cursor, insert_query, data)
        print(f"Migrated {len(data)} rows for 'Mst_Machine'.")

        # ─── 8. Recreate "Mst_Gap" ──────────────────────────────────────────
        print("Migrating table 'Mst_Gap'...")
        pg_cursor.execute("DROP TABLE IF EXISTS \"Mst_Gap\" CASCADE;")
        pg_cursor.execute("""
            CREATE TABLE "Mst_Gap" (
                "Id" BIGINT PRIMARY KEY,
                "Gap_Name" VARCHAR(250) NOT NULL,
                "Del_Status" VARCHAR(1) DEFAULT 'N',
                "Plant_Code" VARCHAR(5) NOT NULL,
                "Created_By" BIGINT,
                "CreatedDt" TIMESTAMP,
                "ModifiedBy" BIGINT,
                "ModifiedDt" TIMESTAMP
            );
        """)
        sql_cursor.execute("SELECT Id, Gap_Name, Del_Status, Plant_Code, Created_By, CreatedDt, ModifiedBy, ModifiedDt FROM Mst_Gap;")
        rows = sql_cursor.fetchall()
        insert_query = """
            INSERT INTO "Mst_Gap" ("Id", "Gap_Name", "Del_Status", "Plant_Code", "Created_By", "CreatedDt", "ModifiedBy", "ModifiedDt")
            VALUES %s;
        """
        data = [tuple(row) for row in rows]
        if data:
            execute_values(pg_cursor, insert_query, data)
        print(f"Migrated {len(data)} rows for 'Mst_Gap'.")

        # ─── 9. Recreate "Mst_Type" ─────────────────────────────────────────
        print("Migrating table 'Mst_Type'...")
        pg_cursor.execute("DROP TABLE IF EXISTS \"Mst_Type\" CASCADE;")
        pg_cursor.execute("""
            CREATE TABLE "Mst_Type" (
                "Id" BIGINT PRIMARY KEY,
                "Type_Desc" VARCHAR(250) NOT NULL,
                "Del_Status" VARCHAR(1) DEFAULT 'N',
                "Plant_Code" VARCHAR(5) NOT NULL,
                "Created_By" BIGINT,
                "CreatedDt" TIMESTAMP,
                "ModifiedBy" BIGINT,
                "ModifiedDt" TIMESTAMP
            );
        """)
        sql_cursor.execute("SELECT Id, Type_Desc, Del_Status, Plant_Code, Created_By, CreatedDt, ModifiedBy, ModifiedDt FROM Mst_Types;")
        rows = sql_cursor.fetchall()
        insert_query = """
            INSERT INTO "Mst_Type" ("Id", "Type_Desc", "Del_Status", "Plant_Code", "Created_By", "CreatedDt", "ModifiedBy", "ModifiedDt")
            VALUES %s;
        """
        data = [tuple(row) for row in rows]
        if data:
            execute_values(pg_cursor, insert_query, data)
        print(f"Migrated {len(data)} rows for 'Mst_Type'.")

        # ─── 10. Recreate "Trn_LineStoppage" ────────────────────────────────
        print("Migrating table 'Trn_LineStoppage'...")
        pg_cursor.execute("DROP TABLE IF EXISTS \"Trn_LineStoppage\" CASCADE;")
        pg_cursor.execute("""
            CREATE TABLE "Trn_LineStoppage" (
                "Id" SERIAL PRIMARY KEY,
                "Shop_Code" BIGINT,
                "Module_Code" BIGINT,
                "Line_Code" BIGINT,
                "Machine_Code" VARCHAR(50),
                "Type_Code" VARCHAR(50),
                "LineReason_Code" VARCHAR(50),
                "OEEReason_Code" VARCHAR(50),
                "Start_Time" TIMESTAMP,
                "End_Time" TIMESTAMP,
                "Status" VARCHAR(50),
                "Start_status" VARCHAR(50),
                "Shift_code" VARCHAR(1),
                "servicetype" VARCHAR(100),
                "Reason" VARCHAR(500),
                "Breakdowntype" VARCHAR(50),
                "Notification_No" VARCHAR(250),
                "Function_Location" VARCHAR(250),
                "SAP_Status" VARCHAR(250),
                "SAP_Remarks" VARCHAR(250),
                "ShortClose_Status" SMALLINT,
                "SAP_FileName_Notification" VARCHAR(250),
                "SAP_FileName_Status" VARCHAR(250),
                "Start_slno" INTEGER,
                "Stop_SlNo" INTEGER,
                "closedstatus" VARCHAR(50),
                "Closure" VARCHAR(50),
                "Spares" VARCHAR(200),
                "Phenomena" VARCHAR(50),
                "Loto" INTEGER,
                "Created_By" BIGINT,
                "CreatedDt" TIMESTAMP,
                "ModifiedBy" BIGINT,
                "ModifiedDt" TIMESTAMP,
                "SAPMchn_Code" VARCHAR(50),
                "Plant_Code" VARCHAR(5),
                "Vendor" VARCHAR(50),
                "Material" VARCHAR(500),
                "Details" TEXT,
                "Created_Empcode" TEXT,
                "Created_Empname" TEXT,
                "Closure_Empcode" TEXT,
                "Closure_Empname" TEXT,
                "M_Status" VARCHAR(1),
                "Del_Status" VARCHAR(1) DEFAULT 'N'
            );
        """)
        
        sql_query = """
            SELECT ID, Shop_Code, Module_Code, Line_Code, Machine_Code, Type_Code, LineReason_Code, OEEReason_Code, 
                   Entry_Date, Close_Date, Status, Start_status, Shift_code, servicetype, Reason, Breakdowntype, 
                   Notification_No, Function_Location, SAP_Status, SAP_Remarks, ShortClose_Status, SAP_FileName_Notification, 
                   SAP_FileName_Status, Start_slno, Stop_SlNo, closedstatus, Closure, Spares, Phenomena, Loto, 
                   Created_By, CreatedDt, ModifiedBy, ModifiedDt, SAPMchn_Code, Plant_Code, Vendor, Material, 
                   Details, Created_Empcode, Created_Empname, Closure_Empcode, Closure_Empname, M_Status
            FROM Trn_LineStoppage;
        """
        sql_cursor.execute(sql_query)
        
        insert_query = """
            INSERT INTO "Trn_LineStoppage" (
                "Id", "Shop_Code", "Module_Code", "Line_Code", "Machine_Code", "Type_Code", "LineReason_Code", "OEEReason_Code",
                "Start_Time", "End_Time", "Status", "Start_status", "Shift_code", "servicetype", "Reason", "Breakdowntype",
                "Notification_No", "Function_Location", "SAP_Status", "SAP_Remarks", "ShortClose_Status", "SAP_FileName_Notification",
                "SAP_FileName_Status", "Start_slno", "Stop_SlNo", "closedstatus", "Closure", "Spares", "Phenomena", "Loto",
                "Created_By", "CreatedDt", "ModifiedBy", "ModifiedDt", "SAPMchn_Code", "Plant_Code", "Vendor", "Material",
                "Details", "Created_Empcode", "Created_Empname", "Closure_Empcode", "Closure_Empname", "M_Status", "Del_Status"
            ) VALUES %s;
        """
        
        batch_size = 10000
        total_migrated = 0
        while True:
            rows = sql_cursor.fetchmany(batch_size)
            if not rows:
                break
            
            data = []
            for r in rows:
                data.append((
                    r[0], to_int(r[1]), to_int(r[2]), to_int(r[3]), r[4], r[5], r[6], r[7], r[8], r[9],
                    r[10], r[11], r[12], r[13], r[14], r[15], r[16], r[17], r[18], r[19], r[20], r[21],
                    r[22], r[23], r[24], r[25], r[26], r[27], r[28], r[29], r[30], r[31], r[32], r[33],
                    r[34], r[35], r[36], r[37], r[38], r[39], r[40], r[41], r[42], r[43], 'N'
                ))
            
            execute_values(pg_cursor, insert_query, data)
            total_migrated += len(data)
            print(f"Migrated {total_migrated} rows of Trn_LineStoppage...")

        # Reset sequence val for Trn_LineStoppage ID serial key
        pg_cursor.execute("SELECT setval(pg_get_serial_sequence('\"Trn_LineStoppage\"', 'Id'), COALESCE(max(\"Id\"), 1)) FROM \"Trn_LineStoppage\";")
        print("Sequence val for 'Trn_LineStoppage' reset successfully.")

        pg_conn.commit()
        print("Migration completed successfully and changes committed!")

    except Exception as e:
        pg_conn.rollback()
        print("Migration failed with error:", e)
        raise e
    finally:
        sql_cursor.close()
        sql_conn.close()
        pg_cursor.close()
        pg_conn.close()

if __name__ == "__main__":
    migrate()
