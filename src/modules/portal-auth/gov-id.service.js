/**
 * Singpass (FAPI 2.0: PAR + private_key_jwt + PKCE + DPoP) + MyDigital ID (Keycloak-style auth URL + client_secret).
 * Env: docs/portal-gov-id-integration.md, .env.example (GOV_ID_*, MYDIGITAL_*, SINGPASS_*).
 *
 * Singpass staging discovery: https://stg-id.singpass.gov.sg/fapi/.well-known/openid-configuration
 * @see https://docs.developer.singpass.gov.sg/docs/technical-specifications/integration-guide/1.-authorization-request
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const jose = require('jose');
const axios = require('axios');
const pool = require('../../config/db');
const { normalizeEmail, getMemberRoles } = require('../access/access.service');
const { signPortalToken, register, login } = require('./portal-auth.service');

const STATE_SECRET = process.env.GOV_ID_OIDC_STATE_SECRET || process.env.PORTAL_JWT_SECRET || 'portal-jwt-secret-change-in-production';

const SINGPASS_PAR_SESSION_TTL_MS = 15 * 60 * 1000;
/** Opaque state id -> session payload (Singpass PAR only). */
const singpassParSessions = new Map();

function cleanupSingpassParSessions() {
  const now = Date.now();
  for (const [k, v] of singpassParSessions.entries()) {
    if (now - v.createdAt > SINGPASS_PAR_SESSION_TTL_MS) singpassParSessions.delete(k);
  }
}
setInterval(cleanupSingpassParSessions, 5 * 60 * 1000).unref();

const GOV_EMAIL_PENDING_TTL_MS = 15 * 60 * 1000;
/** pendingId -> { provider, userinfo, frontend, returnPath, createdAt } — Singpass direct 无 email 时补绑 */
const govEmailPendingSessions = new Map();

function cleanupGovEmailPendingSessions() {
  const now = Date.now();
  for (const [k, v] of govEmailPendingSessions.entries()) {
    if (now - v.createdAt > GOV_EMAIL_PENDING_TTL_MS) govEmailPendingSessions.delete(k);
  }
}
setInterval(cleanupGovEmailPendingSessions, 5 * 60 * 1000).unref();

function getApiPublicBase() {
  return String(process.env.PORTAL_AUTH_BASE_URL || process.env.API_PUBLIC_BASE_URL || '').replace(/\/$/, '');
}

function getRedirectUri() {
  const explicit = String(process.env.GOV_ID_OIDC_REDIRECT_URI || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const base = getApiPublicBase();
  if (!base) return '';
  return `${base}/api/portal-auth/gov-id/callback`;
}

function signState(payload) {
  return jwt.sign(payload, STATE_SECRET, { expiresIn: '15m' });
}

function verifyState(token) {
  try {
    return jwt.verify(String(token || '').trim(), STATE_SECRET);
  } catch {
    return null;
  }
}

function parseAllowedFrontendHosts() {
  return String(
    process.env.PORTAL_AUTH_ALLOWED_FRONTEND_HOSTS ||
      'portal.colivingjb.com,portal.cleanlemons.com,localhost,127.0.0.1'
  )
    .split(',')
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean);
}

function isTrustedPortalFrontend(candidate) {
  const c = String(candidate || '').trim();
  if (!c) return false;
  try {
    const p = new URL(c);
    if (!['http:', 'https:'].includes(String(p.protocol).toLowerCase())) return false;
    return parseAllowedFrontendHosts().includes(String(p.hostname || '').toLowerCase());
  } catch {
    return false;
  }
}

function normalizeGovReturnPath(p) {
  const s = String(p == null ? '/demologin' : p).trim() || '/demologin';
  if (!s.startsWith('/') || s.startsWith('//')) return '/demologin';
  if (s.toLowerCase().includes('://')) return '/demologin';
  if (s.length > 2048) return '/demologin';
  return s;
}

/**
 * OAuth error on `/gov-id/callback` (e.g. access_denied): redirect back to the portal path that started Gov ID,
 * using Singpass PAR session or MyDigital signed state when `state` is present.
 */
