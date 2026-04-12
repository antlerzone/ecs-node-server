/**
 * Tenant Dashboard API – for Wix tenant dashboard page (租客仪表盘).
 * All endpoints POST with email in body; tenant resolved by email (tenantdetail.email).
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/db');
const { getClientIp } = require('../../utils/requestIp');
const { afterSignUpdate } = require('../agreement/agreement.service');
const {
  getTenantByEmail,
  computeRequiresPaymentMethodLink,
  getTenantPaymentMethodPolicyForClientId,
  getTenanciesForTenant,
  getClientsByIds,
  getRoomWithMeter,
  getPropertyWithSmartdoor,
  getBanks,
  updateTenantProfile,
  getAgreementHtml,
  updateAgreementTenantSign,
  getAgreementByIdForTenant,
  getRentalListForTenancy,
  getApprovalDetail,
  tenantApprove,
  tenantReject,
  generateFromTenancyForTenant,
  syncTenantForClient,
  insertFeedback,
  getFeedbackListForTenant,
  appendFeedbackMessageForTenant,
  assertTenancyBelongsToTenant,
  assertTenancyPortalWritable,
  remoteUnlockForTenant,
  getPasscodeForTenant,
  savePasscodeForTenant,
  getOverdueTenancyIds,
  getHasOverduePayment,
  requestEmailChange,
  confirmEmailChange,
  syncMeterForTenantRoom,
  getUsageSummaryForTenantRoom,
  updateTenantHandoverSchedule,
  disconnectTenantPaymentMethod,
  createTenantCleaningOrder,
  getLatestTenantCleaningOrder
} = require('./tenantdashboard.service');
const { upsertPaynowTenantReceipt, runMatchingForInvoice, syncBankTransactionsFromFinverse } = require('../payment-verification/payment-verification.service');
const multer = require('multer');
const { uploadToOss } = require('../upload/oss.service');

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
}).single('file');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

/**
 * Next.js tenant portal base for Stripe/Payex success URLs.
 * Order: PORTAL_APP_URL → PORTAL_FRONTEND_URL → PUBLIC_APP_URL → default.
 * If only PUBLIC_APP_URL is set to the API host, prefer PORTAL_FRONTEND_URL (see .env) so /tenant/payment is not built on api.* (404).
 */
function getPortalAppBaseUrl() {
  const raw =
    process.env.PORTAL_APP_URL ||
    process.env.PORTAL_FRONTEND_URL ||
    process.env.PUBLIC_APP_URL ||
    'https://portal.colivingjb.com';
  return String(raw).replace(/\/$/, '');
}

function appendQueryParams(url, params) {
  let next = String(url || '');
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === '') continue;
    const rawValue = String(value);
    const encodedValue = /^\{[A-Z0-9_]+\}$/.test(rawValue) ? rawValue : encodeURIComponent(rawValue);
    next += (next.includes('?') ? '&' : '?') + `${encodeURIComponent(key)}=${encodedValue}`;
  }
  return next;
}

/** Portal user can enter even when no tenantdetail row yet (nobody mapped). Return 200 so frontend can show empty state / profile form; never 404 for TENANT_NOT_FOUND. */
function withTenant(req, res, handler) {
  const email = getEmail(req);
  if (!email || !String(email).trim()) {
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  }
  handler(email)
    .then((result) => {
      try {
        if (result && result.ok === false && result.reason) {
          // Business-level denials should return 200 + { ok:false, reason } so portal UI can handle gracefully.
          // Reserve 403 for true auth/access failures only.
          const authReasons = new Set(['ACCESS_DENIED', 'NO_PERMISSION', 'NO_CLIENT_ID']);
          const status = authReasons.has(String(result.reason || '')) ? 403 : 200;
          return res.status(status).json(result);
        }
        return res.json(result);
      } catch (sendErr) {
        // If res.json throws (e.g. JSON.stringify on circular refs), headers may already be sent;
        // a rejected promise would hit the outer catch and cause ERR_HTTP_HEADERS_SENT.
        console.error('[tenantdashboard] response send error', sendErr);
        if (!res.headersSent) {
          res.status(500).json({ ok: false, reason: 'BACKEND_ERROR' });
        }
      }
    })
    .catch((err) => {
      console.error('[tenantdashboard]', err);
      const msg = err?.message || (typeof err === 'string' ? err : '');
      const reason = msg || 'BACKEND_ERROR';
      if (!res.headersSent) {
        res.status(500).json({ ok: false, reason });
      }
    });
}

/** POST /api/tenantdashboard/init – tenant + tenancies + overdueTenancyIds/hasOverduePayment. When no tenant found, return ok with tenant: null, tenancies: []. */
router.post('/init', (req, res) => {
  withTenant(req, res, async (email) => {
    const tenant = await getTenantByEmail(email);
    const tenancies = tenant ? await getTenanciesForTenant(tenant._id) : [];
    console.log('[tenantdashboard] init', { email: email ? `${String(email).slice(0, 8)}***` : null, tenantFound: !!tenant, tenancyCount: tenancies.length });
    if (!tenant) return { ok: true, tenant: null, tenancies: [], overdueTenancyIds: [], hasOverduePayment: false, requiresPaymentMethodLink: false };
    const overdueTenancyIds = await getOverdueTenancyIds(tenant._id);
    const hasOverduePayment = overdueTenancyIds.length > 0;
    const requiresPaymentMethodLink = await computeRequiresPaymentMethodLink(tenant._id, tenant.profile);
    return { ok: true, tenant, tenancies, overdueTenancyIds, hasOverduePayment, requiresPaymentMethodLink };
  });
});

