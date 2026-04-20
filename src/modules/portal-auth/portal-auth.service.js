/**
 * Portal 手動註冊／登入：存 portal_account（email + password_hash），登入時驗證密碼後回傳 getMemberRoles(email)。
 * Google/Facebook OAuth 登入：findOrCreateByGoogle / findOrCreateByFacebook 以 email 關聯，可建立或綁定 portal_account。
 */
const { randomUUID } = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../../config/db');
const { getMemberRoles, normalizeEmail } = require('../access/access.service');
const { uploadToOss } = require('../upload/oss.service');

const PORTAL_JWT_SECRET = process.env.PORTAL_JWT_SECRET || 'portal-jwt-secret-change-in-production';
/** Onboarding flows (/enquiry, etc.) need longer than a few minutes; override with PORTAL_JWT_EXPIRES_IN in .env */
const PORTAL_JWT_EXPIRES_IN = process.env.PORTAL_JWT_EXPIRES_IN || '12h';

const SALT_ROUNDS = 10;

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  if (typeof val !== 'string') return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function safeStringify(val) {
  if (val == null) return null;
  try {
    return JSON.stringify(val);
  } catch {
    return null;
  }
}

function firstNonEmptyStr(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    const t = String(v).trim();
    if (!t) continue;
    /** MY eKYC_PRO: englishName may be "?" while name holds the Roman legal line (same as sn). */
    if (t === '?' || t === '？') continue;
    return t;
  }
  return '';
}

/** Alibaba sometimes returns JSON-as-string twice; parse twice if needed. */
function parseJsonLenient(raw) {
  if (raw == null || raw === '') return null;
  /** cloudauth-intl SDK may return UTF-8 Buffer for Result.extIdInfo — must JSON.parse, not return as object. */
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
    raw = raw.toString('utf8');
  } else if (raw instanceof Uint8Array && typeof raw !== 'string' && !Buffer.isBuffer(raw)) {
    raw = Buffer.from(raw).toString('utf8');
  } else if (typeof raw === 'object' && raw !== null) {
    return raw;
  }
  if (typeof raw !== 'string') return null;
  let x = null;
  try {
    x = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof x === 'string') {
    try {
      return JSON.parse(x);
    } catch {
      return null;
    }
  }
  return x;
}

/**
 * Nested Result fields (ocrIdEditInfo, ocrIdInfo, …) may be UTF-8 Buffer — must parse JSON before merge/assign.
 * Plain objects pass through; strings parse; Buffer/Uint8Array → parseJsonLenient.
 */
function coerceAliyunJsonField(val) {
  if (val == null) return null;
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) return parseJsonLenient(val);
    if (val instanceof Uint8Array && !Buffer.isBuffer(val)) return parseJsonLenient(Buffer.from(val));
    return val;
  }
  if (typeof val === 'string') return parseJsonLenient(val);
  return null;
}

function unwrapAliyunBlob(blob) {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(blob)) {
    return unwrapAliyunBlob(parseJsonLenient(blob) || {});
  }
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return blob || {};
  const o = { ...blob };
  if (o.result && typeof o.result === 'object' && !Array.isArray(o.result)) {
    Object.assign(o, o.result);
  }
  if (o.data && typeof o.data === 'object' && !Array.isArray(o.data)) {
    Object.assign(o, o.data);
  }
  return o;
}

/** MY NRIC: 12 digits; OCR may return dashed or back-of-card longer numeric string — take first 12 digits. */
function normalizeMalaysianNric12Digits(raw) {
  if (raw == null || raw === '') return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length >= 12) return digits.slice(0, 12);
  return '';
}

function deepFindMalaysianIc12(val, depth = 0) {
  if (depth > 10 || val == null) return '';
  if (typeof val === 'string') {
    const t = val.replace(/[-\s]/g, '');
    if (/^\d{12}$/.test(t)) return val.trim();
    const norm = normalizeMalaysianNric12Digits(val);
    if (norm) return norm;
    return '';
  }
  if (typeof val !== 'object') return '';
  if (Array.isArray(val)) {
    for (const item of val) {
      const s = deepFindMalaysianIc12(item, depth + 1);
      if (s) return s;
    }
    return '';
  }
  for (const k of Object.keys(val)) {
    const s = deepFindMalaysianIc12(val[k], depth + 1);
    if (s) return s;
  }
  return '';
}

/**
 * Alibaba MY MyKad OCR often uses snake_case: id_number, name (see certificate-ocr-field-list).
 * eKYC_PRO may nest ocrIdInfo or duplicate keys under result/data.
 * Docs: ocrIdInfo / ocrIdBackInfo may be JSON strings; ShowOcrResult flow puts user-confirmed values in ocrIdEditInfo (merge last per blob).
 */
function mergeOcrCandidates(...blobs) {
  const out = {};
  for (const blob of blobs) {
    if (!blob || typeof blob !== 'object' || Array.isArray(blob)) continue;
    const mergeLayer = (v) => {
      if (v == null) return;
      const x = coerceAliyunJsonField(v);
      if (x && typeof x === 'object' && !Array.isArray(x)) Object.assign(out, x);
    };
    /** MY eKYC_PRO: certificate slots under ocrIdInfoData.{sideId} — merge text before user-confirmed ocrIdEditInfo. */
    const mergeOcrIdInfoDataTextSlots = () => {
      const data = blob.ocrIdInfoData || blob.OcrIdInfoData;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      for (const slot of Object.values(data)) {
        if (!slot || typeof slot !== 'object' || Array.isArray(slot)) continue;
        for (const [k, v] of Object.entries(slot)) {
          if (
            /^(idImage|IdImage|id_image|idBackImage|IdBackImage|id_back_image|faceImg|FaceImg|portraitImage|PortraitImage)$/i.test(
              k
            )
          )
            continue;
          if (v != null && typeof v !== 'object') {
            /** Alibaba may send "" at slot top-level; do not wipe values merged from ocrIdEditInfo. */
            if (typeof v === 'string' && !String(v).trim()) continue;
            out[k] = v;
          }
        }
      }
    };
    mergeLayer(blob.ocrIdInfo || blob.OcrIdInfo || blob.ocr_id_info);
    mergeLayer(blob.ocrIdBackInfo || blob.OcrIdBackInfo);
    mergeOcrIdInfoDataTextSlots();
    mergeLayer(blob.ocrIdEditInfo || blob.OcrIdEditInfo);
    for (const k of Object.keys(blob)) {
      if (
        /^(ocrIdInfo|OcrIdInfo|ocr_id_info|ocrIdBackInfo|OcrIdBackInfo|ocrIdEditInfo|OcrIdEditInfo|ocrIdInfoData|OcrIdInfoData)$/i.test(
          k
        )
      )
        continue;
      const v = blob[k];
      if (v != null && typeof v !== 'object') {
        /** Top-level duplicate keys (e.g. name/religion as "") must not overwrite ocrIdEditInfo. */
        if (typeof v === 'string' && !String(v).trim()) continue;
        out[k] = v;
      }
    }
  }
  return out;
}

/** Walk tree; return first object that looks like an OCR id block (MY: id_number or idNumber + optional name). */
function deepFindOcrLikeObject(val, depth = 0) {
  if (depth > 14 || val == null) return null;
  if (typeof val === 'object' && !Array.isArray(val)) {
    const keys = Object.keys(val);
    const hasId = keys.some((k) =>
      /^(id_number|id_number_back|idNumber|IdNumber|ic_number|ICNumber|nric|NRIC|identityCardNumber|IdentityCardNumber|identity_no|IdentityNo|nric_no|NRIC_NO|ic_no|IC_NO)$/i.test(
        k
      )
    );
    const hasName = keys.some((k) =>
      /^(name|Name|englishName|EnglishName|english_name|fullName|FullName|nama|Nama|legalName|full_name)$/i.test(k)
    );
    if (hasId && hasName) return val;
    for (const k of keys) {
      const sub = deepFindOcrLikeObject(val[k], depth + 1);
      if (sub) return sub;
    }
  } else if (Array.isArray(val)) {
    for (const item of val) {
      const sub = deepFindOcrLikeObject(item, depth + 1);
      if (sub) return sub;
    }
  }
  return null;
}

function deepFindPassportNo(val, depth = 0) {
  if (depth > 10 || val == null) return '';
  if (typeof val === 'string') {
    const t = val.replace(/\s/g, '');
    if (t.length >= 6 && /^[A-Z0-9]+$/i.test(t)) return val.trim();
    return '';
  }
  if (typeof val !== 'object') return '';
  if (Array.isArray(val)) {
    for (const item of val) {
      const s = deepFindPassportNo(item, depth + 1);
      if (s) return s;
    }
    return '';
  }
  for (const k of Object.keys(val)) {
    if (/id|number|passport|document|ic|nric/i.test(k)) {
      const s = deepFindPassportNo(val[k], depth + 1);
      if (s) return s;
    }
  }
  for (const k of Object.keys(val)) {
    const s = deepFindPassportNo(val[k], depth + 1);
    if (s) return s;
  }
  return '';
}

/** Deep-walk Alibaba blobs for a human-readable name when flat merge missed (nested ocrIdInfoData / alternate keys). */
function deepFindPersonNameInTree(val, depth = 0) {
  if (depth > 18 || val == null) return '';
  if (typeof val !== 'object') return '';
  if (Array.isArray(val)) {
    for (const item of val) {
      const s = deepFindPersonNameInTree(item, depth + 1);
      if (s) return s;
    }
    return '';
  }
  const NAME_KEY_RE =
    /^(name|englishName|EnglishName|english_name|fullName|FullName|full_name|customerName|CustomerName|primaryName|legalName|LegalName|displayName|DisplayName|nama|Nama|holderName|holder_name|certificateName|givenName|GivenName|surname|Surname|localName|NameOnDocument)$/i;
  for (const [k, v] of Object.entries(val)) {
    if (typeof v !== 'string') continue;
    if (/^idImage|idBackImage|faceImg|portrait|base64|image$/i.test(k) && v.length > 120) continue;
    if (NAME_KEY_RE.test(k)) {
      const t = v.trim();
      if (t.length >= 2 && t.length <= 220) {
        const digitsOnly = t.replace(/\D/g, '');
        if (digitsOnly.length >= 10 && digitsOnly.length === t.replace(/\s/g, '').length) continue;
        return t;
      }
    }
  }
  for (const [k, v] of Object.entries(val)) {
    if (/faceImg|extFaceInfo|liveness|portraitImage/i.test(k)) continue;
    const s = deepFindPersonNameInTree(v, depth + 1);
    if (s) return s;
  }
  return '';
}

