/* ======================================================
   Owner Portal – backend/saas/ownerportal.jsw
   所有 owner portal 请求 ECS Node，不读 Wix CMS。
   认证与 Base URL 从 Secret Manager：ecs_token、ecs_username、ecs_base_url。

   【JSW 返回约定】每个 export 都返回固定形状，避免前端 type error：
   - 失败：{ ok: false, reason: string }
   - 成功：{ ok: true, ... } 且必带声明字段（缺则用 []/null 兜底），不直接 return postJson 的 data。
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

/** 确保返回 { ok, owner? } 形状，避免 type error */
function ensureOwnerShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON };
    return { ok: true, owner: data && data.owner != null ? data.owner : null };
}

/** 确保返回 { ok, owner?, properties?, rooms?, tenancies? } 形状 */
function ensureLoadCmsShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON };
    return {
        ok: true,
        owner: data && data.owner != null ? data.owner : null,
        properties: Array.isArray(data && data.properties) ? data.properties : [],
        rooms: Array.isArray(data && data.rooms) ? data.rooms : [],
        tenancies: Array.isArray(data && data.tenancies) ? data.tenancies : []
    };
}

/** 确保返回 { ok, items } 形状 */
function ensureItemsShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON, items: [] };
    return { ok: true, items: Array.isArray(data && data.items) ? data.items : [] };
}

/** 确保返回 { ok, items }（banks/owner-payout 等） */
function ensureOkItemsShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON, items: [] };
    return { ok: true, items: Array.isArray(data && data.items) ? data.items : [] };
}

/** 确保返回 { ok, template? } 形状 */
function ensureTemplateShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON, template: null };
    return { ok: true, template: data && data.template != null ? data.template : null };
}

/** 确保返回 { ok, agreement? } 形状 */
function ensureAgreementShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON, agreement: null };
    return { ok: true, agreement: data && data.agreement != null ? data.agreement : null };
}

/** 确保返回 { ok } 形状（update/merge/remove/sync 等） */
function ensureOkShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON };
    return { ok: true };
}

// ---------- Owner & init ----------
/** @returns {Promise<{ ok: boolean, reason?: string, owner?: object|null }>} */
export async function getOwner() {
    const data = await postJson('/api/ownerportal/owner', {});
    return ensureOwnerShape(data);
}

/** @returns {Promise<{ ok: boolean, reason?: string, owner?: object|null, properties?: any[], rooms?: any[], tenancies?: any[] }>} */
export async function loadCmsData() {
    const data = await postJson('/api/ownerportal/load-cms-data', {});
    return ensureLoadCmsShape(data);
}

// ---------- Clients (operator dropdown) ----------
/** @returns {Promise<{ ok: boolean, reason?: string, items: any[] }>} */
export async function getClientsForOperator() {
    const data = await postJson('/api/ownerportal/clients', {});
    return ensureItemsShape(data);
}

// ---------- Banks ----------
/** @returns {Promise<{ ok: boolean, reason?: string, items: any[] }>} */
export async function getBanks() {
    const data = await postJson('/api/ownerportal/banks', {});
    return ensureOkItemsShape(data);
}

// ---------- Profile ----------
/** @returns {Promise<{ ok: boolean, reason?: string, owner?: object|null }>} */
/** @param {object} payload - ownerName, mobileNumber, nric, bankAccount, accountholder, bankName, profile, etc. */
export async function updateOwnerProfile(payload) {
    const data = await postJson('/api/ownerportal/update-profile', payload || {});
    return ensureOwnerShape(data);
}

// ---------- Owner report (payout) ----------
/** @returns {Promise<{ ok: boolean, reason?: string, items: any[] }>} */
/** @param {{ propertyId: string, startDate: string|Date, endDate: string|Date }} opts */
export async function getOwnerPayoutList(opts) {
    const data = await postJson('/api/ownerportal/owner-payout-list', opts || {});
    return ensureOkItemsShape(data);
}

