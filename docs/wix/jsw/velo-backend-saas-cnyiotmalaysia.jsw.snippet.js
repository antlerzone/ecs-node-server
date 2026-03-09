/* ======================================================
   CNYIoT Malaysia – backend/saas/cnyiotmalaysia.jsw
   直连 CNYIOT 后端测试（绕过 proxy）。用主号 ping / getPrices，返回结果 + 完整 console 供 #text1 显示。
   凭证：与其它 saas 相同（ecs_token、ecs_username、ecs_base_url）。
====================================================== */

import wixUsersBackend from 'wix-users-backend';
import wixSecretsBackend from 'wix-secrets-backend';

const BACKEND_ERROR_REASON = 'BACKEND_ERROR';
const FETCH_TIMEOUT_MS = 25000;

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
 * @param {string} path
 * @param {object} [body]
 * @returns {Promise<Object>}
 */
async function postJson(path, body) {
    const email = await getEmail();
    if (email == null || typeof email !== 'string' || !String(email).trim()) {
        return { ok: false, reason: 'NO_EMAIL' };
    }
    const { token, username, baseUrl } = await getEcsCreds();
    if (!baseUrl || !token || !username) {
        return { ok: false, reason: 'MISSING_ECS_CREDS' };
    }
    try {
        const res = await fetchWithTimeout(
            `${baseUrl}${path}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-API-Username': username
                },
                body: JSON.stringify({ email: String(email).trim(), ...(body || {}) })
            },
            FETCH_TIMEOUT_MS
        );
        if (!res.ok) {
            let reason = `HTTP ${res.status}`;
            try {
                const errBody = /** @type {{ reason?: string } | null} */ (await res.json());
                if (errBody && typeof errBody.reason === 'string') reason = errBody.reason;
            } catch (_) {}
            return { ok: false, reason };
        }
        const data = await res.json();
        return /** @type {Object} */ (data);
    } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, reason: 'TIMEOUT' };
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}

/**
 * Ping CNYIoT Malaysia（直连后端 login）。返回 ping 结果 + 完整 console 行，供前端 #text1 显示。
 * @returns {Promise<{ ok?: boolean, reason?: string, pingResult?: object, console?: string[] } | null>}
 */
export async function pingMalaysia() {
    const data = /** @type {{ ok?: boolean, reason?: string, pingResult?: object, console?: string[] } | null} */ (await postJson('/api/cnyiotmalaysia/ping', {}));
    if (data && data.ok === false) return data;
    return data || { ok: false, reason: 'NO_RESPONSE', console: [] };
}

/**
 * 主号 getPrices（直连 Malaysia 后端）。返回价格列表 + 完整 console。
 * @returns {Promise<{ ok?: boolean, reason?: string, data?: any, result?: string, console?: string[] } | null>}
 */
export async function getPricesMalaysia() {
    const data = /** @type {{ ok?: boolean, reason?: string, data?: any, result?: string, console?: string[] } | null} */ (await postJson('/api/cnyiotmalaysia/get-prices', {}));
    if (data && data.ok === false) return data;
    return data || { ok: false, reason: 'NO_RESPONSE', console: [] };
}
