/**
 * Generate Report API – Owner Report / OwnerPayout (migrated from Wix backend/tenancy/ownerreport.jsw).
 * All endpoints require email (POST body) to resolve client via staff; then operations are scoped by client_id.
 */

const { Writable } = require('stream');
const archiver = require('archiver');
const express = require('express');
const router = express.Router();
const pool = require('../../config/db');
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
  finalizeOwnerReportPdf,
  getReportSettings,
  saveReportSettings,
  getOwnerReportDriveStatus
} = require('./generatereport.service');
const { voidOwnerReportPayment } = require('./generatereport-accounting.service');
const { linkExistingBukkuUrlsForOwnerPayout } = require('./generatereport-bukku-linkback.service');
const { buildOwnerReportPdfBuffer } = require('./generatereport-pdf');
const downloadStore = require('../download/download.store');

async function getClientLogoUrl(clientId) {
  if (!clientId) return null;
  try {
    const [rows] = await pool.query('SELECT profilephoto FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
    return rows?.[0]?.profilephoto || null;
  } catch (e) {
    console.warn('[generatereport] getClientLogoUrl failed:', e?.message || e);
    return null;
  }
}

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

function getPaymentDateFromBody(body) {
  return (
    body?.paymentDate ??
    body?.paymentdate ??
    body?.paidAt ??
    body?.paidat ??
    body?.datepickerpayment ??
    body?.date ??
    new Date()
  );
}

function getPaymentMethodFromBody(body) {
  return (
    body?.paymentMethod ??
    body?.paymentmethod ??
    body?.dropdownpaymentmethod ??
    body?.method ??
    'Cash'
  );
}

async function requireClient(req, res, next) {
  if (req.clientId != null && req.client) {
    req.ctx = { client: req.client };
    return next();
  }
  const email = getEmail(req);
  if (req.apiUser && !email) {
    return res.status(403).json({ ok: false, reason: 'API_USER_NOT_BOUND_TO_CLIENT', message: 'API user must be bound to a client to access this resource' });
  }
  if (req.apiUser && email) {
    try {
      const ctx = await getAccessContextByEmail(email);
      if (!ctx.ok) return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
      if (!ctx.client?.id) return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
      req.clientId = ctx.client.id;
      req.client = ctx.client;
      req.ctx = { client: ctx.client };
      return next();
    } catch (err) {
      return next(err);
    }
  }
  if (!email) return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  try {
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) {
      return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    }
    if (!ctx.client?.id) {
      return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
    }
    req.clientId = ctx.client.id;
    req.client = ctx.client;
    req.ctx = { client: ctx.client };
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
 * POST /api/generatereport/report-settings
 * Body: { email } -> { defaultCarryNegativeForward, automationEnabled, automationDay }
 */
router.post('/report-settings', requireClient, async (req, res, next) => {
  try {
    const settings = await getReportSettings(req.clientId);
    res.json({ ok: true, settings });
  } catch (err) {
    if (err.message === 'NO_CLIENT') return res.status(400).json({ ok: false, reason: err.message });
    next(err);
  }
});

/**
 * POST /api/generatereport/report-settings-save
 * Body: { email, defaultCarryNegativeForward?, automationEnabled?, automationDay? }
 */
router.post('/report-settings-save', requireClient, async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await saveReportSettings(req.clientId, {
      defaultCarryNegativeForward: body.defaultCarryNegativeForward,
      automationEnabled: body.automationEnabled,
      automationDay: body.automationDay,
      reportClassificationMode: body.reportClassificationMode,
      reportIncomeKeys: body.reportIncomeKeys,
      reportExpenseKeys: body.reportExpenseKeys
    });
    res.json(result);
  } catch (err) {
    if (err.message === 'NO_CLIENT') return res.status(400).json({ ok: false, reason: err.message });
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
      paymentDate: getPaymentDateFromBody(body),
      paymentMethod: getPaymentMethodFromBody(body),
      carryNegativeToNextMonth: body.carryNegativeToNextMonth
    });
    res.json(result);
  } catch (err) {
    if (err.message === 'NOT_FOUND') return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    next(err);
  }
});