function buildGovIdCallbackErrorRedirect({ query, frontendFallback, reason }) {
  const stateStr = String(query?.state || '').trim();
  const reasonStr = String(
    reason != null && String(reason).trim() !== '' ? reason : query?.error || 'CALLBACK_FAILED'
  ).trim();
  let frontend = '';
  let returnPath = '/demologin';

  if (stateStr) {
    const par = singpassParSessions.get(stateStr);
    if (par && typeof par === 'object') {
      frontend = String(par.frontend || '').replace(/\/$/, '');
      returnPath = normalizeGovReturnPath(par.returnPath);
      singpassParSessions.delete(stateStr);
    } else {
      const st = verifyState(stateStr);
      if (st && typeof st === 'object' && st.frontend) {
        frontend = String(st.frontend || '').replace(/\/$/, '');
        returnPath = normalizeGovReturnPath(st.returnPath);
      }
    }
  }

  const fb = String(frontendFallback || '').trim().replace(/\/$/, '');
  if (!frontend || !isTrustedPortalFrontend(frontend)) {
    frontend = fb && isTrustedPortalFrontend(fb) ? fb : '';
  }
  if (!frontend) {
    const envFe = String(process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
    frontend = envFe && isTrustedPortalFrontend(envFe) ? envFe : '';
  }
  if (!frontend) {
    const hosts = parseAllowedFrontendHosts();
    const h = hosts.find((x) => x && x !== 'localhost' && x !== '127.0.0.1');
    frontend = h ? `https://${h}` : 'https://portal.colivingjb.com';
  }

  const path = normalizeGovReturnPath(returnPath);
  const q = new URLSearchParams({ gov: 'error', reason: reasonStr });
  const sep = path.includes('?') ? '&' : '?';
  return `${frontend}${path}${sep}${q.toString()}`;
}

function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function sha256Base64Url(input) {
  return base64url(crypto.createHash('sha256').update(input, 'utf8').digest());
}

function loadSingpassSigningPrivateKey() {
  const pemInline = String(process.env.SINGPASS_OIDC_PRIVATE_KEY || '').trim();
  if (pemInline.includes('BEGIN')) {
    return crypto.createPrivateKey({ key: pemInline, format: 'pem' });
  }
  const path = String(process.env.SINGPASS_OIDC_PRIVATE_KEY_PATH || '').trim();
  if (!path) throw new Error('SINGPASS_OIDC_PRIVATE_KEY_PATH_NOT_SET');
  const pem = fs.readFileSync(path, 'utf8');
  return crypto.createPrivateKey({ key: pem, format: 'pem' });
}

function getSingpassSigningKid() {
  return String(process.env.SINGPASS_OIDC_SIGNING_KID || 'coliving-rp-staging-sig-1').trim();
}

/** Singpass Login: parse encrypted `id_token` only. Myinfo (v5): call `/userinfo` after token exchange. */
function getSingpassOidcFlow() {
  const raw = String(process.env.SINGPASS_OIDC_FLOW || 'login').trim().toLowerCase();
  return raw === 'myinfo' ? 'myinfo' : 'login';
}

/**
 * Private key for the **`use: enc`** JWK registered in Singpass (ECDH-ES+A256KW).
 * Must NOT be the signing key — Singpass JWKS requires separate sig + enc keys.
 * @see https://docs.developer.singpass.gov.sg/docs/technical-specifications/technical-concepts/json-web-key-sets-jwks.md
 */
function loadSingpassDecryptionPrivateKey() {
  const pemInline = String(process.env.SINGPASS_OIDC_DECRYPTION_PRIVATE_KEY || '').trim();
  if (pemInline.includes('BEGIN')) {
    return crypto.createPrivateKey({ key: pemInline, format: 'pem' });
  }
  const path = String(process.env.SINGPASS_OIDC_DECRYPTION_PRIVATE_KEY_PATH || '').trim();
  if (path) {
    const pem = fs.readFileSync(path, 'utf8');
    return crypto.createPrivateKey({ key: pem, format: 'pem' });
  }
  const err = new Error(
    'SINGPASS_OIDC_DECRYPTION_PRIVATE_KEY_REQUIRED: Set SINGPASS_OIDC_DECRYPTION_PRIVATE_KEY or SINGPASS_OIDC_DECRYPTION_PRIVATE_KEY_PATH to the EC P-256 private key that pairs with your JWKS key where use is "enc" (encryption). The signing key cannot decrypt id_token.'
  );
  err.code = 'SINGPASS_OIDC_DECRYPTION_PRIVATE_KEY_REQUIRED';
  throw err;
}

function decodeJweProtectedHeader(compactJwe) {
  try {
    const p1 = String(compactJwe || '').split('.')[0];
    if (!p1) return null;
    const json = JSON.parse(Buffer.from(p1, 'base64url').toString('utf8'));
    return typeof json === 'object' && json ? json : null;
  } catch {
    return null;
  }
}

/**
 * Decrypt + verify Singpass `id_token` (JWE → JWS), map to a userinfo-like object for linking helpers.
 * @see https://docs.developer.singpass.gov.sg/docs/technical-specifications/integration-guide/4.-parsing-the-id-token
 */
async function parseSingpassIdToken(idTokenCompact, expectedNonce) {
  const idt = String(idTokenCompact || '').trim();
  if (!idt) {
    const err = new Error('NO_ID_TOKEN');
    err.code = 'NO_ID_TOKEN';
    throw err;
  }
  const d = await getDiscovery('singpass');
  const issuer = String(d.issuer || '').replace(/\/$/, '');
  const jwksUrl = String(d.jwks_uri || '').trim();
  if (!jwksUrl) {
    const err = new Error('SINGPASS_JWKS_URI_MISSING');
    err.code = 'SINGPASS_JWKS_URI_MISSING';
    throw err;
  }
  const { client_id } = getClientCreds('singpass');
  const jweHdr = decodeJweProtectedHeader(idt);
  const decKey = loadSingpassDecryptionPrivateKey();
  let signedJwt;
  try {
    const { plaintext } = await jose.compactDecrypt(idt, decKey, {
      keyManagementAlgorithms: ['ECDH-ES+A256KW', 'ECDH-ES+A192KW', 'ECDH-ES+A128KW'],
      contentEncryptionAlgorithms: ['A256CBC-HS512'],
    });
    signedJwt = new TextDecoder().decode(plaintext);
  } catch (e) {
    console.error('[gov-id] id_token JWE decrypt failed', {
      jweKid: jweHdr?.kid,
      jweAlg: jweHdr?.alg,
      jweEnc: jweHdr?.enc,
      keyType: decKey?.asymmetricKeyType,
      message: e?.message || e,
    });
    const hint =
      'Ensure SINGPASS_OIDC_DECRYPTION_PRIVATE_KEY_PATH is the EC private key for the JWKS "enc" key (kid in logs). It is not the PAR/token signing key.';
    const err = new Error(`ID_TOKEN_DECRYPT_FAILED:${e?.message || e}. ${hint}`);
    err.code = 'ID_TOKEN_DECRYPT_FAILED';
    throw err;
  }
  const JWKS = jose.createRemoteJWKSet(new URL(jwksUrl));
  let payload;
  try {
    ({ payload } = await jose.jwtVerify(signedJwt, JWKS, {
      issuer,
      audience: client_id,
    }));
  } catch (e) {
    const err = new Error(`ID_TOKEN_VERIFY_FAILED:${e?.message || e}`);
    err.code = 'ID_TOKEN_VERIFY_FAILED';
    throw err;
  }
  const nonce = String(payload.nonce || '').trim();
  if (!expectedNonce || nonce !== String(expectedNonce).trim()) {
    const err = new Error('ID_TOKEN_NONCE_MISMATCH');
    err.code = 'ID_TOKEN_NONCE_MISMATCH';
    throw err;
  }
  return payload;
}

/** Singpass `sub_attributes` values may be plain strings or `{ value }` (MyInfo-style). */
function pickSingpassSubAttrString(sa, key) {
  if (!sa || typeof sa !== 'object') return '';
  const v = sa[key];
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object' && typeof v.value === 'string') return v.value.trim();
  return '';
}

/** Map verified id_token claims to the shape used by pickSingpass* / linkUserinfoToAccount. */
function singpassIdTokenPayloadToUserinfoShape(payload) {
  const sa = payload && typeof payload.sub_attributes === 'object' ? payload.sub_attributes : {};
  const idNum = pickSingpassSubAttrString(sa, 'identity_number');
  const emailRaw = pickSingpassSubAttrString(sa, 'email');
  const nameRaw = pickSingpassSubAttrString(sa, 'name') || (typeof sa.name === 'string' ? sa.name.trim() : '');
  return {
    sub: String(payload.sub || '').trim(),
    email: emailRaw,
    ...(nameRaw ? { name: nameRaw } : {}),
    uinfin: idNum || undefined,
  };
}

/** MyInfo userinfo: email may be string or { value }. */
function pickSingpassVerifiedEmail(userinfo) {
  if (!userinfo || typeof userinfo !== 'object') return '';
  const raw = userinfo.email;
  if (typeof raw === 'string') return normalizeEmail(raw);
  if (raw && typeof raw === 'object' && typeof raw.value === 'string') return normalizeEmail(raw.value);
  // Some Singpass/MyInfo payloads nest email under sub_attributes.email
  const sa = userinfo.sub_attributes;
  if (sa && typeof sa === 'object') {
    const saEmail = sa.email;
    if (typeof saEmail === 'string') return normalizeEmail(saEmail);
    if (saEmail && typeof saEmail === 'object' && typeof saEmail.value === 'string') {
      return normalizeEmail(saEmail.value);
    }
  }
  return '';
}

function pickSingpassDisplayName(userinfo) {
  if (!userinfo || typeof userinfo !== 'object') return null;
  const n = userinfo.name;
  if (typeof n === 'string') {
    const t = n.trim();
    return t || null;
  }
  if (n && typeof n === 'object' && typeof n.value === 'string') {
    const t = n.value.trim();
    return t || null;
  }
  return null;
}

/**
 * Client assertion JWT (PAR + token endpoint).
 * @see https://docs.developer.singpass.gov.sg/docs/technical-specifications/technical-concepts/generation-of-client-assertion
 */
function signClientAssertion(signingKey, clientId, audIssuer) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 110;
  const jti = crypto.randomUUID();
  const payload = { iss: clientId, sub: clientId, aud: audIssuer, iat: now, exp, jti };
  return jwt.sign(payload, signingKey, {
    algorithm: 'ES256',
    header: { typ: 'JWT', alg: 'ES256', kid: getSingpassSigningKid() },
  });
}

