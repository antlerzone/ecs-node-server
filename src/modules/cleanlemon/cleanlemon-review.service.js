/**
 * Cleanlemons cln_review — public aggregates, create review, enrich operator lookup.
 */

const crypto = require('crypto');
const pool = require('../../config/db');
const { resolveClnOperatordetailTable } = require('../../config/clnOperatordetailTable');

let _companyTableCache = null;
async function getClnCompanyTable() {
  if (_companyTableCache) return _companyTableCache;
  try {
    _companyTableCache = await resolveClnOperatordetailTable();
  } catch {
    _companyTableCache = 'cln_operatordetail';
  }
  return _companyTableCache;
}

async function databaseHasTable(tableName) {
  const t = String(tableName || '').trim();
  if (!t) return false;
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
    [t]
  );
  return rows.length > 0;
}

async function resolvePortalAccountId(email) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e) return null;
  const [rows] = await pool.query(
    'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [e]
  );
  return rows[0]?.id ? String(rows[0].id) : null;
}

async function resolveClientdetailIdForPortalEmail(email) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e) return null;
  const [byPortal] = await pool.query(
    'SELECT id FROM cln_clientdetail WHERE portal_account_id = (SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1) LIMIT 1',
    [e]
  );
  if (byPortal[0]?.id) return String(byPortal[0].id);
  const [byEmail] = await pool.query('SELECT id FROM cln_clientdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1', [e]);
  return byEmail[0]?.id ? String(byEmail[0].id) : null;
}

