/* ======================================================
   Generate Report (Owner Report / OwnerPayout) – backend/saas/generatereport.jsw
   所有 owner report / payout 请求 ECS Node /api/generatereport/*，不读 Wix CMS。
   认证与 Base URL 从 Secret Manager：ecs_token、ecs_username、ecs_base_url。
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
 * @param {object} [body]
 * @returns {Promise<any>}
 */
async function postJson(path, body) {
    const email = await getCurrentEmail();
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
            body: JSON.stringify({ email, ...body })
        },
        FETCH_TIMEOUT_MS
    );
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const reason = (data && typeof data === 'object' && 'reason' in data) ? data.reason : null;
        const message = (reason != null && typeof reason === 'string') ? reason : BACKEND_ERROR_REASON;
        throw new Error(message);
    }
    const data = await res.json();
    return data;
}

/**
 * @param {string} path
 * @returns {Promise<any>}
 */
async function getJson(path) {
    const email = await getCurrentEmail();
    const { token, username, baseUrl } = await getEcsCreds();
    if (!baseUrl || !token || !username) throw new Error(BACKEND_ERROR_REASON);
    const url = `${baseUrl}${path}${path.includes('?') ? '&' : '?'}email=${encodeURIComponent(email)}`;
    const res = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'X-API-Username': username
        }
    }, FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(BACKEND_ERROR_REASON);
    return res.json();
}

// ---------- Properties (for GR repeater & report filter) ----------
/**
 * @returns {Promise<{ items: Array<{ id: string, _id: string, shortname: string }> }>}
 */
export async function getReportProperties() {
    return /** @type {Promise<{ items: Array<{ id: string, _id: string, shortname: string }> }>} */ (postJson('/api/generatereport/properties', {}));
}

// ---------- Owner Reports (list with filter/sort/pagination) ----------
/**
 * @param {{ property?: string, from?: Date|string, to?: Date|string, search?: string, sort?: string, type?: string, page?: number, pageSize?: number }} params
 * @returns {Promise<{ success: boolean, items: Array, totalCount: number, totalPages: number, currentPage: number }>}
 */
export async function getOwnerReports(params = {}) {
    const body = { ...params };
    if (params.from && (params.from instanceof Date)) body.from = params.from.toISOString();
    if (params.to && (params.to instanceof Date)) body.to = params.to.toISOString();
    return /** @type {Promise<{ success: boolean, items: Array, totalCount: number, totalPages: number, currentPage: number }>} */ (postJson('/api/generatereport/owner-reports', body));
}

// ---------- Single report ----------
/**
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function getOwnerReport(id) {
    return /** @type {Promise<object>} */ (getJson(`/api/generatereport/owner-report/${id}`));
}

// ---------- Insert (after generate payout) ----------
/**
 * @param {object} data - { property, period?, title?, totalrental, totalutility, totalcollection, expenses, managementfee?, netpayout, monthlyreport? }
 * @returns {Promise<{ success: boolean, record: object }>}
 */
export async function insertOwnerReport(data) {
    const body = { ...data };
    if (data.period && (data.period instanceof Date)) body.period = data.period.toISOString();
    return /** @type {Promise<{ success: boolean, record: object }>} */ (postJson('/api/generatereport/owner-report', body));
}

// ---------- Update (mark paid etc.) ----------
/**
 * @param {string} id
 * @param {{ paid?: boolean, accountingStatus?: string, paymentDate?: Date|string, paymentMethod?: string }} changes
 * @returns {Promise<{ success: boolean, record: object }>}
 */
export async function updateOwnerReport(id, changes) {
    const body = { ...changes };
    if (changes.paymentDate && (changes.paymentDate instanceof Date)) body.paymentDate = changes.paymentDate.toISOString();
    return /** @type {Promise<{ success: boolean, record: object }>} */ (postJson(`/api/generatereport/owner-report/${id}`, body));
}

// ---------- Delete ----------
/**
 * @param {string} id
 * @returns {Promise<{ success: boolean }>}
 */
