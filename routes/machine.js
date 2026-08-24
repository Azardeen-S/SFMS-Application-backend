const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');

// GET all machines (including inactive for master table toggle)
router.get('/', authMiddleware, async (req, res) => {
  try {
    let { rows } = await db.query(`
      SELECT 
        mc."Mchn_code" AS mchn_code,
        mc."Mchn_Name" AS mchn_name,
        mc."SAPMchn_Code" AS sap_mchn_code,
        mc."SAPMchn_Code" AS asset_no,
        mc."Plant_code" AS plant_code,
        mc."Shop_code" AS shop_code,
        mc."Module_Code" AS module_code,
        mc."Line_code" AS line_code,
        mc."Group_code" AS group_id,
        mc."SubGroup_Code" AS subgroup_id,
        mc."Cat_id" AS category_id,
        mc."outputperhr" AS output_per_hr,
        mc."Del_Status" AS del_status,
        (CASE WHEN mc."Is_RM_Input"::text = '1' OR mc."Is_RM_Input"::text ILIKE 'true' OR mc."Is_RM_Input"::text ILIKE 'y' THEN true ELSE false END) AS is_rml_input,
        (CASE WHEN mc."Utility"::text = '1' OR mc."Utility"::text ILIKE 'true' OR mc."Utility"::text ILIKE 'y' THEN true ELSE false END) AS utility,
        (CASE WHEN mc."criticalmchn"::text = '1' OR mc."criticalmchn"::text ILIKE 'true' OR mc."criticalmchn"::text ILIKE 'y' THEN true ELSE false END) AS critical_machine,
        p.plant_name,
        s."Shop_Name" AS shop_name,
        m."Module_Name" AS module_name,
        l."Line_Name" AS line_name
      FROM "Mst_Machine" mc
      LEFT JOIN "plant" p ON mc."Plant_code" = p.plant_code
      LEFT JOIN "Mst_Shop" s ON CAST(mc."Shop_code" AS VARCHAR) = CAST(s."Shop_code" AS VARCHAR) AND mc."Plant_code" = s."Plant_Code"
      LEFT JOIN "Mst_Module" m ON CAST(mc."Module_Code" AS VARCHAR) = CAST(m."Module_Code" AS VARCHAR) AND mc."Plant_code" = m."Plant_code"
      LEFT JOIN "Mst_Line" l ON CAST(mc."Line_code" AS VARCHAR) = CAST(l."Line_code" AS VARCHAR) AND mc."Plant_code" = l."Plant_code"
      ORDER BY mc."Mchn_Name" ASC
    `);
    const userPlantCode = req.user?.plantCode || req.user?.plant_code;
    const userPlantName = req.user?.plantName || req.user?.plant_name;
    if (userPlantCode && userPlantCode !== 'all' && userPlantCode !== '*' && userPlantCode !== 'ADMIN') {
      rows = rows.filter(r => {
        const pCodeMatch = !r.plant_code || String(r.plant_code) === String(userPlantCode);
        const pNameMatch = !userPlantName || !r.plant_name || String(r.plant_name).toLowerCase() === String(userPlantName).toLowerCase();
        return pCodeMatch && pNameMatch;
      });
    }
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching machines:', error);
    res.status(500).json({ message: 'Error retrieving machine data.' });
  }
});

// POST create machine
router.post('/', authMiddleware, async (req, res) => {
  let { mchn_code, mchn_name, asset_no, sap_mchn_code, plant_code, shop_code, module_code, line_code } = req.body;
  const sapCode = sap_mchn_code !== undefined ? sap_mchn_code : asset_no;
  if (!mchn_name || !plant_code) {
    return res.status(400).json({ message: 'Machine name and plant code are required.' });
  }
  try {
    if (!mchn_code) {
      const maxRes = await db.query(`
        SELECT COALESCE(MAX(CAST(NULLIF(REGEXP_REPLACE("Mchn_code", '[^0-9]', '', 'g'), '') AS INTEGER)), 0) + 1 AS next_num
        FROM "Mst_Machine"
      `);
      const nextNum = maxRes.rows[0].next_num;
      mchn_code = `M${String(nextNum).padStart(3, '0')}`;
    }

    const check = await db.query('SELECT * FROM sp_get_machine_by_code($1)', [mchn_code]);
    if (check.rows.length > 0) {
      if (check.rows[0].del_status === 'Y') {
        await db.query('SELECT sp_reactivate_machine($1, $2, $3, $4, $5, $6, $7)', [
          mchn_code, mchn_name, sapCode, plant_code, shop_code || null, module_code || null, line_code || null
        ]);
        return res.status(200).json({ message: 'Machine reactivated successfully.' });
      }
      return res.status(400).json({ message: 'Machine code already exists.' });
    }

    await db.query('SELECT sp_create_machine($1, $2, $3, $4, $5, $6, $7)', [
      mchn_code, mchn_name, sapCode, plant_code, shop_code || null, module_code || null, line_code || null
    ]);
    res.status(201).json({ message: 'Machine asset created successfully.' });
  } catch (error) {
    console.error('Error creating machine:', error);
    res.status(500).json({ message: 'Database error saving machine.' });
  }
});

