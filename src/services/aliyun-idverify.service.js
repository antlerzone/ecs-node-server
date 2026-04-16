/**
 * Alibaba Cloud ID Verification (cloudauth-intl) — eKYC_PRO for MY KL region.
 * Env: ALIYUN_ACCESS_KEY_ID, ALIYUN_ACCESS_KEY_SECRET,
 *      ALIYUN_IDVERIFY_REGION (default ap-southeast-3),
 *      ALIYUN_IDVERIFY_SECURITY_LEVEL (default 01 = easier testing; use 02 in production),
 *      PORTAL_FRONTEND_URL (ReturnUrl base).
 * Debug: default ON — logs full CheckResult `body` (sanitized: base64 → length placeholders). Set ALIYUN_EKYC_LOG_CHECK_RESULT=0 to disable.
 * Optional: ALIYUN_EKYC_ATTACH_SANITIZED_RESULT=1 — JSON response from POST /api/access/aliyun-idv/result includes `checkResultSanitized` (same sanitization as logs; restart API after .env change).
 */
const crypto = require('crypto');
const CloudauthClient = require('@alicloud/cloudauth-intl20220809').default;
const { Config } = require('@alicloud/openapi-core/dist/utils');
const { InitializeRequest } = require('@alicloud/cloudauth-intl20220809/dist/models/InitializeRequest');
const { CheckResultRequest } = require('@alicloud/cloudauth-intl20220809/dist/models/CheckResultRequest');

const REGION = process.env.ALIYUN_IDVERIFY_REGION || 'ap-southeast-3';
const SECURITY_LEVEL = process.env.ALIYUN_IDVERIFY_SECURITY_LEVEL || '01';
const SCENE_CODE = (process.env.ALIYUN_IDVERIFY_SCENE_CODE || 'cliv_pf_01').slice(0, 10);

/** @type {Map<string, { email: string, merchantBizId: string, docType: string, expires: number }>} */
const pendingByTransactionId = new Map();

const PENDING_TTL_MS = 45 * 60 * 1000;

function cleanupPending() {
  const now = Date.now();
  for (const [tid, v] of pendingByTransactionId.entries()) {
    if (!v || v.expires < now) pendingByTransactionId.delete(tid);
  }
}

setInterval(cleanupPending, 5 * 60 * 1000).unref();

function getEndpoint() {
  const useVpc = String(process.env.ALIYUN_IDVERIFY_USE_VPC || '').trim() === '1';
  if (useVpc) return `cloudauth-intl-vpc.${REGION}.aliyuncs.com`;
  return `cloudauth-intl.${REGION}.aliyuncs.com`;
}

let _client;
function getClient() {
  const accessKeyId = String(process.env.ALIYUN_ACCESS_KEY_ID || '').trim();
  const accessKeySecret = String(process.env.ALIYUN_ACCESS_KEY_SECRET || '').trim();
  if (!accessKeyId || !accessKeySecret) {
    const err = new Error('ALIYUN_ACCESS_KEY_ID/ALIYUN_ACCESS_KEY_SECRET not set');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  if (!_client) {
    const config = new Config({
      accessKeyId,
      accessKeySecret,
      regionId: REGION,
      endpoint: getEndpoint(),
    });
    _client = new CloudauthClient(config);
  }
  return _client;
}

function isIdVerifyConfigured() {
  return !!(String(process.env.ALIYUN_ACCESS_KEY_ID || '').trim() && String(process.env.ALIYUN_ACCESS_KEY_SECRET || '').trim());
}

function hashMerchantUserId(email) {
  const e = String(email || '').trim().toLowerCase();
  return crypto.createHash('sha256').update(e).digest('hex').slice(0, 32);
}

function parseJsonLenient(raw) {
  if (raw == null || raw === '') return null;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
    raw = raw.toString('utf8');
  } else if (raw instanceof Uint8Array && typeof raw !== 'string' && !Buffer.isBuffer(raw)) {
    raw = Buffer.from(raw).toString('utf8');
  } else if (typeof raw === 'object' && raw !== null) {
    return raw;
  }
  if (typeof raw !== 'string') return null;
  try {
    let x = JSON.parse(raw);
    if (typeof x === 'string') {
      try {
        x = JSON.parse(x);
      } catch {
        return x;
      }
    }
    return x;
  } catch {
    return null;
  }
}

