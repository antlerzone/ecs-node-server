#!/usr/bin/env node
/**
 * 方案二（Payment Session）：探测 POST /sessions 能否拿到 payment_link_url（SGD + PAY + PAYMENT_LINK）。
 * 与 xendit-saas-platform.service.js 中 createSaaSPlatformPaymentSession 请求体对齐；不写入 MySQL。
 *
 *   node scripts/xendit-saas-session-option2-smoke.js
 *
 * 需 .env：XENDIT_PLATFORM_TEST_SECRET_KEY 或 XENDIT_PLATFORM_SECRET_KEY（与 XENDIT_PLATFORM_USE_TEST 一致）
 * 可选：SAAS_COLIVING_PUBLIC_API_BASE 或 API_BASE_URL（item url / 文档）
 */

require('dotenv').config();
const axios = require('axios');

const XENDIT_API_BASE = 'https://api.xendit.co';

function getPlatformSecret() {
  const forceDemo = process.env.FORCE_PAYMENT_SANDBOX === '1' || process.env.FORCE_PAYMENT_SANDBOX === 'true';
  const useTest =
    forceDemo || process.env.XENDIT_PLATFORM_USE_TEST === '1' || process.env.XENDIT_PLATFORM_USE_TEST === 'true';
  const secretKey = (
    useTest
      ? process.env.XENDIT_PLATFORM_TEST_SECRET_KEY || process.env.XENDIT_PLATFORM_SECRET_KEY || ''
      : process.env.XENDIT_PLATFORM_SECRET_KEY || ''
  )
    .toString()
    .trim();
  return { secretKey, useTest };
}

function portalBaseForUrl() {
  const u = (
    process.env.SAAS_COLIVING_PUBLIC_API_BASE ||
    process.env.API_BASE_URL ||
    process.env.PUBLIC_APP_URL ||
    'https://portal.colivingjb.com'
  )
    .toString()
    .replace(/\/$/, '');
  return u.startsWith('http') ? `${u}/` : 'https://portal.colivingjb.com/';
}

async function main() {
  const { secretKey, useTest } = getPlatformSecret();
  if (!secretKey) {
    console.error('Missing XENDIT_PLATFORM_* secret key in .env');
    process.exit(1);
  }
  const auth = Buffer.from(`${secretKey}:`).toString('base64');
  const ref = `smoke-saas-ps-${Date.now()}`;
  const amount = 1.5;
  const itemUrl = portalBaseForUrl();

  const body = {
    reference_id: ref,
    session_type: 'PAY',
    mode: 'PAYMENT_LINK',
    amount,
    currency: 'SGD',
    country: 'SG',
    capture_method: 'AUTOMATIC',
    description: 'Coliving SaaS smoke (option 2 Payment Session)',
    customer: {
      reference_id: 'smoke-cust-1',
      type: 'INDIVIDUAL',
      email: 'saas-billing-noreply@colivingjb.com',
      mobile_number: '+6500000000',
      individual_detail: { given_names: 'Smoke', surname: 'Test' }
    },
    items: [
      {
        reference_id: `${ref}-i1`,
        name: 'Coliving SaaS smoke',
        type: 'DIGITAL_SERVICE',
        category: 'SOFTWARE',
        net_unit_amount: amount,
        quantity: 1,
        currency: 'SGD',
        url: itemUrl
      }
    ],
    locale: 'en',
    success_return_url: 'https://portal.colivingjb.com/enquiry?paid=1',
    cancel_return_url: 'https://portal.colivingjb.com/enquiry',
    metadata: { smoke: '1', option: 'payment_session' }
  };

  console.log('XENDIT_PLATFORM_USE_TEST =', useTest ? '1' : '0');
  try {
    const { data } = await axios.post(`${XENDIT_API_BASE}/sessions`, body, {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      timeout: 25000
    });
    console.log('OK payment_session_id:', data?.payment_session_id);
    console.log('OK payment_link_url:', data?.payment_link_url);
  } catch (e) {
    const msg = e?.response?.data?.message || e?.response?.data?.error_code || e?.message;
    console.error('FAIL', e?.response?.status, msg, e?.response?.data);
    process.exit(1);
  }
}

main();
