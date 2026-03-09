/* ======================================================
   Topup – backend/saas/topup.jsw（多页面共用）
   充值相关：当前余额、套餐列表、发起充值，均请求 ECS Node，不读 Wix CMS。
   各页（Billing、Expenses、Admin、Company Setting、Tenant Invoice、Profile 等）统一从此模块 import。
   凭证：ecs_token、ecs_username、ecs_base_url（与 manage/billing 相同）。

   前端约定：凡使用 Topup 的页面必须加入 #buttontopupclose，点击时返回上一个 section
   （collapse sectiontopup，expand 进入 topup 前的 section，并更新 activeSection）。
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

// ---------- Topup（多页面共用）----------
/**
 * 当前客户 Billing 信息（含 credit 余额），用于 Topup 区块显示
 * @returns {Promise<{noPermission?: boolean, currency?, title?, plan?, credit?, expired?, pricingplandetail?}>}
 */
export async function getMyBillingInfo() {
    const email = await getCurrentEmail();
    return postJson('/api/billing/my-info', { email });
}

/**
 * 充值套餐列表，用于 Topup repeater
 * @returns {Promise<Array<{id: string, _id: string, title: string, sellingprice: number, credit: number}>>}
 */
export async function getCreditPlans() {
    const email = await getCurrentEmail();
    const data = await postJson('/api/billing/credit-plans', { email });
    const arr = Array.isArray(data) ? data : [];
    return /** @type {Array<{id: string, _id: string, title: string, sellingprice: number, credit: number}>} */ (arr);
}

/**
 * 发起普通充值，跳转支付页
 * @param {{ creditPlanId: string, returnUrl?: string, redirectUrl?: string }} opts — returnUrl 与 redirectUrl 二选一，推荐 returnUrl
 * @returns {Promise<{ success: boolean, provider: string, url: string, referenceNumber: string }>}
 */
export async function startNormalTopup(opts) {
    const email = await getCurrentEmail();
    const returnUrl = opts?.returnUrl || opts?.redirectUrl || '';
    const data = /** @type {{ success?: boolean, provider?: string, url?: string, referenceNumber?: string }} */ (
        await postJson('/api/billing/topup/start', { email, creditPlanId: opts?.creditPlanId, returnUrl })
    );
    return {
        success: data.success === true,
        provider: data.provider != null ? String(data.provider) : 'stripe',
        url: data.url != null ? String(data.url) : '',
        referenceNumber: data.referenceNumber != null ? String(data.referenceNumber) : ''
    };
}
