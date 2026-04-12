/**
 * CNYIoT API call (single entry).
 * 直连官方 API https://www.openapi.cnyiot.com/api.ashx；可覆盖 env CNYIOT_BASE_URL。
 * Gets token, encrypts apiKey, POST JSON; on 5002 invalidates token and retries once.
 */

const { getValidCnyIotToken, getValidCnyIotTokenForPlatform, requestNewToken, invalidateCnyIotToken, invalidateCnyIotPlatformToken } = require('../lib/cnyiotToken.service');
const { encryptApiKey } = require('../lib/encryptApiKey');

// 官方直连地址 https://www.openapi.cnyiot.com/api.ashx
const BASE_URL = process.env.CNYIOT_BASE_URL || 'https://www.openapi.cnyiot.com/api.ashx';
const API_ID = process.env.CNYIOT_API_ID || 'coliman';
const CNYIOT_FETCH_TIMEOUT_MS = Number(process.env.CNYIOT_FETCH_TIMEOUT_MS) || 25000;

/**
 * Call CNYIoT API.
 * @param {{ clientId: string, method: string, body?: object, retry?: boolean, usePlatformAccount?: boolean }} opts
 * usePlatformAccount: use Secret Manager 母账号 (CNYIOT_LOGIN_NAME, CNYIOT_LOGIN_PSW) for addUser/getUsers when creating subuser.
 * @returns {Promise<object>} - JSON response; if opts.returnPayloads then { result, requestPayload, responsePayload }
 */
async function callCnyIot({ clientId, method, body = {}, retry = false, usePlatformAccount = false, returnPayloads = false }) {
  if (!clientId) throw new Error('CLIENT_ID_REQUIRED');
  if (!method) throw new Error('METHOD_REQUIRED');

  const { apiKey: rawApiKey, loginID } = usePlatformAccount
    ? await getValidCnyIotTokenForPlatform()
    : await getValidCnyIotToken(clientId);
  const secretKey = process.env.CNYIOT_AES_KEY;
  const apiKey = encryptApiKey(rawApiKey, secretKey);

  const url = `${BASE_URL}?Method=${encodeURIComponent(method)}&api=${encodeURIComponent(API_ID)}&apikey=${apiKey}`;
  const urlForLog = `${BASE_URL}?Method=${encodeURIComponent(method)}&api=${encodeURIComponent(API_ID)}&apikey=***`;

  const payload = { ...body };
  if (payload.loginid == null) payload.loginid = loginID;
  if (payload.LoginID == null) payload.LoginID = loginID;

  const reqT0 = Date.now();
  console.log('[CNYIOT] request start method=%s clientId=%s usePlatformAccount=%s timeoutMs=%s url=%s', method, clientId, usePlatformAccount, CNYIOT_FETCH_TIMEOUT_MS, urlForLog);
  console.log('[CNYIOT] request payload method=%s body=%j', method, payload);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CNYIOT_FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (fetchErr) {
    clearTimeout(timeoutId);
    const duration = Date.now() - reqT0;
    const code = fetchErr?.cause?.code || fetchErr?.code;
    const isAbort = fetchErr?.name === 'AbortError' || (fetchErr?.cause && fetchErr.cause.name === 'AbortError');
    console.error('[CNYIOT] request fetch failed method=%s clientId=%s durationMs=%s err=%s name=%s cause=%s code=%s isAbort=%s', method, clientId, duration, fetchErr?.message, fetchErr?.name, fetchErr?.cause, code, isAbort);
    if (isAbort) throw new Error('CNYIOT_NETWORK_TIMEOUT');
    throw fetchErr;
  }
  clearTimeout(timeoutId);

  const text = await res.text();
  const duration = Date.now() - reqT0;
  console.log('[CNYIOT] response method=%s clientId=%s status=%s durationMs=%s textLen=%s', method, clientId, res.status, duration, (text && text.length) || 0);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error('[CNYIOT] non-JSON response method=%s clientId=%s text=%s', method, clientId, text.slice(0, 300));
    throw new Error(`CNYIOT_NON_JSON_RESPONSE: ${text.slice(0, 200)}`);
  }

  const valueType = Array.isArray(json.value) ? 'array' : typeof json.value;
  const valueSummary = Array.isArray(json.value) ? `length=${json.value.length}` : '';
  console.log('[CNYIOT] result method=%s clientId=%s result=%s valueType=%s %s', method, clientId, json.result, valueType, valueSummary);
  const responseStr = JSON.stringify(json);
  if (responseStr.length <= 2000) {
    console.log('[CNYIOT] response body method=%s %s', method, responseStr);
  } else {
    console.log('[CNYIOT] response body method=%s (truncated %s chars) %s...(truncated)', method, responseStr.length, responseStr.slice(0, 1500));
  }

  if (json.result === 5002 && !retry) {
    if (usePlatformAccount) {
      invalidateCnyIotPlatformToken();
      return callCnyIot({ clientId, method, body, retry: true, usePlatformAccount: true, returnPayloads });
    }
    await invalidateCnyIotToken(clientId);
    return callCnyIot({ clientId, method, body, retry: true, returnPayloads });
  }

  if (returnPayloads) {
    return { result: json, requestPayload: payload, responsePayload: json };
  }
  return json;
}

/**
 * Call CNYIoT API with explicit token (no DB). Used when frontend sends loginName/password/subuserId.
 */
async function callCnyIotWithToken({ rawApiKey, loginID, method, body = {} }) {
  const secretKey = process.env.CNYIOT_AES_KEY;
  const apiKey = encryptApiKey(rawApiKey, secretKey);
  const url = `${BASE_URL}?Method=${encodeURIComponent(method)}&api=${encodeURIComponent(API_ID)}&apikey=${apiKey}`;
  const payload = { ...body };
  if (payload.loginid == null) payload.loginid = loginID;
  if (payload.LoginID == null) payload.LoginID = loginID;
  console.log('[CNYIOT] callCnyIotWithToken method=%s loginid=%s body=%j', method, loginID, payload);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CNYIOT_FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`CNYIOT_NON_JSON_RESPONSE: ${text.slice(0, 200)}`);
  }
  return json;
}

module.exports = { callCnyIot, callCnyIotWithToken, requestNewToken };
