/* ======================================================
   Contact (Profile page) – backend/saas/contact.jsw
   所有联系人列表、Owner/Tenant/Supplier 增删改、审批、Bukku 同步均请求 ECS Node，不读 Wix CMS。
   认证与 Base URL 从 Wix Secret Manager 读取：
   - ecs_token：与 ECS api_user 表中的 token 一致
   - ecs_username：与 api_user.username 一致
   - ecs_base_url：ECS 根 URL，如 https://your-ecs.example.com（勿以 / 结尾）
   若出现 BACKEND_ERROR / 401，请检查上述三个 Secret 及 ECS api_user 中该 token 是否有效、username 是否匹配。
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

async function getEmail() {
    const user = wixUsersBackend.currentUser;
    if (!user.loggedIn) return null;
    return await user.getEmail();
}

/**
 * @param {string} path
 * @param {object} body
 * @returns {Promise<object>}
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
                const errBody = /** @type {{ reason?: string, message?: string } | null } */ (await res.json());
                if (errBody && typeof errBody === 'object') {
                    if ('message' in errBody && typeof errBody.message === 'string') reason = errBody.message;
                    else if ('reason' in errBody && typeof errBody.reason === 'string') reason = errBody.reason;
                }
            } catch (_) {}
            return { ok: false, reason };
        }
        let data;
        try {
            data = await res.json();
        } catch (parseErr) {
            return { ok: false, reason: 'INVALID_JSON' };
        }
        if (data && typeof data === 'object' && !Array.isArray(data)) return /** @type {Object} */ (data);
        return { ok: false, reason: 'INVALID_RESPONSE' };
    } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, reason: 'TIMEOUT' };
        const msg = e ? String(e.message || (typeof e.toString === 'function' ? e.toString() : '')).slice(0, 80) : '';
        return { ok: false, reason: msg ? `NETWORK: ${msg}` : BACKEND_ERROR_REASON };
    }
}

// ---------- List (filter 同 expenses：支持 type, search, sort, page, pageSize, limit) ----------
/**
 * @param {{ type?: string, search?: string, sort?: string, page?: number, pageSize?: number, limit?: number }} opts
 * @returns {Promise<{ ok: boolean, reason?: string, items: Array, total?: number, totalPages?: number, currentPage?: number }>}
 */
export async function getContactList(opts = {}) {
    const data = /** @type {{ ok?: boolean, reason?: string, items?: any[], total?: number, totalPages?: number, currentPage?: number } | null } */ (await postJson('/api/contact/list', {
        type: opts.type || undefined,
        search: opts.search || undefined,
        sort: opts.sort || undefined,
        page: opts.page,
        pageSize: opts.pageSize,
        limit: opts.limit
    }));
    return data || { ok: false, reason: 'NO_RESPONSE', items: [], total: 0, totalPages: 1, currentPage: 1 };
}

// ---------- Get one ----------
/** @returns {Promise<{ ok: boolean, reason?: string, _id?: string, ownerName?: string, email?: string, account?: Array }>} */
export async function getOwner(ownerId) {
    const data = /** @type {{ ok?: boolean, reason?: string, _id?: string, ownerName?: string, email?: string, account?: Array } | null } */ (await postJson('/api/contact/owner', { ownerId }));
    return data || { ok: false, reason: 'NO_RESPONSE' };
}

/** @returns {Promise<{ ok: boolean, reason?: string, _id?: string, fullname?: string, email?: string, account?: Array }>} */
export async function getTenant(tenantId) {
    const data = /** @type {{ ok?: boolean, reason?: string, _id?: string, fullname?: string, email?: string, account?: Array } | null } */ (await postJson('/api/contact/tenant', { tenantId }));
    return data || { ok: false, reason: 'NO_RESPONSE' };
}

/** @returns {Promise<{ ok: boolean, reason?: string, _id?: string, title?: string, email?: string, account?: Array, client?: Array }>} */
export async function getSupplier(supplierId) {
    const data = /** @type {{ ok?: boolean, reason?: string, _id?: string, title?: string, email?: string, account?: Array, client?: Array } | null } */ (await postJson('/api/contact/supplier', { supplierId }));
    return data || { ok: false, reason: 'NO_RESPONSE' };
}

