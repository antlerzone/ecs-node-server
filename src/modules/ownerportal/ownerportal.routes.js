/**
 * Owner Portal API – for Wix owner portal page.
 * All endpoints POST with email in body; owner resolved by email (ownerdetail.email).
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../../config/db');
const { getClientIp } = require('../../utils/requestIp');
const { uploadToOss } = require('../upload/oss.service');

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
}).single('file');
const { afterSignUpdate } = require('../agreement/agreement.service');
const downloadStore = require('../download/download.store');
const { generateOwnerReportPdf, generateCostPdf } = require('./ownerportal-pdf');
const { buildOwnerReportPdfBuffer } = require('../generatereport/generatereport-pdf');
const { getPayoutRowsForPdf } = require('../generatereport/generatereport.service');
const {
  getOwnerByEmail,
  getPropertyIdsByOwnerId,
  getPropertiesByIds,
  getRoomsByPropertyIds,
  getTenanciesByRoomIds,
  getClientsByIds,
  getBanks,
  updateOwnerProfile,
  getOwnerPayoutList,
  getCostList,
  getAgreementList,
  getAgreementTemplate,
  getAgreementById,
  updateAgreementSign,
  completeAgreementApproval,
  mergeOwnerMultiReference,
  removeApprovalPending,
  syncOwnerForClient,
  getRoomsWithLocksForOwner,
  remoteUnlockForOwner,
  getPasscodeForOwner,
  savePasscodeForOwner
} = require('./ownerportal.service');

async function getClientLogoUrl(clientId) {
  if (!clientId) return null;
  try {
    const [rows] = await pool.query('SELECT profilephoto FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
    return rows?.[0]?.profilephoto || null;
  } catch (_) {
    return null;
  }
}

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

/** Portal user can enter even when no ownerdetail row yet (nobody mapped). Return 200 so frontend can show empty state / profile form; never 404 for OWNER_NOT_FOUND. */
function withOwner(req, res, handler) {
  const email = getEmail(req);
  if (!email || !String(email).trim()) {
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  }
  handler(email).then(result => {
    if (result && result.ok === false && result.reason) {
      const status = result.reason === 'OWNER_NOT_FOUND' ? 200 : 403;
      return res.status(status).json(result);
    }
    res.json(result);
  }).catch(err => {
    console.error('[ownerportal]', err);
    res.status(500).json({ ok: false, reason: 'BACKEND_ERROR' });
  });
}

/** POST /api/ownerportal/upload – multipart form: file, email. Upload to OSS under owner folder. When no owner row yet, return 200 + reason so user can complete profile first. */
router.post('/upload', uploadMiddleware, async (req, res) => {
  try {
    const email = req.body?.email != null ? String(req.body.email).trim() : null;
    if (!email) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
    const owner = await getOwnerByEmail(email);
    if (!owner) return res.status(200).json({ ok: false, reason: 'OWNER_NOT_FOUND', message: 'Complete profile first' });
    if (!req.file || !req.file.buffer) return res.status(400).json({ ok: false, reason: 'FILE_REQUIRED' });
    const result = await uploadToOss(req.file.buffer, req.file.originalname || 'file', `owner-${owner._id}`);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    console.error('[ownerportal] upload', e?.message || e);
    const msg = e?.message || (typeof e === 'string' ? e : '');
    res.status(500).json({ ok: false, reason: msg || 'BACKEND_ERROR' });
  }
});

/** POST /api/ownerportal/owner – get owner by email. When no row yet (nobody mapped), return owner: null so portal can show profile form. */
router.post('/owner', (req, res) => {
  withOwner(req, res, async (email) => {
    const owner = await getOwnerByEmail(email);
    return { ok: true, owner: owner || null };
  });
});

/** POST /api/ownerportal/load-cms-data – owner + properties + rooms + tenancies. When no owner row yet, return empty so portal can show profile form. */
router.post('/load-cms-data', (req, res) => {
  withOwner(req, res, async (email) => {
    const owner = await getOwnerByEmail(email);
    if (!owner) return { ok: true, owner: null, properties: [], rooms: [], tenancies: [] };
    let propertyIds = Array.isArray(owner.property) ? owner.property : (owner.property_id ? [owner.property_id] : []);
    if (propertyIds.length === 0) propertyIds = await getPropertyIdsByOwnerId(owner._id);
    const properties = await getPropertiesByIds(propertyIds);
    const rooms = await getRoomsByPropertyIds(propertyIds);
    const roomIds = rooms.map(r => r._id);
    const tenancies = await getTenanciesByRoomIds(roomIds);
    return {
      ok: true,
      owner: { ...owner, property: properties },
      properties,
      rooms,
      tenancies
    };
  });
});

/** POST /api/ownerportal/clients – get clients by ids. When no owner row yet, return empty list. */
router.post('/clients', (req, res) => {
  withOwner(req, res, async (email) => {
    const owner = await getOwnerByEmail(email);
    const clientIds = owner ? (Array.isArray(owner.client) ? owner.client : (owner.client_id ? [owner.client_id] : [])) : [];
    const result = await getClientsByIds(clientIds);
    return { ok: true, ...result };
  });
});

