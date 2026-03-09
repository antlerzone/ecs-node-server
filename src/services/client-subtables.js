/**
 * 把 client 的 integration / profile / pricingplandetail / credit 同步到 4 张子表。
 * 供 import 脚本和 API 共用。
 * syncSubtablesFromClientdetail: 从 clientdetail 表读这 4 列（JSON text）并同步到子表，插入/更新 clientdetail 后调用即可。
 */
const { randomUUID } = require('crypto');
const JSON5 = require('json5');

function parseJsonSafe(str) {
  if (str == null || String(str).trim() === '') return null;
  const s = String(str).trim();
  try {
    return JSON.parse(s);
  } catch (_) {
    try {
      return JSON5.parse(s);
    } catch (__) {
      return null;
    }
  }
}

function toArray(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v;
  if (typeof v === 'object' && v !== null) return [v];
  return null;
}

function toMysqlDatetime(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}T[\d.:]+Z?$/i.test(s))
    return s.replace('T', ' ').replace(/\.\d+Z?$/i, '').replace(/Z$/i, '');
  return s;
}

async function syncIntegration(conn, clientId, clientWixId, arr) {
  if (!Array.isArray(arr) || arr.length === 0) return;
  await conn.query('DELETE FROM client_integration WHERE client_id = ?', [clientId]);
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  for (const it of arr) {
    const id = randomUUID();
    const key = it.key || '';
    const version = it.version != null ? Number(it.version) : null;
    const slot = it.slot != null ? Number(it.slot) : null;
    const enabled = it.enabled === true || it.enabled === 1 ? 1 : 0;
    const provider = it.values && it.values.provider ? String(it.values.provider) : null;
    const valuesJson = it.values ? JSON.stringify(it.values) : null;
    const einvoice = it.einvoice === true || it.einvoice === 1 ? 1 : null;
    await conn.query(
      `INSERT INTO client_integration (id, client_id, client_wixid, \`key\`, version, slot, enabled, provider, values_json, einvoice, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, clientId, clientWixId, key, version, slot, enabled, provider, valuesJson, einvoice, now, now]
    );
  }
  console.log('[client-subtables] client_integration: inserted', arr.length, 'rows');
}

async function syncProfile(conn, clientId, clientWixId, arr, bankWixIdToId) {
  if (!Array.isArray(arr) || arr.length === 0) return;
  await conn.query('DELETE FROM client_profile WHERE client_id = ?', [clientId]);
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  for (const it of arr) {
    const id = randomUUID();
    const bankId = it.bankId ? (bankWixIdToId && bankWixIdToId.get(it.bankId)) || null : null;
    const subdomain = it.subdomain ? String(it.subdomain).trim().toLowerCase() : null;
    await conn.query(
      `INSERT INTO client_profile (id, client_id, client_wixid, tin, contact, subdomain, accountholder, ssm, currency, address, accountnumber, bank_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, clientId, clientWixId,
        it.tin || null, it.contact || null, subdomain,
        it.accountHolder || it.accountholder || null, it.ssm || null, it.currency || null,
        it.address || null, it.accountNumber || it.accountnumber || null, bankId,
        now, now
      ]
    );
  }
  console.log('[client-subtables] client_profile: inserted', arr.length, 'rows');
}

async function syncPricingplanDetail(conn, clientId, clientWixId, arr, planWixIdToId) {
  if (!Array.isArray(arr) || arr.length === 0) return;
  await conn.query('DELETE FROM client_pricingplan_detail WHERE client_id = ?', [clientId]);
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  for (const it of arr) {
    const id = randomUUID();
    const type = it.type || 'plan';
    const planWixId = it.planId || it.plan_id || '';
    const planId = (planWixIdToId && planWixIdToId.get(planWixId)) || planWixId;
    const title = it.title || null;
    const expired = toMysqlDatetime(it.expired);
    const qty = it.qty != null ? Number(it.qty) : null;
    await conn.query(
      `INSERT INTO client_pricingplan_detail (id, client_id, client_wixid, type, plan_id, title, expired, qty, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, clientId, clientWixId, type, planId, title, expired, qty, now, now]
    );
  }
  console.log('[client-subtables] client_pricingplan_detail: inserted', arr.length, 'rows');
}

async function syncCredit(conn, clientId, clientWixId, arr) {
  if (!Array.isArray(arr) || arr.length === 0) return;
  await conn.query('DELETE FROM client_credit WHERE client_id = ?', [clientId]);
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  for (const it of arr) {
    const id = randomUUID();
    const type = it.type || 'flex';
    const amount = Number(it.amount) || 0;
    await conn.query(
      `INSERT INTO client_credit (id, client_id, client_wixid, type, amount, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, clientId, clientWixId, type, amount, now, now]
    );
  }
  console.log('[client-subtables] client_credit: inserted', arr.length, 'rows');
}

