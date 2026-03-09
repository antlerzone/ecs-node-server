/* ======================================================
   Account Setting (SaaS) – 复制到 backend/saas/account.jsw 或 accountsetting.jsw
   会计账户设置：resolve、列表、详情、保存、Sync。全部请求 ECS Node /api/account/*，不读 Wix CMS。
   认证与 Base URL 从 Secret Manager：ecs_token、ecs_username、ecs_base_url。
   文档：docs/wix/jsw/velo-backend-saas-accountsetting.jsw.snippet.js
====================================================== */

import wixUsersBackend from 'wix-users-backend';
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

async function getCurrentEmail() {
    const user = wixUsersBackend.currentUser;
    if (!user.loggedIn) throw new Error('NOT_LOGGED_IN');
    const email = await user.getEmail();
    if (email == null || !String(email).trim()) throw new Error('NO_EMAIL');
    return String(email).trim();
}

/**
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
    return /** @type {object} */ (data);
}

// ---------- Resolve (accountaccess 逻辑已迁入 Node /api/account/resolve) ----------
/**
 * Resolve accounting integration (Account/addonAccount) for current client.
 * Node 做定价方案校验、integration 校验、凭证提取；返回 credential: { token, subdomain }。
 * @returns {Promise<{ ok: boolean, reason?: string, provider?: string|null, credential?: { token: string, subdomain: string }|null }>}
 */
export async function resolveAccountSystem(clientId) {
    try {
        const email = await getCurrentEmail();
        const data = await postJson('/api/account/resolve', { email });
        if (data && typeof data.ok === 'boolean') {
            return {
                ok: data.ok,
                reason: data.reason,
                provider: data.provider ?? null,
                credential: data.credential ?? (data.integration?.values ? {
                    token: data.integration.values.bukku_secretKey || data.integration.values.bukku_token || '',
                    subdomain: data.integration.values.bukku_subdomain || ''
                } : null)
            };
        }
        return { ok: false, reason: data?.reason || BACKEND_ERROR_REASON };
    } catch (e) {
        return { ok: false, reason: e && e.name === 'AbortError' ? 'TIMEOUT' : BACKEND_ERROR_REASON };
    }
}

// ---------- List ----------
/**
 * List account templates (bukkuid) with _myAccount for current client.
 * @returns {Promise<{ ok: boolean, items: Array, reason?: string }>}
 */
export async function getAccountList() {
    try {
        const email = await getCurrentEmail();
        const data = await postJson('/api/account/list', { email });
        if (data && data.ok === true && Array.isArray(data.items)) {
            return { ok: true, items: data.items };
        }
        return { ok: false, items: [], reason: data?.reason || BACKEND_ERROR_REASON };
    } catch (e) {
        return { ok: false, items: [], reason: e && e.name === 'AbortError' ? 'TIMEOUT' : BACKEND_ERROR_REASON };
    }
}

// ---------- Get one ----------
/**
 * Get one account template by id.
 * @param {string} accountId
 * @returns {Promise<{ ok: boolean, item?: object, reason?: string }>}
 */
export async function getAccountById(accountId) {
    try {
        const email = await getCurrentEmail();
        const data = await postJson('/api/account/get', { email, id: accountId });
        if (data && data.ok === true && data.item) {
            return { ok: true, item: data.item };
        }
        return { ok: false, reason: data?.reason || 'NOT_FOUND' };
    } catch (e) {
        return { ok: false, reason: e && e.name === 'AbortError' ? 'TIMEOUT' : BACKEND_ERROR_REASON };
    }
}

// ---------- Save ----------
/**
 * Save client mapping for one account template.
 * @param {{ item: { _id: string }, clientId: string, system: string, accountId: string, productId?: string }} params
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function saveBukkuAccount(params) {
    try {
        const email = await getCurrentEmail();
        const data = await postJson('/api/account/save', { email, ...params });
        if (data && typeof data.ok === 'boolean') return data;
        return { ok: false, reason: BACKEND_ERROR_REASON };
    } catch (e) {
        return { ok: false, reason: e && e.name === 'AbortError' ? 'TIMEOUT' : BACKEND_ERROR_REASON };
    }
}

// ---------- Sync ----------
/**
 * Sync Bukku accounts and products for current client.
 * @param {{ clientId: string }} params
 * @returns {Promise<{ ok: boolean, reason?: string, createdAccounts?: number, linkedAccounts?: number, createdProducts?: number, linkedProducts?: number }>}
 */
export async function syncBukkuAccounts(params) {
    try {
        const email = await getCurrentEmail();
        const data = await postJson('/api/account/sync', { email });
        if (data && typeof data.ok === 'boolean') return data;
        return { ok: false, reason: data?.reason || BACKEND_ERROR_REASON };
    } catch (e) {
        return { ok: false, reason: e && e.name === 'AbortError' ? 'TIMEOUT' : BACKEND_ERROR_REASON };
    }
}