function safeJsonArray(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v;
  try {
    const x = JSON.parse(String(v));
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
}

function isScheduleCompletedStatus(st) {
  const s = String(st || '').toLowerCase();
  return s.includes('complete') || s === 'done';
}

/**
 * @param {string[]} operatorIds
 * @returns {Promise<Map<string, { averageStars: number|null, reviewCount: number }>>}
 */
async function getClientToOperatorStatsForOperatorIds(operatorIds) {
  const out = new Map();
  if (!(await databaseHasTable('cln_review'))) return out;
  const ids = [...new Set((operatorIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) return out;
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT subject_operator_id AS oid,
            COUNT(*) AS cnt,
            AVG(stars) AS avg_stars
     FROM cln_review
     WHERE review_kind = 'client_to_operator'
       AND subject_operator_id IN (${placeholders})
     GROUP BY subject_operator_id`,
    ids
  );
  for (const r of rows || []) {
    const oid = r.oid != null ? String(r.oid) : '';
    if (!oid) continue;
    const cnt = Number(r.cnt) || 0;
    const avg = r.avg_stars != null ? Math.round(Number(r.avg_stars) * 10) / 10 : null;
    out.set(oid, { averageStars: cnt ? avg : null, reviewCount: cnt });
  }
  return out;
}

async function enrichOperatorLookupItemsWithReviewStats(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return list;
  if (!(await databaseHasTable('cln_review'))) {
    return list.map((x) => ({
      ...x,
      clientToOperatorReviewCount: 0,
      clientToOperatorAverageStars: null,
    }));
  }
  const stats = await getClientToOperatorStatsForOperatorIds(list.map((i) => i.id));
  return list.map((x) => {
    const s = stats.get(String(x.id)) || { averageStars: null, reviewCount: 0 };
    return {
      ...x,
      clientToOperatorReviewCount: s.reviewCount,
      clientToOperatorAverageStars: s.averageStars,
    };
  });
}

async function getPublicOperatorProfile(operatordetailId) {
  const oid = String(operatordetailId || '').trim();
  if (!oid) return { ok: false, reason: 'MISSING_ID' };
  if (!(await databaseHasTable('cln_review'))) {
    const ct = await getClnCompanyTable();
    const [[co]] = await pool.query(
      `SELECT id, COALESCE(name,'') AS name, COALESCE(email,'') AS email FROM \`${ct}\` WHERE id = ? LIMIT 1`,
      [oid]
    );
    if (!co) return { ok: false, reason: 'OPERATOR_NOT_FOUND' };
    return {
      ok: true,
      operator: { id: String(co.id), name: String(co.name || ''), email: String(co.email || '') },
      summary: { reviewCount: 0, averageStars: null },
      reviews: [],
    };
  }
  const ct = await getClnCompanyTable();
  const [[co]] = await pool.query(
    `SELECT id, COALESCE(name,'') AS name, COALESCE(email,'') AS email FROM \`${ct}\` WHERE id = ? LIMIT 1`,
    [oid]
  );
  if (!co) return { ok: false, reason: 'OPERATOR_NOT_FOUND' };

  const [agg] = await pool.query(
    `SELECT COUNT(*) AS cnt, AVG(stars) AS avg_stars FROM cln_review
     WHERE review_kind = 'client_to_operator' AND subject_operator_id = ?`,
    [oid]
  );
  const cnt = Number(agg[0]?.cnt) || 0;
  const avgStars = cnt && agg[0]?.avg_stars != null ? Math.round(Number(agg[0].avg_stars) * 10) / 10 : null;

  const [revRows] = await pool.query(
    `SELECT r.id, r.stars, r.remark, r.evidence_json, r.created_at
     FROM cln_review r
     WHERE r.review_kind = 'client_to_operator' AND r.subject_operator_id = ?
     ORDER BY r.created_at DESC
     LIMIT 200`,
    [oid]
  );
  const reviews = (revRows || []).map((r) => ({
    id: String(r.id),
    stars: Number(r.stars) || 0,
    remark: r.remark || '',
    evidenceUrls: safeJsonArray(r.evidence_json).map((u) => String(u)),
    createdAt: r.created_at,
  }));

  return {
    ok: true,
    operator: { id: String(co.id), name: String(co.name || ''), email: String(co.email || '') },
    summary: { reviewCount: cnt, averageStars: avgStars },
    reviews,
  };
}

function jwtAllowsOperator(cleanlemonsJwt, operatorId) {
  const oid = String(operatorId || '').trim();
  if (!oid) return false;
  const choices = Array.isArray(cleanlemonsJwt?.operatorChoices) ? cleanlemonsJwt.operatorChoices : [];
  return choices.some((c) => String(c?.operatorId || '').trim() === oid);
}

async function getPublicOperatorDirectory({ limit = 200, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const ct = await getClnCompanyTable();
  const [ops] = await pool.query(
    `SELECT id, COALESCE(name,'') AS name, COALESCE(email,'') AS email
     FROM \`${ct}\`
     ORDER BY name ASC, id ASC
     LIMIT ? OFFSET ?`,
    [lim, off]
  );
  const items = (ops || []).map((r) => ({
    id: String(r.id),
    name: String(r.name || ''),
    email: String(r.email || ''),
  }));
  if (!(await databaseHasTable('cln_review'))) {
    return {
      ok: true,
      items: items.map((x) => ({ ...x, clientToOperatorReviewCount: 0, clientToOperatorAverageStars: null })),
    };
  }
  const stats = await getClientToOperatorStatsForOperatorIds(items.map((i) => i.id));
  return {
    ok: true,
    items: items.map((x) => {
      const s = stats.get(x.id) || { averageStars: null, reviewCount: 0 };
      return {
        ...x,
        clientToOperatorReviewCount: s.reviewCount,
        clientToOperatorAverageStars: s.averageStars,
      };
    }),
  };
}

async function loadSchedulePropertyRow(scheduleId) {
  const sid = String(scheduleId || '').trim();
  if (!sid) return null;
  const [rows] = await pool.query(
    `SELECT s.id, s.status, s.property_id, p.operator_id, p.clientdetail_id
     FROM cln_schedule s
     LEFT JOIN cln_property p ON p.id = s.property_id
     WHERE s.id = ?
     LIMIT 1`,
    [sid]
  );
  return rows[0] || null;
}

async function resolveEmployeeIdFromJunctionOrEmployee(contactRef, operatorId) {
  const ref = String(contactRef || '').trim();
  const oid = String(operatorId || '').trim();
  if (!ref || !oid) return null;
  const [[byJunction]] = await pool.query(
    'SELECT employee_id FROM cln_employee_operator WHERE id = ? AND operator_id = ? LIMIT 1',
    [ref, oid]
  );
  if (byJunction?.employee_id) return String(byJunction.employee_id);
  const [[byEmp]] = await pool.query(
    'SELECT id FROM cln_employeedetail WHERE id = ? LIMIT 1',
    [ref]
  );
  return byEmp?.id ? String(byEmp.id) : null;
}

/**
 * @param {{ jwtEmail: string, body: object }} args
 */
async function createClnReview({ jwtEmail, cleanlemonsJwt, body }) {
  const email = String(jwtEmail || '')
    .trim()
    .toLowerCase();
  if (!email) return { ok: false, reason: 'UNAUTHORIZED' };
  if (!(await databaseHasTable('cln_review'))) {
    return { ok: false, reason: 'REVIEW_TABLE_MISSING' };
  }
  const reviewerId = await resolvePortalAccountId(email);
  if (!reviewerId) return { ok: false, reason: 'PORTAL_ACCOUNT_NOT_FOUND' };

  const reviewKind = String(body?.reviewKind || body?.review_kind || '').trim();
  const stars = Math.round(Number(body?.stars));
  const remark = body?.remark != null ? String(body.remark) : '';
  const evidenceUrls = Array.isArray(body?.evidenceUrls)
    ? body.evidenceUrls.map((u) => String(u).trim()).filter(Boolean)
    : Array.isArray(body?.evidence_urls)
      ? body.evidence_urls.map((u) => String(u).trim()).filter(Boolean)
      : [];
  const scheduleId = body?.scheduleId != null ? String(body.scheduleId).trim() : '';
  const operatorIdBody = String(body?.operatorId || body?.operator_id || '').trim();

  if (!['client_to_operator', 'operator_to_client', 'operator_to_staff'].includes(reviewKind)) {
    return { ok: false, reason: 'INVALID_REVIEW_KIND' };
  }
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
    return { ok: false, reason: 'INVALID_STARS' };
  }

  const id = crypto.randomUUID();
  const evidenceJson = JSON.stringify(evidenceUrls);

  if (reviewKind === 'client_to_operator') {
    if (!scheduleId) return { ok: false, reason: 'MISSING_SCHEDULE_ID' };
    const row = await loadSchedulePropertyRow(scheduleId);
    if (!row?.property_id) return { ok: false, reason: 'SCHEDULE_NOT_FOUND' };
    if (!isScheduleCompletedStatus(row.status)) return { ok: false, reason: 'JOB_NOT_COMPLETED' };
    const cdId = await resolveClientdetailIdForPortalEmail(email);
    if (!cdId || String(row.clientdetail_id || '').trim() !== cdId) {
      return { ok: false, reason: 'NOT_YOUR_PROPERTY' };
    }
    const opOnProp = String(row.operator_id || '').trim();
    if (!opOnProp) return { ok: false, reason: 'NO_OPERATOR_ON_PROPERTY' };
    await pool.query(
      `INSERT INTO cln_review (id, review_kind, operator_id, schedule_id, stars, remark, evidence_json,
        reviewer_portal_account_id, subject_operator_id, subject_client_id, subject_employee_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        reviewKind,
        opOnProp,
        scheduleId,
        stars,
        remark,
        evidenceJson,
        reviewerId,
        opOnProp,
        cdId,
        null,
      ]
    );
    return { ok: true, id };
  }

  if (reviewKind === 'operator_to_client') {
    if (!scheduleId) return { ok: false, reason: 'MISSING_SCHEDULE_ID' };
    if (!operatorIdBody) return { ok: false, reason: 'MISSING_OPERATOR_ID' };
    const row = await loadSchedulePropertyRow(scheduleId);
    if (!row?.property_id) return { ok: false, reason: 'SCHEDULE_NOT_FOUND' };
    if (!isScheduleCompletedStatus(row.status)) return { ok: false, reason: 'JOB_NOT_COMPLETED' };
    const opOnProp = String(row.operator_id || '').trim();
    if (opOnProp !== operatorIdBody) return { ok: false, reason: 'OPERATOR_MISMATCH' };
    const clientDetailId = row.clientdetail_id != null ? String(row.clientdetail_id).trim() : '';
    if (!clientDetailId) return { ok: false, reason: 'NO_CLIENT_ON_PROPERTY' };
    if (!jwtAllowsOperator(cleanlemonsJwt, operatorIdBody)) {
      const ct = await getClnCompanyTable();
      const [[opRow2]] = await pool.query(
        `SELECT 1 AS ok FROM \`${ct}\` od
         INNER JOIN portal_account pa ON LOWER(TRIM(pa.email)) = LOWER(TRIM(od.email))
         WHERE od.id = ? AND LOWER(TRIM(pa.email)) = ? LIMIT 1`,
        [operatorIdBody, email]
      );
      if (!opRow2?.ok) return { ok: false, reason: 'OPERATOR_NOT_AUTHORIZED' };
    }
    await pool.query(
      `INSERT INTO cln_review (id, review_kind, operator_id, schedule_id, stars, remark, evidence_json,
        reviewer_portal_account_id, subject_operator_id, subject_client_id, subject_employee_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        reviewKind,
        operatorIdBody,
        scheduleId,
        stars,
        remark,
        evidenceJson,
        reviewerId,
        null,
        clientDetailId,
        null,
      ]
    );
    return { ok: true, id };
  }

  if (reviewKind === 'operator_to_staff') {
    if (!operatorIdBody) return { ok: false, reason: 'MISSING_OPERATOR_ID' };
    const empRef = String(body?.employeeDetailId || body?.employee_id || body?.contactId || '').trim();
    if (!empRef) return { ok: false, reason: 'MISSING_EMPLOYEE' };
    const employeeId = await resolveEmployeeIdFromJunctionOrEmployee(empRef, operatorIdBody);
    if (!employeeId) return { ok: false, reason: 'EMPLOYEE_NOT_FOUND' };
    if (!jwtAllowsOperator(cleanlemonsJwt, operatorIdBody)) {
      const ct = await getClnCompanyTable();
      const [[opRow2]] = await pool.query(
        `SELECT 1 AS ok FROM \`${ct}\` od
         INNER JOIN portal_account pa ON LOWER(TRIM(pa.email)) = LOWER(TRIM(od.email))
         WHERE od.id = ? AND LOWER(TRIM(pa.email)) = ? LIMIT 1`,
        [operatorIdBody, email]
      );
      if (!opRow2?.ok) return { ok: false, reason: 'OPERATOR_NOT_AUTHORIZED' };
    }
    await pool.query(
      `INSERT INTO cln_review (id, review_kind, operator_id, schedule_id, stars, remark, evidence_json,
        reviewer_portal_account_id, subject_operator_id, subject_client_id, subject_employee_id)
       VALUES (?,?,?,?,?,?,?,?,NULL,NULL,?)`,
      [id, reviewKind, operatorIdBody, null, stars, remark, evidenceJson, reviewerId, employeeId]
    );
    return { ok: true, id };
  }

  return { ok: false, reason: 'INVALID_REVIEW_KIND' };
}

module.exports = {
  enrichOperatorLookupItemsWithReviewStats,
  getPublicOperatorProfile,
  getPublicOperatorDirectory,
  createClnReview,
  getClientToOperatorStatsForOperatorIds,
};
