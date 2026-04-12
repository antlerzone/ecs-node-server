#!/usr/bin/env node
/**
 * 检查支付相关 .env 是否齐全（只检查变量名是否已设置，不打印取值）。
 * 运行: node scripts/check-env-payment.js
 */

require('dotenv').config();

const groups = {
  'Stripe MY Live': [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PUBLISHABLE_KEY',
    'STRIPE_MY_CONNECT_CLIENT_ID'
  ],
  'Stripe MY Sandbox': [
    'STRIPE_SANDBOX_SECRET_KEY',
    'STRIPE_SANDBOX_WEBHOOK_SECRET',
    'STRIPE_SANDBOX_PUBLISHABLE_KEY',
    'STRIPE_MY_SANDBOX_CONNECT_CLIENT_ID'
  ],
  'Stripe SG Live': [
    'STRIPE_SG_SECRET_KEY',
    'STRIPE_SG_WEBHOOK_SECRET',
    'STRIPE_SG_PUBLISHABLE_KEY',
    'STRIPE_SG_CONNECT_CLIENT_ID'
  ],
  'Stripe SG Sandbox': [
    'STRIPE_SG_SANDBOX_SECRET_KEY',
    'STRIPE_SG_SANDBOX_WEBHOOK_SECRET',
    'STRIPE_SG_SANDBOX_PUBLISHABLE_KEY',
    'STRIPE_SG_SANDBOX_CONNECT_CLIENT_ID'
  ],
  'Xendit Live': [
    'XENDIT_PLATFORM_SECRET_KEY',
    'XENDIT_PLATFORM_ACCOUNT_ID'
  ],
  'Xendit Sandbox': [
    'XENDIT_PLATFORM_TEST_SECRET_KEY',
    'XENDIT_PLATFORM_ACCOUNT_ID',
    'XENDIT_PLATFORM_USE_TEST'
  ]
};

function isSet(name) {
  const v = process.env[name];
  return v != null && String(v).trim() !== '';
}

const missing = [];
console.log('Payment .env 检查（只显示是否已设置，不显示取值）\n');

for (const [group, vars] of Object.entries(groups)) {
  const status = vars.map((name) => {
    const ok = isSet(name);
    if (!ok) missing.push({ group, name });
    return `${name}: ${ok ? '✓' : '✗'}`;
  });
  console.log(`${group}:`);
  status.forEach((s) => console.log(`  ${s}`));
  console.log('');
}

if (missing.length) {
  console.log('--- 当前缺少的变量 ---');
  const byGroup = {};
  for (const { group, name } of missing) {
    if (!byGroup[group]) byGroup[group] = [];
    byGroup[group].push(name);
  }
  for (const [g, names] of Object.entries(byGroup)) {
    console.log(`${g}: ${names.join(', ')}`);
  }
} else {
  console.log('全部已设置。');
}