function unwrapAliyunResultBlob(blob) {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(blob)) {
    return unwrapAliyunResultBlob(parseJsonLenient(blob) || {});
  }
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return blob || {};
  const o = { ...blob };
  if (o.result && typeof o.result === 'object' && !Array.isArray(o.result)) Object.assign(o, o.result);
  if (o.data && typeof o.data === 'object' && !Array.isArray(o.data)) Object.assign(o, o.data);
  return o;
}

/**
 * Darabonba models type Result.* as string, but runtime may be Buffer or pre-parsed object.
 * Portal merge/extract expects the same shape as HTTP JSON (stringified ExtIdInfo).
 */
function coerceSdkResultBlob(val) {
  if (val == null || val === '') return val;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) return val.toString('utf8');
  if (val instanceof Uint8Array && !(typeof Buffer !== 'undefined' && Buffer.isBuffer(val))) {
    return Buffer.from(val).toString('utf8');
  }
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return null;
    }
  }
  return String(val);
}

/** Field names only — avoid matching container keys like `ocrIdInfo` (substring "name"). */
const NAME_FIELD_RE =
  /^(name|englishName|EnglishName|english_name|fullName|FullName|full_name|customerName|CustomerName|displayName|DisplayName|legalName|LegalName|primaryName|holderName|surname|givenname|givenName|Surname|GivenName)$/i;
const ID_FIELD_RE =
  /^(nric|NRIC|id_number|id_number_back|idNumber|IdNumber|IDNumber|icNumber|ICNumber|ic_no|IC_NO|passportNumber|PassportNumber|documentNumber|identityCardNumber|IdentityCardNumber)$/i;
const NESTED_OCR_KEY = /^(ocrIdInfo|OcrIdInfo|ocr_id_info|ocrIdEditInfo|OcrIdEditInfo|ocrIdBackInfo|OcrIdBackInfo)$/i;

/**
 * Inspect Alibaba CheckResult *Result* fields: which key paths look like name/ID (no values logged).
 * @returns {{ hasNameKey: boolean, hasIdKey: boolean, nameKeys: string[], idKeys: string[], keyCount: number }}
 */
