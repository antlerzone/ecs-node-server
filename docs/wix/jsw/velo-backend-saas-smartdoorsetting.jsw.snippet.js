/* ======================================================
   Smart Door Setting – backend/saas/smartdoorsetting.jsw
   列表、筛选、详情、更新、预览/同步 TTLock、新增门锁/网关均请求 ECS Node，不读 Wix CMS。
   Topup 使用 backend/saas/topup：getMyBillingInfo、getCreditPlans、startNormalTopup。
   凭证：ecs_token、ecs_username、ecs_base_url（与 manage/roomsetting 相同）。
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

async function getEmail() {
    const user = wixUsersBackend.currentUser;
    if (!user.loggedIn) return null;
    return await user.getEmail();
}

/**
 * @param {string} path
 * @param {object} [body]
 * @returns {Promise<Object>} response with optional ok, reason, or success payload
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
                const errBody = /** @type {{ reason?: string }} */ (await res.json());
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

// ---------- List (cache + filter: keyword, propertyId, filter, page, pageSize, limit) ----------
/**
 * @param {{ keyword?: string, propertyId?: string, filter?: string, sort?: string, page?: number, pageSize?: number, limit?: number }} opts
 * @returns {Promise<{ items: Array, totalPages: number, currentPage: number, total: number } | { ok: false, reason: string }>}
 */
export async function getSmartDoorList(opts = {}) {
    const data = /** @type {{ ok?: boolean, reason?: string, items?: Array, totalPages?: number, currentPage?: number, total?: number }} */ (await postJson('/api/smartdoorsetting/list', {
        keyword: opts.keyword || undefined,
        propertyId: opts.propertyId || undefined,
        filter: opts.filter || undefined,
        sort: opts.sort || undefined,
        page: opts.page,
        pageSize: opts.pageSize,
        limit: opts.limit
    }));
    if (data && data.ok === false) return /** @type {{ ok: false, reason: string }} */ ({ ok: false, reason: data.reason || 'ERROR' });
    const items = (data && Array.isArray(data.items)) ? data.items : [];
    return { items, totalPages: (data && data.totalPages != null) ? data.totalPages : 1, currentPage: (data && data.currentPage != null) ? data.currentPage : 1, total: (data && data.total != null) ? data.total : 0 };
}

/** @returns {Promise<{ properties: Array<{ label: string, value: string }> } | { ok: false, reason: string }>} */
export async function getSmartDoorFilters() {
    const data = /** @type {{ ok?: boolean, reason?: string, properties?: Array<{ label: string, value: string }> }} */ (await postJson('/api/smartdoorsetting/filters', {}));
    if (data && data.ok === false) return /** @type {{ ok: false, reason: string }} */ ({ ok: false, reason: data.reason || 'ERROR' });
    const properties = (data && Array.isArray(data.properties)) ? data.properties : [];
    return { properties };
}

/** @param {string} id
 *  @returns {Promise<object|null>} */
export async function getLock(id) {
    const data = /** @type {{ ok?: boolean, reason?: string }|object|null} */ (await postJson('/api/smartdoorsetting/get-lock', { id }));
    if (data && typeof data === 'object' && 'ok' in data && data.ok === false) return null;
    return (data && typeof data === 'object') ? /** @type {object} */ (data) : null;
}

/** @param {string} id
 *  @returns {Promise<object|null>} */
export async function getGateway(id) {
    const data = /** @type {{ ok?: boolean, reason?: string }|object|null} */ (await postJson('/api/smartdoorsetting/get-gateway', { id }));
    if (data && typeof data === 'object' && 'ok' in data && data.ok === false) return null;
    return (data && typeof data === 'object') ? /** @type {object} */ (data) : null;
}

/** @param {string} id
 *  @param {{ lockAlias?: string, active?: boolean, childmeter?: string[] }} [data]
 *  @returns {Promise<{ ok: boolean }|{ ok: false, reason: string }>} */
export async function updateLock(id, data) {
    const res = /** @type {{ ok?: boolean, reason?: string }} */ (await postJson('/api/smartdoorsetting/update-lock', { id, lockAlias: data?.lockAlias, active: data?.active, childmeter: data?.childmeter }));
    if (res && res.ok === false) return { ok: false, reason: res.reason || 'ERROR' };
    return { ok: true };
}

