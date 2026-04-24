/**
 * Cleanlemons: cln_property_link_request — client ↔ operator property linking approvals.
 */

const crypto = require('crypto');
const pool = require('../../config/db');
const contactSync = require('../contact/contact-sync.service');
const clnDc = require('./cleanlemon-cln-domain-contacts');

const KIND_CLIENT_OP = 'client_requests_operator';
const KIND_OP_CLIENT = 'operator_requests_client';

async function ensurePropertyLinkRequestTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS \`cln_property_link_request\` (
    \`id\` CHAR(36) NOT NULL,
    \`kind\` VARCHAR(40) NOT NULL,
    \`property_id\` CHAR(36) NOT NULL,
    \`clientdetail_id\` CHAR(36) NOT NULL,
    \`operator_id\` CHAR(36) NOT NULL,
    \`status\` VARCHAR(20) NOT NULL DEFAULT 'pending',
    \`payload_json\` LONGTEXT NULL,
    \`remarks\` TEXT NULL,
    \`decided_by_email\` VARCHAR(255) NULL,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`decided_at\` DATETIME(3) NULL,
    PRIMARY KEY (\`id\`),
    KEY \`idx_cln_plr_operator_status\` (\`operator_id\`, \`status\`, \`created_at\`),
    KEY \`idx_cln_plr_client_status\` (\`clientdetail_id\`, \`status\`, \`created_at\`),
    KEY \`idx_cln_plr_property\` (\`property_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

/**
 * Set cln_operatorid on lockdetail / gatewaydetail for locks tied to Coliving property (client-owned TTLock rows).
 */
async function assignClnOperatorToPropertySmartDoorRows(propertyId, clientdetailId, operatorId) {
  const pid = String(propertyId || '').trim();
  const cid = String(clientdetailId || '').trim();
  const oid = String(operatorId || '').trim();
  if (!pid || !cid || !oid) return { updatedLocks: 0, updatedGateways: 0 };

  let lockIds = [];
  try {
    const sd = require('../smartdoorsetting/smartdoorsetting.service');
    const scope = { kind: 'cln_client', clnClientId: cid };
    lockIds = await sd.getSmartDoorIdsByProperty(scope, pid);
  } catch (e) {
    console.warn('[cleanlemon] assignClnOperatorToPropertySmartDoorRows getSmartDoorIdsByProperty', e?.message || e);
    return { updatedLocks: 0, updatedGateways: 0 };
  }
  if (!lockIds.length) return { updatedLocks: 0, updatedGateways: 0 };

  const ph = lockIds.map(() => '?').join(',');
  const [r1] = await pool.query(
    `UPDATE lockdetail SET cln_operatorid = ?, updated_at = NOW() WHERE id IN (${ph}) AND cln_clientid = ?`,
    [oid, ...lockIds, cid]
  );

  const [grows] = await pool.query(
    `SELECT DISTINCT gateway_id FROM lockdetail WHERE id IN (${ph}) AND gateway_id IS NOT NULL AND TRIM(gateway_id) <> ''`,
    lockIds
  );
  const gids = [...new Set((grows || []).map((x) => x.gateway_id).filter(Boolean))];
  let gwCount = 0;
  for (const gid of gids) {
    const [ug] = await pool.query(
      'UPDATE gatewaydetail SET cln_operatorid = ?, updated_at = NOW() WHERE id = ? AND cln_clientid = ?',
      [oid, String(gid), cid]
    );
    gwCount += ug.affectedRows || 0;
  }
  return { updatedLocks: r1.affectedRows || 0, updatedGateways: gwCount };
}

/**
 * Clear `cln_operatorid` on lockdetail / gatewaydetail for locks tied to this `cln_property` (inverse of assign).
 * Run **before** clearing `cln_property.operator_id` when using operator scope to resolve Coliving bridge rows.
 */
async function clearClnOperatorFromPropertySmartDoorRows(propertyId, operatorId, clientdetailIdOpt) {
  const pid = String(propertyId || '').trim();
  const oid = String(operatorId || '').trim();
  const cid = String(clientdetailIdOpt || '').trim();
  if (!pid || !oid) return { updatedLocks: 0, updatedGateways: 0 };

  let lockIds = [];
  try {
    const sd = require('../smartdoorsetting/smartdoorsetting.service');
    if (cid) {
      lockIds = await sd.getSmartDoorIdsByProperty({ kind: 'cln_client', clnClientId: cid }, pid);
    } else {
      lockIds = await sd.getSmartDoorIdsByProperty({ kind: 'cln_operator', clnOperatorId: oid }, pid);
    }
  } catch (e) {
    console.warn('[cleanlemon] clearClnOperatorFromPropertySmartDoorRows getSmartDoorIdsByProperty', e?.message || e);
    return { updatedLocks: 0, updatedGateways: 0 };
  }
  if (!lockIds.length) return { updatedLocks: 0, updatedGateways: 0 };

  const ph = lockIds.map(() => '?').join(',');
  let r1;
  if (cid) {
    [r1] = await pool.query(
      `UPDATE lockdetail SET cln_operatorid = NULL, updated_at = NOW() WHERE id IN (${ph}) AND cln_operatorid <=> ? AND cln_clientid <=> ?`,
      [...lockIds, oid, cid]
    );
  } else {
    [r1] = await pool.query(
      `UPDATE lockdetail SET cln_operatorid = NULL, updated_at = NOW() WHERE id IN (${ph}) AND cln_operatorid <=> ?`,
      [...lockIds, oid]
    );
  }

  const [grows] = await pool.query(
    `SELECT DISTINCT gateway_id FROM lockdetail WHERE id IN (${ph}) AND gateway_id IS NOT NULL AND TRIM(gateway_id) <> ''`,
    lockIds
  );
  const gids = [...new Set((grows || []).map((x) => String(x.gateway_id || '').trim()).filter(Boolean))];
  let gwCount = 0;
  for (const gid of gids) {
    let ug;
    if (cid) {
      [ug] = await pool.query(
        'UPDATE gatewaydetail SET cln_operatorid = NULL, updated_at = NOW() WHERE id = ? AND cln_operatorid <=> ? AND cln_clientid <=> ?',
        [gid, oid, cid]
      );
    } else {
      [ug] = await pool.query(
        'UPDATE gatewaydetail SET cln_operatorid = NULL, updated_at = NOW() WHERE id = ? AND cln_operatorid <=> ?',
        [gid, oid]
      );
    }
    gwCount += ug.affectedRows || 0;
  }
  return { updatedLocks: r1.affectedRows || 0, updatedGateways: gwCount };
}

async function ensureClnClientOperatorJunction(clientdetailId, operatorId) {
  const cid = String(clientdetailId || '').trim();
  const oid = String(operatorId || '').trim();
  if (!cid || !oid) return;
  const [[ex]] = await pool.query(
    'SELECT id FROM cln_client_operator WHERE clientdetail_id = ? AND operator_id = ? LIMIT 1',
    [cid, oid]
  );
  if (ex) return;
  const hasCrm = await databaseHasColumn('cln_client_operator', 'crm_json');
  const jid = crypto.randomUUID();
  if (hasCrm) {
    await pool.query(
      `INSERT INTO cln_client_operator (id, clientdetail_id, operator_id, crm_json, created_at)
       VALUES (?, ?, ?, ?, NOW(3))`,
      [jid, cid, oid, JSON.stringify({ status: 'active' })]
    );
  } else {
    await pool.query(
      `INSERT INTO cln_client_operator (id, clientdetail_id, operator_id, created_at) VALUES (?, ?, ?, NOW(3))`,
      [jid, cid, oid]
    );
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

async function pushAccountingAfterLinkApproval(getClnAccountProviderForOperator, clientdetailId, operatorId) {
  const cid = String(clientdetailId || '').trim();
  const oid = String(operatorId || '').trim();
  if (!cid || !oid) return { ok: true, skipped: true };
  const provider = await getClnAccountProviderForOperator(oid);
  if (!provider) return { ok: true, skipped: true, reason: 'no_accounting' };
  const [[cd]] = await pool.query(
    'SELECT email, fullname, phone FROM cln_clientdetail WHERE id = ? LIMIT 1',
    [cid]
  );
  if (!cd) return { ok: false, reason: 'CLIENTDETAIL_NOT_FOUND' };
  try {
    /** Ensures tenant/customer in Bukku/Xero/etc., writes `cln_clientdetail.account`, mirrors id to `cln_client_operator.crm_json`. */
    return await clnDc.pushClientAccounting(pool, getClnAccountProviderForOperator, oid, cid, {
      name: String(cd.fullname || '').trim(),
      email: String(cd.email || '').trim().toLowerCase(),
      phone: cd.phone != null && String(cd.phone).trim() !== '-' ? String(cd.phone).trim() : '',
    });
  } catch (e) {
    console.warn('[cleanlemon] pushAccountingAfterLinkApproval', e?.message || e);
    return { ok: false, reason: e?.message || 'ACCOUNTING_PUSH_FAILED' };
  }
}

async function createPropertyLinkRequest({
  kind,
  propertyId,
  clientdetailId,
  operatorId,
  payloadJson,
  supersedePending = true,
}) {
  await ensurePropertyLinkRequestTable();
  const kid = String(kind || '').trim();
  if (![KIND_CLIENT_OP, KIND_OP_CLIENT].includes(kid)) {
    const e = new Error('INVALID_KIND');
    e.code = 'INVALID_KIND';
    throw e;
  }
  const pid = String(propertyId || '').trim();
  const cid = String(clientdetailId || '').trim();
  const oid = String(operatorId || '').trim();
  if (!pid || !cid || !oid) {
    const e = new Error('MISSING_IDS');
    e.code = 'MISSING_IDS';
    throw e;
  }

  const [[prop]] = await pool.query(
    'SELECT clientdetail_id AS cd, operator_id AS op FROM cln_property WHERE id = ? LIMIT 1',
    [pid]
  );
  if (!prop) {
    const e = new Error('PROPERTY_NOT_FOUND');
    e.code = 'PROPERTY_NOT_FOUND';
    throw e;
  }
  /* KIND_CLIENT_OP: property must already belong to this client. KIND_OP_CLIENT: operator requests bind — row may still be NULL / old until approved (defer binding). */
  if (kid === KIND_CLIENT_OP && String(prop.cd || '') !== cid) {
    const e = new Error('PROPERTY_CLIENT_MISMATCH');
    e.code = 'PROPERTY_CLIENT_MISMATCH';
    throw e;
  }
  if (kid === KIND_OP_CLIENT) {
    const po = prop.op != null ? String(prop.op).trim() : '';
    if (po !== oid) {
      const e = new Error('PROPERTY_OPERATOR_MISMATCH');
      e.code = 'PROPERTY_OPERATOR_MISMATCH';
      throw e;
    }
  }

  if (supersedePending) {
    await pool.query(
      `UPDATE cln_property_link_request
       SET status = 'rejected', decided_at = NOW(3), remarks = 'superseded'
       WHERE property_id = ? AND kind = ? AND status = 'pending'`,
      [pid, kid]
    );
  }

  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO cln_property_link_request
      (id, kind, property_id, clientdetail_id, operator_id, status, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, NOW(3))`,
    [id, kid, pid, cid, oid, payloadJson != null ? JSON.stringify(payloadJson) : null]
  );
  return { id, kind: kid, propertyId: pid, clientdetailId: cid, operatorId: oid, status: 'pending' };
}

