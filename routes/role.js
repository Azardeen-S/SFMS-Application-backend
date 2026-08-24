const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET permissions for a specific role or all roles
router.get('/permissions', async (req, res) => {
  try {
    const { roleName } = req.query;
    if (roleName) {
      const { rows } = await db.query(
        'SELECT * FROM "mst_role_permissions" WHERE LOWER(TRIM("role_name")) = LOWER(TRIM($1)) LIMIT 1',
        [roleName]
      );
      if (rows.length > 0) {
        return res.status(200).json(rows[0]);
      }
      return res.status(200).json({ role_name: roleName, permissions: null });
    }

    const { rows } = await db.query('SELECT * FROM "mst_role_permissions" ORDER BY "role_name" ASC');
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching role permissions:', error);
    res.status(500).json({ message: 'Database error fetching role permissions.' });
  }
});

// POST save / upsert role permissions
router.post('/save', async (req, res) => {
  try {
    const { roleName, permissions } = req.body;
    if (!roleName) {
      return res.status(400).json({ message: 'Role Name is required.' });
    }

    const { rows } = await db.query(
      `INSERT INTO "mst_role_permissions" ("role_name", "permissions", "updated_at")
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT ("role_name") 
       DO UPDATE SET "permissions" = EXCLUDED."permissions", "updated_at" = CURRENT_TIMESTAMP
       RETURNING *`,
      [roleName, JSON.stringify(permissions || {})]
    );

    res.status(200).json({
      message: `Role permissions for ${roleName} saved successfully.`,
      data: rows[0]
    });
  } catch (error) {
    console.error('Error saving role permissions:', error);
    res.status(500).json({ message: 'Database error saving role permissions.' });
  }
});

module.exports = router;
