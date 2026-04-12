/**
 * SQL Account API: Journal Entry (Postman → /journalentry).
 */

const sqlaccountrequest = require('./sqlaccountrequest');
const { journalEntry: PATH } = require('../lib/postmanPaths');

const JOURNAL_PATH =
  process.env.SQLACCOUNT_JOURNAL_PATH && String(process.env.SQLACCOUNT_JOURNAL_PATH).trim()
    ? String(process.env.SQLACCOUNT_JOURNAL_PATH).trim().startsWith('/')
      ? String(process.env.SQLACCOUNT_JOURNAL_PATH).trim()
      : `/${String(process.env.SQLACCOUNT_JOURNAL_PATH).trim()}`
    : PATH;

function docPath(dockey) {
  const d = encodeURIComponent(String(dockey ?? '').trim());
  return `${JOURNAL_PATH}/${d}`;
}

async function list(req, params = {}) {
  return sqlaccountrequest({ req, method: 'get', path: JOURNAL_PATH, params });
}

async function read(req, dockey) {
  return sqlaccountrequest({ req, method: 'get', path: docPath(dockey) });
}

async function create(req, payload) {
  return sqlaccountrequest({ req, method: 'post', path: JOURNAL_PATH, data: payload || {} });
}

async function update(req, dockey, payload) {
  return sqlaccountrequest({ req, method: 'put', path: docPath(dockey), data: payload || {} });
}

async function remove(req, dockey) {
  return sqlaccountrequest({ req, method: 'delete', path: docPath(dockey) });
}

async function createJournalEntry(req, payload) {
  return create(req, payload);
}

module.exports = {
  list,
  read,
  create,
  update,
  remove,
  createJournalEntry
};