/** POST /api/tenantdashboard/cleaning-order — body: { tenancyId, scheduledDate, scheduledTime, roomAccessMode, roomAccessDetail? } (Malaysia local). */
router.post('/cleaning-order', (req, res) => {
  withTenant(req, res, async (email) =>
    createTenantCleaningOrder(email, {
      tenancyId: req.body?.tenancyId,
      scheduledDate: req.body?.scheduledDate,
      scheduledTime: req.body?.scheduledTime,
      roomAccessMode: req.body?.roomAccessMode,
      roomAccessDetail: req.body?.roomAccessDetail
    })
  );
});

/** POST /api/tenantdashboard/cleaning-order-latest — body: { tenancyId } → latest tenant cleaning charge for UI. */
router.post('/cleaning-order-latest', (req, res) => {
  withTenant(req, res, async (email) =>
    getLatestTenantCleaningOrder(email, { tenancyId: req.body?.tenancyId })
  );
});

/** POST /api/tenantdashboard/clients-by-ids – body: { clientIds }. When no tenant row yet, return empty list. */
router.post('/clients-by-ids', (req, res) => {
  withTenant(req, res, async (email) => {
    const tenant = await getTenantByEmail(email);
    if (!tenant) return { ok: true, items: [] };
    const clientIds = req.body?.clientIds || [];
    const items = await getClientsByIds(clientIds);
    return { ok: true, items };
  });
});

/** POST /api/tenantdashboard/room – body: { roomId } */
router.post('/room', (req, res) => {
  withTenant(req, res, async (email) => {
    const tenant = await getTenantByEmail(email);
    if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
    const roomId = req.body?.roomId;
    if (!roomId) return { ok: false, reason: 'MISSING_ROOM_ID' };
    const tenancies = await getTenanciesForTenant(tenant._id);
    const hasRoom = tenancies.some(
      (t) => t.room && (t.room._id === roomId || t.room === roomId)
    );
    if (!hasRoom) return { ok: false, reason: 'TENANCY_MISMATCH' };
    const room = await getRoomWithMeter(roomId);
    if (!room) return { ok: false, reason: 'ROOM_NOT_FOUND' };
    return { ok: true, room };
  });
});

/** POST /api/tenantdashboard/property-with-smartdoor – body: { propertyId, roomId? } */
router.post('/property-with-smartdoor', (req, res) => {
  withTenant(req, res, async (email) => {
    const tenant = await getTenantByEmail(email);
    if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
    const { propertyId, roomId } = req.body || {};
    if (!propertyId) return { ok: false, reason: 'MISSING_PROPERTY_ID' };
    const tenancies = await getTenanciesForTenant(tenant._id);
    const hasProp = tenancies.some(
      (t) => t.property && (t.property._id === propertyId || t.property === propertyId)
    );
    if (!hasProp) return { ok: false, reason: 'TENANCY_MISMATCH' };
    const data = await getPropertyWithSmartdoor(propertyId, roomId);
    return { ok: true, ...data };
  });
});

/** POST /api/tenantdashboard/banks */
router.post('/banks', (req, res) => {
  getBanks()
    .then((items) => res.json({ ok: true, items }))
    .catch((err) => {
      console.error('[tenantdashboard] banks', err);
      const msg = err?.message || (typeof err === 'string' ? err : '');
      res.status(500).json({ ok: false, reason: msg || 'BACKEND_ERROR' });
    });
});

/** POST /api/tenantdashboard/update-profile – body: profile payload. Email cannot be changed here; use request-email-change + confirm-email-change. */
router.post('/update-profile', (req, res) => {
  withTenant(req, res, (email) => updateTenantProfile(email, req.body || {}));
});

/** POST /api/tenantdashboard/request-email-change – body: { newEmail }. Sends verification code to new email. */
router.post('/request-email-change', (req, res) => {
  withTenant(req, res, (email) => {
    const newEmail = req.body?.newEmail;
    if (!newEmail || !String(newEmail).trim()) return { ok: false, reason: 'MISSING_NEW_EMAIL' };
    return requestEmailChange(email, newEmail);
  });
});

/** POST /api/tenantdashboard/confirm-email-change – body: { newEmail, code }. Verifies code and updates email. */
router.post('/confirm-email-change', (req, res) => {
  withTenant(req, res, (email) => {
    const newEmail = req.body?.newEmail;
    const code = req.body?.code;
    if (!newEmail || !String(newEmail).trim()) return { ok: false, reason: 'MISSING_NEW_EMAIL' };
    if (!code || !String(code).trim()) return { ok: false, reason: 'MISSING_CODE' };
    return confirmEmailChange(email, newEmail, code);
  });
});

/** POST /api/tenantdashboard/agreement-html – body: { tenancyId, agreementTemplateId?, staffVars? } */
router.post('/agreement-html', (req, res) => {
  withTenant(req, res, async (email) => {
    const { tenancyId, agreementTemplateId, staffVars } = req.body || {};
    if (!tenancyId) return { ok: false, reason: 'MISSING_TENANCY_ID' };
    return getAgreementHtml(email, tenancyId, agreementTemplateId, staffVars);
  });
});

