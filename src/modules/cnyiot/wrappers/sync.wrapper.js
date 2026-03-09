/**
 * CNYIoT ↔ meterdetail sync (single meter by CMS meterId).
 * Reads meterdetail by meterid, calls getMetStatusByMetId, parses and updates meterdetail.
 */

const pool = require('../../../config/db');
const { callCnyIot } = require('./cnyiotRequest');

async function syncMeterByCmsMeterId(clientId, meterId) {
  if (!clientId) throw new Error('CLIENT_ID_REQUIRED');
  if (!meterId) throw new Error('METER_ID_REQUIRED');

  const [rows] = await pool.query(
    'SELECT * FROM meterdetail WHERE meterid = ? AND client_id = ? LIMIT 1',
    [String(meterId), clientId]
  );
  const meter = rows[0];
  if (!meter) throw new Error('METER_NOT_FOUND');

  const metidToUse = meter.meterid != null ? String(meter.meterid).trim() : '';
  if (!metidToUse) throw new Error('METER_ID_NOT_FOUND');

  const reqBody = { metid: metidToUse };
  console.log('[sync] getMetStatusByMetId request body=', JSON.stringify(reqBody));
  const statusRes = await callCnyIot({
    clientId,
    method: 'getMetStatusByMetId',
    body: reqBody,
    usePlatformAccount: true
  });
  console.log('[sync] getMetStatusByMetId response result=', statusRes?.result, 'valueType=', typeof statusRes?.value, 'valueKeys=', statusRes?.value && typeof statusRes.value === 'object' ? Object.keys(statusRes.value) : []);
  console.log('[sync] getMetStatusByMetId response body (full)=', JSON.stringify(statusRes));

  const resResult = statusRes?.result;
  const okResult = resResult === 0 || resResult === 200 || resResult === '0' || resResult === '200';
  if (!okResult) {
    throw new Error(`GET_METER_STATUS_FAILED_${resResult}`);
  }

  const val = statusRes?.value;
  const d = (Array.isArray(val?.d) && val.d[0]) ? val.d[0] : (val?.d?.[0]) ?? val?.data?.[0] ?? val;
  if (!d || typeof d !== 'object') throw new Error('EMPTY_METER_STATUS');

  let mode = meter.mode;
  if (d.m !== undefined || d.MeterModel !== undefined || d.meterModel !== undefined) {
    const mFlag = d.m ?? d.MeterModel ?? d.meterModel;
    mode = Number(mFlag) === 0 ? 'prepaid' : 'postpaid';
  }

  let title = meter.title;
  if (!title && (d.n != null)) title = String(d.n).trim();

  let balance = 0;
  try {
    if (Number(d.pim) === 0) balance = Number(d.e ?? d.s_enablekwh ?? 0);
    else if (Number(d.pim) === 1) balance = Number(d.em ?? d.s_enablekwh ?? 0);
    else balance = Number(d.s_enablekwh ?? d.e ?? d.em ?? 0);
  } catch {
    balance = 0;
  }

  const s = Number(d.s);
  const isOnline = s === 3 || s === 4 || String(d.met_status || d.s).includes('在线');
  let status = false;
  if (s === 3) status = true;
  else if (s === 4) status = false;
  else status = isOnline;
  console.log('[sync] parsed d.s=', d.s, 's(Number)=', s, 'isOnline=', isOnline, 'status(Active)=', status, 'balance=', balance);

  const updateParams = [title ?? meter.title, mode ?? meter.mode, balance, isOnline ? 1 : 0, status ? 1 : 0, meter.id];
  const [updateResult] = await pool.query(
    `UPDATE meterdetail SET title = ?, mode = ?, balance = ?, isonline = ?, status = ?, lastsyncat = NOW(), updated_at = NOW() WHERE id = ?`,
    updateParams
  );
  const affectedRows = updateResult?.affectedRows ?? 0;
  console.log('[sync] UPDATE meterdetail id=%s affectedRows=%s', meter.id, affectedRows);
  if (affectedRows === 0) {
    console.warn('[sync] UPDATE meterdetail affected 0 rows - table may not be updated');
  }

  const [afterRows] = await pool.query('SELECT * FROM meterdetail WHERE id = ? LIMIT 1', [meter.id]);
  const after = afterRows && afterRows[0] ? afterRows[0] : { ...meter, title, mode, balance, isonline: isOnline ? 1 : 0, status: status ? 1 : 0, lastsyncat: new Date() };

  return {
    ok: true,
    meterId,
    meterid: metidToUse,
    before: meter,
    after,
    raw: d
  };
}

module.exports = { syncMeterByCmsMeterId };
