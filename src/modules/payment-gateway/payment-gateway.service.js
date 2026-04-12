/**
 * Resolve and manage operator payment gateway credentials/state.
 * Supports legacy Connect/platform flow and new direct-secret flow.
 */

const { createHash, createCipheriv, createDecipheriv, randomUUID } = require('crypto');
const pool = require('../../config/db');

function parseJson(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw || {};
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function getIntegrationSecretSeed() {
  return (
    process.env.CLIENT_INTEGRATION_SECRET ||
    process.env.OPERATOR_INTEGRATION_SECRET ||
    process.env.GOOGLE_DRIVE_OAUTH_TOKEN_SECRET ||
    ''
  ).trim();
}

function deriveIntegrationAesKey() {
  const seed = getIntegrationSecretSeed();
  if (!seed) return null;
  return createHash('sha256').update(seed, 'utf8').digest();
}

function encryptSecret(plain) {
  const key = deriveIntegrationAesKey();
  if (!key) throw new Error('CLIENT_INTEGRATION_SECRET_NOT_SET');
  const iv = Buffer.from(Array.from({ length: 12 }, () => Math.floor(Math.random() * 256)));
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptSecret(encB64) {
  const key = deriveIntegrationAesKey();
  if (!key || !encB64) return '';
  try {
    const buf = Buffer.from(String(encB64), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function last4Of(value) {
  const s = String(value || '').trim();
  return s ? s.slice(-4) : null;
}

function normalizeConnectionStatus(raw, hasConfig = false) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'connected') return 'connected';
  if (v === 'pending_verification') return 'pending_verification';
  return hasConfig ? 'pending_verification' : 'no_connect';
}

function isStripeDirectConfig(values) {
  return !!(
    values?.stripe_connection_status ||
    values?.stripe_secret_key_enc ||
    values?.stripe_webhook_secret_enc ||
    values?.stripe_oauth_access_token_enc ||
    values?.stripe_connect_mode === 'direct_secret' ||
    values?.stripe_connect_mode === 'oauth_webhook'
  );
}

function isPayexDirectConfig(values) {
  return !!(
    values?.xendit_connection_status ||
    values?.xendit_secret_key_enc ||
    values?.xendit_webhook_token_enc ||
    values?.xendit_connect_mode === 'direct_secret'
  );
}

function isBillplzDirectConfig(values) {
  return !!(
    values?.billplz_connection_status ||
    values?.billplz_api_key_enc ||
    values?.billplz_collection_id ||
    values?.billplz_x_signature_key_enc ||
    values?.billplz_connect_mode === 'direct_secret'
  );
}

async function getClientCurrency(clientId) {
  if (!clientId) throw new Error('CLIENT_ID_REQUIRED');
  const [rows] = await pool.query(
    'SELECT currency FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  const raw = rows[0]?.currency;
  if (raw == null || String(raw).trim() === '') throw new Error('CLIENT_CURRENCY_MISSING');
  const c = String(raw).trim().toUpperCase();
  if (c === 'SGD') return 'SGD';
  if (c === 'MYR') return 'MYR';
  throw new Error(`UNSUPPORTED_CLIENT_CURRENCY: ${c}`);
}

async function getPaymentGatewayRows(clientId) {
  const [rows] = await pool.query(
    `SELECT id, provider, enabled, values_json
       FROM client_integration
      WHERE client_id = ? AND \`key\` = 'paymentGateway'`,
    [clientId]
  );
  return rows || [];
}

async function getPaymentGatewayRow(clientId, provider) {
  const [rows] = await pool.query(
    `SELECT id, provider, enabled, values_json
       FROM client_integration
      WHERE client_id = ? AND \`key\` = 'paymentGateway' AND provider = ? LIMIT 1`,
    [clientId, provider]
  );
  return rows[0] || null;
}

async function upsertPaymentGatewayRow(clientId, provider, valuesMerge, enabled = true) {
  const existing = await getPaymentGatewayRow(clientId, provider);
  const prev = existing ? parseJson(existing.values_json) : {};
  const next = { ...prev, ...valuesMerge };
  const valuesStr = JSON.stringify(next);
  if (existing) {
    await pool.query(
      'UPDATE client_integration SET enabled = ?, values_json = ?, updated_at = NOW() WHERE id = ?',
      [enabled ? 1 : 0, valuesStr, existing.id]
    );
    return { id: existing.id, values: next };
  }
  const id = randomUUID();
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  await pool.query(
    `INSERT INTO client_integration (id, client_id, \`key\`, version, slot, enabled, provider, values_json, created_at, updated_at)
     VALUES (?, ?, 'paymentGateway', 1, 0, ?, ?, ?, ?, ?)`,
    [id, clientId, enabled ? 1 : 0, provider, valuesStr, now, now]
  );
  return { id, values: next };
}

async function disableOtherPaymentGatewayProviders(clientId, keepProvider) {
  await pool.query(
    `UPDATE client_integration
        SET enabled = 0, updated_at = NOW()
      WHERE client_id = ? AND \`key\` = 'paymentGateway' AND provider <> ?`,
    [clientId, keepProvider]
  );
}

async function saveStripeDirectConfig(clientId, { secretKey, webhookSecret, webhookUrl, allowPaynowWithGateway, mode } = {}) {
  if (!clientId) throw new Error('CLIENT_ID_REQUIRED');
  const stripeSecretKey = String(secretKey || '').trim();
  const stripeWebhookSecret = String(webhookSecret || '').trim();
  if (!stripeWebhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET_REQUIRED');
  const effectiveMode = mode === 'oauth_webhook' ? 'oauth_webhook' : 'direct_secret';
  if (effectiveMode === 'direct_secret' && !stripeSecretKey) throw new Error('STRIPE_SECRET_KEY_REQUIRED');
  const values = {
    stripe_connect_mode: effectiveMode,
    ...(stripeSecretKey ? {
      stripe_secret_key_enc: encryptSecret(stripeSecretKey),
      stripe_secret_key_last4: last4Of(stripeSecretKey)
    } : {}),
    stripe_webhook_secret_enc: encryptSecret(stripeWebhookSecret),
    stripe_webhook_secret_last4: last4Of(stripeWebhookSecret),
    stripe_webhook_url: webhookUrl ? String(webhookUrl).trim().slice(0, 1000) : undefined,
    stripe_connection_status: 'pending_verification',
    stripe_verification_requested_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    ...(allowPaynowWithGateway === undefined ? {} : { allow_paynow_with_gateway: !!allowPaynowWithGateway })
  };
  await upsertPaymentGatewayRow(clientId, 'stripe', values, true);
  await disableOtherPaymentGatewayProviders(clientId, 'stripe');
  return { ok: true, connectionStatus: 'pending_verification' };
}

async function saveStripeOAuthConnection(clientId, { accountId, accessToken, refreshToken, livemode, scope } = {}) {
  if (!clientId) throw new Error('CLIENT_ID_REQUIRED');
  if (!accountId) throw new Error('STRIPE_ACCOUNT_ID_REQUIRED');
  const values = {
    stripe_connect_mode: 'oauth_webhook',
    stripe_account_id: String(accountId).trim(),
    stripe_connection_status: 'pending_verification',
    stripe_oauth_connected_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    ...(accessToken ? { stripe_oauth_access_token_enc: encryptSecret(String(accessToken).trim()) } : {}),
    ...(refreshToken ? { stripe_oauth_refresh_token_enc: encryptSecret(String(refreshToken).trim()) } : {}),
    ...(livemode === undefined ? {} : { stripe_oauth_livemode: !!livemode }),
    ...(scope ? { stripe_oauth_scope: String(scope).trim().slice(0, 255) } : {})
  };
  await upsertPaymentGatewayRow(clientId, 'stripe', values, true);
  await disableOtherPaymentGatewayProviders(clientId, 'stripe');
  return { ok: true };
}

async function savePayexDirectConfig(clientId, { secretKey, webhookToken, webhookUrl, useTest } = {}) {
  if (!clientId) throw new Error('CLIENT_ID_REQUIRED');
  const xenditSecretKey = String(secretKey || '').trim();
  const xenditWebhookToken = String(webhookToken || '').trim();
  if (!xenditSecretKey) throw new Error('XENDIT_SECRET_KEY_REQUIRED');
  if (!xenditWebhookToken) throw new Error('XENDIT_WEBHOOK_TOKEN_REQUIRED');
  const values = {
    xendit_connect_mode: 'direct_secret',
    xendit_secret_key_enc: encryptSecret(xenditSecretKey),
    xendit_secret_key_last4: last4Of(xenditSecretKey),
    xendit_webhook_token_enc: encryptSecret(xenditWebhookToken),
    xendit_webhook_token_last4: last4Of(xenditWebhookToken),
    xendit_webhook_url: webhookUrl ? String(webhookUrl).trim().slice(0, 1000) : undefined,
    xendit_use_test: useTest === true || useTest === 1,
    xendit_platform_flow_disabled: true,
    xendit_connection_status: 'pending_verification',
    xendit_verification_requested_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
  };
  await upsertPaymentGatewayRow(clientId, 'payex', values, true);
  await disableOtherPaymentGatewayProviders(clientId, 'payex');
  return { ok: true, connectionStatus: 'pending_verification' };
}

async function saveBillplzDirectConfig(clientId, {
  apiKey,
  collectionId,
  xSignatureKey,
  webhookUrl,
  paymentOrderCallbackUrl,
  paymentGatewayCode,
  useSandbox
} = {}) {
  if (!clientId) throw new Error('CLIENT_ID_REQUIRED');
  const billplzApiKey = String(apiKey || '').trim();
  const billplzCollectionId = String(collectionId || '').trim();
  const billplzXSignatureKey = String(xSignatureKey || '').trim();
  if (!billplzApiKey) throw new Error('BILLPLZ_API_KEY_REQUIRED');
  if (!billplzCollectionId) throw new Error('BILLPLZ_COLLECTION_ID_REQUIRED');
  if (!billplzXSignatureKey) throw new Error('BILLPLZ_X_SIGNATURE_KEY_REQUIRED');
  const values = {
    billplz_connect_mode: 'direct_secret',
    billplz_api_key_enc: encryptSecret(billplzApiKey),
    billplz_api_key_last4: last4Of(billplzApiKey),
    billplz_collection_id: billplzCollectionId,
    billplz_x_signature_key_enc: encryptSecret(billplzXSignatureKey),
    billplz_x_signature_key_last4: last4Of(billplzXSignatureKey),
    billplz_webhook_url: webhookUrl ? String(webhookUrl).trim().slice(0, 1000) : undefined,
    billplz_payment_order_callback_url: paymentOrderCallbackUrl ? String(paymentOrderCallbackUrl).trim().slice(0, 1000) : undefined,
    billplz_payment_gateway_code: paymentGatewayCode ? String(paymentGatewayCode).trim().slice(0, 100) : undefined,
    billplz_use_sandbox: useSandbox === true || useSandbox === 1,
    billplz_connection_status: 'pending_verification',
    billplz_verification_requested_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
  };
  await upsertPaymentGatewayRow(clientId, 'billplz', values, true);
  await disableOtherPaymentGatewayProviders(clientId, 'billplz');
  return { ok: true, connectionStatus: 'pending_verification' };
}

async function getStripeDirectCredentials(clientId, opts = {}) {
  const row = await getPaymentGatewayRow(clientId, 'stripe');
  if (!row || Number(row.enabled) !== 1) return null;
  const values = parseJson(row.values_json);
  if (!isStripeDirectConfig(values)) return null;
  const secretKey = decryptSecret(values.stripe_secret_key_enc);
  const webhookSecret = decryptSecret(values.stripe_webhook_secret_enc);
  const oauthAccessToken = decryptSecret(values.stripe_oauth_access_token_enc);
  const oauthRefreshToken = decryptSecret(values.stripe_oauth_refresh_token_enc);
  const hasConfig = !!(
    secretKey ||
    webhookSecret ||
    oauthAccessToken ||
    oauthRefreshToken ||
    values.stripe_account_id
  );
  const connectionStatus = normalizeConnectionStatus(values.stripe_connection_status, hasConfig);
  if (!opts.allowPending && connectionStatus !== 'connected') return null;
  return {
    connectionStatus,
    secretKey,
    webhookSecret,
    accountId: values.stripe_account_id ? String(values.stripe_account_id).trim() : '',
    oauthAccessToken,
    oauthRefreshToken,
    oauthLivemode: values.stripe_oauth_livemode === true || values.stripe_oauth_livemode === 1,
    oauthScope: values.stripe_oauth_scope ? String(values.stripe_oauth_scope).trim() : '',
    lastWebhookAt: values.stripe_last_webhook_at || null,
    lastWebhookType: values.stripe_last_webhook_type || null,
    secretKeyLast4: values.stripe_secret_key_last4 || last4Of(secretKey),
    webhookSecretLast4: values.stripe_webhook_secret_last4 || last4Of(webhookSecret),
    values
  };
}

async function getPayexDirectCredentials(clientId, opts = {}) {
  const row = await getPaymentGatewayRow(clientId, 'payex');
  if (!row || Number(row.enabled) !== 1) return null;
  const values = parseJson(row.values_json);
  if (!isPayexDirectConfig(values)) return null;
  const secretKey = decryptSecret(values.xendit_secret_key_enc)
    || String(values.xendit_live_secret_key || values.xendit_test_secret_key || values.xendit_secret_key || '').trim();
  const webhookToken = decryptSecret(values.xendit_webhook_token_enc);
  const hasConfig = !!(secretKey || webhookToken);
  const connectionStatus = normalizeConnectionStatus(values.xendit_connection_status, hasConfig);
  if (!opts.allowPending && connectionStatus !== 'connected') return null;
  return {
    connectionStatus,
    secretKey,
    webhookToken,
    useTest: values.xendit_use_test === true || values.xendit_use_test === 1,
    lastWebhookAt: values.xendit_last_webhook_at || null,
    lastWebhookType: values.xendit_last_webhook_type || null,
    secretKeyLast4: values.xendit_secret_key_last4 || last4Of(secretKey),
    webhookTokenLast4: values.xendit_webhook_token_last4 || last4Of(webhookToken),
    values
  };
}

async function getBillplzDirectCredentials(clientId, opts = {}) {
  const row = await getPaymentGatewayRow(clientId, 'billplz');
  if (!row || Number(row.enabled) !== 1) return null;
  const values = parseJson(row.values_json);
  if (!isBillplzDirectConfig(values)) return null;
  const apiKey = decryptSecret(values.billplz_api_key_enc);
  const xSignatureKey = decryptSecret(values.billplz_x_signature_key_enc);
  const collectionId = String(values.billplz_collection_id || '').trim();
  const hasConfig = !!(apiKey || xSignatureKey || collectionId);
  const connectionStatus = normalizeConnectionStatus(values.billplz_connection_status, hasConfig);
  if (!opts.allowPending && connectionStatus !== 'connected') return null;
  return {
    connectionStatus,
    apiKey,
    collectionId,
    xSignatureKey,
    useSandbox: values.billplz_use_sandbox === true || values.billplz_use_sandbox === 1,
    paymentGatewayCode: values.billplz_payment_gateway_code ? String(values.billplz_payment_gateway_code).trim() : '',
    lastWebhookAt: values.billplz_last_webhook_at || null,
    lastWebhookType: values.billplz_last_webhook_type || null,
    apiKeyLast4: values.billplz_api_key_last4 || last4Of(apiKey),
    xSignatureKeyLast4: values.billplz_x_signature_key_last4 || last4Of(xSignatureKey),
    values
  };
}

async function getLegacyStripeConnectAccountId(clientId) {
  const [rows] = await pool.query(
    'SELECT stripe_connected_account_id FROM client_profile WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  return String(rows[0]?.stripe_connected_account_id || '').trim();
}

async function getPaymentGatewayDirectStatus(clientId, provider) {
  const currency = await getClientCurrency(clientId);
  const targetProvider = provider || (await getClientPaymentGateway(clientId)).provider;
  if (targetProvider === 'stripe') {
    const legacyAccountId = await getLegacyStripeConnectAccountId(clientId);
    const direct = await getStripeDirectCredentials(clientId, { allowPending: true });
    if (direct) {
      const isOauthWebhook = direct.values?.stripe_connect_mode === 'oauth_webhook';
      const integrationAccountId = String(direct.accountId || '').trim();
      /** OAuth link exists in client_integration (stripe_account_id) and/or legacy client_profile row after account.updated */
      const oauthConnected = Boolean(legacyAccountId || (isOauthWebhook && integrationAccountId));
      const effectiveConnected = direct.connectionStatus === 'connected' && (isOauthWebhook ? oauthConnected : true);
      const effectiveStatus = oauthConnected
        ? direct.connectionStatus
        : (isOauthWebhook ? 'pending_verification' : direct.connectionStatus);
      return {
        provider: 'stripe',
        currency,
        mode: isOauthWebhook ? 'oauth_webhook' : 'direct_secret',
        connectionStatus: effectiveStatus,
        connected: effectiveConnected,
        oauthConnected,
        hasOauthAccessToken: !!direct.oauthAccessToken,
        hasPaymentCredential: !!(direct.secretKey || direct.oauthAccessToken),
        hasSecretKey: !!direct.secretKey,
        hasWebhookSecret: !!direct.webhookSecret,
        secretKeyLast4: direct.secretKeyLast4,
        webhookSecretLast4: direct.webhookSecretLast4,
        webhookUrl: direct.values?.stripe_webhook_url || null,
        lastWebhookAt: direct.lastWebhookAt,
        lastWebhookType: direct.lastWebhookType,
        lastTestRequestedAt: direct.values?.stripe_last_test_requested_at || null,
        lastTestVerifiedAt: direct.values?.stripe_last_test_verified_at || null,
        accountId: direct.accountId || legacyAccountId || null
      };
    }
    return {
      provider: 'stripe',
      currency,
      mode: 'oauth_webhook',
      connectionStatus: legacyAccountId ? 'pending_verification' : 'no_connect',
      connected: false,
      oauthConnected: !!legacyAccountId,
      hasOauthAccessToken: false,
      hasPaymentCredential: false,
      hasSecretKey: false,
      hasWebhookSecret: false,
      secretKeyLast4: null,
      webhookSecretLast4: null,
      lastWebhookAt: null,
      lastWebhookType: null,
      lastTestRequestedAt: null,
      lastTestVerifiedAt: null,
      accountId: legacyAccountId || null
    };
  }
  if (targetProvider === 'payex') {
    const direct = await getPayexDirectCredentials(clientId, { allowPending: true });
    if (direct) {
      return {
        provider: 'payex',
        currency,
        mode: 'direct_secret',
        connectionStatus: direct.connectionStatus,
        connected: direct.connectionStatus === 'connected',
        hasSecretKey: !!direct.secretKey,
        hasWebhookToken: !!direct.webhookToken,
        secretKeyLast4: direct.secretKeyLast4,
        webhookTokenLast4: direct.webhookTokenLast4,
        webhookUrl: direct.values?.xendit_webhook_url || null,
        lastWebhookAt: direct.lastWebhookAt,
        lastWebhookType: direct.lastWebhookType
      };
    }
    const row = await getPaymentGatewayRow(clientId, 'payex');
    const values = row ? parseJson(row.values_json) : {};
    const legacyConnected = !!(
      String(values.xendit_live_secret_key || values.xendit_test_secret_key || values.xendit_secret_key || '').trim()
      || String(values.xendit_sub_account_id || '').trim()
    ) && row && Number(row.enabled) === 1;
    return {
      provider: 'payex',
      currency,
      mode: legacyConnected ? 'legacy' : 'legacy',
      connectionStatus: legacyConnected ? 'connected' : 'no_connect',
      connected: legacyConnected,
      hasSecretKey: false,
      hasWebhookToken: false,
      secretKeyLast4: null,
      webhookTokenLast4: null,
      lastWebhookAt: null,
      lastWebhookType: null
    };
  }
  if (targetProvider === 'billplz') {
    const direct = await getBillplzDirectCredentials(clientId, { allowPending: true });
    if (direct) {
      return {
        provider: 'billplz',
        currency,
        mode: 'direct_secret',
        connectionStatus: direct.connectionStatus,
        connected: direct.connectionStatus === 'connected',
        hasApiKey: !!direct.apiKey,
        hasCollectionId: !!direct.collectionId,
        hasXSignatureKey: !!direct.xSignatureKey,
        apiKeyLast4: direct.apiKeyLast4,
        xSignatureKeyLast4: direct.xSignatureKeyLast4,
        collectionId: direct.collectionId || null,
        paymentGatewayCode: direct.paymentGatewayCode || null,
        webhookUrl: direct.values?.billplz_webhook_url || null,
        paymentOrderCallbackUrl: direct.values?.billplz_payment_order_callback_url || null,
        lastWebhookAt: direct.lastWebhookAt,
        lastWebhookType: direct.lastWebhookType
      };
    }
    return {
      provider: 'billplz',
      currency,
      mode: 'direct_secret',
      connectionStatus: 'no_connect',
      connected: false,
      hasApiKey: false,
      hasCollectionId: false,
      hasXSignatureKey: false,
      apiKeyLast4: null,
      xSignatureKeyLast4: null,
      collectionId: null,
      paymentGatewayCode: null,
      webhookUrl: null,
      paymentOrderCallbackUrl: null,
      lastWebhookAt: null,
      lastWebhookType: null
    };
  }
  return {
    provider: 'paynow',
    currency,
    mode: 'paynow',
    connectionStatus: 'connected',
    connected: true
  };
}

async function markStripeWebhookVerified(clientId, { eventType, accountId } = {}) {
  const row = await getPaymentGatewayRow(clientId, 'stripe');
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  const values = parseJson(row.values_json);
  const next = {
    ...values,
    stripe_connect_mode: values.stripe_connect_mode || 'oauth_webhook',
    stripe_connection_status: 'connected',
    stripe_connected_at: values.stripe_connected_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
    stripe_last_test_verified_at: eventType === 'account.updated'
      ? new Date().toISOString().slice(0, 19).replace('T', ' ')
      : (values.stripe_last_test_verified_at || null),
    stripe_last_webhook_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    stripe_last_webhook_type: eventType ? String(eventType).slice(0, 100) : (values.stripe_last_webhook_type || null),
    ...(accountId ? { stripe_account_id: String(accountId).trim() } : {})
  };
  await pool.query('UPDATE client_integration SET values_json = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(next), row.id]);
  return { ok: true };
}

async function markStripeWebhookTestRequested(clientId) {
  const row = await getPaymentGatewayRow(clientId, 'stripe');
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  const values = parseJson(row.values_json);
  const next = {
    ...values,
    stripe_last_test_requested_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
  };
  await pool.query('UPDATE client_integration SET values_json = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(next), row.id]);
  return { ok: true };
}

async function markPayexWebhookVerified(clientId, { eventType } = {}) {
  const row = await getPaymentGatewayRow(clientId, 'payex');
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  const values = parseJson(row.values_json);
  const next = {
    ...values,
    xendit_connect_mode: values.xendit_connect_mode || 'direct_secret',
    xendit_connection_status: 'connected',
    xendit_connected_at: values.xendit_connected_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
    xendit_last_webhook_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    xendit_last_webhook_type: eventType ? String(eventType).slice(0, 100) : (values.xendit_last_webhook_type || null)
  };
  await pool.query('UPDATE client_integration SET values_json = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(next), row.id]);
  return { ok: true };
}

async function markBillplzWebhookVerified(clientId, { eventType, billId } = {}) {
  const row = await getPaymentGatewayRow(clientId, 'billplz');
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  const values = parseJson(row.values_json);
  const next = {
    ...values,
    billplz_connect_mode: values.billplz_connect_mode || 'direct_secret',
    billplz_connection_status: 'connected',
    billplz_connected_at: values.billplz_connected_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
    billplz_last_webhook_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    billplz_last_webhook_type: eventType ? String(eventType).slice(0, 100) : (values.billplz_last_webhook_type || null),
    ...(billId ? { billplz_last_bill_id: String(billId).trim().slice(0, 100) } : {})
  };
  await pool.query('UPDATE client_integration SET values_json = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(next), row.id]);
  return { ok: true };
}

async function getStripeWebhookCandidateSecrets() {
  const [rows] = await pool.query(
    `SELECT client_id, values_json
       FROM client_integration
      WHERE \`key\` = 'paymentGateway' AND provider = 'stripe' AND enabled = 1`
  );
  return (rows || [])
    .map((row) => {
      const values = parseJson(row.values_json);
      if (!isStripeDirectConfig(values)) return null;
      const webhookSecret = decryptSecret(values.stripe_webhook_secret_enc);
      if (!webhookSecret) return null;
      return {
        clientId: String(row.client_id),
        webhookSecret,
        connectionStatus: normalizeConnectionStatus(values.stripe_connection_status, true)
      };
    })
    .filter(Boolean);
}

async function verifyPayexWebhookToken(clientId, callbackToken) {
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const direct = await getPayexDirectCredentials(clientId, { allowPending: true });
  if (!direct || !direct.webhookToken) return { ok: true, verified: false, legacy: true };
  if (!callbackToken) return { ok: false, reason: 'XENDIT_CALLBACK_TOKEN_REQUIRED' };
  const token = String(callbackToken).trim();
  if (token !== String(direct.webhookToken).trim()) {
    return { ok: false, reason: 'XENDIT_CALLBACK_TOKEN_MISMATCH' };
  }
  return { ok: true, verified: true };
}

async function findPayexClientIdByWebhookToken(callbackToken) {
  const token = String(callbackToken || '').trim();
  if (!token) return null;
  const [rows] = await pool.query(
    `SELECT client_id, values_json
       FROM client_integration
      WHERE \`key\` = 'paymentGateway' AND provider = 'payex' AND enabled = 1`
  );
  for (const row of rows || []) {
    const values = parseJson(row.values_json);
    if (!isPayexDirectConfig(values)) continue;
    const stored = decryptSecret(values.xendit_webhook_token_enc);
    if (stored && stored === token) {
      return String(row.client_id);
    }
  }
  return null;
}

async function getClientPaymentGateway(clientId) {
  const currency = await getClientCurrency(clientId);
  const [rows] = await pool.query(
    `SELECT provider FROM client_integration
     WHERE client_id = ? AND \`key\` = 'paymentGateway' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  const providerRaw = rows[0]?.provider;
  const provider = (providerRaw || '').toString().toLowerCase();
  if (provider === 'paynow') return { provider: 'paynow', currency };
  if (provider === 'payex') return { provider: 'payex', currency };
  if (provider === 'billplz') return { provider: 'billplz', currency };
  if (!provider && currency === 'SGD') {
    return { provider: 'paynow', currency };
  }
  return { provider: 'stripe', currency };
}

async function assertClientPaymentGatewayConnected(clientId) {
  const gateway = await getClientPaymentGateway(clientId);
  if (gateway.provider === 'paynow') {
    return { ok: true, provider: 'paynow', status: 'connected', currency: gateway.currency, mode: 'paynow' };
  }
  const status = await getPaymentGatewayDirectStatus(clientId, gateway.provider);
  if (status.connected) {
    return { ok: true, provider: gateway.provider, status: 'connected', currency: gateway.currency, mode: status.mode };
  }
  return {
    ok: false,
    provider: gateway.provider,
    currency: gateway.currency,
    status: status.connectionStatus,
    reason: status.connectionStatus === 'pending_verification'
      ? 'PAYMENT_GATEWAY_PENDING_VERIFICATION'
      : 'PAYMENT_GATEWAY_NOT_CONNECTED'
  };
}

async function assertClientPaymentGatewayUsable(clientId) {
  const gateway = await getClientPaymentGateway(clientId);
  if (gateway.provider === 'paynow') {
    return { ok: true, provider: 'paynow', status: 'connected', currency: gateway.currency, mode: 'paynow' };
  }
  const status = await getPaymentGatewayDirectStatus(clientId, gateway.provider);
  if (status.connected) {
    return { ok: true, provider: gateway.provider, status: 'connected', currency: gateway.currency, mode: status.mode };
  }
  if (status.connectionStatus === 'pending_verification') {
    const stripeUsable =
      gateway.provider === 'stripe' &&
      Boolean(status.oauthConnected && status.hasPaymentCredential);
    const payexUsable =
      gateway.provider === 'payex' &&
      Boolean(status.hasSecretKey && status.hasWebhookToken);
    const billplzUsable =
      gateway.provider === 'billplz' &&
      Boolean(status.hasApiKey && status.hasCollectionId && status.hasXSignatureKey);
    if (stripeUsable || payexUsable || billplzUsable) {
      return {
        ok: true,
        provider: gateway.provider,
        status: 'pending_verification',
        currency: gateway.currency,
        mode: status.mode,
        verificationPending: true
      };
    }
  }
  return {
    ok: false,
    provider: gateway.provider,
    currency: gateway.currency,
    status: status.connectionStatus,
    reason: status.connectionStatus === 'pending_verification'
      ? 'PAYMENT_GATEWAY_PENDING_VERIFICATION'
      : 'PAYMENT_GATEWAY_NOT_CONNECTED'
  };
}

module.exports = {
  getClientCurrency,
  getClientPaymentGateway,
  getPaymentGatewayRow,
  getPaymentGatewayRows,
  getPaymentGatewayDirectStatus,
  getStripeDirectCredentials,
  getPayexDirectCredentials,
  getBillplzDirectCredentials,
  getStripeWebhookCandidateSecrets,
  verifyPayexWebhookToken,
  findPayexClientIdByWebhookToken,
  saveStripeDirectConfig,
  saveStripeOAuthConnection,
  savePayexDirectConfig,
  saveBillplzDirectConfig,
  markStripeWebhookVerified,
  markStripeWebhookTestRequested,
  markPayexWebhookVerified,
  markBillplzWebhookVerified,
  encryptSecret,
  decryptSecret,
  assertClientPaymentGatewayConnected,
  assertClientPaymentGatewayUsable
};