/** POST /api/tenantdashboard/agreement-update-sign – body: { agreementId, tenantsign, status? }. Records client IP. Hook: first sign→locked, full sign→final PDF. */
router.post('/agreement-update-sign', (req, res) => {
  withTenant(req, res, async (email) => {
    const { agreementId, tenantsign, status } = req.body || {};
    if (!agreementId || !tenantsign) {
      return { ok: false, reason: 'MISSING_AGREEMENT_ID_OR_SIGNATURE' };
    }
    const result = await updateAgreementTenantSign(email, agreementId, {
      tenantsign,
      tenantSignedAt: new Date(),
      status,
      tenantSignedIp: getClientIp(req)
    });
    if (result && result.ok) {
      try {
        await afterSignUpdate(agreementId);
      } catch (hookErr) {
        console.error('[tenantdashboard] afterSignUpdate', hookErr?.message || hookErr);
      }
    }
    return result;
  });
});

/** POST /api/tenantdashboard/agreement-get – body: { agreementId } */
router.post('/agreement-get', (req, res) => {
  withTenant(req, res, async (email) => {
    const agreementId = req.body?.agreementId;
    if (!agreementId) return { ok: false, reason: 'MISSING_AGREEMENT_ID' };
    const agreement = await getAgreementByIdForTenant(email, agreementId);
    if (!agreement) return { ok: false, reason: 'NOT_FOUND' };
    return { ok: true, agreement };
  });
});

/** POST /api/tenantdashboard/rental-list – body: { tenancyId } */
router.post('/rental-list', (req, res) => {
  withTenant(req, res, (email) => {
    const tenancyId = req.body?.tenancyId;
    if (!tenancyId) return { ok: false, reason: 'MISSING_TENANCY_ID' };
    return getRentalListForTenancy(email, tenancyId);
  });
});

/** POST /api/tenantdashboard/approval-detail – body: { clientId } */
router.post('/approval-detail', (req, res) => {
  withTenant(req, res, (email) => {
    const clientId = req.body?.clientId;
    if (!clientId) return { ok: false, reason: 'MISSING_CLIENT_ID' };
    return getApprovalDetail(email, clientId);
  });
});

/** POST /api/tenantdashboard/tenant-approve – body: { clientId } */
router.post('/tenant-approve', (req, res) => {
  withTenant(req, res, (email) => {
    const clientId = req.body?.clientId;
    if (!clientId) return { ok: false, reason: 'MISSING_CLIENT_ID' };
    return tenantApprove(email, clientId);
  });
});

/** POST /api/tenantdashboard/tenant-reject – body: { clientId } */
router.post('/tenant-reject', (req, res) => {
  withTenant(req, res, (email) => {
    const clientId = req.body?.clientId;
    if (!clientId) return { ok: false, reason: 'MISSING_CLIENT_ID' };
    return tenantReject(email, clientId);
  });
});

/** POST /api/tenantdashboard/generate-from-tenancy – body: { tenancyId } */
router.post('/generate-from-tenancy', (req, res) => {
  withTenant(req, res, (email) => {
    const tenancyId = req.body?.tenancyId;
    if (!tenancyId) return { ok: false, reason: 'MISSING_TENANCY_ID' };
    return generateFromTenancyForTenant(email, tenancyId);
  });
});

/** POST /api/tenantdashboard/sync-tenant-for-client – body: { clientId } */
router.post('/sync-tenant-for-client', (req, res) => {
  withTenant(req, res, (email) => {
    const clientId = req.body?.clientId;
    if (!clientId) return { ok: false, reason: 'MISSING_CLIENT_ID' };
    return syncTenantForClient(email, clientId, req.body || {});
  });
});

/** POST /api/tenantdashboard/feedback-list – returns list of feedback for tenant. */
router.post('/feedback-list', (req, res) => {
  withTenant(req, res, async (email) => {
    const items = await getFeedbackListForTenant(email);
    return { ok: true, items };
  });
});

/** POST /api/tenantdashboard/feedback – body: { tenancyId, roomId?, propertyId?, clientId?, description, photo?, video? } */
router.post('/feedback', (req, res) => {
  withTenant(req, res, (email) => {
    const body = req.body || {};
    if (!body.tenancyId) return { ok: false, reason: 'MISSING_TENANCY_ID' };
    return insertFeedback(email, body);
  });
});

function appendFeedbackMessageRoute(req, res) {
  withTenant(req, res, (email) => {
    const body = req.body || {};
    return appendFeedbackMessageForTenant(email, body.feedbackId ?? body.id, body.text, body.attachments);
  });
}

/** POST /api/tenantdashboard/feedback-message – append tenant reply (requires messages_json migration). */
router.post('/feedback-message', appendFeedbackMessageRoute);
/** Same handler — preferred path for proxies; keeps hyphen route for older clients. */
router.post('/feedback/append', appendFeedbackMessageRoute);

/** POST /api/tenantdashboard/remote-unlock – body: { tenancyId, smartDoorScope? }. TTLock remote unlock; scope all | property | room (default all). */
router.post('/remote-unlock', (req, res) => {
  console.log('[tenantdashboard] remote-unlock hit tenancyId=', req.body?.tenancyId, 'scope=', req.body?.smartDoorScope);
  withTenant(req, res, (email) => {
    const tenancyId = req.body?.tenancyId;
    if (!tenancyId) return { ok: false, reason: 'MISSING_TENANCY_ID' };
    return remoteUnlockForTenant(email, tenancyId, req.body?.smartDoorScope);
  });
});

