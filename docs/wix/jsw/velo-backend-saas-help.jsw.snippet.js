/* ======================================================
   Help – backend/saas/help.jsw
   FAQ 列表 + 工单提交走 ECS，不读 Wix CMS。
   认证与 Base URL：ecs_token、ecs_username、ecs_base_url。
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

// ---------- FAQ ----------
/**
 * @param {number} [page=1]
 * @param {number} [pageSize=10]
 * @returns {Promise<{ ok: boolean, items: Array<{ _id: string, title: string, docs?: string, _createdDate: string }>, totalCount: number }>}
 */
export async function getFaqPage(page, pageSize) {
    const data = await postJson('/api/help/faq', {
        page: page != null ? page : 1,
        pageSize: pageSize != null ? pageSize : 10
    });
    return data;
}

// ---------- Ticket ----------
/**
 * @param {{ mode?: string, description: string, video?: string, photo?: string, clientId?: string, ticketId?: string }} payload
 * @returns {Promise<{ ok: boolean, ticketId: string }>}
 */
export async function submitTicket(payload) {
    const email = await getCurrentEmail();
    const data = await postJson('/api/help/ticket', {
        email,
        mode: payload?.mode || 'help',
        description: payload?.description || '',
        video: payload?.video || undefined,
        photo: payload?.photo || undefined,
        clientId: payload?.clientId || undefined,
        ticketId: payload?.ticketId || undefined
    });
    return data;
}