function mapRequestRow(r) {
  let payload = null;
  if (r.payload_json) {
    try {
      payload = JSON.parse(r.payload_json);
    } catch {
      payload = null;
    }
  }
  const clientName = r.client_fullname != null ? String(r.client_fullname).trim() : '';
  const clientEmail = r.client_email != null ? String(r.client_email).trim() : '';
  return {
    id: String(r.id),
    kind: String(r.kind),
    propertyId: String(r.property_id),
    clientdetailId: String(r.clientdetail_id),
    operatorId: String(r.operator_id),
    status: String(r.status),
    payload,
    remarks: r.remarks != null ? String(r.remarks) : '',
    decidedByEmail: r.decided_by_email != null ? String(r.decided_by_email) : '',
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    propertyName: r.property_name != null ? String(r.property_name) : '',
    unitName: r.unit_name != null ? String(r.unit_name) : '',
    address: r.address != null ? String(r.address) : '',
    clientName,
    clientEmail,
  };
}

async function listPropertyLinkRequestsForClientdetail(clientdetailId, { status = 'pending', kind = null } = {}) {
  await ensurePropertyLinkRequestTable();
  const cid = String(clientdetailId || '').trim();
  if (!cid) return [];
  const st = String(status || 'pending').trim();
  const kindF = kind ? String(kind).trim() : '';
  let sql = `SELECT r.id, r.kind, r.property_id, r.clientdetail_id, r.operator_id, r.status, r.payload_json, r.remarks,
            r.decided_by_email, r.created_at, r.decided_at,
            p.property_name, p.unit_name, p.address,
            cd.fullname AS client_fullname, cd.email AS client_email
     FROM cln_property_link_request r
     INNER JOIN cln_property p ON p.id = r.property_id
     LEFT JOIN cln_clientdetail cd ON cd.id = r.clientdetail_id
     WHERE r.clientdetail_id = ? AND r.status = ?`;
  const params = [cid, st];
  if (kindF) {
    sql += ' AND r.kind = ?';
    params.push(kindF);
  }
  sql += ' ORDER BY r.created_at DESC';
  const [rows] = await pool.query(sql, params);
  return (rows || []).map(mapRequestRow);
}

