/**
 * Generate Report API – Owner Report / OwnerPayout (migrated from Wix backend/tenancy/ownerreport.jsw).
 * All endpoints require email (POST body) to resolve client via staff; then operations are scoped by client_id.
 */

const { Writable } = require('stream');
const archiver = require('archiver');
const express = require('express');
const router = express.Router();
const { getAccessContextByEmail } = require('../access/access.service');
const {
  getPropertiesForClient,
  getOwnerReports,
  getOwnerReportsTotal,
  getOwnerReport,
  getPayoutRowsForPdf,
  insertOwnerReport,
  updateOwnerReport,
  deleteOwnerReport,
  generateOwnerPayout,
  bulkUpdateOwnerReport,
  uploadOwnerReportPdfToDrive,
  finalizeOwnerReportPdf
} = require('./generatereport.service');
const { buildOwnerReportPdfBuffer } = require('./generatereport-pdf');
const downloadStore = require('../download/download.store');

/** Zip an array of { filename, buffer } into one Buffer. */
function zipBuffers(files) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const writable = new Writable({
      write(chunk, encoding, cb) {
        chunks.push(chunk);
        process.nextTick(cb);
      }
    });
    writable.on('finish', () => resolve(Buffer.concat(chunks)));
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    archive.pipe(writable);
    for (const f of files) {
      archive.append(f.buffer, { name: f.filename });
    }
    archive.finalize();
  });
}

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

