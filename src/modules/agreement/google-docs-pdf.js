/**
 * Generate PDF from Google Doc template using Docs API + Drive API (no GAS).
 * Requires: template and folder shared with service account; env GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.
 */

const crypto = require('crypto');
const { google } = require('googleapis');

const IMAGE_PLACEHOLDERS = ['sign', 'ownersign', 'tenantsign', 'operatorsign', 'nricfront', 'nricback', 'clientchop'];
const IMAGE_MAX_WIDTH_PT = 270;
const IMAGE_MAX_HEIGHT_PT = 120;

function getAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (keyJson) {
    try {
      const key = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson;
      return new google.auth.GoogleAuth({
        credentials: key,
        scopes: ['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.file']
      });
    } catch (e) {
      return null;
    }
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.file']
    });
  }
  return null;
}

/** Find all {{key}} indices; return { key: [{ startIndex, endIndex, raw }] } */
function findAllPlaceholderIndices(doc, variables) {
  const byKey = {};
  const body = doc.data?.body?.content;
  if (!body) return byKey;

  function searchInText(text, startIndex) {
    if (!text) return;
    const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const key = m[1];
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push({
        startIndex: startIndex + m.index,
        endIndex: startIndex + m.index + m[0].length,
        raw: m[0]
      });
    }
  }

  function walk(elements) {
    if (!elements) return;
    for (const el of elements) {
      if (el.paragraph?.elements) {
        for (const run of el.paragraph.elements) {
          const content = run.textRun?.content;
          if (content != null && run.startIndex != null) searchInText(content, run.startIndex);
        }
      }
      if (el.table?.tableRows) {
        for (const row of el.table.tableRows) {
          for (const cell of row.tableCells || []) {
            walk(cell.content);
          }
        }
      }
    }
  }

  for (const el of body) {
    if (el.paragraph) walk([el]);
    if (el.table?.tableRows) {
      for (const row of el.table.tableRows) {
        for (const cell of row.tableCells || []) {
          walk(cell.content);
        }
      }
    }
  }
  return byKey;
}

/** Resolve image URL from variable value (base64 data URL or https URL) - caller must provide public URL for insertInlineImage */
function getImageUrl(val) {
  if (!val || typeof val !== 'string') return null;
  const s = val.trim();
  if (/^https?:\/\//i.test(s)) return s;
  return null;
}

/**
 * Generate PDF from Google Doc template.
 * @param {{ templateId: string, folderId: string, filename: string, variables: object }}
 * @returns {Promise<{ pdfUrl: string }>}
 */
async function generatePdfFromTemplate({ templateId, folderId, filename, variables }) {
  const auth = getAuth();
  if (!auth) throw new Error('GOOGLE_CREDENTIALS_NOT_CONFIGURED');

  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });

  const baseName = filename || 'Agreement';
  const copyName = `${baseName}_${Date.now()}`;

  const copyRes = await drive.files.copy({
    fileId: templateId,
    requestBody: { name: copyName, parents: [folderId] }
  });
  const copyId = copyRes.data.id;
  if (!copyId) throw new Error('COPY_FAILED');

  const docRes = await docs.documents.get({ documentId: copyId });
  const doc = docRes.data;
  const allIndices = findAllPlaceholderIndices({ data: doc }, variables);

  const requests = [];
  const seenRaw = new Set();

  for (const [key, value] of Object.entries(variables || {})) {
    if (IMAGE_PLACEHOLDERS.includes(key.toLowerCase())) continue;
    const occurrences = allIndices[key];
    if (!occurrences?.length) continue;
    const replaceText = value != null ? String(value) : '';
    for (const { raw } of occurrences) {
      if (seenRaw.has(raw)) continue;
      seenRaw.add(raw);
      requests.push({
        replaceAllText: {
          containsText: { text: raw, matchCase: false },
          replaceText
        }
      });
    }
  }

  if (requests.length) {
    await docs.documents.batchUpdate({
      documentId: copyId,
      requestBody: { requests }
    });
  }

  const docRes2 = await docs.documents.get({ documentId: copyId });
  const allIndices2 = findAllPlaceholderIndices({ data: docRes2.data }, variables);

  const imageRequests = [];
  const clearImageRequests = [];
  for (const key of IMAGE_PLACEHOLDERS) {
    const url = getImageUrl(variables?.[key]);
    const occurrences = allIndices2[key] || [];
    for (const { startIndex, endIndex, raw } of occurrences) {
      if (url) {
        imageRequests.push({ key, startIndex, endIndex, raw, url });
      } else {
        clearImageRequests.push({
          replaceAllText: {
            containsText: { text: raw, matchCase: false },
            replaceText: ''
          }
        });
      }
    }
  }

  if (clearImageRequests.length) {
    await docs.documents.batchUpdate({
      documentId: copyId,
      requestBody: { requests: clearImageRequests }
    });
  }

  let imageRequestsToApply = imageRequests;
  if (imageRequests.length && clearImageRequests.length) {
    const docRes3 = await docs.documents.get({ documentId: copyId });
    const allIndices3 = findAllPlaceholderIndices({ data: docRes3.data }, variables);
    imageRequestsToApply = [];
    for (const key of IMAGE_PLACEHOLDERS) {
      const url = getImageUrl(variables?.[key]);
      if (!url) continue;
      const occurrences = allIndices3[key] || [];
      for (const { startIndex, endIndex, raw } of occurrences) {
        imageRequestsToApply.push({ startIndex, endIndex, raw, url });
      }
    }
    imageRequestsToApply.sort((a, b) => b.startIndex - a.startIndex);
  } else if (imageRequests.length) {
    imageRequestsToApply = [...imageRequests].sort((a, b) => b.startIndex - a.startIndex);
  }

  if (imageRequestsToApply.length) {
    const batch = [];
    for (const { startIndex, endIndex, raw, url } of imageRequestsToApply) {
      batch.push({
        insertInlineImage: {
          uri: url,
          location: { index: startIndex },
          objectSize: {
            height: { magnitude: IMAGE_MAX_HEIGHT_PT, unit: 'PT' },
            width: { magnitude: IMAGE_MAX_WIDTH_PT, unit: 'PT' }
          }
        }
      });
      batch.push({
        deleteContentRange: {
          range: { startIndex: startIndex + 1, endIndex: endIndex + 1 }
        }
      });
    }
    await docs.documents.batchUpdate({
      documentId: copyId,
      requestBody: { requests: batch }
    });
  }

  const exportRes = await drive.files.export(
    { fileId: copyId, mimeType: 'application/pdf' },
    { responseType: 'arraybuffer' }
  );

  await drive.files.delete({ fileId: copyId });

  const pdfBuffer = Buffer.from(exportRes.data);
  const hash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

  const pdfFile = await drive.files.create({
    requestBody: {
      name: `${baseName}.pdf`,
      parents: [folderId],
      mimeType: 'application/pdf'
    },
    media: {
      mimeType: 'application/pdf',
      body: pdfBuffer
    }
  });

  const pdfId = pdfFile.data.id;
  if (!pdfId) throw new Error('PDF_CREATE_FAILED');

  await drive.permissions.create({
    fileId: pdfId,
    requestBody: {
      role: 'reader',
      type: 'anyone'
    }
  });

  const linkRes = await drive.files.get({
    fileId: pdfId,
    fields: 'webViewLink, webContentLink'
  });
  const pdfUrl = linkRes.data.webContentLink || linkRes.data.webViewLink || `https://drive.google.com/file/d/${pdfId}/view`;
  return { pdfUrl, hash };
}

module.exports = { generatePdfFromTemplate, getAuth };
