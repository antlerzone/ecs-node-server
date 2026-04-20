/**
 * Audit log for remote unlock events (Node → TTLock). Table: lockdetail_log.
 */

const { randomUUID } = require('crypto');
const pool = require('../../config/db');

/**
 * @param {{ lockdetailId: string, actorEmail: string, portalSource?: string|null, jobId?: string|null }} opts
 */
async function insertLockdetailRemoteUnlockLog(opts) {
  const lockdetailId = String(opts.lockdetailId || '').trim();
  const actorEmail = String(opts.actorEmail || '').trim().toLowerCase() || '(unknown)';
  if (!lockdetailId) return;
  const portalSource = opts.portalSource != null ? String(opts.portalSource).trim().slice(0, 40) : null;
  const jobId = opts.jobId != null && String(opts.jobId).trim() ? String(opts.jobId).trim().slice(0, 36) : null;
  const id = randomUUID();
  await pool.query(
    `INSERT INTO lockdetail_log (id, lockdetail_id, actor_email, open_method, portal_source, job_id, ok)
     VALUES (?, ?, ?, 'web_portal_remote', ?, ?, 1)`,
    [id, lockdetailId, actorEmail, portalSource, jobId]
  );
}

/**
 * Coliving operatordetail id + TTLock external lock id → lockdetail.id
 */
async function findLockdetailIdByColivingClientIdAndTtlockLockId(clientId, ttLockId) {
  const cid = String(clientId || '').trim();
  const lid = Number(ttLockId);
  if (!cid || !Number.isFinite(lid)) return null;
  const [rows] = await pool.query(
    'SELECT id FROM lockdetail WHERE client_id = ? AND lockid = ? LIMIT 1',
    [cid, lid]
  );
  return rows?.[0]?.id ? String(rows[0].id) : null;
}

/**
 * Portal (operator/client): paginated unlock audit for one lockdetail row.
 * @param {{ lockdetailId: string, utcFrom?: string|null, utcTo?: string|null, page?: number, pageSize?: number }} opts
 */
async function listLockdetailLogsForPortal({ lockdetailId, utcFrom, utcTo, page = 1, pageSize = 50 } = {}) {
  const lid = String(lockdetailId || '').trim();
  if (!lid) return { items: [], total: 0, page: 1, pageSize: 50 };
  const p = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 50));
  const offset = (p - 1) * ps;
  const where = ['l.lockdetail_id = ?'];
  const params = [lid];
  if (utcFrom) {
    where.push('l.created_at >= ?');
    params.push(String(utcFrom));
  }
  if (utcTo) {
    where.push('l.created_at <= ?');
    params.push(String(utcTo));
  }
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS c FROM lockdetail_log l WHERE ${where.join(' AND ')}`,
    params
  );
  const total = Number(countRows?.[0]?.c || 0);
  const [rows] = await pool.query(
    `SELECT l.id, l.lockdetail_id AS lockdetailId, l.created_at AS createdAt, l.actor_email AS actorEmail,
            l.open_method AS openMethod, l.portal_source AS portalSource, l.job_id AS jobId,
            ld.lockalias AS lockAlias, ld.lockname AS lockName, ld.lockid AS ttlockLockId
     FROM lockdetail_log l
     LEFT JOIN lockdetail ld ON ld.id = l.lockdetail_id
     WHERE ${where.join(' AND ')}
     ORDER BY l.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, ps, offset]
  );
  return { items: rows || [], total, page: p, pageSize: ps };
}

module.exports = {
  insertLockdetailRemoteUnlockLog,
  findLockdetailIdByColivingClientIdAndTtlockLockId,
  listLockdetailLogsForPortal,
};
