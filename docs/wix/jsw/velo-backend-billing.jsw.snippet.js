/* ======================================================
   backend/billing/billing.jsw 最终版
   调用 Node 后端 /api/billing/*；凭证与 base URL 从 Secret Manager 读取。
   统一响应：成功 { ok: true, data? }，失败 { ok: false, reason }；reason 可为 NO_EMAIL | TIMEOUT | BACKEND_ERROR
====================================================== */

import wixUsersBackend from 'wix-users-backend';
import wixSecretsBackend from 'wix-secrets-backend';

const BACKEND_ERROR_REASON = 'BACKEND_ERROR';
const TIMEOUT_REASON = 'TIMEOUT';
const FETCH_TIMEOUT_MS = 15000;

/** @typedef {{ ok: false, reason: string }} BillingErrorResponse */

/**
 * @param {unknown} data
 * @returns {data is BillingErrorResponse}
 */
function isBillingError(data) {
    const o = data && typeof data === 'object' && !Array.isArray(data) ? /** @type {{ ok?: boolean, reason?: string }} */ (data) : null;
    return Boolean(o && o.ok === false && typeof o.reason === 'string');
}

function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

async function getEcsCreds() {
    const token = await wixSecretsBackend.getSecret('ecs_token');
    const username = await wixSecretsBackend.getSecret('ecs_username');
    const baseUrl = await wixSecretsBackend.getSecret('ecs_base_url');
    return {
        token: token != null ? String(token).trim() : '',
        username: username != null ? String(username).trim() : '',
        baseUrl: baseUrl != null ? String(baseUrl).trim().replace(/\/$/, '') : ''
    };
}

async function getEmail() {
    const user = wixUsersBackend.currentUser;
    if (!user.loggedIn) return null;
    return await user.getEmail();
}

/**
 * POST JSON to ECS (used for access context by email).
 * @param {string} path
 * @param {object} body
 * @returns {Promise<object>}
 */
async function postJson(path, body) {
    const { token, username, baseUrl } = await getEcsCreds();
    if (!baseUrl || !token || !username) throw new Error(BACKEND_ERROR_REASON);
    const res = await fetchWithTimeout(
        `${baseUrl}${path}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'X-API-Username': username
            },
            body: JSON.stringify(body || {})
        },
        FETCH_TIMEOUT_MS
    );
    if (!res.ok) throw new Error(BACKEND_ERROR_REASON);
    const data = await res.json();
    return data != null && typeof data === 'object' ? data : {};
}

/**
 * Get access context by email (for billing page permission flow).
 * @param {string} email
 * @returns {Promise<{ok: boolean, reason?: string, staff?: object, client?: object, plan?: object, credit?: object, expired?: object}>}
 */
export async function getAccessContextByEmail(email) {
    try {
        if (email == null || typeof email !== 'string' || !String(email).trim()) {
            return { ok: false, reason: 'NO_EMAIL' };
        }
        const data = await postJson('/api/access/context', { email: String(email).trim() });
        if (data && typeof data.ok === 'boolean') return data;
        return { ok: false, reason: BACKEND_ERROR_REASON };
    } catch (e) {
        return { ok: false, reason: e && e.name === 'AbortError' ? TIMEOUT_REASON : BACKEND_ERROR_REASON };
    }
}

async function fetchBilling(path, body = {}) {
    try {
        const email = await getEmail();
        if (email == null || typeof email !== 'string' || !String(email).trim()) {
            return { ok: false, reason: 'NO_EMAIL' };
        }
        const { token, username, baseUrl } = await getEcsCreds();
        if (!baseUrl || !token || !username) {
            return { ok: false, reason: BACKEND_ERROR_REASON };
        }
        const res = await fetchWithTimeout(
            `${baseUrl}${path}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-API-Username': username
                },
                body: JSON.stringify({ email: String(email).trim(), ...body })
            },
            FETCH_TIMEOUT_MS
        );
        if (!res.ok) return { ok: false, reason: BACKEND_ERROR_REASON };
        let data;
        try {
            data = await res.json();
        } catch (_) {
            return { ok: false, reason: BACKEND_ERROR_REASON };
        }
        return data;
    } catch (e) {
        if (e && e.name === 'AbortError') {
            return { ok: false, reason: TIMEOUT_REASON };
        }
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}

