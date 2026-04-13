/**
 * Contact sync: find by email/full name in accounting system → if found update and return id, else create and return id.
 * Used when owner/tenant agrees (client accepts mapping) or staff is linked.
 * Writes contact id to: ownerdetail.account, tenantdetail.account, staffdetail.account, supplierdetail.account.
 *
 * Bukku (one email / one remote id can carry multiple types[] — merge on each sync):
 *   Push: staff → employee; owner → customer + supplier; tenant → customer; supplier → supplier.
 *   Pull (match remote row to local rows by email/name): customer → tenant rows only (operator can add Owner in UI);
 *   supplier → supplierdetail first, else same row can still match owner/tenant/staff by fallthrough;
 *   employee → staff; supplier → supplier+owner (same contact id written to each ensured row).
 *   See syncBukkuPullByTypes in contact.service.js.
 */

const { formatIntegrationApiError } = require('../../utils/formatIntegrationApiError');
const pool = require('../../config/db');
const bukkuContactWrapper = require('../bukku/wrappers/contact.wrapper');
const xeroContactWrapper = require('../xero/wrappers/contact.wrapper');
const autocountContactWrapper = require('../autocount/wrappers/contact.wrapper');
const sqlaccountContactWrapper = require('../sqlaccount/wrappers/contact.wrapper');

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

function normalize(str) {
  return String(str || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function looksLikeUuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(str || '').trim()
  );
}

function isXeroPhoneValidationError(err) {
  const msg = typeof err === 'string' ? err : JSON.stringify(err || {});
  return /phone|phones|phonenumber/i.test(msg);
}

function isXeroTransientError(resOrErr) {
  const status = Number(resOrErr?.status || 0);
  if (status >= 500) return true;
  const err = resOrErr?.error ?? resOrErr;
  const text = typeof err === 'string' ? err : JSON.stringify(err || {});
  return /"Status"\s*:\s*500|an error occurred in xero|temporar|timeout|service unavailable|gateway/i.test(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withXeroRetry(fn, maxAttempts = 3) {
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fn();
      if (res?.ok || !isXeroTransientError(res) || attempt === maxAttempts) return res;
      last = res;
    } catch (e) {
      if (attempt === maxAttempts || !isXeroTransientError(e)) throw e;
      last = e;
    }
    await sleep(250 * attempt);
  }
  return last;
}

/** staffdetail has no phone column; use portal_account.phone for the same email (operator profile). */
async function resolvePortalPhoneForEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return '';
  try {
    const [rows] = await pool.query('SELECT phone FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1', [e]);
    return rows[0]?.phone != null ? String(rows[0].phone).trim() : '';
  } catch (_) {
    return '';
  }
}

/** Bukku API body (see `bukku/validators/contact.validator.js`): entity_type + legal_name + types[] required. */
function bukkuEntityTypeForRole(role) {
  return role === 'supplier' ? 'MALAYSIAN_COMPANY' : 'MALAYSIAN_INDIVIDUAL';
}

/** One local role → Bukku `types[]` (owner is both customer and supplier in Bukku). */
function bukkuTypesForRole(role) {
  switch (role) {
    case 'staff':
      return ['employee'];
    case 'supplier':
      return ['supplier'];
    case 'owner':
      return ['customer', 'supplier'];
    case 'tenant':
      return ['customer'];
    default:
      return ['customer'];
  }
}

function normalizeBukkuType(t) {
  return String(t || '')
    .trim()
    .toLowerCase();
}

/** Union remote `types` with types required for this sync role (same email may sync as owner then tenant, etc.). */
function mergeBukkuTypesForRole(existingTypes, role) {
  const fromRole = bukkuTypesForRole(role);
  const fromApi = Array.isArray(existingTypes)
    ? existingTypes.map(normalizeBukkuType).filter(Boolean)
    : [];
  const set = new Set([...fromApi, ...fromRole.map(normalizeBukkuType)]);
  return Array.from(set);
}

function unwrapBukkuContactReadBody(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.contact && typeof data.contact === 'object') return data.contact;
  if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) return data.data;
  return data;
}

