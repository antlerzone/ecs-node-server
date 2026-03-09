/**
 * SQL Account API: Journal Entry (GL journal / general ledger).
 * Path 以 Postman Collection 為準；若實際 endpoint 不同請改 path 或由 env 覆寫。
 * @see https://wiki.sql.com.my/wiki/SQL_Accounting_Linking
 */

const sqlaccountrequest = require('./sqlaccountrequest');

const JOURNAL_PATH = process.env.SQLACCOUNT_JOURNAL_PATH || 'JournalEntry';

/**
 * Create journal entry. POST /JournalEntry (or path from Postman).
 * @param {object} req - Express request (req.client = client for creds)
 * @param {object} payload - Body per SQL Account API（例如 Date, Description, Lines: [{ AccountCode, Debit, Credit }]）
 * @returns {Promise<{ ok: boolean, data?: any, error?: any }>}
 */
async function createJournalEntry(req, payload) {
  return sqlaccountrequest({
    req,
    method: 'post',
    path: JOURNAL_PATH.startsWith('/') ? JOURNAL_PATH : `/${JOURNAL_PATH}`,
    data: payload || {}
  });
}

module.exports = {
  createJournalEntry
};
