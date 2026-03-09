/* ======================================================
   backend/saas/expenses.jsw — 统一入口，全部走 ECS Node
   - getExpenses / getExpensesFilters / insert / delete / update / bulkMarkPaid / getBulkTemplateData → ECS
   凭证：ecs_token、ecs_username、ecs_base_url（与 manage/billing 相同）
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
        if (email == null || typeof email !== 'string' || !String(email).trim()) {
            return null;
        }
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
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        if (e && e.name === 'AbortError') return null;
        return null;
    }
}

/** 列表：返回 { items, totalPages, currentPage, total }；opts.limit 可选，用于前端缓存（最多 2000） */
export async function getExpenses(opts = {}) {
    const data = /** @type {{ items?: any[], totalPages?: number, currentPage?: number, total?: number } | null} */ (await postEcs('/api/expenses/list', {
        property: opts.property,
        type: opts.type,
        from: opts.from,
        to: opts.to,
        search: opts.search,
        sort: opts.sort,
        page: opts.page,
        pageSize: opts.pageSize,
        limit: opts.limit
    }));
    if (data && Array.isArray(data.items)) return data;
    return { items: [], totalPages: 1, currentPage: 1, total: 0, _error: data === null ? 'NO_RESPONSE' : undefined };
}

/** 筛选项与 bulk 用到的 property/supplier 列表：返回 { properties, types, suppliers }；若请求失败则带 _error */
export async function getExpensesFilters() {
    const data = /** @type {{ properties?: any[], types?: any[], suppliers?: any[] } | null} */ (await postEcs('/api/expenses/filters', {}));
    if (data && Array.isArray(data.properties)) return data;
    return { properties: [], types: [], suppliers: [], _error: data === null ? 'NO_RESPONSE' : undefined };
}

/** 当前筛选条件下的 id 列表（最多 5000），用于「全选」一次请求 */
export async function getExpensesIds(opts = {}) {
    const data = /** @type {{ ids?: string[] } | null} */ (await postEcs('/api/expenses/ids', {
        property: opts.property,
        type: opts.type,
        from: opts.from,
        to: opts.to,
        search: opts.search,
        sort: opts.sort
    }));
    if (data && Array.isArray(data.ids)) return data;
    return { ids: [] };
}

/** 已选 id 的笔数与金额合计，用于底部 Selected/Total 一行请求 */
export async function getExpensesSelectedTotal(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return { count: 0, totalAmount: 0 };
    const data = /** @type {{ count?: number, totalAmount?: number } | null} */ (await postEcs('/api/expenses/selected-total', { ids }));
    if (data && typeof data.count === 'number') return data;
    return { count: 0, totalAmount: 0 };
}

/** 新建：Body { records }，返回 { inserted, ids } */
export async function insertExpenses(records) {
    const data = await postEcs('/api/expenses/insert', { records });
    if (data == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}

/** 删除：Body { ids }，返回 { deleted } */
export async function deleteExpenses(ids) {
    const data = await postEcs('/api/expenses/delete', { ids });
    if (data == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}

/** 单个更新（含标记已付）：Body { id, paid?, paidat?, paymentmethod? }，返回 { updated } */
export async function updateExpense(id, data) {
    const res = await postEcs('/api/expenses/update', {
        id,
        paid: data.paid,
        paidat: data.paidat,
        paymentmethod: data.paymentmethod
    });
    if (res == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return res;
}

/** 批量标记已付：Body { ids, paidAt, paymentMethod }，返回 { updated } */
export async function bulkMarkPaid(ids, date, method) {
    const data = await postEcs('/api/expenses/bulk-mark-paid', {
        ids,
        paidAt: date,
        paymentMethod: method
    });
    if (data == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}

/** 下载模板用：返回 { success, columns, headers } */
export async function getBulkTemplateData() {
    const data = await postEcs('/api/expenses/bulk-template', {});
    if (data == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}

/** Node 直接生成 Excel，返回 { filename, data: base64 }，前端解码后触发下载，无需 #htmldownloadtemplate */
export async function getBulkTemplateFile() {
    const data = /** @type {{ filename?: string, data?: string } | null} */ (await postEcs('/api/expenses/bulk-template-file', {}));
    if (data == null || !data.filename) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}

/** Node 返回模板下载链接，前端 wixLocation.to(downloadUrl) 即可，无需 Blob/document */
export async function getBulkTemplateDownloadUrl() {
    const data = /** @type {{ downloadUrl?: string } | null} */ (await postEcs('/api/expenses/download-template-url', {}));
    if (data == null || !data.downloadUrl) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}

/** 银行列表或付款数据：不传 bank 返回 { banks }；传 bank+type+ids 返回 { success, billerPayments, bulkTransfers, accountNumber } */
export async function getBankBulkTransferData(params = {}) {
    /** @type {{ bank?: string, type?: string, ids?: string[], email?: string } } */
    const body = { ...params };
    if (params.bank) {
        const email = await getEmail();
        if (email == null || typeof email !== 'string' || !String(email).trim()) {
            return { ok: false, reason: 'NO_EMAIL' };
        }
        body.email = String(email).trim();
    }
    const { token, username, baseUrl } = await getEcsCreds();
    if (!baseUrl || !token || !username) return { ok: false, reason: BACKEND_ERROR_REASON };
    try {
        const res = await fetchWithTimeout(
            `${baseUrl}/api/bank-bulk-transfer`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-API-Username': username
                },
                body: JSON.stringify(body)
            },
            FETCH_TIMEOUT_MS
        );
        if (!res.ok) return { ok: false, reason: BACKEND_ERROR_REASON };
        const data = await res.json();
        return data;
    } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, reason: 'TIMEOUT' };
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}

/** Node 直接生成银行 Excel，返回 { files: [ { filename, data: base64 }, ... ] }，前端逐一下载，无需 #htmlbank */
export async function getBankBulkTransferFiles(params = {}) {
    const data = await postEcs('/api/bank-bulk-transfer/files', {
        bank: params.bank,
        type: params.type,
        ids: params.ids,
        fileIndex: params.fileIndex
    });
    if (data == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return data;
}

/** Node 返回银行文件下载链接（单次最多 500 条；>99 时后端拆成多文件打成一个 zip），返回 { urls: [ { filename, url }, ... ] }，前端 wixLocation.to(url) */
export async function getBankBulkTransferDownloadUrls(params = {}) {
    const data = /** @type {{ urls?: { filename: string; url: string }[] } | null} */ (await postEcs('/api/bank-bulk-transfer/download-url', {
        bank: params.bank,
        type: params.type,
        ids: params.ids,
        fileIndex: params.fileIndex
    }));
    if (data == null) return Promise.reject(new Error(BACKEND_ERROR_REASON));
    return { urls: Array.isArray(data.urls) ? data.urls : [] };
}
