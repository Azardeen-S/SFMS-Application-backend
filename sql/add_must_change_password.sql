-- Adds the flag used to force a password change on first login for
-- auto-provisioned Super Admin accounts (see routes/company.js POST /).
ALTER TABLE "Mst_Employee"
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