/** MY MyKad OCR: residential line under `address` in ocrIdEditInfo / nested JSON. */
/** Normalize passport / document expiry from Alibaba OCR (mixed formats) to YYYY-MM-DD for MySQL DATE. */
function normalizePassportExpiryToIsoDate(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const s0 = String(raw).trim();
  if (!s0) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s0);
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]);
    const d = Number(iso[3]);
    if (y >= 1950 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const test = new Date(Date.UTC(y, mo - 1, d));
      if (!Number.isNaN(test.getTime()) && test.getUTCFullYear() === y) {
        return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }
  const dmy =
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s0) || /^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/.exec(s0);
  if (dmy) {
    let day = Number(dmy[1]);
    let month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    if (month > 12) {
      const t = day;
      day = month;
      month = t;
    }
    const test = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(test.getTime())) return test.toISOString().slice(0, 10);
  }
  const compact8 = s0.replace(/\D/g, '');
  if (compact8.length === 8 && /^(19|20)\d{6}$/.test(compact8)) {
    const y = Number(compact8.slice(0, 4));
    const mo = Number(compact8.slice(4, 6));
    const d = Number(compact8.slice(6, 8));
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const test = new Date(Date.UTC(y, mo - 1, d));
      if (!Number.isNaN(test.getTime()) && test.getUTCFullYear() === y) {
        return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }

  const t = Date.parse(s0);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

/** MY / SG vs foreign — from passport OCR nationality / issuing country (Alibaba field names vary). */
function pickPassportNationalityHintFromObject(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return '';
  return firstNonEmptyStr(
    o.nationality,
    o.Nationality,
    o.nationalityCode,
    o.NationalityCode,
    o.issuingCountry,
    o.IssuingCountry,
    o.issuing_country,
    o.countryOfIssue,
    o.CountryOfIssue,
    o.country,
    o.Country,
    o.countryCode,
    o.CountryCode,
    o.documentIssuingCountry,
    o.passportNationality,
    o.issueCountry,
    o.IssueCountry
  );
}

function classifyPassportCountryHint(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toUpperCase();
  if (!s || s === '?' || s === '？') return null;
  if (s === 'MY' || s === 'MYS' || s === 'MALAYSIA' || s === 'MALAYSIAN' || s.includes('MALAYSIA')) return 'MY';
  if (s === 'SG' || s === 'SGP' || s === 'SINGAPORE' || s.includes('SINGAPORE')) return 'SG';
  return null;
}

/**
 * @returns {'MALAYSIAN_INDIVIDUAL'|'SINGAPORE_INDIVIDUAL'|'FOREIGN_INDIVIDUAL'}
 */
function inferPassportEntityTypeFromAliyunOcr(ext, ocrPick, basic, ekyc, extInf, ocr) {
  const hints = [];
  const eraw = ext.ocrIdEditInfo || ext.OcrIdEditInfo;
  const ed = eraw == null ? null : coerceAliyunJsonField(eraw);
  if (ed && typeof ed === 'object' && !Array.isArray(ed)) {
    hints.push(pickPassportNationalityHintFromObject(ed));
  }
  hints.push(
    pickPassportNationalityHintFromObject(ocrPick),
    pickPassportNationalityHintFromObject(basic),
    pickPassportNationalityHintFromObject(ekyc),
    pickPassportNationalityHintFromObject(extInf),
    pickPassportNationalityHintFromObject(ext),
    pickPassportNationalityHintFromObject(ocr)
  );
  for (const h of hints) {
    const c = classifyPassportCountryHint(h);
    if (c === 'MY') return 'MALAYSIAN_INDIVIDUAL';
    if (c === 'SG') return 'SINGAPORE_INDIVIDUAL';
  }
  return 'FOREIGN_INDIVIDUAL';
}

function pickPassportExpiryRawFromObject(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return '';
  return firstNonEmptyStr(
    o.expiryDate,
    o.ExpiryDate,
    o.expiry_date,
    o.expiryDateText,
    o.dateOfExpiry,
    o.date_of_expiry,
    o.DateOfExpiry,
    o.passportExpiryDate,
    o.passport_expiry_date,
    o.PassportExpiryDate,
    o.validUntil,
    o.valid_until,
    o.ValidUntil,
    o.validTo,
    o.validToDate,
    o.valid_to,
    o.documentExpiryDate,
    o.document_expiry_date,
    o.expireDate,
    o.ExpireDate,
    o.expirationDate,
    o.ExpirationDate,
    o.validityEndDate,
    o.ValidityEndDate,
    o.validity_end_date,
    o.expireTime,
    o.ExpireTime,
    o.expire_time,
    o.endDate,
    o.EndDate,
    o.end_date
  );
}

/**
 * Alibaba GLB03002 OCR may nest expiry under labels we do not list, or key/value rows — walk tree (bounded depth).
 * Skips obvious birth/issue fields when the key name distinguishes them.
 */
function deepFindPassportExpiryRawInTree(val, depth = 0) {
  if (depth > 18 || val == null) return '';
  if (typeof val === 'string') {
    const t = val.trim();
    if (t.length < 4 || t.length > 80 || !/\d/.test(t)) return '';
    const iso = normalizePassportExpiryToIsoDate(t);
    return iso ? t : '';
  }
  if (typeof val !== 'object') return '';
  if (Array.isArray(val)) {
    for (const item of val) {
      const s = deepFindPassportExpiryRawInTree(item, depth + 1);
      if (s) return s;
    }
    return '';
  }
  for (const [k, v] of Object.entries(val)) {
    const kl = String(k).toLowerCase();
    if (
      /birth|dateofbirth|dob|born|issue|issued|start|begin|fromdate|性别|出生|签发|发行/i.test(kl) &&
      !/expir|valid|到期|届满|失效|expire/i.test(kl)
    ) {
      continue;
    }
    if (/expir|validuntil|validto|valid_to|dateofexpir|到期|届满|失效|expire|validity|documentexpir/i.test(kl)) {
      if (typeof v === 'string') {
        const t = v.trim();
        if (normalizePassportExpiryToIsoDate(t)) return t;
      }
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const kn = String(v.key || v.name || v.label || v.field || '').toLowerCase();
      const vv = v.value ?? v.text ?? v.val ?? v.Value;
      if (
        kn &&
        /expir|valid|到期|届满|失效|expire|validity/i.test(kn) &&
        typeof vv === 'string' &&
        normalizePassportExpiryToIsoDate(vv.trim())
      ) {
        return vv.trim();
      }
    }
  }
  for (const v of Object.values(val)) {
    if (v != null && typeof v === 'object') {
      const s = deepFindPassportExpiryRawInTree(v, depth + 1);
      if (s) return s;
    }
  }
  return '';
}

function deepFindAddressInTree(val, depth = 0) {
  if (depth > 16 || val == null) return '';
  if (typeof val !== 'object') return '';
  if (Array.isArray(val)) {
    for (const item of val) {
      const s = deepFindAddressInTree(item, depth + 1);
      if (s) return s;
    }
    return '';
  }
  for (const [k, v] of Object.entries(val)) {
    if (/^address$/i.test(k) && typeof v === 'string') {
      const t = v.trim();
      if (t.length > 5 && t.length < 500) return t;
    }
  }
  for (const [k, v] of Object.entries(val)) {
    if (/faceImg|extFaceInfo|liveness/i.test(k)) continue;
    if (v != null && typeof v === 'object') {
      const s = deepFindAddressInTree(v, depth + 1);
      if (s) return s;
    }
  }
  return '';
}

/**
 * Legal name for MY MyKad: prefer Roman/English line (englishName) — matches agreements / Singpass-style "legal name".
 * @param {string} docType MYS01001 | GLB03002
 */
function extractAliyunEkycIdentity(docType, extIdInfoStr, extBasicInfoStr, ekycResultStr, extInfoStr) {
  const ext = unwrapAliyunBlob(parseJsonLenient(extIdInfoStr) || {});
  const basic = unwrapAliyunBlob(parseJsonLenient(extBasicInfoStr) || {});
  const ekyc = unwrapAliyunBlob(parseJsonLenient(ekycResultStr) || {});
  const extInf = unwrapAliyunBlob(parseJsonLenient(extInfoStr) || {});

  /** ExtIdInfo is authoritative; merge basic/ekyc/extInfo first, then ext so Result.ExtIdInfo wins. */
  const ocr = mergeOcrCandidates(basic, ekyc, extInf, ext);
  const ocrDeep = deepFindOcrLikeObject(ext) || deepFindOcrLikeObject(basic) || deepFindOcrLikeObject(ekyc) || deepFindOcrLikeObject(extInf);
  const ocrPick = mergeOcrCandidates(ocr, ocrDeep || {});

  let idNumber = firstNonEmptyStr(
    ocrPick.idNumber,
    ocrPick.IdNumber,
    ocrPick.id_number,
    ocrPick.id_number_back,
    ocrPick.IDNumber,
    ocrPick.icNumber,
    ocrPick.ICNumber,
    ocrPick.identityNumber,
    ocrPick.identityCardNumber,
    ocrPick.IdentityCardNumber,
    ocrPick.nric,
    ocrPick.NRIC,
    ocrPick.nric_no,
    ocrPick.ic_no,
    ocrPick.passportNumber,
    ocrPick.PassportNumber,
    ocrPick.documentNumber,
    ext.idNumber,
    basic.idNumber,
    basic.passportNumber,
    ekyc.idNumber,
    extInf.idNumber
  );
  if (!idNumber && docType === 'MYS01001') {
    idNumber =
      deepFindMalaysianIc12(ocrPick) ||
      deepFindMalaysianIc12(ocr) ||
      deepFindMalaysianIc12(ext) ||
      deepFindMalaysianIc12(basic) ||
      deepFindMalaysianIc12(ekyc) ||
      deepFindMalaysianIc12(extInf);
  }
  if (docType === 'MYS01001' && idNumber) {
    const compact = normalizeMalaysianNric12Digits(idNumber);
    if (compact) idNumber = compact;
  }
  if (!idNumber && docType === 'GLB03002') {
    idNumber =
      firstNonEmptyStr(
        ocrPick.passportNumber,
        ocrPick.PassportNumber,
        ocrPick.documentNumber,
        ext.passportNumber,
        basic.passportNumber
      ) ||
      deepFindPassportNo(ocrPick) ||
      deepFindPassportNo(ext);
  }

  let fullName = '';
  if (docType === 'MYS01001') {
    const editRaw = ext.ocrIdEditInfo || ext.OcrIdEditInfo;
    const editObj = editRaw == null ? null : coerceAliyunJsonField(editRaw);
    if (editObj && typeof editObj === 'object' && !Array.isArray(editObj)) {
      fullName = firstNonEmptyStr(
        editObj.name,
        editObj.Name,
        editObj.legalName,
        editObj.LegalName,
        editObj.englishName,
        editObj.EnglishName
      );
    }
  }
  if (docType === 'MYS01001' && !fullName) {
    fullName = firstNonEmptyStr(
      ocrPick.englishName,
      ocrPick.EnglishName,
      ocrPick.english_name,
      basic.englishName,
      basic.EnglishName,
      ext.englishName,
      ekyc.englishName,
      extInf.englishName,
      ocrPick.fullName,
      ocrPick.FullName,
      basic.fullName,
      basic.FullName,
      ekyc.fullName,
      ocrPick.name,
      ocrPick.Name,
      ocrPick.full_name,
      ocrPick.customerName,
      ocrPick.CustomerName,
      ocrPick.primaryName,
      ocrPick.nama,
      ocrPick.Nama,
      ocrPick.certificateName,
      ocrPick.localName,
      ocrPick.holderName,
      ocrPick.HolderName,
      /** MY doc: front field `name` (may be Malay script); prefer english* above */
      basic.name,
      basic.fullName,
      basic.nama,
      ext.name,
      ext.nama,
      ekyc.name,
      extInf.nama
    );
  }
  if (docType === 'GLB03002') {
    fullName = firstNonEmptyStr(
      ocrPick.fullName,
      ocrPick.FullName,
      ocrPick.name,
      ocrPick.Name,
      ocrPick.englishName,
      ocrPick.EnglishName,
      basic.fullName,
      basic.name,
      ext.name,
      ekyc.name
    );
  }

  if (!fullName) {
    const roots = [ext, basic, ekyc, extInf, ocrPick, ocr];
    for (const root of roots) {
      if (!root || typeof root !== 'object') continue;
      for (const k of Object.keys(root)) {
        if (!/name|nama|fullName|englishName|legalName|displayName|customerName/i.test(k)) continue;
        const v = root[k];
        if (typeof v === 'string' && v.trim()) {
          fullName = v.trim();
          break;
        }
      }
      if (fullName) break;
    }
  }
  if (!fullName) {
    for (const root of [ext, basic, ekyc, extInf, ocr, ocrPick]) {
      const n = deepFindPersonNameInTree(root);
      if (n) {
        fullName = n;
        break;
      }
    }
  }

  let address = firstNonEmptyStr(
    ocrPick.address,
    ocrPick.Address,
    ocrPick.fullAddress,
    ocrPick.FullAddress,
    ocrPick.registeredAddress,
    ocrPick.residentialAddress,
    ocrPick.ResidentialAddress,
    basic.address,
    ext.address,
    ekyc.address,
    extInf.address
  );
  if (!address) {
    for (const root of [ext, basic, ekyc, extInf, ocrPick, ocr]) {
      if (!root || typeof root !== 'object') continue;
      for (const k of Object.keys(root)) {
        if (!/^address$/i.test(k) && !/Address$/i.test(k)) continue;
        const v = root[k];
        if (typeof v === 'string' && v.trim().length > 3) {
          address = v.trim();
          break;
        }
      }
      if (address) break;
    }
  }
  if (!address) {
    address = deepFindAddressInTree(ext) || deepFindAddressInTree(basic) || deepFindAddressInTree(ocrPick);
  }

  /** MY: `ocrIdEditInfo` is user-confirmed — must win for legal name + address (slot/merge order can drop them while id_number still merges). */
  if (docType === 'MYS01001') {
    const eraw = ext.ocrIdEditInfo || ext.OcrIdEditInfo;
    const ed = eraw == null ? null : coerceAliyunJsonField(eraw);
    if (ed && typeof ed === 'object' && !Array.isArray(ed)) {
      const fromEditName = firstNonEmptyStr(
        ed.name,
        ed.Name,
        ed.legalName,
        ed.LegalName,
        ed.englishName,
        ed.EnglishName
      );
      if (fromEditName) fullName = fromEditName;
      const fromEditAddr = firstNonEmptyStr(ed.address, ed.Address, ed.fullAddress, ed.FullAddress);
      if (fromEditAddr) address = fromEditAddr;
    }
  }

  let entityType = 'MALAYSIAN_INDIVIDUAL';
  let idType = 'NRIC';
  let regNoType = 'NRIC';
  if (docType === 'GLB03002') {
    entityType = inferPassportEntityTypeFromAliyunOcr(ext, ocrPick, basic, ekyc, extInf, ocr);
    idType = 'PASSPORT';
    regNoType = 'PASSPORT';
  }

  let passportExpiryDate = null;
  if (docType === 'GLB03002') {
    const erawGl = ext.ocrIdEditInfo || ext.OcrIdEditInfo;
    const edGl = erawGl == null ? null : coerceAliyunJsonField(erawGl);
    let rawExp = '';
    if (edGl && typeof edGl === 'object' && !Array.isArray(edGl)) {
      rawExp = pickPassportExpiryRawFromObject(edGl);
    }
    if (!rawExp) rawExp = pickPassportExpiryRawFromObject(ocrPick);
    if (!rawExp) rawExp = pickPassportExpiryRawFromObject(basic);
    if (!rawExp) rawExp = pickPassportExpiryRawFromObject(ekyc);
    if (!rawExp) rawExp = pickPassportExpiryRawFromObject(extInf);
    if (!rawExp) rawExp = pickPassportExpiryRawFromObject(ext);
    passportExpiryDate = normalizePassportExpiryToIsoDate(rawExp);
    if (!passportExpiryDate) {
      const deepRaw =
        deepFindPassportExpiryRawInTree(ext) ||
        deepFindPassportExpiryRawInTree(basic) ||
        deepFindPassportExpiryRawInTree(ekyc) ||
        deepFindPassportExpiryRawInTree(extInf) ||
        deepFindPassportExpiryRawInTree(ocrPick);
      passportExpiryDate = deepRaw ? normalizePassportExpiryToIsoDate(deepRaw) : null;
    }
  }

  return { fullName, idNumber, entityType, idType, regNoType, address, passportExpiryDate };
}

const EKYC_MAX_IMAGE_BYTES = 18 * 1024 * 1024;

function decodeAliyunImageBase64Field(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  const dataUrl = /^data:([^;]+);base64,(.+)$/i.exec(t.replace(/\s/g, ''));
  if (dataUrl) {
    try {
      const buf = Buffer.from(dataUrl[2], 'base64');
      if (!buf.length || buf.length > EKYC_MAX_IMAGE_BYTES) return null;
      return { buffer: buf, mime: dataUrl[1] };
    } catch {
      return null;
    }
  }
  try {
    const buf = Buffer.from(t.replace(/\s/g, ''), 'base64');
    if (!buf.length || buf.length > EKYC_MAX_IMAGE_BYTES) return null;
    return { buffer: buf, mime: null };
  } catch {
    return null;
  }
}

function filenameForEkycImage(mime, role) {
  if (mime && /png/i.test(String(mime))) return `ekyc-nric-${role}.png`;
  if (mime && /webp/i.test(String(mime))) return `ekyc-nric-${role}.webp`;
  return `ekyc-nric-${role}.jpg`;
}

const EKYC_ID_FRONT_KEYS = [
  'idImage',
  'IdImage',
  'id_image',
  'certImage',
  'CertImage',
  'cardImage',
  'CardImage',
  'frontImage',
  'FrontImage',
  'scanImage',
  'certificateImage',
];
const EKYC_ID_BACK_KEYS = [
  'idBackImage',
  'IdBackImage',
  'id_back_image',
  'certBackImage',
  'backImage',
  'BackImage',
  'rearImage',
  'RearImage',
];

function looksLikeBase64DocumentScan(s) {
  if (typeof s !== 'string') return false;
  const t = s.replace(/\s/g, '');
  if (t.length < 400) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(t.slice(0, 200));
}

/** When keys differ from idImage/idBackImage, pick long base64 blobs from ocrIdInfoData slots (skip face/liveness). */
function heuristicIdImagesFromOcrIdInfoData(ext) {
  const data = ext.ocrIdInfoData || ext.OcrIdInfoData;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { front: null, back: null };
  const cands = [];
  for (const [slotKey, slot] of Object.entries(data)) {
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) continue;
    for (const [k, v] of Object.entries(slot)) {
      if (typeof v !== 'string' || !looksLikeBase64DocumentScan(v)) continue;
      if (/face|portrait|selfie|liveness|FaceImg|faceImg|nationality|chip/i.test(k)) continue;
      const backHint = /back|rear|reverse|02$/i.test(k) || /(^|[^0-9])2$/i.test(String(slotKey).trim());
      cands.push({ v, backHint });
    }
  }
  let front = null;
  let back = null;
  for (const { v, backHint } of cands) {
    if (backHint) {
      if (!back) back = v;
    } else if (!front) front = v;
  }
  if (!front && cands.length === 1) front = cands[0].v;
  if (!front && cands.length > 1) {
    const nonBack = cands.filter((c) => !c.backHint);
    front = nonBack.length ? nonBack[0].v : cands[0].v;
  }
  if (!back && cands.length > 1) {
    const rest = cands.map((c) => c.v).filter((v) => v !== front);
    if (rest.length) back = rest[0];
  }
  return { front, back };
}

