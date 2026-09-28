// The original/primary company (Rane Madras Limited, short name RML-SLD) predates
// multi-tenancy - its employees have company_code = NULL or '1000' in Mst_Employee.
// Those users keep seeing everything (no regression for existing data), while a
// user belonging to any other (newly onboarded) company is scoped to that company.
const MASTER_COMPANY_CODE = process.env.MASTER_COMPANY_CODE || '1000';

// Super Admin is a cross-tenant role: regardless of which company/plant the
// employee record itself belongs to, this role always gets full, unscoped
// access to every company and every plant - same as a master-company user.
// (Role names were swapped: this was "BU Admin" before - see 01_migration.sql's
// "Swap Super Admin and BU Admin role identities" section.)
const CROSS_COMPANY_ROLES = ['super admin'];

function isCrossCompanyRole(reqUser) {
  const role = String(reqUser?.role || reqUser?.empGroup || '').trim().toLowerCase();
  return CROSS_COMPANY_ROLES.includes(role);
}

function isMasterCompanyUser(reqUser) {
  const companyCode = reqUser?.companyCode;
  return !companyCode || String(companyCode) === MASTER_COMPANY_CODE || isCrossCompanyRole(reqUser);
}

// A "BU Admin" (as opposed to Plant Admin) is scoped to their own single
// Plant_Code on their employee record - e.g. the auto-provisioned company
// admin created in routes/company.js gets that company's default HQ plant,
// not a sentinel like "Global". Every plant-filtering GET in this codebase
// only recognizes the sentinel values ('all'/'Global'/'*'/'ADMIN'), so this
// role was being treated exactly like a single-plant Plant Admin everywhere
// - a company-scoped full admin saw only their one default plant's data, not
// their whole company's, unless it happened to also be the cross-company
// Super Admin role. (Role names were swapped: this checked "super admin"
// before - see 01_migration.sql's role-swap section.)
function isCompanyScopedFullAdmin(reqUser) {
  const role = String(reqUser?.role || reqUser?.empGroup || '').trim().toLowerCase();
  return role === 'bu admin' || Number(reqUser?.isAdmin) === 1;
}

// Every plant code belonging to a company, for scoping a company-scoped full
// admin's GET queries to "any plant in my company" instead of their own
// single Plant_Code. Returns a lowercase-trimmed Set for cheap membership
// checks against row plant codes of unknown casing.
async function getCompanyPlantCodes(db, companyCode) {
  const { rows } = await db.query(
    `SELECT plant_code FROM plant WHERE "Company_Id" = (SELECT "Company_Id" FROM "Mst_Company" WHERE "Company_Code" = $1)`,
    [companyCode]
  );
  return new Set(rows.map((r) => String(r.plant_code).trim().toLowerCase()));
}

module.exports = { MASTER_COMPANY_CODE, isMasterCompanyUser, isCrossCompanyRole, isCompanyScopedFullAdmin, getCompanyPlantCodes };
