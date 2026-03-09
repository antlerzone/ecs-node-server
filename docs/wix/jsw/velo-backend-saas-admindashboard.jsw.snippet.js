/* ======================================================
   Admin Dashboard – backend/saas/admindashboard.jsw
   Admin 列表（feedback + refunddeposit）、标记完成、删除均请求 ECS Node，不读 Wix CMS。
   认证与 Base URL 从 Secret Manager 读取：ecs_token、ecs_username、ecs_base_url。
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
 * @param {object} body
 * @returns {Promise<object>}
 */
async function postJson(path, body) {
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
            body: JSON.stringify(body || {})
        },
        FETCH_TIMEOUT_MS
    );
    if (!res.ok) throw new Error(BACKEND_ERROR_REASON);
    const data = await res.json();
    return /** @type {object} */ (data);
}

// ---------- Admin Dashboard ----------
/**
 * 获取 Admin 列表（支持 server filter + cache/分页，与 expenses 页一致）
 * @param {{ filterType?: string, search?: string, sort?: string, page?: number, pageSize?: number, limit?: number }} opts
 *   filterType: 'ALL' | 'Feedback' | 'Refund'
 *   sort: 'new' | 'old'
 *   limit: 传则拉一页最多 limit 条（用于前端 cache）；否则用 page+pageSize 分页
 * @returns {Promise<{ok: boolean, items?: Array, total?: number, totalPages?: number, currentPage?: number, reason?: string}>}
 */
export async function getAdminList(opts = {}) {
    try {
        const email = await getCurrentEmail();
        const data = await postJson('/api/admindashboard/list', {
            email,
            filterType: opts.filterType,
            search: opts.search,
            sort: opts.sort,
            page: opts.page,
            pageSize: opts.pageSize,
            limit: opts.limit
        });
        if (data && typeof data.ok === 'boolean' && Array.isArray(data.items)) {
            return {
                ok: true,
                items: data.items,
                total: data.total,
                totalPages: data.totalPages,
                currentPage: data.currentPage
            };
        }
        return { ok: false, items: [], total: 0 };
    } catch (e) {
        return { ok: false, items: [], total: 0, reason: e && e.name === 'AbortError' ? 'TIMEOUT' : BACKEND_ERROR_REASON };
    }
}

/**
 * 更新 feedback：标记完成、备注
 * @param {{ id: string, done: boolean, remark?: string }} payload
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function updateFeedback(payload) {
    try {
        const email = await getCurrentEmail();
        const data = await postJson('/api/admindashboard/feedback/update', {
            email,
            id: payload?.id,
            done: payload?.done,
            remark: payload?.remark
        });
        return data && typeof data.ok === 'boolean' ? data : { ok: false, reason: BACKEND_ERROR_REASON };
    } catch (e) {
        return { ok: false, reason: e && e.name === 'AbortError' ? 'TIMEOUT' : BACKEND_ERROR_REASON };
    }
}

/**
 * 删除 feedback
 * @param {{ id: string }} payload
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function removeFeedback(payload) {
    try {
        const email = await getCurrentEmail();
        const data = await postJson('/api/admindashboard/feedback/remove', { email, id: payload?.id });
        return data && typeof data.ok === 'boolean' ? data : { ok: false, reason: BACKEND_ERROR_REASON };
    } catch (e) {
        return { ok: false, reason: e && e.name === 'AbortError' ? 'TIMEOUT' : BACKEND_ERROR_REASON };
    }
}

/**
 * 更新 refunddeposit：标记已退款；可选 refundAmount（部分退则其余为 forfeit）
 * @param {{ id: string, done: boolean, refundAmount?: number | string }} payload
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function updateRefundDeposit(payload) {
    try {
        const email = await getCurrentEmail();
        const body = { email, id: payload?.id, done: payload?.done };
        const ra = payload?.refundAmount;
        if (ra != null && String(ra).trim() !== '') body.refundAmount = ra;
        const data = await postJson('/api/admindashboard/refund/update', body);
        return data && typeof data.ok === 'boolean' ? data : { ok: false, reason: BACKEND_ERROR_REASON };
    } catch (e) {
        return { ok: false, reason: e && e.name === 'AbortError' ? 'TIMEOUT' : BACKEND_ERROR_REASON };
    }
}

/**
 * 删除 refunddeposit
 * @param {{ id: string }} payload
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function removeRefundDeposit(payload) {
    try {
        const email = await getCurrentEmail();
        const data = await postJson('/api/admindashboard/refund/remove', { email, id: payload?.id });
        return data && typeof data.ok === 'boolean' ? data : { ok: false, reason: BACKEND_ERROR_REASON };
    } catch (e) {
        return { ok: false, reason: e && e.name === 'AbortError' ? 'TIMEOUT' : BACKEND_ERROR_REASON };
    }
}

/**
 * Staff 签署 agreement（operator 签名）. 用于 Admin Dashboard #sectionagreement #buttonagree.
 * @param {{ agreementId: string, operatorsign: string }} payload
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function signAgreementOperator(payload) {
    try {
        const email = await getCurrentEmail();
        const data = await postJson('/api/admindashboard/agreement/operator-sign', {
            email,
            agreementId: payload?.agreementId,
            operatorsign: payload?.operatorsign
        });
        return data && typeof data.ok === 'boolean' ? data : { ok: false, reason: BACKEND_ERROR_REASON };
    } catch (e) {
        return { ok: false, reason: e && e.name === 'AbortError' ? 'TIMEOUT' : BACKEND_ERROR_REASON };
    }
}

// ---------- Section Property (tenancy list by property + status) ----------
// Uses same ECS baseUrl; tenancysetting API requires same email (staff with client).

/**
 * Tenancy list for client. Body: { email, propertyId?, status?, search?, page?, pageSize?, limit? }
 * status: 'true' = active, 'false' = inactive.
 * @returns {Promise<{ items?: Array, total?: number, totalPages?: number, currentPage?: number }>}
 */
