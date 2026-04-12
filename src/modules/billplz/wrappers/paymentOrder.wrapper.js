const billplzrequest = require('./billplzrequest');
const { signBillplzV5Checksum } = require('../lib/signature');

function epochNow() {
  return Math.floor(Date.now() / 1000);
}

async function createPaymentOrderCollection({
  apiKey,
  xSignatureKey,
  title,
  callbackUrl,
  useSandbox = false,
  epoch = epochNow()
}) {
  const payload = {
    title,
    ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    epoch
  };
  payload.checksum = signBillplzV5Checksum([title, callbackUrl || '', epoch], xSignatureKey);
  return billplzrequest({
    apiKey,
    version: 'v5',
    endpoint: '/payment_order_collections',
    method: 'post',
    data: payload,
    useSandbox
  });
}

async function getPaymentOrderCollection({
  apiKey,
  xSignatureKey,
  paymentOrderCollectionId,
  useSandbox = false,
  epoch = epochNow()
}) {
  const id = String(paymentOrderCollectionId || '').trim();
  return billplzrequest({
    apiKey,
    version: 'v5',
    endpoint: `/payment_order_collections/${encodeURIComponent(id)}`,
    method: 'get',
    params: {
      epoch,
      checksum: signBillplzV5Checksum([id, epoch], xSignatureKey)
    },
    useSandbox
  });
}

async function createPaymentOrder({
  apiKey,
  xSignatureKey,
  paymentOrderCollectionId,
  bankCode,
  bankAccountNumber,
  name,
  description,
  total,
  email,
  notification,
  recipientNotification,
  referenceId,
  useSandbox = false,
  epoch = epochNow()
}) {
  const payload = {
    payment_order_collection_id: paymentOrderCollectionId,
    bank_code: bankCode,
    bank_account_number: bankAccountNumber,
    name,
    description,
    total,
    epoch,
    ...(email ? { email } : {}),
    ...(notification !== undefined ? { notification: !!notification } : {}),
    ...(recipientNotification !== undefined ? { recipient_notification: !!recipientNotification } : {}),
    ...(referenceId ? { reference_id: referenceId } : {})
  };
  payload.checksum = signBillplzV5Checksum(
    [paymentOrderCollectionId, bankAccountNumber, total, epoch],
    xSignatureKey
  );
  return billplzrequest({
    apiKey,
    version: 'v5',
    endpoint: '/payment_orders',
    method: 'post',
    data: payload,
    useSandbox
  });
}

async function getPaymentOrder({
  apiKey,
  xSignatureKey,
  paymentOrderId,
  useSandbox = false,
  epoch = epochNow()
}) {
  const id = String(paymentOrderId || '').trim();
  return billplzrequest({
    apiKey,
    version: 'v5',
    endpoint: `/payment_orders/${encodeURIComponent(id)}`,
    method: 'get',
    params: {
      epoch,
      checksum: signBillplzV5Checksum([id, epoch], xSignatureKey)
    },
    useSandbox
  });
}

async function getPaymentOrderLimit({
  apiKey,
  xSignatureKey,
  useSandbox = false,
  epoch = epochNow()
}) {
  return billplzrequest({
    apiKey,
    version: 'v5',
    endpoint: '/payment_order_limit',
    method: 'get',
    params: {
      epoch,
      checksum: signBillplzV5Checksum([epoch], xSignatureKey)
    },
    useSandbox
  });
}

module.exports = {
  createPaymentOrderCollection,
  getPaymentOrderCollection,
  createPaymentOrder,
  getPaymentOrder,
  getPaymentOrderLimit
};
