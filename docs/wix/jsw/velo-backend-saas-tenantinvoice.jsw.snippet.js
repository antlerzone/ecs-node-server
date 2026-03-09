/* ======================================================
   Tenant Invoice (Client Invoice) – backend/saas/tenantinvoice.jsw
   所有发票/租金列表、筛选、创建、支付、电表分组与计算均请求 ECS Node，不读 Wix CMS。
   认证与 Base URL 从 Secret Manager：ecs_token、ecs_username、ecs_base_url。
   【返回约定】失败：{ ok: false, reason }；成功：{ ok: true, ... }，items 缺则 []。
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

async function postJson(path, body) {
    const email = await getEmail();
    if (email == null || typeof email !== 'string' || !String(email).trim()) {
        return { ok: false, reason: 'NO_EMAIL' };
    }
    const { token, username, baseUrl } = await getEcsCreds();
    if (!baseUrl || !token || !username) {
        return { ok: false, reason: BACKEND_ERROR_REASON };
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
                body: JSON.stringify({ email: String(email).trim(), ...body })
            },
            FETCH_TIMEOUT_MS
        );
        if (!res.ok) return { ok: false, reason: BACKEND_ERROR_REASON };
        const data = await res.json();
        return data && typeof data === 'object' ? data : { ok: false, reason: BACKEND_ERROR_REASON };
    } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, reason: 'TIMEOUT' };
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}

function ensureOkItemsShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON, items: [] };
    return { ok: true, items: Array.isArray(data && data.items) ? data.items : [] };
}

function ensureOkShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON };
    return { ok: true, ...data };
}

// ---------- Properties (filter dropdown) ----------
/** @returns {Promise<{ ok: boolean, reason?: string, items: Array<{ id: string, _id: string, shortname: string }> }>} */
export async function getProperties() {
    const data = await postJson('/api/tenantinvoice/properties', {});
    return ensureOkItemsShape(data);
}

// ---------- Types (account / bukkuid for filter & create) ----------
/** @returns {Promise<{ ok: boolean, reason?: string, items: Array<{ id: string, _id: string, title: string }> }>} */
export async function getTypes() {
    const data = await postJson('/api/tenantinvoice/types', {});
    return ensureOkItemsShape(data);
}

// ---------- Rental list (with filters) ----------
/** @param {{ property?: string, type?: string, from?: string|Date, to?: string|Date }} opts */
/** @returns {Promise<{ ok: boolean, reason?: string, items: any[] }>} */
export async function getRentalList(opts = {}) {
    const data = await postJson('/api/tenantinvoice/rental-list', opts || {});
    return ensureOkItemsShape(data);
}

// ---------- Tenancy list (create invoice dropdown) ----------
/** @returns {Promise<{ ok: boolean, reason?: string, items: any[] }>} */
export async function getTenancyList() {
    const data = await postJson('/api/tenantinvoice/tenancy-list', {});
    return ensureOkItemsShape(data);
}

// ---------- Meter groups (for meter report) ----------
/** @returns {Promise<{ ok: boolean, reason?: string, items: any[] }>} */
export async function getMeterGroups() {
    const data = await postJson('/api/tenantinvoice/meter-groups', {});
    return ensureOkItemsShape(data);
}

// ---------- Rental insert / delete / update ----------
/** @param {Array<{ date: Date|string, tenancy: string, type: string, amount: number, referenceid?: string, description?: string }>} records */
/** @returns {Promise<{ ok: boolean, reason?: string, inserted?: number, ids?: string[] }>} */
export async function insertRentalRecords(records) {
    const data = /** @type {{ ok?: boolean, reason?: string, inserted?: number, ids?: string[] }} */ (await postJson('/api/tenantinvoice/rental-insert', { records: records || [] }));
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON, inserted: 0 };
    return { ok: true, inserted: data && typeof data.inserted === 'number' ? data.inserted : 0, ids: data && data.ids };
}

/** @param {string[]} ids */
/** @returns {Promise<{ ok: boolean, reason?: string, deleted?: number }>} */
export async function deleteRentalRecords(ids) {
    const data = /** @type {{ ok?: boolean, reason?: string, deleted?: number }} */ (await postJson('/api/tenantinvoice/rental-delete', { ids: ids || [] }));
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON, deleted: 0 };
    return { ok: true, deleted: data && typeof data.deleted === 'number' ? data.deleted : 0 };
}

/** @param {string} id */
/** @param {{ isPaid?: boolean, paidAt?: Date|string, referenceid?: string }} payload */
/** @returns {Promise<{ ok: boolean, reason?: string, updated?: number }>} */
export async function updateRentalRecord(id, payload) {
    const data = /** @type {{ ok?: boolean, reason?: string, updated?: number }} */ (await postJson('/api/tenantinvoice/rental-update', { id, payload: payload || {} }));
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON };
    return { ok: true, updated: data && data.updated };
}

// ---------- Meter calculation (usage + calculation phase) ----------
/** @param {{ mode: 'usage'|'calculation', clientId?: string, groupMeters?: any[], period?: { start: Date, end: Date }, usageSnapshot?: any, inputAmount?: number, sharingType?: string }} params */
/** @returns {Promise<{ ok: boolean, reason?: string, phase?: string, usageSnapshot?: any, textdetail?: string, textcalculation?: string, formulaText?: string, totalText?: string }>} */
export async function calculateMeterInvoice(params) {
    const body = {
        mode: params.mode,
        clientId: params.clientId,
        groupMeters: params.groupMeters,
        period: params.period,
        usageSnapshot: params.usageSnapshot,
        inputAmount: params.inputAmount,
        sharingType: params.sharingType
    };
    const data = /** @type {{ ok?: boolean, reason?: string, phase?: string, usageSnapshot?: any, textdetail?: string, textcalculation?: string, formulaText?: string, totalText?: string }} */ (await postJson('/api/tenantinvoice/meter-calculation', body));
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON };
    return ensureOkShape(data);
}