/** @param {string} id
 *  @param {{ gatewayName?: string }} [data]
 *  @returns {Promise<{ ok: boolean }|{ ok: false, reason: string }>} */
export async function updateGateway(id, data) {
    const res = /** @type {{ ok?: boolean, reason?: string }} */ (await postJson('/api/smartdoorsetting/update-gateway', { id, gatewayName: data?.gatewayName }));
    if (res && res.ok === false) return { ok: false, reason: res.reason || 'ERROR' };
    return { ok: true };
}

/** Preview new locks/gateways from TTLock not in DB; sync existing. Returns { total, list }.
 *  @returns {Promise<{ total: number, list: Array }|{ ok: false, reason: string }>} */
export async function previewSmartDoorSelection() {
    const data = /** @type {{ ok?: boolean, reason?: string, total?: number, list?: Array }} */ (await postJson('/api/smartdoorsetting/preview-selection', {}));
    if (data && data.ok === false) return /** @type {{ ok: false, reason: string }} */ ({ ok: false, reason: data.reason || 'ERROR' });
    const list = (data && Array.isArray(data.list)) ? data.list : [];
    return { total: (data && data.total != null) ? data.total : 0, list };
}

/** Sync name to TTLock. type: 'lock'|'gateway', externalId: lockId/gatewayId string, name: string
 *  @param {{ type: string, externalId: string, name: string }} [opts]
 *  @returns {Promise<{ ok: boolean }|{ ok: false, reason: string }>} */
export async function syncTTLockName(opts) {
    const res = /** @type {{ ok?: boolean, reason?: string }} */ (await postJson('/api/smartdoorsetting/sync-name', {
        type: opts?.type,
        externalId: opts?.externalId,
        name: opts?.name
    }));
    if (res && res.ok === false) return { ok: false, reason: res.reason || 'ERROR' };
    return { ok: true };
}

/** @returns {Promise<{ ids: string[] }>} */
export async function getSmartDoorIdsByProperty(propertyId) {
    const data = /** @type {{ ok?: boolean, ids?: string[] }} */ (await postJson('/api/smartdoorsetting/ids-by-property', { propertyId }));
    if (data && data.ok === false) return { ids: [] };
    const ids = (data && Array.isArray(data.ids)) ? data.ids : [];
    return { ids };
}

/** @param {string} lockDetailId
 *  @returns {Promise<{ label: string }>} */
export async function resolveSmartDoorLocationLabel(lockDetailId) {
    const data = /** @type {{ ok?: boolean, label?: string }} */ (await postJson('/api/smartdoorsetting/location-label', { lockDetailId }));
    if (data && data.ok === false) return { label: 'no connect' };
    const label = (data && typeof data.label === 'string') ? data.label : 'no connect';
    return { label };
}

/** @param {string|null} [excludeLockId]
 *  @returns {Promise<{ options: Array<{ label: string, value: string }> }>} */
export async function getChildLockOptions(excludeLockId = null) {
    const data = /** @type {{ ok?: boolean, options?: Array<{ label: string, value: string }> }} */ (await postJson('/api/smartdoorsetting/child-lock-options', { excludeLockId: excludeLockId || undefined }));
    if (data && data.ok === false) return { options: [] };
    const options = (data && Array.isArray(data.options)) ? data.options : [];
    return { options };
}

/** Insert gateways and locks. gateways: [{ gatewayId, gatewayName, networkName?, lockNum?, isOnline?, type? }], locks: [{ lockId, lockAlias, lockName?, electricQuantity?, hasGateway, gatewayId? (external), type?, brand?, active? }]
 *  @param {{ gateways?: Array, locks?: Array }} [payload]
 *  @returns {Promise<{ ok: boolean }|{ ok: false, reason: string }>} */
export async function insertSmartDoors(payload) {
    const res = /** @type {{ ok?: boolean, reason?: string }} */ (await postJson('/api/smartdoorsetting/insert-smartdoors', {
        gateways: payload?.gateways || [],
        locks: payload?.locks || []
    }));
    if (res && res.ok === false) return { ok: false, reason: res.reason || 'ERROR' };
    return { ok: true };
}
