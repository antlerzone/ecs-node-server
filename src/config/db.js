const mysql = require('mysql2/promise');

/**
 * 连接池：统一用 UTC 写入/读取。
 * timezone: '+00:00' 使 MySQL 会话的 NOW()、CURRENT_TIMESTAMP 为 UTC，与 Node 侧 toISOString() 一致。
 * 客户在马来西亚/新加坡 (UTC+8)，展示日期/时间时在前端或 API 层按 Asia/Kuala_Lumpur 转换。
 */
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: '+00:00',
  /** Avoid JSON.stringify "Do not know how to serialize a BigInt" on API responses. */
  supportBigNumbers: true,
  bigNumberStrings: true,
});

module.exports = pool;