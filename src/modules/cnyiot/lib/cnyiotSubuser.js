/**
 * Client 的 CNYIoT 子账号（租客）创建与 client_integration 读写。
 * 规则：subdomain 取自 client_profile（或 operatordetail），统一小写、不可与其它 client 重复；
 * 默认密码 0123456789；记录存 client_integration values_json。
 */

const pool = require('../../../config/db');
const userWrapper = require('../wrappers/user.wrapper');

const DEFAULT_SUBUSER_PASSWORD = '0123456789';

/**
 * 取 client 的 subdomain（小写）。优先 client_profile，否则 operatordetail。
 */
async function getClientSubdomain(clientId) {
  const [profileRows] = await pool.query(
    'SELECT subdomain FROM client_profile WHERE client_id = ? AND subdomain IS NOT NULL AND TRIM(subdomain) != "" LIMIT 1',
    [clientId]
  );
  if (profileRows.length > 0) return String(profileRows[0].subdomain).trim().toLowerCase();
  const [clientRows] = await pool.query(
    'SELECT subdomain FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (clientRows.length > 0 && clientRows[0].subdomain) {
    return String(clientRows[0].subdomain).trim().toLowerCase();
  }
  return null;
}

/**
 * 检查 subdomain 是否已被其它 client 使用（client_profile 表，小写比较）。
 */
async function isSubdomainTaken(subdomain, excludeClientId = null) {
  const lower = String(subdomain).trim().toLowerCase();
  let sql = 'SELECT 1 FROM client_profile WHERE LOWER(TRIM(subdomain)) = ? LIMIT 1';
  const params = [lower];
  if (excludeClientId) {
    sql = 'SELECT 1 FROM client_profile WHERE LOWER(TRIM(subdomain)) = ? AND client_id != ? LIMIT 1';
    params.push(excludeClientId);
  }
  const [rows] = await pool.query(sql, params);
  return rows.length > 0;
}

/**
 * 从 client_integration 读取 cnyiot 的 values_json，含 subuser 字段（仅 enabled=1）。
 */
