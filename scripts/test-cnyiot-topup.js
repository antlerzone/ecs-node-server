#!/usr/bin/env node
/**
 * 测试 CNYIoT 直连（不走 proxy）并对指定电表充值。
 * 用法：
 *   node scripts/test-cnyiot-topup.js [clientId] [meterId] [amount]
 * 或设置环境变量：
 *   TEST_CNYIOT_CLIENT_ID=xxx   METER_ID=19101920205   AMOUNT_KWH=10
 *
 * 需 .env 中有：DB_*, CNYIOT_AES_KEY；client 需在 client_integration 配置 meter/cnyiot。
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const clientId = process.env.TEST_CNYIOT_CLIENT_ID || process.argv[2];
const meterId = process.argv[3] || process.env.METER_ID || '19101920205';
const amountKwh = Number(process.argv[4] || process.env.AMOUNT_KWH || '10');

const BASE_URL = process.env.CNYIOT_BASE_URL || process.env.CNYIOT_PROXY_BASE || 'https://www.openapi.cnyiot.com/api.ashx';

async function main() {
  console.log('--- CNYIoT 直连充值测试 ---');
  console.log('BASE_URL:', BASE_URL);
  console.log('clientId:', clientId || '(未传，必填)');
  console.log('meterId:', meterId);
  console.log('amount (kWh):', amountKwh);

  if (!clientId) {
    console.error('请传 clientId：node scripts/test-cnyiot-topup.js <clientId> [meterId] [amount] 或设置 TEST_CNYIOT_CLIENT_ID');
    process.exit(1);
  }

  if (!process.env.CNYIOT_AES_KEY) {
    console.error('请确保 .env 中已配置 CNYIOT_AES_KEY');
    process.exit(1);
  }

  const cnyiot = require('../src/modules/cnyiot');

  try {
    console.log('\n1) 获取 token（登入 / 缓存）...');
    const token = await cnyiot.getValidCnyIotToken(clientId);
    console.log('   loginID:', token.loginID, 'apikey:', token.apiKey ? '[OK]' : '[MISSING]');

    console.log('\n2) 查询电表状态（确认直连可达）...');
    const statusRes = await cnyiot.meter.getMeterStatus(clientId, meterId);
    console.log('   result:', statusRes.result, 'value:', statusRes.value ? '(有数据)' : statusRes.value);
    if (statusRes.result !== 200 && statusRes.result !== 0) {
      console.error('   电表状态异常，请检查表号与权限。');
      process.exit(1);
    }

    console.log('\n3) 创建待付款订单 sellByApi（', amountKwh, 'kWh）...');
    const pendingRes = await cnyiot.meter.createPendingTopup(clientId, meterId, amountKwh);
    console.log('   result:', pendingRes.result, 'value:', JSON.stringify(pendingRes.value));
    if (pendingRes.result !== 200 && pendingRes.result !== 0) {
      console.error('   创建订单失败:', pendingRes);
      process.exit(1);
    }
    const idx = pendingRes.value?.idx;
    if (!idx) {
      console.error('   返回无 idx，无法确认充值');
      process.exit(1);
    }

    console.log('\n4) 确认充值 sellByApiOk（idx=', idx, '）...');
    const confirmRes = await cnyiot.meter.confirmTopup(clientId, meterId, idx);
    console.log('   result:', confirmRes.result, 'value:', JSON.stringify(confirmRes.value));
    if (confirmRes.result !== 200 && confirmRes.result !== 0) {
      console.error('   确认充值失败:', confirmRes);
      process.exit(1);
    }

    console.log('\n--- 完成：直连可用，已对表', meterId, '充值', amountKwh, 'kWh ---');
  } catch (err) {
    console.error('\n错误:', err.message);
    if (err.message.includes('CNYIOT_NOT_CONFIGURED') || err.message.includes('CNYIOT_ACCOUNT_INVALID')) {
      console.error('请确认该 client 在 client_integration 中已配置 key=meter, provider=cnyiot 及 cnyiot_username/cnyiot_password');
    }
    if (err.message.includes('CNYIOT_AES_KEY')) {
      console.error('请确认 .env 中配置了 CNYIOT_AES_KEY');
    }
    process.exit(1);
  } finally {
    const pool = require('../src/config/db');
    if (pool && typeof pool.end === 'function') pool.end().catch(() => {});
  }
}

main();
