/**
 * Deduction – migrated from Wix backend/billing/deduction.jsw.
 * Uses MySQL: operatordetail (credit, pricingplandetail), creditlogs. No Payex.
 */

const pool = require('../../config/db');
const { randomUUID } = require('crypto');
const { isRetiredPricingPlanAddon } = require('../../utils/pricingPlanAddonCatalog');
const { getAccessContextByEmail } = require('../access/access.service');
const { syncSubtablesFromOperatordetail } = require('../../services/client-subtables');

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

/** Legacy rows may use mixed-case `type`; match core/flex consistently. */
function creditTypeLower(c) {
  return String(c?.type || '').trim().toLowerCase();
}
function isFlexType(c) {
  return creditTypeLower(c) === 'flex';
}
function isCoreType(c) {
  return creditTypeLower(c) === 'core';
}

/**
 * Credits that deductClientCreditSpending can actually consume: expiring core buckets first, then flex.
 * Core rows without `expired` are skipped (same rule as the deduction loop) — they are not spendable here.
 */
function getSpendableCreditTotal(creditList) {
  if (!Array.isArray(creditList)) return 0;
  let coreSum = 0;
  for (const x of creditList) {
    if (isCoreType(x) && Number(x.amount) > 0 && x.expired) coreSum += Number(x.amount);
  }
  const flex = creditList.find((x) => isFlexType(x));
  const flexAmt = Math.max(0, Number(flex?.amount) || 0);
  return coreSum + flexAmt;
}

/** After filter, never persist [] — empty JSON breaks syncCredit + leaves stale client_credit. */
function ensureCreditBucketsNonEmpty(newCredit) {
  if (Array.isArray(newCredit) && newCredit.length > 0) return newCredit;
  return [{ type: 'flex', amount: 0, updatedAt: new Date() }];
}

function mergePricingPlanQty(existing = [], selected = {}) {
  const result = [];
  const addonMap = {};
  existing.forEach((item) => {
    if (item.type === 'plan') {
      result.push(item);
      return;
    }
    if (item.type === 'addon') {
      addonMap[item.planId] = { type: 'addon', planId: item.planId, qty: Number(item.qty) || 0 };
    }
  });
  Object.entries(selected).forEach(([planId, qty]) => {
    addonMap[planId] = { type: 'addon', planId, qty: Number(qty) || 0 };
  });
  return result.concat(Object.values(addonMap));
}

/**
 * Deduct addon credit (staff flow or system). Updates operatordetail.credit & pricingplandetail, inserts creditlogs.
 */