/**
 * Bukku POST /sales/invoices (cash) rejects contacts that are supplier-only ("contact selected is invalid").
 * Credit invoices do not have this rule — so Management Fees → tenant credit can work while Owner Commission → owner cash fails.
 * Call after resolving owner contact id, before creating cash sales invoice.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function ensureBukkuContactHasCustomerTypeForSales(req, contactId) {
  const id = Number(contactId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, reason: 'INVALID_CONTACT_ID' };
  }
  const readRes = await bukkuContactWrapper.read(req, id);
  if (!readRes?.ok) {
    return { ok: false, reason: formatIntegrationApiError(readRes?.error) || 'BUKKU_CONTACT_READ_FAILED' };
  }
  const raw = unwrapBukkuContactReadBody(readRes.data);
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'BUKKU_CONTACT_READ_EMPTY' };
  }
  const prev = Array.isArray(raw.types) ? raw.types : [];
  if (prev.some((t) => String(t).toLowerCase() === 'customer')) {
    return { ok: true };
  }
  const mergedTypes = [...prev.map((t) => String(t)), 'customer'];
  const legal =
    (raw.legal_name || raw.legalName || 'Contact').toString().trim().slice(0, 100) || 'Contact';
  const updatePayload = {
    entity_type:
      raw.entity_type && String(raw.entity_type).trim()
        ? raw.entity_type
        : bukkuEntityTypeForRole('owner'),
    types: mergedTypes,
    legal_name: legal
  };
  const em = raw.email != null && String(raw.email).trim() ? String(raw.email).trim().toLowerCase() : '';
  if (em) updatePayload.email = em;
  const phoneNorm = normalizePhoneForBukku(raw.phone_no || raw.phoneNo || raw.phone || '');
  if (phoneNorm) updatePayload.phone_no = phoneNorm;
  let updateRes = await bukkuContactWrapper.update(req, id, updatePayload);
  if (!updateRes?.ok && updatePayload.phone_no) {
    const { phone_no: _p, ...withoutPhone } = updatePayload;
    updateRes = await bukkuContactWrapper.update(req, id, withoutPhone);
  }
  if (!updateRes?.ok) {
    return {
      ok: false,
      reason: formatIntegrationApiError(updateRes?.error) || 'BUKKU_CONTACT_ADD_CUSTOMER_TYPE_FAILED'
    };
  }
  return { ok: true };
}

/** Same name resolution as normalizeBukkuContactListItem — list API may omit legal_name but set display_name. */
function bukkuContactLegalLabel(c) {
  const raw = c || {};
  return String(
    raw.legal_name ?? raw.legalName ?? raw.name ?? raw.display_name ?? raw.company_name ?? raw.other_name ?? ''
  ).trim();
}

/** Normalized distinct name strings on a Bukku row (for equality with our profile / legal_name). */
function bukkuRowNameNorms(c) {
  const raw = c || {};
  const candidates = [
    raw.legal_name,
    raw.legalName,
    raw.name,
    raw.display_name,
    raw.company_name,
    raw.other_name
  ];
  const out = new Set();
  for (const x of candidates) {
    const s = normalize(String(x || ''));
    if (s) out.add(s);
  }
  return out;
}

/** Primary email from Bukku contact row (top-level `email` or first `email_addresses[]`). */
function bukkuRowPrimaryEmail(c) {
  const s = bukkuRowEmailsNormalized(c);
  return s.size ? [...s][0] : '';
}

/** All emails on a Bukku row (top-level + every `email_addresses[]`) for matching portal supplier email. */
function bukkuRowEmailsNormalized(c) {
  const out = new Set();
  if (c == null) return out;
  if (c.email != null && String(c.email).trim() !== '') out.add(normalize(String(c.email)));
  if (Array.isArray(c.email_addresses)) {
    for (const ea of c.email_addresses) {
      const em = String(ea?.email ?? ea?.address ?? ea ?? '').trim();
      if (em) out.add(normalize(em));
    }
  }
  return out;
}

/**
 * Paginate Bukku GET /contacts. A single page often misses matches → POST create hits
 * "legal_name has already been taken" while export/sync appears stuck.
 */
async function findBukkuContactPaginated(req, existingContactId, email, name) {
  const perPage = 100;
  const maxPages = 100;
  let page = 1;
  const e = email ? normalize(email) : '';
  const n = name ? normalize(name) : '';

  while (page <= maxPages) {
    const listRes = await bukkuContactWrapper.list(req, { page, page_size: perPage });
    if (!listRes.ok) {
      return {
        ok: false,
        reason: formatIntegrationApiError(listRes.error) || 'BUKKU_LIST_FAILED',
        found: null
      };
    }
    const raw = listRes.data;
    const pageContacts = Array.isArray(raw?.contacts) ? raw.contacts : Array.isArray(raw) ? raw : [];
    let found = null;
    if (existingContactId) {
      found = pageContacts.find((c) => String(c.id) === String(existingContactId));
    }
    if (!found && (e || n)) {
      found = pageContacts.find(
        (c) =>
          (e && bukkuRowEmailsNormalized(c).has(e)) ||
          (n && bukkuRowNameNorms(c).has(n))
      );
    }
    if (found) return { ok: true, found };

    // Do not trust total_pages alone — Bukku sometimes reports total_pages=1 while more pages exist.
    if (!pageContacts.length) break;
    if (pageContacts.length < perPage) break;
    page += 1;
  }
  return { ok: true, found: null };
}

/**
 * Paginate GET /contacts with extra query params (e.g. search). Stops when matcher returns a row or pages exhaust.
 */
