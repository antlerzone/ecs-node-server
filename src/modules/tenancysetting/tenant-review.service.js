const { randomUUID } = require('crypto');
const pool = require('../../config/db');

function clampScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
}

function nonNegInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function safeJsonArray(v) {
  return Array.isArray(v) ? v : [];
}

function parseProfileAvatar(profileRaw) {
  if (!profileRaw) return null;
  try {
    const p = typeof profileRaw === 'string' ? JSON.parse(profileRaw) : profileRaw;
    const url = p?.avatar_url;
    return url && String(url).trim() ? String(url).trim() : null;
  } catch {
    return null;
  }
}

let ensureCommunicationScoreColumnPromise = null;
let ensureOwnerReviewTablePromise = null;
async function ensureCommunicationScoreColumn() {
  if (!ensureCommunicationScoreColumnPromise) {
    ensureCommunicationScoreColumnPromise = (async () => {
      const [rows] = await pool.query(
        `SELECT COUNT(*) AS c
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_review' AND COLUMN_NAME = 'communication_score'`
      );
      if (Number(rows?.[0]?.c || 0) > 0) return;
      try {
        await pool.query('ALTER TABLE tenant_review ADD COLUMN communication_score decimal(4,2) NOT NULL DEFAULT 0 AFTER unit_care_score');
      } catch (e) {
        const msg = String(e?.sqlMessage || e?.message || '');
        if (e?.code === 'ER_DUP_FIELDNAME' || msg.includes('Duplicate column')) return;
        throw e;
      }
    })().catch((err) => {
      ensureCommunicationScoreColumnPromise = null;
      throw err;
    });
  }
  return ensureCommunicationScoreColumnPromise;
}

