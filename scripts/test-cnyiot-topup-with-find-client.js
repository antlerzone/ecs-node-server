#!/usr/bin/env node
/**
 * 查找已配置 CNYIoT 的 client，并对指定表充值（直连测试）。
 * 用法：node scripts/test-cnyiot-topup-with-find-client.js [meterId] [amount]
 * 默认：meterId=19101920205, amount=10
 * 若 DB 中尚无 client 的 meter/cnyiot 配置，会提示用下方 SQL 或 API 写入后再跑。
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const meterId = process.argv[2] || process.env.METER_ID || '19101920205';
const amountKwh = Number(process.argv[3] || process.env.AMOUNT_KWH || '10');

const pool = require('../src/config/db');
const BASE_URL = process.env.CNYIOT_BASE_URL || process.env.CNYIOT_PROXY_BASE || 'https://www.openapi.cnyiot.com/api.ashx';

async function findClientWithCnyiot() {
  const [rows] = await pool.query(
    `SELECT client_id, values_json FROM client_integration
     WHERE \`key\` = 'meter' AND provider = 'cnyiot' AND enabled = 1
     LIMIT 1`
  );
  if (rows.length === 0) return null;
  const v = rows[0].values_json;
  const values = typeof v === 'string' ? JSON.parse(v) : v;
  if (!values?.cnyiot_username || !values?.cnyiot_password) return null;
  return rows[0].client_id;
}

async function main() {
  console.log('--- CNYIoT 直连充值测试 ---');
  console.log('BASE_URL:', BASE_URL);
  console.log('meterId:', meterId, 'amount (kWh):', amountKwh);

  if (!process.env.CNYIOT_AES_KEY) {
    console.error('请确保 .env 中已配置 CNYIOT_AES_KEY');
    process.exit(1);
  }

  let clientId = await findClientWithCnyiot();
  if (!clientId) {
    console.error('\n未找到已配置 CNYIoT 的 client（client_integration 需 key=meter, provider=cnyiot）。');
    console.error('请先为某个 client 写入配置，例如用 API POST /api/client/sync-subtables 或直接写 DB：');
    console.error(`
-- 假设你的 client id 为 'xxx-client-id'，执行：
INSERT INTO client_integration (id, client_id, \\\`key\\\`, enabled, provider, values_json, created_at, updated_at)
VALUES (UUID(), 'xxx-client-id', 'meter', 1, 'cnyiot', '{"cnyiot_username":"0003654536","cnyiot_password":"11223366"}', NOW(), NOW());
`);
    process.exit(1);
  }
  console.log('使用 clientId:', clientId);

  const cnyiot = require('../src/modules/cnyiot');

  try {
    console.log('\n1) 获取 token（登入 / 缓存）...');
    const token = await cnyiot.getValidCnyIotToken(clientId);
    console.log('   loginID:', token.loginID, 'apikey:', token.apiKey ? '[OK]' : '[MISSING]');

    console.log('\n2) 查询电表状态...');
    const statusRes = await cnyiot.meter.getMeterStatus(clientId, meterId);
    console.log('   result:', statusRes.result);
    if (String(statusRes.result) !== '200' && statusRes.result !== 0) {
      console.error('   电表状态异常:', statusRes);
      process.exit(1);
    }

    console.log('\n3) 创建待付款订单 sellByApi（', amountKwh, 'kWh）...');
    const pendingRes = await cnyiot.meter.createPendingTopup(clientId, meterId, amountKwh);
    console.log('   result:', pendingRes.result, 'value:', JSON.stringify(pendingRes.value));
    if (String(pendingRes.result) !== '200' && pendingRes.result !== 0) {
      console.error('   创建订单失败:', pendingRes);
      process.exit(1);
    }
    const idx = pendingRes.value?.idx;
    if (!idx) {
      console.error('   返回无 idx');
      process.exit(1);
    }

    console.log('\n4) 确认充值 sellByApiOk（idx=', idx, '）...');
    const confirmRes = await cnyiot.meter.confirmTopup(clientId, meterId, idx);
    console.log('   result:', confirmRes.result);
    if (String(confirmRes.result) !== '200' && confirmRes.result !== 0) {
      console.error('   确认充值失败:', confirmRes);
      process.exit(1);
    }

    console.log('\n--- 完成：直连可用，已对表', meterId, '充值', amountKwh, 'kWh ---');
  } catch (err) {
    console.error('\n错误:', err.message);
    if (err.message.includes('CNYIOT_NOT_CONFIGURED') || err.message.includes('CNYIOT_ACCOUNT_INVALID')) {
      console.error('请确认 client_integration 中该 client 的 values_json 含 cnyiot_username / cnyiot_password');
    }
    process.exit(1);
  } finally {
    if (pool && typeof pool.end === 'function') pool.end().catch(() => {});
  }
}

main();
