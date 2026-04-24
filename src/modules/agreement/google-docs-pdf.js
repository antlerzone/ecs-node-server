/**
 * Generate PDF from Google Doc template using Google Docs API + Drive API.
 * Requires: template and folder shared with service account; env GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.
 */

const crypto = require('crypto');
const fs = require('fs');
const { PassThrough } = require('stream');
const { google } = require('googleapis');

const IMAGE_PLACEHOLDERS = [
  'sign',
  'ownersign',
  'tenantsign',
  'operatorsign',
  'operator_sign',
  'staff_sign',
  'client_sign',
  'operator_chop',
  'nricfront',
  'nricback',
  'staff_nricfront',
  'staff_nricback',
  'clientchop'
];
/** When there is no signature image URL yet, do NOT strip these placeholders (draft PDF). Clearing them broke final PDFs. */
const SIGNATURE_IMAGE_PLACEHOLDER_KEYS = new Set([
  'sign',
  'ownersign',
  'tenantsign',
  'operatorsign',
  'operator_sign',
  'staff_sign',
  'client_sign'
]);
const IMAGE_MAX_WIDTH_PT = 270;
const IMAGE_MAX_HEIGHT_PT = 120;

let _warnedMissingGoogleApplicationCredentialsFile = false;

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
  const keyPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (keyPath) {
    if (!fs.existsSync(keyPath)) {
      if (!_warnedMissingGoogleApplicationCredentialsFile) {
        _warnedMissingGoogleApplicationCredentialsFile = true;
        console.warn(
          '[google-docs-pdf] GOOGLE_APPLICATION_CREDENTIALS points to a missing file; ignoring (e.g. Linux path on Windows). Path:',
          keyPath
        );
      }
      return null;
    }
    return new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.file']
    });
  }
  return null;
}