async function findBukkuContactInFilteredPages(req, queryBase, matchesFn) {
  const perPage = 100;
  const maxPages = 30;
  let page = 1;
  while (page <= maxPages) {
    const listRes = await bukkuContactWrapper.list(req, { ...queryBase, page, page_size: perPage });
    if (!listRes.ok) {
      return {
        ok: false,
        reason: formatIntegrationApiError(listRes.error) || 'BUKKU_LIST_FAILED',
        found: null
      };
    }
    const raw = listRes.data;
    const pageContacts = Array.isArray(raw?.contacts) ? raw.contacts : Array.isArray(raw) ? raw : [];
    const found = pageContacts.find(matchesFn);
    if (found) return { ok: true, found };

    if (!pageContacts.length) break;
    if (pageContacts.length < perPage) break;
    page += 1;
  }
  return { ok: true, found: null };
}

/**
 * legal_name collision but list rows lack fields: walk every page, GET /contacts/:id until legal_name matches.
 */
async function findBukkuContactByLegalNameReadScan(req, wantLegalNorm) {
  if (!wantLegalNorm) return { ok: true, found: null };
  const perPage = 100;
  const maxPages = 100;
  let page = 1;
  while (page <= maxPages) {
    const listRes = await bukkuContactWrapper.list(req, { page, page_size: perPage });
    if (!listRes.ok) {
      return {
        ok: false,
        reason: formatIntegrationApiError(listRes.error) || 'BUKKU_LIST_FAILED',
        found: null
      };
    }
    const raw = listRes.data;
    const pageContacts = Array.isArray(raw?.contacts) ? raw.contacts : Array.isArray(raw) ? raw : [];
    for (const c of pageContacts) {
      const id = c?.id;
      if (id == null) continue;
      if (bukkuRowNameNorms(c).has(wantLegalNorm)) {
        return { ok: true, found: c };
      }
      const readRes = await bukkuContactWrapper.read(req, id);
      if (!readRes.ok) continue;
      const root = readRes.data;
      const contact = root?.contact ?? (root?.data && typeof root.data === 'object' ? root.data : null) ?? root;
      if (contact && bukkuRowNameNorms(contact).has(wantLegalNorm)) {
        return { ok: true, found: contact };
      }
    }
    if (!pageContacts.length) break;
    if (pageContacts.length < perPage) break;
    page += 1;
  }
  return { ok: true, found: null };
}

/** Bukku validates phone (e.g. rejects `+012...`); normalize MY mobile to E.164 +60… */
function normalizePhoneForBukku(phone) {
  if (phone == null) return '';
  let s0 = String(phone).trim().replace(/\s+/g, '');
  s0 = s0.replace(/[\uFEFF\u200B-\u200D\u2060]/g, '').replace(/＋/g, '+');
  const plusAt = s0.indexOf('+');
  if (plusAt > 0) s0 = s0.slice(plusAt);
  if (!s0) return '';
  // Common typo: +6012… written as +012… (must keep leading 1 after +60)
  const mPlus0 = s0.match(/^\+0(1\d{8,11})$/);
  if (mPlus0) return `+60${mPlus0[1]}`;
  if (/^01\d{8,11}$/.test(s0)) return `+60${s0.slice(1)}`;
  if (s0.length > 60) return s0.slice(0, 60);
  return s0;
}

/**
 * Build req-like object for provider wrappers (they expect req.client.id and possibly creds on req.client).
 * @param {string} clientId
 * @param {string} provider - bukku|xero|autocount|sql
 * @returns {Promise<{ req: object }>}
 */
async function buildReqForProvider(clientId, provider) {
  const [rows] = await pool.query(
    `SELECT provider, values_json FROM client_integration
     WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND provider = ? AND enabled = 1 LIMIT 1`,
    [clientId, provider]
  );
  if (rows.length) {
    const values = parseJson(rows[0].values_json) || {};
    const req = { client: { id: clientId } };
    if (provider === 'bukku') {
      req.client.bukku_secretKey = values.bukku_secretKey || values.bukku_token;
      req.client.bukku_subdomain = values.bukku_subdomain;
      if (!req.client.bukku_secretKey || !req.client.bukku_subdomain) throw new Error('NO_BUKKU_CREDENTIALS');
    }
    return { req };
  }
  const [clnRows] = await pool.query(
    `SELECT values_json FROM cln_operator_integration
     WHERE operator_id = ? AND \`key\` IN ('Account', 'addonAccount') AND provider = ? AND enabled = 1 LIMIT 1`,
    [clientId, provider]
  );
  if (!clnRows.length) throw new Error('NO_ACCOUNT_INTEGRATION');
  const values = parseJson(clnRows[0].values_json) || {};
  const req = { client: { id: clientId } };
  if (provider === 'bukku') {
    req.client.bukku_secretKey = values.bukku_secretKey || values.bukku_token;
    req.client.bukku_subdomain = values.bukku_subdomain;
    if (!req.client.bukku_secretKey || !req.client.bukku_subdomain) throw new Error('NO_BUKKU_CREDENTIALS');
  }
  return { req };
}

