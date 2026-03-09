/* ======================================================
   SaaS Manual Billing – backend/saas/manualbilling.jsw
   Manual topup & manual renew：客戶/方案從 ECS 取得，提交走 indoor-admin API。
   憑證：ecs_token、ecs_username、ecs_base_url（與 billing 相同）。
   前端：#dropdownclient / #dropdownclient2 選 client，#dropdownpricingplan 選方案，
   #datepicker1 顧客支付日期；#buttonsubmitpricingplan 依 client 有無方案顯示 Renew / Create。
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

async function postJson(path, body) {
    const { token, username, baseUrl } = await getEcsCreds();
    if (!baseUrl || !token || !username) {
        throw new Error('BACKEND_ERROR (missing ecs_token / ecs_username / ecs_base_url in Secret Manager)');
    }
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
    let data;
    try {
        data = await res.json();
    } catch (_) {
        data = null;
    }
    if (!res.ok) {
        const errBody = /** @type {{ reason?: string, message?: string } | null } */ (data);
        const reason = (errBody && typeof errBody.reason === 'string') ? errBody.reason : (errBody && typeof errBody.message === 'string') ? errBody.message : `HTTP ${res.status}`;
        throw new Error(reason);
    }
    return /** @type {object} */ (data);
}

/**
 * 取得 manual billing 客戶下拉列表（從 ECS，不讀 Wix CMS）。
 * @returns {Promise<{ items: Array<{ id: string, title: string, email?: string, status: *, expired: *, hasPlan: boolean }> }>}
 */
export async function getClients() {
    const email = await getCurrentEmail();
    const data = /** @type {{ ok?: boolean, reason?: string, items?: Array<{ id: string, title: string, email?: string, status: *, expired: *, hasPlan: boolean }> }} */ (
        await postJson('/api/billing/indoor-admin/clients', { email })
    );
    if (data && data.ok === false) throw new Error(data.reason || BACKEND_ERROR_REASON);
    return { items: Array.isArray(data?.items) ? data.items : [] };
}

/**
 * 取得 pricing plan 下拉列表（從 ECS）。按 sellingprice 由低到高。API 直接回傳陣列。
 * @returns {Promise<Array<{ id: string, _id: string, title: string, description?: string, sellingprice: number, corecredit: * }>>}
 */
export async function getPlans() {
    const email = await getCurrentEmail();
    const data = /** @type {Array<*>} */ (await postJson('/api/billing/plans', { email }));
    return Array.isArray(data) ? data : [];
}

/**
 * 取得待處理 manual billing 工單（billing_manual / topup_manual），供 #repeaterpending 顯示。
 * @returns {Promise<{ items: Array<{ _id: string, mode: string, description: string, ticketid: string, _createdDate: string, client_id: string, clientTitle: string }> }>}
 */
export async function getPendingTickets() {
    const email = await getCurrentEmail();
    const data = /** @type {{ ok?: boolean, reason?: string, items?: Array<*> }} */ (
        await postJson('/api/billing/indoor-admin/pending-tickets', { email })
    );
    if (data && data.ok === false) throw new Error(data.reason || BACKEND_ERROR_REASON);
    return { items: Array.isArray(data?.items) ? data.items : [] };
}

/**
 * 手動充值（manual billing）
 * @param {{ clientId: string, amount: number, paidDate: string }} opts - paidDate 格式 YYYY-MM-DD
 * @returns {Promise<*>}
 */
export async function manualTopup(opts) {
    const email = await getCurrentEmail();
    const data = /** @type {{ ok?: boolean, reason?: string, creditlogId?: string, bukkuInvoiceId?: number }} */ (
        await postJson('/api/billing/indoor-admin/manual-topup', {
            email,
            clientId: opts?.clientId,
            amount: opts?.amount,
            paidDate: opts?.paidDate
        })
    );
    if (data && data.ok === false) throw new Error(data.reason || BACKEND_ERROR_REASON);
    return { ok: true, ...(data || {}) };
}

/**
 * 手動續費／開戶（manual renew / create）
 * @param {{ clientId: string, planId: string, paidDate: string }} opts - paidDate 格式 YYYY-MM-DD
 * @returns {Promise<*>}
 */
export async function manualRenew(opts) {
    const email = await getCurrentEmail();
    const data = /** @type {{ ok?: boolean, reason?: string, pricingplanlogId?: string, bukkuInvoiceId?: number }} */ (
        await postJson('/api/billing/indoor-admin/manual-renew', {
            email,
            clientId: opts?.clientId,
            planId: opts?.planId,
            paidDate: opts?.paidDate
        })
    );
    if (data && data.ok === false) throw new Error(data.reason || BACKEND_ERROR_REASON);
    return { ok: true, ...(data || {}) };
}

/**
 * 存入 client 的 CNYIOT 售电员户口 id 到 client_integration（人工后台开售电员后在此输入，密码固定 0123456789）。
 * @param {{ clientId: string, cnyiotUserId: string }} opts
 * @returns {Promise<{ ok: boolean }>}
 */
export async function saveCnyiotSalesUser(opts) {
    const email = await getCurrentEmail();
    const data = /** @type {{ ok?: boolean, reason?: string }} */ (
        await postJson('/api/billing/indoor-admin/save-cnyiot-sales-user', {
            email,
            clientId: opts?.clientId,
            cnyiotUserId: opts?.cnyiotUserId
        })
    );
    if (data && data.ok === false) throw new Error(data.reason || BACKEND_ERROR_REASON);
    return { ok: true };
}