// PUT update machine
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { mchn_name, asset_no, sap_mchn_code, plant_code, shop_code, module_code, line_code, del_status } = req.body;
  try {
    if (del_status !== undefined) {
      await db.query('UPDATE "Mst_Machine" SET "Del_Status" = $1 WHERE TRIM("Mchn_code"::text) = TRIM($2::text)', [del_status, id]);
      return res.status(200).json({ message: 'Machine status updated successfully.' });
    }
    const sapCode = sap_mchn_code !== undefined ? sap_mchn_code : asset_no;
    await db.query('SELECT sp_update_machine($1, $2, $3, $4, $5, $6, $7)', [
      id, mchn_name, sapCode, plant_code, shop_code || null, module_code || null, line_code || null
    ]);
    res.status(200).json({ message: 'Machine updated successfully.' });
  } catch (error) {
    console.error('Error updating machine:', error);
    res.status(500).json({ message: 'Database error updating machine.' });
  }
});

// DELETE soft delete machine
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const del = await db.query('SELECT sp_delete_machine($1)', [id]);
    if (del.rowCount === 0) return res.status(404).json({ message: 'Machine not found.' });
    res.status(200).json({ message: 'Machine removed successfully.' });
  } catch (error) {
    console.error('Error deleting machine:', error);
    res.status(500).json({ message: 'Database error deleting machine.' });
  }
});

// GET OEE Mapping data by plantcode and shopcode
router.get('/oee-mapping', authMiddleware, async (req, res) => {
  const { plantcode, shopcode } = req.query;
  try {
    const sql = `
      SELECT 
        m."Id",
        mod."Module_Name",
        l."Line_Name",
        m."Mchn_Name",
        m."SAPMchn_Code",
        grp."Groupname",
        c."Category_Name",
        m."outputperhr",
        (CASE WHEN m."criticalmchn"::text = '1' OR m."criticalmchn"::text ILIKE 'true' THEN true ELSE false END) AS criticalmchn,
        m."Mchn_code",
        m."Plant_code",
        m."Shop_code"
      FROM "Mst_Machine" m
      LEFT JOIN "Mst_Module" mod ON CAST(m."Module_Code" AS VARCHAR) = CAST(mod."Module_Code" AS VARCHAR) AND m."Plant_code" = mod."Plant_code"
      LEFT JOIN "Mst_Line" l ON CAST(m."Line_code" AS VARCHAR) = CAST(l."Line_code" AS VARCHAR) AND m."Plant_code" = l."Plant_code"
      LEFT JOIN "mst_group" grp ON CAST(m."Group_code" AS VARCHAR) = CAST(grp."ID" AS VARCHAR) AND m."Plant_code" = grp."Plant_Code"
      LEFT JOIN "Mst_Category" c ON m."Cat_id" = c."Category_ID" AND m."Plant_code" = c."Plant_Code"
      WHERE m."Del_Status" = 'N'
        AND ($1::text IS NULL OR $1::text = '' OR m."Plant_code"::text = $1::text)
        AND ($2::text IS NULL OR $2::text = '' OR m."Shop_code"::text = $2::text)
      ORDER BY mod."Module_Name", l."Line_Name", m."Mchn_Name"
    `;
    const { rows } = await db.query(sql, [plantcode || null, shopcode || null]);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching OEE mapping data:', error);
    res.status(500).json({ message: 'Error retrieving OEE mapping data.' });
  }
});

// GET Category list for plant
router.get('/categories', authMiddleware, async (req, res) => {
  const { plantcode } = req.query;
  try {
    const sql = `
      SELECT "Category_ID", "Category_Name"
      FROM "Mst_Category"
      WHERE "Del_Status" = 'N'
        AND ($1::text IS NULL OR $1::text = '' OR "Plant_Code"::text = $1::text)
      ORDER BY "Category_Name"
    `;
    const { rows } = await db.query(sql, [plantcode || null]);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Error retrieving categories.' });
  }
});

// POST Batch update OEE Mapping
router.post('/oee-mapping/save', authMiddleware, async (req, res) => {
  const { listvals } = req.body;
  try {
    if (Array.isArray(listvals)) {
      for (const item of listvals) {
        if (item.Id) {
          let catId = null;
          if (item.Cat_id) {
            catId = item.Cat_id;
          } else if (item.Category_Name) {
            const catRes = await db.query(
              'SELECT "Category_ID" FROM "Mst_Category" WHERE "Category_Name" = $1 LIMIT 1',
              [item.Category_Name]
            );
            if (catRes.rows.length > 0) catId = catRes.rows[0].Category_ID;
          }

          await db.query(`
            UPDATE "Mst_Machine"
            SET 
              "Cat_id" = COALESCE($1, "Cat_id"),
              "outputperhr" = COALESCE($2, "outputperhr"),
              "criticalmchn" = COALESCE($3, "criticalmchn"),
              "ModifiedDt" = NOW()
            WHERE "Id" = $4
          `, [catId, item.outputperhr || 0, item.criticalmchn ? true : false, item.Id]);
        }
      }
    }
    res.status(200).json({ message: 'Data Saved Successfully' });
  } catch (error) {
    console.error('Error saving OEE mapping:', error);
    res.status(500).json({ message: 'Error saving OEE mapping data.' });
  }
});

module.exports = router;