export async function deleteOwnerReport(id) {
    const { token, username, baseUrl } = await getEcsCreds();
    if (!baseUrl || !token || !username) throw new Error(BACKEND_ERROR_REASON);
    const email = await getCurrentEmail();
    const url = `${baseUrl}/api/generatereport/owner-report/${id}?email=${encodeURIComponent(email)}`;
    const res = await fetchWithTimeout(url, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}`, 'X-API-Username': username }
    }, FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(BACKEND_ERROR_REASON);
    return /** @type {Promise<{ success: boolean }>} */ (res.json());
}

// ---------- Generate payout (preview rows + totals) ----------
/**
 * @param {string} propertyId
 * @param {string} propertyName
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<{ rows: Array, totalrental: number, totalutility: number, totalcollection: number, expenses: number, managementfee: number, netpayout: number }>}
 */
export async function generateOwnerPayout(propertyId, propertyName, startDate, endDate) {
    return /** @type {Promise<{ rows: Array, totalrental: number, totalutility: number, totalcollection: number, expenses: number, managementfee: number, netpayout: number }>} */ (postJson('/api/generatereport/generate-payout', {
        propertyId,
        propertyName: propertyName || '',
        startDate: startDate instanceof Date ? startDate.toISOString() : startDate,
        endDate: endDate instanceof Date ? endDate.toISOString() : endDate
    }));
}

// ---------- Bulk update ----------
/**
 * @param {string[]} ids
 * @param {{ paid?: boolean, accountingStatus?: string, paymentDate?: Date|string, paymentMethod?: string }} changes
 * @returns {Promise<{ success: boolean, updatedCount: number }>}
 */
export async function bulkUpdateOwnerReport(ids, changes) {
    const body = { ids, ...changes };
    if (changes.paymentDate && (changes.paymentDate instanceof Date)) body.paymentDate = changes.paymentDate.toISOString();
    return /** @type {Promise<{ success: boolean, updatedCount: number }>} */ (postJson('/api/generatereport/bulk-update', body));
}

// ---------- Selected reports total (for bulk summary) ----------
/**
 * @param {string[]} ids
 * @returns {Promise<{ total: number, count: number }>}
 */
export async function getOwnerReportsTotal(ids) {
    return /** @type {Promise<{ total: number, count: number }>} */ (postJson('/api/generatereport/owner-reports-total', { ids }));
}

// ---------- Owner report PDF: download URL (Node 生成，不经过 html) ----------
/**
 * Single report: 返回单 PDF 的 downloadUrl。
 * @param {string} payoutId
 * @returns {Promise<{ downloadUrl: string }>}
 */
export async function getOwnerReportPdfDownloadUrl(payoutId) {
    const data = await postJson('/api/generatereport/owner-report-pdf-download', { payoutId });
    const url = (data && typeof data === 'object' && 'downloadUrl' in data) ? data.downloadUrl : '';
    return { downloadUrl: url || '' };
}

/**
 * 多选下载：选 1 条返回单 PDF；选多条返回 zip 的 downloadUrl。
 * @param {string[]} ids - payout ids (ownerpayout.id)
 * @returns {Promise<{ downloadUrl: string }>}
 */
export async function getOwnerReportsPdfDownloadUrl(ids) {
    const idList = Array.isArray(ids) ? ids : (ids != null ? [ids] : []);
    const data = await postJson('/api/generatereport/owner-report-pdf-download', { ids: idList });
    const url = (data && typeof data === 'object' && 'downloadUrl' in data) ? data.downloadUrl : '';
    return { downloadUrl: url || '' };
}

// ---------- Owner report PDF: 生成并上传到 GAS（Node 生成 PDF，不经过 html2） ----------
/**
 * @param {string} payoutId
 * @returns {Promise<{ ok: boolean, task?: string }>}
 */
export async function generateAndUploadOwnerReportPdf(payoutId) {
    return /** @type {Promise<{ ok: boolean, task?: string }>} */ (postJson('/api/generatereport/generate-and-upload-owner-report-pdf', { payoutId }));
}

// ---------- Create owner report PDF (send to GAS) – 若前端已有 base64 可继续用 ----------
/**
 * @param {{ base64: string, fileName: string, payoutId: string }} opts
 * @returns {Promise<{ ok: boolean, task?: string }>}
 */
export async function createOwnerReport(opts) {
    const { base64, fileName, payoutId } = opts || {};
    return /** @type {Promise<{ ok: boolean, task?: string }>} */ (postJson('/api/generatereport/create-owner-report-pdf', { base64, fileName, payoutId }));
}
