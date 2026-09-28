const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');

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

// GET all gap / stoppage reasons
router.get('/', authMiddleware, async (req, res) => {
  try {
    let { rows } = await db.query(`
      SELECT 
        g."Id" AS id,
        g."Gap_Name" AS gap_name,
        g."Plant_Code" AS plant_code,
        g."Del_Status" AS del_status,
        p.plant_name,
        STRING_AGG(DISTINCT t."Type_Desc", ', ') AS problem_types
      FROM "Mst_Gap" g
      LEFT JOIN "plant" p ON CAST(g."Plant_Code" AS VARCHAR) = CAST(p."plant_code" AS VARCHAR)
      LEFT JOIN "Mst_TypeReason_Mapping" m ON CAST(g."Id" AS VARCHAR) = CAST(m."Reason_Code" AS VARCHAR) AND CAST(g."Plant_Code" AS VARCHAR) = CAST(m."Plant_Code" AS VARCHAR)
      LEFT JOIN "Mst_Type" t ON CAST(m."Type_Code" AS VARCHAR) = CAST(t."Id" AS VARCHAR) AND CAST(m."Plant_Code" AS VARCHAR) = CAST(t."Plant_Code" AS VARCHAR)
      GROUP BY g."Id", g."Gap_Name", g."Plant_Code", g."Del_Status", p.plant_name
      ORDER BY g."Id" DESC
    `);

    const userPlantCode = req.user?.plantCode || req.user?.plant_code;
    const userPlantName = req.user?.plantName || req.user?.plant_name;
    if (userPlantCode && userPlantCode !== 'all' && userPlantCode !== 'Global' && userPlantCode !== '*' && userPlantCode !== 'ADMIN') {
      rows = rows.filter(r => isPlantMatch(r, userPlantCode, userPlantName));
    }

    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching gap reasons:', error);
    res.status(500).json({ message: 'Error retrieving stoppage reason data.' });
  }
});

// POST create gap reason
router.post('/', authMiddleware, async (req, res) => {
  const { gap_name, plant_code, problem_types } = req.body;
  if (!gap_name || !plant_code) {
    return res.status(400).json({ message: 'Gap name and plant code are required.' });
  }
  try {
    const maxRes = await db.query('SELECT COALESCE(MAX("Id"), 0) + 1 AS next_id FROM "Mst_Gap"');
    const newId = maxRes.rows[0].next_id;
    await db.query(`INSERT INTO "Mst_Gap" ("Id", "Gap_Name", "Plant_Code", "Del_Status") VALUES ($1, $2, $3, 'N')`, [newId, gap_name, plant_code]);

    if (problem_types) {
      const typesArr = Array.isArray(problem_types) ? problem_types : String(problem_types).split(',').map(s => s.trim());
      for (const pType of typesArr) {
        if (!pType) continue;
        const typeRes = await db.query('SELECT "Id" FROM "Mst_Type" WHERE LOWER("Type_Desc") = LOWER($1) AND CAST("Plant_Code" AS VARCHAR) = $2 LIMIT 1', [pType, plant_code]);
        if (typeRes.rows.length > 0) {
          const typeId = typeRes.rows[0].Id;
          const mapMax = await db.query('SELECT COALESCE(MAX("Id"), 0) + 1 AS next_id FROM "Mst_TypeReason_Mapping"');
          await db.query(`INSERT INTO "Mst_TypeReason_Mapping" ("Id", "Type_Code", "Reason_Code", "Plant_Code") VALUES ($1, $2, $3, $4)`, [mapMax.rows[0].next_id, typeId, newId, plant_code]);
        }
      }
    }

    res.status(201).json({ message: 'Stoppage reason created successfully.' });
  } catch (error) {
    console.error('Error creating gap reason:', error);
    res.status(500).json({ message: 'Database error saving stoppage reason.' });
  }
});

// PUT update gap reason
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { gap_name, plant_code, del_status, Del_Status, problem_types } = req.body;
  const statusVal = del_status || Del_Status;

  try {
    if (statusVal !== undefined) {
      await db.query('UPDATE "Mst_Gap" SET "Del_Status" = $1 WHERE CAST("Id" AS VARCHAR) = CAST($2 AS VARCHAR)', [statusVal, id]);
      return res.status(200).json({ message: 'Stoppage reason status updated successfully.' });
    }
    if (gap_name && plant_code) {
      await db.query('UPDATE "Mst_Gap" SET "Gap_Name" = $1, "Plant_Code" = $2 WHERE CAST("Id" AS VARCHAR) = CAST($3 AS VARCHAR)', [gap_name, plant_code, id]);
    }

    // Problem Types were only ever written on create (POST below) - editing
    // an existing reason and checking/unchecking types silently did nothing,
    // which is why older/edited rows show "-" for Problem Type. Rebuild the
    // Mst_TypeReason_Mapping rows for this reason from whatever is checked
    // now, same one-row-per-type approach the create path uses.
    if (problem_types !== undefined && plant_code) {
      await db.query(
        'DELETE FROM "Mst_TypeReason_Mapping" WHERE CAST("Reason_Code" AS VARCHAR) = CAST($1 AS VARCHAR) AND CAST("Plant_Code" AS VARCHAR) = CAST($2 AS VARCHAR)',
        [id, plant_code]
      );
      const typesArr = Array.isArray(problem_types) ? problem_types : String(problem_types).split(',').map(s => s.trim()).filter(Boolean);
      for (const pType of typesArr) {
        const typeRes = await db.query('SELECT "Id" FROM "Mst_Type" WHERE LOWER("Type_Desc") = LOWER($1) AND CAST("Plant_Code" AS VARCHAR) = $2 LIMIT 1', [pType, plant_code]);
        if (typeRes.rows.length > 0) {
          const typeId = typeRes.rows[0].Id;
          const mapMax = await db.query('SELECT COALESCE(MAX("Id"), 0) + 1 AS next_id FROM "Mst_TypeReason_Mapping"');
          await db.query(`INSERT INTO "Mst_TypeReason_Mapping" ("Id", "Type_Code", "Reason_Code", "Plant_Code") VALUES ($1, $2, $3, $4)`, [mapMax.rows[0].next_id, typeId, id, plant_code]);
        }
      }
    }

    res.status(200).json({ message: 'Stoppage reason updated successfully.' });
  } catch (error) {
    console.error('Error updating gap reason:', error);
    res.status(500).json({ message: 'Database error updating stoppage reason.' });
  }
});

// DELETE soft delete gap reason
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const del = await db.query('SELECT sp_delete_gap($1)', [id]);
    if (del.rowCount === 0) return res.status(404).json({ message: 'Stoppage reason not found.' });
    res.status(200).json({ message: 'Stoppage reason removed successfully.' });
  } catch (error) {
    console.error('Error deleting gap reason:', error);
    res.status(500).json({ message: 'Database error deleting stoppage reason.' });
  }
});

module.exports = router;
