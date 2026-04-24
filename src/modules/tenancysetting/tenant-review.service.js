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

/** Resolve portal_account.id for a tenantdetail row (FK column or email match). */
async function resolvePortalAccountIdForTenantdetail(tenantId) {
  const [rows] = await pool.query(
    `SELECT COALESCE(td.portal_account_id, pa.id) AS pid
     FROM tenantdetail td
     LEFT JOIN portal_account pa ON LOWER(TRIM(pa.email)) = LOWER(TRIM(td.email))
     WHERE td.id = ? LIMIT 1`,
    [tenantId]
  );
  return rows[0]?.pid ? String(rows[0].pid) : null;
}

/** Resolve portal_account.id for an ownerdetail row. */
async function resolvePortalAccountIdForOwnerdetail(ownerId) {
  const [rows] = await pool.query(
    `SELECT COALESCE(od.portal_account_id, pa.id) AS pid
     FROM ownerdetail od
     LEFT JOIN portal_account pa ON LOWER(TRIM(pa.email)) = LOWER(TRIM(od.email))
     WHERE od.id = ? LIMIT 1`,
    [ownerId]
  );
  return rows[0]?.pid ? String(rows[0].pid) : null;
}

async function submitTenantReview(clientId, operatorId, payload = {}) {
  const tenantId = payload.tenantId ? String(payload.tenantId).trim() : '';
  if (!clientId || !tenantId) return { ok: false, reason: 'MISSING_TENANT_ID' };
  const normalizedOperatorId = await resolveValidOperatorId(operatorId);

  const [tenantRows] = await pool.query(
    'SELECT id, fullname, email FROM tenantdetail WHERE id = ? LIMIT 1',
    [tenantId]
  );
  const tenant = tenantRows[0];
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };

  const portalAccountId = await resolvePortalAccountIdForTenantdetail(tenantId);
  if (!portalAccountId) return { ok: false, reason: 'PORTAL_ACCOUNT_REQUIRED' };

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
    const endedByCalendar = end && !Number.isNaN(end.getTime()) && end < new Date();
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
      `UPDATE portal_account_review
       SET tenancy_id = ?, payment_score_suggested = ?, payment_score_final = ?, unit_care_score = ?, communication_score = ?, overall_score = ?,
           late_payments_count = ?, outstanding_count = ?, badges_json = ?, comment = ?, evidence_json = ?, updated_at = NOW()
       WHERE id = ? AND subject_kind = 'tenant' AND client_id = ? AND tenant_id = ? AND operator_id <=> ?`,
      [
        tenancyId,
        paymentScoreSuggested,
        paymentScoreFinal,
        unitCareScore,
        communicationScore,
        overallScore,
        latePaymentsCount,
        outstandingCount,
        JSON.stringify(badges),
        comment || null,
        JSON.stringify(evidence),
        reviewId,
        clientId,
        tenantId,
        normalizedOperatorId,
      ]
    );
    if (Number(updateRes?.affectedRows || 0) > 0) {
      return { ok: true, id: reviewId, overallScore, updated: true };
    }
    return { ok: false, reason: 'REVIEW_NOT_FOUND' };
  }

  if (tenancyId) {
    const [dupRows] = await pool.query(
      `SELECT id FROM portal_account_review WHERE subject_kind = 'tenant' AND client_id = ? AND tenancy_id = ? LIMIT 1`,
      [clientId, tenancyId]
    );
    if (dupRows?.length) {
      return { ok: false, reason: 'REVIEW_ALREADY_SUBMITTED' };
    }
  }

  const id = randomUUID();
  await pool.query(
    `INSERT INTO portal_account_review (
      id, subject_kind, portal_account_id, tenant_id, owner_id, tenancy_id, client_id, operator_id,
      payment_score_suggested, payment_score_final, unit_care_score, communication_score, overall_score,
      late_payments_count, outstanding_count, badges_json, responsibility_score, cooperation_score, comment, evidence_json,
      created_at, updated_at
    ) VALUES (?, 'tenant', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NOW(), NOW())`,
    [
      id,
      portalAccountId,
      tenantId,
      tenancyId,
      clientId,
      normalizedOperatorId,
      paymentScoreSuggested,
      paymentScoreFinal,
      unitCareScore,
      communicationScore,
      overallScore,
      latePaymentsCount,
      outstandingCount,
      JSON.stringify(badges),
      comment || null,
      JSON.stringify(evidence),
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
  if (!clientId || !tenantId) return { ok: false, reason: 'MISSING_TENANT_ID' };
  const normalizedOperatorId = await resolveValidOperatorId(operatorId);
  const whereTenancy = tenancyId ? ' AND par.tenancy_id = ?' : '';
  const params = tenancyId
    ? [clientId, normalizedOperatorId, tenantId, tenancyId]
    : [clientId, normalizedOperatorId, tenantId];
  const [rows] = await pool.query(
    `SELECT par.id, par.payment_score_suggested, par.payment_score_final, par.unit_care_score, par.communication_score, par.overall_score,
            par.late_payments_count, par.outstanding_count, par.badges_json, par.comment, par.evidence_json, par.created_at
     FROM portal_account_review par
     WHERE par.subject_kind = 'tenant' AND par.client_id = ? AND par.operator_id <=> ? AND par.tenant_id = ? ${whereTenancy}
     ORDER BY par.created_at DESC
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
      createdAt: r.created_at,
    },
  };
}

async function getTenantPublicProfileById(tenantId) {
  if (!tenantId) return { ok: false, reason: 'MISSING_TENANT_ID' };
  const [tenantRows] = await pool.query(
    'SELECT id, fullname, email, profile, portal_account_id FROM tenantdetail WHERE id = ? LIMIT 1',
    [tenantId]
  );
  const tenant = tenantRows[0] || null;
  let owner = null;
  if (!tenant) {
    const [ownerRows] = await pool.query(
      'SELECT id, ownername, email, profile, portal_account_id FROM ownerdetail WHERE id = ? LIMIT 1',
      [tenantId]
    );
    owner = ownerRows[0] || null;
  }
  let portalAccountDirect = null;
  if (!tenant && !owner) {
    const [paRows] = await pool.query(
      `SELECT id, email, fullname, first_name, last_name, profile, avatar_url
       FROM portal_account WHERE id = ? LIMIT 1`,
      [tenantId]
    );
    portalAccountDirect = paRows[0] || null;
  }
  const email = String(tenant?.email || owner?.email || portalAccountDirect?.email || '')
    .trim()
    .toLowerCase();
  if (!email) return { ok: false, reason: 'TENANT_NOT_FOUND' };

  let tenantReviewWhere = '';
  let tenantReviewParams = [];
  if (tenant?.id != null) {
    tenantReviewWhere = 'par.subject_kind = ? AND par.tenant_id = ?';
    tenantReviewParams = ['tenant', String(tenant.id)];
  } else if (owner?.id != null) {
    const opid = await resolvePortalAccountIdForOwnerdetail(String(owner.id));
    if (!opid) {
      tenantReviewWhere = '1=0';
      tenantReviewParams = [];
    } else {
      tenantReviewWhere = 'par.subject_kind = ? AND par.portal_account_id = ?';
      tenantReviewParams = ['tenant', opid];
    }
  } else if (portalAccountDirect?.id != null) {
    tenantReviewWhere = 'par.subject_kind = ? AND par.portal_account_id = ?';
    tenantReviewParams = ['tenant', String(portalAccountDirect.id)];
  } else {
    tenantReviewWhere = '1=0';
    tenantReviewParams = [];
  }

  const [reviewRows] = tenantReviewParams.length
    ? await pool.query(
        `SELECT par.id, par.created_at, par.payment_score_suggested, par.payment_score_final, par.unit_care_score, par.communication_score, par.overall_score,
                par.late_payments_count, par.outstanding_count, par.badges_json, par.comment, par.evidence_json,
                par.tenancy_id, par.operator_id,
                t.begin AS tenancy_begin, t.end AS tenancy_end,
                r.title_fld AS room_title, p.shortname AS property_shortname,
                s.name AS operator_name, cp.subdomain AS operator_subdomain
         FROM portal_account_review par
         LEFT JOIN tenancy t ON t.id = par.tenancy_id
         LEFT JOIN roomdetail r ON r.id = t.room_id
         LEFT JOIN propertydetail p ON p.id = r.property_id
         LEFT JOIN staffdetail s ON s.id = par.operator_id
         LEFT JOIN client_profile cp ON cp.client_id = par.client_id
         WHERE ${tenantReviewWhere}
         ORDER BY par.created_at DESC
         LIMIT 200`,
        tenantReviewParams
      )
    : [[]];

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
      checkOut: r.tenancy_end || null,
    },
  }));

  let ownerReviewWhere = '';
  let ownerReviewParams = [];
  const portalForMerge =
    tenant?.id != null
      ? await resolvePortalAccountIdForTenantdetail(String(tenant.id))
      : owner?.id != null
        ? await resolvePortalAccountIdForOwnerdetail(String(owner.id))
        : portalAccountDirect?.id != null
          ? String(portalAccountDirect.id)
          : null;

  if (portalForMerge) {
    ownerReviewWhere = 'par.subject_kind = ? AND par.portal_account_id = ?';
    ownerReviewParams = ['owner', portalForMerge];
  } else {
    ownerReviewWhere = '1=0';
    ownerReviewParams = [];
  }

  const [ownerReviewRows] = ownerReviewParams.length
    ? await pool.query(
        `SELECT par.id, par.created_at, par.communication_score, par.responsibility_score, par.cooperation_score, par.overall_score,
                par.comment, par.evidence_json, s.name AS operator_name, cp.subdomain AS operator_subdomain,
                par.owner_id, par.client_id,
                (
                  SELECT MIN(op.created_at)
                  FROM owner_property op
                  LEFT JOIN propertydetail pp ON pp.id = op.property_id
                  WHERE op.owner_id = par.owner_id
                    AND pp.client_id = par.client_id
                ) AS binding_date,
                (
                  SELECT pp.shortname
                  FROM owner_property op
                  LEFT JOIN propertydetail pp ON pp.id = op.property_id
                  WHERE op.owner_id = par.owner_id
                    AND pp.client_id = par.client_id
                  ORDER BY op.created_at ASC
                  LIMIT 1
                ) AS property_shortname
         FROM portal_account_review par
         LEFT JOIN staffdetail s ON s.id = par.operator_id
         LEFT JOIN client_profile cp ON cp.client_id = par.client_id
         WHERE ${ownerReviewWhere}
         ORDER BY par.created_at DESC
         LIMIT 200`,
        ownerReviewParams
      )
    : [[]];

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
      checkOut: null,
    },
  }));

  const reviews = [...tenantReviews, ...ownerReviews].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );

  const avgOverall = reviews.length
    ? Number((reviews.reduce((a, x) => a + Number(x.overallScore || 0), 0) / reviews.length).toFixed(2))
    : null;

  const paFullName = portalAccountDirect
    ? String(portalAccountDirect.fullname || '')
        .trim() ||
      [portalAccountDirect.first_name, portalAccountDirect.last_name].filter(Boolean).join(' ').trim()
    : '';
  const avatarFromPortalOnly =
    parseProfileAvatar(portalAccountDirect?.profile) ||
    (portalAccountDirect?.avatar_url && String(portalAccountDirect.avatar_url).trim()
      ? String(portalAccountDirect.avatar_url).trim()
      : null);

  return {
    ok: true,
    tenant: {
      id: tenant?.id || owner?.id || portalAccountDirect?.id || tenantId,
      fullname: tenant?.fullname || owner?.ownername || paFullName,
      email,
      avatarUrl: parseProfileAvatar(tenant?.profile || owner?.profile) || avatarFromPortalOnly,
    },
    summary: {
      reviewCount: reviews.length,
      averageOverallScore: avgOverall,
    },
    reviews,
  };
}

async function submitOwnerReview(clientId, operatorId, payload = {}) {
  const ownerId = payload.ownerId ? String(payload.ownerId).trim() : '';
  if (!clientId || !ownerId) return { ok: false, reason: 'MISSING_OWNER_ID' };
  const normalizedOperatorId = await resolveValidOperatorId(operatorId);
  const [ownerRows] = await pool.query(
    'SELECT id, ownername, email FROM ownerdetail WHERE id = ? LIMIT 1',
    [ownerId]
  );
  const owner = ownerRows[0];
  if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };

  const portalAccountId = await resolvePortalAccountIdForOwnerdetail(ownerId);
  if (!portalAccountId) return { ok: false, reason: 'PORTAL_ACCOUNT_REQUIRED' };

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
      `UPDATE portal_account_review
       SET communication_score = ?, responsibility_score = ?, cooperation_score = ?, overall_score = ?,
           comment = ?, evidence_json = ?, updated_at = NOW()
       WHERE id = ? AND subject_kind = 'owner' AND client_id = ? AND owner_id = ? AND operator_id <=> ?`,
      [
        communicationScore,
        responsibilityScore,
        cooperationScore,
        overallScore,
        comment || null,
        JSON.stringify(evidence),
        reviewId,
        clientId,
        ownerId,
        normalizedOperatorId,
      ]
    );
    if (Number(updateRes?.affectedRows || 0) > 0) return { ok: true, id: reviewId, overallScore, updated: true };
  }

  const id = randomUUID();
  await pool.query(
    `INSERT INTO portal_account_review (
      id, subject_kind, portal_account_id, tenant_id, owner_id, tenancy_id, client_id, operator_id,
      payment_score_suggested, payment_score_final, unit_care_score, communication_score, overall_score,
      late_payments_count, outstanding_count, badges_json, responsibility_score, cooperation_score, comment, evidence_json,
      created_at, updated_at
    ) VALUES (?, 'owner', ?, NULL, ?, NULL, ?, ?, 0, 0, 0, ?, ?, 0, 0, NULL, ?, ?, ?, ?, NOW(), NOW())`,
    [
      id,
      portalAccountId,
      ownerId,
      clientId,
      normalizedOperatorId,
      communicationScore,
      overallScore,
      responsibilityScore,
      cooperationScore,
      comment || null,
      JSON.stringify(evidence),
    ]
  );
  return { ok: true, id, overallScore, updated: false };
}

async function getLatestOwnerReviewForOperator(clientId, operatorId, ownerId) {
  if (!clientId || !ownerId) return { ok: false, reason: 'MISSING_OWNER_ID' };
  const normalizedOperatorId = await resolveValidOperatorId(operatorId);
  const [rows] = await pool.query(
    `SELECT id, communication_score, responsibility_score, cooperation_score, overall_score, comment, evidence_json, created_at
     FROM portal_account_review
     WHERE subject_kind = 'owner' AND client_id = ? AND operator_id <=> ? AND owner_id = ?
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
      createdAt: r.created_at,
    },
  };
}

