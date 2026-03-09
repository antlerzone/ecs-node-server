/* ======================================================
   Company Setting – backend/saas/companysetting.jsw
   所有 companysetting 请求 ECS Node，不读 Wix CMS。
   认证与 Base URL 从 Secret Manager：ecs_token、ecs_username、ecs_base_url。
   必须导出 bukkuDisconnect、xeroDisconnect、autocountDisconnect，否则前端 Disconnect 会报 is not a function。
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
    if (!res.ok) {
        let reason = BACKEND_ERROR_REASON;
        try {
            const errBody = /** @type {{ reason?: string } | null } */ (await res.json());
            if (errBody && typeof errBody.reason === 'string') reason = errBody.reason;
        } catch (_) { /* ignore */ }
        throw new Error(reason);
    }
    const data = await res.json();
    return /** @type {object} */ (data);
}

// ---------- Access ----------
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

export async function getAccessContext() {
    const user = wixUsersBackend.currentUser;
    if (!user.loggedIn) return { ok: false, reason: 'NOT_LOGGED_IN' };
    const email = await user.getEmail();
    if (email == null || !String(email).trim()) return { ok: false, reason: 'NO_EMAIL' };
    return getAccessContextByEmail(String(email).trim());
}

// ---------- Staff ----------
/**
 * @returns {Promise<{ ok: boolean, items: Array }>}
 */
export async function getStaffList() {
    const email = await getCurrentEmail();
    return postJson('/api/companysetting/staff-list', { email });
}

export async function createStaff(payload) {
    const email = await getCurrentEmail();
    return postJson('/api/companysetting/staff-create', { email, ...payload });
}

export async function updateStaff(staffId, payload) {
    const email = await getCurrentEmail();
    return postJson('/api/companysetting/staff-update', { email, staffId, id: staffId, ...payload });
}

// ---------- Integration template (static) ----------
/**
 * @returns {Promise<{ ok: boolean, items: Array }>}
 */
export async function getIntegrationTemplate() {
    return postJson('/api/companysetting/integration-template', {});
}

// ---------- Profile ----------
/**
 * @returns {Promise<{ ok: boolean, client: object, profile: object }>}
 */
export async function getProfile() {
    const email = await getCurrentEmail();
    return postJson('/api/companysetting/profile', { email });
}

export async function updateProfile(payload) {
    const email = await getCurrentEmail();
    return postJson('/api/companysetting/profile-update', { email, ...payload });
}

// ---------- Banks ----------
/**
 * @returns {Promise<{ ok: boolean, items: Array<{ label: string, value: string }> }>}
 */
export async function getBanks() {
    return postJson('/api/companysetting/banks', {});
}

// ---------- Admin ----------
/**
 * @returns {Promise<{ ok: boolean, admin: object|null }>}
 */
export async function getAdmin() {
    const email = await getCurrentEmail();
    return postJson('/api/companysetting/admin', { email });
}

export async function saveAdmin(admin) {
    const email = await getCurrentEmail();
    return postJson('/api/companysetting/admin-save', { email, admin });
}

