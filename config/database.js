const { Pool } = require('pg');
require('dotenv').config();

// Fail fast and loud if .env is missing/incomplete on this server, instead of
// silently falling back to a different DB user/password than intended
// (that used to happen here and made "moved to a new server -> login broken"
// look like a login bug instead of a missing/incomplete .env file).
const REQUIRED_DB_VARS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingVars = REQUIRED_DB_VARS.filter((key) => !process.env[key]);
if (missingVars.length) {
  console.error(
    `FATAL: Missing required DB env var(s): ${missingVars.join(', ')}.\n` +
    `Check that a .env file exists next to app.js on THIS server (it is git-ignored, ` +
    `so it must be created/copied manually on every new server) and defines them.`
  );
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