/**
 * 同步 4 张子表。payload 为 { integration?, profile?, pricingplandetail?, credit? }，均为数组。
 * clientId + clientWixId 必填其一；若只传 clientWixId 会先查 clientdetail 取 clientId。
 */
async function syncAll(conn, payload) {
  const { clientId: rawClientId, clientWixId, integration, profile, pricingplandetail, credit } = payload;
  let clientId = rawClientId;
  if (!clientId && clientWixId) {
    const [rows] = await conn.query('SELECT id FROM clientdetail WHERE wix_id = ? LIMIT 1', [clientWixId]);
    if (!rows.length) throw new Error('client not found: ' + clientWixId);
    clientId = rows[0].id;
  }
  if (!clientId) throw new Error('clientId or clientWixId required');

  const [bankRows] = await conn.query('SELECT id, wix_id FROM bankdetail WHERE wix_id IS NOT NULL');
  const bankWixIdToId = new Map(bankRows.map(r => [r.wix_id, r.id]));
  const [planRows] = await conn.query('SELECT id, wix_id FROM pricingplan WHERE wix_id IS NOT NULL');
  const planWixIdToId = new Map(planRows.map(r => [r.wix_id, r.id]));

  console.log('[client-subtables] syncAll clientId=', clientId, 'integration=', integration?.length ?? 0, 'profile=', profile?.length ?? 0, 'pricingplandetail=', pricingplandetail?.length ?? 0, 'credit=', credit?.length ?? 0);
  if (Array.isArray(integration)) await syncIntegration(conn, clientId, clientWixId || null, integration);
  if (Array.isArray(profile)) await syncProfile(conn, clientId, clientWixId || null, profile, bankWixIdToId);
  if (Array.isArray(pricingplandetail)) await syncPricingplanDetail(conn, clientId, clientWixId || null, pricingplandetail, planWixIdToId);
  if (Array.isArray(credit)) await syncCredit(conn, clientId, clientWixId || null, credit);

  return { clientId, clientWixId: clientWixId || null };
}

/**
 * 从 clientdetail 表读取 integration / profile / pricingplandetail / credit 列（JSON text），解析后同步到 4 张子表。
 * 每次 insert/update clientdetail 后调用此方法即可自动写入 client_integration、client_profile、client_pricingplan_detail、client_credit。
 * @param {import('mysql2/promise').Connection} conn
 * @param {string} clientId - clientdetail.id
 * @returns {Promise<{ clientId, clientWixId } | null>} 若该 client 无记录则返回 null
 */
async function syncSubtablesFromClientdetail(conn, clientId) {
  const [rows] = await conn.query(
    'SELECT id, wix_id, integration, profile, pricingplandetail, credit FROM clientdetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  const integration = toArray(parseJsonSafe(r.integration));
  const profile = toArray(parseJsonSafe(r.profile));
  const pricingplandetail = toArray(parseJsonSafe(r.pricingplandetail));
  const credit = toArray(parseJsonSafe(r.credit));
  if (!integration && !profile && !pricingplandetail && !credit) return { clientId, clientWixId: r.wix_id || null };
  await syncAll(conn, {
    clientId: r.id,
    clientWixId: r.wix_id || null,
    integration: integration || undefined,
    profile: profile || undefined,
    pricingplandetail: pricingplandetail || undefined,
    credit: credit || undefined,
  });
  return { clientId: r.id, clientWixId: r.wix_id || null };
}

module.exports = { syncAll, syncSubtablesFromClientdetail, syncIntegration, syncProfile, syncPricingplanDetail, syncCredit };
