/* ======================================================
   Owner Setting – backend/saas/ownersetting.jsw
   业主列表、筛选、创建/编辑待批准业主、删除业主关联，均请求 ECS Node，不读 Wix CMS。
   Topup 充值仍用 backend/saas/topup：getMyBillingInfo、getCreditPlans、startNormalTopup。
   凭证：ecs_token、ecs_username、ecs_base_url。
   JSW 类型：用 @typedef 统一 API 返回形状，避免长行 @type 被截断导致红线。
====================================================== */

import wixUsersBackend from 'wix-users-backend';
import wixSecretsBackend from 'wix-secrets-backend';

/** @typedef {Object} ApiResponse - API 返回：成功带业务字段，失败带 ok:false, reason */

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
                const errBody = /** @type {{ reason?: string } | null } */ (await res.json());
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

// ---------- List (cache + filter: search, page, pageSize, limit) ----------
/**
 * @param {{ search?: string, page?: number, pageSize?: number, limit?: number }} opts
 * @returns {Promise<{ items: Array, totalPages: number, currentPage: number, total: number } | { ok: false, reason: string }>}
 */
export async function getOwnerList(opts = {}) {
    /** @type {ApiResponse} */
    const data = await postJson('/api/ownersetting/list', {
        search: opts.search || undefined,
        page: opts.page,
        pageSize: opts.pageSize,
        limit: opts.limit
    });
    if (data && data.ok === false) return data;
    return data || { items: [], totalPages: 1, currentPage: 1, total: 0 };
}

/** @returns {Promise<{ properties: Array<{ value, label }>, agreementTemplates: Array<{ value, label }> } | { ok: false, reason: string }>} */
export async function getOwnerFilters() {
    /** @type {ApiResponse} */
    const data = await postJson('/api/ownersetting/filters', {});
    if (data && data.ok === false) return data;
    return data || { properties: [], agreementTemplates: [] };
}

/**
 * @param {string} keyword
 * @returns {Promise<{ items: Array<{ _id: string, ownerName: string, email: string }> } | { ok: false, reason: string }>}
 */
export async function searchOwnerByEmail(keyword) {
    /** @type {ApiResponse} */
    const data = await postJson('/api/ownersetting/search-owner', { keyword: keyword || '' });
    if (data && data.ok === false) return data;
    return data || { items: [] };
}

/**
 * @param {string} propertyId
 * @returns {Promise<{ _id: string, shortname: string, percentage: number, owner_id: string } | null | { ok: false, reason: string }>}
 */
export async function getPropertyById(propertyId) {
    /** @type {ApiResponse} */
    const data = await postJson('/api/ownersetting/property', { propertyId });
    if (data && data.ok === false) return data;
    if (data && (data._id || data.id)) return data;
    return null;
}

/** @returns {Promise<{ items: Array<{ _id: string, title: string }> } | { ok: false, reason: string }>} */
export async function getAgreementTemplates() {
    /** @type {ApiResponse} */
    const data = await postJson('/api/ownersetting/agreement-templates', {});
    if (data && data.ok === false) return data;
    return data || { items: [] };
}

/** @returns {Promise<{ items: Array<{ _id: string, shortname: string }> } | { ok: false, reason: string }>} */
export async function getPropertiesWithoutOwner() {
    /** @type {ApiResponse} */
    const data = await postJson('/api/ownersetting/properties-without-owner', {});
    if (data && data.ok === false) return data;
    return data || { items: [] };
}

/**
 * @param {{ ownerId?: string, email?: string, propertyId: string, agreementId: string, editingPendingContext?: object }} payload
 * @returns {Promise<{ ok: boolean } | { ok: false, reason: string }>}
 */
export async function saveOwnerInvitation(payload) {
    /** @type {ApiResponse} */
    const data = await postJson('/api/ownersetting/save-invitation', payload || {});
    if (data && data.ok === false) return data;
    return data || { ok: true };
}

/**
 * @param {string} propertyId
 * @returns {Promise<{ ok: boolean } | { ok: false, reason: string }>}
 */
export async function deleteOwnerFromProperty(propertyId) {
    /** @type {ApiResponse} */
    const data = await postJson('/api/ownersetting/delete-owner', { propertyId });
    if (data && data.ok === false) return data;
    return data || { ok: true };
}

/**
 * Remove owner–client mapping (when owner has no properties under this client).
 * @param {string} ownerId
 * @returns {Promise<{ ok: boolean } | { ok: false, reason: string }>}
 */
export async function removeOwnerMapping(ownerId) {
    /** @type {ApiResponse} */
    const data = await postJson('/api/ownersetting/remove-owner-mapping', { ownerId });
    if (data && data.ok === false) return data;
    return data || { ok: true };
}