function createDpopProof(dpopPrivateKey, { htm, htu, ath }) {
  const pub = crypto.createPublicKey(dpopPrivateKey);
  const jwk = pub.export({ format: 'jwk' });
  delete jwk.d;
  delete jwk.dp;
  delete jwk.dq;
  delete jwk.p;
  delete jwk.q;
  delete jwk.qi;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 110;
  const payload = {
    jti: crypto.randomUUID(),
    htm,
    htu,
    iat: now,
    exp,
    ...(ath ? { ath } : {}),
  };
  return jwt.sign(payload, dpopPrivateKey, {
    algorithm: 'ES256',
    header: { typ: 'dpop+jwt', alg: 'ES256', jwk },
  });
}

let discoveryCache = { mydigital: null, singpass: null, at: 0 };
const DISCOVERY_TTL_MS = 3600_000;

async function discoverIssuer(issuer) {
  const i = String(issuer || '').trim().replace(/\/$/, '');
  if (!i) throw new Error('MISSING_ISSUER');
  const { data } = await axios.get(`${i}/.well-known/openid-configuration`, { timeout: 20000 });
  return {
    authorization_endpoint: data.authorization_endpoint,
    token_endpoint: data.token_endpoint,
    userinfo_endpoint: data.userinfo_endpoint,
    pushed_authorization_request_endpoint: data.pushed_authorization_request_endpoint,
    issuer: data.issuer,
    jwks_uri: data.jwks_uri,
  };
}

