/* ======================================================
   Tenant Dashboard – backend/saas/tenantdashboard.jsw
   所有租客仪表盘请求 ECS Node，不读 Wix CMS。
   认证与 Base URL 从 Secret Manager：ecs_token、ecs_username、ecs_base_url。

   【JSW 返回约定】每个 export 都返回固定形状：
   - 失败：{ ok: false, reason: string }
   - 成功：{ ok: true, ... } 且必带声明字段，不直接 return postJson 的 data。
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
                body: JSON.stringify({ email: String(email).trim().toLowerCase(), ...body })
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

function ensureOkShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON };
    return { ok: true };
}

function ensureInitShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON };
    return {
        ok: true,
        tenant: data && data.tenant != null ? data.tenant : null,
        tenancies: Array.isArray(data && data.tenancies) ? data.tenancies : []
    };
}

function ensureItemsShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON, items: [] };
    return { ok: true, items: Array.isArray(data && data.items) ? data.items : [] };
}

function ensureRoomShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON, room: null };
    return { ok: true, room: data && data.room != null ? data.room : null };
}

function ensureAgreementHtmlShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON, html: '' };
    return { ok: true, html: data && typeof data.html === 'string' ? data.html : '' };
}

function ensureAgreementShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON, agreement: null };
    return { ok: true, agreement: data && data.agreement != null ? data.agreement : null };
}

function ensurePaymentShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON };
    return {
        ok: true,
        type: data && data.type ? data.type : 'redirect',
        url: data && typeof data.url === 'string' ? data.url : ''
    };
}

// ---------- Upload creds (for HTML embed OSS upload) ----------
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

// ---------- Init ----------
/** @returns {Promise<{ ok: boolean, reason?: string, tenant?: object|null, tenancies?: any[] }>} */
export async function init() {
    const data = await postJson('/api/tenantdashboard/init', {});
    return ensureInitShape(data);
}

// ---------- Clients (for approval list) ----------
/** @param {{ clientIds: string[] }} opts */
export async function getClientsByIds(opts) {
    const data = await postJson('/api/tenantdashboard/clients-by-ids', opts || {});
    return ensureItemsShape(data);
}

// ---------- Room with meter ----------
/** @param {{ roomId: string }} opts */
export async function getRoomWithMeter(opts) {
    const data = await postJson('/api/tenantdashboard/room', opts || {});
    return ensureRoomShape(data);
}

// ---------- Property with smartdoor ----------
/** @param {{ propertyId: string, roomId?: string }} opts */
export async function getPropertyWithSmartdoor(opts) {
    const data = /** @type {{ ok?: boolean, reason?: string, property?: any, roomSmartdoor?: any } | null } */ (await postJson('/api/tenantdashboard/property-with-smartdoor', opts || {}));
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON };
    return { ok: true, property: data && data.property != null ? data.property : null, roomSmartdoor: data && data.roomSmartdoor != null ? data.roomSmartdoor : null };
}

// ---------- Banks ----------
export async function getBanks() {
    const data = await postJson('/api/tenantdashboard/banks', {});
    return ensureItemsShape(data);
}

// ---------- Profile ----------
/** @param {object} payload */
export async function updateTenantProfile(payload) {
    const data = await postJson('/api/tenantdashboard/update-profile', payload || {});
    return ensureOkShape(data);
}

// ---------- Agreement ----------
/** @param {{ tenancyId: string, agreementTemplateId?: string, staffVars?: object }} opts */
export async function getAgreementHtml(opts) {
    const data = await postJson('/api/tenantdashboard/agreement-html', opts || {});
    return ensureAgreementHtmlShape(data);
}

/** @param {{ agreementId: string, tenantsign: string, status?: string }} opts */
export async function updateAgreementTenantSign(opts) {
    const data = await postJson('/api/tenantdashboard/agreement-update-sign', opts || {});
    return ensureOkShape(data);
}

/** @param {{ agreementId: string }} opts */
export async function getAgreement(opts) {
    const data = await postJson('/api/tenantdashboard/agreement-get', opts || {});
    return ensureAgreementShape(data);
}

// ---------- Rental list (payment) ----------
/** @param {{ tenancyId: string }} opts */
export async function getRentalList(opts) {
    const data = await postJson('/api/tenantdashboard/rental-list', opts || {});
    return ensureItemsShape(data);
}

// ---------- Tenant approve / reject ----------
/** @param {{ clientId: string }} opts */
export async function tenantApprove(opts) {
    const data = await postJson('/api/tenantdashboard/tenant-approve', opts || {});
    return ensureOkShape(data);
}

/** @param {{ clientId: string }} opts */
export async function tenantReject(opts) {
    const data = await postJson('/api/tenantdashboard/tenant-reject', opts || {});
    return ensureOkShape(data);
}

// ---------- Generate rental from tenancy ----------
/** @param {{ tenancyId: string }} opts */
export async function generateFromTenancy(opts) {
    const data = await postJson('/api/tenantdashboard/generate-from-tenancy', opts || {});
    return ensureOkShape(data);
}

// ---------- Sync tenant for client ----------
/** @param {{ clientId: string }} opts */
export async function syncTenantForClient(opts) {
    const data = await postJson('/api/tenantdashboard/sync-tenant-for-client', opts || {});
    return ensureOkShape(data);
}

// ---------- Feedback ----------
/** @param {{ tenancyId: string, roomId?: string, propertyId?: string, clientId?: string, description: string, photo?: any, video?: string }} opts */
export async function submitFeedback(opts) {
    const data = await postJson('/api/tenantdashboard/feedback', opts || {});
    return ensureOkShape(data);
}

// ---------- Create payment (Stripe Checkout) ----------
/** @param {{ tenancyId: string, type: 'meter'|'invoice', amount: number, referenceNumber?: string, metadata?: object, returnUrl?: string, cancelUrl?: string }} opts */
export async function createTenantPayment(opts) {
    const data = await postJson('/api/tenantdashboard/create-payment', opts || {});
    return ensurePaymentShape(data);
}
