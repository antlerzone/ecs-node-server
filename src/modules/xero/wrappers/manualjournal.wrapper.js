/**
 * Xero Accounting API – Manual Journals (DR/CR journal entry).
 * @see https://developer.xero.com/documentation/api/accounting/manualjournals
 * LineAmount: negative = debit, positive = credit. JournalLines must balance (sum to zero).
 */

const xerorequest = require('./xerorequest');
const { getXeroCreds } = require('../lib/xeroCreds');

/**
 * Create manual journal(s). POST /ManualJournals
 * @param {object} req - { client: { id } } for getXeroCreds
 * @param {object} payload - { ManualJournals: [{ Narration, Date, JournalLines: [{ Description, LineAmount, AccountCode }] }] }
 *   or single object: { Narration, Date, JournalLines }
 * @returns {Promise<{ ok: boolean, data?: object, error?: string }>}
 */
async function create(req, payload) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  const body = Array.isArray(payload.ManualJournals)
    ? payload
    : { ManualJournals: [payload] };
  if (!body.ManualJournals || !body.ManualJournals.length) {
    body.ManualJournals = [payload];
  }
  return xerorequest({
    method: 'post',
    endpoint: '/ManualJournals',
    accessToken,
    tenantId,
    data: body
  });
}

module.exports = { create };