async function getDiscovery(provider) {
  const now = Date.now();
  const cacheKey = provider;
  if (discoveryCache[cacheKey] && now - discoveryCache.at < DISCOVERY_TTL_MS) {
    return discoveryCache[cacheKey];
  }
  const issuer =
    provider === 'mydigital'
      ? String(process.env.MYDIGITAL_OIDC_ISSUER || '').trim()
      : String(process.env.SINGPASS_OIDC_ISSUER || '').trim();
  if (!issuer) throw new Error(provider === 'mydigital' ? 'MYDIGITAL_OIDC_ISSUER_NOT_SET' : 'SINGPASS_OIDC_ISSUER_NOT_SET');
  const d = await discoverIssuer(issuer);
  discoveryCache[cacheKey] = d;
  discoveryCache.at = now;
  return d;
}

function getClientCreds(provider) {
  if (provider === 'mydigital') {
    return {
      client_id: String(process.env.MYDIGITAL_OIDC_CLIENT_ID || '').trim(),
      client_secret: String(process.env.MYDIGITAL_OIDC_CLIENT_SECRET || '').trim(),
    };
  }
  return {
    client_id: String(process.env.SINGPASS_OIDC_CLIENT_ID || '').trim(),
    client_secret: String(process.env.SINGPASS_OIDC_CLIENT_SECRET || '').trim(),
  };
}

function isSingpassSigningConfigured() {
  try {
    const hasInline = String(process.env.SINGPASS_OIDC_PRIVATE_KEY || '').includes('BEGIN');
    const hasPath = !!String(process.env.SINGPASS_OIDC_PRIVATE_KEY_PATH || '').trim();
    if (!hasInline && !hasPath) return false;
    loadSingpassSigningPrivateKey();
    return true;
  } catch {
    return false;
  }
}

function isGovIdConfigured(provider) {
  try {
    const issuer =
      provider === 'mydigital'
        ? String(process.env.MYDIGITAL_OIDC_ISSUER || '').trim()
        : String(process.env.SINGPASS_OIDC_ISSUER || '').trim();
    const { client_id, client_secret } = getClientCreds(provider);
    const redir = getRedirectUri();
    if (provider === 'singpass') {
      return !!(issuer && client_id && redir && isSingpassSigningConfigured());
    }
    return !!(issuer && client_id && client_secret && redir);
  } catch {
    return false;
  }
}

/**
 * Build URL to start OIDC (browser redirect).
 * @param {{ provider: 'mydigital'|'singpass', email: string, frontend: string, returnPath?: string, directSingpass?: boolean }} opts
 */
async function buildAuthorizeUrl(opts) {
  const { provider, email, frontend, returnPath, directSingpass } = opts;
  const redirectUri = getRedirectUri();
  if (!redirectUri) throw new Error('REDIRECT_URI_NOT_CONFIGURED');

  if (provider === 'singpass') {
    return buildSingpassAuthorizeUrl({ email, frontend, returnPath, redirectUri, directSingpass: !!directSingpass });
  }

  const d = await getDiscovery(provider);
  const { client_id } = getClientCreds(provider);
  if (!client_id) throw new Error('CLIENT_ID_NOT_SET');

  const nonce = crypto.randomBytes(16).toString('hex');
  const state = signState({
    v: 1,
    provider,
    email: normalizeEmail(email),
    frontend: String(frontend || '').replace(/\/$/, ''),
    returnPath: returnPath ? String(returnPath) : '/demologin',
    nonce,
  });

  const scope = String(process.env.MYDIGITAL_OIDC_SCOPE || 'openid profile email').trim();

  const params = new URLSearchParams({
    client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    state,
    nonce,
  });
  params.set('prompt', 'login');
  return `${d.authorization_endpoint}?${params.toString()}`;
}