/**
 * Find or create contact in accounting system. First search by email or full name; if found return id (optionally update); else create and return id.
 * @param {string} clientId
 * @param {string} provider - bukku|xero|autocount|sql
 * @param {string} role - owner|tenant|staff|supplier (Bukku push types: see bukkuTypesForRole)
 * @param {{ name?: string, fullname?: string, email?: string, phone?: string }} record
 * @param {string} [existingContactId] - if already in account JSON, try update first
 * @returns {Promise<{ ok: boolean, contactId?: string, reason?: string }>}
 */
async function ensureContactInAccounting(clientId, provider, role, record, existingContactId, options = {}) {
  const preserveLegalName = options.preserveLegalName === true;
  const name = (record.name || record.fullname || '').trim();
  const email = (record.email || '').trim().toLowerCase();
  const phone = (record.phone || '').trim();
  /** When fullname is empty (e.g. booking with new tenant email only), use email as display name in accounting. */
  const displayName = name || email || 'Contact';
  let req;
  try {
    ({ req } = await buildReqForProvider(clientId, provider));
  } catch (e) {
    return { ok: false, reason: e?.message || 'BUILD_REQ_FAILED' };
  }

  try {
    if (provider === 'bukku') {
      const bukkuUpdateExisting = async (foundRow) => {
        const prevLegal = bukkuContactLegalLabel(foundRow);
        /** Operator linking owner/tenant account id must not overwrite Bukku legal_name with profile name (unique constraint). */
        const legalName = preserveLegalName
          ? (prevLegal || displayName).slice(0, 100)
          : (displayName || prevLegal).slice(0, 100);
        /** Bukku PUT /contacts/:id still requires entity_type + types (same as create). Preserve remote values. */
        const entityType =
          foundRow.entity_type && String(foundRow.entity_type).trim()
            ? foundRow.entity_type
            : bukkuEntityTypeForRole(role);
        const types = mergeBukkuTypesForRole(foundRow.types, role);
        const phoneNorm = normalizePhoneForBukku(phone);
        const updatePayload = {
          entity_type: entityType,
          types,
          legal_name: legalName,
          ...(email ? { email } : {}),
          ...(phoneNorm ? { phone_no: phoneNorm } : {})
        };
        let updateRes = await bukkuContactWrapper.update(req, foundRow.id, updatePayload);
        if (!updateRes.ok && phoneNorm) {
          const err = updateRes.error;
          const msg = typeof err === 'string' ? err : JSON.stringify(err);
          if (/phone_no/i.test(msg)) {
            const { phone_no: _p, ...withoutPhone } = updatePayload;
            updateRes = await bukkuContactWrapper.update(req, foundRow.id, withoutPhone);
          }
        }
        if (!updateRes.ok) {
          const err = updateRes.error;
          const msg = typeof err === 'string' ? err : JSON.stringify(err);
          return { ok: false, reason: msg || 'BUKKU_UPDATE_FAILED' };
        }
        return { ok: true, contactId: String(foundRow.id) };
      };

      const paginated = await findBukkuContactPaginated(req, existingContactId, email, name);
      if (!paginated.ok) return { ok: false, reason: paginated.reason || 'BUKKU_LIST_FAILED' };
      let found = paginated.found;
      if (found) {
        return bukkuUpdateExisting(found);
      }
      const legalName = displayName.slice(0, 100);
      const createPayload = {
        entity_type: bukkuEntityTypeForRole(role),
        legal_name: legalName,
        types: mergeBukkuTypesForRole([], role)
      };
      if (email) createPayload.email = email;
      const phoneNorm = normalizePhoneForBukku(phone);
      if (phoneNorm) createPayload.phone_no = phoneNorm;
      let createRes = await bukkuContactWrapper.create(req, createPayload);
      if (!createRes.ok && createPayload.phone_no) {
        const err = createRes.error;
        const msg = typeof err === 'string' ? err : JSON.stringify(err);
        if (/phone_no/i.test(msg)) {
          const { phone_no: _ph, ...withoutPhone } = createPayload;
          createRes = await bukkuContactWrapper.create(req, withoutPhone);
        }
      }
      if (!createRes.ok) {
        const err = createRes.error;
        const msg = typeof err === 'string' ? err : JSON.stringify(err);
        const looksDup =
          /legal_name/i.test(msg) &&
          /already been taken|already exists|taken|duplicate/i.test(String(msg).toLowerCase());
        // POST failed because legal_name exists: find that row via search + match email, profile name, or exact legal_name we tried to create.
        if (looksDup) {
          const terms = [...new Set([email, name, displayName, legalName].filter(Boolean))];
          const wantE = email ? normalize(email) : '';
          const wantN = name ? normalize(name) : '';
          const wantLegal = legalName ? normalize(legalName) : '';
          const matchesRescue = (c) => {
            if (wantE && bukkuRowEmailsNormalized(c).has(wantE)) return true;
            const norms = bukkuRowNameNorms(c);
            if (wantN && norms.has(wantN)) return true;
            if (wantLegal && norms.has(wantLegal)) return true;
            return false;
          };
          for (const term of terms) {
            const filtered = await findBukkuContactInFilteredPages(
              req,
              { search: String(term).slice(0, 100) },
              matchesRescue
            );
            if (!filtered.ok) continue;
            if (filtered.found) {
              return bukkuUpdateExisting(filtered.found);
            }
          }
          const retryPaginated = await findBukkuContactPaginated(req, existingContactId, email, legalName);
          if (retryPaginated.ok && retryPaginated.found) {
            return bukkuUpdateExisting(retryPaginated.found);
          }
          const readScan = await findBukkuContactByLegalNameReadScan(req, wantLegal);
          if (readScan.ok && readScan.found) {
            return bukkuUpdateExisting(readScan.found);
          }
        }
        return { ok: false, reason: msg || 'BUKKU_CREATE_FAILED' };
      }
      const created = createRes.data ?? createRes;
      const newId = created?.id ?? created?.data?.id;
      if (!newId) return { ok: false, reason: 'BUKKU_CREATE_FAILED' };
      return { ok: true, contactId: String(newId) };
    }

    if (provider === 'xero') {
      let found = null;
      const existingId = String(existingContactId || '').trim();
      if (existingContactId && String(existingContactId).trim()) {
        try {
          const readRes = await withXeroRetry(
            () => xeroContactWrapper.read(req, String(existingContactId).trim())
          );
          if (readRes?.ok) {
            found = readRes.data?.Contacts?.[0] || readRes.data?.Contact || null;
          }
        } catch (err) {
          // Xero transient outage: if we already have a mapped ContactID, keep it and avoid false failure.
          if (looksLikeUuid(existingId) && isXeroTransientError(err)) {
            return { ok: true, contactId: existingId };
          }
          // Fallback to list by email/name below.
        }
      }
      if (!found && (email || name)) {
        if (email) {
          try {
            const where = `EmailAddress=="${String(email).replace(/"/g, '\\"')}"`;
            const byEmailRes = await withXeroRetry(
              () => xeroContactWrapper.list(req, { where })
            );
            if (byEmailRes?.ok) {
              const byEmail = Array.isArray(byEmailRes.data?.Contacts) ? byEmailRes.data.Contacts : [];
              found = byEmail.find((c) => normalize((c.EmailAddress || '').toString()) === email) || null;
            }
          } catch (_) {
            // Fall through to broad list.
          }
        }
        if (!found) {
          const listRes = await withXeroRetry(() => xeroContactWrapper.list(req, {}));
          if (!listRes.ok) {
            return { ok: false, reason: formatIntegrationApiError(listRes.error) || 'XERO_LIST_FAILED' };
          }
          const contacts = Array.isArray(listRes.data?.Contacts) ? listRes.data.Contacts : [];
          found = contacts.find(
            (c) =>
              (email && normalize((c.EmailAddress || '').toString()) === email) ||
              (name && normalize((c.Name || '').toString()) === normalize(name))
          );
        }
      }
      if (found) {
        const cid = found.ContactID || found.contactID;
        const xUp = {
          Name: preserveLegalName ? found.Name : displayName || found.Name,
          EmailAddress: email || found.EmailAddress
        };
        if (phone) {
          xUp.Phones = [{ PhoneType: 'DEFAULT', PhoneNumber: phone }];
        }
        let updateRes = await withXeroRetry(() => xeroContactWrapper.update(req, cid, xUp));
        if (!updateRes?.ok && xUp.Phones && isXeroPhoneValidationError(updateRes?.error)) {
          const { Phones: _drop, ...withoutPhone } = xUp;
          updateRes = await withXeroRetry(() => xeroContactWrapper.update(req, cid, withoutPhone));
        }
        if (!updateRes?.ok) {
          // Keep existing mapping on transient provider outage; do not fail the full sync-all.
          if (looksLikeUuid(cid) && isXeroTransientError(updateRes)) {
            return { ok: true, contactId: cid };
          }
          return { ok: false, reason: formatIntegrationApiError(updateRes?.error) || 'XERO_UPDATE_FAILED' };
        }
        return { ok: true, contactId: cid };
      }
      const xCreate = {
        Name: displayName,
        EmailAddress: email || undefined
      };
      if (phone) {
        xCreate.Phones = [{ PhoneType: 'DEFAULT', PhoneNumber: phone }];
      }
      let createRes = await withXeroRetry(() => xeroContactWrapper.create(req, xCreate));
      if (!createRes?.ok && xCreate.Phones && isXeroPhoneValidationError(createRes?.error)) {
        const { Phones: _drop, ...withoutPhone } = xCreate;
        createRes = await withXeroRetry(() => xeroContactWrapper.create(req, withoutPhone));
      }
      if (!createRes?.ok) {
        return { ok: false, reason: formatIntegrationApiError(createRes?.error) || 'XERO_CREATE_FAILED' };
      }
      const created = createRes.data?.Contacts?.[0];
      if (!created) return { ok: false, reason: 'XERO_CREATE_FAILED' };
      return { ok: true, contactId: created.ContactID || created.contactID };
    }

    if (provider === 'autocount') {
      if (role === 'supplier') {
        const listRes = await autocountContactWrapper.listCreditors(req, {});
        if (!listRes.ok)
          return {
            ok: false,
            reason: formatIntegrationApiError(listRes.error) || 'AUTOCOUNT_LIST_CREDITORS_FAILED'
          };
        const raw = listRes.data || {};
        const creditors = Array.isArray(raw.creditors) ? raw.creditors : Array.isArray(raw) ? raw : [];
        let found = null;
        if (existingContactId) {
          found = creditors.find((c) => String(c.id || c.Id || c.code) === String(existingContactId));
        }
        if (!found && (email || name)) {
          found = creditors.find(
            (c) =>
              (email && normalize((c.email || c.Email || '').toString()) === email) ||
              (name && normalize((c.name || c.Name || '').toString()) === normalize(name))
          );
        }
        if (found) {
          const cid = found.id ?? found.Id ?? found.code;
          await autocountContactWrapper.updateCreditor(req, cid, {
            name: preserveLegalName ? found.name : displayName || found.name,
            email: email || found.email
          });
          return { ok: true, contactId: String(cid) };
        }
        const createRes = await autocountContactWrapper.createCreditor(req, { name: displayName, email: email || undefined });
        const created = createRes.data?.creditor ?? createRes.data?.Creditor ?? createRes.data;
        if (!created) return { ok: false, reason: 'AUTOCOUNT_CREATE_CREDITOR_FAILED' };
        return { ok: true, contactId: String(created.id ?? created.Id ?? created.code) };
      }
      const listRes = await autocountContactWrapper.listDebtors(req, {});
      if (!listRes.ok)
        return { ok: false, reason: formatIntegrationApiError(listRes.error) || 'AUTOCOUNT_LIST_FAILED' };
      const raw = listRes.data || {};
      const debtors = Array.isArray(raw.debtors) ? raw.debtors : Array.isArray(raw) ? raw : [];
      let found = null;
      if (existingContactId) {
        found = debtors.find((d) => String(d.id || d.Id || d.code) === String(existingContactId));
      }
      if (!found && (email || name)) {
        found = debtors.find(
          (d) =>
            (email && normalize((d.email || d.Email || '').toString()) === email) ||
            (name && normalize((d.name || d.Name || '').toString()) === normalize(name))
        );
      }
      if (found) {
        const did = found.id ?? found.Id ?? found.code;
        await autocountContactWrapper.updateDebtor(req, did, {
          name: preserveLegalName ? found.name : displayName || found.name,
          email: email || found.email
        });
        return { ok: true, contactId: String(did) };
      }
      const createRes = await autocountContactWrapper.createDebtor(req, { name: displayName, email: email || undefined });
      const created = createRes.data?.debtor ?? createRes.data?.Debtor ?? createRes.data;
      if (!created) return { ok: false, reason: 'AUTOCOUNT_CREATE_FAILED' };
      return { ok: true, contactId: String(created.id ?? created.Id ?? created.code) };
    }

    if (provider === 'sql') {
      const isSupplier = role === 'supplier';
      const listRes = isSupplier
        ? await sqlaccountContactWrapper.listSuppliers(req, {})
        : await sqlaccountContactWrapper.listCustomers(req, {});
      if (!listRes.ok)
        return { ok: false, reason: formatIntegrationApiError(listRes.error) || 'SQL_LIST_FAILED' };
      const raw = listRes.data || {};
      const rows = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : [];
      const list = rows.map((r) => {
        const code = String(r.code ?? r.Code ?? '').trim();
        const nm =
          r.description ??
          r.Description ??
          r.companyname ??
          r.CompanyName ??
          r.name ??
          r.Name ??
          '';
        return {
          ...r,
          id: String(code || r.dockey || r.Dockey || ''),
          code,
          name: String(nm),
          email: String(r.email ?? r.Email ?? '')
            .trim()
            .toLowerCase()
        };
      });
      let found = null;
      if (existingContactId) {
        const existingCode = String(existingContactId).trim();
        found = list.find((c) => String(c.code || c.Code || '').trim() === existingCode);
      }
      if (!found && (email || name)) {
        found = list.find(
          (c) =>
            (email && normalize((c.email || '').toString()) === email) ||
            (name && normalize((c.name || '').toString()) === normalize(name))
        );
      }
      const profileBody = {
        name: displayName,
        email: email || undefined
      };
      if (found) {
        const cid = String(found.code || found.Code || '').trim();
        if (!cid) found = null;
      }
      if (found) {
        const cid = String(found.code || found.Code || '').trim();
        const updateRes = isSupplier
          ? await sqlaccountContactWrapper.updateSupplier(req, cid, {
              ...profileBody,
              name: preserveLegalName ? found.name : displayName || found.name,
              email: email || found.email || undefined
            })
          : await sqlaccountContactWrapper.updateCustomer(req, cid, {
              ...profileBody,
              name: preserveLegalName ? found.name : displayName || found.name,
              email: email || found.email || undefined
            });
        if (!updateRes.ok) {
          return { ok: false, reason: formatIntegrationApiError(updateRes.error) || 'SQL_UPDATE_FAILED' };
        }
        return { ok: true, contactId: cid };
      }
      const createRes = isSupplier
        ? await sqlaccountContactWrapper.createSupplier(req, profileBody)
        : await sqlaccountContactWrapper.createCustomer(req, profileBody);
      if (!createRes.ok) {
        return { ok: false, reason: formatIntegrationApiError(createRes.error) || 'SQL_CREATE_FAILED' };
      }
      const created = createRes.data;
      const newCode =
        created?.code ??
        created?.Code ??
        (Array.isArray(created?.data) && created.data[0] ? created.data[0].code || created.data[0].Code : null) ??
        created?.dockey ??
        created?.Dockey;
      if (newCode == null || String(newCode).trim() === '') return { ok: false, reason: 'SQL_CREATE_FAILED' };
      return { ok: true, contactId: String(newCode).trim() };
    }

    return { ok: false, reason: 'UNSUPPORTED_PROVIDER' };
  } catch (err) {
    return { ok: false, reason: err.message || 'SYNC_FAILED' };
  }
}

