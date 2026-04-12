const billplzrequest = require('./billplzrequest');

async function createBill({
  apiKey,
  collectionId,
  email,
  mobile,
  name,
  amount,
  callbackUrl,
  description,
  dueAt,
  redirectUrl,
  deliver,
  reference1Label,
  reference1,
  reference2Label,
  reference2,
  useSandbox = false
}) {
  const payload = {
    collection_id: collectionId,
    email,
    mobile,
    name,
    amount,
    callback_url: callbackUrl,
    description,
    ...(dueAt ? { due_at: dueAt } : {}),
    ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
    ...(deliver !== undefined ? { deliver: !!deliver } : {}),
    ...(reference1Label ? { reference_1_label: reference1Label } : {}),
    ...(reference1 ? { reference_1: reference1 } : {}),
    ...(reference2Label ? { reference_2_label: reference2Label } : {}),
    ...(reference2 ? { reference_2: reference2 } : {})
  };
  return billplzrequest({
    apiKey,
    version: 'v3',
    endpoint: '/bills',
    method: 'post',
    data: payload,
    useSandbox
  });
}

async function getBill({ apiKey, billId, useSandbox = false }) {
  return billplzrequest({
    apiKey,
    version: 'v3',
    endpoint: `/bills/${encodeURIComponent(String(billId || '').trim())}`,
    method: 'get',
    useSandbox
  });
}

async function deleteBill({ apiKey, billId, useSandbox = false }) {
  return billplzrequest({
    apiKey,
    version: 'v3',
    endpoint: `/bills/${encodeURIComponent(String(billId || '').trim())}`,
    method: 'delete',
    useSandbox
  });
}

async function listBillTransactions({ apiKey, billId, page, status, useSandbox = false }) {
  return billplzrequest({
    apiKey,
    version: 'v3',
    endpoint: `/bills/${encodeURIComponent(String(billId || '').trim())}/transactions`,
    method: 'get',
    params: {
      ...(page ? { page } : {}),
      ...(status ? { status } : {})
    },
    useSandbox
  });
}

async function getPaymentGateways({ apiKey, useSandbox = false }) {
  return billplzrequest({
    apiKey,
    version: 'v4',
    endpoint: '/payment_gateways',
    method: 'get',
    useSandbox
  });
}

async function getFpxBanks({ apiKey, useSandbox = false }) {
  return billplzrequest({
    apiKey,
    version: 'v3',
    endpoint: '/fpx_banks',
    method: 'get',
    useSandbox
  });
}

async function getWebhookRank({ apiKey, useSandbox = false }) {
  return billplzrequest({
    apiKey,
    version: 'v4',
    endpoint: '/webhook_rank',
    method: 'get',
    useSandbox
  });
}

module.exports = {
  createBill,
  getBill,
  deleteBill,
  listBillTransactions,
  getPaymentGateways,
  getFpxBanks,
  getWebhookRank
};
