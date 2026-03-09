/* ======================================================
   backend/saas/tenancysetting.jsw — 租户管理页统一走 ECS Node
   - getTenancyList / getTenancyFilters / extend / change / terminate / cancelBooking / agreement
   - Topup 仍用 backend/saas/topup（getMyBillingInfo, getCreditPlans, startNormalTopup）
   凭证：ecs_token、ecs_username、ecs_base_url（与 manage/expenses 相同）
====================================================== */

import wixUsersBackend from 'wix-users-backend';
import wixSecretsBackend from 'wix-secrets-backend';

const BACKEND_ERROR_REASON = 'BACKEND_ERROR';
const FETCH_TIMEOUT_MS = 15000;

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

async function postEcs(path, body) {
    try {
        const email = await getEmail();
        if (email == null || typeof email !== 'string' || !String(email).trim()) return null;
        const { token, username, baseUrl } = await getEcsCreds();
        if (!baseUrl || !token || !username) return null;
        const res = await fetchWithTimeout(
            `${baseUrl}${path}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-API-Username': username
                },
                body: JSON.stringify({ email: String(email).trim(), ...body })
            },
            FETCH_TIMEOUT_MS
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            return { _error: 'NO_RESPONSE', _status: res.status, _reason: data?.reason || data?.message || null };
        }
        return /** @type {Object} */ (data);
    } catch (e) {
        if (e && e.name === 'AbortError') return { _error: 'NO_RESPONSE', _reason: 'TIMEOUT' };
        return { _error: 'NO_RESPONSE', _reason: (e && e.message) || null };
    }
}

/** 列表：支持 limit 做前端 cache；返回 { items, total, totalPages, currentPage } */
export async function getTenancyList(opts = {}) {
    const data = /** @type {{ items?: any[], total?: number, totalPages?: number, currentPage?: number } | null } */ (await postEcs('/api/tenancysetting/list', {
        propertyId: opts.propertyId,
        status: opts.status,
        search: opts.search,
        sort: opts.sort,
        page: opts.page,
        pageSize: opts.pageSize,
        limit: opts.limit
    }));
    if (data && Array.isArray(data.items)) return data;
    const err = (data && data._error) ? data._error : (data === null ? 'NO_RESPONSE' : undefined);
    return { items: [], total: 0, totalPages: 1, currentPage: 1, _error: err, _reason: data && data._reason };
}

/** 筛选项：properties + statusOptions */
export async function getTenancyFilters() {
    const data = /** @type {{ properties?: Array<{ label: string, value: string }>, statusOptions?: Array<{ label: string, value: string }> } | null } */ (await postEcs('/api/tenancysetting/filters', {}));
    if (data && Array.isArray(data.properties)) return data;
    const err = (data && data._error) ? data._error : (data === null ? 'NO_RESPONSE' : undefined);
    return { properties: [], statusOptions: [], _error: err, _reason: data && data._reason };
}

/** 可选房间（换房下拉） */
export async function getRoomsForChange(currentRoomId) {
    const data = /** @type {Array<{ _id: string, shortname?: string }> | null } */ (await postEcs('/api/tenancysetting/rooms-for-change', { currentRoomId }));
    return Array.isArray(data) ? data : [];
}

/** 换房预览金额 */
export async function previewChangeRoomProrate(opts) {
    const data = /** @type {{ prorate?: number } | null } */ (await postEcs('/api/tenancysetting/change-preview', {
        oldRental: opts.oldRental,
        newRental: opts.newRental,
        changeDate: opts.changeDate
    }));
    if (data && typeof data.prorate === 'number') return data;
    return { prorate: 0 };
}

/** 延租选项：paymentCycle（client 缴费周期）、maxExtensionEnd（同房有下一笔 booking 时最多延到该日 YYYY-MM-DD）。供 #datepickerextension 上限与建议。 */
export async function getExtendOptions(tenancyId) {
    const data = /** @type {{ paymentCycle?: { type: string, value: number }, maxExtensionEnd?: string | null } | null */ (await postEcs('/api/tenancysetting/extend-options', { tenancyId }));
    if (data == null) return { paymentCycle: { type: 'first', value: 1 }, maxExtensionEnd: null };
    return {
        paymentCycle: data.paymentCycle || { type: 'first', value: 1 },
        maxExtensionEnd: data.maxExtensionEnd ?? null
    };
}

/** 延期 */
export async function extendTenancy(tenancyId, payload) {
    const data = /** @type {object | null } */ (await postEcs('/api/tenancysetting/extend', {
        tenancyId,
        newEnd: payload.newEnd,
        newRental: payload.newRental,
        agreementFees: payload.agreementFees,
        newDeposit: payload.newDeposit
    }));
    if (data == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}

/** 换房 */
export async function changeRoom(tenancyId, payload) {
    const data = /** @type {object | null } */ (await postEcs('/api/tenancysetting/change', {
        tenancyId,
        newRoomId: payload.newRoomId,
        newRental: payload.newRental,
        newEnd: payload.newEnd,
        agreementFees: payload.agreementFees,
        changeDate: payload.changeDate,
        newDeposit: payload.newDeposit
    }));
    if (data == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}

/** 终止 */
export async function terminateTenancy(tenancyId, forfeitAmount) {
    const data = /** @type {object | null } */ (await postEcs('/api/tenancysetting/terminate', { tenancyId, forfeitAmount }));
    if (data == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}

/** 取消预约（删 tenancy + 清 approval） */
export async function cancelBooking(tenancyId) {
    const data = /** @type {object | null } */ (await postEcs('/api/tenancysetting/cancel-booking', { tenancyId }));
    if (data == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}

/** 协议模板列表（按 mode） */
export async function getAgreementTemplates(mode) {
    const data = /** @type {Array<{ _id: string, title?: string }> | null } */ (await postEcs('/api/tenancysetting/agreement-templates', { mode }));
    return Array.isArray(data) ? data : [];
}

/** 新增协议（manual url 或 system template）；续约协议可传 extendBegin、extendEnd、remark） */
export async function insertAgreement(payload) {
    const data = /** @type {object | null } */ (await postEcs('/api/tenancysetting/agreement-insert', {
        tenancyId: payload.tenancyId,
        propertyId: payload.propertyId,
        ownerName: payload.ownerName,
        mode: payload.mode,
        type: payload.type,
        url: payload.url,
        templateId: payload.templateId,
        status: payload.status,
        createdBy: payload.createdBy,
        extendBegin: payload.extendBegin,
        extendEnd: payload.extendEnd,
        remark: payload.remark
    }));
    if (data == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}
