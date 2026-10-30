require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const dbName = process.env.DB_NAME || 'contextflow_platform';
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error('DB_NAME may contain only letters, numbers and underscores.');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  });

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await connection.query(`USE \`${dbName}\``);
    const rootDir = path.resolve(__dirname, '../../database');
    const schema = fs.readFileSync(path.join(rootDir, 'schema.sql'), 'utf8');
    const seed = fs.readFileSync(path.join(rootDir, 'seed.sql'), 'utf8');
    await connection.query(schema);
    await connection.query(seed);
    await connection.query(fs.readFileSync(path.join(rootDir, 'knowledge_transfer.sql'), 'utf8'));
    await connection.query(fs.readFileSync(path.join(rootDir, 'seed_transfer.sql'), 'utf8'));
    console.log(`Database '${dbName}' is ready. Schema and demo data were applied.`);
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error('Database setup failed:', error.message);
  process.exitCode = 1;
});
