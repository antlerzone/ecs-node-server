/**
 * Bukku: Receipt (money received) – banking income / receipt voucher.
 * Uses bankingIncome API for recording receipt of funds.
 */

const bankingIncome = require('./bankingIncome.wrapper');

module.exports = {
  createReceipt: bankingIncome.create,
  listReceipts: bankingIncome.list,
  getReceipt: bankingIncome.read,
  updateReceipt: bankingIncome.update
};