/** client_email from SA JSON — for logs only (never log private_key). */
function getServiceAccountClientEmail() {
  try {
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (keyJson) {
      const key = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson;
      return key?.client_email || null;
    }
    const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (path && fs.existsSync(path)) {
      const key = JSON.parse(fs.readFileSync(path, 'utf8'));
      return key?.client_email || null;
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

function logDriveQuotaDiagnosis(err, context) {
  const errors = err?.response?.data?.error?.errors;
  const reasons = Array.isArray(errors) ? errors.map((e) => e.reason).filter(Boolean) : [];
  const isQuota = reasons.includes('storageQuotaExceeded') || /storage quota/i.test(String(err?.message || ''));
  if (!isQuota) return;
  const sa = getServiceAccountClientEmail();
  console.error(
    '[google-docs-pdf] storageQuotaExceeded diagnosis:',
    context,
    '| API identity is the SERVICE ACCOUNT',
    sa ? `(${sa})` : '(client_email unknown)',
    '| Google counts quota per identity: your browser “15 GB” is the HUMAN login;',
    'the SA has separate (often empty) Drive quota unless you use Shared drives or domain-wide delegation.',
    '| Fix: put Template + Folder on a Shared drive with SA as Content manager, or impersonate operator via delegation.'
  );
}

/** Shared drive / Team Drive: required on copy/export/delete when files live outside “My Drive” of the SA. */
const DRIVE_SUPPORTS_ALL_DRIVES = { supportsAllDrives: true };

/** Find all ranges in doc where searchText appears (by walking text runs). Returns [{ startIndex, endIndex }]. */
function findTextRanges(doc, searchText) {
  const ranges = [];
  if (!searchText || typeof searchText !== 'string') return ranges;
  const body = doc.data?.body?.content;
  if (!body) return ranges;

  function searchInRun(content, runStart, runEnd) {
    if (!content || runStart == null) return;
    let idx = 0;
    while ((idx = content.indexOf(searchText, idx)) !== -1) {
      const startIndex = runStart + idx;
      const endIndex = runStart + idx + searchText.length;
      if (endIndex <= runEnd) ranges.push({ startIndex, endIndex });
      idx += 1;
    }
  }

  function walk(elements) {
    if (!elements) return;
    for (const el of elements) {
      if (el.paragraph?.elements) {
        for (const run of el.paragraph.elements) {
          const content = run.textRun?.content;
          if (content != null && run.startIndex != null && run.endIndex != null) {
            searchInRun(content, run.startIndex, run.endIndex);
          }
        }
      }
      if (el.table?.tableRows) {
        for (const row of el.table.tableRows || []) {
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
  return ranges;
}

/** Placeholder patterns: {{key}}, [[key]], ((key)) — preview and real PDF use the same rules */
const PLACEHOLDER_REGEXES = [
  /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
  /\[\[\s*([a-zA-Z0-9_]+)\s*\]\]/g,
  /\(\(\s*([a-zA-Z0-9_]+)\s*\)\)/g
];

/** Find all {{key}}, [[key]], ((key)) indices; return { key: [{ startIndex, endIndex, raw }] } */
function findAllPlaceholderIndices(doc, variables) {
  const byKey = {};
  const body = doc.data?.body?.content;
  if (!body) return byKey;

  function searchInText(text, startIndex) {
    if (!text) return;
    for (const re of PLACEHOLDER_REGEXES) {
      re.lastIndex = 0;
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

/** Resolve image URL for insertInlineImage: Docs API requires a public URL (https only). */
function getImageUrl(val) {
  if (!val || typeof val !== 'string') return null;
  const s = val.trim();
  if (/^https?:\/\//i.test(s)) return s;
  return null;
}

/**
 * For preview (returnBufferOnly): put temp copy in platform folder to avoid "Drive storage quota exceeded" on operator's folder.
 * Set AGREEMENT_PREVIEW_TEMP_FOLDER_ID to a folder ID in the Service Account's Drive (create once via API or script).
 */
function getPreviewCopyParentFolderId(folderId, returnBufferOnly) {
  if (!returnBufferOnly) return folderId;
  const tempId = (process.env.AGREEMENT_PREVIEW_TEMP_FOLDER_ID || '').trim();
  return tempId || folderId;
}

/**
 * Generate PDF from Google Doc template.
 * @param {{ templateId: string, folderId: string, filename: string, variables: object, styleReplacedTextRed?: boolean, returnBufferOnly?: boolean, authClient?: object }}
 * @returns {Promise<{ pdfUrl: string, hash?: string } | { pdfBuffer: Buffer, hash: string }>}
 */
async function generatePdfFromTemplate({ templateId, folderId, filename, variables, styleReplacedTextRed, returnBufferOnly, authClient }) {
  const auth = authClient || getAuth();
  if (!auth) throw new Error('GOOGLE_CREDENTIALS_NOT_CONFIGURED');

  const usingOAuth = !!authClient;
  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });

  const baseName = filename || 'Agreement';
  /** Shown in Drive while processing; always deleted in `finally` (unless delete API fails). */
  const copyName = `__TEMP_PREVIEW__ ${baseName} ${Date.now()}`;
  const copyParentId = getPreviewCopyParentFolderId(folderId, returnBufferOnly);
  const usingTempFolder = returnBufferOnly && (process.env.AGREEMENT_PREVIEW_TEMP_FOLDER_ID || '').trim();
  const saEmail = getServiceAccountClientEmail();
  console.log(
    '[google-docs-pdf] copy: templateId=',
    templateId,
    'copyParentId=',
    copyParentId,
    'returnBufferOnly=',
    returnBufferOnly,
    'usingPreviewTempFolder=',
    !!usingTempFolder
  );
  if (usingOAuth) {
    console.log(
      '[google-docs-pdf] Drive API caller= GOOGLE OAUTH (operator-connected account)',
      '| PDFs use the connected user’s Drive/Docs quota, not the platform service account.'
    );
  } else {
    console.log(
      '[google-docs-pdf] Drive API caller= SERVICE ACCOUNT',
      saEmail ? `client_email=${saEmail}` : '(set GOOGLE_SERVICE_ACCOUNT_JSON to log client_email)',
      '| Human “My Drive 15 GB” in browser is NOT this identity — quota is separate.'
    );
  }

  let copyId = null;
  let exportRes;
  try {
    let copyRes;
    try {
      copyRes = await drive.files.copy({
        fileId: templateId,
        requestBody: { name: copyName, parents: [copyParentId] },
        ...DRIVE_SUPPORTS_ALL_DRIVES
      });
    } catch (err) {
      console.error('[google-docs-pdf] drive.files.copy failed:', err.message, 'code=', err.code, 'status=', err.response?.status, 'data=', JSON.stringify(err.response?.data || {}));
      logDriveQuotaDiagnosis(err, 'drive.files.copy');
      throw err;
    }
    copyId = copyRes.data.id;
    if (!copyId) throw new Error('COPY_FAILED');
    console.log('[google-docs-pdf] copy created copyId=', copyId, 'copyName=', copyName, 'parentFolder=', copyParentId);

    const docRes = await docs.documents.get({ documentId: copyId });
  const doc = docRes.data;
  const allIndices = findAllPlaceholderIndices({ data: doc }, variables);
  console.log('[google-docs-pdf] doc fetched, placeholderKeys=', Object.keys(allIndices).length);

  const requests = [];
  const seenRaw = new Set();
  /** For styleReplacedTextRed: track which keys we replaced so we can style their values */
  const replacedKeysValues = [];

  /** Standard placeholder spellings; Docs often splits `{{` / `name` across runs so per-run scan misses them — replaceAllText still matches. */
  function fallbackRawPatternsForKey(k) {
    return [`{{${k}}}`, `[[${k}}]`, `((${k}))`];
  }

  for (const [key, value] of Object.entries(variables || {})) {
    if (IMAGE_PLACEHOLDERS.includes(key.toLowerCase())) continue;
    const occurrences = allIndices[key];
    const replaceText = value != null ? String(value) : '';
    if (styleReplacedTextRed && replaceText) replacedKeysValues.push({ key, value: replaceText });
    const rawsToTry =
      occurrences?.length > 0
        ? [...new Set(occurrences.map((o) => o.raw))]
        : fallbackRawPatternsForKey(key);
    for (const raw of rawsToTry) {
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

  const BATCH_CHUNK = 45; // Avoid hitting Docs API limits on large docs
  if (requests.length) {
    for (let start = 0; start < requests.length; start += BATCH_CHUNK) {
      const chunk = requests.slice(start, start + BATCH_CHUNK);
      await docs.documents.batchUpdate({
        documentId: copyId,
        requestBody: { requests: chunk }
      });
    }
    console.log('[google-docs-pdf] replaceAllText done requests=', requests.length);
  }

  if (styleReplacedTextRed && replacedKeysValues.length > 0) {
    const docAfterReplace = await docs.documents.get({ documentId: copyId });
    const styleRequests = [];
    for (const { value } of replacedKeysValues) {
      const ranges = findTextRanges({ data: docAfterReplace.data }, value);
      for (const { startIndex, endIndex } of ranges) {
        styleRequests.push({
          updateTextStyle: {
            range: { startIndex, endIndex },
            textStyle: {
              foregroundColor: {
                color: { rgbColor: { red: 1, green: 0, blue: 0 } }
              }
            },
            fields: 'foregroundColor'
          }
        });
      }
    }
    if (styleRequests.length) {
      await docs.documents.batchUpdate({
        documentId: copyId,
        requestBody: { requests: styleRequests }
      });
      console.log('[google-docs-pdf] styleReplacedTextRed done styleRequests=', styleRequests.length);
    }
  }

  const docRes2 = await docs.documents.get({ documentId: copyId });
  const allIndices2 = findAllPlaceholderIndices({ data: docRes2.data }, variables);

  const imageRequests = [];
  const clearImageRequests = [];
  for (const key of IMAGE_PLACEHOLDERS) {
    const rawVal = variables?.[key];
    const url = getImageUrl(rawVal);
    const occurrences = allIndices2[key] || [];
    if (occurrences.length && SIGNATURE_IMAGE_PLACEHOLDER_KEYS.has(String(key).toLowerCase())) {
      const s = rawVal != null ? String(rawVal).trim() : '';
      if (s && !url) {
        const preview = s.slice(0, 48);
        console.warn(
          '[google-docs-pdf] signature placeholder not embeddable in Google Doc (Docs API needs public https image URL, not data-URL/base64):',
          'key=',
          key,
          'valuePrefix=',
          preview + (s.length > 48 ? '…' : ''),
          'occurrences=',
          occurrences.length,
          '| {{' + key + '}} will remain visible in exported PDF until signatures are stored as https URLs (e.g. upload to OSS/Drive first).'
        );
      }
    }
    for (const { startIndex, endIndex, raw } of occurrences) {
      if (url) {
        imageRequests.push({ key, startIndex, endIndex, raw, url });
      } else if (!SIGNATURE_IMAGE_PLACEHOLDER_KEYS.has(String(key).toLowerCase())) {
        clearImageRequests.push({
          replaceAllText: {
            containsText: { text: raw, matchCase: false },
            replaceText: ''
          }
        });
      }
      /* else: signature placeholders stay as {{sign}} etc. until final PDF has image URLs */
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

    console.log('[google-docs-pdf] exporting copyId=', copyId, 'to PDF');
    try {
      exportRes = await drive.files.export(
        { fileId: copyId, mimeType: 'application/pdf', ...DRIVE_SUPPORTS_ALL_DRIVES },
        { responseType: 'arraybuffer' }
      );
    } catch (err) {
      console.error('[google-docs-pdf] drive.files.export failed:', err.message, 'code=', err.code, 'status=', err.response?.status, 'data=', JSON.stringify(err.response?.data || {}));
      logDriveQuotaDiagnosis(err, 'drive.files.export');
      throw err;
    }
  } finally {
    if (copyId) {
      try {
        await drive.files.delete({ fileId: copyId, ...DRIVE_SUPPORTS_ALL_DRIVES });
        console.log('[google-docs-pdf] temp Doc copy deleted copyId=', copyId);
      } catch (delErr) {
        console.warn('[google-docs-pdf] drive.files.delete (temp copy) failed:', delErr.message);
      }
    }
  }

  const pdfBuffer = Buffer.from(exportRes.data);
  const hash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
  console.log('[google-docs-pdf] pdfBuffer length=', pdfBuffer.length, 'hash=', hash.slice(0, 12) + '...');

  if (returnBufferOnly) {
    return { pdfBuffer, hash };
  }

  // googleapis multipart upload expects a stream with .pipe (PassThrough is more reliable than Readable.from for some versions)
  const pdfStream = new PassThrough();
  pdfStream.end(Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer));
  const pdfFile = await drive.files.create({
    requestBody: {
      name: `${baseName}.pdf`,
      parents: [folderId],
      mimeType: 'application/pdf'
    },
    media: {
      mimeType: 'application/pdf',
      body: pdfStream
    },
    ...DRIVE_SUPPORTS_ALL_DRIVES
  });

  const pdfId = pdfFile.data.id;
  if (!pdfId) throw new Error('PDF_CREATE_FAILED');

  await drive.permissions.create({
    fileId: pdfId,
    requestBody: {
      role: 'reader',
      type: 'anyone'
    },
    ...DRIVE_SUPPORTS_ALL_DRIVES
  });

  const linkRes = await drive.files.get({
    fileId: pdfId,
    fields: 'webViewLink, webContentLink',
    ...DRIVE_SUPPORTS_ALL_DRIVES
  });
  const pdfUrl = linkRes.data.webContentLink || linkRes.data.webViewLink || `https://drive.google.com/file/d/${pdfId}/view`;
  return { pdfUrl, hash };
}

/**
 * Upload an in-memory PDF to a Drive folder (same pattern as end of generatePdfFromTemplate).
 * @param {{ pdfBuffer: Buffer, fileName: string, folderId: string, authClient: object }}
 * @returns {Promise<string>} webContentLink or webViewLink
 */
async function uploadPdfBufferToDriveFolder({ pdfBuffer, fileName, folderId, authClient }) {
  const auth = authClient || getAuth();
  if (!auth) throw new Error('GOOGLE_CREDENTIALS_NOT_CONFIGURED');
  if (!pdfBuffer?.length) throw new Error('EMPTY_PDF_BUFFER');
  const drive = google.drive({ version: 'v3', auth });
  const baseName = (fileName || 'document').replace(/\.pdf$/i, '');
  const pdfStream = new PassThrough();
  pdfStream.end(Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer));
  const pdfFile = await drive.files.create({
    requestBody: {
      name: `${baseName}.pdf`,
      parents: [folderId],
      mimeType: 'application/pdf'
    },
    media: {
      mimeType: 'application/pdf',
      body: pdfStream
    },
    ...DRIVE_SUPPORTS_ALL_DRIVES
  });
  const pdfId = pdfFile.data.id;
  if (!pdfId) throw new Error('PDF_CREATE_FAILED');
  await drive.permissions.create({
    fileId: pdfId,
    requestBody: { role: 'reader', type: 'anyone' },
    ...DRIVE_SUPPORTS_ALL_DRIVES
  });
  const linkRes = await drive.files.get({
    fileId: pdfId,
    fields: 'webViewLink, webContentLink',
    ...DRIVE_SUPPORTS_ALL_DRIVES
  });
  return linkRes.data.webContentLink || linkRes.data.webViewLink || `https://drive.google.com/file/d/${pdfId}/view`;
}

/**
 * Export a Google Doc as HTML (read-only). Uses Drive API files.export — no copy, no extra Drive storage.
 * @param {string} fileId - Google Doc file id
 * @param {object} authClient - OAuth2 client or GoogleAuth (same as generatePdfFromTemplate)
 * @returns {Promise<string>}
 */
async function exportGoogleDocAsHtml(fileId, authClient) {
  const auth = authClient || getAuth();
  if (!auth) throw new Error('GOOGLE_CREDENTIALS_NOT_CONFIGURED');
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.export(
    { fileId, mimeType: 'text/html' },
    { responseType: 'text' }
  );
  const html = typeof res.data === 'string' ? res.data : String(res.data || '');
  if (!html.trim()) throw new Error('EMPTY_HTML_EXPORT');
  return html;
}

module.exports = { generatePdfFromTemplate, getAuth, exportGoogleDocAsHtml, uploadPdfBufferToDriveFolder };