async function listPropertyLinkRequestsForOperator(
  operatorId,
  { status = 'pending', kind = null, limit = 200 } = {}
) {
  await ensurePropertyLinkRequestTable();
  const oid = String(operatorId || '').trim();
  if (!oid) return [];
  const st = String(status || 'pending').trim();
  const kindF = kind ? String(kind).trim() : '';
  const lim = Math.min(500, Math.max(1, Number(limit) || 200));
  let sql = `SELECT r.id, r.kind, r.property_id, r.clientdetail_id, r.operator_id, r.status, r.payload_json, r.remarks,
            r.decided_by_email, r.created_at, r.decided_at,
            p.property_name, p.unit_name, p.address,
            cd.fullname AS client_fullname, cd.email AS client_email
     FROM cln_property_link_request r
     INNER JOIN cln_property p ON p.id = r.property_id
     LEFT JOIN cln_clientdetail cd ON cd.id = r.clientdetail_id
     WHERE r.operator_id = ? AND r.status = ?`;
  const params = [oid, st];
  if (kindF) {
    sql += ' AND r.kind = ?';
    params.push(kindF);
  }
  sql += ' ORDER BY r.created_at DESC LIMIT ?';
  params.push(lim);
  const [rows] = await pool.query(sql, params);
  return (rows || []).map(mapRequestRow);
}

