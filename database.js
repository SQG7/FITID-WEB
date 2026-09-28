require('./config');
const mysql = require('mysql2');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD ?? '1234',
  database: process.env.DB_NAME || 'fitid',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  charset: 'utf8mb4'
});

pool.getConnection((err, connection) => {
  if (err) {
    console.error('[FITID] MySQL indisponível:', err.message);
    return;
  }
  console.log('[FITID] MySQL conectado!');
  connection.release();
});

module.exports = pool;
