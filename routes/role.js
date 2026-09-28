const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');

// GET the screens the logged-in user's role is allowed to see, for the
// dynamic Sidebar menu - Mst_Role -> Mst_Access -> Mst_Screen, all three
// Active_Status = 1. The role never comes from the frontend - it's resolved
// server-side from this employee's own row via the verified JWT's empNo,
// never trusted from the request.
//
// Deliberately NOT joined via Mst_Employee.Role_ID: that column is only ever
// set once (by 01_migration.sql's backfill), and nothing keeps it in sync
// when an employee's role changes afterward (e.g. via Employee Master, which
// only updates emp_group) - a stale Role_ID then silently shows/hides the
// wrong screens. Instead, this resolves the employee's CURRENT effective
// role name the exact same way routes/auth.js's login does (emp_group if
// it's set, otherwise is_admin decides BU Admin vs Plant Admin), and looks
// that name up in Mst_Role fresh on every request - always correct, and
// works for any custom role created via Role Master too.
router.get('/my-screens', authMiddleware, async (req, res) => {
  const empNo = req.user?.empNo;
  if (!empNo) {
    return res.status(200).json([]);
  }
  try {
    const { rows } = await db.query(
      `SELECT DISTINCT s."Screen_Code", s."Screen_Name", s."Screen_Type"
       FROM "Mst_Employee" e
       JOIN "Mst_Role" r ON LOWER(TRIM(r."Role_Name")) = LOWER(TRIM(
         COALESCE(NULLIF(TRIM(e."emp_group"), ''), CASE WHEN COALESCE(e."is_admin", 0) = 1 THEN 'BU Admin' ELSE 'Plant Admin' END)
       )) AND r."Active_Status" = 1
       JOIN "Mst_Access" a ON a."Role_ID" = r."Role_ID" AND a."Active_Status" = 1
       JOIN "Mst_Screen" s ON s."Screen_ID" = a."Screen_ID" AND s."Active_Status" = 1
       WHERE TRIM(e."Emp_No") = TRIM($1)`,
      [empNo]
    );
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching my-screens:', error);
    res.status(500).json({ message: 'Error retrieving screen access.' });
  }
});

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

// ─── Role/Screen/Access management (Mst_Role, Mst_Screen, Mst_Access) ─────
// Backs the "Role Access Management Master" screen's new Sidebar-access
// toggles - separate from mst_role_permissions above, which still manages
// its own view/create/edit action grid unchanged.

// GET all roles, for the role selector
router.get('/roles', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT "Role_ID", "Role_Name", "Active_Status" FROM "Mst_Role" ORDER BY "Role_Name" ASC');
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ message: 'Database error fetching roles.' });
  }
});

// POST create a new role (Mst_Role) - name must be unique (case-insensitive)
router.post('/roles', authMiddleware, async (req, res) => {
  const { roleName } = req.body;
  const name = String(roleName || '').trim();
  if (!name) {
    return res.status(400).json({ message: 'Role name is required.' });
  }
  try {
    const dupe = await db.query('SELECT "Role_ID" FROM "Mst_Role" WHERE LOWER(TRIM("Role_Name")) = LOWER($1)', [name]);
    if (dupe.rows.length > 0) {
      return res.status(400).json({ message: `Role "${name}" already exists.` });
    }
    const maxRes = await db.query('SELECT COALESCE(MAX("Role_ID"), 0) + 1 AS next_id FROM "Mst_Role"');
    const nextId = maxRes.rows[0].next_id;
    await db.query('INSERT INTO "Mst_Role" ("Role_ID", "Role_Name", "Active_Status") VALUES ($1, $2, 1)', [nextId, name]);
    res.status(201).json({ message: `Role "${name}" created successfully.`, roleId: nextId });
  } catch (error) {
    console.error('Error creating role:', error);
    res.status(500).json({ message: 'Database error creating role.' });
  }
});

// PUT toggle a role's Active_Status - an inactive role's Mst_Access rows are
// ignored everywhere else (my-screens' join requires Mst_Role.Active_Status
// = 1), so this is enough to fully disable a role without deleting it.
router.put('/roles/:roleId', authMiddleware, async (req, res) => {
  const { roleId } = req.params;
  const { activeStatus } = req.body;
  if (activeStatus === undefined) {
    return res.status(400).json({ message: 'activeStatus is required.' });
  }
  try {
    await db.query('UPDATE "Mst_Role" SET "Active_Status" = $1 WHERE "Role_ID" = $2', [activeStatus ? 1 : 0, roleId]);
    res.status(200).json({ message: 'Role status updated successfully.' });
  } catch (error) {
    console.error('Error updating role status:', error);
    res.status(500).json({ message: 'Database error updating role status.' });
  }
});

// GET all screens, for the access matrix rows
router.get('/screens', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT "Screen_ID", "Screen_Code", "Screen_Name", "Screen_Type", "Active_Status" FROM "Mst_Screen" ORDER BY "Screen_Type" ASC, "Screen_Name" ASC');
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching screens:', error);
    res.status(500).json({ message: 'Database error fetching screens.' });
  }
});

// GET which screens are currently active for a given role
router.get('/access', authMiddleware, async (req, res) => {
  const { roleId } = req.query;
  if (!roleId) {
    return res.status(400).json({ message: 'roleId is required.' });
  }
  try {
    const { rows } = await db.query(
      `SELECT s."Screen_Code"
       FROM "Mst_Access" a
       JOIN "Mst_Screen" s ON s."Screen_ID" = a."Screen_ID"
       WHERE a."Role_ID" = $1 AND a."Active_Status" = 1`,
      [roleId]
    );
    res.status(200).json(rows.map((r) => r.Screen_Code));
  } catch (error) {
    console.error('Error fetching role access:', error);
    res.status(500).json({ message: 'Database error fetching role access.' });
  }
});

// POST save which screens are active for a role - upserts per (Role_ID,
// Screen_ID) so re-saving never creates duplicate Mst_Access rows, and every
// screen not in screenCodes is explicitly turned off (not left stale).
router.post('/access/save', authMiddleware, async (req, res) => {
  const { roleId, screenCodes } = req.body;
  if (!roleId) {
    return res.status(400).json({ message: 'roleId is required.' });
  }
  try {
    const selected = new Set(Array.isArray(screenCodes) ? screenCodes : []);
    const screens = await db.query('SELECT "Screen_ID", "Screen_Code" FROM "Mst_Screen"');

    for (const screen of screens.rows) {
      const activeStatus = selected.has(screen.Screen_Code) ? 1 : 0;
      const existing = await db.query(
        'SELECT "Access_ID" FROM "Mst_Access" WHERE "Role_ID" = $1 AND "Screen_ID" = $2',
        [roleId, screen.Screen_ID]
      );
      if (existing.rows.length > 0) {
        await db.query('UPDATE "Mst_Access" SET "Active_Status" = $1 WHERE "Access_ID" = $2', [activeStatus, existing.rows[0].Access_ID]);
      } else {
        const maxRes = await db.query('SELECT COALESCE(MAX("Access_ID"), 0) + 1 AS next_id FROM "Mst_Access"');
        await db.query(
          'INSERT INTO "Mst_Access" ("Access_ID", "Role_ID", "Screen_ID", "Active_Status") VALUES ($1, $2, $3, $4)',
          [maxRes.rows[0].next_id, roleId, screen.Screen_ID, activeStatus]
        );
      }
    }

    res.status(200).json({ message: 'Role screen access updated successfully.' });
  } catch (error) {
    console.error('Error saving role access:', error);
    res.status(500).json({ message: 'Database error saving role access.' });
  }
});

module.exports = router;
