/* ======================================================
   Property Setting – backend/saas/propertysetting.jsw
   物业列表、筛选、详情、更新、车位、新建物业、业主/协议、占用状态均请求 ECS Node，不读 Wix CMS。
   Topup 仍用 backend/saas/topup：getMyBillingInfo、getCreditPlans、startNormalTopup。
   电表/智能门下拉用 backend/saas/roomsetting：getMeterDropdownOptions(roomId=null)、getSmartDoorDropdownOptions(roomId=null)。
   凭证：ecs_token、ecs_username、ecs_base_url（与 roomsetting/metersetting 相同）。
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
 * @returns {Promise<*>}
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
                const errBody = await res.json();
                const errObj = /** @type {{ reason?: string } | null } */ (errBody);
                if (errObj && typeof errObj.reason === 'string') reason = errObj.reason;
            } catch (_) {}
            return { ok: false, reason };
        }
        const data = await res.json();
        return /** @type {Record<string, unknown>} */ (data);
    } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, reason: 'TIMEOUT' };
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}

// ---------- List (cache + filter: keyword, propertyId, filter, sort, page, pageSize, limit) ----------
/**
 * @param {{ keyword?: string, propertyId?: string, filter?: string, sort?: string, page?: number, pageSize?: number, limit?: number }} opts
 * @returns {Promise<*>}
 */
export async function getPropertyList(opts = {}) {
    const data = /** @type {{ items?: any[], totalPages?: number, currentPage?: number, total?: number, ok?: boolean, reason?: string } | null } */ (await postJson('/api/propertysetting/list', {
        keyword: opts.keyword || undefined,
        propertyId: opts.propertyId || undefined,
        filter: opts.filter || undefined,
        sort: opts.sort || undefined,
        page: opts.page,
        pageSize: opts.pageSize,
        limit: opts.limit
    }));
    if (data && data.ok === false) return data;
    return data || { items: [], totalPages: 1, currentPage: 1, total: 0 };
}

/** @returns {Promise<*>} */
export async function getPropertyFilters() {
    const data = /** @type {{ properties?: any[], services?: any[], ok?: boolean, reason?: string } | null } */ (await postJson('/api/propertysetting/filters', {}));
    if (data && data.ok === false) return data;
    return data || { properties: [], services: [] };
}

/** @returns {Promise<*>} */
export async function getProperty(propertyId) {
    const data = /** @type {{ ok?: boolean, reason?: string, [key: string]: any } | null } */ (await postJson('/api/propertysetting/get', { propertyId }));
    if (data && data.ok === false) return data;
    return data || null;
}

/**
 * @param {string} propertyId
 * @param {object} data - unitNumber, apartmentName, tnb, saj, wifi, internetType, percentage, address, remark, folder, meter, smartdoor, management, active
 */
export async function updateProperty(propertyId, data) {
    const res = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/propertysetting/update', { propertyId, ...data }));
    if (res && res.ok === false) return res;
    return res || { ok: true };
}

/** Set property active (list checkbox). */
export async function setPropertyActive(propertyId, active) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/propertysetting/set-active', { propertyId, active: !!active }));
    if (data && data.ok === false) return data;
    return data || { ok: true };
}

/** @returns {Promise<*>} */
export async function getParkingLotsByProperty(propertyId) {
    const data = /** @type {{ items?: any[], ok?: boolean, reason?: string } | null } */ (await postJson('/api/propertysetting/parkinglots', { propertyId }));
    if (data && data.ok === false) return data;
    return data || { items: [] };
}

/** @param {string} propertyId
 *  @param {Array<{ parkinglot: string } | string>} items
 */
export async function saveParkingLots(propertyId, items) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/propertysetting/parkinglots-save', { propertyId, items: items || [] }));
    if (data && data.ok === false) return data;
    return data || { ok: true };
}

/**
 * @param {Array<{ unitNumber: string, apartmentName: string }>} records
 * @returns {Promise<*>}
 */
export async function insertProperties(records) {
    const data = /** @type {{ ok?: boolean, inserted?: any[], reason?: string } | null } */ (await postJson('/api/propertysetting/insert', { items: records }));
    if (data && data.ok === false) return data;
    return data || { ok: true, inserted: [] };
}

/** @returns {Promise<*>} */
export async function isPropertyFullyOccupied(propertyId) {
    const data = /** @type {{ fullyOccupied?: boolean, ok?: boolean, reason?: string } | null } */ (await postJson('/api/propertysetting/occupancy', { propertyId }));
    if (data && data.ok === false) return data;
    return data || { fullyOccupied: false };
}

/** @returns {Promise<*>} */
export async function getApartmentNames() {
    const data = /** @type {{ names?: string[], ok?: boolean, reason?: string } | null } */ (await postJson('/api/propertysetting/apartment-names', {}));
    if (data && data.ok === false) return data;
    return data || { names: [] };
}

/** @returns {Promise<*>} */
export async function getSupplierOptions() {
    const data = /** @type {{ options?: Array<{label:string, value:string}>, ok?: boolean, reason?: string } | null } */ (await postJson('/api/propertysetting/suppliers', {}));
    if (data && data.ok === false) return data;
    return data || { options: [] };
}

/** @returns {Promise<*>} */
export async function getOwnerOptions() {
    const data = /** @type {{ options?: Array<{label:string, value:string}>, ok?: boolean, reason?: string } | null } */ (await postJson('/api/propertysetting/owners', {}));
    if (data && data.ok === false) return data;
    return data || { options: [] };
}

/** @returns {Promise<*>} */
export async function getAgreementTemplateOptions() {
    const data = /** @type {{ options?: Array<{label:string, value:string}>, ok?: boolean, reason?: string } | null } */ (await postJson('/api/propertysetting/agreement-templates', {}));
    if (data && data.ok === false) return data;
    return data || { options: [] };
}

/**
 * Save owner + agreement for property. type: 'manual' | 'system'. For manual pass url; for system pass templateId.
 * @param {{ propertyId: string, ownerId: string, type: string, templateId?: string, url?: string }} payload
 */
export async function saveOwnerAgreement(payload) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/propertysetting/owner-save', payload));
    if (data && data.ok === false) return data;
    return data || { ok: true };
}
