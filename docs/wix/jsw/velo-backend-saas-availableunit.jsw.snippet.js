/* ======================================================
   Available Unit (Public Page) – backend/saas/availableunit.jsw
   No login. One call returns list + properties + clientContact for grid & list; subdomain from page/URL.
   WhatsApp: build wasap.my/{clientContact}/{propertyname%20roomname%20enquiry} (clientContact with country code).
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
    if (!res.ok) {
        const errBody = /** @type {{ reason?: string } | null } */ (await res.json().catch(() => null));
        throw new Error(errBody && errBody.reason ? errBody.reason : BACKEND_ERROR_REASON);
    }
    const data = await res.json();
    return /** @type {Object} */ (data);
}

/**
 * One-shot data for available unit page: list + properties (+ clientContact when subdomain used).
 * No subdomain = public: all clients' units, each item has clientContact. With subdomain = one client's units.
 * @param {{ subdomain?: string, propertyId?: string, sort?: string, page?: number, pageSize?: number, keyword?: string, country?: string }} opts
 * @returns {Promise<*>}
 */
export async function getData(opts) {
    const data = /** @type {{ ok?: boolean, reason?: string, items?: any[], properties?: any[], clientContact?: string | null, totalPages?: number, currentPage?: number, total?: number } | null } */ (
        await postJson('/api/availableunit/list', opts || {})
    );
    if (data && data.ok === false) throw new Error(data.reason || BACKEND_ERROR_REASON);
    return data || { ok: true, items: [], properties: [], clientContact: null, totalPages: 1, currentPage: 1, total: 0 };
}