async function requireClient(req, res, next) {
  const email = getEmail(req);
  if (!email) {
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  }
  try {
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) {
      return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    }
    if (!ctx.client?.id) {
      return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    }
    req.clientId = ctx.client.id;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/generatereport/properties
 * Body: { email }. Returns { items: [{ id, _id, shortname }] } for client.
 */
router.post('/properties', requireClient, async (req, res, next) => {
  try {
    const result = await getPropertiesForClient(req.clientId);
    const itemCount = Array.isArray(result.items) ? result.items.length : 0;
    console.log('[generatereport] POST /properties', { clientId: req.clientId, itemCount });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/generatereport/owner-reports
 * Body: { email, property?, from?, to?, search?, sort?, type?, page?, pageSize? }
 */
router.post('/owner-reports', requireClient, async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await getOwnerReports(req.clientId, {
      property: body.property,
      from: body.from,
      to: body.to,
      search: body.search,
      sort: body.sort,
      type: body.type,
      page: body.page,
      pageSize: body.pageSize,
      limit: body.limit
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/generatereport/owner-reports-total
 * Body: { email, ids: string[] }
 * Returns: { total, count } for selected report netpayout sum.
 */
router.post('/owner-reports-total', requireClient, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const result = await getOwnerReportsTotal(req.clientId, ids);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/generatereport/owner-report/:id
 * Query: email (or body for POST). Returns single report.
 */
router.get('/owner-report/:id', requireClient, async (req, res, next) => {
  try {
    const record = await getOwnerReport(req.clientId, req.params.id);
    if (!record) return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    res.json(record);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/generatereport/owner-report
 * Body: { email, property, period?, title?, totalrental, totalutility, totalcollection, expenses, managementfee?, netpayout, monthlyreport? }
 */
router.post('/owner-report', requireClient, async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await insertOwnerReport(req.clientId, {
      property: body.property,
      period: body.period,
      title: body.title,
      totalrental: body.totalrental,
      totalutility: body.totalutility,
      totalcollection: body.totalcollection,
      expenses: body.expenses,
      managementfee: body.managementfee,
      netpayout: body.netpayout,
      monthlyreport: body.monthlyreport
    });
    res.json(result);
  } catch (err) {
    if (err.message === 'PROPERTY_REQUIRED' || err.message === 'CROSS_CLIENT_ACCESS') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/**
 * PUT /api/generatereport/owner-report/:id
 * Body: { email, paid?, accountingStatus?, paymentDate?, paymentMethod? }
 */
router.put('/owner-report/:id', requireClient, async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await updateOwnerReport(req.clientId, req.params.id, {
      paid: body.paid,
      accountingStatus: body.accountingStatus,
      paymentDate: body.paymentDate,
      paymentMethod: body.paymentMethod
    });
    res.json(result);
  } catch (err) {
    if (err.message === 'NOT_FOUND') return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    next(err);
  }
});

/**
 * DELETE /api/generatereport/owner-report/:id
 * Body or query: email
 */
router.delete('/owner-report/:id', requireClient, async (req, res, next) => {
  try {
    await deleteOwnerReport(req.clientId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    if (err.message === 'NOT_FOUND') return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    next(err);
  }
});

/**
 * POST /api/generatereport/generate-payout
 * Body: { email, propertyId, propertyName, startDate, endDate }
 * Returns: { rows, totalrental, totalutility, totalcollection, expenses, managementfee, netpayout }
 */
router.post('/generate-payout', requireClient, async (req, res, next) => {
  try {
    const body = req.body || {};
    const { propertyId, propertyName, startDate, endDate } = body;
    console.log('[generatereport] POST /generate-payout', { clientId: req.clientId, propertyId, startDate, endDate });
    if (!propertyId || !startDate || !endDate) {
      return res.status(400).json({ ok: false, reason: 'MISSING_PARAMS' });
    }
    const result = await generateOwnerPayout(
      req.clientId,
      propertyId,
      propertyName || '',
      startDate,
      endDate
    );
    res.json(result);
  } catch (err) {
    if (err.message === 'PROPERTY_NOT_FOUND' || err.message === 'PROPERTY_PERCENTAGE_REQUIRED') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/generatereport/bulk-update
 * Body: { email, ids: string[], paid?, accountingStatus?, paymentDate?, paymentMethod? }
 */
router.post('/bulk-update', requireClient, async (req, res, next) => {
  try {
    const body = req.body || {};
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const result = await bulkUpdateOwnerReport(req.clientId, ids, {
      paid: body.paid,
      accountingStatus: body.accountingStatus,
      paymentDate: body.paymentDate,
      paymentMethod: body.paymentMethod
    });
    res.json(result);
  } catch (err) {
    if (err.message === 'INVALID_IDS' || err.message === 'CROSS_CLIENT_ACCESS') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/generatereport/create-owner-report-pdf
 * Body: { email, base64, fileName, payoutId }
 * Sends PDF to GAS; GAS will callback to finalize.
 */
router.post('/create-owner-report-pdf', requireClient, async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await createOwnerReportPdf({
      base64: body.base64,
      fileName: body.fileName,
      payoutId: body.payoutId
    });
    res.json(result);
  } catch (err) {
    if (err.message && /missing|NOT_FOUND|FOLDER|gas/.test(err.message)) {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/generatereport/finalize-owner-report-pdf
 * Body: { payoutId, pdfUrl }
 * Called by GAS callback (may use suppressAuth in Wix; here we do not require email for callback).
 */
router.post('/finalize-owner-report-pdf', async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await finalizeOwnerReportPdf(body.payoutId, body.pdfUrl);
    res.json(result);
  } catch (err) {
    if (err.message === 'NOT_FOUND' || err.message === 'missing_id_or_url') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/generatereport/owner-report-pdf-download
 * Body: { email, payoutId } or { email, ids: string[] }
 * - payoutId: single PDF download URL.
 * - ids (length 1): single PDF; ids (length > 1): zip of PDFs. Returns { downloadUrl }.
 */
router.post('/owner-report-pdf-download', requireClient, async (req, res, next) => {
  try {
    const body = req.body || {};
    const ids = Array.isArray(body.ids) ? body.ids : (body.payoutId ? [body.payoutId] : null);
    if (!ids || ids.length === 0) return res.status(400).json({ ok: false, reason: 'MISSING_PAYOUT_ID_OR_IDS' });

    if (ids.length === 1) {
      const payoutId = ids[0];
      const { rows, propertyName, billPeriod } = await getPayoutRowsForPdf(req.clientId, payoutId);
      const buffer = await buildOwnerReportPdfBuffer(rows, propertyName, billPeriod);
      const filename = `${(billPeriod || 'Report').replace(/\s+/g, '_')}_${(propertyName || 'Property').replace(/\s+/g, '_')}.pdf`;
      const token = downloadStore.set(buffer, filename, 'application/pdf');
      const baseUrl = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
      return res.json({ downloadUrl: `${baseUrl}/api/download/${token}` });
    }

    const files = [];
    for (let i = 0; i < ids.length; i++) {
      const payoutId = ids[i];
      const { rows, propertyName, billPeriod } = await getPayoutRowsForPdf(req.clientId, payoutId);
      const buffer = await buildOwnerReportPdfBuffer(rows, propertyName, billPeriod);
      const base = `${(billPeriod || 'Report').replace(/\s+/g, '_')}_${(propertyName || 'Property').replace(/\s+/g, '_')}`;
      const filename = `${base}_${payoutId}.pdf`;
      files.push({ filename, buffer });
    }
    const zipBuffer = await zipBuffers(files);
    const token = downloadStore.set(zipBuffer, 'OwnerReports.zip', 'application/zip');
    const baseUrl = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ downloadUrl: `${baseUrl}/api/download/${token}` });
  } catch (err) {
    if (err.message === 'NOT_FOUND' || err.message === 'PROPERTY_NOT_FOUND') {
      return res.status(404).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/generatereport/generate-and-upload-owner-report-pdf
 * Body: { email, payoutId }
 * Node generates PDF, uploads to property's Drive folder (propertydetail.folder), writes URL to ownerpayout.monthlyreport.
 */
router.post('/generate-and-upload-owner-report-pdf', requireClient, async (req, res, next) => {
  try {
    const payoutId = req.body?.payoutId;
    if (!payoutId) return res.status(400).json({ ok: false, reason: 'MISSING_PAYOUT_ID' });
    const { rows, propertyName, billPeriod } = await getPayoutRowsForPdf(req.clientId, payoutId);
    const buffer = await buildOwnerReportPdfBuffer(rows, propertyName, billPeriod);
    const fileName = `${(billPeriod || 'Report').replace(/\s+/g, '_')}_${(propertyName || 'Property').replace(/\s+/g, '_')}.pdf`;
    const result = await uploadOwnerReportPdfToDrive({
      buffer,
      fileName,
      payoutId,
      clientId: req.clientId
    });
    res.json(result);
  } catch (err) {
    if (err.message === 'NOT_FOUND' || err.message === 'PROPERTY_NOT_FOUND' || err.message === 'PROPERTY_FOLDER_NOT_SET' || err.message === 'CROSS_CLIENT_ACCESS' || err.message === 'GOOGLE_CREDENTIALS_NOT_CONFIGURED' || err.message === 'DRIVE_UPLOAD_FAILED') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

module.exports = router;