async function getCnyiotIntegration(clientId) {
  const [rows] = await pool.query(
    `SELECT id, values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'meter' AND provider = 'cnyiot' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return null;
  const v = rows[0].values_json;
  const values = typeof v === 'string' ? JSON.parse(v) : v;
  return { integrationId: rows[0].id, values: values || {} };
}

/**
 * 取 client 的 meter/cnyiot integration 行（不限 enabled），用于检查 cnyiot_subuser_ever_created。
 */
async function getCnyiotIntegrationAny(clientId) {
  const [rows] = await pool.query(
    `SELECT id, values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'meter' AND provider = 'cnyiot' LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return null;
  const v = rows[0].values_json;
  const values = typeof v === 'string' ? JSON.parse(v || '{}') : (v || {});
  return { integrationId: rows[0].id, values };
}

/**
 * 更新 client_integration 的 values_json，合并 subuser 相关字段。
 */
async function updateCnyiotSubuserInIntegration(clientId, fields) {
  const cur = await getCnyiotIntegration(clientId);
  if (!cur) throw new Error('CNYIOT_NOT_CONFIGURED');
  const next = { ...cur.values, ...fields };
  await pool.query(
    'UPDATE client_integration SET values_json = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(next), cur.integrationId]
  );
}

/**
 * 取当前 client 的 cnyiot_subuser_id（Station_index）。先读 client_integration，无则回退 operatordetail。
 */
async function getCnyiotSubuserId(clientId) {
  const cur = await getCnyiotIntegration(clientId);
  const fromIntegration = cur?.values?.cnyiot_subuser_id;
  if (fromIntegration != null && fromIntegration !== '') return fromIntegration;
  const [rows] = await pool.query(
    'SELECT cnyiot_subuser_id FROM operatordetail WHERE id = ? AND cnyiot_subuser_id IS NOT NULL AND TRIM(cnyiot_subuser_id) != "" LIMIT 1',
    [clientId]
  );
  if (rows.length > 0 && rows[0].cnyiot_subuser_id) return rows[0].cnyiot_subuser_id;
  return null;
}

/**
 * 为 client 确保存在一个 CNYIoT 租客（子账号）：uI=subdomain（若平台被占则 subdomain1, subdomain2, ...），默认密码存 client_integration。
 * 若已存在 cnyiot_subuser_id 则直接返回。
 * opts.tel：创建时传给 addUser 的电话号码（接口必填）；未传则用 CNYIOT_SUBUSER_DEFAULT_TEL 或 '0'。
 */
async function ensureClientCnyiotSubuser(clientId, opts = {}) {
  const t0 = Date.now();
  console.log('[ensureClientCnyiotSubuser] start clientId=%s', clientId);
  const subdomainBase = await getClientSubdomain(clientId);
  console.log('[ensureClientCnyiotSubuser] getClientSubdomain=%s ms=%s', subdomainBase, Date.now() - t0);
  if (!subdomainBase) throw new Error('CLIENT_SUBDOMAIN_REQUIRED');

  const taken = await isSubdomainTaken(subdomainBase, clientId);
  if (taken) throw new Error('SUBDOMAIN_ALREADY_USED');

  const anyRow = await getCnyiotIntegrationAny(clientId);
  if (anyRow?.values?.cnyiot_subuser_ever_created) {
    throw new Error('CLIENT_ALREADY_USED_CREATE_ONCE');
  }

  const cur = await getCnyiotIntegration(clientId);
  if (!cur) throw new Error('CNYIOT_NOT_CONFIGURED');
  if (cur.values.cnyiot_subuser_id) {
    console.log('[ensureClientCnyiotSubuser] already has cnyiot_subuser_id=%s', cur.values.cnyiot_subuser_id);
    return { subdomain: cur.values.cnyiot_subuser_login || subdomainBase, cnyiot_subuser_id: cur.values.cnyiot_subuser_id };
  }

  const telStr = (opts.tel != null && String(opts.tel).trim() !== '') ? String(opts.tel).trim() : (process.env.CNYIOT_SUBUSER_DEFAULT_TEL || '0');
  let loginName = subdomainBase;
  let addRes;
  for (let suffix = 0; suffix <= 99; suffix++) {
    const tryName = suffix === 0 ? subdomainBase : `${subdomainBase}${suffix}`;
    const addT0 = Date.now();
    console.log('[ensureClientCnyiotSubuser] addUser tryName=%s suffix=%s tel=%s', tryName, suffix, telStr ? '***' : '');
    addRes = await userWrapper.addUser(clientId, { uN: tryName, uI: tryName, tel: telStr });
    console.log('[ensureClientCnyiotSubuser] addUser done tryName=%s result=%s value=%j ms=%s', tryName, addRes && addRes.result, addRes && addRes.value, Date.now() - addT0);
    if (addRes.result === 200 || addRes.result === 0) {
      loginName = tryName;
      break;
    }
    if (addRes.result === 4127 && suffix === 0) {
      throw new Error('CNYIOT_ADD_USER_FAILED_4127');
    }
    if (suffix === 99) throw new Error(`CNYIOT_ADD_USER_FAILED_${addRes.result}`);
  }

  const getUsersT0 = Date.now();
  console.log('[ensureClientCnyiotSubuser] getUsers start');
  const listRes = await userWrapper.getUsers(clientId);
  const list = listRes?.value || [];
  console.log('[ensureClientCnyiotSubuser] getUsers done list.length=%s ms=%s', list.length, Date.now() - getUsersT0);
  const loginLower = loginName.toLowerCase();
  let user = list.find(u => String(u.adminID || u.adminid || '').trim().toLowerCase() === loginLower);
  if (!user) {
    user = list.find(u => {
      const aid = String(u.adminID || u.adminid || '').trim().toLowerCase();
      return aid.endsWith('_' + loginLower) || aid.endsWith(loginLower);
    });
  }
  if (!user) throw new Error('CNYIOT_SUBUSER_NOT_FOUND_AFTER_ADD');
  const stationIndex = user.Station_index ?? user.station_index;
  // 平台可能对登入名加母账号前缀（如 fcfci_democoliving），存实际 adminID 以便登录与展示一致
  const actualLoginName = String(user.adminID || user.adminid || loginName).trim() || loginName;
  console.log('[ensureClientCnyiotSubuser] actualLoginName=%s stationIndex=%s DURATION_MS=%s', actualLoginName, stationIndex, Date.now() - t0);

  // addUser 若在 value 中返回密码则使用，否则用本机默认并尝试 editLogin（平台可能 5003 不支持）
  const v = addRes?.value && typeof addRes.value === 'object' ? addRes.value : {};
  const passwordFromApi = v.password ?? v.psw ?? v.pwd ?? v.defaultPassword ?? v.initialPassword;
  const passwordToStore = (typeof passwordFromApi === 'string' && passwordFromApi) ? passwordFromApi : DEFAULT_SUBUSER_PASSWORD;
  if (!passwordFromApi) {
    try {
      const editLoginRes = await userWrapper.editLogin(clientId, { uI: String(stationIndex), ps: passwordToStore });
      console.log('[ensureClientCnyiotSubuser] editLogin result=%s', editLoginRes?.result);
    } catch (e) {
      console.warn('[ensureClientCnyiotSubuser] editLogin failed (platform may not support uI/ps)', e.message);
    }
  }

  await updateCnyiotSubuserInIntegration(clientId, {
    cnyiot_subuser_login: actualLoginName,
    cnyiot_subuser_password: passwordToStore,
    cnyiot_subuser_id: stationIndex,
    station_index: stationIndex,
    cnyiot_subuser_ever_created: true
  });

  await pool.query(
    'UPDATE operatordetail SET cnyiot_subuser_id = ?, cnyiot_subuser_login = ?, cnyiot_subuser_manual = 0, updated_at = NOW() WHERE id = ?',
    [String(stationIndex), actualLoginName, clientId]
  );

  return { subdomain: actualLoginName, cnyiot_subuser_id: stationIndex };
}

/**
 * 修改子账号密码：调用 rstPsw（房东重置租客密码）后，将新密码写入 client_integration。
 * 注意：官方 API rstPsw 可能只重置为系统默认，若支持传新密码再改。此处仅更新本地存储。
 */
async function saveSubuserPassword(clientId, newPassword) {
  await updateCnyiotSubuserInIntegration(clientId, {
    cnyiot_subuser_password: newPassword
  });
}

module.exports = {
  DEFAULT_SUBUSER_PASSWORD,
  getClientSubdomain,
  isSubdomainTaken,
  getCnyiotIntegration,
  getCnyiotIntegrationAny,
  updateCnyiotSubuserInIntegration,
  getCnyiotSubuserId,
  ensureClientCnyiotSubuser,
  saveSubuserPassword
};