// ---------- Cost (utility bills) ----------
/** @typedef {{ ok?: boolean, reason?: string, items?: any[], totalCount?: number }} CostListResponse */
/** @returns {Promise<{ ok: boolean, reason?: string, items?: any[], totalCount?: number }>} */
/** @param {{ propertyId: string, startDate: string|Date, endDate: string|Date, skip?: number, limit?: number }} opts */
export async function getCostList(opts) {
    const data = /** @type {CostListResponse} */ (await postJson('/api/ownerportal/cost-list', opts || {}));
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON, items: [], totalCount: 0 };
    return {
        ok: true,
        items: Array.isArray(data && data.items) ? data.items : [],
        totalCount: typeof (data && data.totalCount) === 'number' ? data.totalCount : 0
    };
}

// ---------- Agreement ----------
/** @returns {Promise<{ ok: boolean, reason?: string, items: any[] }>} */
/** @param {{ ownerId: string }} opts */
export async function getAgreementList(opts) {
    const data = await postJson('/api/ownerportal/agreement-list', opts || {});
    return ensureOkItemsShape(data);
}

/** @returns {Promise<{ ok: boolean, reason?: string, template?: object|null }>} */
/** @param {{ templateId: string }} opts */
export async function getAgreementTemplate(opts) {
    const data = await postJson('/api/ownerportal/agreement-template', opts || {});
    return ensureTemplateShape(data);
}

/** @returns {Promise<{ ok: boolean, reason?: string, agreement?: object|null }>} */
/** @param {{ agreementId: string }} opts */
export async function getAgreement(opts) {
    const data = await postJson('/api/ownerportal/agreement-get', opts || {});
    return ensureAgreementShape(data);
}

/** @returns {Promise<{ ok: boolean, reason?: string }>} */
/** @param {{ agreementId: string, ownersign?: string, ownerSignedAt?: Date, status?: string }} opts */
export async function updateAgreementSign(opts) {
    const data = await postJson('/api/ownerportal/agreement-update-sign', opts || {});
    return ensureOkShape(data);
}

/** @returns {Promise<{ ok: boolean, reason?: string }>} */
/** @param {{ ownerId: string, propertyId: string, clientId: string, agreementId: string }} opts */
export async function completeAgreementApproval(opts) {
    const data = await postJson('/api/ownerportal/complete-agreement-approval', opts || {});
    return ensureOkShape(data);
}

/** @returns {Promise<{ ok: boolean, reason?: string }>} */
/** @param {{ ownerId: string, propertyId: string, clientId: string }} opts */
export async function mergeOwnerMultiReference(opts) {
    const data = await postJson('/api/ownerportal/merge-owner-multi-reference', opts || {});
    return ensureOkShape(data);
}

/** @returns {Promise<{ ok: boolean, reason?: string }>} */
/** @param {{ ownerId: string, propertyId: string, clientId: string }} opts */
export async function removeApprovalPending(opts) {
    const data = await postJson('/api/ownerportal/remove-approval-pending', opts || {});
    return ensureOkShape(data);
}

/** @returns {Promise<{ ok: boolean, reason?: string }>} */
/** @param {{ ownerId: string, clientId: string }} opts */
export async function syncOwnerForClient(opts) {
    const data = await postJson('/api/ownerportal/sync-owner-for-client', opts || {});
    return ensureOkShape(data);
}

// ---------- PDF export (Node generates PDF, returns download URL) ----------
/** @typedef {{ ok?: boolean, reason?: string, downloadUrl?: string }} ExportPdfResponse */
/** @returns {Promise<{ ok: boolean, reason?: string, downloadUrl?: string }>} */
/** @param {{ propertyId: string, startDate: string|Date, endDate: string|Date }} opts */
export async function exportOwnerReportPdf(opts) {
    const data = /** @type {ExportPdfResponse} */ (await postJson('/api/ownerportal/export-report-pdf', opts || {}));
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON };
    return { ok: true, downloadUrl: data && typeof data.downloadUrl === 'string' ? data.downloadUrl : '' };
}

/** @returns {Promise<{ ok: boolean, reason?: string, downloadUrl?: string }>} */
/** @param {{ propertyId: string, startDate: string|Date, endDate: string|Date }} opts */
export async function exportCostPdf(opts) {
    const data = /** @type {ExportPdfResponse} */ (await postJson('/api/ownerportal/export-cost-pdf', opts || {}));
    if (data && data.ok === false) return { ok: false, reason: data.reason || BACKEND_ERROR_REASON };
    return { ok: true, downloadUrl: data && typeof data.downloadUrl === 'string' ? data.downloadUrl : '' };
}
