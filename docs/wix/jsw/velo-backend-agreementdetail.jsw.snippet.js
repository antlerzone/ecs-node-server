/* ======================================================
   backend/access/agreementdetail.jsw
   调用 Node 后端 /api/agreement/*；凭证与 base URL 从 Secret Manager 读取（与 billing 相同）。
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

async function fetchAgreement(path, body) {
    try {
        const email = await getEmail();
        if (email == null || typeof email !== 'string' || !String(email).trim()) {
            return { ok: false, reason: 'NO_EMAIL' };
        }
        const { token, username, baseUrl } = await getEcsCreds();
        if (!baseUrl || !token || !username) {
            return { ok: false, reason: BACKEND_ERROR_REASON };
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
                body: JSON.stringify({ email: String(email).trim(), ...body })
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

export async function getTenantAgreementContext(tenancyId, agreementTemplateId, staffVars = {}) {
    return fetchAgreement('/api/agreement/tenant-context', {
        tenancyId,
        agreementTemplateId,
        staffVars
    });
}

export async function getOwnerAgreementContext(ownerId, propertyId, clientId, agreementTemplateId, staffVars = {}) {
    return fetchAgreement('/api/agreement/owner-context', {
        ownerId,
        propertyId,
        clientId,
        agreementTemplateId,
        staffVars
    });
}

export async function getOwnerTenantAgreementContext(tenancyId, agreementTemplateId, staffVars = {}) {
    return fetchAgreement('/api/agreement/owner-tenant-context', {
        tenancyId,
        agreementTemplateId,
        staffVars
    });
}

export async function getOwnerTenantAgreementHtml(tenancyId, agreementTemplateId, staffVars = {}) {
    return fetchAgreement('/api/agreement/owner-tenant-html', {
        tenancyId,
        agreementTemplateId,
        staffVars
    });
}
