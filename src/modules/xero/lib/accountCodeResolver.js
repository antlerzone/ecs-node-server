const xeroAccount = require('../wrappers/account.wrapper');

async function resolveXeroAccountCode(req, codeOrId) {
  const raw = codeOrId != null ? String(codeOrId).trim() : '';
  if (!raw) return '';
  // Already a code.
  if (!raw.includes('-')) return raw;
  const rawNorm = raw.toLowerCase();
  if (!req.__xeroAccountCodeById) req.__xeroAccountCodeById = new Map();
  if (req.__xeroAccountCodeById.has(rawNorm)) return req.__xeroAccountCodeById.get(rawNorm) || '';
  const listRes = await xeroAccount.list(req, {});
  if (!listRes.ok) return '';
  const rows = Array.isArray(listRes.data?.Accounts) ? listRes.data.Accounts : [];
  const hit = rows.find((a) => String(a.AccountID || a.accountID || '').trim().toLowerCase() === rawNorm);
  const code = hit?.Code ? String(hit.Code).trim() : '';
  req.__xeroAccountCodeById.set(rawNorm, code);
  return code;
}

/**
 * Payload for POST /Payments `Account`: use Code when set; many Xero BANK accounts have empty Code — use AccountID then.
 * @returns {Promise<{ Code: string } | { AccountID: string } | null>}
 */
async function resolveXeroPaymentAccountRef(req, codeOrId) {
  const raw = codeOrId != null ? String(codeOrId).trim() : '';
  if (!raw) return null;
  if (!raw.includes('-')) {
    return { Code: raw };
  }
  const rawNorm = raw.toLowerCase();
  if (!req.__xeroPaymentAccountRefById) req.__xeroPaymentAccountRefById = new Map();
  if (req.__xeroPaymentAccountRefById.has(rawNorm)) {
    return req.__xeroPaymentAccountRefById.get(rawNorm) ?? null;
  }
  const listRes = await xeroAccount.list(req, {});
  if (!listRes.ok) return null;
  const rows = Array.isArray(listRes.data?.Accounts) ? listRes.data.Accounts : [];
  const hit = rows.find((a) => String(a.AccountID || a.accountID || '').trim().toLowerCase() === rawNorm);
  if (!hit) return null;
  const code = hit.Code != null ? String(hit.Code).trim() : '';
  const id = String(hit.AccountID || hit.accountID || '').trim();
  const ref = code ? { Code: code } : id ? { AccountID: id } : null;
  req.__xeroPaymentAccountRefById.set(rawNorm, ref);
  return ref;
}

/**
 * Invoice LineItem: Xero accepts AccountCode or AccountID. Many accounts (e.g. liability/bank) have empty Code — use AccountID.
 * @returns {Promise<{ AccountCode: string } | { AccountID: string } | null>}
 */
async function resolveXeroInvoiceLineItemAccount(req, codeOrId) {
  const raw = codeOrId != null ? String(codeOrId).trim() : '';
  if (!raw) return null;
  if (!raw.includes('-')) {
    return { AccountCode: raw };
  }
  const rawNorm = raw.toLowerCase();
  if (!req.__xeroLineItemAccountById) req.__xeroLineItemAccountById = new Map();
  if (req.__xeroLineItemAccountById.has(rawNorm)) {
    return req.__xeroLineItemAccountById.get(rawNorm) ?? null;
  }
  const listRes = await xeroAccount.list(req, {});
  if (!listRes.ok) return null;
  const rows = Array.isArray(listRes.data?.Accounts) ? listRes.data.Accounts : [];
  const hit = rows.find((a) => String(a.AccountID || a.accountID || '').trim().toLowerCase() === rawNorm);
  if (!hit) return null;
  const code = hit.Code != null ? String(hit.Code).trim() : '';
  const id = String(hit.AccountID || hit.accountID || '').trim();
  const ref = code ? { AccountCode: code } : id ? { AccountID: id } : null;
  req.__xeroLineItemAccountById.set(rawNorm, ref);
  return ref;
}

module.exports = {
  resolveXeroAccountCode,
  resolveXeroPaymentAccountRef,
  resolveXeroInvoiceLineItemAccount
};