export async function getTenancyList(opts = {}) {
    try {
        const email = await getCurrentEmail();
        const data = /** @type {{ items?: Array, total?: number, totalPages?: number, currentPage?: number, ok?: boolean, reason?: string } | null */ (await postJson('/api/admindashboard/tenancy-list', {
            email,
            propertyId: opts.propertyId,
            status: opts.status,
            search: opts.search,
            page: opts.page,
            pageSize: opts.pageSize,
            limit: opts.limit
        }));
        if (data && Array.isArray(data.items)) {
            return {
                items: data.items,
                total: data.total ?? 0,
                totalPages: data.totalPages ?? 1,
                currentPage: data.currentPage ?? 1
            };
        }
        return { items: [], total: 0, totalPages: 1, currentPage: 1 };
    } catch (e) {
        return { items: [], total: 0, totalPages: 1, currentPage: 1 };
    }
}

/**
 * Tenancy filters: properties + status options (Active/Inactive).
 * @returns {Promise<{ properties?: Array, statusOptions?: Array }>}
 */
export async function getTenancyFilters() {
    try {
        const email = await getCurrentEmail();
        const data = /** @type {{ properties?: Array, statusOptions?: Array } | null } */ (await postJson('/api/admindashboard/tenancy-filters', { email }));
        return {
            properties: data?.properties ?? [],
            statusOptions: data?.statusOptions ?? []
        };
    } catch (e) {
        return { properties: [], statusOptions: [] };
    }
}

/**
 * Get one agreement by id for operator (open from #repeatertenancy). Same shape as list item.
 * @param {{ agreementId: string }} payload
 * @returns {Promise<{ ok: boolean, item?: object, reason?: string }>}
 */
export async function getAgreementForOperator(payload) {
    try {
        const email = await getCurrentEmail();
        const data = /** @type {{ ok?: boolean, item?: object, reason?: string } | null */ (await postJson('/api/admindashboard/agreement/for-operator', {
            email,
            agreementId: payload?.agreementId
        }));
        if (data && data.ok === true && data.item) {
            return { ok: true, item: data.item };
        }
        return { ok: false, reason: data?.reason || BACKEND_ERROR_REASON };
    } catch (e) {
        return { ok: false, reason: e && e.name === 'AbortError' ? 'TIMEOUT' : BACKEND_ERROR_REASON };
    }
}
