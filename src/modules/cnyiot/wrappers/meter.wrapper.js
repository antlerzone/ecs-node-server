/**
 * CNYIoT Meter API wrapper (SaaS – per client).
 * callCnyIot 默认母账号；addMeter 内 Tel 等仍用 client_profile 联系人。
 */

const { callCnyIot } = require('./cnyiotRequest');
const { getClientTel } = require('../lib/getClientTel');
const { getPrices, addPrice } = require('./price.wrapper');
const { getCnyiotSubuserId } = require('../lib/cnyiotSubuser');
const userWrapper = require('./user.wrapper');

/* ---------- METER ---------- */
async function getMeters(clientId, mt = 1) {
  return callCnyIot({ clientId, method: 'getMetList_Simple', body: { mt } });
}

/**
 * Get meter status (balance, etc). Uses platform master account; client does not need to bind CNYIoT.
 */
async function getMeterStatus(clientId, meterId) {
  return callCnyIot({
    clientId,
    method: 'getMetStatusByMetId',
    body: { metid: String(meterId) },
    usePlatformAccount: true
  });
}

/** Build addMeter mts with 8 fields only (与 cnyiotoperation 一致，避免 4018). loginid/LoginID 由 callCnyIot 添加。 */
async function buildAddMeterMts(clientId, meters, priceId, indexBase) {
  const tel = await getClientTel(clientId);
  return {
    mts: meters.map((m, idx) => ({
      MeterID: String(m.MeterID),
      MeterModel: m.MeterModel ?? 0,
      Name: m.Name || `电表_${idx + 1}`,
      PriceID: String(priceId),
      Tel: tel || '0',
      Note: '',
      UserID: '0',
      index: String((indexBase || 0) + idx)
    }))
  };
}

/** Legacy: full payload with extra fields (warmkwh etc.). Prefer addMeters which uses 8 fields. */
async function getAddMeterPayload(clientId, meters) {
  const subuserId = await getCnyiotSubuserId(clientId);
  const listRes = await callCnyIot({ clientId, method: 'getMetList_Simple', body: { mt: 1 } });
  const list = Array.isArray(listRes?.value) ? listRes.value : (Array.isArray(listRes?.value?.d) ? listRes.value.d : []);
  const indexBase = Math.max(1, list.length + 1);
  const pricesRes = await getPrices(clientId);
  const priceList = Array.isArray(pricesRes?.value) ? pricesRes.value : [];
  const priceId = (priceList[0] && (priceList[0].PriceID ?? priceList[0].priceId)) != null ? String(priceList[0].PriceID ?? priceList[0].priceId) : '1';
  return buildAddMeterMts(clientId, meters, priceId, indexBase);
}

async function addMeters(clientId, meters) {
  const subuserId = await getCnyiotSubuserId(clientId);
  if (!subuserId) {
    console.warn('[CNYIOT] addMeters no subuserId (station_index), client must create subuser in Company Setting first');
    throw new Error('CLIENT_MUST_HAVE_CNYIOT_SUBUSER');
  }
  // addMeter / link2User 必须用主账号，否则子账号会 5006 无权操作
  const platformOpts = { usePlatformAccount: true };
  console.log('[CNYIOT] addMeters 1) getPrices (platform)');
  const pricesRes = await callCnyIot({ clientId, method: 'getPrices', body: { offset: -1, limit: -1, ptype: -1 }, ...platformOpts });
  const priceList = Array.isArray(pricesRes?.value) ? pricesRes.value : [];
  const priceId = (priceList[0] && (priceList[0].PriceID ?? priceList[0].priceId)) != null ? String(priceList[0].PriceID ?? priceList[0].priceId) : '1';
  console.log('[CNYIOT] addMeters 2) getMetList_Simple (platform)');
  const listRes = await callCnyIot({ clientId, method: 'getMetList_Simple', body: { mt: 1 }, ...platformOpts });
  const list = Array.isArray(listRes?.value) ? listRes.value : (Array.isArray(listRes?.value?.d) ? listRes.value.d : []);
  const indexBase = Math.max(1, list.length + 1);
  const payload = await buildAddMeterMts(clientId, meters, priceId, indexBase);
  console.log('[CNYIOT] addMeters 3) addMeter (platform) body=%j', payload);
  const res = await callCnyIot({ clientId, method: 'addMeter', body: payload, ...platformOpts });
  if (res?.result === 200 || res?.result === 0) {
    const hasError = Array.isArray(res?.value) && res.value.some((v) => v && Number(v.val) !== 0 && Number(v.val) !== 200);
    if (!hasError) {
      for (const m of meters) {
        const mid = m.MeterID ?? m.meterId;
        if (mid) {
          try {
            console.log('[CNYIOT] addMeters 4) link2User (platform) MeterID=%s UserID=%s', mid, subuserId);
            await userWrapper.link2User(clientId, mid, subuserId);
            console.log('[CNYIOT] addMeters link2User OK MeterID=%s', mid);
          } catch (e) {
            console.warn('[addMeters] link2User skip', mid, e.message);
          }
        }
      }
    }
  }
  return res;
}