/** Alibaba CheckResult Result.ExtIdInfo: idImage / idBackImage (Base64 when isReturnImage=Y). */
function extractAliyunExtIdCardImages(extIdInfoStr) {
  const ext = unwrapAliyunBlob(parseJsonLenient(extIdInfoStr) || {});
  const pick = (obj, keys) => {
    if (!obj || typeof obj !== 'object') return null;
    for (const k of keys) {
      const v = obj[k];
      if (v != null && String(v).trim()) return v;
    }
    return null;
  };
  let front = pick(ext, EKYC_ID_FRONT_KEYS);
  let back = pick(ext, EKYC_ID_BACK_KEYS);
  const data = ext.ocrIdInfoData || ext.OcrIdInfoData;
  if ((!front || !back) && data && typeof data === 'object' && !Array.isArray(data)) {
    for (const slot of Object.values(data)) {
      if (!slot || typeof slot !== 'object') continue;
      if (!front) front = pick(slot, EKYC_ID_FRONT_KEYS);
      if (!back) back = pick(slot, EKYC_ID_BACK_KEYS);
    }
  }
  let ocrFlat = ext.ocrIdInfo || ext.OcrIdInfo || ext.ocr_id_info;
  if (typeof ocrFlat === 'string') ocrFlat = parseJsonLenient(ocrFlat);
  if (typeof ocrFlat === 'object' && ocrFlat && !Array.isArray(ocrFlat)) {
    if (!front) front = pick(ocrFlat, EKYC_ID_FRONT_KEYS);
    if (!back) back = pick(ocrFlat, EKYC_ID_BACK_KEYS);
  }
  if (!front || !back) {
    const h = heuristicIdImagesFromOcrIdInfoData(ext);
    if (!front) front = h.front;
    if (!back) back = h.back;
  }
  return { front, back };
}

/**
 * Upload eKYC card crops to OSS; URLs go to portal_account.nricfront / nricback (demoprofile unified profile).
 * @param {string} portalAccountId portal_account.id (UUID)
 */
async function uploadEkycNricImagesFromExtIdInfo(extIdInfoStr, portalAccountId) {
  const out = { nricfront: null, nricback: null };
  const pid = portalAccountId != null ? String(portalAccountId).trim() : '';
  if (!pid) return out;
  const { front, back } = extractAliyunExtIdCardImages(extIdInfoStr);
  const clientId = `portal-${pid}`;
  const one = async (raw, role) => {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim();
    if (/^https?:\/\//i.test(s)) return s;
    const dec = decodeAliyunImageBase64Field(raw);
    if (!dec) {
      console.warn('[portal-auth] ekyc id image decode failed', role, 'len=', s.length);
      return null;
    }
    const fn = filenameForEkycImage(dec.mime, role);
    const r = await uploadToOss(dec.buffer, fn, clientId);
    if (r.ok) return r.url;
    console.warn('[portal-auth] ekyc id image OSS upload failed', role, r.reason);
    return null;
  };
  if (front) out.nricfront = await one(front, 'front');
  if (back) out.nricback = await one(back, 'back');
  return out;
}

/**
 * Read user-confirmed MY/passport OCR block from raw Result.extIdInfo (SDK shape varies; merge in extract can drop fields).
 * @returns {{ name: string|null, address: string|null, passportExpiryDate: string|null }}
 */
function pickOcrIdEditInfoLegalAndAddress(rawExtIdInfo) {
  const empty = { name: null, address: null, passportExpiryDate: null };
  let ext = rawExtIdInfo;
  if (ext == null) return empty;
  if (typeof ext === 'string') ext = parseJsonLenient(ext);
  if (!ext || typeof ext !== 'object') return empty;
  ext = unwrapAliyunBlob(ext);
  let ed = ext.ocrIdEditInfo || ext.OcrIdEditInfo;
  if (ed == null && ext.result && typeof ext.result === 'object' && !Array.isArray(ext.result)) {
    ed = ext.result.ocrIdEditInfo || ext.result.OcrIdEditInfo;
  }
  ed = coerceAliyunJsonField(ed);
  if (!ed || typeof ed !== 'object' || Array.isArray(ed)) return empty;
  const name = firstNonEmptyStr(
    ed.name,
    ed.Name,
    ed.legalName,
    ed.LegalName,
    ed.englishName,
    ed.EnglishName
  );
  const address = firstNonEmptyStr(ed.address, ed.Address, ed.fullAddress, ed.FullAddress);
  const expRaw = pickPassportExpiryRawFromObject(ed);
  const passportExpiryDate = expRaw ? normalizePassportExpiryToIsoDate(expRaw) : null;
  return {
    name: name ? name : null,
    address: address ? address : null,
    passportExpiryDate,
  };
}

/** Safe summary for API/logs: keys + value types only (no PII, no base64 bodies). */
function summarizeAliyunEkycBlob(strOrObj) {
  let o = strOrObj;
  if (o == null) return { present: false, keyCount: 0, keys: [], keyHints: [] };
  if (typeof o === 'string') {
    const p = parseJsonLenient(o);
    o = unwrapAliyunBlob(p || {});
  } else if (typeof o === 'object') {
    o = unwrapAliyunBlob(o);
  } else {
    return { present: false, keyCount: 0, keys: [], keyHints: [] };
  }
  if (!o || typeof o !== 'object') return { present: false, keyCount: 0, keys: [], keyHints: [] };
  const keys = Object.keys(o);
  const keyHints = keys.slice(0, 50).map((k) => {
    const v = o[k];
    if (v == null) return `${k}:null`;
    if (Array.isArray(v)) return `${k}:array(len=${v.length})`;
    if (typeof v === 'object') return `${k}:object`;
    if (typeof v === 'string') return `${k}:string(len=${v.length})`;
    return `${k}:${typeof v}`;
  });
  return { present: true, keyCount: keys.length, keys: keys.slice(0, 50), keyHints };
}

/**
 * Last-resort: read ocrIdEditInfo straight from raw ExtIdInfo (string/object) when merge/extract miss (SDK shape quirks).
 */
function tryParseOcrIdEditInfoDirect(rawExtIdInfo, docType) {
  const empty = { legalName: '', nric: '', address: '', passportExpiryDate: '' };
  let s = rawExtIdInfo;
  if (s == null) return empty;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(s)) s = s.toString('utf8');
  if (typeof s === 'object') {
    try {
      s = JSON.stringify(s);
    } catch {
      return empty;
    }
  }
  if (typeof s !== 'string' || !s.includes('ocrIdEditInfo')) return empty;
  const o = parseJsonLenient(s);
  if (!o || typeof o !== 'object') return empty;
  const u = unwrapAliyunBlob(o);
  const ed = coerceAliyunJsonField(u.ocrIdEditInfo || u.OcrIdEditInfo);
  if (!ed || typeof ed !== 'object' || Array.isArray(ed)) return empty;
  const legalName = firstNonEmptyStr(ed.name, ed.Name, ed.legalName, ed.LegalName, ed.englishName, ed.EnglishName);
  let nric = firstNonEmptyStr(ed.id_number, ed.idNumber, ed.id_number_back, ed.IDNumber);
  if (docType === 'MYS01001' && nric) {
    const c = normalizeMalaysianNric12Digits(nric);
    if (c) nric = c;
  }
  const address = firstNonEmptyStr(ed.address, ed.Address, ed.fullAddress, ed.FullAddress);
  const expRaw = pickPassportExpiryRawFromObject(ed);
  const passportExpiryIso = expRaw ? normalizePassportExpiryToIsoDate(expRaw) : null;
  return {
    legalName: legalName || '',
    nric: nric || '',
    address: address || '',
    passportExpiryDate: passportExpiryIso || '',
  };
}

