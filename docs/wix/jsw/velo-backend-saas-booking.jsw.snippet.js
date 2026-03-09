/* ======================================================
   Booking – backend/saas/booking.jsw
   所有 Booking 请求 ECS Node，不读 Wix CMS。
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

// ---------- Admin ----------
export async function getAdminRules() {
    const email = await getCurrentEmail();
    return postJson('/api/booking/admin-rules', { email });
}

// ---------- Rooms ----------
export async function getAvailableRooms(keyword) {
    const email = await getCurrentEmail();
    return postJson('/api/booking/available-rooms', { email, keyword: keyword || '' });
}

// ---------- Tenants ----------
export async function searchTenants(keyword) {
    const email = await getCurrentEmail();
    return postJson('/api/booking/search-tenants', { email, keyword: keyword || '' });
}

export async function getTenant(tenantId) {
    const email = await getCurrentEmail();
    return postJson('/api/booking/tenant', { email, tenantId });
}

// ---------- Room ----------
export async function getRoom(roomId) {
    const email = await getCurrentEmail();
    return postJson('/api/booking/room', { email, roomId });
}

// ---------- Parking ----------
export async function getParkingLotsByProperty(propertyId) {
    const email = await getCurrentEmail();
    return postJson('/api/booking/parking-by-property', { email, propertyId });
}

// ---------- Create ----------
export async function createBooking(payload) {
    const email = await getCurrentEmail();
    return postJson('/api/booking/create', { email, ...payload });
}

// ---------- Generate rental from tenancy ----------
export async function generateFromTenancy(tenancyId) {
    const email = await getCurrentEmail();
    return postJson('/api/booking/generate-rental', { email, tenancyId });
}