async function buildSingpassAuthorizeUrl({ email, frontend, returnPath, redirectUri, directSingpass }) {
  cleanupSingpassParSessions();
  const d = await getDiscovery('singpass');
  if (!d.pushed_authorization_request_endpoint) {
    throw new Error('SINGPASS_PAR_NOT_IN_DISCOVERY_USE_FAPI_ISSUER');
  }
  const { client_id } = getClientCreds('singpass');
  if (!client_id) throw new Error('CLIENT_ID_NOT_SET');

  if (getSingpassOidcFlow() === 'login') {
    loadSingpassDecryptionPrivateKey();
  }

  if (!directSingpass) {
    const em = normalizeEmail(email);
    if (!em) throw new Error('NO_EMAIL');
  }

  const signingKey = loadSingpassSigningPrivateKey();
  const audIssuer = String(d.issuer || '').replace(/\/$/, '');
  const clientAssertion = signClientAssertion(signingKey, client_id, audIssuer);

  const { privateKey: dpopPrivateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const dpopPrivatePem = dpopPrivateKey.export({ type: 'pkcs8', format: 'pem' });

  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier, 'utf8').digest());

  const stateId = base64url(crypto.randomBytes(24));
  const nonce = crypto.randomUUID();

  const scope = String(
    process.env.SINGPASS_OIDC_SCOPE || 'openid user.identity uinfin name dob mobileno email'
  ).trim();

  singpassParSessions.set(stateId, {
    createdAt: Date.now(),
    email: directSingpass ? null : normalizeEmail(email),
    direct: !!directSingpass,
    frontend: String(frontend || '').replace(/\/$/, ''),
    returnPath: returnPath ? String(returnPath) : '/demologin',
    provider: 'singpass',
    nonce,
    codeVerifier,
    dpopPrivateKeyPem: dpopPrivatePem,
  });

  const parUrl = d.pushed_authorization_request_endpoint;
  const dpopPar = createDpopProof(dpopPrivateKey, { htm: 'POST', htu: parUrl });

  const body = new URLSearchParams({
    response_type: 'code',
    scope,
    state: stateId,
    nonce,
    client_id,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion,
  });

  let requestUri;
  try {
    const { data, status } = await axios.post(parUrl, body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        DPoP: dpopPar,
      },
      timeout: 25000,
      validateStatus: () => true,
    });
    if (status >= 400) {
      const msg = data?.error_description || data?.error || `PAR_HTTP_${status}`;
      throw new Error(`PAR_FAILED:${msg}`);
    }
    requestUri = data?.request_uri;
    if (!requestUri) throw new Error('PAR_NO_REQUEST_URI');
  } catch (e) {
    singpassParSessions.delete(stateId);
    throw e;
  }

  const authParams = new URLSearchParams({
    client_id,
    request_uri: requestUri,
  });
  return `${d.authorization_endpoint}?${authParams.toString()}`;
}

async function exchangeCode(provider, code) {
  const redirectUri = getRedirectUri();
  const d = await getDiscovery(provider);
  const { client_id, client_secret } = getClientCreds(provider);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code || '').trim(),
    redirect_uri: redirectUri,
    client_id,
    client_secret,
  });
  const { data } = await axios.post(d.token_endpoint, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 25000,
  });
  return data;
}

async function exchangeSingpassCode(code, session) {
  const redirectUri = getRedirectUri();
  const d = await getDiscovery('singpass');
  const { client_id } = getClientCreds('singpass');
  const signingKey = loadSingpassSigningPrivateKey();
  const audIssuer = String(d.issuer || '').replace(/\/$/, '');
  const clientAssertion = signClientAssertion(signingKey, client_id, audIssuer);
  const dpopKey = crypto.createPrivateKey({ key: session.dpopPrivateKeyPem, format: 'pem' });
  const dpopProof = createDpopProof(dpopKey, { htm: 'POST', htu: d.token_endpoint });

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code || '').trim(),
    redirect_uri: redirectUri,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion,
    code_verifier: session.codeVerifier,
  });

  const { data, status } = await axios.post(d.token_endpoint, body.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      DPoP: dpopProof,
    },
    timeout: 25000,
    validateStatus: () => true,
  });
  if (status >= 400) {
    const msg = data?.error_description || data?.error || `TOKEN_HTTP_${status}`;
    const err = new Error(msg);
    err.code = 'TOKEN_EXCHANGE_FAILED';
    throw err;
  }
  return data;
}

async function fetchUserinfo(provider, accessToken) {
  const d = await getDiscovery(provider);
  const { data } = await axios.get(d.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 20000,
  });
  return data;
}

async function fetchSingpassUserinfo(accessToken, dpopPrivateKeyPem) {
  const d = await getDiscovery('singpass');
  const userinfoUrl = String(d.userinfo_endpoint || '').trim();
  if (!userinfoUrl) throw new Error('SINGPASS_USERINFO_ENDPOINT_MISSING');
  const dpopKey = crypto.createPrivateKey({ key: dpopPrivateKeyPem, format: 'pem' });
  const ath = sha256Base64Url(accessToken);
  const dpopProof = createDpopProof(dpopKey, { htm: 'GET', htu: userinfoUrl, ath });
  const { data, status } = await axios.get(userinfoUrl, {
    headers: {
      Authorization: `DPoP ${accessToken}`,
      DPoP: dpopProof,
      Accept: 'application/json, application/jwt, text/plain',
    },
    timeout: 20000,
    validateStatus: () => true,
    maxRedirects: 0,
  });
  if (status >= 400) {
    const msg =
      typeof data === 'object' && data
        ? data.error_description || data.error || `USERINFO_HTTP_${status}`
        : `USERINFO_HTTP_${status}`;
    console.error('[gov-id] Singpass userinfo failed', { status, body: data });
    const err = new Error(msg);
    err.code = 'USERINFO_FAILED';
    throw err;
  }
  return data;
}

async function assertSubAvailable(column, sub, email) {
  const normalized = normalizeEmail(email);
  const [rows] = await pool.query(
    `SELECT email FROM portal_account WHERE ${column} = ? AND LOWER(TRIM(email)) <> ? LIMIT 1`,
    [sub, normalized]
  );
  if (rows.length) {
    const err = new Error('SUB_ALREADY_LINKED');
    err.code = 'SUB_ALREADY_LINKED';
    throw err;
  }
}