/**
 * After eKYC_PRO passed: write legal name + ID to portal_account (same pattern as Gov OIDC) and set aliyun_ekyc_locked.
 * Skips if Singpass/MyDigital already linked (does not overwrite).
 * @returns {Promise<{ ok: boolean, reason?: string, ocrDebug?: object }>}
 */
async function applyAliyunEkycToPortalAccount(email, docType, extIdInfo, extBasicInfo, ekycResult, extInfo) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  const dt = docType === 'GLB03002' ? 'GLB03002' : 'MYS01001';
  const extracted = extractAliyunEkycIdentity(dt, extIdInfo, extBasicInfo, ekycResult, extInfo);
  const directPick = pickOcrIdEditInfoLegalAndAddress(extIdInfo);
  let legalName = firstNonEmptyStr(directPick.name, extracted.fullName);
  let addressLine = firstNonEmptyStr(directPick.address, extracted.address);
  let idNumber = extracted.idNumber;
  if (!legalName || !idNumber) {
    const fb = tryParseOcrIdEditInfoDirect(extIdInfo, dt);
    if (!legalName && fb.legalName) legalName = fb.legalName;
    if (!idNumber && fb.nric) idNumber = fb.nric;
    if (!addressLine && fb.address) addressLine = fb.address;
  }
  if (!legalName || !idNumber) {
    const extObj = unwrapAliyunBlob(parseJsonLenient(extIdInfo) || {});
    const merged = mergeOcrCandidates(
      unwrapAliyunBlob(parseJsonLenient(extBasicInfo) || {}),
      unwrapAliyunBlob(parseJsonLenient(ekycResult) || {}),
      unwrapAliyunBlob(parseJsonLenient(extInfo) || {}),
      extObj
    );
    const ocrDebug = {
      docType: dt,
      missing: { legalName: !legalName, idNumber: !extracted.idNumber },
      extIdInfo: summarizeAliyunEkycBlob(extIdInfo),
      extBasicInfo: summarizeAliyunEkycBlob(extBasicInfo),
      ekycResult: summarizeAliyunEkycBlob(ekycResult),
      extInfo: summarizeAliyunEkycBlob(extInfo),
      mergedScalarKeys: Object.keys(merged).filter((k) => merged[k] == null || typeof merged[k] !== 'object'),
    };
    console.warn('[portal-auth] aliyun-idv applyAliyunEkycToPortalAccount EKYC_OCR_INCOMPLETE', ocrDebug);
    return { ok: false, reason: 'EKYC_OCR_INCOMPLETE', ocrDebug };
  }
  let portalAccountId = null;
  try {
    const [rows] = await pool.query(
      `SELECT id, singpass_sub, mydigital_sub FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
      [normalized]
    );
    if (!rows.length) {
      return { ok: false, reason: 'NO_ACCOUNT' };
    }
    const r = rows[0];
    portalAccountId = r.id != null ? String(r.id) : null;
    const hasS = r.singpass_sub && String(r.singpass_sub).trim();
    const hasM = r.mydigital_sub && String(r.mydigital_sub).trim();
    if (hasS || hasM) {
      return { ok: false, reason: 'GOV_ID_ALREADY_LINKED' };
    }
  } catch (e) {
    console.error('[portal-auth] applyAliyunEkycToPortalAccount precheck', e?.message || e);
    return { ok: false, reason: 'DB_ERROR' };
  }

  let nricImg = { nricfront: null, nricback: null };
  try {
    nricImg = await uploadEkycNricImagesFromExtIdInfo(extIdInfo, portalAccountId);
  } catch (imgErr) {
    console.warn('[portal-auth] applyAliyunEkycToPortalAccount image upload', imgErr?.message || imgErr);
  }

  let passportExpiryDate =
    normalizePassportExpiryToIsoDate(directPick.passportExpiryDate) || extracted.passportExpiryDate || null;
  if (!passportExpiryDate && dt === 'GLB03002') {
    const fbPe = tryParseOcrIdEditInfoDirect(extIdInfo, dt);
    passportExpiryDate = normalizePassportExpiryToIsoDate(fbPe.passportExpiryDate);
  }
  if (!passportExpiryDate && dt === 'GLB03002') {
    const extOnly = unwrapAliyunBlob(parseJsonLenient(extIdInfo) || {});
    const deepOnly = deepFindPassportExpiryRawInTree(extOnly);
    if (deepOnly) passportExpiryDate = normalizePassportExpiryToIsoDate(deepOnly);
  }

  const extObj = unwrapAliyunBlob(parseJsonLenient(extIdInfo) || {});
  const basicObj = unwrapAliyunBlob(parseJsonLenient(extBasicInfo) || {});
  const ekycObj = unwrapAliyunBlob(parseJsonLenient(ekycResult) || {});
  const extInfoObj = unwrapAliyunBlob(parseJsonLenient(extInfo) || {});

  let nationalIdRawForKey = '';
  if (dt === 'MYS01001') {
    nationalIdRawForKey = idNumber || '';
  } else {
    nationalIdRawForKey =
      extractPassportNationalIdFromAliyunRoots(extObj, basicObj, ekycObj, extInfoObj) || '';
    if (!nationalIdRawForKey) nationalIdRawForKey = idNumber || '';
  }
  const nkAssert = await assertNationalIdKeyForPortalAccount(portalAccountId, nationalIdRawForKey);
  if (!nkAssert.ok) {
    return nkAssert;
  }

  const inner = {
    fullname: legalName,
    nric: idNumber,
    entity_type: extracted.entityType,
    id_type: extracted.idType,
    reg_no_type: extracted.regNoType,
    _bypassIdentityLock: true,
    _setAliyunEkycLocked: true,
  };
  const nkFinal = normalizeNricForMatch(nationalIdRawForKey);
  if (nkFinal) inner.national_id_key = nkFinal;
  if (addressLine) inner.address = addressLine;
  if (passportExpiryDate) inner.passport_expiry_date = passportExpiryDate;
  if (nricImg.nricfront) inner.nricfront = nricImg.nricfront;
  if (nricImg.nricback) inner.nricback = nricImg.nricback;
  const updated = await updatePortalProfile(normalized, inner);
  if (!updated.ok) {
    console.warn('[portal-auth] aliyun-idv applyAliyunEkycToPortalAccount updatePortalProfile FAILED', updated.reason || '', updated);
    return updated;
  }
  console.log('[portal-auth] aliyun-idv profile WRITE_OK', { emailDomain: normalized.split('@')[1] || '?' });
  return { ok: true };
}

async function hashPassword(plain) {
  if (!plain || typeof plain !== 'string') return null;
  return bcrypt.hash(plain.trim(), SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain.trim(), hash);
}

/** Match `portal_account.nric` whether stored with dashes/spaces (MY) or compact / SG FIN. */
function normalizeNricForMatch(raw) {
  return String(raw || '')
    .trim()
    .replace(/[\s\-_/]/g, '')
    .toLowerCase();
}

/**
 * Passport OCR (GLB03002) may include national IC/NRIC separately from the passport number.
 */
function extractPassportNationalIdFromAliyunRoots(...roots) {
  const preferKeys = [
    'nationalId',
    'nationalID',
    'NationalId',
    'NationalID',
    'national_id',
    'nric',
    'NRIC',
    'icNumber',
    'ICNumber',
    'ic_no',
    'IC_NO',
    'identityCardNumber',
    'IdentityCardNumber',
    'personalIdNumber',
    'singaporeId',
    'malaysiaNric',
    'mykadNumber',
  ];
  for (const root of roots) {
    if (!root || typeof root !== 'object' || Array.isArray(root)) continue;
    for (const k of preferKeys) {
      if (!Object.prototype.hasOwnProperty.call(root, k)) continue;
      const v = root[k];
      const s =
        typeof v === 'string'
          ? v.trim()
          : v && typeof v === 'object' && typeof v.value === 'string'
            ? v.value.trim()
            : '';
      if (s && s.length >= 6) return s;
    }
  }
  function walk(o, depth) {
    if (depth > 14 || !o || typeof o !== 'object') return '';
    if (Array.isArray(o)) {
      for (const x of o) {
        const s = walk(x, depth + 1);
        if (s) return s;
      }
      return '';
    }
    for (const [k, v] of Object.entries(o)) {
      if (/faceImg|portrait|image|photo|Picture|extFaceInfo/i.test(k)) continue;
      if (
        /national|nric|\bic\b|identitycard|icnumber|singaporeid|mykad/i.test(k) &&
        typeof v === 'string'
      ) {
        const s = v.trim();
        if (s.length >= 6 && s.length <= 32) return s;
      }
      if (v && typeof v === 'object') {
        const s = walk(v, depth + 1);
        if (s) return s;
      }
    }
    return '';
  }
  for (const root of roots) {
    const s = walk(root, 0);
    if (s) return s;
  }
  return '';
}

/**
 * One national id (normalized) per portal_account UUID — blocks cross-account reuse (passport IC vs Singpass uinfin, etc.).
 * @returns {{ ok: true } | { ok: false, reason: 'NATIONAL_ID_ALREADY_BOUND', boundEmail?: string }}
 */
async function assertNationalIdKeyForPortalAccount(portalAccountId, candidateRaw) {
  const key = normalizeNricForMatch(candidateRaw);
  if (!key) return { ok: true };
  const pid = String(portalAccountId || '').trim();
  if (!pid) return { ok: true };
  try {
    const [rows] = await pool.query(
      `SELECT id, email FROM portal_account WHERE national_id_key = ? AND id <> ? LIMIT 1`,
      [key, pid]
    );
    if (rows.length) {
      const em = rows[0].email != null ? String(rows[0].email).trim() : '';
      return { ok: false, reason: 'NATIONAL_ID_ALREADY_BOUND', boundEmail: em };
    }
  } catch (e) {
    if (e && e.code === 'ER_BAD_FIELD_ERROR') {
      return { ok: true };
    }
    throw e;
  }
  return { ok: true };
}

/** OAuth / legacy rows may have NULL, '', or non-bcrypt junk; only bcrypt-shaped values count as an existing login password. */
function hasUsablePasswordHash(hash) {
  if (hash == null) return false;
  const s = Buffer.isBuffer(hash) ? hash.toString('utf8') : String(hash);
  const t = s.trim();
  if (!t) return false;
  return /^\$2[aby]\$\d{2}\$/.test(t) && t.length >= 59;
}

/**
 * 註冊：任何 email 皆可註冊 portal_account；登入後可進 /portal，點 Tenant/Owner 填 profile 即建立 tenantdetail/ownerdetail。
 * @returns { ok, reason?, email? } reason: EMAIL_ALREADY_REGISTERED | NO_EMAIL | INVALID_PASSWORD | DB_ERROR
 * 若 email 已存在且尚無 password（例如先 Google 登入），則寫入 password_hash；已有密碼則拒絕。
 */
async function register(email, password) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }

  const [existingRows] = await pool.query(
    'SELECT id, password_hash FROM portal_account WHERE email = ? LIMIT 1',
    [normalized]
  );
  const existing = existingRows[0];
  if (existing && hasUsablePasswordHash(existing.password_hash)) {
    return { ok: false, reason: 'EMAIL_ALREADY_REGISTERED' };
  }

  const password_hash = await hashPassword(password);
  if (!password_hash) {
    return { ok: false, reason: 'INVALID_PASSWORD' };
  }

  try {
    if (existing) {
      const [upd] = await pool.query(
        'UPDATE portal_account SET password_hash = ?, updated_at = NOW() WHERE id = ?',
        [password_hash, existing.id]
      );
      if (!upd.affectedRows) {
        return { ok: false, reason: 'DB_ERROR' };
      }
      return { ok: true, email: normalized };
    }

    const id = randomUUID();
    await pool.query(
      'INSERT INTO portal_account (id, email, password_hash) VALUES (?, ?, ?)',
      [id, normalized, password_hash]
    );
    return { ok: true, email: normalized };
  } catch (err) {
    console.error('[portal-auth] register:', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  }
}

/**
 * 登入：email **或** NRIC/證件號（與 `portal_account.nric` 比對，去空白與常見分隔符）+ 密碼。
 * Body 仍用欄位名 `email` 傳入，可填信箱或證件號。
 * @returns { ok, reason?, email?, roles? } reason: INVALID_CREDENTIALS | NO_EMAIL | ACCOUNT_NOT_FOUND_EMAIL | ACCOUNT_NOT_FOUND_NRIC | DB_ERROR
 */
async function login(email, password) {
  const raw = String(email || '').trim();
  if (!raw) {
    return { ok: false, reason: 'NO_EMAIL' };
  }

  let account = null;

  if (raw.includes('@')) {
    const normalized = normalizeEmail(raw);
    if (!normalized) {
      return { ok: false, reason: 'NO_EMAIL' };
    }
    const [rows] = await pool.query(
      'SELECT id, email, password_hash FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalized]
    );
    if (!rows.length) {
      return { ok: false, reason: 'ACCOUNT_NOT_FOUND_EMAIL' };
    }
    account = rows[0];
  } else {
    const key = normalizeNricForMatch(raw);
    if (!key) {
      return { ok: false, reason: 'NO_EMAIL' };
    }
    const [rows] = await pool.query(
      `SELECT id, email, password_hash FROM portal_account
       WHERE nric IS NOT NULL AND TRIM(nric) != ''
         AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(nric), '-', ''), ' ', ''), '/', ''), '_', '')) = ?
       LIMIT 1`,
      [key]
    );
    if (!rows.length) {
      return { ok: false, reason: 'ACCOUNT_NOT_FOUND_NRIC' };
    }
    account = rows[0];
  }

  if (!(await verifyPassword(password, account.password_hash))) {
    return { ok: false, reason: 'INVALID_CREDENTIALS' };
  }

  const memberEmail = String(account.email || '').trim();
  const memberRoles = await getMemberRoles(memberEmail);
  if (!memberRoles.ok) {
    return { ok: false, reason: 'DB_ERROR' };
  }

  return {
    ok: true,
    email: memberRoles.email,
    portalAccountId: String(account.id),
    roles: memberRoles.roles || [],
    cleanlemons: memberRoles.cleanlemons || null,
    token: signPortalToken({
      email: memberRoles.email,
      roles: memberRoles.roles || [],
      cleanlemons: memberRoles.cleanlemons || null
    })
  };
}

/**
 * Coliving /login Google：與 /enquiry 相同，允許首次登入即建立 portal_account（無 tenant/staff/owner 亦可），roles 可為空。
 * 實作與 findOrCreateByGoogleCleanlemon 共用。
 * @param {{ id: string, emails?: Array<{ value: string }> }} profile - Passport Google profile
 * @returns {{ ok: boolean, reason?: string, email?: string, roles?: Array }} reason: NO_EMAIL | NO_GOOGLE_ID | …
 */
async function findOrCreateByGoogle(profile) {
  return findOrCreateByGoogleCleanlemon(profile);
}

/**
 * Coliving /enquiry：與 /login 相同邏輯（findOrCreateByGoogleCleanlemon）；保留 enquiry state 供路由導向 /enquiry。
 */
async function findOrCreateByGoogleEnquiry(profile) {
  return findOrCreateByGoogleCleanlemon(profile);
}

/**
 * Cleanlemons Google OAuth: allow first-time email (no pre-registered role rows).
 * Creates/binds portal_account and returns empty roles when none exist yet.
 */
async function findOrCreateByGoogleCleanlemon(profile) {
  const email = profile?.emails?.[0]?.value;
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };

  const googleId = profile?.id ? String(profile.id) : null;
  if (!googleId) return { ok: false, reason: 'NO_GOOGLE_ID' };

  const [existingByGoogle] = await pool.query(
    'SELECT id, email FROM portal_account WHERE google_id = ? LIMIT 1',
    [googleId]
  );
  if (existingByGoogle.length) {
    const member = await getMemberRoles(existingByGoogle[0].email);
    return member.ok
      ? {
          ok: true,
          email: normalizeEmail(existingByGoogle[0].email),
          roles: member.roles || [],
          cleanlemons: member.cleanlemons || null
        }
      : { ok: true, email: normalizeEmail(existingByGoogle[0].email), roles: [], cleanlemons: null };
  }

  const [existingByEmail] = await pool.query(
    'SELECT id, email FROM portal_account WHERE email = ? LIMIT 1',
    [normalized]
  );
  if (existingByEmail.length) {
    await pool.query(
      'UPDATE portal_account SET google_id = ?, updated_at = NOW() WHERE id = ?',
      [googleId, existingByEmail[0].id]
    );
  } else {
    const id = randomUUID();
    await pool.query(
      'INSERT INTO portal_account (id, email, password_hash, google_id) VALUES (?, ?, NULL, ?)',
      [id, normalized, googleId]
    );
  }

  const member = await getMemberRoles(normalized);
  return member.ok
    ? { ok: true, email: normalized, roles: member.roles || [], cleanlemons: member.cleanlemons || null }
    : { ok: true, email: normalized, roles: [], cleanlemons: null };
}

/**
 * Coliving /enquiry 專用：與 findOrCreateByGoogleEnquiry 相同，由 Facebook OAuth state.enquiry 觸發。
 */
async function findOrCreateByFacebookEnquiry(profile) {
  return findOrCreateByFacebookCleanlemon(profile);
}

/**
 * Cleanlemons Facebook OAuth：與 findOrCreateByGoogleCleanlemon 相同，允許首登建立 portal_account。
 */
async function findOrCreateByFacebookCleanlemon(profile) {
  const email = profile?.emails?.[0]?.value || profile?._json?.email;
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };

  const facebookId = profile?.id ? String(profile.id) : null;
  if (!facebookId) return { ok: false, reason: 'NO_FACEBOOK_ID' };

  const [existingByFb] = await pool.query(
    'SELECT id, email FROM portal_account WHERE facebook_id = ? LIMIT 1',
    [facebookId]
  );
  if (existingByFb.length) {
    const member = await getMemberRoles(existingByFb[0].email);
    return member.ok
      ? {
          ok: true,
          email: normalizeEmail(existingByFb[0].email),
          roles: member.roles || [],
          cleanlemons: member.cleanlemons || null
        }
      : { ok: true, email: normalizeEmail(existingByFb[0].email), roles: [], cleanlemons: null };
  }

  const [existingByEmail] = await pool.query(
    'SELECT id, email FROM portal_account WHERE email = ? LIMIT 1',
    [normalized]
  );
  if (existingByEmail.length) {
    await pool.query(
      'UPDATE portal_account SET facebook_id = ?, updated_at = NOW() WHERE id = ?',
      [facebookId, existingByEmail[0].id]
    );
  } else {
    const id = randomUUID();
    await pool.query(
      'INSERT INTO portal_account (id, email, password_hash, facebook_id) VALUES (?, ?, NULL, ?)',
      [id, normalized, facebookId]
    );
  }

  const member = await getMemberRoles(normalized);
  return member.ok
    ? { ok: true, email: normalized, roles: member.roles || [], cleanlemons: member.cleanlemons || null }
    : { ok: true, email: normalized, roles: [], cleanlemons: null };
}

/**
 * Coliving /login Facebook：與 /enquiry 相同，允許首次登入即建立 portal_account；實作與 findOrCreateByFacebookCleanlemon 共用。
 */
async function findOrCreateByFacebook(profile) {
  return findOrCreateByFacebookCleanlemon(profile);
}

/** JWT 內只放 Cleanlemons 下拉所需（完整 employee 見 login / member-roles 回應 body）。 */
function slimCleanlemonsForJwt(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    operatorChoices: Array.isArray(c.operatorChoices) ? c.operatorChoices : [],
    employeeId: c.employee && c.employee.id ? String(c.employee.id) : null,
    supervisorOperators: Array.isArray(c.supervisorOperators) ? c.supervisorOperators : [],
    employeeOperators: Array.isArray(c.employeeOperators) ? c.employeeOperators : []
  };
}

/**
 * 簽發供前端使用的短期 JWT（OAuth 登入成功後 redirect 帶上）。
 * Payload: { email, roles, cleanlemons? }；前端驗證後可 setMember 並跳 /portal。
 */
function signPortalToken(payload) {
  const body = {
    email: payload.email,
    roles: payload.roles || []
  };
  if (payload.cleanlemons != null) {
    const slim = slimCleanlemonsForJwt(payload.cleanlemons);
    body.cleanlemons =
      slim ||
      { operatorChoices: [], employeeId: null, supervisorOperators: [], employeeOperators: [] };
  }
  return jwt.sign(body, PORTAL_JWT_SECRET, { expiresIn: PORTAL_JWT_EXPIRES_IN });
}

/**
 * 驗證 portal JWT，回傳 payload 或 null。
 */
function verifyPortalToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const decoded = jwt.verify(token.trim(), PORTAL_JWT_SECRET);
    if (!decoded || !decoded.email) return null;
    return {
      email: decoded.email,
      roles: decoded.roles || [],
      cleanlemons: decoded.cleanlemons ?? null
    };
  } catch {
    return null;
  }
}

function profileSelfVerifiedAtFromRow(r) {
  if (!r || r.profile_self_verified_at == null || r.profile_self_verified_at === '') return null;
  const v = r.profile_self_verified_at;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  const d = new Date(String(v).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * 取得會員資料（一個 email 一份，存在 portal_account）。
 * 若 portal_account 尚無該 email 或無 profile 欄位則回傳 null 或空物件。
 * @returns {{ ok: boolean, profile?: { fullname, phone, address, nric, bankname_id, bankaccount, accountholder } } | { ok: false, reason } }
 */
function mapPortalAccountRowToProfile(r) {
  if (!r) return null;
  return {
    fullname: r.fullname ?? null,
    first_name: r.first_name ?? null,
    last_name: r.last_name ?? null,
    phone: r.phone ?? null,
    address: r.address ?? null,
    nric: r.nric ?? null,
    passport_expiry_date:
      r.passport_expiry_date != null && r.passport_expiry_date !== ''
        ? r.passport_expiry_date instanceof Date && !Number.isNaN(r.passport_expiry_date.getTime())
          ? r.passport_expiry_date.toISOString().slice(0, 10)
          : String(r.passport_expiry_date).slice(0, 10)
        : null,
    bankname_id: r.bankname_id ?? null,
    bankaccount: r.bankaccount ?? null,
    accountholder: r.accountholder ?? null,
    avatar_url: r.avatar_url ?? null,
    nricfront: r.nricfront ?? null,
    nricback: r.nricback ?? null,
    entity_type: r.entity_type ?? null,
    reg_no_type: r.reg_no_type ?? null,
    id_type: r.id_type ?? null,
    tax_id_no: r.tax_id_no ?? null,
    bank_refund_remark: r.bank_refund_remark ?? null,
    singpass_linked: !!(r.singpass_sub && String(r.singpass_sub).trim()),
    mydigital_linked: !!(r.mydigital_sub && String(r.mydigital_sub).trim()),
    gov_identity_locked: !!r.gov_identity_locked,
    phone_verified: !!Number(r.phone_verified),
    aliyun_ekyc_locked: !!Number(r.aliyun_ekyc_locked),
    profileSelfVerifiedAt: profileSelfVerifiedAtFromRow(r)
  };
}

async function getPortalProfile(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  const baseColsCore = `fullname, first_name, last_name, phone, address, nric, passport_expiry_date, bankname_id, bankaccount, accountholder, avatar_url, nricfront, nricback, entity_type, reg_no_type, id_type, tax_id_no, bank_refund_remark,
       singpass_sub, mydigital_sub, gov_identity_locked`;
  const attempts = [
    `SELECT ${baseColsCore}, profile_self_verified_at,
       COALESCE(phone_verified, 0) AS phone_verified,
       COALESCE(aliyun_ekyc_locked, 0) AS aliyun_ekyc_locked
       FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
    `SELECT ${baseColsCore},
       COALESCE(phone_verified, 0) AS phone_verified,
       COALESCE(aliyun_ekyc_locked, 0) AS aliyun_ekyc_locked
       FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
    `SELECT ${baseColsCore},
       0 AS phone_verified,
       COALESCE(aliyun_ekyc_locked, 0) AS aliyun_ekyc_locked
       FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
    `SELECT ${baseColsCore},
       0 AS phone_verified,
       0 AS aliyun_ekyc_locked
       FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
    `SELECT fullname, first_name, last_name, phone, address, nric, bankname_id, bankaccount, accountholder, avatar_url, nricfront, nricback, entity_type, reg_no_type, id_type, tax_id_no, bank_refund_remark FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1`
  ];
  try {
    let rows;
    let lastErr;
    for (let i = 0; i < attempts.length; i++) {
      try {
        ;[rows] = await pool.query(attempts[i], [normalized]);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (!e || e.code !== 'ER_BAD_FIELD_ERROR' || i === attempts.length - 1) {
          throw e;
        }
      }
    }
    if (lastErr) throw lastErr;
    const r = rows[0];
    if (!r) {
      return { ok: true, profile: null };
    }
    const profile = mapPortalAccountRowToProfile(r);
    return { ok: true, profile };
  } catch (err) {
    if (err && err.code === 'ER_BAD_FIELD_ERROR') {
      try {
        const [rows] = await pool.query(
          'SELECT fullname, first_name, last_name, phone, address, nric, bankname_id, bankaccount, accountholder, avatar_url, nricfront, nricback, entity_type, reg_no_type, id_type, tax_id_no, bank_refund_remark FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
          [normalized]
        );
        const r = rows[0];
        if (!r) return { ok: true, profile: null };
        return {
          ok: true,
          profile: {
            fullname: r.fullname ?? null,
            first_name: r.first_name ?? null,
            last_name: r.last_name ?? null,
            phone: r.phone ?? null,
            address: r.address ?? null,
            nric: r.nric ?? null,
            passport_expiry_date: null,
            bankname_id: r.bankname_id ?? null,
            bankaccount: r.bankaccount ?? null,
            accountholder: r.accountholder ?? null,
            avatar_url: r.avatar_url ?? null,
            nricfront: r.nricfront ?? null,
            nricback: r.nricback ?? null,
            entity_type: r.entity_type ?? null,
            reg_no_type: r.reg_no_type ?? null,
            id_type: r.id_type ?? null,
            tax_id_no: r.tax_id_no ?? null,
            bank_refund_remark: r.bank_refund_remark ?? null,
            singpass_linked: false,
            mydigital_linked: false,
            gov_identity_locked: false,
            phone_verified: false,
            aliyun_ekyc_locked: false,
            profileSelfVerifiedAt: null
          }
        };
      } catch (_) {
        return { ok: true, profile: null };
      }
    }
    if (err && err.code === 'ECONNRESET') {
      return { ok: true, profile: null };
    }
    return { ok: false, reason: 'DB_ERROR' };
  }
}

/**
 * 更新會員資料並同步到同一 email 的業務列（僅 UPDATE，列不存在則跳過該表）：
 * tenantdetail、staffdetail、ownerdetail；Cleanlemons 另同步 cln_employeedetail、cln_clientdetail。
 * payload: { fullname?, phone?, address?, nric?, bankname_id?, bankaccount?, accountholder? }
 * @returns {{ ok: boolean, reason? }}
 */
async function updatePortalProfile(email, payload) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'NO_PAYLOAD' };
  }

  const selfVerify = payload.selfVerify === true;
  if (Object.prototype.hasOwnProperty.call(payload, 'selfVerify')) {
    delete payload.selfVerify;
  }

  const bypassIdentityLock = payload._bypassIdentityLock === true;
  if (Object.prototype.hasOwnProperty.call(payload, '_bypassIdentityLock')) {
    delete payload._bypassIdentityLock;
  }
  /** Set in same UPDATE as OCR fields so autosave cannot overwrite fullname between write and lock (race). */
  const setAliyunEkycLockedInThisUpdate = payload._setAliyunEkycLocked === true;
  if (Object.prototype.hasOwnProperty.call(payload, '_setAliyunEkycLocked')) {
    delete payload._setAliyunEkycLocked;
  }

  // When a key is not present in payload, keep destination values unchanged (COALESCE + provided flags).
  const hasKey = (k) => Object.prototype.hasOwnProperty.call(payload, k);

  const avatar_url_provided = hasKey('avatar_url') && payload.avatar_url !== undefined;
  const nricfront_provided = hasKey('nricfront') && payload.nricfront !== undefined;
  const nricback_provided = hasKey('nricback') && payload.nricback !== undefined;
  const entity_type_provided = hasKey('entity_type') && payload.entity_type !== undefined;
  const reg_no_type_provided = hasKey('reg_no_type') && payload.reg_no_type !== undefined;
  const id_type_provided = hasKey('id_type') && payload.id_type !== undefined;
  const tax_id_no_provided = hasKey('tax_id_no') && payload.tax_id_no !== undefined;
  const bank_refund_remark_provided = hasKey('bank_refund_remark') && payload.bank_refund_remark !== undefined;
  const address_provided = hasKey('address') && payload.address !== undefined;
  const first_name_provided = hasKey('first_name') && payload.first_name !== undefined;
  const last_name_provided = hasKey('last_name') && payload.last_name !== undefined;
  const fullname_provided = hasKey('fullname') && payload.fullname !== undefined;
  const passport_expiry_date_provided = hasKey('passport_expiry_date') && payload.passport_expiry_date !== undefined;

  if (!bypassIdentityLock) {
    try {
      let lc;
      try {
        [lc] = await pool.query(
          'SELECT gov_identity_locked, COALESCE(aliyun_ekyc_locked,0) AS aliyun_ekyc_locked FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
          [normalized]
        );
      } catch (qErr) {
        if (qErr && qErr.code === 'ER_BAD_FIELD_ERROR') {
          [lc] = await pool.query(
            'SELECT gov_identity_locked, 0 AS aliyun_ekyc_locked FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
            [normalized]
          );
        } else {
          throw qErr;
        }
      }
      if (lc[0] && Number(lc[0].gov_identity_locked) === 1) {
        const nric_provided = hasKey('nric') && payload.nric !== undefined;
        if (fullname_provided || entity_type_provided || nric_provided) {
          return { ok: false, reason: 'IDENTITY_LOCKED' };
        }
      }
      if (lc[0] && Number(lc[0].aliyun_ekyc_locked) === 1) {
        const nric_provided = hasKey('nric') && payload.nric !== undefined;
        /** OCR-filled legal name + address must not be overwritten by autosave (same as fullname/nric). */
        if (
          fullname_provided ||
          address_provided ||
          entity_type_provided ||
          id_type_provided ||
          nric_provided ||
          passport_expiry_date_provided
        ) {
          return { ok: false, reason: 'IDENTITY_LOCKED' };
        }
      }
    } catch (e) {
      if (e && e.code !== 'ER_BAD_FIELD_ERROR') {
        console.warn('[portal-auth] identity lock check:', e?.message || e);
      }
    }
  }

  try {
    const [phoneRows] = await pool.query(
      'SELECT phone, COALESCE(phone_verified, 0) AS phone_verified FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalized]
    );
    const pr = phoneRows[0];
    if (pr && Number(pr.phone_verified) === 1 && hasKey('phone') && payload.phone !== undefined) {
      const incoming =
        payload.phone != null ? String(payload.phone).replace(/\s+/g, '').trim() : '';
      const stored = pr.phone != null ? String(pr.phone).replace(/\s+/g, '').trim() : '';
      if (incoming !== stored) {
        return { ok: false, reason: 'PHONE_VERIFIED_LOCKED' };
      }
    }
  } catch (e) {
    if (e && e.code !== 'ER_BAD_FIELD_ERROR') {
      console.warn('[portal-auth] phone_verified check:', e?.message || e);
    }
  }

  const fullname = payload.fullname != null ? String(payload.fullname).trim() || null : null;
  const first_name = first_name_provided ? (payload.first_name == null ? null : String(payload.first_name).trim() || null) : null;
  const last_name = last_name_provided ? (payload.last_name == null ? null : String(payload.last_name).trim() || null) : null;
  const phone = payload.phone != null ? String(payload.phone).trim() || null : null;
  const address = payload.address != null ? String(payload.address).trim() || null : null;
  const nric = payload.nric != null ? String(payload.nric).trim() || null : null;
  const bankname_id = payload.bankname_id != null ? (payload.bankname_id === '' ? null : payload.bankname_id) : null;
  const bankaccount = payload.bankaccount != null ? String(payload.bankaccount).trim() || null : null;
  const accountholder = payload.accountholder != null ? String(payload.accountholder).trim() || null : null;

  const avatar_url = avatar_url_provided ? (payload.avatar_url == null ? null : String(payload.avatar_url).trim() || null) : null;
  const nricfront = nricfront_provided ? (payload.nricfront == null ? null : String(payload.nricfront).trim() || null) : null;
  const nricback = nricback_provided ? (payload.nricback == null ? null : String(payload.nricback).trim() || null) : null;
  const entity_type = entity_type_provided ? (payload.entity_type == null ? null : String(payload.entity_type).trim() || null) : null;
  const reg_no_type = reg_no_type_provided ? (payload.reg_no_type == null ? null : String(payload.reg_no_type).trim() || null) : null;
  const id_type = id_type_provided ? (payload.id_type == null ? null : String(payload.id_type).trim() || null) : null;
  const tax_id_no = tax_id_no_provided ? (payload.tax_id_no == null ? null : String(payload.tax_id_no).trim() || null) : null;
  const bank_refund_remark = bank_refund_remark_provided ? (payload.bank_refund_remark == null ? null : String(payload.bank_refund_remark).trim() || null) : null;
  const passport_expiry_date = passport_expiry_date_provided
    ? payload.passport_expiry_date == null
      ? null
      : normalizePassportExpiryToIsoDate(payload.passport_expiry_date)
    : null;

  const national_id_key_provided = hasKey('national_id_key') && payload.national_id_key !== undefined;
  const national_id_key_val = national_id_key_provided
    ? payload.national_id_key == null
      ? null
      : String(payload.national_id_key).trim() || null
    : null;
  if (national_id_key_provided) {
    delete payload.national_id_key;
  }

  try {
    const [existing] = await pool.query(
      'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalized]
    );
    if (existing.length === 0) {
      return { ok: false, reason: 'NO_ACCOUNT' };
    }
    const portalAccountPk = String(existing[0].id);

    if (national_id_key_provided && national_id_key_val) {
      const nkChk = await assertNationalIdKeyForPortalAccount(portalAccountPk, national_id_key_val);
      if (!nkChk.ok) return nkChk;
    }

    const lockFrag = setAliyunEkycLockedInThisUpdate ? 'aliyun_ekyc_locked = 1,' : '';
    try {
      await pool.query(
        `UPDATE portal_account SET fullname = COALESCE(?, fullname), first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), phone = COALESCE(?, phone), address = COALESCE(?, address),
       nric = COALESCE(?, nric), passport_expiry_date = COALESCE(?, passport_expiry_date), bankname_id = COALESCE(?, bankname_id), bankaccount = COALESCE(?, bankaccount),
       accountholder = COALESCE(?, accountholder),
       avatar_url = COALESCE(?, avatar_url), nricfront = COALESCE(?, nricfront), nricback = COALESCE(?, nricback),
       entity_type = COALESCE(?, entity_type), reg_no_type = COALESCE(?, reg_no_type), id_type = COALESCE(?, id_type), tax_id_no = COALESCE(?, tax_id_no),
       bank_refund_remark = COALESCE(?, bank_refund_remark),
       ${lockFrag}
       updated_at = NOW() WHERE LOWER(TRIM(email)) = ?`,
        [
          fullname,
          first_name,
          last_name,
          phone,
          address,
          nric,
          passport_expiry_date,
          bankname_id,
          bankaccount,
          accountholder,
          avatar_url,
          nricfront,
          nricback,
          entity_type,
          reg_no_type,
          id_type,
          tax_id_no,
          bank_refund_remark,
          normalized,
        ]
      );
    } catch (e) {
      if (!e || e.code !== 'ER_BAD_FIELD_ERROR') throw e;

      const paramsNoPe = [
        fullname,
        first_name,
        last_name,
        phone,
        address,
        nric,
        bankname_id,
        bankaccount,
        accountholder,
        avatar_url,
        nricfront,
        nricback,
        entity_type,
        reg_no_type,
        id_type,
        tax_id_no,
        bank_refund_remark,
        normalized,
      ];
      const paramsWithPe = [
        fullname,
        first_name,
        last_name,
        phone,
        address,
        nric,
        passport_expiry_date,
        bankname_id,
        bankaccount,
        accountholder,
        avatar_url,
        nricfront,
        nricback,
        entity_type,
        reg_no_type,
        id_type,
        tax_id_no,
        bank_refund_remark,
        normalized,
      ];
      const sqlBase = `UPDATE portal_account SET fullname = COALESCE(?, fullname), first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), phone = COALESCE(?, phone), address = COALESCE(?, address),
       nric = COALESCE(?, nric)`;
      const sqlTail = `, bankname_id = COALESCE(?, bankname_id), bankaccount = COALESCE(?, bankaccount),
       accountholder = COALESCE(?, accountholder),
       avatar_url = COALESCE(?, avatar_url), nricfront = COALESCE(?, nricfront), nricback = COALESCE(?, nricback),
       entity_type = COALESCE(?, entity_type), reg_no_type = COALESCE(?, reg_no_type), id_type = COALESCE(?, id_type), tax_id_no = COALESCE(?, tax_id_no),
       bank_refund_remark = COALESCE(?, bank_refund_remark),`;

      let applied = false;
      if (setAliyunEkycLockedInThisUpdate) {
        try {
          await pool.query(
            `${sqlBase}, passport_expiry_date = COALESCE(?, passport_expiry_date) ${sqlTail} updated_at = NOW() WHERE LOWER(TRIM(email)) = ?`,
            paramsWithPe
          );
          console.warn('[portal-auth] aliyun_ekyc_locked column missing — run migration 0266 (OCR write ok, lock skipped)');
          applied = true;
        } catch (e2) {
          if (!e2 || e2.code !== 'ER_BAD_FIELD_ERROR') throw e2;
        }
      }
      if (!applied) {
        try {
          await pool.query(
            `${sqlBase} ${sqlTail} ${lockFrag} updated_at = NOW() WHERE LOWER(TRIM(email)) = ?`,
            paramsNoPe
          );
          console.warn('[portal-auth] passport_expiry_date column missing — run migration 0267 (OCR write ok, date skipped)');
          applied = true;
        } catch (e3) {
          if (!e3 || e3.code !== 'ER_BAD_FIELD_ERROR') throw e3;
        }
      }
      if (!applied) {
        await pool.query(
          `${sqlBase} ${sqlTail} updated_at = NOW() WHERE LOWER(TRIM(email)) = ?`,
          paramsNoPe
        );
        console.warn(
          '[portal-auth] passport_expiry_date and/or aliyun_ekyc_locked missing — run migrations 0266/0267 (OCR fields ok, lock/date skipped)'
        );
      }
    }

    if (selfVerify) {
      try {
        await pool.query(
          'UPDATE portal_account SET profile_self_verified_at = NOW(), updated_at = NOW() WHERE LOWER(TRIM(email)) = ? LIMIT 1',
          [normalized]
        );
      } catch (svErr) {
        if (svErr && svErr.code === 'ER_BAD_FIELD_ERROR') {
          console.warn('[portal-auth] profile_self_verified_at column missing — run migration 0294');
        } else {
          throw svErr;
        }
      }
    }

    if (national_id_key_provided && national_id_key_val) {
      try {
        await pool.query(
          'UPDATE portal_account SET national_id_key = ? WHERE LOWER(TRIM(email)) = ? LIMIT 1',
          [national_id_key_val, normalized]
        );
      } catch (nkErr) {
        if (nkErr && nkErr.code === 'ER_BAD_FIELD_ERROR') {
          console.warn('[portal-auth] national_id_key column missing — run migration 0268');
        } else {
          throw nkErr;
        }
      }
    }

    let updated;
    try {
      ;[updated] = await pool.query(
        'SELECT fullname, first_name, last_name, phone, address, nric, passport_expiry_date, bankname_id, bankaccount, accountholder, avatar_url, nricfront, nricback, entity_type, reg_no_type, id_type, tax_id_no, bank_refund_remark FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
        [normalized]
      );
    } catch (selErr) {
      if (selErr && selErr.code === 'ER_BAD_FIELD_ERROR') {
        ;[updated] = await pool.query(
          'SELECT fullname, first_name, last_name, phone, address, nric, bankname_id, bankaccount, accountholder, avatar_url, nricfront, nricback, entity_type, reg_no_type, id_type, tax_id_no, bank_refund_remark FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
          [normalized]
        );
      } else {
        throw selErr;
      }
    }
    const p = updated[0] || {};
    const fn = p.fullname ?? null;
    const first = p.first_name ?? null;
    const last = p.last_name ?? null;
    const ph = p.phone ?? null;
    const addr = p.address ?? null;
    const nr = p.nric ?? null;
    const bid = p.bankname_id ?? null;
    const bacc = p.bankaccount ?? null;
    const ahold = p.accountholder ?? null;
    const aUrl = p.avatar_url ?? null;
    const nf = p.nricfront ?? null;
    const nb = p.nricback ?? null;
    const et = p.entity_type ?? null;
    const rnt = p.reg_no_type ?? null;
    const idt = p.id_type ?? null;
    const tno = p.tax_id_no ?? null;
    const brmrk = p.bank_refund_remark ?? null;

    await pool.query(
      'UPDATE tenantdetail SET fullname = ?, phone = ?, address = ?, nric = ?, bankname_id = ?, bankaccount = ?, accountholder = ?, nricfront = COALESCE(?, nricfront), nricback = COALESCE(?, nricback), updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
      [fn, ph, addr, nr, bid, bacc, ahold, nf, nb, normalized]
    );
    await pool.query(
      'UPDATE staffdetail SET name = ?, bank_name_id = ?, bankaccount = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
      [fn, bid, bacc, normalized]
    );
    await pool.query(
      'UPDATE ownerdetail SET ownername = ?, mobilenumber = ?, nric = ?, bankname_id = ?, bankaccount = ?, accountholder = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
      [fn, ph, nr, bid, bacc, ahold, normalized]
    );

    // Sync tenantdetail.profile JSON (avatar/entity/reg/tax/bank_refund_remark).
    if (avatar_url_provided || entity_type_provided || reg_no_type_provided || id_type_provided || tax_id_no_provided || bank_refund_remark_provided || first_name_provided || last_name_provided) {
      try {
        const [tenantRows] = await pool.query(
          'SELECT profile FROM tenantdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
          [normalized]
        );
        const existingProfile = parseJson(tenantRows?.[0]?.profile) || {};
        const nextProfile = { ...existingProfile };
        if (avatar_url_provided) nextProfile.avatar_url = aUrl;
        if (entity_type_provided) nextProfile.entity_type = et;
        if (reg_no_type_provided) nextProfile.reg_no_type = rnt;
        if (id_type_provided) nextProfile.id_type = idt;
        if (tax_id_no_provided) nextProfile.tax_id_no = tno;
        if (bank_refund_remark_provided) nextProfile.bank_refund_remark = brmrk;
        if (first_name_provided) nextProfile.first_name = first;
        if (last_name_provided) nextProfile.last_name = last;
        await pool.query(
          'UPDATE tenantdetail SET profile = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
          [JSON.stringify(nextProfile), normalized]
        );
      } catch (err) {
        if (!(err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054)) {
          // If tenantdetail.profile column not exist yet, ignore (handled by caller UI).
          throw err;
        }
      }
    }

    // Sync staffdetail.profile JSON (operator entity/reg/tax).
    if (entity_type_provided || reg_no_type_provided || id_type_provided || tax_id_no_provided || first_name_provided || last_name_provided) {
      try {
        const [staffRows] = await pool.query(
          'SELECT profile FROM staffdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
          [normalized]
        );
        const existingProfile = parseJson(staffRows?.[0]?.profile) || {};
        const nextProfile = { ...existingProfile };
        if (entity_type_provided) nextProfile.entity_type = et;
        if (reg_no_type_provided) nextProfile.reg_no_type = rnt;
        if (id_type_provided) nextProfile.id_type = idt;
        if (tax_id_no_provided) nextProfile.tax_id_no = tno;
        if (first_name_provided) nextProfile.first_name = first;
        if (last_name_provided) nextProfile.last_name = last;
        await pool.query(
          'UPDATE staffdetail SET profile = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
          [JSON.stringify(nextProfile), normalized]
        );
      } catch (err) {
        if (!(err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054)) throw err;
      }
    }

    // Sync avatar for operator (staffdetail.profilephoto / client_user.profilephoto).
    if (avatar_url_provided) {
      try {
        // staffdetail
        await pool.query(
          'UPDATE staffdetail SET profilephoto = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
          [aUrl, normalized]
        );
      } catch (err) {
        if (!(err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054)) throw err;
      }
      try {
        // client_user
        await pool.query(
          'UPDATE client_user SET profilephoto = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
          [aUrl, normalized]
        );
      } catch (err) {
        if (!(err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054)) throw err;
      }
    }

    // Sync ownerdetail.profile JSON (entity/reg/tax and address string).
    if (avatar_url_provided || entity_type_provided || reg_no_type_provided || id_type_provided || tax_id_no_provided || address_provided || first_name_provided || last_name_provided) {
      try {
        const [ownerRows] = await pool.query(
          'SELECT profile FROM ownerdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
          [normalized]
        );
        const existingProfile = parseJson(ownerRows?.[0]?.profile) || {};
        const existingAddr = existingProfile?.address && typeof existingProfile.address === 'object' ? existingProfile.address : {};
        const nextProfile = { ...existingProfile };
        if (entity_type_provided) nextProfile.entity_type = et;
        if (reg_no_type_provided) nextProfile.reg_no_type = rnt;
        if (id_type_provided) nextProfile.id_type = idt;
        if (tax_id_no_provided) nextProfile.tax_id_no = tno;
        if (avatar_url_provided) nextProfile.avatar_url = aUrl;
        if (first_name_provided) nextProfile.first_name = first;
        if (last_name_provided) nextProfile.last_name = last;
        if (address_provided) {
          nextProfile.address = {
            ...existingAddr,
            street: addr,
          };
        }
        await pool.query(
          'UPDATE ownerdetail SET profile = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
          [JSON.stringify(nextProfile), normalized]
        );
      } catch (err) {
        if (!(err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054)) throw err;
      }
    }

    // Sync nricfront/nricback for tenant + owner (top-level columns).
    if (nricfront_provided || nricback_provided) {
      try {
        await pool.query(
          'UPDATE ownerdetail SET nricfront = COALESCE(?, nricfront), nricback = COALESCE(?, nricback), updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
          [nf, nb, normalized]
        );
      } catch (err) {
        if (!(err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054)) throw err;
      }
    }

    try {
      const contactService = require('../contact/contact.service');
      await contactService.syncAccountingContactsForProfileEmail(normalized);
    } catch (e) {
      console.warn('[portal-auth] syncAccountingContactsForProfileEmail', e?.message || e);
    }

    try {
      await pool.query(
        `UPDATE cln_employeedetail SET
          full_name = ?, phone = ?, address = ?, id_number = ?, tax_id_no = ?,
          bank_id = ?, bank_account_no = ?, bank_account_holder = ?,
          nric_front_url = COALESCE(?, nric_front_url), nric_back_url = COALESCE(?, nric_back_url),
          avatar_url = COALESCE(?, avatar_url),
          entity_type = COALESCE(?, entity_type), id_type = COALESCE(?, id_type),
          updated_at = CURRENT_TIMESTAMP(3)
         WHERE LOWER(TRIM(email)) = ?`,
        [fn, ph, addr, nr, tno, bid, bacc, ahold, nf, nb, aUrl, et, idt, normalized]
      );
    } catch (err) {
      const code = err?.code;
      const errno = err?.errno;
      if (code !== 'ER_NO_SUCH_TABLE' && errno !== 1146) {
        console.warn('[portal-auth] sync cln_employeedetail from portal_account:', err?.message || err);
      }
    }

    try {
      const [clientRows] = await pool.query(
        'SELECT id FROM cln_clientdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1',
        [normalized]
      );
      if (Array.isArray(clientRows) && clientRows.length > 0) {
        await pool.query(
          `UPDATE cln_clientdetail
             SET fullname = ?, phone = ?, address = ?,
                 portal_account_id = COALESCE(portal_account_id, ?),
                 updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ?`,
          [fn, ph, addr, portalAccountPk, String(clientRows[0].id)]
        );
      } else {
        const clientId = randomUUID();
        await pool.query(
          `INSERT INTO cln_clientdetail (id, email, fullname, phone, address, account, portal_account_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
          [clientId, normalized, fn, ph, addr, '[]', portalAccountPk]
        );
      }
    } catch (err) {
      const code = err?.code;
      const errno = err?.errno;
      if (code !== 'ER_NO_SUCH_TABLE' && errno !== 1146) {
        console.warn('[portal-auth] sync cln_clientdetail from portal_account:', err?.message || err);
      }
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'DB_ERROR' };
  }
}