/** POST /api/tenantdashboard/passcode – body: { tenancyId, smartDoorScope? }. PIN for scope all | property | room (default all). */
router.post('/passcode', (req, res) => {
  withTenant(req, res, (email) => {
    const tenancyId = req.body?.tenancyId;
    if (!tenancyId) return { ok: false, reason: 'MISSING_TENANCY_ID' };
    return getPasscodeForTenant(email, tenancyId, req.body?.smartDoorScope);
  });
});

/** POST /api/tenantdashboard/passcode-save – body: { tenancyId, newPassword, smartDoorScope? }. Update PIN for scope all | property | room (default all). */
router.post('/passcode-save', (req, res) => {
  console.log('[tenantdashboard] passcode-save hit tenancyId=', req.body?.tenancyId, 'scope=', req.body?.smartDoorScope);
  const email = getEmail(req);
  if (!email || !String(email).trim()) {
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  }
  const tenancyId = req.body?.tenancyId;
  const newPassword = req.body?.newPassword;
  if (!tenancyId) return res.status(200).json({ ok: false, reason: 'MISSING_TENANCY_ID' });
  savePasscodeForTenant(email, tenancyId, newPassword, req.body?.smartDoorScope)
    .then((result) => {
      if (result && result.ok === false) {
        console.log('[tenantdashboard] passcode-save fail reason=', result.reason);
      }
      res.status(200).json(result);
    })
    .catch((err) => {
      console.error('[tenantdashboard] passcode-save', err);
      const msg = err?.message || (typeof err === 'string' ? err : '');
      res.status(500).json({ ok: false, reason: msg || 'BACKEND_ERROR' });
    });
});

/** POST /api/tenantdashboard/meter-sync – body: { roomId }. Sync CNYIoT meter for tenant's room. */
router.post('/meter-sync', (req, res) => {
  withTenant(req, res, async (email) => {
    const roomId = req.body?.roomId;
    if (!roomId) return { ok: false, reason: 'MISSING_ROOM_ID' };
    return syncMeterForTenantRoom(email, roomId);
  });
});

/** POST /api/tenantdashboard/usage-summary – body: { roomId, start?, end? }. start/end: ISO date string or Date. Returns { ok, total, records, children }. */
router.post('/usage-summary', (req, res) => {
  withTenant(req, res, async (email) => {
    const roomId = req.body?.roomId;
    if (!roomId) return { ok: false, reason: 'MISSING_ROOM_ID' };
    const start = req.body?.start != null ? req.body.start : undefined;
    const end = req.body?.end != null ? req.body.end : undefined;
    return getUsageSummaryForTenantRoom(email, roomId, { start, end });
  });
});

/** POST /api/tenantdashboard/handover-schedule – body: { tenancyId, handoverCheckinAt?, handoverCheckoutAt? } */
router.post('/handover-schedule', (req, res) => {
  withTenant(req, res, async (email) => {
    const tenancyId = req.body?.tenancyId;
    if (!tenancyId) return { ok: false, reason: 'MISSING_TENANCY_ID' };
    return updateTenantHandoverSchedule(email, tenancyId, {
      handoverCheckinAt: req.body?.handoverCheckinAt,
      handoverCheckoutAt: req.body?.handoverCheckoutAt
    });
  });
});

/** POST /api/tenantdashboard/upload – multipart form: file, email. When no tenant row yet, return 200 + reason so user can complete profile first. */
router.post('/upload', uploadMiddleware, async (req, res) => {
  try {
    const email = req.body?.email != null ? String(req.body.email).trim() : null;
    if (!email) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
    const tenant = await getTenantByEmail(email);
    if (!tenant) return res.status(200).json({ ok: false, reason: 'TENANT_NOT_FOUND', message: 'Complete profile first' });
    if (!req.file || !req.file.buffer) return res.status(400).json({ ok: false, reason: 'FILE_REQUIRED' });
    const result = await uploadToOss(req.file.buffer, req.file.originalname || 'file', `tenant-${tenant._id}`);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    console.error('[tenantdashboard] upload', e?.message || e);
    const msg = e?.message || (typeof e === 'string' ? e : '');
    res.status(500).json({ ok: false, reason: msg || 'BACKEND_ERROR' });
  }
});

/** POST /api/tenantdashboard/create-payment – body: { tenancyId, type: 'meter'|'invoice', amount, referenceNumber, metadata?, returnUrl?, cancelUrl? }
 *  Returns { ok: true, type: 'redirect', url, provider? } or { ok: false, reason }.
 *  Uses client payment gateway: Payex (MY) or Stripe. Webhook/callback updates meter or rentalcollection.
 */