async function ensureOwnerReviewTable() {
  if (!ensureOwnerReviewTablePromise) {
    ensureOwnerReviewTablePromise = (async () => {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS owner_review (
          id varchar(36) NOT NULL,
          owner_id varchar(36) NOT NULL,
          owner_email varchar(255) DEFAULT NULL,
          client_id varchar(36) NOT NULL,
          operator_id varchar(36) DEFAULT NULL,
          communication_score decimal(4,2) NOT NULL DEFAULT 0,
          responsibility_score decimal(4,2) NOT NULL DEFAULT 0,
          cooperation_score decimal(4,2) NOT NULL DEFAULT 0,
          overall_score decimal(4,2) NOT NULL DEFAULT 0,
          comment text DEFAULT NULL,
          evidence_json json DEFAULT NULL,
          created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_owner_review_owner (owner_id),
          KEY idx_owner_review_client (client_id),
          KEY idx_owner_review_operator (operator_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );
    })().catch((err) => {
      ensureOwnerReviewTablePromise = null;
      throw err;
    });
  }
  return ensureOwnerReviewTablePromise;
}

async function submitTenantReview(clientId, operatorId, payload = {}) {
  await ensureCommunicationScoreColumn();
  const tenantId = payload.tenantId ? String(payload.tenantId).trim() : '';
  if (!clientId || !tenantId) return { ok: false, reason: 'MISSING_TENANT_ID' };
  const normalizedOperatorId = await resolveValidOperatorId(operatorId);

  const [tenantRows] = await pool.query(
    'SELECT id, fullname, email FROM tenantdetail WHERE id = ? LIMIT 1',
    [tenantId]
  );
  const tenant = tenantRows[0];
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };

  let tenancyId = payload.tenancyId ? String(payload.tenancyId).trim() : null;
  if (tenancyId) {
    const [tenancyRows] = await pool.query(
      'SELECT id, `status`, `end` FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1',
      [tenancyId, clientId]
    );
    if (!tenancyRows.length) return { ok: false, reason: 'TENANCY_NOT_FOUND' };
    const tRow = tenancyRows[0];
    const terminated = tRow.status === 0 || tRow.status === '0';
    const end = tRow.end ? new Date(tRow.end) : null;
    const endedByCalendar =
      end && !Number.isNaN(end.getTime()) && end < new Date();
    if (!terminated && !endedByCalendar) {
      return { ok: false, reason: 'TENANCY_NOT_ENDED' };
    }
  } else {
    tenancyId = null;
  }

  const paymentScoreSuggested = clampScore(payload.paymentScoreSuggested);
  const paymentScoreFinal = clampScore(payload.paymentScoreFinal);
  const unitCareScore = clampScore(payload.unitCareScore);
  const communicationScore = clampScore(payload.communicationScore);
  const overallScore = Number(((paymentScoreFinal + unitCareScore + communicationScore) / 3).toFixed(2));
  const latePaymentsCount = nonNegInt(payload.latePaymentsCount);
  const outstandingCount = nonNegInt(payload.outstandingCount);

  const badges = safeJsonArray(payload.badges).map((x) => String(x)).slice(0, 20);
  const evidence = safeJsonArray(payload.evidenceUrls)
    .map((x) => String(x).trim())
    .filter((x) => /^https?:\/\//i.test(x))
    .slice(0, 30);

  const comment = payload.comment != null ? String(payload.comment).trim().slice(0, 5000) : '';

  const reviewId = payload.reviewId ? String(payload.reviewId).trim() : '';
  if (reviewId) {
    const [updateRes] = await pool.query(
      `UPDATE tenant_review
       SET tenancy_id = ?, payment_score_suggested = ?, payment_score_final = ?, unit_care_score = ?, communication_score = ?, overall_score = ?,
           late_payments_count = ?, outstanding_count = ?, badges_json = ?, comment = ?, evidence_json = ?, updated_at = NOW()
       WHERE id = ? AND client_id = ? AND tenant_id = ? AND operator_id <=> ?`,
      [
        tenancyId, paymentScoreSuggested, paymentScoreFinal, unitCareScore, communicationScore, overallScore,
        latePaymentsCount, outstandingCount, JSON.stringify(badges), comment || null, JSON.stringify(evidence),
        reviewId, clientId, tenantId, normalizedOperatorId
      ]
    );
    if (Number(updateRes?.affectedRows || 0) > 0) {
      return { ok: true, id: reviewId, overallScore, updated: true };
    }
    return { ok: false, reason: 'REVIEW_NOT_FOUND' };
  }

  if (tenancyId) {
    const [dupRows] = await pool.query(
      'SELECT id FROM tenant_review WHERE client_id = ? AND tenancy_id = ? LIMIT 1',
      [clientId, tenancyId]
    );
    if (dupRows?.length) {
      return { ok: false, reason: 'REVIEW_ALREADY_SUBMITTED' };
    }
  }

  const id = randomUUID();
  await pool.query(
    `INSERT INTO tenant_review (
      id, tenant_id, tenant_email, tenancy_id, client_id, operator_id,
      payment_score_suggested, payment_score_final, unit_care_score, communication_score, overall_score,
      late_payments_count, outstanding_count, badges_json, comment, evidence_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      id, tenantId, tenant.email || null, tenancyId, clientId, normalizedOperatorId,
      paymentScoreSuggested, paymentScoreFinal, unitCareScore, communicationScore, overallScore,
      latePaymentsCount, outstandingCount, JSON.stringify(badges), comment || null, JSON.stringify(evidence)
    ]
  );
  return { ok: true, id, overallScore, updated: false };
}

async function resolveValidOperatorId(operatorId) {
  const op = operatorId ? String(operatorId).trim() : '';
  if (!op) return null;
  const [rows] = await pool.query('SELECT id FROM staffdetail WHERE id = ? LIMIT 1', [op]);
  return rows?.[0]?.id ? String(rows[0].id) : null;
}

async function getLatestTenantReviewForOperator(clientId, operatorId, tenantId, tenancyId = null) {
  await ensureCommunicationScoreColumn();
  if (!clientId || !tenantId) return { ok: false, reason: 'MISSING_TENANT_ID' };
  const normalizedOperatorId = await resolveValidOperatorId(operatorId);
  const whereTenancy = tenancyId ? ' AND tr.tenancy_id = ?' : '';
  const params = tenancyId ? [clientId, normalizedOperatorId, tenantId, tenancyId] : [clientId, normalizedOperatorId, tenantId];
  const [rows] = await pool.query(
    `SELECT tr.id, tr.payment_score_suggested, tr.payment_score_final, tr.unit_care_score, tr.communication_score, tr.overall_score,
            tr.late_payments_count, tr.outstanding_count, tr.badges_json, tr.comment, tr.evidence_json, tr.created_at
     FROM tenant_review tr
     WHERE tr.client_id = ? AND tr.operator_id <=> ? AND tr.tenant_id = ? ${whereTenancy}
     ORDER BY tr.created_at DESC
     LIMIT 1`,
    params
  );
  const r = rows[0];
  if (!r) return { ok: true, item: null };
  return {
    ok: true,
    item: {
      id: r.id,
      paymentScoreSuggested: Number(r.payment_score_suggested || 0),
      paymentScoreFinal: Number(r.payment_score_final || 0),
      unitCareScore: Number(r.unit_care_score || 0),
      communicationScore: Number(r.communication_score || 0),
      overallScore: Number(r.overall_score || 0),
      latePaymentsCount: Number(r.late_payments_count || 0),
      outstandingCount: Number(r.outstanding_count || 0),
      badges: safeJsonArray(r.badges_json).map((x) => String(x)),
      comment: r.comment || '',
      evidenceUrls: safeJsonArray(r.evidence_json).map((x) => String(x)),
      createdAt: r.created_at
    }
  };
}

async function getTenantPublicProfileById(tenantId) {
  await ensureCommunicationScoreColumn();
  await ensureOwnerReviewTable();
  if (!tenantId) return { ok: false, reason: 'MISSING_TENANT_ID' };
  const [tenantRows] = await pool.query(
    'SELECT id, fullname, email, profile FROM tenantdetail WHERE id = ? LIMIT 1',
    [tenantId]
  );
  const tenant = tenantRows[0] || null;
  let owner = null;
  if (!tenant) {
    const [ownerRows] = await pool.query(
      'SELECT id, ownername, email, profile FROM ownerdetail WHERE id = ? LIMIT 1',
      [tenantId]
    );
    owner = ownerRows[0] || null;
  }
  const email = String(tenant?.email || owner?.email || '').trim().toLowerCase();
  if (!email) return { ok: false, reason: 'TENANT_NOT_FOUND' };

  const [reviewRows] = await pool.query(
    `SELECT tr.id, tr.created_at, tr.payment_score_suggested, tr.payment_score_final, tr.unit_care_score, tr.communication_score, tr.overall_score,
            tr.late_payments_count, tr.outstanding_count, tr.badges_json, tr.comment, tr.evidence_json,
            tr.tenancy_id, tr.operator_id,
            t.begin AS tenancy_begin, t.end AS tenancy_end,
            r.title_fld AS room_title, p.shortname AS property_shortname,
            s.name AS operator_name, cp.subdomain AS operator_subdomain
     FROM tenant_review tr
     LEFT JOIN tenancy t ON t.id = tr.tenancy_id
     LEFT JOIN roomdetail r ON r.id = t.room_id
     LEFT JOIN propertydetail p ON p.id = r.property_id
     LEFT JOIN staffdetail s ON s.id = tr.operator_id
     LEFT JOIN client_profile cp ON cp.client_id = tr.client_id
     WHERE (LOWER(TRIM(tr.tenant_email)) = ? OR tr.tenant_id = ?)
     ORDER BY tr.created_at DESC
     LIMIT 200`,
    [email, tenant?.id || tenantId]
  );

  const tenantReviews = (reviewRows || []).map((r) => ({
    id: r.id,
    reviewType: 'tenant',
    createdAt: r.created_at,
    paymentScoreSuggested: Number(r.payment_score_suggested || 0),
    paymentScoreFinal: Number(r.payment_score_final || 0),
    unitCareScore: Number(r.unit_care_score || 0),
    communicationScore: Number(r.communication_score || 0),
    overallScore: Number(r.overall_score || 0),
    latePaymentsCount: Number(r.late_payments_count || 0),
    outstandingCount: Number(r.outstanding_count || 0),
    badges: safeJsonArray(r.badges_json).map((x) => String(x)),
    comment: r.comment || '',
    evidenceUrls: safeJsonArray(r.evidence_json).map((x) => String(x)),
    operatorName: r.operator_name || 'Operator',
    operatorSubdomain: r.operator_subdomain || null,
    tenancy: {
      id: r.tenancy_id || null,
      property: r.property_shortname || null,
      room: r.room_title || null,
      checkIn: r.tenancy_begin || null,
      checkOut: r.tenancy_end || null
    }
  }));

  const [ownerReviewRows] = await pool.query(
    `SELECT r.id, r.created_at, r.communication_score, r.responsibility_score, r.cooperation_score, r.overall_score,
            r.comment, r.evidence_json, s.name AS operator_name, cp.subdomain AS operator_subdomain,
            (
              SELECT MIN(op.created_at)
              FROM owner_property op
              LEFT JOIN propertydetail pp ON pp.id = op.property_id
              WHERE op.owner_id = r.owner_id
                AND pp.client_id = r.client_id
            ) AS binding_date,
            (
              SELECT pp.shortname
              FROM owner_property op
              LEFT JOIN propertydetail pp ON pp.id = op.property_id
              WHERE op.owner_id = r.owner_id
                AND pp.client_id = r.client_id
              ORDER BY op.created_at ASC
              LIMIT 1
            ) AS property_shortname
     FROM owner_review r
     LEFT JOIN staffdetail s ON s.id = r.operator_id
     LEFT JOIN client_profile cp ON cp.client_id = r.client_id
     WHERE LOWER(TRIM(r.owner_email)) = ?
     ORDER BY r.created_at DESC
     LIMIT 200`,
    [email]
  );
  const ownerReviews = (ownerReviewRows || []).map((r) => ({
    id: r.id,
    reviewType: 'owner',
    createdAt: r.created_at,
    paymentScoreSuggested: Number(r.responsibility_score || 0),
    paymentScoreFinal: Number(r.responsibility_score || 0),
    unitCareScore: Number(r.cooperation_score || 0),
    communicationScore: Number(r.communication_score || 0),
    overallScore: Number(r.overall_score || 0),
    latePaymentsCount: 0,
    outstandingCount: 0,
    badges: [],
    comment: r.comment || '',
    evidenceUrls: safeJsonArray(r.evidence_json).map((x) => String(x)),
    operatorName: r.operator_name || 'Operator',
    operatorSubdomain: r.operator_subdomain || null,
    tenancy: {
      id: null,
      property: r.property_shortname || null,
      room: r.property_shortname || null,
      checkIn: r.binding_date || null,
      checkOut: null
    }
  }));

  const reviews = [...tenantReviews, ...ownerReviews].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const avgOverall = reviews.length
    ? Number((reviews.reduce((a, x) => a + Number(x.overallScore || 0), 0) / reviews.length).toFixed(2))
    : null;

  return {
    ok: true,
    tenant: {
      id: tenant?.id || owner?.id || tenantId,
      fullname: tenant?.fullname || owner?.ownername || '',
      email,
      avatarUrl: parseProfileAvatar(tenant?.profile || owner?.profile)
    },
    summary: {
      reviewCount: reviews.length,
      averageOverallScore: avgOverall
    },
    reviews
  };
}

async function submitOwnerReview(clientId, operatorId, payload = {}) {
  await ensureOwnerReviewTable();
  const ownerId = payload.ownerId ? String(payload.ownerId).trim() : '';
  if (!clientId || !ownerId) return { ok: false, reason: 'MISSING_OWNER_ID' };
  const normalizedOperatorId = await resolveValidOperatorId(operatorId);
  const [ownerRows] = await pool.query(
    'SELECT id, ownername, email FROM ownerdetail WHERE id = ? LIMIT 1',
    [ownerId]
  );
  const owner = ownerRows[0];
  if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };

  const communicationScore = clampScore(payload.communicationScore);
  const responsibilityScore = clampScore(payload.responsibilityScore);
  const cooperationScore = clampScore(payload.cooperationScore);
  const overallScore = Number(((communicationScore + responsibilityScore + cooperationScore) / 3).toFixed(2));
  const evidence = safeJsonArray(payload.evidenceUrls)
    .map((x) => String(x).trim())
    .filter((x) => /^https?:\/\//i.test(x))
    .slice(0, 30);
  const comment = payload.comment != null ? String(payload.comment).trim().slice(0, 5000) : '';
  const reviewId = payload.reviewId ? String(payload.reviewId).trim() : '';

  if (reviewId) {
    const [updateRes] = await pool.query(
      `UPDATE owner_review
       SET communication_score = ?, responsibility_score = ?, cooperation_score = ?, overall_score = ?,
           comment = ?, evidence_json = ?, updated_at = NOW()
       WHERE id = ? AND client_id = ? AND owner_id = ? AND operator_id <=> ?`,
      [
        communicationScore, responsibilityScore, cooperationScore, overallScore,
        comment || null, JSON.stringify(evidence), reviewId, clientId, ownerId, normalizedOperatorId
      ]
    );
    if (Number(updateRes?.affectedRows || 0) > 0) return { ok: true, id: reviewId, overallScore, updated: true };
  }

  const id = randomUUID();
  await pool.query(
    `INSERT INTO owner_review (
      id, owner_id, owner_email, client_id, operator_id,
      communication_score, responsibility_score, cooperation_score, overall_score,
      comment, evidence_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      id, ownerId, owner.email || null, clientId, normalizedOperatorId,
      communicationScore, responsibilityScore, cooperationScore, overallScore,
      comment || null, JSON.stringify(evidence)
    ]
  );
  return { ok: true, id, overallScore, updated: false };
}

async function getLatestOwnerReviewForOperator(clientId, operatorId, ownerId) {
  await ensureOwnerReviewTable();
  if (!clientId || !ownerId) return { ok: false, reason: 'MISSING_OWNER_ID' };
  const normalizedOperatorId = await resolveValidOperatorId(operatorId);
  const [rows] = await pool.query(
    `SELECT id, communication_score, responsibility_score, cooperation_score, overall_score, comment, evidence_json, created_at
     FROM owner_review
     WHERE client_id = ? AND operator_id <=> ? AND owner_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [clientId, normalizedOperatorId, ownerId]
  );
  const r = rows[0];
  if (!r) return { ok: true, item: null };
  return {
    ok: true,
    item: {
      id: r.id,
      communicationScore: Number(r.communication_score || 0),
      responsibilityScore: Number(r.responsibility_score || 0),
      cooperationScore: Number(r.cooperation_score || 0),
      overallScore: Number(r.overall_score || 0),
      comment: r.comment || '',
      evidenceUrls: safeJsonArray(r.evidence_json).map((x) => String(x)),
      createdAt: r.created_at
    }
  };
}

async function getOwnerPublicProfileById(ownerId) {
  await ensureOwnerReviewTable();
  if (!ownerId) return { ok: false, reason: 'MISSING_OWNER_ID' };
  const [ownerRows] = await pool.query(
    'SELECT id, ownername, email, profile FROM ownerdetail WHERE id = ? LIMIT 1',
    [ownerId]
  );
  const owner = ownerRows[0];
  if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  const [rows] = await pool.query(
    `SELECT r.id, r.created_at, r.communication_score, r.responsibility_score, r.cooperation_score, r.overall_score,
            r.comment, r.evidence_json, s.name AS operator_name
     FROM owner_review r
     LEFT JOIN staffdetail s ON s.id = r.operator_id
     WHERE r.owner_id = ?
     ORDER BY r.created_at DESC
     LIMIT 200`,
    [ownerId]
  );
  const reviews = (rows || []).map((x) => ({
    id: x.id,
    createdAt: x.created_at,
    communicationScore: Number(x.communication_score || 0),
    responsibilityScore: Number(x.responsibility_score || 0),
    cooperationScore: Number(x.cooperation_score || 0),
    overallScore: Number(x.overall_score || 0),
    comment: x.comment || '',
    evidenceUrls: safeJsonArray(x.evidence_json).map((u) => String(u)),
    operatorName: x.operator_name || 'Operator'
  }));
  const avgOverall = reviews.length
    ? Number((reviews.reduce((a, x) => a + Number(x.overallScore || 0), 0) / reviews.length).toFixed(2))
    : null;
  return {
    ok: true,
    owner: {
      id: owner.id,
      fullname: owner.ownername || '',
      email: owner.email || '',
      avatarUrl: parseProfileAvatar(owner.profile)
    },
    summary: {
      reviewCount: reviews.length,
      averageOverallScore: avgOverall
    },
    reviews
  };
}

async function getTenantInvoiceHistoryById(tenantId, tenancyId = null) {
  if (!tenantId) return { ok: false, reason: 'MISSING_TENANT_ID' };
  const [tenantRows] = await pool.query(
    'SELECT id FROM tenantdetail WHERE id = ? LIMIT 1',
    [tenantId]
  );
  if (!tenantRows?.length) return { ok: false, reason: 'TENANT_NOT_FOUND' };

  const useTenancy = tenancyId ? String(tenancyId).trim() : '';
  const [rows] = await pool.query(
    `SELECT rc.id, rc.date AS invoice_date, rc.paidat AS payment_date,
            p.shortname AS property_shortname, r.title_fld AS room_title
     FROM rentalcollection rc
     LEFT JOIN propertydetail p ON p.id = rc.property_id
     LEFT JOIN roomdetail r ON r.id = rc.room_id
     WHERE rc.tenant_id = ? ${useTenancy ? 'AND rc.tenancy_id = ?' : ''}
       AND COALESCE(rc.accounting_invoice_voided, 0) = 0
     ORDER BY rc.date DESC, rc.created_at DESC
     LIMIT 500`,
    useTenancy ? [tenantId, useTenancy] : [tenantId]
  );

  const items = (rows || []).map((x) => ({
    id: x.id,
    apartmentName: [x.property_shortname, x.room_title].filter(Boolean).join(' / ') || '-',
    invoiceDate: x.invoice_date || null,
    paymentDate: x.payment_date || null
  }));

  return { ok: true, items };
}

module.exports = {
  submitTenantReview,
  getTenantPublicProfileById,
  getLatestTenantReviewForOperator,
  getTenantInvoiceHistoryById,
  submitOwnerReview,
  getLatestOwnerReviewForOperator,
  getOwnerPublicProfileById
};