async function findPortalEmailByGovSub(provider, sub) {
  const subVal = String(sub || '').trim();
  if (!subVal) return '';
  const column = provider === 'singpass' ? 'singpass_sub' : 'mydigital_sub';
  const [rows] = await pool.query(
    `SELECT email FROM portal_account WHERE ${column} = ? LIMIT 1`,
    [subVal]
  );
  const em = rows[0]?.email != null ? String(rows[0].email).trim() : '';
  return normalizeEmail(em);
}

async function ensurePortalAccountForEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };
  const [rows] = await pool.query(
    'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [normalized]
  );
  if (rows.length) return { ok: true, created: false };
  await pool.query(
    'INSERT INTO portal_account (id, email, password_hash) VALUES (?, ?, NULL)',
    [crypto.randomUUID(), normalized]
  );
  return { ok: true, created: true };
}

/**
 * Gov ID 三选一：同一 portal_account 不能同时绑 Singpass 与 MyDigital（及后期 RPV）。
 * RPV 若上线：再在回调里区分 Passport / NRIC；当前 Singpass / MyDigital 由 linkUserinfoToAccount 写死为 NRIC。
 */
async function assertGovIdExclusivityForLink(email, provider) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  const [rows] = await pool.query(
    `SELECT singpass_sub, mydigital_sub FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
    [normalized]
  );
  const r = rows[0];
  if (!r) return;
  const hasS = !!(r.singpass_sub && String(r.singpass_sub).trim());
  const hasM = !!(r.mydigital_sub && String(r.mydigital_sub).trim());
  if (provider === 'singpass' && hasM) {
    const err = new Error('GOV_ID_SWITCH_REQUIRED');
    err.code = 'GOV_ID_SWITCH_REQUIRED';
    throw err;
  }
  if (provider === 'mydigital' && hasS) {
    const err = new Error('GOV_ID_SWITCH_REQUIRED');
    err.code = 'GOV_ID_SWITCH_REQUIRED';
    throw err;
  }
}

/**
 * Apply userinfo to portal_account and set lock.
 */
async function linkUserinfoToAccount(email, provider, userinfo) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('NO_EMAIL');
  const sub = String(userinfo.sub || '').trim();
  if (!sub) throw new Error('NO_SUB');

  await assertGovIdExclusivityForLink(normalized, provider);

  if (provider === 'mydigital') {
    await assertSubAvailable('mydigital_sub', sub, normalized);
    const nric = String(userinfo.nric || userinfo.preferred_username || '').trim() || null;
    const nama = String(userinfo.nama || userinfo.name || userinfo.preferred_username || '').trim() || null;
    await pool.query(
      `UPDATE portal_account SET
        mydigital_sub = ?,
        nric = COALESCE(?, nric),
        fullname = COALESCE(?, fullname),
        id_type = 'NRIC',
        reg_no_type = 'NRIC',
        entity_type = 'MALAYSIAN_INDIVIDUAL',
        gov_identity_locked = 1,
        mydigital_linked_at = NOW(),
        updated_at = NOW()
      WHERE LOWER(TRIM(email)) = ?`,
      [sub, nric, nama, normalized]
    );
  } else if (provider === 'singpass') {
    await assertSubAvailable('singpass_sub', sub, normalized);
    const uin = String(userinfo.uinfin || userinfo.uin || userinfo.sub || '').trim();
    const name = pickSingpassDisplayName(userinfo);
    await pool.query(
      `UPDATE portal_account SET
        singpass_sub = ?,
        nric = ?,
        fullname = COALESCE(?, fullname),
        id_type = 'NRIC',
        reg_no_type = 'NRIC',
        entity_type = 'SINGAPORE_INDIVIDUAL',
        gov_identity_locked = 1,
        singpass_linked_at = NOW(),
        updated_at = NOW()
      WHERE LOWER(TRIM(email)) = ?`,
      [sub, uin || sub, name, normalized]
    );
  } else {
    throw new Error('BAD_PROVIDER');
  }
}

async function handleOAuthCallback({ code, state }) {
  const stateStr = String(state || '').trim();
  const parSession = singpassParSessions.get(stateStr);

  let st;
  if (parSession) {
    st = {
      v: 1,
      provider: 'singpass',
      email: parSession.email,
      direct: !!parSession.direct,
      frontend: parSession.frontend,
      returnPath: parSession.returnPath,
      nonce: parSession.nonce,
      codeVerifier: parSession.codeVerifier,
      dpopPrivateKeyPem: parSession.dpopPrivateKeyPem,
    };
  } else {
    st = verifyState(stateStr);
  }

  if (!st || !st.provider) {
    const err = new Error('BAD_STATE');
    err.code = 'BAD_STATE';
    throw err;
  }
  const singpassPar =
    st.provider === 'singpass' && st.codeVerifier && st.dpopPrivateKeyPem;
  if (!singpassPar && !st.email) {
    const err = new Error('BAD_STATE');
    err.code = 'BAD_STATE';
    throw err;
  }
  if (!code) {
    const err = new Error('NO_CODE');
    err.code = 'NO_CODE';
    throw err;
  }

  let tokens;
  let userinfo;
  let directLogin = null;
  try {
    if (singpassPar) {
      tokens = await exchangeSingpassCode(code, st);
      const flow = getSingpassOidcFlow();
      if (flow === 'myinfo') {
        const access = tokens.access_token;
        if (!access) {
          const err = new Error('NO_ACCESS_TOKEN');
          err.code = 'NO_ACCESS_TOKEN';
          throw err;
        }
        userinfo = await fetchSingpassUserinfo(access, st.dpopPrivateKeyPem);
      } else {
        const idt = tokens.id_token;
        if (!idt) {
          const err = new Error('NO_ID_TOKEN');
          err.code = 'NO_ID_TOKEN';
          throw err;
        }
        const payload = await parseSingpassIdToken(idt, st.nonce);
        userinfo = singpassIdTokenPayloadToUserinfoShape(payload);
      }
    } else {
      tokens = await exchangeCode(st.provider, code);
      const access = tokens.access_token;
      if (!access) {
        const err = new Error('NO_ACCESS_TOKEN');
        err.code = 'NO_ACCESS_TOKEN';
        throw err;
      }
      userinfo = await fetchUserinfo(st.provider, access);
    }

    let linkEmail = st.email;
    if (st.provider === 'singpass' && st.direct) {
      linkEmail = pickSingpassVerifiedEmail(userinfo);
      if (!linkEmail) {
        const linkedEmail = await findPortalEmailByGovSub('singpass', userinfo?.sub);
        if (linkedEmail) {
          linkEmail = linkedEmail;
        } else {
          cleanupGovEmailPendingSessions();
          const pendingId = base64url(crypto.randomBytes(24));
          govEmailPendingSessions.set(pendingId, {
            provider: 'singpass',
            userinfo,
            frontend: st.frontend,
            /** 补邮绑定成功后默认进 portal（与产品主入口一致） */
            returnPath: '/portal',
            createdAt: Date.now(),
          });
          return {
            needEmail: true,
            pendingId,
            frontend: st.frontend,
            returnPath: st.returnPath || '/demologin',
            provider: st.provider,
            directLogin: null,
          };
        }
      }
      const ensured = await ensurePortalAccountForEmail(linkEmail);
      if (!ensured.ok) {
        const err = new Error(ensured.reason || 'ENSURE_PORTAL_ACCOUNT_FAILED');
        err.code = ensured.reason || 'ENSURE_PORTAL_ACCOUNT_FAILED';
        throw err;
      }
    }

    if (st.provider === 'singpass' && st.direct) {
      const [acctRows] = await pool.query(
        'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
        [linkEmail]
      );
      if (!acctRows.length) {
        const err = new Error('NO_PORTAL_ACCOUNT');
        err.code = 'NO_PORTAL_ACCOUNT';
        throw err;
      }
    }

    await linkUserinfoToAccount(linkEmail, st.provider, userinfo);

    if (st.provider === 'singpass' && st.direct) {
      const member = await getMemberRoles(linkEmail);
      const token = signPortalToken({
        email: linkEmail,
        roles: member.roles || [],
        cleanlemons: member.cleanlemons ?? null,
      });
      directLogin = {
        token,
        nextPath: String(st.returnPath || '/demologin').startsWith('/')
          ? st.returnPath
          : '/demologin',
        email: linkEmail,
      };
    }
  } finally {
    if (parSession) singpassParSessions.delete(stateStr);
  }

  return {
    needEmail: false,
    frontend: st.frontend,
    returnPath: st.returnPath || '/demologin',
    provider: st.provider,
    directLogin,
  };
}

async function finalizePendingGovSingpassLink(pend, sessionKey, normalized) {
  try {
    await linkUserinfoToAccount(normalized, 'singpass', pend.userinfo);
  } catch (e) {
    if (e && e.code === 'GOV_ID_SWITCH_REQUIRED') {
      return { ok: false, reason: 'GOV_ID_SWITCH_REQUIRED' };
    }
    if (e && e.code === 'SUB_ALREADY_LINKED') {
      return { ok: false, reason: 'SUB_ALREADY_LINKED' };
    }
    throw e;
  }

  govEmailPendingSessions.delete(sessionKey);

  const member = await getMemberRoles(normalized);
  const token = signPortalToken({
    email: normalized,
    roles: member.roles || [],
    cleanlemons: member.cleanlemons ?? null,
  });
  const rp = pend.returnPath || '/portal';
  const nextPath = String(rp).startsWith('/') ? String(rp) : '/portal';

  return {
    ok: true,
    token,
    email: normalized,
    roles: member.roles || [],
    nextPath,
  };
}

/**
 * POST body: { pendingId, email, password? } + optional Bearer JWT（email 与 JWT 一致时免密）— 完成 Singpass direct 无 IdP email 的补绑。
 * OAuth（Google/Facebook）回调传 trustedIdentityEmail（与 email 同）免密。
 */
async function completePendingGovEmail({ pendingId, email, password, trustedIdentityEmail }) {
  cleanupGovEmailPendingSessions();
  const id = String(pendingId || '').trim();
  const pend = govEmailPendingSessions.get(id);
  if (!pend || Date.now() - pend.createdAt > GOV_EMAIL_PENDING_TTL_MS) {
    return { ok: false, reason: 'PENDING_EXPIRED_OR_INVALID' };
  }
  if (pend.provider !== 'singpass') {
    return { ok: false, reason: 'BAD_PENDING' };
  }

  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };

  const trusted =
    trustedIdentityEmail && normalizeEmail(trustedIdentityEmail) === normalized;

  if (trusted) {
    const [acctRows] = await pool.query(
      'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalized]
    );
    if (!acctRows.length) {
      return { ok: false, reason: 'ACCOUNT_NOT_FOUND' };
    }
    return finalizePendingGovSingpassLink(pend, id, normalized);
  }

  const [acctRows] = await pool.query(
    'SELECT id FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [normalized]
  );
  const hasAcct = acctRows.length > 0;
  const pwd = typeof password === 'string' ? password : '';

  if (hasAcct) {
    if (!pwd.trim()) {
      return { ok: false, reason: 'PASSWORD_REQUIRED' };
    }
    const loginRes = await login(normalized, pwd);
    if (!loginRes.ok) {
      return { ok: false, reason: loginRes.reason === 'INVALID_CREDENTIALS' ? 'INVALID_CREDENTIALS' : loginRes.reason || 'LOGIN_FAILED' };
    }
  } else {
    if (!pwd.trim()) {
      return { ok: false, reason: 'NEED_REGISTER' };
    }
    const regRes = await register(normalized, pwd);
    if (!regRes.ok) {
      if (regRes.reason === 'EMAIL_ALREADY_REGISTERED') {
        return { ok: false, reason: 'PASSWORD_REQUIRED' };
      }
      return { ok: false, reason: regRes.reason || 'REGISTER_FAILED' };
    }
  }

  return finalizePendingGovSingpassLink(pend, id, normalized);
}

/** demologin 补邮：仅查是否存在 portal_account（供前端分流登录/注册）。 */
async function lookupPortalEmailForGovPending(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };
  const [rows] = await pool.query(
    'SELECT 1 AS x FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [normalized]
  );
  return { ok: true, exists: rows.length > 0 };
}

async function disconnectGovId(email, provider) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };
  if (provider !== 'singpass' && provider !== 'mydigital') {
    return { ok: false, reason: 'BAD_PROVIDER' };
  }
  try {
    if (provider === 'mydigital') {
      await pool.query(
        `UPDATE portal_account SET mydigital_sub = NULL, mydigital_linked_at = NULL,
         gov_identity_locked = CASE WHEN singpass_sub IS NULL OR singpass_sub = '' THEN 0 ELSE gov_identity_locked END,
         updated_at = NOW()
         WHERE LOWER(TRIM(email)) = ?`,
        [normalized]
      );
    } else {
      await pool.query(
        `UPDATE portal_account SET singpass_sub = NULL, singpass_linked_at = NULL,
         gov_identity_locked = CASE WHEN mydigital_sub IS NULL OR mydigital_sub = '' THEN 0 ELSE gov_identity_locked END,
         updated_at = NOW()
         WHERE LOWER(TRIM(email)) = ?`,
        [normalized]
      );
    }
    await pool.query(
      `UPDATE portal_account SET gov_identity_locked = CASE
        WHEN (singpass_sub IS NOT NULL AND singpass_sub <> '') OR (mydigital_sub IS NOT NULL AND mydigital_sub <> '') THEN 1 ELSE 0 END
        WHERE LOWER(TRIM(email)) = ?`,
      [normalized]
    );
    return { ok: true };
  } catch (err) {
    console.error('[gov-id] disconnectGovId', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  }
}

async function getGovIdStatus(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'NO_EMAIL' };
  try {
    let rows;
    try {
      [rows] = await pool.query(
        `SELECT singpass_sub, mydigital_sub, gov_identity_locked, COALESCE(aliyun_ekyc_locked,0) AS aliyun_ekyc_locked
         FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
        [normalized]
      );
    } catch (err) {
      if (err && err.code === 'ER_BAD_FIELD_ERROR') {
        [rows] = await pool.query(
          `SELECT singpass_sub, mydigital_sub, gov_identity_locked FROM portal_account WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
          [normalized]
        );
      } else {
        throw err;
      }
    }
    const r = rows[0];
    if (!r) {
      return {
        ok: true,
        singpass: false,
        mydigital: false,
        identityLocked: false,
        aliyunEkycLocked: false,
      };
    }
    const hasS = !!(r.singpass_sub && String(r.singpass_sub).trim());
    const hasM = !!(r.mydigital_sub && String(r.mydigital_sub).trim());
    const aliyunLocked = r.aliyun_ekyc_locked != null ? !!Number(r.aliyun_ekyc_locked) : false;
    return {
      ok: true,
      singpass: hasS,
      mydigital: hasM,
      identityLocked: (!!r.gov_identity_locked && (hasS || hasM)) || aliyunLocked,
      aliyunEkycLocked: aliyunLocked,
    };
  } catch (err) {
    if (err && err.code === 'ER_BAD_FIELD_ERROR') {
      return {
        ok: true,
        singpass: false,
        mydigital: false,
        identityLocked: false,
        aliyunEkycLocked: false,
        _migrationPending: true,
      };
    }
    console.error('[gov-id] getGovIdStatus', err?.message || err);
    return { ok: false, reason: 'DB_ERROR' };
  }
}

module.exports = {
  buildAuthorizeUrl,
  handleOAuthCallback,
  completePendingGovEmail,
  lookupPortalEmailForGovPending,
  disconnectGovId,
  getGovIdStatus,
  isGovIdConfigured,
  getRedirectUri,
  buildGovIdCallbackErrorRedirect,
};
