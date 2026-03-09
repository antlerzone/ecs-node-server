/**
 * 为 client 创建 TTLock 子账号并写入 client_integration。
 * 规则：username 用 client 的 subdomain（小写、唯一），默认密码可配置；若已有 ttlock_username 则跳过。
 * 若尚无 client_integration 行（key=smartDoor, provider=ttlock），会先自动插入一行再注册并写入。
 */

const crypto = require('crypto');
const pool = require('../../../config/db');
const { registerUser } = require('./ttlockRegister');

const DEFAULT_PASSWORD = '0123456789';

async function getClientSubdomain(clientId) {
  const [profileRows] = await pool.query(
    'SELECT subdomain FROM client_profile WHERE client_id = ? AND subdomain IS NOT NULL AND TRIM(subdomain) != "" LIMIT 1',
    [clientId]
  );
  if (profileRows.length > 0) return String(profileRows[0].subdomain).trim().toLowerCase();
  const [clientRows] = await pool.query(
    'SELECT subdomain FROM clientdetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (clientRows.length > 0 && clientRows[0].subdomain) {
    return String(clientRows[0].subdomain).trim().toLowerCase();
  }
  return null;
}

async function getTTLockIntegration(clientId) {
  const [rows] = await pool.query(
    `SELECT id, values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'smartDoor' AND provider = 'ttlock' LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return null;
  const v = rows[0].values_json;
  const values = typeof v === 'string' ? JSON.parse(v || '{}') : (v || {});
  return { integrationId: rows[0].id, values };
}

async function updateTTLockIntegration(clientId, valuesMerge) {
  const cur = await getTTLockIntegration(clientId);
  if (!cur) throw new Error('TTLOCK_INTEGRATION_ROW_MISSING');
  const next = { ...cur.values, ...valuesMerge };
  await pool.query(
    'UPDATE client_integration SET values_json = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(next), cur.integrationId]
  );
}

/** 若无 smartDoor/ttlock 行则插入一条，便于后续 ensureTTLockSubuser 写入账号。 */
async function ensureTTLockIntegrationRow(clientId) {
  const cur = await getTTLockIntegration(clientId);
  if (cur) return;
  const id = crypto.randomUUID();
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  await pool.query(
    `INSERT INTO client_integration (id, client_id, \`key\`, version, slot, enabled, provider, values_json, created_at, updated_at)
     VALUES (?, ?, 'smartDoor', 1, 0, 1, 'ttlock', '{}', ?, ?)`,
    [id, clientId, now, now]
  );
}

/**
 * 若 client 尚无 ttlock_username，则用 subdomain（若平台被占则 subdomain1, subdomain2, ...）注册 TTLock 用户并写入 client_integration。
 * 一个 client 只能 create 一次，断开后不可再 create。
 * 平台可能对登入名加应用前缀（如 fcfci_democoliving），以 register 响应中的 username/Username 为准并存入 ttlock_username。
 */
async function ensureTTLockSubuser(clientId, defaultPassword = DEFAULT_PASSWORD) {
  const subdomainBase = await getClientSubdomain(clientId);
  if (!subdomainBase) throw new Error('CLIENT_SUBDOMAIN_REQUIRED');

  await ensureTTLockIntegrationRow(clientId);
  const cur = await getTTLockIntegration(clientId);
  if (!cur) throw new Error('TTLOCK_INTEGRATION_ROW_MISSING');
  if (cur.values.ttlock_username) {
    return { username: cur.values.ttlock_username, created: false };
  }
  if (cur.values.ttlock_subuser_ever_created) {
    throw new Error('CLIENT_ALREADY_USED_CREATE_ONCE');
  }

  let username = subdomainBase;
  let res;
  for (let suffix = 0; suffix <= 99; suffix++) {
    const tryName = suffix === 0 ? subdomainBase : `${subdomainBase}${suffix}`;
    res = await registerUser({ username: tryName, password: defaultPassword });
    if (res.errcode === undefined || res.errcode === 0) {
      username = (res.username ?? res.Username ?? tryName).toString().trim() || tryName;
      break;
    }
    if (suffix === 99) throw new Error(`TTLOCK_REGISTER_FAILED_${res.errcode}_${res.errmsg || ''}`);
  }

  await updateTTLockIntegration(clientId, {
    ttlock_username: username,
    ttlock_password: defaultPassword,
    ttlock_subuser_ever_created: true
  });

  await pool.query(
    'UPDATE clientdetail SET ttlock_username = ?, ttlock_manual = 0, updated_at = NOW() WHERE id = ?',
    [username, clientId]
  );
  return { username, created: true };
}

module.exports = {
  DEFAULT_PASSWORD,
  getClientSubdomain,
  getTTLockIntegration,
  updateTTLockIntegration,
  ensureTTLockIntegrationRow,
  ensureTTLockSubuser
};