router.post('/create-payment', (req, res) => {
  withTenant(req, res, async (email) => {
    const { tenancyId, type, amount, referenceNumber, metadata = {}, returnUrl, cancelUrl } = req.body || {};
    if (!tenancyId || !type) {
      return { ok: false, reason: 'MISSING_TENANCY_ID_OR_TYPE' };
    }
    const tenant = await getTenantByEmail(email);
    if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
    const ok = await assertTenancyBelongsToTenant(tenant._id, tenancyId);
    if (!ok) return { ok: false, reason: 'TENANCY_MISMATCH' };
    const writable = await assertTenancyPortalWritable(tenant._id, tenancyId);
    if (!writable) return { ok: false, reason: 'TENANCY_READ_ONLY' };

    const amountCents = Math.max(100, Math.round(Number(amount) * 100));
    let clientId = null;
    const [tenancyRows] = await pool.query('SELECT client_id, room_id FROM tenancy WHERE id = ? LIMIT 1', [tenancyId]);
    if (tenancyRows.length && tenancyRows[0].client_id) clientId = tenancyRows[0].client_id;
    if (clientId) {
      const { getClientPaymentGateway, assertClientPaymentGatewayUsable } = require('../payment-gateway/payment-gateway.service');
      const gateway = await getClientPaymentGateway(clientId);
      if (gateway.currency === 'SGD' && gateway.provider === 'paynow') {
        return { ok: false, reason: 'PAYNOW_ONLY_FOR_SGD_OPERATOR' };
      }
      const connection = await assertClientPaymentGatewayUsable(clientId);
      if (!connection.ok) {
        return { ok: false, reason: connection.reason, provider: connection.provider, status: connection.status };
      }
    }
    const tenantName = (tenant.fullname || tenant.fullName || 'Tenant').trim().slice(0, 100) || 'Tenant';
    let roomName = '';
    if (tenancyRows.length && tenancyRows[0].room_id) {
      const [roomRows] = await pool.query('SELECT roomname FROM roomdetail WHERE id = ? LIMIT 1', [tenancyRows[0].room_id]);
      if (roomRows.length && roomRows[0].roomname) roomName = String(roomRows[0].roomname).trim().slice(0, 100);
    }
    let typeLabel = type === 'meter' ? 'Meter Top-up' : 'Invoice';
    const invoiceIds = Array.isArray(metadata.invoiceIds) ? metadata.invoiceIds : [];
    const invoiceIdsJoined = invoiceIds.join(',');
    const stripeInvoiceIdsMeta = invoiceIdsJoined.length <= 500 ? invoiceIdsJoined : '';
    const paymentReferenceNumber = String(referenceNumber || '').trim() || `INV-${String(tenancyId).slice(0, 8)}-${Date.now()}`;
    if (type === 'invoice' && invoiceIds.length > 0) {
      const [typeRows] = await pool.query(
        'SELECT a.title FROM rentalcollection r JOIN account a ON a.id = r.type_id WHERE r.id = ? AND r.tenancy_id = ? LIMIT 1',
        [invoiceIds[0], tenancyId]
      );
      if (typeRows.length && typeRows[0].title) typeLabel = String(typeRows[0].title).trim().slice(0, 80);
    }
    const description = `${tenantName} - ${typeLabel} - ${roomName || 'Room'}`.trim();
    let meterTransactionId = null;
    if (type === 'meter') {
      const roomId = tenancyRows.length && tenancyRows[0].room_id ? tenancyRows[0].room_id : null;
      if (roomId) {
        const [mRows] = await pool.query(
          'SELECT m.mode FROM roomdetail r INNER JOIN meterdetail m ON m.id = r.meter_id WHERE r.id = ? LIMIT 1',
          [roomId]
        );
        const mode = (mRows && mRows[0] && mRows[0].mode) ? String(mRows[0].mode).toLowerCase() : '';
        if (mode === 'postpaid') {
          return { ok: false, reason: 'METER_POSTPAID_NO_TOPUP' };
        }
      }
      const { randomUUID } = require('crypto');
      let propertyId = null;
      if (roomId) {
        const [roomRows] = await pool.query('SELECT property_id FROM roomdetail WHERE id = ? LIMIT 1', [roomId]);
        if (roomRows.length && roomRows[0].property_id) propertyId = roomRows[0].property_id;
      }
      meterTransactionId = randomUUID();
      const amountRm = (amountCents / 100).toFixed(2);
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      await pool.query(
        `INSERT INTO metertransaction (id, tenant_id, tenancy_id, property_id, amount, ispaid, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 'pending', ?, ?)`,
        [meterTransactionId, tenant._id, tenancyId, propertyId, amountRm, now, now]
      );
    }

    const { getClientPaymentGateway } = require('../payment-gateway/payment-gateway.service');
    const gateway = await getClientPaymentGateway(clientId);
    const portalBase = getPortalAppBaseUrl();
    const defaultSuccess = `${portalBase}/tenant/payment?success=1`;
    const defaultCancel = `${portalBase}/tenant/payment?cancel=1`;
    let successUrl = returnUrl || defaultSuccess;
    if (clientId) {
      successUrl = appendQueryParams(successUrl, { client_id: clientId });
    }
    const cancelUrlVal = cancelUrl || defaultCancel;
    if (type === 'invoice' && invoiceIds.length > 0 && clientId) {
      const placeholders = invoiceIds.map(() => '?').join(',');
      await pool.query(
        `UPDATE rentalcollection SET referenceid = ?, updated_at = NOW() WHERE id IN (${placeholders}) AND client_id = ?`,
        [paymentReferenceNumber, ...invoiceIds, clientId]
      );
    }

    if (gateway.provider === 'payex') {
      const refNum = paymentReferenceNumber;
      const apiBase = process.env.API_BASE_URL || process.env.PUBLIC_APP_URL || 'https://api.colivingjb.com';
      const callbackUrl = `${apiBase.replace(/\/$/, '')}/api/payex/callback`;
      const payexSuccessUrl = appendQueryParams(successUrl, {
        provider: 'payex',
        reference_number: refNum
      });
      const payex = require('../payex/payex.service');
      try {
        const result = await payex.createPayment(clientId, {
          amountCents,
          referenceNumber: refNum,
          description,
          customerName: tenantName,
          email: email || '',
          returnUrl: payexSuccessUrl,
          acceptUrl: payexSuccessUrl,
          rejectUrl: cancelUrlVal,
          callbackUrl,
          metadata: {
            type: type === 'meter' ? 'TenantMeter' : 'TenantInvoice',
            client_id: String(clientId),
            tenancy_id: String(tenancyId),
            tenant_id: String(tenant._id),
            amount_cents: String(amountCents),
            reference_number: refNum,
            invoice_ids: invoiceIdsJoined,
            ...(meterTransactionId ? { meter_transaction_id: String(meterTransactionId) } : {})
          },
          rentalIds: type === 'invoice' ? invoiceIds : undefined
        });
        return { ok: true, type: 'redirect', url: result.url, provider: 'payex' };
      } catch (e) {
        console.error('[tenantdashboard] create-payment payex', e?.message || e);
        const msg = e?.message || (typeof e === 'string' ? e : '');
        return { ok: false, reason: msg ? `PAYMENT_CREATE_FAILED: ${msg}` : 'PAYMENT_CREATE_FAILED' };
      }
    }

    if (gateway.provider === 'billplz') {
      const apiBase = process.env.API_BASE_URL || process.env.PUBLIC_APP_URL || 'https://api.colivingjb.com';
      const billplz = require('../billplz/billplz.service');
      const callbackUrl = appendQueryParams(`${apiBase.replace(/\/$/, '')}/api/billplz/callback`, {
        client_id: String(clientId),
        type: type === 'meter' ? 'TenantMeter' : 'TenantInvoice',
        tenancy_id: String(tenancyId),
        tenant_id: String(tenant._id),
        reference_number: paymentReferenceNumber,
        invoice_ids: invoiceIdsJoined,
        ...(meterTransactionId ? { meter_transaction_id: String(meterTransactionId) } : {})
      });
      const billplzSuccessUrl = appendQueryParams(successUrl, {
        provider: 'billplz',
        client_id: String(clientId),
        reference_number: paymentReferenceNumber,
        payment_type: type,
        ...(meterTransactionId ? { meter_transaction_id: String(meterTransactionId) } : {})
      });
      try {
        const result = await billplz.createPayment(clientId, {
          amountCents,
          referenceNumber: paymentReferenceNumber,
          description,
          customerName: tenantName,
          email: email || '',
          redirectUrl: billplzSuccessUrl,
          callbackUrl,
          type: type === 'meter' ? 'TenantMeter' : 'TenantInvoice'
        });
        return { ok: true, type: 'redirect', url: result.url, provider: 'billplz', billId: result.id };
      } catch (e) {
        console.error('[tenantdashboard] create-payment billplz', e?.message || e);
        const msg = e?.message || (typeof e === 'string' ? e : '');
        return { ok: false, reason: msg ? `PAYMENT_CREATE_FAILED: ${msg}` : 'PAYMENT_CREATE_FAILED' };
      }
    }

    const createCheckoutSession = require('../stripe/stripe.service').createCheckoutSession;
    const meta = {
      type: type === 'meter' ? 'TenantMeter' : 'TenantInvoice',
      client_id: String(clientId || ''),
      tenancy_id: String(tenancyId),
      tenant_id: String(tenant._id),
      reference_number: paymentReferenceNumber,
      amount_cents: String(amountCents),
      ...(stripeInvoiceIdsMeta ? { invoice_ids: stripeInvoiceIdsMeta } : {}),
      ...(meterTransactionId ? { meter_transaction_id: String(meterTransactionId) } : {}),
    };
    const doCreate = (cid) => createCheckoutSession({
      amountCents,
      currency: String(gateway.currency).toLowerCase(),
      email,
      description,
      returnUrl: appendQueryParams(successUrl, {
        provider: 'stripe',
        session_id: '{CHECKOUT_SESSION_ID}'
      }),
      cancelUrl: cancelUrlVal,
      clientId: cid,
      metadata: meta,
      allowPendingVerification: true
    });
    try {
      const result = await doCreate(clientId || undefined);
      return { ok: true, type: 'redirect', url: result.url, provider: 'stripe' };
    } catch (e) {
      console.error('[tenantdashboard] create-payment', e);
      const msg = e?.message || (typeof e === 'string' ? e : '');
      return { ok: false, reason: msg ? `PAYMENT_CREATE_FAILED: ${msg}` : 'PAYMENT_CREATE_FAILED' };
    }
  });
});