/** Per-status counts for operator portal tabs (same filters as list). */
async function countPropertyLinkRequestsForOperator(operatorId, { kind = null } = {}) {
  await ensurePropertyLinkRequestTable();
  const oid = String(operatorId || '').trim();
  if (!oid) return { pending: 0, approved: 0, rejected: 0 };
  const kindF = kind ? String(kind).trim() : '';
  const base = 'FROM cln_property_link_request r WHERE r.operator_id = ?';
  const paramsBase = [oid];
  let kindClause = '';
  if (kindF) {
    kindClause = ' AND r.kind = ?';
    paramsBase.push(kindF);
  }
  const out = { pending: 0, approved: 0, rejected: 0 };
  for (const s of ['pending', 'approved', 'rejected']) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS n ${base}${kindClause} AND r.status = ?`,
      [...paramsBase, s]
    );
    out[s] = Number(rows[0]?.n || 0);
  }
  return out;
}

async function approvePropertyLinkRequest({ requestId, decidedByEmail, getClnAccountProviderForOperator }) {
  await ensurePropertyLinkRequestTable();
  const rid = String(requestId || '').trim();
  const email = String(decidedByEmail || '').trim().toLowerCase();
  const [[row]] = await pool.query('SELECT * FROM cln_property_link_request WHERE id = ? LIMIT 1', [rid]);
  if (!row) {
    const e = new Error('REQUEST_NOT_FOUND');
    e.code = 'REQUEST_NOT_FOUND';
    throw e;
  }
  if (String(row.status) !== 'pending') {
    const e = new Error('REQUEST_NOT_PENDING');
    e.code = 'REQUEST_NOT_PENDING';
    throw e;
  }

  const kind = String(row.kind);
  const pid = String(row.property_id);
  const cid = String(row.clientdetail_id);
  const oid = String(row.operator_id);

  if (kind === KIND_CLIENT_OP) {
    await pool.query('UPDATE cln_property SET operator_id = ?, updated_at = NOW(3) WHERE id = ?', [oid, pid]);
    /** Same as operator→client binding: `cln_client_operator` drives Operator → Contacts → Clients tab. */
    await ensureClnClientOperatorJunction(cid, oid);
    await assignClnOperatorToPropertySmartDoorRows(pid, cid, oid);
    /** Client TTLock account owns the devices — merge /lock/list so gateway_id + hasgateway match TTLock (operator TTLock alone cannot see these rows). */
    try {
      const sd = require('../smartdoorsetting/smartdoorsetting.service');
      await sd.syncSmartDoorStatusFromTtlock({ kind: 'cln_client', clnClientId: cid });
    } catch (e) {
      console.warn('[cleanlemon] syncSmartDoorAfterClientOperatorApproval', e?.message || e);
    }
    await pushAccountingAfterLinkApproval(getClnAccountProviderForOperator, cid, oid);
  } else if (kind === KIND_OP_CLIENT) {
    const hasCd = await databaseHasColumn('cln_property', 'clientdetail_id');
    if (!hasCd) {
      const e = new Error('CLIENTDETAIL_COLUMN_MISSING');
      e.code = 'CLIENTDETAIL_COLUMN_MISSING';
      throw e;
    }
    const hasLegacyClientId = await databaseHasColumn('cln_property', 'client_id');
    if (hasLegacyClientId) {
      await pool.query(
        'UPDATE cln_property SET clientdetail_id = ?, client_id = ?, updated_at = NOW(3) WHERE id = ?',
        [cid, cid, pid]
      );
    } else {
      await pool.query('UPDATE cln_property SET clientdetail_id = ?, updated_at = NOW(3) WHERE id = ?', [cid, pid]);
    }
    await ensureClnClientOperatorJunction(cid, oid);
    await pushAccountingAfterLinkApproval(getClnAccountProviderForOperator, cid, oid);
  }

  await pool.query(
    `UPDATE cln_property_link_request
     SET status = 'approved', decided_at = NOW(3), decided_by_email = ?
     WHERE id = ?`,
    [email || null, rid]
  );
  return { ok: true };
}

async function rejectPropertyLinkRequest({ requestId, decidedByEmail, remarks }) {
  await ensurePropertyLinkRequestTable();
  const rid = String(requestId || '').trim();
  const [[row]] = await pool.query('SELECT status FROM cln_property_link_request WHERE id = ? LIMIT 1', [rid]);
  if (!row) {
    const e = new Error('REQUEST_NOT_FOUND');
    e.code = 'REQUEST_NOT_FOUND';
    throw e;
  }
  if (String(row.status) !== 'pending') {
    const e = new Error('REQUEST_NOT_PENDING');
    e.code = 'REQUEST_NOT_PENDING';
    throw e;
  }
  await pool.query(
    `UPDATE cln_property_link_request
     SET status = 'rejected', decided_at = NOW(3), decided_by_email = ?, remarks = ?
     WHERE id = ?`,
    [String(decidedByEmail || '').trim().toLowerCase() || null, remarks != null ? String(remarks).slice(0, 2000) : null, rid]
  );
  return { ok: true };
}

module.exports = {
  KIND_CLIENT_OP,
  KIND_OP_CLIENT,
  ensurePropertyLinkRequestTable,
  createPropertyLinkRequest,
  listPropertyLinkRequestsForClientdetail,
  listPropertyLinkRequestsForOperator,
  countPropertyLinkRequestsForOperator,
  approvePropertyLinkRequest,
  rejectPropertyLinkRequest,
  assignClnOperatorToPropertySmartDoorRows,
  clearClnOperatorFromPropertySmartDoorRows,
  ensureClnClientOperatorJunction,
};
