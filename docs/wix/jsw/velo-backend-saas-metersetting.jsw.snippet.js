/* ======================================================
   Meter Setting – backend/saas/metersetting.jsw
   电表列表、筛选、详情、更新、新建、分组、Sync、Client Topup、Usage 均请求 ECS Node，不读 Wix CMS。
   Topup 充值套餐仍用 backend/saas/topup：getMyBillingInfo、getCreditPlans、startNormalTopup。
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

// ---------- List (cache + filter: keyword, propertyId, filter, sort, page, pageSize, limit) ----------
/**
 * @param {Object} opts - optional: keyword, propertyId, filter, sort, page, pageSize, limit
 * @returns {Promise<*>}
 */
export async function getMeterList(opts = {}) {
    const data = /** @type {object | null} */ (await postJson('/api/metersetting/list', {
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
export async function getMeterFilters() {
    const data = /** @type {object | null} */ (await postJson('/api/metersetting/filters', {}));
    if (data && data.ok === false) return data;
    return data || { properties: [], services: [] };
}

/** @returns {Promise<*>} */
export async function getMeter(meterId) {
    const data = /** @type {object | { ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/get', { meterId }));
    if (data && data.ok === false) return data;
    return data || null;
}

/**
 * @param {string} meterId
 * @param {{ title?: string, rate?: number, mode?: string, status?: boolean }} data
 */
export async function updateMeter(meterId, data) {
    const res = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/update', {
        meterId,
        title: data?.title,
        rate: data?.rate,
        mode: data?.mode,
        status: data?.status
    }));
    if (res && res.ok === false) return res;
    return res || { ok: true };
}

/** Update meter status only (checkbox). */
export async function updateMeterStatus(meterId, status) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/update-status', { meterId, status: !!status }));
    if (data && data.ok === false) return data;
    return data || { ok: true };
}

/** @returns {Promise<*>} */
export async function deleteMeter(meterId) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/delete', { meterId }));
    if (data && data.ok === false) return data;
    return data || { ok: true };
}

/**
 * Debug: try addMeter with frontend-provided credentials (no DB lookup). Or without creds then use DB.
 * @param {Array<{ meterId: string, title?: string, name?: string, mode?: string }>} records
 * @param {{ loginName?: string, password?: string, subuserId?: string|number }} creds - optional; when all set, backend uses these only (loginName=democoliving, password=0123456789, subuserId=2448872)
 * @returns {Promise<*>}
 */