/** POST /api/tenantdashboard/create-payment-method-setup – body: { tenancyId, cancelUrl?, bindType?: 'card'|'bank_dd' }
 *  Stripe: Checkout mode=setup. Xendit: Payment Session SAVE (card). Webhook marks profile; Stripe also confirm-payment.
 */
router.post('/create-payment-method-setup', (req, res) => {
  withTenant(req, res, async (email) => {
    const { tenancyId, cancelUrl, bindType: bindTypeRaw } = req.body || {};
    const bindType = bindTypeRaw === 'bank_dd' ? 'bank_dd' : 'card';
    if (!tenancyId) {
      return { ok: false, reason: 'MISSING_TENANCY_ID' };
    }
    const tenant = await getTenantByEmail(email);
    if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
    const okTenancy = await assertTenancyBelongsToTenant(tenant._id, tenancyId);
    if (!okTenancy) return { ok: false, reason: 'TENANCY_MISMATCH' };
    const setupWritable = await assertTenancyPortalWritable(tenant._id, tenancyId);
    if (!setupWritable) return { ok: false, reason: 'TENANCY_READ_ONLY' };
    const [tenancyRows] = await pool.query('SELECT client_id FROM tenancy WHERE id = ? LIMIT 1', [tenancyId]);
    if (!tenancyRows.length || !tenancyRows[0].client_id) {
      return { ok: false, reason: 'TENANCY_NOT_FOUND' };
    }
    const clientId = tenancyRows[0].client_id;
    const { getClientPaymentGateway } = require('../payment-gateway/payment-gateway.service');
    const { assertClientPaymentGatewayUsable } = require('../payment-gateway/payment-gateway.service');
    const gateway = await getClientPaymentGateway(clientId);
    const connection = await assertClientPaymentGatewayUsable(clientId);
    if (!connection.ok) {
      return { ok: false, reason: connection.reason, provider: connection.provider, status: connection.status };
    }
    if (gateway.currency === 'SGD' && gateway.provider === 'paynow') {
      return { ok: false, reason: 'PAYMENT_METHOD_BIND_DISABLED' };
    }
    const pol = await getTenantPaymentMethodPolicyForClientId(clientId);
    if (pol === 'no_allow') {
      return { ok: false, reason: 'PAYMENT_METHOD_BIND_DISABLED' };
    }
    const portalBase = getPortalAppBaseUrl();
    const base = `${portalBase}/tenant/payment`;
    const cancelUrlVal = (cancelUrl && String(cancelUrl).trim()) || `${base}?setup_cancel=1`;

    if (gateway.provider === 'stripe') {
      const successUrl = appendQueryParams(`${base}?setup_success=1`, {
        session_id: '{CHECKOUT_SESSION_ID}',
        client_id: clientId,
        provider: 'stripe'
      });
      const { createTenantPaymentMethodSetupSession } = require('../stripe/stripe.service');
      try {
        const result = await createTenantPaymentMethodSetupSession({
          clientId,
          tenantId: tenant._id,
          email: email || '',
          returnUrl: successUrl,
          cancelUrl: cancelUrlVal,
          allowPendingVerification: true
        });
        return { ok: true, type: 'redirect', url: result.url, provider: 'stripe' };
      } catch (e) {
        console.error('[tenantdashboard] create-payment-method-setup stripe', e?.message || e);
        const msg = e?.message || (typeof e === 'string' ? e : '');
        return { ok: false, reason: msg ? `SETUP_CREATE_FAILED: ${msg}` : 'SETUP_CREATE_FAILED' };
      }
    }

    if (gateway.provider === 'payex') {
      const payex = require('../payex/payex.service');
      const successUrl = `${base}?xendit_setup=1`;
      try {
        const result = await payex.createPaymentSessionSaveForTenant(clientId, {
          tenantId: tenant._id,
          email: email || '',
          fullname: tenant.fullname || tenant.fullName,
          phone: tenant.phone,
          returnUrl: successUrl,
          cancelUrl: cancelUrlVal,
          bindType
        });
        return { ok: true, type: 'redirect', url: result.url, provider: 'payex' };
      } catch (e) {
        console.error('[tenantdashboard] create-payment-method-setup xendit', e?.message || e);
        const msg = e?.message || (typeof e === 'string' ? e : '');
        return { ok: false, reason: msg ? `SETUP_CREATE_FAILED: ${msg}` : 'SETUP_CREATE_FAILED' };
      }
    }

    if (gateway.provider === 'billplz') {
      return { ok: false, reason: 'PAYMENT_METHOD_SETUP_REQUIRES_STRIPE' };
    }

    return { ok: false, reason: 'UNSUPPORTED_PAYMENT_GATEWAY' };
  });
});

