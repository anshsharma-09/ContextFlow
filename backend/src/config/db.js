
const mysql = require('mysql2/promise');
const fs = require('fs');

// Local development: read the CA certificate from a file.
// Vercel: read the CA certificate from an environment variable.
const sslCA = process.env.DB_SSL_CA_CONTENT ||
  (process.env.DB_SSL_CA && fs.existsSync(process.env.DB_SSL_CA)
    ? fs.readFileSync(process.env.DB_SSL_CA, 'utf8')
    : undefined);

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'contextflow_platform',

  ssl: {
    ca: sslCA,
    rejectUnauthorized: true
  },

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  timezone: 'Z'
});

async function testConnection() {
  const connection = await pool.getConnection();

  try {
    await connection.query('SELECT 1');
    return true;
  } finally {
    connection.release();
  }
}

module.exports = { pool, testConnection };
