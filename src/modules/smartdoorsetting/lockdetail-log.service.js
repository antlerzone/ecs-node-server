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

module.exports = {
  insertLockdetailRemoteUnlockLog,
  findLockdetailIdByColivingClientIdAndTtlockLockId,
};