/** Bank list from bankdetail for #dropdownbank. value = id (supplierdetail.bankdetail_id), label = bankname */
export async function getBanks() {
    const data = /** @type {{ ok?: boolean, reason?: string, items?: Array<{ value: string, label: string }> } | null } */ (await postJson('/api/contact/banks', {}));
    if (!data || !data.ok) return { ok: false, reason: data?.reason || 'FAIL', items: [] };
    return { ok: true, items: data.items || [] };
}

/** Current client's account system: 'sql' | 'autocount' | 'bukku' | 'xero'. Used to read/write account[] by provider. */
export async function getAccountSystem() {
    const data = /** @type {{ ok?: boolean, reason?: string, provider?: string } | null } */ (await postJson('/api/contact/account-system', {}));
    if (!data || !data.ok) return { ok: false, provider: 'sql' };
    return { ok: true, provider: data.provider || 'sql' };
}

// ---------- Update account (contact id for current account system: sql/autocount/bukku/xero) ----------
export async function updateOwnerAccount(ownerId, contactId) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/contact/owner/update-account', { ownerId, contactId }));
    return data || { ok: false, reason: 'NO_RESPONSE' };
}

export async function updateTenantAccount(tenantId, contactId) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/contact/tenant/update-account', { tenantId, contactId }));
    return data || { ok: false, reason: 'NO_RESPONSE' };
}

// ---------- Delete / Cancel ----------
export async function deleteOwnerOrCancel(ownerId, isPending) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/contact/owner/delete', { ownerId, isPending: !!isPending }));
    return data || { ok: false, reason: 'NO_RESPONSE' };
}

export async function deleteTenantOrCancel(tenantId, isPending) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/contact/tenant/delete', { tenantId, isPending: !!isPending }));
    return data || { ok: false, reason: 'NO_RESPONSE' };
}

export async function deleteSupplierAccount(supplierId) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/contact/supplier/delete', { supplierId }));
    return data || { ok: false, reason: 'NO_RESPONSE' };
}

// ---------- Supplier create (Bukku contact + insert) ----------
/**
 * Create Bukku contact for supplier; then insert supplierdetail.
 * @param {{ name: string, email: string, billerCode?: string, bankName?: string, bankAccount?: string, bankHolder?: string }} payload
 * @returns {Promise<{ ok: boolean, reason?: string, provider?: string, contactId?: string }>} from transit; then create uses contactId
 */
export async function upsertContactTransit(clientId, payload) {
    const data = /** @type {{ ok?: boolean, reason?: string, provider?: string, contactId?: string } | null } */ (await postJson('/api/contact/upsert-transit', {
        name: payload.name,
        email: payload.email,
        billerCode: payload.billerCode,
        bankName: payload.bankName,
        bankAccount: payload.bankAccount,
        bankHolder: payload.bankHolder
    }));
    return data || { ok: false, reason: 'NO_RESPONSE' };
}

/** Create supplier (calls upsert-transit then supplier/create). clientId from accessCtx.client.id */
export async function createSupplier(payload) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/contact/supplier/create', {
        name: payload.name,
        email: payload.email,
        billerCode: payload.billerCode,
        bankName: payload.bankName,
        bankAccount: payload.bankAccount,
        bankHolder: payload.bankHolder
    }));
    return data || { ok: false, reason: 'NO_RESPONSE' };
}

/** Update supplier. bankName = bankdetail_id. contactId (or bukkuId) written to supplierdetail.account for current client's account system (sql/autocount/bukku/xero). */
export async function updateSupplier(supplierId, payload) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/contact/supplier/update', {
        supplierId,
        name: payload.name,
        email: payload.email,
        billerCode: payload.billerCode,
        bankName: payload.bankName,
        bankAccount: payload.bankAccount,
        bankHolder: payload.bankHolder,
        contactId: payload.contactId,
        bukkuId: payload.bukkuId
    }));
    return data || { ok: false, reason: 'NO_RESPONSE' };
}

// ---------- Approval ----------
export async function submitOwnerApproval(ownerEmail) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/contact/submit-owner-approval', { ownerEmail: ownerEmail || undefined }));
    return data || { ok: false, reason: 'NO_RESPONSE' };
}

export async function submitTenantApproval(tenantEmail) {
    const data = /** @type {{ ok?: boolean, reason?: string } | null } */ (await postJson('/api/contact/submit-tenant-approval', { tenantEmail: tenantEmail || undefined }));
    return data || { ok: false, reason: 'NO_RESPONSE' };
}
