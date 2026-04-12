/**
 * Insert missing template rows in `account` so account_client FK (0157 / bukkuid import) succeeds.
 */
const { CANONICAL_ACCOUNT_ID_BY_TITLE } = require('./account-canonical-map');

const TITLE_TYPE = {
  'Management Fees': 'income',
  Other: 'income',
  Bank: 'asset',
  Cash: 'asset',
  Stripe: 'asset',
  Xendit: 'asset',
  Deposit: 'liability',
  'Platform Collection': 'liability',
  'Owner Commission': 'income',
  'Tenant Commission': 'income',
  'Agreement Fees': 'income',
  'Topup Aircond': 'income',
  'Rental Income': 'income',
  'Parking Fees': 'income',
  'Referral Fees': 'income',
  'Processing Fees': 'income',
};

async function ensureCanonicalAccounts(conn) {
  let n = 0;
  for (const [title, id] of Object.entries(CANONICAL_ACCOUNT_ID_BY_TITLE)) {
    const [rows] = await conn.query('SELECT 1 FROM account WHERE id = ? LIMIT 1', [id]);
    if (rows.length) continue;
    let insertType;
    let isProduct = 0;
    let usesPc = 0;
    if (title === 'Forfeit Deposit') {
      insertType = null;
      isProduct = 1;
      usesPc = 1;
    } else {
      insertType = TITLE_TYPE[title] !== undefined ? TITLE_TYPE[title] : 'income';
    }
    await conn.query(
      'INSERT INTO account (id, title, type, is_product, uses_platform_collection_gl, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
      [id, title, insertType, isProduct, usesPc]
    );
    n++;
  }
  return n;
}

module.exports = { ensureCanonicalAccounts };