function isValidBillingInfo(data) {
    return data && typeof data === 'object' && !Array.isArray(data) && 'noPermission' in data;
}

function isValidCreditStatements(data) {
    return data && typeof data === 'object' && !Array.isArray(data) &&
        Array.isArray(data.items) && typeof data.total === 'number';
}

function isValidClearCache(data) {
    return data && typeof data === 'object' && !Array.isArray(data) && data.ok === true;
}

export async function getMyBillingInfo() {
    try {
        const data = await fetchBilling('/api/billing/my-info');
        if (isBillingError(data)) return data;
        if (!isValidBillingInfo(data)) return { ok: false, reason: BACKEND_ERROR_REASON };
        return { ok: true, data };
    } catch (e) {
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}

export async function getCreditStatements({ page = 1, pageSize = 10, sort = 'new', filterType = null, search = '' } = {}) {
    try {
        const data = await fetchBilling('/api/billing/credit-statements', { page, pageSize, sort, filterType, search });
        if (isBillingError(data)) return data;
        if (!isValidCreditStatements(data)) return { ok: false, reason: BACKEND_ERROR_REASON };
        return { ok: true, data };
    } catch (e) {
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}

export async function clearBillingCache() {
    try {
        const data = await fetchBilling('/api/billing/clear-cache');
        if (isBillingError(data)) return data;
        if (!isValidClearCache(data)) return { ok: false, reason: BACKEND_ERROR_REASON };
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}

// ---------- Billing page (same API shape as velo-backend-saas-billing.jsw) ----------
/** @param {{ page?: number, pageSize?: number, sort?: string, filterType?: string, search?: string }} opts */
export async function getStatementItems(opts = {}) {
    try {
        const data = await fetchBilling('/api/billing/statement-items', opts);
        if (isBillingError(data)) return { items: [], total: 0, reason: data.reason };
        if (!data || typeof data !== 'object' || !Array.isArray(data.items)) return { items: [], total: 0, reason: 'INVALID_RESPONSE' };
        return data;
    } catch (e) {
        return { items: [], total: 0, reason: (e && e.message) || 'FETCH_ERROR' };
    }
}

/** @param {{ sort?: string, filterType?: string, search?: string }} opts */
export async function getStatementExportUrl(opts = {}) {
    const data = await fetchBilling('/api/billing/statement-export', opts);
    if (isBillingError(data)) return { downloadUrl: '' };
    return (data && typeof data.downloadUrl === 'string') ? data : { downloadUrl: '' };
}

export async function getPlans() {
    const data = await fetchBilling('/api/billing/plans');
    if (isBillingError(data)) return [];
    return Array.isArray(data) ? data : [];
}

export async function getAddons() {
    const data = await fetchBilling('/api/billing/addons');
    if (isBillingError(data)) return [];
    return Array.isArray(data) ? data : [];
}

/** @param {{ planId: string }} opts */
export async function previewPricingPlan(opts) {
    const data = await fetchBilling('/api/billing/checkout/preview', { planId: opts.planId });
    if (isBillingError(data)) throw new Error(data.reason || BACKEND_ERROR_REASON);
    return data != null && typeof data === 'object' ? data : {};
}

/** @param {{ planId: string, returnUrl: string }} opts */
export async function confirmPricingPlan(opts) {
    const data = await fetchBilling('/api/billing/checkout/confirm', { planId: opts.planId, returnUrl: opts.returnUrl });
    if (isBillingError(data)) throw new Error(data.reason || BACKEND_ERROR_REASON);
    return data != null && typeof data === 'object' ? data : {};
}

/** @param {{ amount: number, title: string, addons: object }} opts */
export async function deductAddonCredit(opts) {
    const data = await fetchBilling('/api/billing/deduction/addon', {
        amount: opts.amount,
        title: opts.title,
        addons: opts.addons
    });
    if (isBillingError(data)) throw new Error(data.reason || BACKEND_ERROR_REASON);
    return data != null && typeof data === 'object' ? data : {};
}
