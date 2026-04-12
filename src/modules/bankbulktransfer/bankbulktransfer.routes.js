/**
 * Bank bulk transfer API – migrated from Wix backend/access/bankbulktransfer.jsw.
 * All endpoints require email (POST body or GET query) for access context when generating files.
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail } = require('../access/access.service');
const { getClientAddonCapabilities } = require('../billing/billing.service');
const { getBankBulkTransferData, MAX_ITEMS_PER_FILE } = require('./bankbulktransfer.service');
const { buildBankFiles, zipBuffers, generateRefundCsv } = require('./bankbulktransfer-excel');
const downloadStore = require('../download/download.store');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

async function requireAccess(req, res, next) {
  const email = getEmail(req);
  if (!email) {
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  }
  try {
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) {
      return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    }
    req.ctx = ctx;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/bank-bulk-transfer
 * Body: { email, bank?, type?, ids? }
 * - If bank not provided: returns { banks: [{ label, value }] } (no auth required for bank list).
 * - If bank + type + ids: requires email for access, returns { success, billerPayments, bulkTransfers, accountNumber } or { success: false }.
 * Max ids length: MAX_ITEMS_PER_FILE (99).
 */
router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const { bank, type, ids } = body;

    if (!bank) {
      const result = await getBankBulkTransferData({});
      return res.json(result);
    }

    const email = getEmail(req);
    if (!email) {
      return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
    }
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) {
      return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    }

    const idList = Array.isArray(ids) ? ids : [];
    if (idList.length > MAX_ITEMS_PER_FILE) {
      return res.status(400).json({ ok: false, reason: 'MAX_ITEMS_EXCEEDED', max: MAX_ITEMS_PER_FILE });
    }

    const clientId = ctx.client?.id;
    if (clientId) {
      const caps = await getClientAddonCapabilities(clientId);
      if (!caps.hasBankBulkTransfer) {
        return res.status(403).json({ ok: false, reason: 'ADDON_REQUIRED', message: 'Bank Bulk Transfer addon is required' });
      }
    }

    const result = await getBankBulkTransferData({
      clientId,
      bank,
      type: type || '',
      ids: idList
    });
    res.json(result);
  } catch (err) {
    if (err.message && err.message.includes('Maximum')) {
      return res.status(400).json({ ok: false, reason: 'MAX_ITEMS_EXCEEDED', max: MAX_ITEMS_PER_FILE });
    }
    next(err);
  }
});

/**
 * POST /api/bank-bulk-transfer/files
 * Body: { email, bank, type, ids, fileIndex? }
 * Returns: { files: [ { filename, data: base64 }, ... ] } for direct download (no iframe).
 */
router.post('/files', async (req, res, next) => {
  try {
    const body = req.body || {};
    const { bank, type, ids, fileIndex } = body;
    const email = getEmail(req);
    if (!email) {
      return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
    }
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) {
      return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    }
    const idList = Array.isArray(ids) ? ids : [];
    if (!bank || !type || idList.length === 0) {
      return res.status(400).json({ ok: false, reason: 'MISSING_PARAMS' });
    }
    if (idList.length > MAX_ITEMS_PER_FILE) {
      return res.status(400).json({ ok: false, reason: 'MAX_ITEMS_EXCEEDED', max: MAX_ITEMS_PER_FILE });
    }
    const clientId = ctx.client?.id;
    if (clientId) {
      const caps = await getClientAddonCapabilities(clientId);
      if (!caps.hasBankBulkTransfer) {
        return res.status(403).json({ ok: false, reason: 'ADDON_REQUIRED', message: 'Bank Bulk Transfer addon is required' });
      }
    }
    const result = await getBankBulkTransferData({
      clientId,
      bank,
      type: type || '',
      ids: idList
    });
    if (!result || !result.success) {
      return res.json({ files: [] });
    }
    const index = Math.max(1, parseInt(fileIndex, 10) || 1);
    const built = buildBankFiles(result, index);
    let files = [];
    if (built.length > 1) {
      const zipBuffer = await zipBuffers(built);
      const acc = result.accountNumber || '3240130500';
      const dateStr = String(new Date().getDate()).padStart(2, '0') + String(new Date().getMonth() + 1).padStart(2, '0') + String(new Date().getFullYear()).slice(-2);
      files = [{ filename: `${acc}bank${dateStr}${String(index).padStart(2, '0')}.zip`, data: zipBuffer.toString('base64') }];
    } else {
      files = built.map(f => ({ filename: f.filename, data: f.buffer.toString('base64') }));
    }
    res.json({ files });
  } catch (err) {
    if (err.message && err.message.includes('Maximum')) {
      return res.status(400).json({ ok: false, reason: 'MAX_ITEMS_EXCEEDED', max: MAX_ITEMS_PER_FILE });
    }
    next(err);
  }
});

/** Max total ids for download-url; when >99 we split into multiple JP/PM files and put all in one zip. */
const MAX_TOTAL_IDS = 500;

