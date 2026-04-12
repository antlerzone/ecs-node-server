/**
 * Bukku API 冒烟：GET sales invoice + GET sales payment（不改数据）。
 * 用于核对 .env 里 API Key / 子域与现场一致，再于 Wix Site monitoring 观察 PUT。
 *
 * 用法：
 *   BUKKU_API_KEY=... node scripts/bukku-api-smoke.js <invoiceTransactionId> [paymentTransactionId]
 *
 * Env：
 *   BUKKU_API_KEY 或 BUKKU_TOKEN（必填，才能发真实请求）
 *   BUKKU_SUBDOMAIN（可选，默认 colivingmanagement）
 *
 * 无 Key 时：打印说明并以 0 退出（便于 CI； live 检查请 export Key 后重跑）。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const BASE = 'https://api.bukku.my';

async function bukkuFetch(path, token, subdomain) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Company-Subdomain': subdomain,
      Accept: 'application/json'
    }
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { _raw: text.slice(0, 500) };
  }
  return { ok: res.ok, status: res.status, data };
}

function extractTx(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.transaction && typeof body.transaction === 'object') return body.transaction;
  if (body.data?.transaction && typeof body.data.transaction === 'object') return body.data.transaction;
  return null;
}

/** @param {object} tx */
function linkedPaymentCandidates(tx) {
  const out = [];
  const items = tx?.linked_items;
  if (!Array.isArray(items)) return out;
  for (const li of items) {
    const typ = li.type != null ? String(li.type).toLowerCase() : '';
    if (typ === 'sale_invoice') continue;
    const oid = li.origin_transaction_id;
    if (oid != null && String(oid).trim() !== '') {
      const n = parseInt(String(oid).trim(), 10);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

async function main() {
  const token =
    process.env.BUKKU_API_KEY ||
    process.env.BUKKU_TOKEN ||
    process.env.bukkuApiKey;
  const subdomain =
    process.env.BUKKU_SUBDOMAIN || process.env.BUKKU_COMPANY_SUBDOMAIN || 'colivingmanagement';
  const invArg = process.argv[2];
  const payArg = process.argv[3];

  if (!token) {
    console.log(
      '[bukku-api-smoke] SKIP: no BUKKU_API_KEY / BUKKU_TOKEN in environment — no live GET performed.'
    );
    console.log(
      '  Wix：用 Secrets 里的 bukkuApiKey；本地：export BUKKU_API_KEY=… 后运行：npm run bukku:smoke -- <invoiceId> [paymentId]'
    );
    process.exit(0);
  }
  if (!invArg) {
    console.error('Usage: node scripts/bukku-api-smoke.js <invoiceTransactionId> [paymentTransactionId]');
    process.exit(1);
  }

  const invId = parseInt(String(invArg).trim(), 10);
  if (!Number.isFinite(invId)) {
    console.error('Invalid invoice id');
    process.exit(1);
  }

  console.log(`GET /sales/invoices/${invId} …`);
  const inv = await bukkuFetch(`/sales/invoices/${invId}`, token, subdomain);
  console.log(`  status ${inv.status} ok=${inv.ok}`);
  if (!inv.ok) {
    console.log('  body:', JSON.stringify(inv.data).slice(0, 800));
    process.exit(1);
  }

  const tx = extractTx(inv.data);
  const candidates = tx ? linkedPaymentCandidates(tx) : [];
  if (candidates.length) {
    console.log(`  linked_items payment candidates: ${candidates.join(', ')}`);
  }

  let payId = payArg != null ? parseInt(String(payArg).trim(), 10) : NaN;
  if (!Number.isFinite(payId) && candidates.length === 1) {
    payId = candidates[0];
    console.log(`Using single linked candidate as payment id: ${payId}`);
  }

  if (!Number.isFinite(payId)) {
    console.log(
      'No second arg and invoice has 0 or multiple linked payment ids — pass paymentTransactionId explicitly for GET payment.'
    );
    console.log('Invoice smoke OK.');
    process.exit(0);
  }

  console.log(`GET /sales/payments/${payId} …`);
  const pay = await bukkuFetch(`/sales/payments/${payId}`, token, subdomain);
  console.log(`  status ${pay.status} ok=${pay.ok}`);
  if (!pay.ok) {
    console.log('  body:', JSON.stringify(pay.data).slice(0, 800));
    process.exit(1);
  }

  const pt = extractTx(pay.data);
  console.log(
    `  payment number=${pt?.number} date=${pt?.date} amount=${pt?.amount} (PUT date would use RC paidAt in sandbox234.jsw)`
  );
  console.log('Invoice + payment GET smoke OK.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
