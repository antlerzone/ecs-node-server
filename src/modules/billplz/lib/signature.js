const { createHmac, timingSafeEqual } = require('crypto');

function stringifySignatureValue(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function flattenSignaturePairs(prefix, value, out) {
  if (!prefix) return;
  if (Array.isArray(value)) {
    for (const item of value) flattenSignaturePairs(prefix, item, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (String(key).toLowerCase() === 'x_signature') continue;
      flattenSignaturePairs(`${prefix}${key}`, value[key], out);
    }
    return;
  }
  out.push(`${prefix}${stringifySignatureValue(value)}`);
}

function buildBillplzXSignatureSourceString(payload = {}) {
  const pairs = [];
  if (!payload || typeof payload !== 'object') return '';
  for (const key of Object.keys(payload)) {
    if (String(key).toLowerCase() === 'x_signature') continue;
    flattenSignaturePairs(String(key), payload[key], pairs);
  }
  return pairs
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'accent' }))
    .join('|');
}

function signBillplzXSignature(payload, xSignatureKey) {
  const secret = String(xSignatureKey || '').trim();
  if (!secret) throw new Error('BILLPLZ_X_SIGNATURE_KEY_REQUIRED');
  const source = buildBillplzXSignatureSourceString(payload);
  return createHmac('sha256', secret).update(source).digest('hex');
}

function secureHexEqual(left, right) {
  const a = Buffer.from(String(left || '').trim().toLowerCase(), 'utf8');
  const b = Buffer.from(String(right || '').trim().toLowerCase(), 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function verifyBillplzXSignature(payload, xSignatureKey, providedSignature) {
  const expected = signBillplzXSignature(payload, xSignatureKey);
  return secureHexEqual(expected, providedSignature);
}

function buildBillplzV5RawString(orderedValues = []) {
  return orderedValues.map((value) => stringifySignatureValue(value)).join('');
}

function signBillplzV5Checksum(orderedValues, xSignatureKey) {
  const secret = String(xSignatureKey || '').trim();
  if (!secret) throw new Error('BILLPLZ_X_SIGNATURE_KEY_REQUIRED');
  return createHmac('sha512', secret).update(buildBillplzV5RawString(orderedValues)).digest('hex');
}

function verifyBillplzV5Checksum(orderedValues, xSignatureKey, providedChecksum) {
  const expected = signBillplzV5Checksum(orderedValues, xSignatureKey);
  return secureHexEqual(expected, providedChecksum);
}

function verifyBillplzPaymentOrderCallbackChecksum(payload, xSignatureKey) {
  const body = payload && typeof payload === 'object' ? payload : {};
  return verifyBillplzV5Checksum(
    [
      body.id,
      body.bank_account_number,
      body.status,
      body.total,
      body.reference_id,
      body.epoch
    ],
    xSignatureKey,
    body.checksum
  );
}

module.exports = {
  buildBillplzXSignatureSourceString,
  signBillplzXSignature,
  verifyBillplzXSignature,
  buildBillplzV5RawString,
  signBillplzV5Checksum,
  verifyBillplzV5Checksum,
  verifyBillplzPaymentOrderCallbackChecksum
};
