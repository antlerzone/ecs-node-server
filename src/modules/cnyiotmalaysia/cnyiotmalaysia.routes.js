/**
 * CNYIoT Malaysia – 直连 CNYIOT 后端测试（绕过 proxy）。
 * 使用主号 (CNYIOT_LOGIN_NAME / CNYIOT_LOGIN_PSW)。
 * 官方《对外接口文档及接入手册》只给路径：/api.ashx?Method=xxx&api=1212，未给 host；
 * 完整 base URL 需向平台索取，设 env CNYIOT_MALAYSIA_BASE_URL。
 * 所有请求的 console 日志收集后返回给前端 #text1。
 */

const express = require('express');
const router = express.Router();
const { getCnyIotPlatformAccount } = require('../cnyiot/lib/cnyiotToken.service');
const { encryptApiKey } = require('../cnyiot/lib/encryptApiKey');

// 官方直连地址 https://www.openapi.cnyiot.com/api.ashx；可覆盖 env CNYIOT_MALAYSIA_BASE_URL
const MALAYSIA_BASE = (process.env.CNYIOT_MALAYSIA_BASE_URL || 'https://www.openapi.cnyiot.com/api.ashx').trim().replace(/\/$/, '');
const API_ID = process.env.CNYIOT_API_ID || 'coliman';
const TIMEOUT_MS = Number(process.env.CNYIOT_FETCH_TIMEOUT_MS) || 25000;

function createLogCollector() {
  const lines = [];
  const log = (...args) => {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    lines.push(`[${new Date().toISOString()}] ${msg}`);
    console.log(...args);
  };
  return { lines, log };
}

/**
 * POST /api/cnyiotmalaysia/ping
 * 直连 Malaysia 后端做 login，返回 ping 结果 + 完整 console 行。
 */
router.post('/ping', async (req, res) => {
  const { lines, log } = createLogCollector();
  try {
    log('MALAYSIA_BASE=', MALAYSIA_BASE);
    const account = getCnyIotPlatformAccount();
    const url = `${MALAYSIA_BASE}?Method=login&api=${encodeURIComponent(API_ID)}`;
    log('--- request ---');
    log('method=', 'POST');
    log('url (full)=', url);
    log('headers=', JSON.stringify({ 'Content-Type': 'application/json' }));

    const body = { nam: account.username, psw: account.password };
    const bodyForLog = { nam: body.nam, psw: '(redacted)' };
    log('body (psw redacted)=', JSON.stringify(bodyForLog));

    const t0 = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timeoutId);
      log('fetch error:', e?.message, e?.name);
      return res.json({
        ok: false,
        reason: e?.name === 'AbortError' ? 'TIMEOUT' : (e?.message || 'FETCH_ERROR'),
        console: lines
      });
    }
    clearTimeout(timeoutId);
    const text = await response.text();
    const duration = Date.now() - t0;
    log('--- response ---');
    log('status=', response.status, 'durationMs=', duration, 'textLen=', text?.length || 0);
    log('response body (full)=', text || '');

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      log('non-JSON response');
      return res.json({ ok: false, reason: 'NON_JSON_RESPONSE', pingResult: null, console: lines });
    }

    const result = String(json?.result ?? '');
    const ok = result === '200';
    log('ping result=', result, 'ok=', ok);
    return res.json({
      ok,
      pingResult: json,
      reason: ok ? undefined : (result || 'LOGIN_FAILED'),
      console: lines
    });
  } catch (err) {
    log('error:', err?.message);
    return res.json({
      ok: false,
      reason: err?.message || 'SERVER_ERROR',
      console: lines
    });
  }
});

/**
 * POST /api/cnyiotmalaysia/get-prices
 * 直连 Malaysia 后端：主号 login → getPrices，返回价格列表 + 完整 console。
 */
