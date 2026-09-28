const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const { isCrossCompanyRole } = require('../utils/companyScope');

// GET all modules (including inactive for master table toggle)
// Only a true cross-company role (Super Admin) sees every module across
// every company - everyone else, including a BU Admin at the primary company,
// is scoped to their own company's modules only.
// Optional ?shop_code=<code> filters to modules under that shop, for cascading
// Shop -> Module selects (e.g. on Functional Location creation).
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { shop_code } = req.query;
    const params = [];
    const conditions = [];
    if (!isCrossCompanyRole(req.user)) {
      params.push(req.user.companyCode);
      conditions.push(`p."Company_Id" = (SELECT "Company_Id" FROM "Mst_Company" WHERE "Company_Code" = $${params.length})`);
    }
    if (shop_code) {
      params.push(String(shop_code));
      conditions.push(`m."Shop_code"::text = $${params.length}`);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await db.query(`
      SELECT
        m."Module_Code" AS module_code,
        m."Module_Name" AS module_name,
        m."Plant_code" AS plant_code,
        m."Shop_code" AS shop_code,
        m."Del_Status" AS del_status,
        p.plant_name,
        s."Shop_Name" AS shop_name
      FROM "Mst_Module" m
      LEFT JOIN "plant" p ON m."Plant_code" = p.plant_code
      LEFT JOIN "Mst_Shop" s ON CAST(m."Shop_code" AS VARCHAR) = CAST(s."Shop_code" AS VARCHAR) AND m."Plant_code" = s."Plant_Code"
      ${whereClause}
      ORDER BY m."Module_Name" ASC
    `, params);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching modules:', error);
    res.status(500).json({ message: 'Error retrieving module data.' });
  }
});

// POST create module
router.post('/', authMiddleware, async (req, res) => {
  let { module_code, module_name, plant_code, shop_code } = req.body;
  if (!module_name || !plant_code) {
    return res.status(400).json({ message: 'Module name and plant code are required.' });
  }
  try {
    if (!module_code) {
      const maxRes = await db.query('SELECT COALESCE(MAX(CASE WHEN "Module_Code"::text ~ \'^[0-9]+$\' THEN "Module_Code" ELSE 0 END), 0) + 1 AS next_code FROM "Mst_Module"');
      module_code = String(maxRes.rows[0].next_code);
    }

    const check = await db.query('SELECT * FROM sp_get_module_by_code($1)', [module_code]);
    if (check.rows.length > 0) {
      if (check.rows[0].del_status === 'Y') {
        await db.query('SELECT sp_reactivate_module($1, $2, $3, $4)', [module_code, module_name, plant_code, shop_code]);
        return res.status(200).json({ message: 'Module reactivated successfully.' });
      }
      return res.status(400).json({ message: 'Module code already exists.' });
    }

    await db.query('SELECT sp_create_module($1, $2, $3, $4)', [module_code, module_name, plant_code, shop_code]);
    res.status(201).json({ message: 'Module created successfully.' });
  } catch (error) {
    console.error('Error creating module:', error);
    res.status(500).json({ message: 'Database error saving module.' });
  }
});

// PUT update module
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { module_name, plant_code, shop_code, del_status } = req.body;
  try {
    if (del_status !== undefined) {
      await db.query('UPDATE "Mst_Module" SET "Del_Status" = $1 WHERE TRIM("Module_Code"::text) = TRIM($2::text)', [del_status, id]);
      return res.status(200).json({ message: 'Module status updated successfully.' });
    }
    await db.query('UPDATE "Mst_Module" SET "Module_Name" = $1, "Plant_code" = $2, "Shop_code" = $3, "ModifiedDt" = NOW() WHERE TRIM("Module_Code"::text) = TRIM($4::text)', [module_name, plant_code, shop_code, id]);
    res.status(200).json({ message: 'Module updated successfully.' });
  } catch (error) {
    console.error('Error updating module:', error);
    res.status(500).json({ message: 'Database error updating module.' });
  }
});

// DELETE soft delete module
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const del = await db.query('SELECT sp_delete_module($1)', [id]);
    if (del.rowCount === 0) return res.status(404).json({ message: 'Module not found.' });
    res.status(200).json({ message: 'Module removed successfully.' });
  } catch (error) {
    console.error('Error deleting module:', error);
    res.status(500).json({ message: 'Database error deleting module.' });
  }
});

module.exports = router;
