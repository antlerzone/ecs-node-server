/**
 * AI Router: route OCR requests to operator-configured provider (Gemini / OpenAI / DeepSeek).
 * Platform does not pay for AI; operator supplies API key in client_integration (key=aiProvider).
 * Stub: returns mock OCR or calls provider when implemented.
 */

const pool = require('../../config/db');

const AI_PROVIDER_KEY = 'aiProvider';
const PROVIDERS = ['gemini', 'openai', 'deepseek'];

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

/**
 * Get operator AI config from client_integration.
 * @param {string} clientId
 * @returns {Promise<{ provider: string, api_key: string, model?: string }|null>}
 */
async function getOperatorAiConfig(clientId) {
  const [rows] = await pool.query(
    `SELECT provider, values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = ? AND enabled = 1 LIMIT 1`,
    [clientId, AI_PROVIDER_KEY]
  );
  if (!rows.length) return null;
  const values = parseJson(rows[0].values_json) || {};
  const provider = (rows[0].provider || values.provider || '').toString().toLowerCase();
  if (!PROVIDERS.includes(provider)) return null;
  const api_key = values.api_key || values.apiKey;
  if (!api_key) return null;
  return {
    provider,
    api_key,
    model: values.model || (provider === 'gemini' ? 'gemini-pro' : provider === 'openai' ? 'gpt-4o-mini' : 'deepseek-chat')
  };
}

/**
 * Extract receipt fields from image URL via AI. Stub: returns mock structure.
 * TODO: Implement actual calls to Gemini / OpenAI / DeepSeek vision API using getOperatorAiConfig(clientId).
 * @param {string} clientId
 * @param {string} receiptImageUrl - URL of receipt image (e.g. OSS)
 * @returns {Promise<{ amount?: number, currency?: string, reference_number?: string, transaction_id?: string, payer_name?: string, transaction_date?: string, bank_name?: string }>}
 */
async function extractReceiptWithAi(clientId, receiptImageUrl) {
  const config = await getOperatorAiConfig(clientId);
  if (!config) {
    return mockOcrResult(receiptImageUrl);
  }
  // TODO: call provider based on config.provider with config.api_key and config.model
  // e.g. Gemini: generativeai.getGenerativeModel({ model }).generateContent([imagePart, textPart])
  // OpenAI: openai.chat.completions.create with vision model and image_url
  return mockOcrResult(receiptImageUrl);
}

function mockOcrResult(receiptImageUrl) {
  return {
    amount: null,
    currency: '',
    reference_number: null,
    transaction_id: null,
    payer_name: null,
    transaction_date: null,
    bank_name: null,
    _mock: true,
    _url: receiptImageUrl
  };
}

module.exports = {
  getOperatorAiConfig,
  extractReceiptWithAi,
  AI_PROVIDER_KEY,
  PROVIDERS
};
