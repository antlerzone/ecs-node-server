/**
 * Xero Accounting API – Bank Transactions (Spend Money / Receive Money).
 * @see https://developer.xero.com/documentation/api/accounting/banktransactions
 */

const xerorequest = require('./xerorequest');
const { getXeroCreds } = require('../lib/xeroCreds');

/**
 * Create bank transaction(s). POST /BankTransactions
 * Body: { BankTransactions: [{ Type, Contact, LineItems, BankAccount, Date?, Reference? }] }
 * Type: SPEND | RECEIVE. BankAccount: { Code } or { AccountID }. LineItems: [{ Description, Quantity, UnitAmount, AccountCode }]
 */
async function createBankTransaction(req, payload) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  const body = Array.isArray(payload.BankTransactions) ? payload : { BankTransactions: [payload] };
  if (!body.BankTransactions || !body.BankTransactions.length) body.BankTransactions = [payload];
  return xerorequest({
    method: 'post',
    endpoint: '/BankTransactions',
    accessToken,
    tenantId,
    data: body
  });
}

/**
 * Delete (void/remove) a bank transaction by ID.
 */
async function deleteBankTransaction(req, bankTransactionId) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  return xerorequest({
    method: 'delete',
    endpoint: `/BankTransactions/${encodeURIComponent(bankTransactionId)}`,
    accessToken,
    tenantId
  });
}

/**
 * Update bank transaction status. Common rollback status: DELETED.
 */
async function updateBankTransactionStatus(req, bankTransactionId, status) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  const body = {
    BankTransactionID: bankTransactionId,
    Status: status
  };
  return xerorequest({
    method: 'post',
    endpoint: `/BankTransactions/${encodeURIComponent(bankTransactionId)}`,
    accessToken,
    tenantId,
    data: body
  });
}

module.exports = {
  createBankTransaction,
  deleteBankTransaction,
  updateBankTransactionStatus
};