/** POST /api/ownerportal/banks */
router.post('/banks', (req, res) => {
  getBanks().then(r => res.json(r)).catch(err => {
    console.error('[ownerportal] banks', err);
    res.status(500).json({ ok: false, reason: 'BACKEND_ERROR' });
  });
});

/** POST /api/ownerportal/update-profile */
router.post('/update-profile', (req, res) => {
  withOwner(req, res, (email) => updateOwnerProfile(email, req.body || {}));
});

/** POST /api/ownerportal/owner-payout-list – body: { propertyId, startDate, endDate } */
router.post('/owner-payout-list', (req, res) => {
  withOwner(req, res, (email) => getOwnerPayoutList(email, req.body || {}));
});

/** POST /api/ownerportal/cost-list – body: { propertyId, startDate, endDate, skip?, limit? } */
router.post('/cost-list', (req, res) => {
  withOwner(req, res, (email) => getCostList(email, req.body || {}));
});

/** POST /api/ownerportal/rooms-with-locks – list rooms with smart door for owner's properties */
router.post('/rooms-with-locks', (req, res) => {
  withOwner(req, res, (email) => getRoomsWithLocksForOwner(email));
});

/** POST /api/ownerportal/remote-unlock – body: { itemId }. itemId = "property:${propertyId}". TTLock remote unlock. */
router.post('/remote-unlock', (req, res) => {
  const itemId = req.body?.itemId || req.body?.roomId;
  if (!itemId) return res.status(400).json({ ok: false, reason: 'MISSING_ITEM_ID' });
  withOwner(req, res, (email) => remoteUnlockForOwner(email, itemId));
});

/** POST /api/ownerportal/passcode – body: { itemId }. Get owner passcode for property. */
router.post('/passcode', (req, res) => {
  const itemId = req.body?.itemId || req.body?.roomId;
  if (!itemId) return res.status(400).json({ ok: false, reason: 'MISSING_ITEM_ID' });
  withOwner(req, res, (email) => getPasscodeForOwner(email, itemId));
});

/** POST /api/ownerportal/passcode-save – body: { itemId, newPassword }. Set owner passcode for property. */
router.post('/passcode-save', (req, res) => {
  const itemId = req.body?.itemId || req.body?.roomId;
  const newPassword = req.body?.newPassword;
  if (!itemId) return res.status(400).json({ ok: false, reason: 'MISSING_ITEM_ID' });
  if (!newPassword) return res.status(400).json({ ok: false, reason: 'MISSING_PASSWORD' });
  withOwner(req, res, (email) => savePasscodeForOwner(email, itemId, newPassword));
});

/** POST /api/ownerportal/agreement-list – body: { ownerId } */
router.post('/agreement-list', (req, res) => {
  withOwner(req, res, (email) => getAgreementList(email, req.body?.ownerId));
});

/** POST /api/ownerportal/agreement-template – body: { templateId } */
router.post('/agreement-template', (req, res) => {
  const templateId = req.body?.templateId;
  if (!templateId) return res.status(400).json({ ok: false, reason: 'MISSING_TEMPLATE_ID' });
  getAgreementTemplate(templateId).then(tpl => {
    if (!tpl) return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    res.json({ ok: true, template: tpl });
  }).catch(err => {
    console.error('[ownerportal] agreement-template', err);
    res.status(500).json({ ok: false, reason: 'BACKEND_ERROR' });
  });
});

/** POST /api/ownerportal/agreement-get – body: { agreementId } */
router.post('/agreement-get', (req, res) => {
  const agreementId = req.body?.agreementId;
  if (!agreementId) return res.status(400).json({ ok: false, reason: 'MISSING_AGREEMENT_ID' });
  withOwner(req, res, async (email) => {
    const agreement = await getAgreementById(agreementId);
    if (!agreement) return { ok: false, reason: 'NOT_FOUND' };
    return { ok: true, agreement };
  });
});

/** POST /api/ownerportal/agreement-update-sign – body: { agreementId, ownersign, ownerSignedAt, status }. Records client IP. Hook: first sign→locked, full sign→final PDF. */
router.post('/agreement-update-sign', (req, res) => {
  const { agreementId, ownersign, ownerSignedAt, status } = req.body || {};
  if (!agreementId) return res.status(400).json({ ok: false, reason: 'MISSING_AGREEMENT_ID' });
  const ownerSignedIp = getClientIp(req);
  withOwner(req, res, async (email) => {
    const result = await updateAgreementSign(email, agreementId, { ownersign, ownerSignedAt, status, ownerSignedIp });
    if (result && result.ok) {
      try {
        await afterSignUpdate(agreementId);
      } catch (hookErr) {
        console.error('[ownerportal] afterSignUpdate', hookErr?.message || hookErr);
      }
    }
    return result;
  });
});

/** POST /api/ownerportal/complete-agreement-approval – body: { ownerId, propertyId, clientId, agreementId } */
router.post('/complete-agreement-approval', (req, res) => {
  withOwner(req, res, (email) => completeAgreementApproval(email, req.body || {}));
});