async function getOwnerPublicProfileById(ownerId) {
  if (!ownerId) return { ok: false, reason: 'MISSING_OWNER_ID' };
  const [ownerRows] = await pool.query(
    'SELECT id, ownername, email, profile FROM ownerdetail WHERE id = ? LIMIT 1',
    [ownerId]
  );
  const owner = ownerRows[0];
  if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  const [rows] = await pool.query(
    `SELECT par.id, par.created_at, par.communication_score, par.responsibility_score, par.cooperation_score, par.overall_score,
            par.comment, par.evidence_json, s.name AS operator_name
     FROM portal_account_review par
     LEFT JOIN staffdetail s ON s.id = par.operator_id
     WHERE par.subject_kind = 'owner' AND par.owner_id = ?
     ORDER BY par.created_at DESC
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
    operatorName: x.operator_name || 'Operator',
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
      avatarUrl: parseProfileAvatar(owner.profile),
    },
    summary: {
      reviewCount: reviews.length,
      averageOverallScore: avgOverall,
    },
    reviews,
  };
}

async function getTenantInvoiceHistoryById(tenantId, tenancyId = null) {
  if (!tenantId) return { ok: false, reason: 'MISSING_TENANT_ID' };
  const [tenantRows] = await pool.query('SELECT id FROM tenantdetail WHERE id = ? LIMIT 1', [tenantId]);
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
    paymentDate: x.payment_date || null,
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
  getOwnerPublicProfileById,
};
