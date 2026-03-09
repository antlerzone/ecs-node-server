/* ======================================================
   Room Setting – backend/saas/roomsetting.jsw
   房间列表、筛选、详情、更新、新建、电表/智能门选项与更新均请求 ECS Node，不读 Wix CMS。
   凭证：ecs_token、ecs_username、ecs_base_url（与 manage/contact 相同）。
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

/** @returns {Promise<{ ok: boolean, reason?: string, baseUrl?: string, token?: string, username?: string }>} */
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

async function getEmail() {
    const user = wixUsersBackend.currentUser;
    if (!user.loggedIn) return null;
    return await user.getEmail();
}

/**
 * @param {string} path
 * @param {object} body
 * @returns {Promise<object>}
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
                if (errBody && typeof errBody === 'object' && typeof errBody.reason === 'string') reason = errBody.reason;
            } catch (_) {}
            return { ok: false, reason };
        }
        const data = await res.json();
        return data;
    } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, reason: 'TIMEOUT' };
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}

// ---------- List (cache + filter: keyword, propertyId, sort, page, pageSize, limit) ----------
/**
 * @param {{ keyword?: string, propertyId?: string, sort?: string, page?: number, pageSize?: number, limit?: number }} opts
 * @returns {Promise<{ items: Array, totalPages: number, currentPage: number, total: number } | { ok: false, reason: string }>}
 */
export async function getRoomList(opts = {}) {
    const data = await postJson('/api/roomsetting/list', {
        keyword: opts.keyword || undefined,
        propertyId: opts.propertyId || undefined,
        sort: opts.sort || undefined,
        page: opts.page,
        pageSize: opts.pageSize,
        limit: opts.limit
    });
    if (data && data.ok === false) return data;
    return data || { items: [], totalPages: 1, currentPage: 1, total: 0 };
}

/** @returns {Promise<{ properties: Array<{ value: string, label: string }> } | { ok: false, reason: string }>} */
export async function getRoomFilters() {
    const data = await postJson('/api/roomsetting/filters', {});
    if (data && data.ok === false) return data;
    return data || { properties: [] };
}

/** @returns {Promise<object | null | { ok: false, reason: string }>} */
export async function getRoom(roomId) {
    const data = await postJson('/api/roomsetting/get', { roomId });
    if (data && data.ok === false) return data;
    return data || null;
}

/**
 * @param {string} roomId
 * @param {{ roomName?: string, description_fld?: string, remark?: string, price?: number, property?: string, mainPhoto?: string, mediaGallery?: Array, active?: boolean }} data
 * @returns {Promise<{ ok: boolean, room?: object } | { ok: false, reason: string }>}
 */
export async function updateRoom(roomId, data) {
    const res = await postJson('/api/roomsetting/update', {
        roomId,
        roomName: data?.roomName,
        description_fld: data?.description_fld,
        remark: data?.remark,
        price: data?.price,
        property: data?.property,
        mainPhoto: data?.mainPhoto,
        mediaGallery: data?.mediaGallery,
        active: data?.active
    });
    if (res && res.ok === false) return res;
    return res || { ok: true };
}

/**
 * @param {Array<{ roomName: string, property: string }>} records
 * @returns {Promise<{ inserted: number, ids: string[] } | { ok: false, reason: string }>}
 */
export async function insertRooms(records) {
    const data = await postJson('/api/roomsetting/insert', { records });
    if (data && data.ok === false) return data;
    return data || { inserted: 0, ids: [] };
}

/** Set room active/inactive (list view checkbox). Fails if room has meter or smart door and setting to inactive. */
export async function setRoomActive(roomId, active) {
    const data = await postJson('/api/roomsetting/set-active', { roomId, active: !!active });
    if (data && data.ok === false) return data;
    return data || { ok: true };
}

/** Active tenancy for room (for detail popup: tenant name, phone, rental, dates). */
export async function getTenancyForRoom(roomId) {
    const data = await postJson('/api/roomsetting/tenancy', { roomId });
    if (data && data.ok === false) return data;
    return data;
}

/**
 * Meter dropdown: 已绑定的（当前 item）+ 未绑定的。Option value 为 string。
 * Property Setting 页: getMeterDropdownOptions(null, propertyId)
 * Room Setting 页: getMeterDropdownOptions(roomId, null)
 * @param {string|null} [roomId] – 编辑 room 时传，当前 room 已绑定的 meter 会出现在选项
 * @param {string|null} [propertyId] – 编辑 property 时传，当前 property 已绑定的 meter 会出现在选项
 * @returns {Promise<{ options: Array<{ label: string, value: string }> } | { ok: false, reason: string }>}
 */
export async function getMeterDropdownOptions(roomId = null, propertyId = null) {
    const body = {};
    if (roomId != null && roomId !== '') body.roomId = roomId;
    if (propertyId != null && propertyId !== '') body.propertyId = propertyId;
    const data = await postJson('/api/roomsetting/meter-options', body);
    if (data && data.ok === false) return data;
    return data || { options: [] };
}

/**
 * Smart door dropdown: 已绑定的（当前 item）+ 未绑定的。Option value 为 string。
 * Property Setting 页: getSmartDoorDropdownOptions(null, propertyId)
 * Room Setting 页: getSmartDoorDropdownOptions(roomId, null)
 * @param {string|null} [roomId] – 编辑 room 时传，当前 room 已绑定的 smart door 会出现在选项
 * @param {string|null} [propertyId] – 编辑 property 时传，当前 property 已绑定的 smart door 会出现在选项
 * @returns {Promise<{ options: Array<{ label: string, value: string }> } | { ok: false, reason: string }>}
 */
export async function getSmartDoorDropdownOptions(roomId = null, propertyId = null) {
    const body = {};
    if (roomId != null && roomId !== '') body.roomId = roomId;
    if (propertyId != null && propertyId !== '') body.propertyId = propertyId;
    const data = await postJson('/api/roomsetting/smartdoor-options', body);
    if (data && data.ok === false) return data;
    return data || { options: [] };
}

export async function updateRoomMeter(roomId, meterId) {
    const data = await postJson('/api/roomsetting/update-meter', { roomId, meterId: meterId || null });
    if (data && data.ok === false) return data;
    return data || { ok: true };
}

export async function updateRoomSmartDoor(roomId, smartDoorId) {
    const data = await postJson('/api/roomsetting/update-smartdoor', { roomId, smartDoorId: smartDoorId || null });
    if (data && data.ok === false) return data;
    return data || { ok: true };
}