/** POST /api/ownerportal/merge-owner-multi-reference – body: { ownerId, propertyId, clientId } */
router.post('/merge-owner-multi-reference', (req, res) => {
  withOwner(req, res, (email) => mergeOwnerMultiReference(email, req.body || {}));
});

/** POST /api/ownerportal/remove-approval-pending – body: { ownerId, propertyId, clientId } */
router.post('/remove-approval-pending', (req, res) => {
  withOwner(req, res, (email) => removeApprovalPending(email, req.body || {}));
});

/** POST /api/ownerportal/sync-owner-for-client – body: { ownerId, clientId } */
router.post('/sync-owner-for-client', (req, res) => {
  withOwner(req, res, (email) => syncOwnerForClient(email, req.body || {}));
});

/** POST /api/ownerportal/export-report-pdf – body: { propertyId, startDate, endDate }. Returns { downloadUrl }. */
router.post('/export-report-pdf', (req, res) => {
  withOwner(req, res, async (email) => {
    const { propertyId, startDate, endDate } = req.body || {};
    if (!startDate || !endDate) return { ok: false, reason: 'MISSING_PARAMS' };
    const payoutRes = await getOwnerPayoutList(email, { propertyId, startDate, endDate });
    if (!payoutRes.ok) return payoutRes;
    const items = payoutRes.items || [];
    let propertyName = 'All Properties';
    if (propertyId && String(propertyId).toLowerCase() !== 'all') {
      const [prop] = await getPropertiesByIds([propertyId]);
      propertyName = prop?.shortname || 'Unknown Property';
    }
    const buffer = await generateOwnerReportPdf({ items, propertyName, startDate, endDate });
    const baseUrl = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
    const filename = `${String(propertyName).replace(/\s+/g, '_')}_Owner_Report_${Date.now()}.pdf`;
    const token = downloadStore.set(buffer, filename, 'application/pdf');
    return { ok: true, downloadUrl: `${baseUrl}/api/download/${token}` };
  });
});

/** POST /api/ownerportal/owner-report-pdf-download – body: { payoutId }. Same PDF source as operator report history. */
router.post('/owner-report-pdf-download', (req, res) => {
  withOwner(req, res, async (email) => {
    const payoutId = req.body?.payoutId;
    if (!payoutId) return { ok: false, reason: 'MISSING_PAYOUT_ID' };
    const owner = await getOwnerByEmail(email);
    if (!owner) return { ok: false, reason: 'OWNER_NOT_FOUND' };
    let propertyIds = Array.isArray(owner.property) ? owner.property.map((p) => (typeof p === 'object' && p._id ? p._id : p)) : [];
    if (propertyIds.length === 0) propertyIds = await getPropertyIdsByOwnerId(owner._id);
    const [payoutRows] = await pool.query(
      'SELECT id, property_id, client_id FROM ownerpayout WHERE id = ? LIMIT 1',
      [payoutId]
    );
    if (!payoutRows.length) return { ok: false, reason: 'NOT_FOUND' };
    const payout = payoutRows[0];
    if (!propertyIds.includes(payout.property_id)) return { ok: false, reason: 'FORBIDDEN' };

    const { rows, propertyName, billPeriod } = await getPayoutRowsForPdf(payout.client_id, payoutId);
    const companyLogoUrl = await getClientLogoUrl(payout.client_id);
    const buffer = await buildOwnerReportPdfBuffer(
      rows,
      propertyName,
      billPeriod,
      { companyName: owner?.client?.[0]?.title, companyLogoUrl }
    );
    const filename = `${(billPeriod || 'Report').replace(/\s+/g, '_')}_${(propertyName || 'Property').replace(/\s+/g, '_')}.pdf`;
    const token = downloadStore.set(buffer, filename, 'application/pdf');
    const baseUrl = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
    return { ok: true, downloadUrl: `${baseUrl}/api/download/${token}` };
  });
});

/** POST /api/ownerportal/export-cost-pdf – body: { propertyId, startDate, endDate }. Returns { downloadUrl }. Fetches up to 2000 cost rows. */
router.post('/export-cost-pdf', (req, res) => {
  withOwner(req, res, async (email) => {
    const { propertyId, startDate, endDate } = req.body || {};
    if (!propertyId || !startDate || !endDate) return { ok: false, reason: 'MISSING_PARAMS' };
    const costRes = await getCostList(email, { propertyId, startDate, endDate, skip: 0, limit: 2000 });
    if (!costRes.ok) return costRes;
    const items = costRes.items || [];
    const [prop] = await getPropertiesByIds([propertyId]);
    const propertyName = prop?.shortname || 'Unknown Property';
    const buffer = await generateCostPdf({ items, propertyName });
    const baseUrl = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
    const filename = `${String(propertyName).replace(/\s+/g, '_')}_Cost_Report_${Date.now()}.pdf`;
    const token = downloadStore.set(buffer, filename, 'application/pdf');
    return { ok: true, downloadUrl: `${baseUrl}/api/download/${token}` };
  });
});

module.exports = router;
