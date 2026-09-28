const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const { isCrossCompanyRole, isCompanyScopedFullAdmin, getCompanyPlantCodes } = require('../utils/companyScope');

function isPlantMatch(row, userPlantCode, userPlantName) {
  if (!userPlantCode || userPlantCode === 'all' || userPlantCode === 'Global' || userPlantCode === '*' || userPlantCode === 'ADMIN') {
    return true;
  }
  const rowCode = String(row.plant_code || row.Plant_Code || '').trim();
  const rowName = String(row.plant_name || row.Plant_Name || '').trim();

  const userCode = String(userPlantCode || '').trim();
  const userName = String(userPlantName || '').trim().toLowerCase();

  if (!rowCode && !rowName) return true;
  if (rowCode && rowCode === userCode) return true;
  if (rowName && userName && rowName.toLowerCase() === userName) return true;

  return false;
}

// GET all problem types
router.get('/', authMiddleware, async (req, res) => {
  const { activeOnly, plant_code: requestedPlantCode } = req.query;
  try {
    let whereClause = '';
    if (activeOnly === 'true' || activeOnly === '1') {
      whereClause = `WHERE t."Del_Status" = 'N'`;
    }
    let { rows } = await db.query(`
      SELECT
        t."Id" AS id,
        t."Type_Desc" AS type_desc,
        t."Plant_Code" AS plant_code,
        t."Del_Status" AS del_status,
        p.plant_name
      FROM "Mst_Type" t
      LEFT JOIN "plant" p ON CAST(t."Plant_Code" AS VARCHAR) = CAST(p."plant_code" AS VARCHAR)
      ${whereClause}
      ORDER BY t."Id" DESC
    `);

    // Only a true cross-company role (Super Admin) can see/request any
    // plant's Problem Types. Everyone else - including a BU Admin at the
    // primary/master company - is bounded to their own company's plants,
    // even if a specific ?plant_code= is requested. Without this, a caller
    // could request another company's plant_code directly (e.g. a Line
    // Stoppage Reason Mapping Plant dropdown scoped correctly, but this
    // endpoint trusting the query param blindly) and see that other
    // company's Problem Types.
    if (!isCrossCompanyRole(req.user)) {
      let allowedPlantCodes = null; // null = restricted to exactly their own plant
      if (isCompanyScopedFullAdmin(req.user) && req.user?.companyCode) {
        allowedPlantCodes = await getCompanyPlantCodes(db, req.user.companyCode);
      }

      if (requestedPlantCode) {
        const requested = String(requestedPlantCode).trim().toLowerCase();
        const ownPlant = String(req.user?.plantCode || req.user?.plant_code || '').trim().toLowerCase();
        const isAllowed = allowedPlantCodes ? allowedPlantCodes.has(requested) : requested === ownPlant;
        rows = isAllowed ? rows.filter(r => isPlantMatch(r, requestedPlantCode, '')) : [];
      } else if (allowedPlantCodes) {
        rows = rows.filter(r => allowedPlantCodes.has(String(r.plant_code || '').trim().toLowerCase()));
      } else {
        const userPlantCode = req.user?.plantCode || req.user?.plant_code;
        const userPlantName = req.user?.plantName || req.user?.plant_name;
        rows = rows.filter(r => isPlantMatch(r, userPlantCode, userPlantName));
      }
    } else if (requestedPlantCode) {
      rows = rows.filter(r => isPlantMatch(r, requestedPlantCode, ''));
    }
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching types:', error);
    res.status(500).json({ message: 'Error retrieving problem type data.' });
  }
});

// POST create type
router.post('/', authMiddleware, async (req, res) => {
  const { type_desc, plant_code } = req.body;
  if (!type_desc || !plant_code) {
    return res.status(400).json({ message: 'Type description and plant code are required.' });
  }
  try {
    const maxRes = await db.query('SELECT COALESCE(MAX("Id"), 0) + 1 AS next_id FROM "Mst_Type"');
    const newId = maxRes.rows[0].next_id;
    await db.query(`INSERT INTO "Mst_Type" ("Id", "Type_Desc", "Plant_Code", "Del_Status") VALUES ($1, $2, $3, 'N')`, [newId, type_desc, plant_code]);
    res.status(201).json({ message: 'Problem type created successfully.' });
  } catch (error) {
    console.error('Error creating type:', error);
    res.status(500).json({ message: 'Database error saving problem type.' });
  }
});

// PUT update type
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { type_desc, plant_code, del_status, Del_Status } = req.body;
  const statusVal = del_status || Del_Status;

  try {
    if (statusVal !== undefined) {
      await db.query('UPDATE "Mst_Type" SET "Del_Status" = $1 WHERE CAST("Id" AS VARCHAR) = CAST($2 AS VARCHAR)', [statusVal, id]);
      return res.status(200).json({ message: 'Problem type status updated successfully.' });
    }
    if (type_desc && plant_code) {
      await db.query('UPDATE "Mst_Type" SET "Type_Desc" = $1, "Plant_Code" = $2 WHERE CAST("Id" AS VARCHAR) = CAST($3 AS VARCHAR)', [type_desc, plant_code, id]);
    }
    res.status(200).json({ message: 'Problem type updated successfully.' });
  } catch (error) {
    console.error('Error updating type:', error);
    res.status(500).json({ message: 'Database error updating problem type.' });
  }
});

// DELETE soft delete type
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const del = await db.query('SELECT sp_delete_type($1)', [id]);
    if (del.rowCount === 0) return res.status(404).json({ message: 'Problem type not found.' });
    res.status(200).json({ message: 'Problem type removed successfully.' });
  } catch (error) {
    console.error('Error deleting type:', error);
    res.status(500).json({ message: 'Database error deleting problem type.' });
  }
});

module.exports = router;