/**
 * Update only bank fields on portal_account and sync bank columns to tenantdetail / staffdetail / ownerdetail.
 * Uses direct SET (not COALESCE) so empty strings can clear account number / holder when intended.
 * @param {string} email
 * @param {{ bankname_id?: string|null, bankaccount?: string|null, accountholder?: string|null }} fields
 */
async function updatePortalBankFields(email, fields) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  if (!fields || typeof fields !== 'object') {
    return { ok: false, reason: 'NO_PAYLOAD' };
  }
  const bid =
    fields.bankname_id === '' || fields.bankname_id == null ? null : String(fields.bankname_id);
  const bacc = fields.bankaccount != null ? String(fields.bankaccount).trim() : null;
  const ahold = fields.accountholder != null ? String(fields.accountholder).trim() : null;

  try {
    const [existing] = await pool.query(
      'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalized]
    );
    if (!existing.length) {
      return { ok: false, reason: 'NO_ACCOUNT' };
    }

    await pool.query(
      `UPDATE portal_account SET bankname_id = ?, bankaccount = ?, accountholder = ?, updated_at = NOW()
       WHERE LOWER(TRIM(email)) = ?`,
      [bid, bacc, ahold, normalized]
    );

    const [updated] = await pool.query(
      'SELECT fullname, phone, address, nric, bankname_id, bankaccount, accountholder FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalized]
    );
    const p = updated[0] || {};
    const fn = p.fullname ?? null;
    const ph = p.phone ?? null;
    const addr = p.address ?? null;
    const nr = p.nric ?? null;
    const bid2 = p.bankname_id ?? null;
    const bacc2 = p.bankaccount ?? null;
    const ahold2 = p.accountholder ?? null;

    await pool.query(
      'UPDATE tenantdetail SET fullname = ?, phone = ?, address = ?, nric = ?, bankname_id = ?, bankaccount = ?, accountholder = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
      [fn, ph, addr, nr, bid2, bacc2, ahold2, normalized]
    );
    await pool.query(
      'UPDATE staffdetail SET name = ?, bank_name_id = ?, bankaccount = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
      [fn, bid2, bacc2, normalized]
    );
    await pool.query(
      'UPDATE ownerdetail SET ownername = ?, mobilenumber = ?, nric = ?, bankname_id = ?, bankaccount = ?, accountholder = ?, updated_at = NOW() WHERE LOWER(TRIM(email)) = ?',
      [fn, ph, nr, bid2, bacc2, ahold2, normalized]
    );

    try {
      await pool.query(
        `UPDATE cln_employeedetail SET bank_id = ?, bank_account_no = ?, bank_account_holder = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE LOWER(TRIM(email)) = ?`,
        [bid2, bacc2, ahold2, normalized]
      );
    } catch (err) {
      if (err?.code !== 'ER_NO_SUCH_TABLE' && err?.errno !== 1146) {
        console.warn('[portal-auth] sync cln_employeedetail bank fields', err?.message || err);
      }
    }

    try {
      const contactService = require('../contact/contact.service');
      await contactService.syncAccountingContactsForProfileEmail(normalized);
    } catch (e) {
      console.warn('[portal-auth] syncAccountingContactsForProfileEmail (bank)', e?.message || e);
    }

    return { ok: true };
  } catch (err) {
    console.error('[portal-auth] updatePortalBankFields', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  }
}