/**
 * Merge one (clientId, provider, id) into account JSON array; replace same client+provider.
 */
function mergeAccountEntry(accountArr, clientId, provider, contactId) {
  const list = Array.isArray(accountArr) ? [...accountArr] : [];
  const filtered = list.filter((a) => !(a.clientId === clientId && a.provider === provider));
  filtered.push({ clientId, provider, id: String(contactId) });
  return filtered;
}

/**
 * Write contact id to ownerdetail.account for (clientId, provider).
 */
async function writeOwnerAccount(ownerId, clientId, provider, contactId) {
  const [rows] = await pool.query('SELECT id, account FROM ownerdetail WHERE id = ? LIMIT 1', [ownerId]);
  if (!rows.length) return { ok: false, reason: 'OWNER_NOT_FOUND' };
  const account = parseJson(rows[0].account) || [];
  const merged = mergeAccountEntry(account, clientId, provider, contactId);
  await pool.query('UPDATE ownerdetail SET account = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(merged), ownerId]);
  return { ok: true };
}

/**
 * Write contact id to tenantdetail.account for (clientId, provider).
 */
async function writeTenantAccount(tenantId, clientId, provider, contactId) {
  const [rows] = await pool.query('SELECT id, account FROM tenantdetail WHERE id = ? LIMIT 1', [tenantId]);
  if (!rows.length) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const account = parseJson(rows[0].account) || [];
  const merged = mergeAccountEntry(account, clientId, provider, contactId);
  await pool.query('UPDATE tenantdetail SET account = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(merged), tenantId]);
  return { ok: true };
}

/**
 * Write contact id to staffdetail.account for (clientId, provider).
 */
async function writeStaffAccount(staffId, clientId, provider, contactId) {
  const [rows] = await pool.query('SELECT id, account FROM staffdetail WHERE id = ? LIMIT 1', [staffId]);
  if (!rows.length) return { ok: false, reason: 'STAFF_NOT_FOUND' };
  const account = parseJson(rows[0].account) || [];
  const merged = mergeAccountEntry(account, clientId, provider, contactId);
  await pool.query('UPDATE staffdetail SET account = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(merged), staffId]);
  return { ok: true };
}

/**
 * Sync staff (employee) to accounting contact for a client. Find by email/name → update or create; write to staffdetail.account.
 * Call when linking staff to client or from Company Setting. Requires staffdetail.account column (migration 0057).
 */
async function syncStaffForClient(staffId, clientId) {
  const [staffRows] = await pool.query(
    'SELECT id, name, email, account FROM staffdetail WHERE id = ? LIMIT 1',
    [staffId]
  );
  const s = staffRows[0];
  if (!s) return { ok: false, reason: 'STAFF_NOT_FOUND' };

  const [intRows] = await pool.query(
    `SELECT provider FROM client_integration WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  const provider = intRows[0]?.provider;
  if (!provider || !['bukku', 'xero', 'autocount', 'sql'].includes(provider)) {
    return { ok: false, reason: 'NO_ACCOUNT_INTEGRATION' };
  }

  const account = parseJson(s.account) || [];
  const existingMapping = account.find((a) => a.clientId === clientId && a.provider === provider);
  const existingId = existingMapping?.id ?? existingMapping?.contactId;

  const portalPhone = await resolvePortalPhoneForEmail(s.email);
  const record = {
    name: s.name || '',
    fullname: s.name || '',
    email: s.email || '',
    phone: portalPhone
  };

  const syncRes = await ensureContactInAccounting(clientId, provider, 'staff', record, existingId);
  if (!syncRes.ok) return { ok: false, reason: syncRes.reason || 'SYNC_FAILED' };

  const writeRes = await writeStaffAccount(staffId, clientId, provider, syncRes.contactId);
  if (!writeRes.ok) return { ok: false, reason: writeRes.reason || 'WRITE_FAILED' };

  return { ok: true, contactId: syncRes.contactId };
}

/**
 * Sync staff to all enabled accounting providers (xero/bukku/autocount/sql) for this client.
 * Get contact by email/name or create; write contactId to staffdetail.account.
 * Call from Company Setting when admin clicks #buttonupdateusersetting (after updateStaff/createStaff) if client has pricing plan & integration.
 */
async function syncStaffToAllAccountingProviders(staffId, clientId) {
  const [staffRows] = await pool.query(
    'SELECT id, name, email, account FROM staffdetail WHERE id = ? LIMIT 1',
    [staffId]
  );
  const s = staffRows[0];
  if (!s) return { ok: false, reason: 'STAFF_NOT_FOUND' };

  const [intRows] = await pool.query(
    `SELECT provider FROM client_integration WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1`,
    [clientId]
  );
  const providers = (intRows || []).map((r) => r.provider).filter((p) => ['bukku', 'xero', 'autocount', 'sql'].includes(p));
  if (providers.length === 0) return { ok: true, synced: [] };

  const account = parseJson(s.account) || [];
  const portalPhone = await resolvePortalPhoneForEmail(s.email);
  const record = {
    name: s.name || '',
    fullname: s.name || '',
    email: s.email || '',
    phone: portalPhone
  };
  const synced = [];
  for (const provider of providers) {
    const existingMapping = account.find((a) => a.clientId === clientId && a.provider === provider);
    const existingId = existingMapping?.id ?? existingMapping?.contactId;
    const syncRes = await ensureContactInAccounting(clientId, provider, 'staff', record, existingId);
    if (!syncRes.ok) continue;
    const writeRes = await writeStaffAccount(staffId, clientId, provider, syncRes.contactId);
    if (writeRes.ok) synced.push({ provider, contactId: syncRes.contactId });
  }
  return { ok: true, synced };
}

/**
 * Get or sync staff contact for a specific accounting provider. Returns contactId for use in money out / purchase.
 * @param {string} staffId
 * @param {string} clientId
 * @param {string} provider - 'bukku'|'xero'|'autocount'|'sql'
 * @returns {Promise<{ ok: boolean, contactId?: string, reason?: string }>}
 */
async function getOrSyncStaffContactForProvider(staffId, clientId, provider) {
  if (!staffId || !clientId || !provider) return { ok: false, reason: 'MISSING_PARAMS' };
  const [staffRows] = await pool.query(
    'SELECT id, name, email, account FROM staffdetail WHERE id = ? LIMIT 1',
    [staffId]
  );
  const s = staffRows[0];
  if (!s) return { ok: false, reason: 'STAFF_NOT_FOUND' };
  const account = parseJson(s.account) || [];
  const arr = Array.isArray(account) ? account : [];
  const prov = String(provider).toLowerCase();
  let entry = arr.find((a) => (a.clientId === clientId || a.client_id === clientId) && ((a.system || a.provider || '').toLowerCase() === prov));
  let contactId = entry ? (entry.id || entry.contactId) : null;
  if (contactId) return { ok: true, contactId: String(contactId) };
  const portalPhone = await resolvePortalPhoneForEmail(s.email);
  const record = {
    name: s.name || '',
    fullname: s.name || '',
    email: s.email || '',
    phone: portalPhone
  };
  const syncRes = await ensureContactInAccounting(clientId, provider, 'staff', record, null);
  if (!syncRes.ok) return { ok: false, reason: syncRes.reason || 'STAFF_SYNC_FAILED' };
  const writeRes = await writeStaffAccount(staffId, clientId, provider, syncRes.contactId);
  if (!writeRes.ok) return { ok: false, reason: writeRes.reason || 'WRITE_FAILED' };
  return { ok: true, contactId: syncRes.contactId };
}

module.exports = {
  ensureContactInAccounting,
  ensureBukkuContactHasCustomerTypeForSales,
  mergeAccountEntry,
  writeOwnerAccount,
  writeTenantAccount,
  writeStaffAccount,
  syncStaffForClient,
  syncStaffToAllAccountingProviders,
  getOrSyncStaffContactForProvider,
  buildReqForProvider,
  resolvePortalPhoneForEmail
};
