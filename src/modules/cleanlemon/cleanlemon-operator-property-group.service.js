/**
 * Operator portal: property groups (independent of client `cln_property_group`).
 * Tables: cln_operator_property_group, cln_operator_property_group_property.
 */

const crypto = require('crypto');
const pool = require('../../config/db');

async function tablesExist() {
  const [[a]] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_operator_property_group'"
  );
  const [[b]] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_operator_property_group_property'"
  );
  return Number(a?.n) > 0 && Number(b?.n) > 0;
}

async function assertOperatorOwnsProperty(operatorId, propertyId) {
  const oid = String(operatorId || '').trim();
  const pid = String(propertyId || '').trim();
  const [[r]] = await pool.query(
    'SELECT id FROM cln_property WHERE id = ? AND operator_id = ? LIMIT 1',
    [pid, oid]
  );
  if (!r) {
    const e = new Error('OPERATOR_PROPERTY_MISMATCH');
    e.code = 'OPERATOR_PROPERTY_MISMATCH';
    throw e;
  }
}

async function assertGroupBelongsToOperator(operatorId, groupId) {
  const oid = String(operatorId || '').trim();
  const gid = String(groupId || '').trim();
  const [[r]] = await pool.query(
    'SELECT id FROM cln_operator_property_group WHERE id = ? AND operator_id = ? LIMIT 1',
    [gid, oid]
  );
  if (!r) {
    const e = new Error('GROUP_NOT_FOUND');
    e.code = 'GROUP_NOT_FOUND';
    throw e;
  }
}

/**
 * @param {string} operatorId
 */
async function listGroupsForOperatorPortal(operatorId) {
  if (!(await tablesExist())) return [];
  const oid = String(operatorId || '').trim();
  if (!oid) return [];
  const [rows] = await pool.query(
    `SELECT g.id, g.name,
            (SELECT COUNT(*) FROM cln_operator_property_group_property p WHERE p.group_id = g.id) AS property_count
     FROM cln_operator_property_group g
     WHERE g.operator_id = ?
     ORDER BY g.name ASC, g.id ASC`,
    [oid]
  );
  return (rows || []).map((r) => ({
    id: String(r.id),
    name: String(r.name || ''),
    propertyCount: Number(r.property_count || 0),
  }));
}

/**
 * @param {{ operatorId: string, name: string }}
 */
async function createOperatorPropertyGroup({ operatorId, name }) {
  if (!(await tablesExist())) {
    const e = new Error('GROUP_FEATURE_UNAVAILABLE');
    e.code = 'GROUP_FEATURE_UNAVAILABLE';
    throw e;
  }
  const oid = String(operatorId || '').trim();
  const nm = String(name || '').trim();
  if (!oid || !nm) {
    const e = new Error('MISSING_FIELDS');
    e.code = 'MISSING_FIELDS';
    throw e;
  }
  const id = crypto.randomUUID();
  const now = new Date();
  await pool.query(
    'INSERT INTO cln_operator_property_group (id, operator_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, oid, nm, now, now]
  );
  return { id, name: nm, propertyCount: 0 };
}

/**
 * @param {{ operatorId: string, groupId: string }}
 */
async function getGroupDetailForOperator({ operatorId, groupId }) {
  if (!(await tablesExist())) {
    const e = new Error('GROUP_NOT_FOUND');
    e.code = 'GROUP_NOT_FOUND';
    throw e;
  }
  const oid = String(operatorId || '').trim();
  const gid = String(groupId || '').trim();
  if (!oid || !gid) {
    const e = new Error('MISSING_FIELDS');
    e.code = 'MISSING_FIELDS';
    throw e;
  }
  const [[g]] = await pool.query(
    'SELECT id, name FROM cln_operator_property_group WHERE id = ? AND operator_id = ? LIMIT 1',
    [gid, oid]
  );
  if (!g) {
    const e = new Error('GROUP_NOT_FOUND');
    e.code = 'GROUP_NOT_FOUND';
    throw e;
  }
  const [props] = await pool.query(
    `SELECT p.id, p.name, p.address
     FROM cln_operator_property_group_property gp
     INNER JOIN cln_property p ON p.id = gp.property_id
     WHERE gp.group_id = ?
     ORDER BY p.name ASC, p.id ASC`,
    [gid]
  );
  return {
    id: String(g.id),
    name: String(g.name || ''),
    properties: (props || []).map((r) => ({
      id: String(r.id),
      name: String(r.name || ''),
      address: r.address != null ? String(r.address) : '',
    })),
  };
}