/**
 * Forgot password: create or overwrite reset code for email, send email. Only if email exists in portal_account.
 * @returns {{ ok: boolean, reason? }} reason: NO_EMAIL | NO_ACCOUNT | DB_ERROR
 */
async function requestPasswordReset(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  const [existing] = await pool.query('SELECT id FROM portal_account WHERE email = ? LIMIT 1', [normalized]);
  if (!existing.length) {
    return { ok: false, reason: 'NO_ACCOUNT' };
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const RESET_CODE_EXPIRY_MINUTES = 30;
  try {
    // Use MySQL NOW() + interval so expires_at and confirmPasswordReset's "expires_at > NOW()" use same clock (no timezone mismatch)
    await pool.query(
      `INSERT INTO portal_password_reset (email, code, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))
       ON DUPLICATE KEY UPDATE code = ?, expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE)`,
      [normalized, code, RESET_CODE_EXPIRY_MINUTES, code, RESET_CODE_EXPIRY_MINUTES]
    );
    const sender = require('./portal-password-reset-sender');
    await sender.sendPasswordResetCode(normalized, code);
  } catch (err) {
    console.error('[portal-auth] requestPasswordReset DB/send error:', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  }
  return { ok: true };
}

/**
 * Reset password with code from email. Updates portal_account.password_hash and deletes reset row.
 * @returns {{ ok: boolean, reason? }} reason: NO_EMAIL | INVALID_OR_EXPIRED_CODE | DB_ERROR
 */
async function confirmPasswordReset(email, code, newPassword) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  const codeStr = String(code).trim();
  const [rows] = await pool.query(
    'SELECT email FROM portal_password_reset WHERE email = ? AND code = ? AND expires_at > NOW() LIMIT 1',
    [normalized, codeStr]
  );
  if (!rows || rows.length === 0) {
    // Debug: see why validation failed (wrong code vs expired)
    const [debugRows] = await pool.query(
      'SELECT code, expires_at FROM portal_password_reset WHERE email = ? LIMIT 1',
      [normalized]
    );
    if (debugRows.length > 0) {
      const row = debugRows[0];
      const dbCode = row.code != null ? String(row.code) : '';
      const codeMatch = dbCode === codeStr;
      const expiresAt = row.expires_at;
      const nowDb = await pool.query('SELECT NOW() AS now').then(([r]) => (r && r[0]) ? r[0].now : null);
      console.error('[portal-auth] reset-password fail: email=', normalized, 'code_match=', codeMatch, 'expires_at=', expiresAt, 'NOW()=', nowDb);
    } else {
      console.error('[portal-auth] reset-password fail: no row for email=', normalized);
    }
    return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' };
  }
  const password_hash = await hashPassword(newPassword);
  if (!password_hash) {
    return { ok: false, reason: 'INVALID_PASSWORD' };
  }
  try {
    await pool.query('UPDATE portal_account SET password_hash = ?, updated_at = NOW() WHERE email = ?', [password_hash, normalized]);
    await pool.query('DELETE FROM portal_password_reset WHERE email = ?', [normalized]);
  } catch (err) {
    return { ok: false, reason: 'DB_ERROR' };
  }
  return { ok: true };
}

/**
 * Ensure a `portal_account` row exists for this email (OAuth / Cleanlemons-first users may have none).
 * Inserts id + email + password_hash NULL when missing.
 */
async function ensurePortalAccountByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  try {
    const [existing] = await pool.query(
      'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalized]
    );
    if (existing.length) return { ok: true };
    const id = randomUUID();
    await pool.query(
      'INSERT INTO portal_account (id, email, password_hash) VALUES (?, ?, NULL)',
      [id, normalized]
    );
    return { ok: true };
  } catch (err) {
    console.error('[portal-auth] ensurePortalAccountByEmail', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  }
}

/**
 * Change password when logged in: verify currentPassword then set newPassword.
 * @returns {{ ok: boolean, reason?: string }}
 */
async function changePassword(email, currentPassword, newPassword) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  const [rows] = await pool.query(
    'SELECT id, password_hash FROM portal_account WHERE email = ? LIMIT 1',
    [normalized]
  );
  const account = rows[0];
  if (!account || !(await verifyPassword(currentPassword, account.password_hash))) {
    return { ok: false, reason: 'INVALID_CURRENT_PASSWORD' };
  }
  const password_hash = await hashPassword(newPassword);
  if (!password_hash) {
    return { ok: false, reason: 'INVALID_PASSWORD' };
  }
  try {
    await pool.query('UPDATE portal_account SET password_hash = ?, updated_at = NOW() WHERE email = ?', [password_hash, normalized]);
  } catch (err) {
    return { ok: false, reason: 'DB_ERROR' };
  }
  return { ok: true };
}

