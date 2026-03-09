/* ======================================================
   SaaS Indoor Admin – backend/saas/indooradmin.jsw
   Manual topup & manual renew：請求 ECS Node，先寫 DB 再開平台 Bukku cash invoice。
   憑證：ecs_token、ecs_username、ecs_base_url（與 billing 相同）。
   前端：SaaS admin dashboard 選 client + amount/plan + paidDate，點擊後調用此模組。
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

/**
 * 手動充值（indoor admin）
 * @param {{ clientId: string, amount: number, paidDate: string (YYYY-MM-DD) }}
 * @returns {Promise<{ ok: boolean, creditlogId?: string, bukkuInvoiceId?: number, reason?: string }>}
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
    return data || { ok: true };
}

/**
 * 手動續費（indoor admin）
 * @param {{ clientId: string, planId: string, paidDate: string (YYYY-MM-DD) }}
 * @returns {Promise<{ ok: boolean, pricingplanlogId?: string, bukkuInvoiceId?: number, reason?: string }>}
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
    return data || { ok: true };
}
