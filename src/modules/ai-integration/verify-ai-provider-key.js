/**
 * Verify operator-supplied AI API keys with a minimal HTTP call; only HTTP 200 counts as success.
 */

const axios = require('axios');

const VERIFY_TIMEOUT_MS = 15000;

function failVerify(status, hint) {
  const err = new Error('AI_KEY_VERIFY_FAILED');
  err.code = 'AI_KEY_VERIFY_FAILED';
  err.status = status;
  if (hint) err.hint = hint;
  return err;
}

async function verifyOpenAiModels(apiKey) {
  const res = await axios.get('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    params: { limit: 1 },
    timeout: VERIFY_TIMEOUT_MS,
    validateStatus: () => true,
  });
  if (res.status !== 200) throw failVerify(res.status);
}

async function verifyDeepSeekModels(apiKey) {
  const res = await axios.get('https://api.deepseek.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    params: { limit: 1 },
    timeout: VERIFY_TIMEOUT_MS,
    validateStatus: () => true,
  });
  if (res.status === 200) return;
  if (res.status === 404) {
    await verifyDeepSeekMinimalChat(apiKey);
    return;
  }
  throw failVerify(res.status);
}

async function verifyDeepSeekMinimalChat(apiKey) {
  const res = await axios.post(
    'https://api.deepseek.com/v1/chat/completions',
    {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'ok' }],
      max_tokens: 1,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: VERIFY_TIMEOUT_MS,
      validateStatus: () => true,
    }
  );
  if (res.status !== 200) throw failVerify(res.status);
}

async function verifyGemini(apiKey) {
  const res = await axios.get('https://generativelanguage.googleapis.com/v1beta/models', {
    params: { key: apiKey, pageSize: 1 },
    timeout: VERIFY_TIMEOUT_MS,
    validateStatus: () => true,
  });
  if (res.status !== 200) throw failVerify(res.status);
}

/**
 * @param {string} provider - openai | deepseek | gemini
 * @param {string} apiKey
 * @returns {Promise<void>}
 */
async function verifyAiProviderKey(provider, apiKey) {
  const p = String(provider || '').trim().toLowerCase();
  const key = String(apiKey || '').trim();
  if (!key) {
    const e = new Error('API_KEY_REQUIRED');
    e.code = 'API_KEY_REQUIRED';
    throw e;
  }
  try {
    if (p === 'openai') {
      await verifyOpenAiModels(key);
      return;
    }
    if (p === 'deepseek') {
      await verifyDeepSeekModels(key);
      return;
    }
    if (p === 'gemini') {
      await verifyGemini(key);
      return;
    }
    const e = new Error('INVALID_AI_PROVIDER');
    e.code = 'INVALID_AI_PROVIDER';
    throw e;
  } catch (err) {
    if (err.code && ['API_KEY_REQUIRED', 'INVALID_AI_PROVIDER', 'AI_KEY_VERIFY_FAILED', 'AI_VERIFY_TIMEOUT'].includes(err.code)) {
      throw err;
    }
    if (err.code === 'ECONNABORTED' || String(err.message || '').toLowerCase().includes('timeout')) {
      const e = new Error('AI_VERIFY_TIMEOUT');
      e.code = 'AI_VERIFY_TIMEOUT';
      throw e;
    }
    if (err.response) {
      const st = err.response.status;
      console.warn('[verify-ai-provider-key] vendor HTTP error status=%s', st);
      throw failVerify(st);
    }
    console.warn('[verify-ai-provider-key] request failed', err?.message || err);
    throw failVerify(undefined, err?.message);
  }
}

module.exports = {
  verifyAiProviderKey,
};
