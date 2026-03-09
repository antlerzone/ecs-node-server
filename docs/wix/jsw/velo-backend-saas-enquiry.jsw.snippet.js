/* ======================================================
   Enquiry (Public Page) – backend/saas/enquiry.jsw
   No login required. Uses ECS token+username for server-to-server calls.
   GET plans / addons / banks; POST submit (demo registration).
====================================================== */

import wixSecretsBackend from 'wix-secrets-backend';

const BACKEND_ERROR_REASON = 'BACKEND_ERROR';
const FETCH_TIMEOUT_MS = 20000;

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

/** Upload creds for OSS (HTML embed). Enquiry page uses clientId 'enquiry' for profile logo before client exists. */
export async function getUploadCreds() {
    try {
        const c = await getEcsCreds();
        if (!c.baseUrl || !c.token || !c.username) {
            return { ok: false, reason: BACKEND_ERROR_REASON };
        }
        return { ok: true, baseUrl: c.baseUrl, token: c.token, username: c.username };
    } catch (e) {
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}

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
    return /** @type {object} */ (data);
}

/**
 * List pricing plans for enquiry page (public).
 * @returns {Promise<*>}
 */
export async function getPlans() {
    const data = /** @type {{ ok?: boolean, items?: any[], reason?: string } | null } */ (
        await postJson('/api/enquiry/plans', {})
    );
    if (data && data.ok === false) throw new Error(data.reason || BACKEND_ERROR_REASON);
    return data || { ok: true, items: [] };
}

/**
 * List addons for enquiry page (public).
 * @returns {Promise<*>}
 */
export async function getAddons() {
    const data = /** @type {{ ok?: boolean, items?: any[], reason?: string } | null } */ (
        await postJson('/api/enquiry/addons', {})
    );
    if (data && data.ok === false) throw new Error(data.reason || BACKEND_ERROR_REASON);
    return data || { ok: true, items: [] };
}

/**
 * List banks for enquiry page dropdown (public).
 * @returns {Promise<*>}
 */
export async function getBanks() {
    const data = /** @type { { ok?: boolean, items?: Array<*>, reason?: string } | null } */ (
        await postJson('/api/enquiry/banks', {})
    );
    if (data && data.ok === false) throw new Error(data.reason || BACKEND_ERROR_REASON);
    return data || { ok: true, items: [] };
}

/**
 * Submit enquiry (demo registration). Creates client + staff + client_profile (is_demo=1). No payment.
 * @param {{ title: string, email: string, currency?: string, country?: string, profilePhotoUrl?: string, contact?: string, accountNumber?: string, bankId?: string }} payload
 * @returns {Promise<*>}
 */
export async function submitEnquiry(payload) {
    const data = /** @type {{ ok?: boolean, reason?: string, clientId?: string, staffId?: string, email?: string } | null } */ (
        await postJson('/api/enquiry/submit', payload || {})
    );
    if (data && data.ok === false) throw new Error(data.reason || 'SUBMIT_FAILED');
    return data || { ok: true };
}