/** POST /api/tenantdashboard/disconnect-payment-method – body: { tenancyId }
 *  Removes saved Stripe card (detach) or Xendit token from profile; clears auto-debit flags.
 */
router.post('/disconnect-payment-method', (req, res) => {
  withTenant(req, res, async (email) => {
    const { tenancyId } = req.body || {};
    if (!tenancyId) return { ok: false, reason: 'MISSING_TENANCY_ID' };
    return disconnectTenantPaymentMethod(email, tenancyId);
  });
});

/** POST /api/tenantdashboard/submit-paynow-receipt – body: { tenancyId, receipt_url, amount, invoiceIds? }
 *  Tenant PayNow flow: one open ticket per tenancy — resubmit updates same payment_invoice + receipt (no duplicate tickets).
 *  Creates new row only when no PENDING_* paynow_tenant exists or previous was PAID/REJECTED.
 */
router.post('/submit-paynow-receipt', (req, res) => {
  withTenant(req, res, async (email) => {
    const { tenancyId, receipt_url: receiptUrl, amount, invoiceIds } = req.body || {};
    if (!tenancyId || !receiptUrl || amount == null) {
      return { ok: false, reason: 'MISSING_TENANCY_ID_OR_RECEIPT_OR_AMOUNT' };
    }
    const tenant = await getTenantByEmail(email);
    if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
    const ok = await assertTenancyBelongsToTenant(tenant._id, tenancyId);
    if (!ok) return { ok: false, reason: 'TENANCY_MISMATCH' };
    const paynowWritable = await assertTenancyPortalWritable(tenant._id, tenancyId);
    if (!paynowWritable) return { ok: false, reason: 'TENANCY_READ_ONLY' };
    const [tenancyRows] = await pool.query('SELECT client_id FROM tenancy WHERE id = ? LIMIT 1', [tenancyId]);
    if (!tenancyRows.length || !tenancyRows[0].client_id) {
      return { ok: false, reason: 'TENANCY_NOT_FOUND' };
    }
    const clientId = tenancyRows[0].client_id;
    const { getClientPaymentGateway } = require('../payment-gateway/payment-gateway.service');
    const gateway = await getClientPaymentGateway(clientId);
    if (gateway.currency === 'SGD' && gateway.provider !== 'paynow') {
      const [rows] = await pool.query(
        "SELECT values_json FROM client_integration WHERE client_id = ? AND `key` = 'paymentGateway' AND provider = ? AND enabled = 1 LIMIT 1",
        [clientId, gateway.provider]
      );
      const values = rows.length
        ? (typeof rows[0].values_json === 'string'
            ? (() => { try { return JSON.parse(rows[0].values_json || '{}'); } catch (_) { return {}; } })()
            : (rows[0].values_json || {}))
        : {};
      if (values.allow_paynow_with_gateway === false) {
        return { ok: false, reason: 'PAYNOW_DISABLED_FOR_OPERATOR' };
      }
    }
    const amountNum = Number(amount);
    if (Number.isNaN(amountNum) || amountNum <= 0) {
      return { ok: false, reason: 'INVALID_AMOUNT' };
    }
    const data = await upsertPaynowTenantReceipt(clientId, {
      receipt_url: receiptUrl,
      amount: amountNum,
      currency: 'SGD',
      external_type: 'paynow_tenant',
      external_invoice_id: tenancyId,
      reference_number: Array.isArray(invoiceIds) && invoiceIds.length > 0 ? invoiceIds.join(',') : null
    });
    try {
      await syncBankTransactionsFromFinverse(clientId, {});
    } catch (e) {
      // Finverse not linked or sync error – invoice stays PENDING_VERIFICATION
    }
    let status = data.status;
    try {
      const matchResult = await runMatchingForInvoice(clientId, data.id);
      if (matchResult && matchResult.status) status = matchResult.status;
    } catch (_) {
      // match may leave PENDING_REVIEW
    }
    return {
      ok: true,
      data: {
        id: data.id,
        status,
        resubmitted: data.updated === true,
        superseded_other: typeof data.superseded_other === 'number' ? data.superseded_other : 0
      }
    };
  });
});

