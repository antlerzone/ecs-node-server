/* ======================================================
   Billing – backend/saas/billing.jsw
   所有 billing/checkout/topup/deduction/plans 均请求 ECS Node，不读 Wix CMS。
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

// ---------- Access (same as manage.jsw) ----------
/**
 * @param {string} email
 * @returns {Promise<{ok: boolean, reason?: string, staff?: object, client?: object, plan?: object, credit?: object, expired?: object}>}
 */
export async function getAccessContextByEmail(email) {
    try {
        if (email == null || typeof email !== 'string' || !String(email).trim()) {
            return { ok: false, reason: 'NO_EMAIL' };
        }
        const data = await postJson('/api/access/context', { email: String(email).trim() });
        if (data && typeof data.ok === 'boolean') return data;
        return { ok: false, reason: BACKEND_ERROR_REASON };
    } catch (e) {
        return { ok: false, reason: e && e.name === 'AbortError' ? 'TIMEOUT' : BACKEND_ERROR_REASON };
    }
}

/**
 * 用当前登录用户 email 获取 access context
 */
export async function getAccessContext() {
    const user = wixUsersBackend.currentUser;
    if (!user.loggedIn) return { ok: false, reason: 'NOT_LOGGED_IN' };
    const email = await user.getEmail();
    if (email == null || !String(email).trim()) return { ok: false, reason: 'NO_EMAIL' };
    return getAccessContextByEmail(String(email).trim());
}

// ---------- Billing ----------
/**
 * @returns {Promise<{noPermission?: boolean, currency?, title?, plan?, credit?, expired?, pricingplandetail?}>}
 */
export async function getMyBillingInfo() {
    const email = await getCurrentEmail();
    return postJson('/api/billing/my-info', { email });
}

export async function clearBillingCache() {
    const email = await getCurrentEmail();
    return postJson('/api/billing/clear-cache', { email });
}

/**
 * @param {{ page?: number, pageSize?: number, sort?: string, filterType?: string, search?: string }} opts
 * @returns {Promise<{ items: Array, total: number, page: number, pageSize: number }>}
 */
export async function getCreditStatements(opts = {}) {
    const email = await getCurrentEmail();
    return postJson('/api/billing/credit-statements', { email, ...opts });
}

/**
 * 合并 credit + plan 流水，供 Event Log 列表用（sort/filter 由后端处理）
 * @param {{ page?: number, pageSize?: number, sort?: string, filterType?: string, search?: string }} opts
 * @returns {Promise<{ items: Array, total: number, page: number, pageSize: number }>}
 */
export async function getStatementItems(opts = {}) {
    const email = await getCurrentEmail();
    return postJson('/api/billing/statement-items', { email, ...opts });
}

/**
 * 导出 Billing 流水为 Excel，Node 生成文件后返回一次性下载 URL
 * @param {{ sort?: string, filterType?: string, search?: string }} opts — 与 Event Log 当前筛选一致
 * @returns {Promise<{ downloadUrl: string }>}
 */
export async function getStatementExportUrl(opts = {}) {
    const email = await getCurrentEmail();
    return postJson('/api/billing/statement-export', { email, ...opts });
}

/**
 * @returns {Promise<Array<{id: string, _id: string, title: string, description?: string, sellingprice: number, corecredit: number}>>}
 */
export async function getPlans() {
    const email = await getCurrentEmail();
    const data = await postJson('/api/billing/plans', { email });
    const arr = Array.isArray(data) ? data : [];
    return /** @type {Array<{id: string, _id: string, title: string, description?: string, sellingprice: number, corecredit: number}>} */ (arr);
}

/**
 * @returns {Promise<Array<{id: string, _id: string, title: string, description: Array|string, credit: string, qty: number}>>}
 */
export async function getAddons() {
    const email = await getCurrentEmail();
    const data = await postJson('/api/billing/addons', { email });
    const arr = Array.isArray(data) ? data : [];
    return /** @type {Array<{id: string, _id: string, title: string, description: (Array|string), credit: string, qty: number}>} */ (arr);
}

/**
 * @returns {Promise<Array<{id: string, _id: string, title: string, sellingprice: number, credit: number}>>}
 */
export async function getCreditPlans() {
    const email = await getCurrentEmail();
    const data = await postJson('/api/billing/credit-plans', { email });
    const arr = Array.isArray(data) ? data : [];
    return /** @type {Array<{id: string, _id: string, title: string, sellingprice: number, credit: number}>} */ (arr);
}

// ---------- Checkout ----------
/**
 * @param {{ planId: string }} opts
 * @returns {Promise<object>}
 */
export async function previewPricingPlan(opts) {
    const email = await getCurrentEmail();
    return postJson('/api/billing/checkout/preview', { email, planId: opts.planId });
}

/**
 * @param {{ planId: string, returnUrl: string }} opts
 * @returns {Promise<{ provider: string, url: string, referenceNumber: string }>}
 */
export async function confirmPricingPlan(opts) {
    const email = await getCurrentEmail();
    const data = /** @type {{ provider?: string, url?: string, referenceNumber?: string }} */ (
        await postJson('/api/billing/checkout/confirm', { email, planId: opts.planId, returnUrl: opts.returnUrl })
    );
    return {
        provider: data.provider != null ? String(data.provider) : 'stripe',
        url: data.url != null ? String(data.url) : '',
        referenceNumber: data.referenceNumber != null ? String(data.referenceNumber) : ''
    };
}

// ---------- Deduction ----------
/**
 * @param {{ amount: number, title: string, addons: object }} opts
 * @returns {Promise<object>}
 */
export async function deductAddonCredit(opts) {
    const email = await getCurrentEmail();
    return postJson('/api/billing/deduction/addon', { email, amount: opts.amount, title: opts.title, addons: opts.addons });
}

// ---------- Topup ----------
/**
 * @param {{ creditPlanId: string, returnUrl: string }} opts
 * @returns {Promise<{ success: boolean, provider: string, url: string, referenceNumber: string }>}
 */
export async function startNormalTopup(opts) {
    const email = await getCurrentEmail();
    const data = /** @type {{ success?: boolean, provider?: string, url?: string, referenceNumber?: string }} */ (
        await postJson('/api/billing/topup/start', { email, creditPlanId: opts.creditPlanId, returnUrl: opts.returnUrl })
    );
    return {
        success: data.success === true,
        provider: data.provider != null ? String(data.provider) : 'stripe',
        url: data.url != null ? String(data.url) : '',
        referenceNumber: data.referenceNumber != null ? String(data.referenceNumber) : ''
    };
}