export async function debugInsertMeters(records, creds = {}) {
    const payload = { records };
    if (creds?.loginName && creds?.password) {
        payload.loginName = String(creds.loginName);
        payload.password = String(creds.password);
        if (creds?.subuserId != null) payload.subuserId = creds.subuserId;
    }
    const data = /** @type {{ body?: object, payload?: object, loginid?: string, result?: object, error?: string, ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/debug-insert', payload));
    if (data && data.ok === false) return data;
    return data || { body: null, payload: null, result: null };
}

/**
 * 单步执行 debug 流程，每步返回 stepLog，前端可每步后写入 text1。
 * @param {'users'|'pricesMain'|'pricesSub'|'addMeter'} step
 * @param {{ loginName: string, password: string, subuserId?: string|number, records?: Array<{ meterId?: string, title?: string, name?: string, mode?: string }>, useSubaccountForAddMeter?: boolean }} opts
 * @returns {Promise<*>}
 */
export async function debugInsertMetersStep(step, opts = {}) {
    const payload = {
        step,
        loginName: opts?.loginName,
        password: opts?.password
    };
    if (opts?.subuserId != null) payload.subuserId = opts.subuserId;
    if (opts?.records && Array.isArray(opts.records)) payload.records = opts.records;
    if (opts?.useSubaccountForAddMeter === true) payload.useSubaccountForAddMeter = true;
    const data = /** @type {{ stepLog?: string[], subuserId?: string, usersCount?: number, priceId?: string, count?: number, ok?: boolean, body?: object, result?: object, link2User?: any[], error?: string } | null } */ (await postJson('/api/metersetting/debug-insert-step', payload));
    if (data && data.ok === false) return data;
    return data || { stepLog: [] };
}

/**
 * 主账号 getUsers：用平台主账号 token 获取主账号下全部租客列表（user detail）。
 * @returns {Promise<*>}
 */
export async function getCnyiotUsersPlatform() {
    const data = /** @type {{ users?: any[], result?: number, error?: string, ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/get-cnyiot-users-platform', {}));
    if (data && data.ok === false) return data;
    return data || { users: [], result: null };
}

/**
 * 用前端传入的账号调 CNYIOT getUsers，获取所有租客列表（不查 DB）。
 * @param {{ loginName: string, password: string }} creds
 * @returns {Promise<*>}
 */
export async function getCnyiotUsers(creds) {
    const data = /** @type {{ users?: any[], result?: number, error?: string, ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/get-cnyiot-users', {
        loginName: creds?.loginName,
        password: creds?.password
    }));
    if (data && data.ok === false) return data;
    return data || { users: [], result: null };
}

/**
 * 主账号 getMetList_Simple，拿电表列表与下一可用 index。返回 { meters, nextIndex, result, error? }
 * @param {{ loginName: string, password: string }} creds
 * @returns {Promise<*>}
 */
export async function getCnyiotMeters(creds) {
    const data = /** @type {object | null} */ (await postJson('/api/metersetting/get-cnyiot-meters', {
        loginName: creds?.loginName,
        password: creds?.password,
        mt: 1
    }));
    if (data && data.ok === false) return data;
    return data || { meters: [], nextIndex: 1, result: null };
}

/**
 * 主账号 addUser：为 client 在 CNYIOT 开租客（拿分组号）。creds=主账号，payload={ uN, uI, tel, psw? }
 * @param {{ loginName: string, password: string }} creds
 * @param {{ uN: string, uI: string, tel: string, psw?: string }} payload
 * @returns {Promise<*>}
 */
export async function addCnyiotUser(creds, payload) {
    const data = /** @type {object | null} */ (await postJson('/api/metersetting/add-cnyiot-user', {
        loginName: creds?.loginName,
        password: creds?.password,
        uN: payload?.uN,
        uI: payload?.uI,
        tel: payload?.tel,
        psw: payload?.psw
    }));
    if (data && data.ok === false) return data;
    return data || { result: null };
}

/**
 * 主账号调 editUser。文档 §13 仅支持 id, uN, uI, tel，API 无 UserType 参数。
 * @param {{ loginName: string, password: string }} creds
 * @param {{ id: string|number, uN?: string, uI?: string, tel?: string }} payload
 * @returns {Promise<*>}
 */
export async function editCnyiotUser(creds, payload) {
    const data = /** @type {object | null} */ (await postJson('/api/metersetting/edit-cnyiot-user', {
        loginName: creds?.loginName,
        password: creds?.password,
        id: payload?.id,
        uN: payload?.uN,
        uI: payload?.uI,
        tel: payload?.tel
    }));
    if (data && data.ok === false) return data;
    return data || { result: null };
}

/**
 * @param {Array<{ meterId: string, title?: string, name?: string, mode?: string }>} records
 * @returns {Promise<*>}
 */
export async function insertMeters(records) {
    console.log('[metersetting-add JSW] 1) calling insert records.length=', Array.isArray(records) ? records.length : 0, 'records=', JSON.stringify(records || []));
    const data = /** @type {{ inserted?: number, ids?: string[], skipped?: number, cnyiotSummary?: { addMeterResult?: number, link2UserCount?: number }, ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/insert', { records }));
    console.log('[metersetting-add JSW] 2) response inserted=', data?.inserted, 'cnyiotSummary=', data?.cnyiotSummary);
    if (data && data.ok === false) {
        console.log('[metersetting-add JSW] FAIL reason=', data.reason);
        return data;
    }
    return data || { inserted: 0, ids: [] };
}

/** 拉取 CNYIOT 中尚未 sync 进 meterdetail 的电表列表（Sync Meter 用）。返回 { list, total, ok?, reason? }。 */
export async function previewNewMeters() {
    const data = /** @type {{ list?: Array<{ meterId: string, name?: string, title?: string, mode?: string }>, total?: number, ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/preview-new-meters', {}));
    if (data && data.ok === false) return data;
    return data || { list: [], total: 0 };
}

/** 仅写入 meterdetail，并调用 addMeter（主账号）。失败时返回 { ok: false, reason } 供前端显示。records: [{ meterId, mode? }]。 */
export async function insertMetersFromPreview(records) {
    const data = /** @type {{ inserted?: number, ids?: string[], ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/insert-from-preview', { records }));
    if (data && data.ok === false) return { ok: false, reason: data.reason || 'INSERT_FAILED' };
    return data || { inserted: 0, ids: [] };
}

/** @returns {Promise<*>} */
export async function getActiveMeterProvidersByClient() {
    const data = /** @type {{ providers?: Array<{ slot: number, provider: string }>, ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/providers', {}));
    if (data && data.ok === false) return data;
    return data || { providers: [] };
}

/** Usage summary for date range. meterIds = 11-digit meterid[]. start/end = Date or ISO string. */
export async function getUsageSummary(payload) {
    const data = /** @type {{ total?: number, records?: any[], children?: object, ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/usage-summary', {
        meterIds: payload?.meterIds,
        start: payload?.start,
        end: payload?.end
    }));
    if (data && data.ok === false) return data;
    return data || { total: 0, records: [], children: {} };
}

/** Sync single meter by CMS meterid (11-digit). */
export async function syncMeterByCmsMeterId(meterId) {
    const data = /** @type {object | { ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/sync', { meterId }));
    if (data && data.ok === false) return data;
    return data;
}

/** Client topup: meterId = 11-digit, amount = number (kWh). */
export async function clientTopup(meterId, amount) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/client-topup', { meterId, amount }));
    if (data && data.ok === false) return data;
    return data || { ok: true };
}

/** @returns {Promise<*>} */
export async function loadGroupList() {
    const data = /** @type {{ groups?: any[], ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/groups', {}));
    if (data && data.ok === false) return data;
    return data || { groups: [] };
}

export async function deleteGroup(groupId) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/group-delete', { groupId }));
    if (data && data.ok === false) return data;
    return data || { ok: true };
}

/**
 * @param {{ groupId?: string, mode: string, groupName: string, sharingType?: string, parentId?: string, childIds: string[], childActive?: object }} payload
 */
export async function submitGroup(payload) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/metersetting/group-submit', payload));
    if (data && data.ok === false) return data;
    return data || { ok: true };
}