function chunkIds(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * POST /api/bank-bulk-transfer/download-url
 * Body: { email, bank, type, ids, fileIndex? }
 * Returns: { urls: [ { filename, url }, ... ] } – one zip when ids>99 (JP01, JP02, …, PM01, PM02, …, errors.txt).
 */
router.post('/download-url', async (req, res, next) => {
  try {
    const body = req.body || {};
    const { bank, type, ids, fileIndex } = body;
    const email = getEmail(req);
    if (!email) {
      return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
    }
    const ctx = await getAccessContextByEmail(email);
    if (!ctx.ok) {
      return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
    }
    const idList = Array.isArray(ids) ? ids : [];
    if (!bank || !type || idList.length === 0) {
      return res.status(400).json({ ok: false, reason: 'MISSING_PARAMS' });
    }
    if (idList.length > MAX_TOTAL_IDS) {
      return res.status(400).json({ ok: false, reason: 'MAX_ITEMS_EXCEEDED', max: MAX_TOTAL_IDS });
    }
    const baseUrl = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
    const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const baseIndex = Math.max(1, parseInt(fileIndex, 10) || 1);

    if (idList.length <= MAX_ITEMS_PER_FILE) {
      const result = await getBankBulkTransferData({
        clientId: ctx.client?.id,
        bank,
        type: type || '',
        ids: idList
      });
      if (!result || !result.success) {
        return res.json({ urls: [] });
      }
      if (type === 'refund' && result.bulkTransfers && result.bulkTransfers.length > 0) {
        const csvBuffer = generateRefundCsv(result.bulkTransfers);
        const dateStr = String(new Date().getDate()).padStart(2, '0') + String(new Date().getMonth() + 1).padStart(2, '0') + String(new Date().getFullYear()).slice(-2);
        const csvFilename = `refund-publicbank-${dateStr}.csv`;
        const token = downloadStore.set(csvBuffer, csvFilename, 'text/csv');
        return res.json({ urls: [{ filename: csvFilename, url: `${baseUrl}/api/download/${token}` }] });
      }
      const built = buildBankFiles(result, baseIndex);
      let urls = [];
      if (built.length > 1) {
        const zipBuffer = await zipBuffers(built);
        const acc = result.accountNumber || '3240130500';
        const dateStr = String(new Date().getDate()).padStart(2, '0') + String(new Date().getMonth() + 1).padStart(2, '0') + String(new Date().getFullYear()).slice(-2);
        const zipFilename = `${acc}bank${dateStr}${String(baseIndex).padStart(2, '0')}.zip`;
        const token = downloadStore.set(zipBuffer, zipFilename, 'application/zip');
        urls = [{ filename: zipFilename, url: `${baseUrl}/api/download/${token}` }];
      } else {
        urls = built.map(f => {
          const token = downloadStore.set(f.buffer, f.filename, mime);
          return { filename: f.filename, url: `${baseUrl}/api/download/${token}` };
        });
      }
      return res.json({ urls });
    }

    const chunks = chunkIds(idList, MAX_ITEMS_PER_FILE);
    const allFiles = [];
    const allSkipped = [];
    let accountNumber = '3240130500';
    for (let i = 0; i < chunks.length; i++) {
      const result = await getBankBulkTransferData({
        clientId: ctx.client?.id,
        bank,
        type: type || '',
        ids: chunks[i]
      });
      if (result && result.success) {
        if (result.accountNumber) accountNumber = result.accountNumber;
        const built = buildBankFiles(result, baseIndex + i);
        for (const f of built) {
          if (f.filename !== 'errors.txt') allFiles.push(f);
        }
        if (result.skippedItems && result.skippedItems.length) {
          allSkipped.push(...result.skippedItems);
        }
      }
    }
    if (allSkipped.length > 0) {
      const lines = [
        'The following items were skipped from JomPay / Bulk Transfer due to incomplete supplier or property data. Please complete supplier or property details and retry.',
        '',
        'ID\t项目\t原因',
        ...allSkipped.map(s => `${s.id || ''}\t${(s.label || '').replace(/\t/g, ' ')}\t${s.reason || ''}`)
      ];
      allFiles.push({
        filename: 'errors.txt',
        buffer: Buffer.from(lines.join('\n'), 'utf8')
      });
    }
    const zipBuffer = await zipBuffers(allFiles);
    const dateStr = String(new Date().getDate()).padStart(2, '0') + String(new Date().getMonth() + 1).padStart(2, '0') + String(new Date().getFullYear()).slice(-2);
    const zipFilename = `${accountNumber}bank${dateStr}${String(baseIndex).padStart(2, '0')}.zip`;
    const token = downloadStore.set(zipBuffer, zipFilename, 'application/zip');
    res.json({ urls: [{ filename: zipFilename, url: `${baseUrl}/api/download/${token}` }] });
  } catch (err) {
    if (err.message && err.message.includes('Maximum')) {
      return res.status(400).json({ ok: false, reason: 'MAX_ITEMS_EXCEEDED', max: MAX_TOTAL_IDS });
    }
    next(err);
  }
});

module.exports = router;