/**
 * Whether this account has a usable bcrypt password (not OAuth-only).
 * @returns {{ ok: boolean, hasPassword?: boolean, reason?: string }}
 */
async function getPasswordStatusForEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  try {
    const [rows] = await pool.query(
      'SELECT password_hash FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalized]
    );
    if (!rows.length) {
      return { ok: true, hasPassword: false };
    }
    return { ok: true, hasPassword: hasUsablePasswordHash(rows[0].password_hash) };
  } catch (err) {
    console.error('[portal-auth] getPasswordStatusForEmail', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  normalizeNricForMatch,
  assertNationalIdKeyForPortalAccount,
  register,
  login,
  findOrCreateByGoogle,
  findOrCreateByGoogleEnquiry,
  findOrCreateByGoogleCleanlemon,
  findOrCreateByFacebook,
  findOrCreateByFacebookEnquiry,
  findOrCreateByFacebookCleanlemon,
  signPortalToken,
  verifyPortalToken,
  getPortalProfile,
  updatePortalProfile,
  applyAliyunEkycToPortalAccount,
  getPasswordStatusForEmail,
  ensurePortalAccountByEmail,
  updatePortalBankFields,
  requestPasswordReset,
  confirmPasswordReset,
  changePassword,
  verifyPortalToken
};