async function deductAddonCredit(emailOrSystem, { amount, title, addons, system = false }) {
  let clientId;
  let staffId = null;

  if (system === true) {
    if (!addons || !amount) throw new Error('SYSTEM_INVALID_PAYLOAD');
    if (!addons.__clientId) throw new Error('SYSTEM_MISSING_CLIENT_ID');
    clientId = addons.__clientId;
  } else {
    const ctx = await getAccessContextByEmail(emailOrSystem);
    if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
    clientId = ctx.client?.id;
    staffId = ctx.staffDetailId != null ? ctx.staffDetailId : null;
    if (!clientId) throw new Error('NO_CLIENT_ID');
  }

  if (!amount || amount <= 0) throw new Error('INVALID_AMOUNT');

  const [clientRows] = await pool.query(
    'SELECT id, status, credit, pricingplandetail FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length || clientRows[0].status !== 1 && clientRows[0].status !== true) throw new Error('CLIENT_INVALID');
  const client = clientRows[0];

  const cleanAddons = { ...addons };
  delete cleanAddons.__clientId;
  const addonIds = Object.keys(cleanAddons).filter((k) => k && String(k).trim() !== '');
  if (addonIds.length > 0) {
    const [addonTitleRows] = await pool.query(
      'SELECT id, title FROM pricingplanaddon WHERE id IN (?)',
      [addonIds]
    );
    for (const row of addonTitleRows) {
      if (isRetiredPricingPlanAddon(row.title)) throw new Error('ADDON_NOT_AVAILABLE');
    }
  }
  const rawPpd = parseJson(client.pricingplandetail);
  const existingPpd = Array.isArray(rawPpd) ? rawPpd : [];
  const newPricingPlanDetail = mergePricingPlanQty(existingPpd, cleanAddons);

  const rawCredit = parseJson(client.credit);
  const creditList = Array.isArray(rawCredit) ? rawCredit.map((c) => ({ ...c })) : [];
  let need = Number(amount);
  let coreUsed = 0;
  let flexUsed = 0;

  const coreCredits = creditList
    .filter((c) => isCoreType(c) && Number(c.amount) > 0 && c.expired)
    .sort((a, b) => new Date(a.expired).getTime() - new Date(b.expired).getTime());
  for (const c of coreCredits) {
    if (need <= 0) break;
    const used = Math.min(Number(c.amount), need);
    c.amount -= used;
    need -= used;
    coreUsed += used;
  }

  let flex = creditList.find((c) => isFlexType(c));
  if (!flex) {
    flex = { type: 'flex', amount: 0 };
    creditList.push(flex);
  }
  if (need > 0) {
    flex.amount = Number(flex.amount) || 0;
    flex.amount -= need;
    flexUsed += need;
    need = 0;
  }

  const newCredit = ensureCreditBucketsNonEmpty(
    creditList
      .filter((c) => Number(c.amount) > 0 || isFlexType(c))
      .map((c) => ({ ...c, amount: Number(c.amount), updatedAt: new Date() }))
  );

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const logId = randomUUID();
  const refNum = `SP-${logId}`;
  const payloadStr = JSON.stringify({ coreUsed, flexUsed, addons: cleanAddons });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      'UPDATE operatordetail SET credit = ?, pricingplandetail = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(newCredit), JSON.stringify(newPricingPlanDetail), now, clientId]
    );
    await syncSubtablesFromOperatordetail(conn, clientId);
    await conn.query(
      `INSERT INTO creditlogs (id, title, type, amount, client_id, staff_id, reference_number, payload, created_at, updated_at)
       VALUES (?, ?, 'Spending', ?, ?, ?, ?, ?, ?, ?)`,
      [logId, title || 'Addon Prorate', -Math.abs(Number(amount)), clientId, staffId, refNum, payloadStr, now, now]
    );
    await conn.commit();
    console.log('[creditlogs] INSERT Spending', { id: logId, client_id: clientId, amount: -Math.abs(Number(amount)), reference_number: refNum });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const { clearBillingCacheByClientId } = require('./billing.service');
  clearBillingCacheByClientId(clientId);

  return {
    success: true,
    deducted: Number(amount),
    coreUsed,
    flexUsed,
    credit: newCredit,
    pricingplandetail: newPricingPlanDetail
  };
}

/**
 * Deduct pricing plan addon credit (by clientId; used after plan change). Updates operatordetail.credit, inserts creditlogs.
 */
