const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');
const { create_payment_schema } = require('../validators/invoicepayment.validator');
const { utcDatetimeFromDbToMalaysiaDateOnly } = require('../../../utils/dateMalaysia');

function toYmdForBukkuApi(v) {
  if (v == null) return v;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return v;
    return utcDatetimeFromDbToMalaysiaDateOnly(v);
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  return v;
}

function normalizeCreatePaymentBodyForBukkuApi(body) {
  if (!body || typeof body !== 'object') return body;
  const out = { ...body };
  if (out.date != null) out.date = toYmdForBukkuApi(out.date);
  return out;
}

async function createinvoicepayment(req, payload) {
  const { error, value } = create_payment_schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true
  });
  if (error) {
    const message = error.details.map((d) => d.message).join('; ');
    return {
      ok: false,
      error: {
        message: 'BUKKU_PAYMENT_PAYLOAD_INVALID',
        errors: error.details,
        validation: message
      }
    };
  }
  const data = normalizeCreatePaymentBodyForBukkuApi(value);
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/sales/payments', token, subdomain, data });
}

async function listinvoicepayments(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/sales/payments', token, subdomain, params: query });
}

async function readinvoicepayment(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/sales/payments/${transactionId}`, token, subdomain });
}

async function updateinvoicepayment(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/sales/payments/${transactionId}`, token, subdomain, data: payload });
}

async function updateinvoicepaymentstatus(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/sales/payments/${transactionId}`, token, subdomain, data: payload });
}

async function deleteinvoicepayment(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/sales/payments/${transactionId}`, token, subdomain });
}

module.exports = {
  createinvoicepayment,
  listinvoicepayments,
  readinvoicepayment,
  updateinvoicepayment,
  updateinvoicepaymentstatus,
  deleteinvoicepayment
};
