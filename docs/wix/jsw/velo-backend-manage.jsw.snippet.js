/* ======================================================
   门禁 Helper — backend/access/manage.jsw
   各页面统一只 import getAccessContext，不直接调用 wixUsersBackend / wixSecretsBackend。
   调用 ECS Node /api/access/context；认证与 Base URL 从 Secret Manager 读取。
====================================================== */

import wixUsersBackend from 'wix-users-backend';
import wixSecretsBackend from 'wix-secrets-backend';

/** Node 异常时统一返回，不把后端具体错误暴露给前端 */
const BACKEND_ERROR_REASON = 'BACKEND_ERROR';
const TIMEOUT_REASON = 'TIMEOUT';
/** 请求 ECS 超时（毫秒） */
const FETCH_TIMEOUT_MS = 15000;

/**
 * 带超时的 fetch，超时后 abort 抛 AbortError，可据此返回 TIMEOUT
 */
function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

/**
 * 从 Secret Manager 取 ECS 认证与后端根地址
 * 需在 Wix 后台配置：ecs_token、ecs_username、ecs_base_url
 */
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

/**
 * 通过 email 获取 access context（请求 ECS 后端）
 * 宕机/超时/5xx 时返回 { ok: false, reason: 'BACKEND_ERROR' }。
 * @param {string} email
 * @returns {Promise<{ok: boolean, reason?: string, staff?: object, client?: object, plan?: object, capability?: object, credit?: object, expired?: object}>}
 */
export async function getAccessContextByEmail(email) {
    try {
        if (email == null || typeof email !== 'string' || !String(email).trim()) {
            return { ok: false, reason: 'NO_EMAIL' };
        }
        const { token, username, baseUrl } = await getEcsCreds();
        if (!baseUrl || !token || !username) {
            return { ok: false, reason: BACKEND_ERROR_REASON };
        }
        const res = await fetchWithTimeout(
            `${baseUrl}/api/access/context`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-API-Username': username
                },
                body: JSON.stringify({ email: String(email).trim() })
            },
            FETCH_TIMEOUT_MS
        );

        if (!res.ok) {
            let reason = `HTTP ${res.status}`;
            try {
                const errBody = await res.json();
                if (errBody && typeof errBody.reason === 'string') reason = errBody.reason;
            } catch (_) {}
            return { ok: false, reason };
        }

        let raw;
        try {
            raw = await res.json();
        } catch (_) {
            return { ok: false, reason: BACKEND_ERROR_REASON };
        }
        const data = /** @type {{ ok?: boolean, reason?: string }} */ (raw);
        if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.ok === 'boolean') {
            return /** @type {{ ok: boolean, reason?: string, staff?: object, client?: object, plan?: object, capability?: object, credit?: object, expired?: object }} */ (data);
        }
        return { ok: false, reason: BACKEND_ERROR_REASON };
    } catch (e) {
        if (e && e.name === 'AbortError') {
            return { ok: false, reason: TIMEOUT_REASON };
        }
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}

/**
 * 门禁卡主入口：用当前登录用户 email 调 ECS 后端
 * @returns {Promise<{ok: boolean, reason?: string, ...}>}
 */
export async function getAccessContext() {
    const user = wixUsersBackend.currentUser;

    if (!user.loggedIn) {
        return { ok: false, reason: 'NOT_LOGGED_IN' };
    }

    const email = await user.getEmail();
    if (email == null || typeof email !== 'string' || !String(email).trim()) {
        return { ok: false, reason: 'NO_EMAIL' };
    }

    return getAccessContextByEmail(String(email).trim());
}
