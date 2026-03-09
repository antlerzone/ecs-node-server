/**
 * AutoCount Cloud Accounting API – Product (Master Data).
 * @see https://accounting-api.autocountcloud.com/documentation/ (Master Data – Product)
 * Paths follow /{accountBookId}/product.
 */

const autocountrequest = require('./autocountrequest');
const { getAutoCountCreds } = require('../lib/autocountCreds');

/**
 * Get product listing. GET /{accountBookId}/product (or /product/listing; confirm with API docs).
 * @param {object} req - Express request (client resolved)
 * @param {object} [params] - Query params
 * @returns {Promise<{ ok: boolean, data?: any, error?: any }>}
 */
async function listProducts(req, params = {}) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  const res = await autocountrequest({
    method: 'get',
    accountBookId,
    endpoint: '/product',
    apiKey,
    keyId,
    params
  });
  if (!res.ok) return res;
  return { ok: true, data: res.data };
}

/**
 * Get one product by id/code.
 * @param {object} req - Express request
 * @param {string} productId - Product id or code
 */
async function getProduct(req, productId) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  const endpoint = `/product/${encodeURIComponent(productId)}`;
  return autocountrequest({
    method: 'get',
    accountBookId,
    endpoint,
    apiKey,
    keyId
  });
}

/**
 * Create product. POST /{accountBookId}/product
 * @param {object} req - Express request
 * @param {object} payload - Product input model (see API docs)
 */
async function createProduct(req, payload) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  return autocountrequest({
    method: 'post',
    accountBookId,
    endpoint: '/product',
    apiKey,
    keyId,
    data: payload || {}
  });
}

module.exports = {
  listProducts,
  getProduct,
  createProduct
};