/** POST /api/tenantdashboard/confirm-payment – body: { session_id, client_id? }
 *  After Stripe redirect to success URL. Marks invoices as paid if webhook did not run (idempotent).
 */
router.post('/confirm-payment', (req, res) => {
  withTenant(req, res, async (email) => {
    const {
      session_id: sessionId,
      client_id: clientId,
      provider: providerRaw,
      reference_number: referenceNumber,
      bill_id: billId,
      payment_type: paymentType,
      meter_transaction_id: meterTransactionId
    } = req.body || {};
    const provider = String(providerRaw || (sessionId ? 'stripe' : billId ? 'billplz' : referenceNumber ? 'payex' : '')).trim().toLowerCase();
    if (!provider || (provider === 'stripe' && !sessionId) || (provider === 'payex' && !referenceNumber) || (provider === 'billplz' && !billId)) {
      return { ok: false, reason: 'MISSING_CONFIRMATION_REFERENCE' };
    }
    const tenant = await getTenantByEmail(email);
    if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };
    const tenantId = tenant._id || tenant.id;
    if (!tenantId) return { ok: false, reason: 'TENANT_NOT_FOUND' };
    try {
      let out;
      if (provider === 'payex') {
        const { confirmInvoicePaymentByReference } = require('../payex/payex.service');
        out = await confirmInvoicePaymentByReference({
          clientId: clientId || null,
          tenantId,
          referenceNumber
        });
      } else if (provider === 'billplz') {
        const { confirmBillPayment } = require('../billplz/billplz.service');
        out = await confirmBillPayment({
          clientId: clientId || null,
          tenantId,
          billId,
          referenceNumber,
          paymentType,
          meterTransactionId
        });
      } else {
        const { confirmTenantCheckoutSession } = require('../stripe/stripe.service');
        out = await confirmTenantCheckoutSession(sessionId, clientId || null, tenantId);
      }
      if (!out.ok) {
        return { ok: false, reason: out.reason || 'CONFIRM_FAILED' };
      }
      return { ok: true, result: out.result };
    } catch (e) {
      console.error('[tenantdashboard] confirm-payment', e?.message || e);
      return { ok: false, reason: e?.message || 'CONFIRM_FAILED' };
    }
  });
});

module.exports = router;