/**
 * Add properties to a group; removes each property from any other operator group first (same operator).
 * @param {{ operatorId: string, groupId: string, propertyIds: string[] }}
 */
async function addPropertiesToOperatorGroup({ operatorId, groupId, propertyIds }) {
  if (!(await tablesExist())) {
    const e = new Error('GROUP_FEATURE_UNAVAILABLE');
    e.code = 'GROUP_FEATURE_UNAVAILABLE';
    throw e;
  }
  const oid = String(operatorId || '').trim();
  const gid = String(groupId || '').trim();
  const ids = Array.isArray(propertyIds) ? propertyIds.map((x) => String(x || '').trim()).filter(Boolean) : [];
  if (!oid || !gid || !ids.length) {
    const e = new Error('MISSING_FIELDS');
    e.code = 'MISSING_FIELDS';
    throw e;
  }
  await assertGroupBelongsToOperator(oid, gid);
  for (const pid of ids) {
    await assertOperatorOwnsProperty(oid, pid);
  }
  const now = new Date();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `DELETE ogp FROM cln_operator_property_group_property ogp
       INNER JOIN cln_operator_property_group og ON og.id = ogp.group_id
       WHERE og.operator_id = ? AND ogp.property_id IN (${ids.map(() => '?').join(',')})`,
      [oid, ...ids]
    );
    if (ids.length) {
      const ph = ids.map(() => '(?, ?, ?)').join(', ');
      const flat = [];
      for (const pid of ids) {
        flat.push(gid, pid, now);
      }
      await conn.query(
        `INSERT INTO cln_operator_property_group_property (group_id, property_id, created_at) VALUES ${ph}`,
        flat
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return { ok: true };
}

/**
 * @param {{ operatorId: string, groupId: string, propertyId: string }}
 */
async function removePropertyFromOperatorGroup({ operatorId, groupId, propertyId }) {
  if (!(await tablesExist())) {
    const e = new Error('GROUP_FEATURE_UNAVAILABLE');
    e.code = 'GROUP_FEATURE_UNAVAILABLE';
    throw e;
  }
  const oid = String(operatorId || '').trim();
  const gid = String(groupId || '').trim();
  const pid = String(propertyId || '').trim();
  if (!oid || !gid || !pid) {
    const e = new Error('MISSING_FIELDS');
    e.code = 'MISSING_FIELDS';
    throw e;
  }
  await assertGroupBelongsToOperator(oid, gid);
  await pool.query(
    'DELETE FROM cln_operator_property_group_property WHERE group_id = ? AND property_id = ? LIMIT 1',
    [gid, pid]
  );
  return { ok: true };
}

/**
 * @param {{ operatorId: string, groupId: string }}
 */
async function deleteOperatorPropertyGroup({ operatorId, groupId }) {
  if (!(await tablesExist())) {
    const e = new Error('GROUP_FEATURE_UNAVAILABLE');
    e.code = 'GROUP_FEATURE_UNAVAILABLE';
    throw e;
  }
  const oid = String(operatorId || '').trim();
  const gid = String(groupId || '').trim();
  if (!oid || !gid) {
    const e = new Error('MISSING_FIELDS');
    e.code = 'MISSING_FIELDS';
    throw e;
  }
  await assertGroupBelongsToOperator(oid, gid);
  await pool.query('DELETE FROM cln_operator_property_group WHERE id = ? AND operator_id = ? LIMIT 1', [gid, oid]);
  return { ok: true };
}

module.exports = {
  tablesExist,
  listGroupsForOperatorPortal,
  createOperatorPropertyGroup,
  getGroupDetailForOperator,
  addPropertiesToOperatorGroup,
  removePropertyFromOperatorGroup,
  deleteOperatorPropertyGroup,
};
