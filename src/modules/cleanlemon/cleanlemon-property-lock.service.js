/**
 * Cleanlemons — bind `lockdetail` to `cln_property` without Coliving propertydetail (M:N: same lock may serve multiple properties).
 */

const crypto = require('crypto');
const pool = require('../../config/db');
const smartDoorSvc = require('../smartdoorsetting/smartdoorsetting.service');

async function databaseHasTable(tableName) {
  try {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [String(tableName || '')]
    );
    return Number(row?.n) > 0;
  } catch {
    return false;
  }
}

async function databaseHasColumn(tableName, columnName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [tableName, columnName]
  );
  return Number(row?.n) > 0;
}

/**
 * Locks bound via `cln_property_lock` with optional label from lockdetail.
 */
async function listNativeLocksForClnProperty(propertyId) {
  const pid = String(propertyId || '').trim();
  if (!pid || !(await databaseHasTable('cln_property_lock'))) return [];
  const lbl = 'COALESCE(NULLIF(TRIM(l.lockalias), \'\'), CAST(l.id AS CHAR))';
  const [rows] = await pool.query(
    `SELECT pl.id AS bindId,
            pl.lockdetail_id AS lockdetailId,
            pl.integration_source AS integrationSource,
            pl.ttlock_slot AS ttlockSlot,
            ${lbl} AS lockLabel
     FROM cln_property_lock pl
     INNER JOIN lockdetail l ON l.id = pl.lockdetail_id
     WHERE pl.property_id = ?
     ORDER BY pl.created_at ASC`,
    [pid]
  );
  return (rows || []).map((r) => ({
    bindId: String(r.bindId || '').trim(),
    lockdetailId: String(r.lockdetailId || '').trim(),
    integrationSource: String(r.integrationSource || 'manual').trim(),
    ttlockSlot: r.ttlockSlot != null ? Number(r.ttlockSlot) : 0,
    lockLabel: String(r.lockLabel || r.lockdetailId || '').trim(),
  }));
}

async function assertOperatorOwnsProperty(operatorId, propertyId) {
  const oid = String(operatorId || '').trim();
  const pid = String(propertyId || '').trim();
  if (!oid || !pid) {
    const e = new Error('MISSING_IDS');
    e.code = 'MISSING_IDS';
    throw e;
  }
  const hasOp = await databaseHasColumn('cln_property', 'operator_id');
  if (!hasOp) {
    const e = new Error('UNSUPPORTED');
    e.code = 'UNSUPPORTED';
    throw e;
  }
  const [[row]] = await pool.query(
    'SELECT id FROM cln_property WHERE id = ? AND operator_id = ? LIMIT 1',
    [pid, oid]
  );
  if (!row) {
    const e = new Error('OPERATOR_MISMATCH');
    e.code = 'OPERATOR_MISMATCH';
    throw e;
  }
}

async function assertClientOwnsProperty(clientdetailId, propertyId) {
  const cid = String(clientdetailId || '').trim();
  const pid = String(propertyId || '').trim();
  if (!cid || !pid) {
    const e = new Error('MISSING_IDS');
    e.code = 'MISSING_IDS';
    throw e;
  }
  const hasCd = await databaseHasColumn('cln_property', 'clientdetail_id');
  if (!hasCd) {
    const e = new Error('UNSUPPORTED');
    e.code = 'UNSUPPORTED';
    throw e;
  }
  const [[row]] = await pool.query(
    'SELECT id FROM cln_property WHERE id = ? AND clientdetail_id = ? LIMIT 1',
    [pid, cid]
  );
  if (!row) {
    const e = new Error('CLIENT_PROPERTY_MISMATCH');
    e.code = 'CLIENT_PROPERTY_MISMATCH';
    throw e;
  }
}

/** When set, smart door is managed on Coliving propertydetail — block native bind. */
async function assertNoColivingPropertyLockGate(propertyId) {
  const hasPd = await databaseHasColumn('cln_property', 'coliving_propertydetail_id');
  if (!hasPd) return;
  const [[row]] = await pool.query(
    'SELECT coliving_propertydetail_id AS pd FROM cln_property WHERE id = ? LIMIT 1',
    [String(propertyId || '').trim()]
  );
  const pd = row?.pd != null ? String(row.pd).trim() : '';
  if (pd) {
    const e = new Error('PROPERTY_COLIVING_LOCK_MANAGED');
    e.code = 'PROPERTY_COLIVING_LOCK_MANAGED';
    throw e;
  }
}

/**
 * Operator portal — bind a lock that already exists under this operator TTLock scope.
 */
