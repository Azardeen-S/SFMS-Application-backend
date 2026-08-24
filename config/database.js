const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || '10.51.10.13',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'psqluser1',
  password: process.env.DB_PASSWORD || 'Krscd2$',
  database: process.env.DB_NAME || 'SFMS',
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