/**
 * Resolve PriceID for 1/kwhz: getPrices (ptype=1 电价), find Price===1, else first 电价, else '1'.
 */
function resolvePriceIdFor1Kwhz(priceList) {
  const list = Array.isArray(priceList) ? priceList : [];
  const electricity = list.filter(p => Number(p.priceType) === 1 || p.priceType == null);
  const for1 = electricity.find(p => Number(p.Price) === 1);
  if (for1 && (for1.PriceID != null || for1.priceId != null)) {
    return String(for1.PriceID ?? for1.priceId);
  }
  if (electricity[0] && (electricity[0].PriceID != null || electricity[0].priceId != null)) {
    return String(electricity[0].PriceID ?? electricity[0].priceId);
  }
  return '1';
}

/**
 * Add meters with main account only: Name/Note per meter, UserID=0 (no binding), no link2User.
 * meters: [{ MeterID, Name, Note, MeterModel?: 0|1 }]. PriceID = 1/kwhz 对应的 PriceID（getPrices 查），Tel = client contact.
 */
async function addMetersNoBind(clientId, meters) {
  if (!Array.isArray(meters) || meters.length === 0) return { result: 200, value: [] };
  const tel = await getClientTel(clientId);
  console.log('[CNYIOT] addMetersNoBind clientId=%s clientTel=%s (visitor/client number)', clientId, tel ? `${tel.slice(0, 4)}***` : 'MISSING');
  const platformOpts = { usePlatformAccount: true };
  const pricesRes = await callCnyIot({ clientId, method: 'getPrices', body: { offset: -1, limit: -1, ptype: 1 }, ...platformOpts });
  const priceList = Array.isArray(pricesRes?.value) ? pricesRes.value : [];
  const priceId = resolvePriceIdFor1Kwhz(priceList);
  console.log('[CNYIOT] addMetersNoBind getPrices count=%s resolved PriceID for 1/kwhz=%s', priceList.length, priceId);
  const listRes = await callCnyIot({ clientId, method: 'getMetList_Simple', body: { mt: 1 }, ...platformOpts });
  const list = Array.isArray(listRes?.value) ? listRes.value : (Array.isArray(listRes?.value?.d) ? listRes.value.d : []);
  const indexBase = Math.max(1, list.length + 1);
  const mts = meters.map((m, idx) => ({
    MeterID: String(m.MeterID),
    MeterModel: m.MeterModel ?? 0,
    Name: m.Name || String(m.MeterID),
    PriceID: priceId,
    Tel: tel || '0',
    Note: m.Note != null ? String(m.Note) : '',
    UserID: '0',
    index: String(indexBase + idx)
  }));
  const payload = { mts };
  console.log('[CNYIOT] addMetersNoBind 使用主账号(平台账号) addMeter usePlatformAccount=true count=%s', mts.length);
  const res = await callCnyIot({ clientId, method: 'addMeter', body: payload, ...platformOpts });
  console.log('[CNYIOT] addMetersNoBind response result=%s value=%j', res?.result, res?.value);
  return res;
}

/** 与 addMetersNoBind 一致：主账号 deleteMeter，否则无权删平台侧电表 */
async function deleteMeters(clientId, meterIds) {
  const ids = (Array.isArray(meterIds) ? meterIds : [meterIds])
    .map((id) => String(id ?? '').trim())
    .filter(Boolean);
  if (ids.length === 0) return { result: 200, value: [] };
  return callCnyIot({
    clientId,
    method: 'deleteMeter',
    body: { MetID: ids },
    usePlatformAccount: true
  });
}

async function editMeterSafe(clientId, { meterId, meterName, priceId }) {
  const payload = {
    MeterID: String(meterId),
    MeterName: meterName,
    PriceID: String(priceId),
    Tel: '0',
    warmKwh: '0',
    Remarks: '',
    UserID: '0',
    sellMin: '0'
  };
  console.log('[editMeterSafe] clientId=%s (platform) payload=%j', clientId, payload);
  const res = await callCnyIot({ clientId, method: 'editMeter', body: payload, usePlatformAccount: true });
  console.log('[editMeterSafe] editMeter result=%s', res?.result);
  if (res?.result !== 0 && res?.result !== 200) {
    throw new Error(`EDIT_METER_FAILED_${res?.result}`);
  }
  return res;
}

