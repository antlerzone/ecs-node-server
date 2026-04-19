/**
 * CNYIoT ↔ meterdetail sync (single meter by CMS meterId).
 * Reads meterdetail by meterid, calls getMetStatusByMetId, parses and updates meterdetail.
 */

const pool = require('../../../config/db');
const { callCnyIot } = require('./cnyiotRequest');
const meterWrapper = require('./meter.wrapper');

async function syncMeterByCmsMeterId(clientId, meterId) {
  if (!clientId) throw new Error('CLIENT_ID_REQUIRED');
  if (!meterId) throw new Error('METER_ID_REQUIRED');

  console.log('[sync] sync.wrapper version=portal-balance-guard+prepaid-zero-relay-off');

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
  /** s=3/4 = device reports definitive on/off. s=6「等待下发」等 = platform/指令未同步到表，此时用设备字段会覆盖 portal 刚 topup/clear 的结果。 */
  const deviceRelayDefinitive = s === 3 || s === 4;
  let status = false;
  if (s === 3) status = true;
  else if (s === 4) status = false;
  else status = isOnline;

  let balanceUse = balance;
  let statusUse = status ? 1 : 0;
  if (!deviceRelayDefinitive) {
    balanceUse = meter.balance != null ? Number(meter.balance) : balance;
    statusUse = meter.status ? 1 : 0;
    console.log(
      '[sync] s=%s not 3/4 (e.g. 等待下发) — keep portal balance=%s status=%s, not device balance=%s status=%s',
      d.s,
      balanceUse,
      statusUse,
      balance,
      status ? 1 : 0
    );
  } else {
    console.log('[sync] parsed d.s=', d.s, 'isOnline=', isOnline, 'status(Active)=', status, 'balance=', balance);
  }

  const modeStr = String(mode || meter.mode || 'prepaid').toLowerCase() === 'postpaid' ? 'postpaid' : 'prepaid';
  const balanceUseNum = Number(balanceUse);
  /** Prepaid & no kWh left → Active must be false and relay open (Val 1), even if device briefly reports s=3. */
  let zeroBalanceForcedRelayOff = false;
  if (modeStr === 'prepaid' && !Number.isNaN(balanceUseNum) && balanceUseNum <= 0) {
    if (statusUse !== 0) {
      console.log(
        '[sync] prepaid zero balance: forcing status OFF (was %s) — CNYIOT/merged balance=%s',
        statusUse,
        balanceUseNum
      );
    }
    statusUse = 0;
    zeroBalanceForcedRelayOff = true;
  }

  const updateParams = [title ?? meter.title, mode ?? meter.mode, balanceUse, isOnline ? 1 : 0, statusUse, meter.id];
  const [updateResult] = await pool.query(
    `UPDATE meterdetail SET title = ?, mode = ?, balance = ?, isonline = ?, status = ?, lastsyncat = NOW(), updated_at = NOW() WHERE id = ?`,
    updateParams
  );
  const affectedRows = updateResult?.affectedRows ?? 0;
  console.log('[sync] UPDATE meterdetail id=%s affectedRows=%s', meter.id, affectedRows);
  if (affectedRows === 0) {
    console.warn('[sync] UPDATE meterdetail affected 0 rows - table may not be updated');
  }

  if (zeroBalanceForcedRelayOff && metidToUse) {
    try {
      await meterWrapper.setRelay(clientId, metidToUse, 1);
      console.log('[sync] setRelay Val=1 (disconnect) OK for prepaid zero balance metid=%s', metidToUse);
    } catch (e) {
      console.warn('[sync] setRelay disconnect for zero balance failed', metidToUse, e?.message || e);
    }
  }

  const [afterRows] = await pool.query('SELECT * FROM meterdetail WHERE id = ? LIMIT 1', [meter.id]);
  const after =
    afterRows && afterRows[0]
      ? afterRows[0]
      : {
          ...meter,
          title,
          mode,
          balance: balanceUse,
          isonline: isOnline ? 1 : 0,
          status: statusUse,
          lastsyncat: new Date()
        };

  return {
    ok: true,
    meterId,
    meterid: metidToUse,
    before: meter,
    after,
    raw: d,
    prepaidZeroBalanceRelayOff: zeroBalanceForcedRelayOff
  };
}

module.exports = { syncMeterByCmsMeterId };