function buildCheckResultNameIdHints(extIdInfo, extBasicInfo, ekycResult, extInfo) {
  const nameKeys = [];
  const idKeys = [];
  const allKeys = [];

  function visitLayer(prefix, raw, depth) {
    if (depth > 8) return;
    const o = unwrapAliyunResultBlob(parseJsonLenient(raw) || {});
    if (!o || typeof o !== 'object' || Array.isArray(o)) return;
    for (const k of Object.keys(o)) {
      const path = `${prefix}${k}`;
      allKeys.push(path);
      if (NAME_FIELD_RE.test(k)) nameKeys.push(path);
      if (ID_FIELD_RE.test(k)) idKeys.push(path);
      const v = o[k];
      if (NESTED_OCR_KEY.test(k) && v != null) {
        const inner = typeof v === 'string' ? parseJsonLenient(v) : v;
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
          for (const ik of Object.keys(inner)) {
            const p = `${prefix}${k}.${ik}`;
            allKeys.push(p);
            if (NAME_FIELD_RE.test(ik)) nameKeys.push(p);
            if (ID_FIELD_RE.test(ik)) idKeys.push(p);
          }
        }
      } else if (v != null && typeof v === 'object' && !Array.isArray(v) && depth < 3) {
        visitLayer(`${prefix}${k}.`, v, depth + 1);
      }
    }
  }

  visitLayer('extIdInfo.', extIdInfo, 0);
  visitLayer('extBasicInfo.', extBasicInfo, 0);
  visitLayer('ekycResult.', ekycResult, 0);
  visitLayer('extInfo.', extInfo, 0);

  const uniq = (arr) => [...new Set(arr)];

  /** True if some name-like field has a non-empty string (does not expose the value). */
  function hasNonEmptyNameString(raw) {
    const o = unwrapAliyunResultBlob(parseJsonLenient(raw) || {});
    function walk(val, depth) {
      if (depth > 10 || val == null) return false;
      if (typeof val === 'string') return false;
      if (typeof val !== 'object') return false;
      if (Array.isArray(val)) return val.some((x) => walk(x, depth + 1));
      for (const [k, v] of Object.entries(val)) {
        if (NAME_FIELD_RE.test(k) && typeof v === 'string' && v.trim().length >= 2) return true;
        if (typeof v === 'string' && NESTED_OCR_KEY.test(k)) {
          const inner = parseJsonLenient(v);
          if (inner && walk(inner, depth + 1)) return true;
        } else if (typeof v === 'object' && v && walk(v, depth + 1)) return true;
      }
      return false;
    }
    return walk(o, 0);
  }

  function hasNonEmptyIdString(raw) {
    const o = unwrapAliyunResultBlob(parseJsonLenient(raw) || {});
    function walk(val, depth) {
      if (depth > 10 || val == null) return false;
      if (typeof val === 'string') return false;
      if (typeof val !== 'object') return false;
      if (Array.isArray(val)) return val.some((x) => walk(x, depth + 1));
      for (const [k, v] of Object.entries(val)) {
        if (ID_FIELD_RE.test(k) && typeof v === 'string' && v.trim().length >= 4) return true;
        if (typeof v === 'string' && NESTED_OCR_KEY.test(k)) {
          const inner = parseJsonLenient(v);
          if (inner && walk(inner, depth + 1)) return true;
        } else if (typeof v === 'object' && v && walk(v, depth + 1)) return true;
      }
      return false;
    }
    return walk(o, 0);
  }

  const nameStringPresent =
    hasNonEmptyNameString(extIdInfo) ||
    hasNonEmptyNameString(extBasicInfo) ||
    hasNonEmptyNameString(ekycResult) ||
    hasNonEmptyNameString(extInfo);
  const idStringPresent =
    hasNonEmptyIdString(extIdInfo) ||
    hasNonEmptyIdString(extBasicInfo) ||
    hasNonEmptyIdString(ekycResult) ||
    hasNonEmptyIdString(extInfo);

  return {
    hasNameKey: nameKeys.length > 0,
    hasIdKey: idKeys.length > 0,
    nameKeys: uniq(nameKeys).slice(0, 80),
    idKeys: uniq(idKeys).slice(0, 80),
    keyCount: uniq(allKeys).length,
    nameStringPresent,
    idStringPresent,
  };
}

function shouldLogCheckResultBody() {
  const v = String(process.env.ALIYUN_EKYC_LOG_CHECK_RESULT || '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return true;
}

function looksLikeBase64ImageString(s) {
  if (typeof s !== 'string' || s.length < 64) return false;
  const t = s.replace(/\s/g, '');
  if (t.length < 64) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(t.slice(0, Math.min(300, t.length)));
}

/**
 * Deep-clone-safe sanitize: strips huge base64 blobs from idImage/idBackImage/faceImg and similar long alphanumeric strings.
 * OCR text fields (name, idNumber, etc.) are kept for troubleshooting.
 */
function sanitizeCheckResultPayloadForLog(val, depth) {
  if (depth > 22) return '[max-depth]';
  if (val == null) return val;
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    if (looksLikeBase64ImageString(val)) return `[base64-omitted:${val.length}]`;
    if (val.length > 8000) return `${val.slice(0, 400)}...[truncated:${val.length}]`;
    if ((val.startsWith('{') || val.startsWith('[')) && val.length < 500000) {
      const p = parseJsonLenient(val);
      if (p && typeof p === 'object') return sanitizeCheckResultPayloadForLog(p, depth + 1);
    }
    return val;
  }
  if (Array.isArray(val)) return val.map((x) => sanitizeCheckResultPayloadForLog(x, depth + 1));
  if (typeof val !== 'object') return val;
  const out = {};
  for (const [k, v] of Object.entries(val)) {
    if (/^(idImage|idBackImage|faceImg)$/i.test(k) && typeof v === 'string') {
      out[k] = looksLikeBase64ImageString(v) ? `[base64-omitted:${v.length}]` : sanitizeCheckResultPayloadForLog(v, depth + 1);
    } else {
      out[k] = sanitizeCheckResultPayloadForLog(v, depth + 1);
    }
  }
  return out;
}