// ---------- Onboard: Status & Disconnect ----------
/** Never throws: on error returns { ok: false, reason }. */
export async function getOnboardStatus() {
    try {
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/onboard-status', { email });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

/** Never throws: on error returns { ok: false, reason }. */
export async function stripeDisconnect() {
    try {
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/stripe-disconnect', { email });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

// ---------- Onboard: Stripe Connect ----------
/** Never throws: on error returns { ok: false, reason }. */
export async function getStripeConnectOnboardUrl(opts) {
    try {
        opts = opts || {};
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/stripe-connect-onboard', {
            email,
            returnUrl: opts.returnUrl || opts.return_url,
            refreshUrl: opts.refreshUrl || opts.refresh_url
        });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

/** Complete Stripe Connect OAuth (MY Standard). Call when page loads with ?code= & ?state= from Stripe redirect. */
export async function stripeConnectOAuthComplete(opts) {
    try {
        opts = opts || {};
        const email = await getCurrentEmail();
        const codeLen = opts.code ? String(opts.code).length : 0;
        const statePreview = opts.state ? String(opts.state).substring(0, 8) + '...' : '';
        console.log('[companysetting.jsw] stripeConnectOAuthComplete called email=%s codeLen=%s state=%s', email || '', codeLen, statePreview);
        const out = await postJson('/api/companysetting/stripe-connect-oauth-complete', {
            email,
            code: opts.code,
            state: opts.state
        });
        console.log('[companysetting.jsw] stripeConnectOAuthComplete result ok=%s reason=%s', out && out.ok, out && out.reason);
        return out;
    } catch (e) {
        console.log('[companysetting.jsw] stripeConnectOAuthComplete throw', e && e.message);
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

// ---------- Onboard: CNYIOT ----------
/** Never throws: on error returns { ok: false, reason }. */
export async function cnyiotConnect(opts) {
    try {
        opts = opts || {};
        const mode = opts.mode || '';
        console.log('[cnyiotConnect] start mode=%s timeoutMs=%s', mode, FETCH_TIMEOUT_MS);
        const email = await getCurrentEmail();
        const t0 = Date.now();
        const data = await postJson('/api/companysetting/cnyiot-connect', { email, ...opts });
        console.log('[cnyiotConnect] done ms=%s ok=%s reason=%s', Date.now() - t0, data && data.ok, (data && data.ok === false) ? data.reason : '');
        return data;
    } catch (e) {
        const msg = (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON;
        const isAbort = (e && e.name === 'AbortError') || /abort/i.test(String(e.message || ''));
        console.log('[cnyiotConnect] fail reason=%s name=%s cause=%s', msg, e && e.name, (e && e.cause) ? String(e.cause) : '');
        if (isAbort) console.warn('[cnyiotConnect] request aborted (likely timeout after ' + FETCH_TIMEOUT_MS + 'ms)');
        return { ok: false, reason: msg };
    }
}

export async function getCnyiotCredentials() {
    try {
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/cnyiot-credentials', { email });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

/** 断开 Meter (CNYIOT)。断开后再次连接时选项为 Connect own account / Connect old account。 */
export async function cnyiotDisconnect() {
    try {
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/cnyiot-disconnect', { email });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

/** 获取当前户口的 CNYIOT 租客列表。opts.debug 为 true 时返回 requestPayload/responsePayload。Returns { ok: true, users, requestPayload?, responsePayload? } or { ok: false, reason }. */
export async function getCnyiotUsers(opts) {
    try {
        opts = opts || {};
        const email = await getCurrentEmail();
        const data = /** @type {{ ok?: boolean, users?: any[], requestPayload?: object, responsePayload?: object, reason?: string } | null } */ (await postJson('/api/companysetting/cnyiot-users', { email, debug: !!opts.debug }));
        return data;
    } catch (e) {
        const reason = (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON;
        if (reason === BACKEND_ERROR_REASON) {
            console.warn('[getCnyiotUsers] BACKEND_ERROR – check ECS Secrets (ecs_base_url, ecs_token, ecs_username) or network', e);
        }
        return { ok: false, reason };
    }
}

/** 创建 CNYIOT 租客 (addUser)，返回 requestPayload/responsePayload 供前端展示。opts: { loginName, password }. */
export async function createCnyiotUser(opts) {
    try {
        opts = opts || {};
        const email = await getCurrentEmail();
        const data = /** @type {{ ok?: boolean, requestPayload?: object, responsePayload?: object, result?: object, reason?: string } | null } */ (await postJson('/api/companysetting/cnyiot-create-user', { email, loginName: opts.loginName, password: opts.password, tel: opts.tel }));
        return data;
    } catch (e) {
        const reason = (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON;
        if (reason === BACKEND_ERROR_REASON) {
            console.warn('[createCnyiotUser] BACKEND_ERROR', e);
        }
        return { ok: false, reason };
    }
}

// ---------- Onboard: Bukku (Token + Subdomain) ----------
/** Never throws: on error returns { ok: false, reason }. */
export async function bukkuConnect(opts) {
    try {
        opts = opts || {};
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/bukku-connect', { email, ...opts });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

export async function getBukkuCredentials() {
    try {
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/bukku-credentials', { email });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

/** Never throws: on error returns { ok: false, reason }. */
export async function bukkuDisconnect() {
    try {
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/bukku-disconnect', { email });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

// ---------- Onboard: AutoCount (API Key + Key ID + Account Book ID) ----------
/** Never throws: on error returns { ok: false, reason }. */
export async function autocountConnect(opts) {
    try {
        opts = opts || {};
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/autocount-connect', { email, ...opts });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

export async function getAutoCountCredentials() {
    try {
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/autocount-credentials', { email });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

/** Never throws: on error returns { ok: false, reason }. */
export async function autocountDisconnect() {
    try {
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/autocount-disconnect', { email });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

// ---------- Onboard: SQL Account (Access Key + Secret Key, AWS Sig v4) ----------
/** Never throws: on error returns { ok: false, reason }. */
export async function sqlConnect(opts) {
    try {
        opts = opts || {};
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/sql-connect', { email, ...opts });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

export async function getSqlAccountCredentials() {
    try {
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/sql-credentials', { email });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

/** Never throws: on error returns { ok: false, reason }. */
export async function sqlDisconnect() {
    try {
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/sql-disconnect', { email });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

export async function updateAccountingEinvoice(opts) {
    try {
        opts = opts || {};
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/einvoice-update', { email, provider: opts.provider, einvoice: opts.einvoice });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

// ---------- Onboard: Xero (OAuth2, button like Stripe) ----------
/** On missing redirectUri returns { ok: false, reason: 'REDIRECT_URI_REQUIRED' }; never throws. */
export async function getXeroAuthUrl(opts) {
    try {
        opts = opts || {};
        const redirectUri = opts.redirectUri || opts.redirect_uri;
        if (!redirectUri) return { ok: false, reason: 'REDIRECT_URI_REQUIRED' };
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/xero-auth-url', {
            email,
            redirectUri,
            redirect_uri: redirectUri,
            state: opts.state || ''
        });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

/** Never throws: on error returns { ok: false, reason }. */
export async function xeroConnect(opts) {
    try {
        opts = opts || {};
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/xero-connect', { email, ...opts });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

/** Never throws: on error returns { ok: false, reason }. */
export async function xeroDisconnect() {
    try {
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/xero-disconnect', { email });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

// ---------- Onboard: TTLock ----------
/** Never throws: on error returns { ok: false, reason }. */
export async function ttlockConnect(opts) {
    try {
        opts = opts || {};
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/ttlock-connect', { email, ...opts });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

export async function getTtlockCredentials() {
    try {
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/ttlock-credentials', { email });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}

/** Never throws: on error returns { ok: false, reason }. */
export async function ttlockDisconnect() {
    try {
        const email = await getCurrentEmail();
        return await postJson('/api/companysetting/ttlock-disconnect', { email });
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? String(e.message) : BACKEND_ERROR_REASON };
    }
}
