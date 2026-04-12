/**
 * 確保某個 email 在 staffdetail 有對應的 staff，且 status=1、client_id 指向有效 client，以便 Company Setting 等門禁頁面可登入。
 * 若該 email 已有 client（如從 enquiry 註冊）則綁到該 client；否則綁到 demo client（需先 run seed-demo-account.js）。
 *
 * Usage: node scripts/ensure-staff-for-email.js "email" [clientId]
 *        (用引號包住 email，不要打 <email>，否則 bash 會當成輸入重定向而報錯)
 * Example: node scripts/ensure-staff-for-email.js "democoliving@gmail.com"
 *          node scripts/ensure-staff-for-email.js "democoliving@gmail.com" a0000001-0001-4000-8000-000000000001
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');
const { randomUUID } = require('crypto');

const DEMO_CLIENT_ID = 'a0000001-0001-4000-8000-000000000001';

async function main() {
  const email = process.argv[2] && process.argv[2].trim().toLowerCase();
  if (!email) {
    console.error('Usage: node scripts/ensure-staff-for-email.js <email> [clientId]');
    process.exit(1);
  }
  let clientId = process.argv[3] && process.argv[3].trim();

  const [staffRows] = await pool.query(
    'SELECT id, email, status, client_id, permission_json FROM staffdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [email]
  );

  if (!clientId) {
    const [clientByEmail] = await pool.query(
      'SELECT id, status FROM operatordetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [email]
    );
    if (clientByEmail.length) {
      clientId = clientByEmail[0].id;
      if (clientByEmail[0].status !== 1 && clientByEmail[0].status !== true) {
        await pool.query('UPDATE operatordetail SET status = 1, updated_at = NOW() WHERE id = ?', [clientId]);
        console.log('Client', clientId, 'was inactive; set status=1.');
      }
    } else {
      const [demoClient] = await pool.query('SELECT id FROM operatordetail WHERE id = ? LIMIT 1', [DEMO_CLIENT_ID]);
      if (!demoClient.length) {
        console.error('No client for email and demo client not found. Run seed-demo-account.js first or pass clientId.');
        process.exit(1);
      }
      clientId = DEMO_CLIENT_ID;
      console.log('Using demo client', clientId, 'for', email);
    }
  }

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const permissionJson = JSON.stringify(['admin']);

  if (staffRows.length) {
    const s = staffRows[0];
    const updates = [];
    const params = [];
    if (s.status !== 1 && s.status !== true) {
      updates.push('status = 1');
    }
    if (s.client_id !== clientId) {
      updates.push('client_id = ?');
      params.push(clientId);
    }
    if (updates.length) {
      params.push(s.id);
      await pool.query(`UPDATE staffdetail SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`, [...params, now, s.id]);
      console.log('Updated staff', s.id, 'for', email);
    } else {
      console.log('Staff already exists and is active for', email);
    }
  } else {
    const staffId = randomUUID();
    await pool.query(
      `INSERT INTO staffdetail (id, client_id, email, name, permission_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [staffId, clientId, email, (email.split('@')[0] || 'User').replace(/\./g, ' '), permissionJson, now, now]
    );
    console.log('Inserted staff', staffId, 'for', email, '-> client', clientId);
  }

  const [ctx] = await pool.query(
    'SELECT s.id, s.email, s.status, s.client_id, c.title, c.status AS client_status FROM staffdetail s JOIN operatordetail c ON c.id = s.client_id WHERE LOWER(TRIM(s.email)) = ? LIMIT 1',
    [email]
  );
  if (ctx.length) {
    console.log('OK. Staff:', ctx[0].id, '| Client:', ctx[0].title, '(' + ctx[0].client_id + ')', '| status:', ctx[0].status, '/', ctx[0].client_status);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