function logSanitizedCheckResultBody(body) {
  if (!shouldLogCheckResultBody() || !body) return;
  try {
    const plain = JSON.parse(JSON.stringify(body));
    const sanitized = sanitizeCheckResultPayloadForLog(plain, 0);
    const line = JSON.stringify(sanitized);
    const max = 200000;
    console.log(
      '[aliyun-idv] CheckResult HTTP body (sanitized; ALIYUN_EKYC_LOG_CHECK_RESULT=0 to disable)',
      line.length > max ? `${line.slice(0, max)}...[log-truncated]` : line
    );
  } catch (e) {
    console.warn('[aliyun-idv] CheckResult body log failed', e && e.message);
  }
}

function shouldAttachSanitizedCheckResultToApi() {
  const v = String(process.env.ALIYUN_EKYC_ATTACH_SANITIZED_RESULT || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Same tree as logs, for attaching to API JSON (no raw base64). */
function getSanitizedCheckResultHttpBody(body) {
  if (!body) return null;
  try {
    const plain = JSON.parse(JSON.stringify(body));
    return sanitizeCheckResultPayloadForLog(plain, 0);
  } catch (e) {
    console.warn('[aliyun-idv] sanitize for API failed', e && e.message);
    return null;
  }
}

/** Small, safe summary for every /aliyun-idv/result response (no PII requirement beyond Alibaba codes). */
function buildCheckResultEcho(body) {
  const result = body && body.result;
  const ext = result && result.extIdInfo;
  const extBasic = result && result.extBasicInfo;
  const extInf = result && result.extInfo;
  const ekyc = result && result.ekycResult;
  return {
    requestId: body && body.requestId != null ? String(body.requestId) : null,
    code: body && body.code != null ? body.code : null,
    message: body && body.message != null ? String(body.message) : null,
    passed: result && result.passed != null ? String(result.passed) : null,
    subCode: result && result.subCode != null ? String(result.subCode) : null,
    resultKeys: result && typeof result === 'object' && !Array.isArray(result) ? Object.keys(result) : [],
    extIdInfoType: ext == null ? 'null' : typeof ext,
    extIdInfoLen: typeof ext === 'string' ? ext.length : null,
    extBasicInfoType: extBasic == null ? 'null' : typeof extBasic,
    extBasicInfoLen: typeof extBasic === 'string' ? extBasic.length : null,
    ekycResultType: ekyc == null ? 'null' : typeof ekyc,
    ekycResultLen: typeof ekyc === 'string' ? ekyc.length : null,
    extInfoType: extInf == null ? 'null' : typeof extInf,
    extInfoLen: typeof extInf === 'string' ? extInf.length : null,
  };
}

/** OpenAPI ClientError for 403 → stable app reason (RAM/policy on Alibaba side). */
function rethrowAliyunSdkError(err) {
  const status = err && (err.statusCode ?? err.status);
  const acode = String((err && err.code) || '');
  const msg = String((err && err.message) || err || '');
  if (status === 403 || acode.includes('Forbidden') || acode === 'Forbidden.NoPermission') {
    const e = new Error(msg);
    e.code = 'ALIYUN_FORBIDDEN';
    e.aliyunCode = acode;
    e.requestId = err && err.requestId;
    if (err && err.accessDeniedDetail) e.accessDeniedDetail = err.accessDeniedDetail;
    if (err && err.data) e.aliyunData = err.data;
    throw e;
  }
  throw err;
}

/**
 * @param {string} email
 * @param {{ metaInfo: string, docType: string, returnPath?: string }} opts
 */
async function initializeEkycPro(email, opts) {
  cleanupPending();
  const client = getClient();
  const metaInfo = String(opts.metaInfo || '').trim();
  if (!metaInfo) {
    const err = new Error('metaInfo required');
    err.code = 'MISSING_META_INFO';
    throw err;
  }
  const docType = String(opts.docType || 'MYS01001').trim();
  if (docType !== 'MYS01001' && docType !== 'GLB03002') {
    const err = new Error('Invalid docType');
    err.code = 'INVALID_DOC_TYPE';
    throw err;
  }
  const merchantBizId = (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')).replace(
    /-/g,
    '',
  ).slice(0, 32);
  const base = String(process.env.PORTAL_FRONTEND_URL || 'https://portal.colivingjb.com').replace(/\/$/, '');
  const path = String(opts.returnPath || '/demoprofile').startsWith('/')
    ? String(opts.returnPath || '/demoprofile')
    : `/${opts.returnPath || '/demoprofile'}`;
  const returnUrl = `${base}${path}?ekyc=1`;

  const initReq = new InitializeRequest({
    productCode: 'eKYC_PRO',
    merchantBizId,
    merchantUserId: hashMerchantUserId(email),
    metaInfo,
    docType,
    returnUrl,
    sceneCode: SCENE_CODE,
    securityLevel: SECURITY_LEVEL,
    model: 'LIVENESS',
  });

  let resp;
  try {
    resp = await client.initialize(initReq);
  } catch (err) {
    rethrowAliyunSdkError(err);
  }
  const body = resp && resp.body;
  const result = body && body.result;
  const transactionId = result && result.transactionId;
  const transactionUrl = result && result.transactionUrl;
  if (transactionId && transactionUrl) {
    pendingByTransactionId.set(transactionId, {
      email: String(email || '').trim().toLowerCase(),
      merchantBizId,
      docType,
      expires: Date.now() + PENDING_TTL_MS,
    });
    return { transactionId, transactionUrl, merchantBizId };
  }
  const code = body && body.code;
  const err = new Error((body && body.message) || 'Initialize failed');
  err.code = 'INIT_FAILED';
  err.aliyunCode = code;
  err.requestId = body && body.requestId;
  throw err;
}

/**
 * @param {string} email
 * @param {string} transactionId
 */
async function checkEkycResult(email, transactionId) {
  cleanupPending();
  const tid = String(transactionId || '').trim();
  const em = String(email || '').trim().toLowerCase();
  const pending = pendingByTransactionId.get(tid);
  const docType = pending && pending.docType ? String(pending.docType) : 'MYS01001';
  if (!pending || pending.email !== em) {
    const err = new Error('Unknown or expired session');
    err.code = 'SESSION_INVALID';
    throw err;
  }
  const client = getClient();
  const returnImg =
    process.env.ALIYUN_EKYC_RETURN_IMAGE === '0' || process.env.ALIYUN_EKYC_RETURN_IMAGE === 'false'
      ? 'N'
      : 'Y';
  const checkReq = new CheckResultRequest({
    transactionId: tid,
    merchantBizId: pending.merchantBizId,
    isReturnImage: returnImg,
  });
  let resp;
  try {
    resp = await client.checkResult(checkReq);
  } catch (err) {
    rethrowAliyunSdkError(err);
  }
  const body = resp && resp.body;
  const result = body && body.result;
  const passed = result && result.passed;
  if (result && (passed === 'Y' || passed === 'N')) {
    logSanitizedCheckResultBody(body);
    const extIdInfo = coerceSdkResultBlob(result.extIdInfo);
    const extBasicInfo = coerceSdkResultBlob(result.extBasicInfo);
    const ekycResult = coerceSdkResultBlob(result.ekycResult);
    const extInfo = coerceSdkResultBlob(result.extInfo);
    const resultHints = buildCheckResultNameIdHints(
      extIdInfo,
      extBasicInfo,
      ekycResult,
      extInfo
    );
    console.log('[aliyun-idv] CheckResult', {
      passed: passed === 'Y',
      subCode: result.subCode,
      ...resultHints,
    });
    if (passed === 'Y') {
      pendingByTransactionId.delete(tid);
    }
    const out = {
      passed: passed === 'Y',
      subCode: result.subCode,
      ekycResult,
      extIdInfo,
      extBasicInfo,
      extInfo,
      docType,
      resultHints,
      checkResultEcho: buildCheckResultEcho(body),
    };
    if (shouldAttachSanitizedCheckResultToApi()) {
      const san = getSanitizedCheckResultHttpBody(body);
      if (san) out.checkResultSanitized = san;
    }
    return out;
  }
  const code = body && body.code;
  const err = new Error((body && body.message) || 'CheckResult failed');
  err.code = 'CHECK_FAILED';
  err.aliyunCode = code;
  throw err;
}

module.exports = {
  isIdVerifyConfigured,
  initializeEkycPro,
  checkEkycResult,
  getSanitizedCheckResultHttpBody,
  buildCheckResultEcho,
};