/** POST alias for update (Next.js proxy only forwards POST). Body: { email, id, paid?, accountingStatus?, paymentDate?, paymentMethod? } */
router.post('/owner-report-update', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'MISSING_ID' });
    const body = req.body || {};
    const result = await updateOwnerReport(req.clientId, id, {
      paid: body.paid,
      accountingStatus: body.accountingStatus,
      paymentDate: getPaymentDateFromBody(body),
      paymentMethod: getPaymentMethodFromBody(body),
      carryNegativeToNextMonth: body.carryNegativeToNextMonth
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

/** POST alias for delete (Next.js proxy only forwards POST). Body: { email, id } */
router.post('/owner-report-delete', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'MISSING_ID' });
    await deleteOwnerReport(req.clientId, id);
    res.json({ success: true });
  } catch (err) {
    if (err.message === 'NOT_FOUND') return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    next(err);
  }
});

/**
 * POST /api/generatereport/owner-report-bukku-link-back
 * Read-only Bukku list/read; match amounts; UPDATE ownerpayout URLs. Body: { email, id, dryRun?, force? }
 */
router.post('/owner-report-bukku-link-back', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'MISSING_ID' });
    const dryRun = req.body?.dryRun === true;
    const force = req.body?.force === true;
    const result = await linkExistingBukkuUrlsForOwnerPayout(req.clientId, id, { dryRun, force });
    if (!result.ok) {
      const status =
        result.reason === 'PAYOUT_NOT_FOUND'
          ? 404
          : result.reason === 'AMBIGUOUS_INVOICE' || result.reason === 'AMBIGUOUS_BILL'
            ? 409
            : 400;
      return res.status(status).json(result);
    }
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/generatereport/owner-report-void-payment. Body: { email, id, skipAccountingVoid? } */
router.post('/owner-report-void-payment', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'MISSING_ID' });
    const result = await voidOwnerReportPayment(req.clientId, id, {
      skipAccountingVoid: req.body?.skipAccountingVoid === true
    });
    if (!result?.ok) {
      const details = Array.isArray(result?.errors) ? result.errors : [];
      const reason = details.length ? details.join('; ') : 'VOID_PAYMENT_FAILED';
      console.warn('[generatereport] owner-report-void-payment failed', {
        clientId: req.clientId,
        id,
        errors: details
      });
      return res.status(400).json({
        ok: false,
        reason,
        errors: details
      });
    }
    return res.json({ ok: true, result });
  } catch (err) {
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
    if (
      err.message === 'PROPERTY_NOT_FOUND' ||
      err.message === 'PROPERTY_PERCENTAGE_REQUIRED' ||
      err.message === 'PROPERTY_FIXED_RENT_TO_OWNER_REQUIRED'
    ) {
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
      paymentDate: getPaymentDateFromBody(body),
      paymentMethod: getPaymentMethodFromBody(body),
      carryNegativeToNextMonth: body.carryNegativeToNextMonth
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
 * Legacy owner-report PDF upload path (see service implementation).
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
    if (err.message && /missing|NOT_FOUND|FOLDER/i.test(err.message)) {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/generatereport/finalize-owner-report-pdf
 * Body: { payoutId, pdfUrl }
 * Finalize stored owner report PDF URL (server-side / trusted caller).
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
 * POST /api/generatereport/owner-report-pdf-download-inline
 * Body: { propertyId, propertyName, startDate, endDate }
 * Generates payout rows, builds PDF, returns download URL. Does NOT write to ownerpayout table.
 */
router.post('/owner-report-pdf-download-inline', requireClient, async (req, res, next) => {
  try {
    const { propertyId, propertyName, startDate, endDate } = req.body || {};
    if (!propertyId || !startDate || !endDate) return res.status(400).json({ ok: false, reason: 'MISSING_PROPERTY_OR_DATES' });
    const payoutData = await generateOwnerPayout(req.clientId, propertyId, propertyName || '', startDate, endDate);
    const billPeriod = `${startDate} - ${endDate}`;
    const companyLogoUrl = await getClientLogoUrl(req.clientId);
    const buffer = await buildOwnerReportPdfBuffer(
      payoutData.rows || [],
      propertyName || 'Unknown Property',
      billPeriod,
      { companyName: req.client?.title, companyLogoUrl }
    );
    const filename = `${(billPeriod || 'Report').replace(/\s+/g, '_')}_${(propertyName || 'Property').replace(/\s+/g, '_')}.pdf`;
    const token = downloadStore.set(buffer, filename, 'application/pdf');
    const baseUrl = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
    return res.json({ downloadUrl: `${baseUrl}/api/download/${token}` });
  } catch (err) {
    if (
      err.message === 'INVALID_DATE_RANGE' ||
      err.message === 'PROPERTY_NOT_FOUND' ||
      err.message === 'PROPERTY_PERCENTAGE_REQUIRED' ||
      err.message === 'PROPERTY_FIXED_RENT_TO_OWNER_REQUIRED'
    ) {
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
    const companyLogoUrl = await getClientLogoUrl(req.clientId);

    if (ids.length === 1) {
      const payoutId = ids[0];
      const { rows, propertyName, billPeriod } = await getPayoutRowsForPdf(req.clientId, payoutId);
      const buffer = await buildOwnerReportPdfBuffer(
        rows,
        propertyName,
        billPeriod,
        { companyName: req.client?.title, companyLogoUrl }
      );
      const filename = `${(billPeriod || 'Report').replace(/\s+/g, '_')}_${(propertyName || 'Property').replace(/\s+/g, '_')}.pdf`;
      const token = downloadStore.set(buffer, filename, 'application/pdf');
      const baseUrl = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
      return res.json({ downloadUrl: `${baseUrl}/api/download/${token}` });
    }

    const files = [];
    for (let i = 0; i < ids.length; i++) {
      const payoutId = ids[i];
      const { rows, propertyName, billPeriod } = await getPayoutRowsForPdf(req.clientId, payoutId);
      const buffer = await buildOwnerReportPdfBuffer(
        rows,
        propertyName,
        billPeriod,
        { companyName: req.client?.title, companyLogoUrl }
      );
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
 * POST /api/generatereport/owner-report-drive-status
 * Body: { id } -> { ok, exists, reason?, url? }
 */
router.post('/owner-report-drive-status', requireClient, async (req, res, next) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'MISSING_ID' });
    const result = await getOwnerReportDriveStatus(req.clientId, id);
    return res.json(result);
  } catch (err) {
    if (err.message === 'NOT_FOUND') return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
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
    const startDate = req.body?.startDate;
    const endDate = req.body?.endDate;
    if (!payoutId) return res.status(400).json({ ok: false, reason: 'MISSING_PAYOUT_ID' });
    let pdfInput = null;
    if (startDate && endDate) {
      const [payoutRows] = await pool.query(
        'SELECT property_id FROM ownerpayout WHERE id = ? AND client_id = ? LIMIT 1',
        [payoutId, req.clientId]
      );
      if (!payoutRows.length) return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
      const propertyId = payoutRows[0].property_id;
      const [propRows] = await pool.query('SELECT shortname FROM propertydetail WHERE id = ? LIMIT 1', [propertyId]);
      const propertyNameResolved = propRows[0]?.shortname || 'Unknown Property';
      const payoutData = await generateOwnerPayout(req.clientId, propertyId, propertyNameResolved, startDate, endDate);
      pdfInput = {
        rows: payoutData.rows || [],
        propertyName: propertyNameResolved,
        billPeriod: `${startDate} - ${endDate}`
      };
    } else {
      pdfInput = await getPayoutRowsForPdf(req.clientId, payoutId);
    }
    const { rows, propertyName, billPeriod } = pdfInput;
    const companyLogoUrl = await getClientLogoUrl(req.clientId);
    const buffer = await buildOwnerReportPdfBuffer(
      rows,
      propertyName,
      billPeriod,
      { companyName: req.client?.title, companyLogoUrl }
    );
    const fileName = `${(billPeriod || 'Report').replace(/\s+/g, '_')}_${(propertyName || 'Property').replace(/\s+/g, '_')}.pdf`;
    const result = await uploadOwnerReportPdfToDrive({
      buffer,
      fileName,
      payoutId,
      clientId: req.clientId
    });
    res.json(result);
  } catch (err) {
    if (
      err.message === 'NOT_FOUND' ||
      err.message === 'PROPERTY_NOT_FOUND' ||
      err.message === 'PROPERTY_FOLDER_NOT_SET' ||
      err.message === 'CROSS_CLIENT_ACCESS' ||
      err.message === 'GOOGLE_CREDENTIALS_NOT_CONFIGURED' ||
      err.message === 'DRIVE_UPLOAD_FAILED' ||
      err.message === 'PROPERTY_PERCENTAGE_REQUIRED' ||
      err.message === 'PROPERTY_FIXED_RENT_TO_OWNER_REQUIRED'
    ) {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

module.exports = router;