router.post('/get-prices', async (req, res) => {
  const { lines, log } = createLogCollector();
  try {
    log('MALAYSIA_BASE=', MALAYSIA_BASE);
    const account = getCnyIotPlatformAccount();
    const loginUrl = `${MALAYSIA_BASE}?Method=login&api=${encodeURIComponent(API_ID)}`;
    log('--- step1 login request ---');
    log('method=', 'POST');
    log('url (full)=', loginUrl);
    log('headers=', JSON.stringify({ 'Content-Type': 'application/json' }));
    const loginBody = { nam: account.username, psw: account.password };
    log('body (psw redacted)=', JSON.stringify({ nam: loginBody.nam, psw: '(redacted)' }));

    const t0 = Date.now();
    let loginRes;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      loginRes = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginBody),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch (e) {
      log('login fetch error:', e?.message);
      return res.json({
        ok: false,
        reason: e?.name === 'AbortError' ? 'TIMEOUT' : (e?.message || 'FETCH_ERROR'),
        console: lines
      });
    }

    const loginText = await loginRes.text();
    log('--- step1 login response ---');
    log('status=', loginRes.status, 'ms=', Date.now() - t0, 'textLen=', loginText?.length);
    log('response body (full)=', loginText || '');

    let loginJson;
    try {
      loginJson = JSON.parse(loginText);
    } catch {
      log('login non-JSON');
      return res.json({ ok: false, reason: 'LOGIN_NON_JSON', console: lines });
    }

    const apiKey = loginJson?.value?.apiKey;
    const loginID = loginJson?.value?.LoginID ?? loginJson?.value?.loginid;
    if (!apiKey || !loginID) {
      log('login failed result=', loginJson?.result, 'value=', loginJson?.value ? 'present' : 'missing');
      return res.json({
        ok: false,
        reason: `LOGIN_FAILED:${loginJson?.result ?? 'no apikey/loginID'}`,
        console: lines
      });
    }
    log('login ok loginID=', loginID);

    const secretKey = process.env.CNYIOT_AES_KEY;
    if (!secretKey) {
      log('CNYIOT_AES_KEY missing');
      return res.json({ ok: false, reason: 'CNYIOT_AES_KEY_MISSING', console: lines });
    }
    const encodedApiKey = encryptApiKey(apiKey, secretKey);
    const getPricesUrl = `${MALAYSIA_BASE}?Method=getPrices&api=${encodeURIComponent(API_ID)}&apikey=${encodedApiKey}`;
    log('--- step2 getPrices request ---');
    log('method=', 'POST');
    log('url (full, apikey encoded)=', getPricesUrl);
    log('headers=', JSON.stringify({ 'Content-Type': 'application/json' }));

    const getPricesBody = {
      'login id': loginID,
      loginid: loginID,
      LoginID: loginID,
      ckv: '',
      ptype: -1,
      offset: -1,
      limit: -1
    };
    log('body=', JSON.stringify(getPricesBody));
    let pricesRes;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      pricesRes = await fetch(getPricesUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getPricesBody),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch (e) {
      log('getPrices fetch error:', e?.message);
      return res.json({
        ok: false,
        reason: e?.name === 'AbortError' ? 'TIMEOUT' : (e?.message || 'FETCH_ERROR'),
        console: lines
      });
    }

    const pricesText = await pricesRes.text();
    log('--- step2 getPrices response ---');
    log('status=', pricesRes.status, 'textLen=', pricesText?.length);
    log('response body (full)=', pricesText || '');

    let pricesJson;
    try {
      pricesJson = JSON.parse(pricesText);
    } catch {
      log('getPrices non-JSON');
      return res.json({ ok: false, reason: 'GETPRICES_NON_JSON', console: lines });
    }

    const result = String(pricesJson?.result ?? '');
    const ok = result === '200';
    log('getPrices result=', result, 'ok=', ok);
    return res.json({
      ok,
      data: pricesJson?.value ?? null,
      result: pricesJson?.result,
      reason: ok ? undefined : (result || 'GETPRICES_FAILED'),
      console: lines
    });
  } catch (err) {
    log('error:', err?.message);
    return res.json({
      ok: false,
      reason: err?.message || 'SERVER_ERROR',
      console: lines
    });
  }
});

module.exports = router;
