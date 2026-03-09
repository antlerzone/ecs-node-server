/* ======================================================
   Agreement Setting – backend/saas/agreementsetting.jsw
   协议模板列表、筛选、详情、新建、更新、删除、生成 HTML 均请求 ECS Node，不读 Wix CMS。
   Topup 使用 backend/saas/topup：getMyBillingInfo、getCreditPlans、startNormalTopup。
   凭证：ecs_token、ecs_username、ecs_base_url（与 manage/topup 相同）。
====================================================== */

/** @typedef {{ ok?: boolean, reason?: string }} ApiResponseBase */

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
 * @returns {Promise<ApiResponseBase & object>}
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

// ---------- List (cache + filter: search, mode, sort, page, pageSize, limit) ----------
/**
 * @param {{ search?: string, mode?: string, sort?: string, page?: number, pageSize?: number, limit?: number }} opts
 * @returns {Promise<{ items: Array, totalPages: number, currentPage: number, total: number } | { ok: false, reason: string }>}
 */
export async function getAgreementList(opts = {}) {
    const data = /** @type {{ items?: any[], totalPages?: number, currentPage?: number, total?: number } & ApiResponseBase } */ (
        await postJson('/api/agreementsetting/list', {
            search: opts.search || undefined,
            mode: opts.mode || undefined,
            sort: opts.sort || undefined,
            page: opts.page,
            pageSize: opts.pageSize,
            limit: opts.limit
        })
    );
    if (data && data.ok === false) return data;
    return data || { items: [], totalPages: 1, currentPage: 1, total: 0 };
}

/** @returns {Promise<{ modes: Array<{ value: string, label: string }> } | { ok: false, reason: string }>} */
export async function getAgreementFilters() {
    const data = /** @type {{ modes?: Array<{ value: string, label: string }> } & ApiResponseBase } */ (
        await postJson('/api/agreementsetting/filters', {})
    );
    if (data && data.ok === false) return data;
    return data || { modes: [] };
}

/** @returns {Promise<object | null | { ok: false, reason: string }>} */
export async function getAgreement(id) {
    const data = /** @type {object | ApiResponseBase} */ (await postJson('/api/agreementsetting/get', { id }));
    if (data && data.ok === false) return data;
    return data || null;
}

/**
 * @param {{ title: string, templateurl: string, folderurl?: string, mode: string }} data
 * @returns {Promise<object | { ok: false, reason: string }>} inserted item
 */
export async function createAgreement(data) {
    const res = /** @type {object | ApiResponseBase} */ (await postJson('/api/agreementsetting/create', {
        title: data.title,
        templateurl: data.templateurl,
        folderurl: data.folderurl || '',
        mode: data.mode
    }));
    if (res && res.ok === false) return res;
    return res;
}

/**
 * @param {string} id
 * @param {{ title?: string, templateurl?: string, folderurl?: string, mode?: string }} data
 * @returns {Promise<{ updated: boolean } | { ok: false, reason: string }>}
 */
export async function updateAgreement(id, data) {
    const res = /** @type {{ updated?: boolean } | ApiResponseBase } */ (await postJson('/api/agreementsetting/update', {
        id,
        title: data.title,
        templateurl: data.templateurl,
        folderurl: data.folderurl,
        mode: data.mode
    }));
    if (res && res.ok === false) return res;
    return res || { updated: false };
}

/** @returns {Promise<{ deleted: boolean } | { ok: false, reason: string }>} */
export async function deleteAgreement(id) {
    const res = /** @type {{ deleted?: boolean } | ApiResponseBase } */ (await postJson('/api/agreementsetting/delete', { id }));
    if (res && res.ok === false) return res;
    return res || { deleted: false };
}

/**
 * Generate HTML from Google Doc via GAS and save to DB (Node calls GAS).
 * @param {string} id agreement template id
 * @returns {Promise<{ ok: boolean, htmlLength?: number } | { ok: false, reason: string }>}
 */
export async function generateAgreementHtmlPreview(id) {
    const res = /** @type {{ ok?: boolean, htmlLength?: number } | ApiResponseBase } */ (
        await postJson('/api/agreementsetting/generate-html', { id })
    );
    if (res && res.ok === false) return res;
    return res || { ok: false };
}

// Default export so "agreementsetting.getAgreementList" works when module is required by name
export default {
    getAgreementList,
    getAgreementFilters,
    getAgreement,
    createAgreement,
    updateAgreement,
    deleteAgreement,
    generateAgreementHtmlPreview
};