async function bindNativeLockOperator({ operatorId, propertyId, lockdetailId, ttlockSlot, integrationSource }) {
  if (!(await databaseHasTable('cln_property_lock'))) {
    const e = new Error('UNSUPPORTED');
    e.code = 'UNSUPPORTED';
    throw e;
  }
  await assertOperatorOwnsProperty(operatorId, propertyId);
  await assertNoColivingPropertyLockGate(propertyId);
  const lid = String(lockdetailId || '').trim();
  if (!lid) {
    const e = new Error('MISSING_LOCK_ID');
    e.code = 'MISSING_LOCK_ID';
    throw e;
  }
  const slot = Number(ttlockSlot) || 0;
  const scope = { kind: 'cln_operator', clnOperatorId: String(operatorId).trim(), ttlockSlot: slot };
  const lockRow = await smartDoorSvc.getLock(scope, lid);
  if (!lockRow) {
    const e = new Error('LOCK_NOT_IN_SCOPE');
    e.code = 'LOCK_NOT_IN_SCOPE';
    throw e;
  }
  const src = String(integrationSource || 'operator_ttlock').trim().slice(0, 32) || 'operator_ttlock';
  const id = crypto.randomUUID();
  try {
    await pool.query(
      `INSERT INTO cln_property_lock (id, property_id, lockdetail_id, integration_source, ttlock_slot, created_at)
       VALUES (?, ?, ?, ?, ?, NOW(3))`,
      [id, String(propertyId).trim(), lid, src, slot]
    );
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      const e = new Error('ALREADY_BOUND');
      e.code = 'ALREADY_BOUND';
      throw e;
    }
    throw err;
  }
  return { ok: true, bindId: id };
}

/**
 * Client portal — bind lock under B2B client TTLock scope.
 */
async function bindNativeLockClient({ clientdetailId, propertyId, lockdetailId, ttlockSlot, integrationSource }) {
  if (!(await databaseHasTable('cln_property_lock'))) {
    const e = new Error('UNSUPPORTED');
    e.code = 'UNSUPPORTED';
    throw e;
  }
  await assertClientOwnsProperty(clientdetailId, propertyId);
  await assertNoColivingPropertyLockGate(propertyId);
  const lid = String(lockdetailId || '').trim();
  if (!lid) {
    const e = new Error('MISSING_LOCK_ID');
    e.code = 'MISSING_LOCK_ID';
    throw e;
  }
  const slot = Number(ttlockSlot) || 0;
  const scope = { kind: 'cln_client', clnClientId: String(clientdetailId).trim(), ttlockSlot: slot };
  const lockRow = await smartDoorSvc.getLock(scope, lid);
  if (!lockRow) {
    const e = new Error('LOCK_NOT_IN_SCOPE');
    e.code = 'LOCK_NOT_IN_SCOPE';
    throw e;
  }
  const src = String(integrationSource || 'client_ttlock').trim().slice(0, 32) || 'client_ttlock';
  const id = crypto.randomUUID();
  try {
    await pool.query(
      `INSERT INTO cln_property_lock (id, property_id, lockdetail_id, integration_source, ttlock_slot, created_at)
       VALUES (?, ?, ?, ?, ?, NOW(3))`,
      [id, String(propertyId).trim(), lid, src, slot]
    );
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      const e = new Error('ALREADY_BOUND');
      e.code = 'ALREADY_BOUND';
      throw e;
    }
    throw err;
  }
  return { ok: true, bindId: id };
}

async function unbindNativeLockOperator({ operatorId, propertyId, lockdetailId }) {
  if (!(await databaseHasTable('cln_property_lock'))) {
    const e = new Error('UNSUPPORTED');
    e.code = 'UNSUPPORTED';
    throw e;
  }
  await assertOperatorOwnsProperty(operatorId, propertyId);
  const lid = String(lockdetailId || '').trim();
  const [r] = await pool.query(
    'DELETE FROM cln_property_lock WHERE property_id = ? AND lockdetail_id = ? LIMIT 1',
    [String(propertyId).trim(), lid]
  );
  return { ok: true, deleted: r?.affectedRows || 0 };
}

async function unbindNativeLockClient({ clientdetailId, propertyId, lockdetailId }) {
  if (!(await databaseHasTable('cln_property_lock'))) {
    const e = new Error('UNSUPPORTED');
    e.code = 'UNSUPPORTED';
    throw e;
  }
  await assertClientOwnsProperty(clientdetailId, propertyId);
  const lid = String(lockdetailId || '').trim();
  const [r] = await pool.query(
    'DELETE FROM cln_property_lock WHERE property_id = ? AND lockdetail_id = ? LIMIT 1',
    [String(propertyId).trim(), lid]
  );
  return { ok: true, deleted: r?.affectedRows || 0 };
}

async function listNativeLocksForOperatorPortal({ operatorId, propertyId }) {
  await assertOperatorOwnsProperty(operatorId, propertyId);
  return listNativeLocksForClnProperty(propertyId);
}

async function listNativeLocksForClientPortal({ clientdetailId, propertyId }) {
  await assertClientOwnsProperty(clientdetailId, propertyId);
  return listNativeLocksForClnProperty(propertyId);
}

module.exports = {
  listNativeLocksForClnProperty,
  listNativeLocksForOperatorPortal,
  listNativeLocksForClientPortal,
  bindNativeLockOperator,
  bindNativeLockClient,
  unbindNativeLockOperator,
  unbindNativeLockClient,
  assertNoColivingPropertyLockGate,
};