/* ---------- CONTROL ---------- */
/** setRelay: Val 2 = connect (power on), Val 1 = disconnect (power off). 始终母账号。 */
async function setRelay(clientId, meterId, val = 2, opts = {}) {
  const json = await callCnyIot({
    clientId,
    method: 'setRelay',
    body: { MetID: String(meterId), Val: String(val), iswifi: '1' },
    ...opts,
    usePlatformAccount: true
  });
  const r = json?.result;
  const ok = r === 0 || r === 200 || r === '0' || r === '200';
  if (!ok) {
    const err = new Error(`CNYIOT_SET_RELAY:${r}`);
    err.cnyiotResult = r;
    err.cnyiotRaw = json;
    throw err;
  }
  return json;
}

async function setPowerGate(clientId, meterId, value) {
  return callCnyIot({
    clientId,
    method: 'setPowerGate',
    body: { MetID: String(meterId), Val: String(value), iswifi: '1' },
    usePlatformAccount: true
  });
}

async function setRatio(clientId, meterId, ratio) {
  return callCnyIot({
    clientId,
    method: 'setRatio',
    body: { MetID: String(meterId), Ratio: String(ratio), iswifi: '1' },
    usePlatformAccount: true
  });
}

/* ---------- TOPUP ---------- */
/**
 * Create pending topup (sellByApi).
 * @param {string} clientId
 * @param {string} meterId - metid
 * @param {number} amount - sellKwh (when byMoney false) or sellMoney (when byMoney true)
 * @param {{ byMoney?: boolean }} opts - byMoney: true 时按金额充值，传 sellMoney + simple=2；否则按度数 sellKwh + simple=1
 */
async function createPendingTopup(clientId, meterId, amount, opts = {}) {
  const byMoney = opts.byMoney === true;
  return callCnyIot({
    clientId,
    method: 'sellByApi',
    body: {
      metid: String(meterId),
      sellKwh: byMoney ? '0' : String(amount),
      sellMoney: byMoney ? String(amount) : '0',
      simple: byMoney ? '2' : '1',
      iswifi: '1'
    },
    usePlatformAccount: true
  });
}

async function confirmTopup(clientId, meterId, idx) {
  return callCnyIot({
    clientId,
    method: 'sellByApiOk',
    body: { metid: String(meterId), idx: String(idx) },
    usePlatformAccount: true
  });
}

/**
 * 电量清零 (clearKwh) — prepaid remaining kWh on platform. §19 OpenAPI.
 */
async function clearKwh(clientId, platformMeterId, opts = {}) {
  const mid = String(platformMeterId || '').trim();
  return callCnyIot({
    clientId,
    method: 'clearKwh',
    body: { metid: mid, MetID: mid, iswifi: '1' },
    ...opts,
    usePlatformAccount: true
  });
}

/* ---------- DATA / REPORT ---------- */
/**
 * Usage records. Uses platform master account; client does not need to bind CNYIoT.
 */
async function getUsageRecords(clientId, meterId, st, et, mYMD = 1) {
  return callCnyIot({
    clientId,
    method: 'getRecord_Simple',
    body: { metID: String(meterId), st, et, mYMD },
    usePlatformAccount: true
  });
}

/**
 * Month bill. Uses platform master account; client does not need to bind CNYIoT.
 */
async function getMonthBill(clientId, meterIds, st, et, mYMD = 2) {
  const metID = Array.isArray(meterIds) ? meterIds.join(',') : meterIds;
  return callCnyIot({
    clientId,
    method: 'getMonthBill',
    body: { metID, st, et, mYMD },
    usePlatformAccount: true
  });
}

/**
 * Operation history. Uses platform master account; client does not need to bind CNYIoT.
 */
async function getOperationHistory(clientId, st, et) {
  return callCnyIot({
    clientId,
    method: 'getHist',
    body: { st, et },
    usePlatformAccount: true
  });
}

