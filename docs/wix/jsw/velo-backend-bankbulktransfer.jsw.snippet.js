/* ======================================================
   backend/access/bankbulktransfer.jsw
   调用 Node 后端 POST /api/bank-bulk-transfer；凭证与 base URL 从 Secret Manager 读取（与 billing 相同）。
   - 不传 bank：返回 { banks }，无需登录。
   - 传 bank + type + ids：需登录，返回 { success, billerPayments, bulkTransfers, accountNumber } 或 { success: false }。
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

/**
 * @param {{ bank?: string, type?: string, ids?: string[] }} params
 * @returns {Promise<{ banks?: Array<{ label: string, value: string }> } | { success: boolean, billerPayments?: any[], bulkTransfers?: any[], accountNumber?: string } | { ok: false, reason: string }>}
 */
export async function getBankBulkTransferData(params = {}) {
    try {
        const body = { ...params };
        if (params.bank) {
            const email = await getEmail();
            if (email == null || typeof email !== 'string' || !String(email).trim()) {
                return { ok: false, reason: 'NO_EMAIL' };
            }
            body.email = String(email).trim();
        }
        const { token, username, baseUrl } = await getEcsCreds();
        if (!baseUrl || !token || !username) {
            return { ok: false, reason: BACKEND_ERROR_REASON };
        }
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
        let data;
        try {
            data = await res.json();
        } catch (_) {
            return { ok: false, reason: BACKEND_ERROR_REASON };
        }
        return data;
    } catch (e) {
        if (e && e.name === 'AbortError') {
            return { ok: false, reason: 'TIMEOUT' };
        }
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}

/**
 * 获取银行批量转账/ PayBill 文件下载 URL（Node 生成 Excel/zip，不经过 htmlbank iframe）。
 * @param {{ bank: string, type: string, ids: string[] }} params
 * @returns {Promise<{ urls?: Array<{ filename: string, url: string }>, ok?: boolean, reason?: string }>}
 */
export async function getBankBulkTransferDownloadUrl(params) {
    try {
        const body = { ...params };
        const email = await getEmail();
        if (email == null || typeof email !== 'string' || !String(email).trim()) {
            return { ok: false, reason: 'NO_EMAIL' };
        }
        body.email = String(email).trim();
        const { token, username, baseUrl } = await getEcsCreds();
        if (!baseUrl || !token || !username) {
            return { ok: false, reason: BACKEND_ERROR_REASON };
        }
        const res = await fetchWithTimeout(
            `${baseUrl}/api/bank-bulk-transfer/download-url`,
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
        if (e && e.name === 'AbortError') {
            return { ok: false, reason: 'TIMEOUT' };
        }
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}