async function deductPricingPlanAddonCredit({ clientId, amount, title, addons, staffId }) {
  if (!clientId) throw new Error('MISSING_CLIENT_ID');
  if (!amount || amount <= 0) throw new Error('INVALID_AMOUNT');

  const [clientRows] = await pool.query(
    'SELECT id, status, credit FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length || clientRows[0].status !== 1 && clientRows[0].status !== true) throw new Error('CLIENT_INVALID');
  const client = clientRows[0];

  const rawCredit = parseJson(client.credit);
  const creditList = Array.isArray(rawCredit) ? rawCredit.map((c) => ({ ...c })) : [];
  let need = Number(amount);
  let coreUsed = 0;
  let flexUsed = 0;

  const coreCredits = creditList
    .filter((c) => isCoreType(c) && Number(c.amount) > 0 && c.expired)
    .sort((a, b) => new Date(a.expired).getTime() - new Date(b.expired).getTime());
  for (const c of coreCredits) {
    if (need <= 0) break;
    const used = Math.min(Number(c.amount), need);
    c.amount -= used;
    need -= used;
    coreUsed += used;
  }
  let flex = creditList.find((c) => isFlexType(c));
  if (!flex) {
    flex = { type: 'flex', amount: 0 };
    creditList.push(flex);
  }
  if (need > 0) {
    flex.amount = Number(flex.amount) || 0;
    flex.amount -= need;
    flexUsed += need;
  }

  const newCredit = ensureCreditBucketsNonEmpty(
    creditList
      .filter((c) => Number(c.amount) > 0 || isFlexType(c))
      .map((c) => ({ ...c, amount: Number(c.amount), updatedAt: new Date() }))
  );

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await pool.query('UPDATE operatordetail SET credit = ?, updated_at = ? WHERE id = ?', [JSON.stringify(newCredit), now, clientId]);

  const conn = await pool.getConnection();
  try {
    await syncSubtablesFromOperatordetail(conn, clientId);
  } finally {
    conn.release();
  }

  const logId = randomUUID();
  const refNum = `SP-${logId}`;
  const payloadStr = JSON.stringify({ source: 'pricingplan', coreUsed, flexUsed });
  await pool.query(
    `INSERT INTO creditlogs (id, title, type, amount, client_id, staff_id, reference_number, payload, created_at, updated_at)
     VALUES (?, ?, 'Spending', ?, ?, ?, ?, ?, ?, ?)`,
    [logId, title || 'Addon Prorate', -Math.abs(Number(amount)), clientId, staffId || null, refNum, payloadStr, now, now]
  );
  console.log('[creditlogs] INSERT Spending (pricing plan)', { id: logId, client_id: clientId, amount: -Math.abs(Number(amount)), reference_number: refNum });

  const { clearBillingCacheByClientId } = require('./billing.service');
  clearBillingCacheByClientId(clientId);

  return {
    success: true,
    deducted: Number(amount),
    coreUsed,
    flexUsed,
    credit: newCredit
  };
}

/** Title prefix for monthly active-room deduction; used for idempotency. */
const ACTIVE_ROOM_MONTHLY_TITLE_PREFIX = 'Active room monthly';

/**
 * Deduct credit for monthly active-room fee (10 credits per active room). Used by cron on the 1st of each month.
 * 计费房间数 = Room Setting 里该 client 下的房间总数，不管是否启用(active)。
 * Does not update pricingplandetail. Idempotent per client per year-month (caller should skip if already deducted).
 *
 * @param {{ clientId: string, activeRoomCount: number, yearMonth: string, description?: string }} opts - yearMonth e.g. '2025-03'; description written to creditlogs.remark (e.g. "room quantity total: N\nRoom A x1\nRoom B x1")
 * @returns {{ success: boolean, deducted: number, coreUsed: number, flexUsed: number, credit: object[] }}
 */
async function deductMonthlyActiveRoomCredit({ clientId, activeRoomCount, yearMonth, description }) {
  if (!clientId) throw new Error('MISSING_CLIENT_ID');
  const count = Number(activeRoomCount) || 0;
  if (count <= 0) return { success: true, deducted: 0, coreUsed: 0, flexUsed: 0, credit: [] };
  const amount = 10 * count;

  const [clientRows] = await pool.query(
    'SELECT id, status, credit FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length || (clientRows[0].status !== 1 && clientRows[0].status !== true)) throw new Error('CLIENT_INVALID');
  const client = clientRows[0];

  const rawCredit = parseJson(client.credit);
  const creditList = Array.isArray(rawCredit) ? rawCredit.map((c) => ({ ...c })) : [];
  let need = amount;
  let coreUsed = 0;
  let flexUsed = 0;

  const coreCredits = creditList
    .filter((c) => isCoreType(c) && Number(c.amount) > 0 && c.expired)
    .sort((a, b) => new Date(a.expired).getTime() - new Date(b.expired).getTime());
  for (const c of coreCredits) {
    if (need <= 0) break;
    const used = Math.min(Number(c.amount), need);
    c.amount -= used;
    need -= used;
    coreUsed += used;
  }
  let flex = creditList.find((c) => isFlexType(c));
  if (!flex) {
    flex = { type: 'flex', amount: 0 };
    creditList.push(flex);
  }
  if (need > 0) {
    flex.amount = Number(flex.amount) || 0;
    flex.amount -= need;
    flexUsed += need;
  }

  const newCredit = ensureCreditBucketsNonEmpty(
    creditList
      .filter((c) => Number(c.amount) > 0 || isFlexType(c))
      .map((c) => ({ ...c, amount: Number(c.amount), updatedAt: new Date() }))
  );

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const title = `${ACTIVE_ROOM_MONTHLY_TITLE_PREFIX} (${yearMonth})`;
  const logId = randomUUID();
  const refNum = `SP-${logId}`;
  const payloadStr = JSON.stringify({ source: 'active_room_monthly', yearMonth, activeRoomCount: count, coreUsed, flexUsed });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      'UPDATE operatordetail SET credit = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(newCredit), now, clientId]
    );
    await syncSubtablesFromOperatordetail(conn, clientId);
    await conn.query(
      `INSERT INTO creditlogs (id, title, type, amount, client_id, staff_id, reference_number, payload, remark, created_at, updated_at)
       VALUES (?, ?, 'Spending', ?, ?, NULL, ?, ?, ?, ?, ?)`,
      [logId, title, -amount, clientId, refNum, payloadStr, description || null, now, now]
    );
    await conn.commit();
    console.log('[creditlogs] INSERT Spending (active room monthly)', { id: logId, client_id: clientId, amount: -amount, yearMonth, activeRoomCount: count });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const { clearBillingCacheByClientId } = require('./billing.service');
  clearBillingCacheByClientId(clientId);

  return {
    success: true,
    deducted: amount,
    coreUsed,
    flexUsed,
    credit: newCredit
  };
}

/**
 * Deduct credit (Spending); does not change pricingplandetail.
 * When `conn` is provided, uses that connection (caller must hold transaction + FOR UPDATE if needed).
 * When `conn` is null, runs in its own transaction.
 */
async function deductClientCreditSpending(clientId, amount, title, staffId, payloadObj, conn = null) {
  if (!clientId) throw new Error('MISSING_CLIENT_ID');
  if (!amount || amount <= 0) throw new Error('INVALID_AMOUNT');

  const run = async (c) => {
    const [clientRows] = await c.query(
      'SELECT id, status, credit FROM operatordetail WHERE id = ? FOR UPDATE',
      [clientId]
    );
    if (!clientRows.length || (clientRows[0].status !== 1 && clientRows[0].status !== true)) {
      throw new Error('CLIENT_INVALID');
    }
    const client = clientRows[0];
    const rawCredit = parseJson(client.credit);
    const creditList = Array.isArray(rawCredit) ? rawCredit.map((x) => ({ ...x })) : [];
    let need = Number(amount);
    let coreUsed = 0;
    let flexUsed = 0;

    const spendable = getSpendableCreditTotal(creditList);
    if (need > spendable) {
      throw new Error('INSUFFICIENT_CREDIT');
    }

    const coreCredits = creditList
      .filter((x) => isCoreType(x) && Number(x.amount) > 0 && x.expired)
      .sort((a, b) => new Date(a.expired).getTime() - new Date(b.expired).getTime());
    for (const x of coreCredits) {
      if (need <= 0) break;
      const used = Math.min(Number(x.amount), need);
      x.amount -= used;
      need -= used;
      coreUsed += used;
    }
    let flex = creditList.find((x) => isFlexType(x));
    if (!flex) {
      flex = { type: 'flex', amount: 0 };
      creditList.push(flex);
    }
    if (need > 0) {
      flex.amount = Number(flex.amount) || 0;
      flex.amount -= need;
      flexUsed += need;
    }

    const newCredit = ensureCreditBucketsNonEmpty(
      creditList
        .filter((x) => Number(x.amount) > 0 || isFlexType(x))
        .map((x) => ({ ...x, amount: Number(x.amount), updatedAt: new Date() }))
    );

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await c.query('UPDATE operatordetail SET credit = ?, updated_at = ? WHERE id = ?', [
      JSON.stringify(newCredit),
      now,
      clientId
    ]);
    await syncSubtablesFromOperatordetail(c, clientId);

    const logId = randomUUID();
    const refNum = `SP-${logId}`;
    const payloadStr = JSON.stringify(
      payloadObj && typeof payloadObj === 'object'
        ? { ...payloadObj, coreUsed, flexUsed }
        : { coreUsed, flexUsed }
    );
    await c.query(
      `INSERT INTO creditlogs (id, title, type, amount, client_id, staff_id, reference_number, payload, created_at, updated_at)
       VALUES (?, ?, 'Spending', ?, ?, ?, ?, ?, ?, ?)`,
      [
        logId,
        title || 'Official template',
        -Math.abs(Number(amount)),
        clientId,
        staffId || null,
        refNum,
        payloadStr,
        now,
        now
      ]
    );
    return { coreUsed, flexUsed, newCredit };
  };

  if (conn) {
    return run(conn);
  }
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const out = await run(c);
    await c.commit();
    const { clearBillingCacheByClientId } = require('./billing.service');
    clearBillingCacheByClientId(clientId);
    return out;
  } catch (err) {
    await c.rollback();
    throw err;
  } finally {
    c.release();
  }
}

module.exports = {
  deductAddonCredit,
  deductPricingPlanAddonCredit,
  deductMonthlyActiveRoomCredit,
  deductClientCreditSpending,
  ACTIVE_ROOM_MONTHLY_TITLE_PREFIX
};
