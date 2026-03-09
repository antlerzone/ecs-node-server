/**
 * 从 JSON 文件读取 integration/profile/pricingplandetail/credit，同步到该 client 的 4 张子表。
 * 用法：node scripts/sync-client-subtables-from-json.js <clientWixId> <json文件路径>
 * 例：node scripts/sync-client-subtables-from-json.js 817f6510-47ac-4f8f-9828-d2fd91cb406f ./client-one.json
 *
 * JSON 格式：{ "integration": [], "profile": [], "pricingplandetail": [], "credit": [] }，键可选。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { syncAll } = require('../src/services/client-subtables');

const clientWixId = process.argv[2];
const jsonPath = process.argv[3];

if (!clientWixId || !jsonPath) {
  console.error('Usage: node scripts/sync-client-subtables-from-json.js <clientWixId> <json_path>');
  process.exit(1);
}

const fullPath = path.isAbsolute(jsonPath) ? jsonPath : path.join(process.cwd(), jsonPath);
if (!fs.existsSync(fullPath)) {
  console.error('File not found:', fullPath);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });
  try {
    const result = await syncAll(conn, {
      clientWixId,
      integration: Array.isArray(data.integration) ? data.integration : undefined,
      profile: Array.isArray(data.profile) ? data.profile : undefined,
      pricingplandetail: Array.isArray(data.pricingplandetail) ? data.pricingplandetail : undefined,
      credit: Array.isArray(data.credit) ? data.credit : undefined,
    });
    console.log('Synced subtables for client', result.clientId);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
