#!/usr/bin/env node
/**
 * 方案一（Invoice v2 托管页）：探测 POST /v2/invoices 能否拿到 invoice_url。
 * - MYR：FPX 渠道（与线上同形状，仅列一项以缩短请求）
 * - SGD：payment_methods: ['CREDIT_CARD']（与 xendit-saas-platform.service.js 一致）
 *
 * 用于确认 Xendit 商户已开通对应币种/渠道；不写入 MySQL。
 *
 *   node scripts/xendit-saas-invoice-option1-smoke.js           # 默认只测 SGD
 *   node scripts/xendit-saas-invoice-option1-smoke.js --myr
 *   node scripts/xendit-saas-invoice-option1-smoke.js --both
 *
 * 需 .env：XENDIT_PLATFORM_TEST_SECRET_KEY 或 XENDIT_PLATFORM_SECRET_KEY（与 XENDIT_PLATFORM_USE_TEST 一致）
 * 可选：SAAS_COLIVING_PUBLIC_API_BASE 或 API_BASE_URL（写入 callback_url）
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

function getCallbackBase() {
  const u = (
    process.env.SAAS_COLIVING_PUBLIC_API_BASE ||
    process.env.API_BASE_URL ||
    process.env.PUBLIC_APP_URL ||
    ''
  )
    .toString()
    .replace(/\/$/, '');
  return u || 'https://api.colivingjb.com';
}

async function createInvoice({ currency, paymentMethods, amount, externalId }) {
  const { secretKey } = getPlatformSecret();
  if (!secretKey) {
    console.error('Missing XENDIT_PLATFORM_* secret key in .env');
    process.exit(1);
  }
  const auth = Buffer.from(`${secretKey}:`).toString('base64');
  const callbackUrl = `${getCallbackBase()}/api/payex/callback`;
  const body = {
    external_id: externalId,
    amount,
    description: 'Coliving SaaS smoke (option 1 Invoice)',
    currency,
    payer_email: 'saas-billing-noreply@colivingjb.com',
    success_redirect_url: 'https://portal.colivingjb.com/enquiry?paid=1',
    failure_redirect_url: 'https://portal.colivingjb.com/enquiry',
    invoice_duration: 600,
    callback_url: callbackUrl,
    metadata: { smoke: '1', option: 'invoice_v2' },
    payment_methods: paymentMethods
  };
  const { data } = await axios.post(`${XENDIT_API_BASE}/v2/invoices`, body, {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    timeout: 25000
  });
  return data;
}

async function run(label, fn) {
  console.log(`\n--- ${label} ---`);
  try {
    const data = await fn();
    console.log('OK id:', data?.id);
    console.log('invoice_url:', data?.invoice_url ? String(data.invoice_url).slice(0, 120) + '…' : '(none)');
  } catch (e) {
    const msg =
      e?.response?.data?.message ||
      (Array.isArray(e?.response?.data?.errors) ? e.response.data.errors[0]?.message : '') ||
      e?.message ||
      String(e);
    console.error('FAIL:', msg);
    if (e?.response?.status) console.error('HTTP', e.response.status);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const doMyr = argv.includes('--myr') || argv.includes('--both');
  const doSgd = !argv.includes('--myr') || argv.includes('--both');
  const ts = Date.now();

  const { useTest, secretKey } = getPlatformSecret();
  console.log('Xendit mode:', useTest ? 'test/sandbox key' : 'live key', secretKey ? '(key present)' : '(missing)');

  if (doSgd) {
    await run('SGD + CREDIT_CARD (方案一新币托管页)', () =>
      createInvoice({
        currency: 'SGD',
        paymentMethods: ['CREDIT_CARD'],
        amount: 1,
        externalId: `smoke-sgd-${ts}`
      })
    );
  }

  if (doMyr) {
    await run('MYR + FPX sample (一项)', () =>
      createInvoice({
        currency: 'MYR',
        paymentMethods: ['DD_UOB_FPX'],
        amount: 1,
        externalId: `smoke-myr-${ts}`
      })
    );
  }

  console.log('\n若 SGD 报 currency SGD is not configured：请在 Xendit 后台或工单开通 SGD Invoice/卡渠道后再测。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