/* ---------- HELPERS: date + usage summary ---------- */
function formatDate(d) {
  if (d == null) return null;
  if (typeof d === 'string') return d;
  const date = d instanceof Date ? d : new Date(d);
  const ts = typeof date.getTime === 'function' ? date.getTime() : NaN;
  if (Number.isNaN(ts)) return null;
  const myTime = new Date(ts + 8 * 60 * 60 * 1000);
  const y = myTime.getUTCFullYear();
  const m = String(myTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(myTime.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Usage summary: total, per-meter, daily records.
 * Uses platform master account (CNYIOT_LOGIN_NAME/PSW); client does not need to bind CNYIoT.
 */
async function getUsageSummary(clientId, { meterIds, start, end }) {
  const st = formatDate(start);
  const et = formatDate(end);
  if (st == null || et == null) {
    return { total: 0, records: [], children: {} };
  }
  const res = await callCnyIot({
    clientId,
    method: 'getMonthBill',
    body: { metID: meterIds.join(','), st, et, mYMD: 2 },
    usePlatformAccount: true
  });

  if (!Array.isArray(res?.value)) {
    return { total: 0, records: [], children: {} };
  }

  let total = 0;
  const children = {};
  const dailyMap = new Map();

  for (const r of res.value) {
    const used = Number(r.uk || 0);
    const meterId = String(r.mid || r.MeterID || '');
    total += used;
    if (meterId) children[meterId] = (children[meterId] || 0) + used;
    const date = String(r.dK || '');
    if (!dailyMap.has(date)) dailyMap.set(date, { date, consumption: 0 });
    dailyMap.get(date).consumption += used;
  }

  return {
    total: Number(total.toFixed(2)),
    records: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    children
  };
}

/**
 * Resolve PriceID from rate: getPrices (电价), find Price === rate, return PriceID.
 * Does not create price. Throws RATE_NOT_IN_PRICE_LIST if rate not in list.
 */
async function resolvePriceIdByRate(clientId, rate) {
  const priceValue = Number(rate);
  if (Number.isNaN(priceValue) || priceValue <= 0) throw new Error('INVALID_RATE');
  const pricesRes = await getPrices(clientId);
  const prices = Array.isArray(pricesRes?.value) ? pricesRes.value : [];
  const price = prices.find(p => (Number(p.priceType) === 1 || p.priceType == null) && Number(p.Price) === priceValue);
  if (!price || (price.PriceID == null && price.priceId == null)) {
    throw new Error('RATE_NOT_IN_PRICE_LIST');
  }
  return String(price.PriceID ?? price.priceId);
}

/**
 * Get PriceID for rate: getPrices, find Price === rate. If not in list, create price (addPrice) then return new PriceID.
 */
async function resolveOrCreatePriceIdByRate(clientId, rate) {
  const priceValue = Number(rate);
  if (Number.isNaN(priceValue) || priceValue <= 0) throw new Error('INVALID_RATE');

  const pricesRes = await getPrices(clientId);
  const prices = Array.isArray(pricesRes?.value) ? pricesRes.value : [];
  const existing = prices.find(p => (Number(p.priceType) === 1 || p.priceType == null) && Number(p.Price) === priceValue);
  if (existing && (existing.PriceID != null || existing.priceId != null)) {
    return String(existing.PriceID ?? existing.priceId);
  }

  console.log('[resolveOrCreatePriceIdByRate] rate=%s not in list, creating price', priceValue);
  const addRes = await addPrice(clientId, {
    PriceName: `${priceValue}/kwhz`,
    Price: priceValue,
    Pnote: '',
    priceType: 1
  });
  const newId = addRes?.value?.PriceID ?? addRes?.value?.priceId ?? addRes?.value?.[0]?.PriceID ?? addRes?.value?.[0]?.priceId;
  if (newId != null) {
    return String(newId);
  }
  const pricesRes2 = await getPrices(clientId);
  const prices2 = Array.isArray(pricesRes2?.value) ? pricesRes2.value : [];
  const created = prices2.find(p => (Number(p.priceType) === 1 || p.priceType == null) && Number(p.Price) === priceValue);
  if (created && (created.PriceID != null || created.priceId != null)) {
    return String(created.PriceID ?? created.priceId);
  }
  throw new Error('RATE_CREATE_FAILED');
}

/**
 * Update meter rate on CNYIOT: editMeter(PriceID + MeterName).
 * currentMeterName: editMeter 的 MeterName；metersetting 传 client subdomain only（非 Portal title）。
 */
async function updateMeterNameAndRate(clientId, { meterId, currentMeterName, rate }) {
  if (!clientId || !meterId) throw new Error('CLIENT_OR_METER_REQUIRED');

  const priceValue = Number(rate);
  if (Number.isNaN(priceValue) || priceValue <= 0) throw new Error('INVALID_RATE');

  const priceId = await resolveOrCreatePriceIdByRate(clientId, rate);
  const meterName = (currentMeterName != null && String(currentMeterName).trim() !== '') ? String(currentMeterName).trim() : '';

  console.log('[updateMeterNameAndRate] editMeterSafe meterId=%s meterName=%s priceId=%s', meterId, meterName, priceId);
  await editMeterSafe(clientId, { meterId, meterName, priceId });
  return { ok: true, rate: priceValue, priceId };
}

module.exports = {
  getMeters,
  getMeterStatus,
  getAddMeterPayload,
  addMeters,
  addMetersNoBind,
  deleteMeters,
  editMeterSafe,
  setRelay,
  setPowerGate,
  setRatio,
  createPendingTopup,
  confirmTopup,
  clearKwh,
  getUsageRecords,
  getMonthBill,
  getOperationHistory,
  getUsageSummary,
  formatDate,
  updateMeterNameAndRate
};
