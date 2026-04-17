/**
 * SaaS platform rules for Cleanlemons operator AI — stored in `cln_saasadmin_ai_md`.
 */

const axios = require('axios');
const crypto = require('crypto');
const pool = require('../../config/db');

function uuid() {
  return crypto.randomUUID();
}

function openAiCompatibleUrl(provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'deepseek') return 'https://api.deepseek.com/v1/chat/completions';
  return 'https://api.openai.com/v1/chat/completions';
}

function defaultModel(provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'gemini') return 'gemini-1.5-flash';
  if (p === 'deepseek') return 'deepseek-chat';
  return 'gpt-4o-mini';
}

async function callChatCompletionsOpenAiCompatible({ apiKey, provider, model, messages, temperature = 0.2 }) {
  const url = openAiCompatibleUrl(provider);
  const { data } = await axios.post(
    url,
    {
      model: model || defaultModel(provider),
      messages,
      temperature,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    }
  );
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('LLM_EMPTY_RESPONSE');
  return String(text);
}

async function callGemini({ apiKey, model, messagesText }) {
  const m = model || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const { data } = await axios.post(
    url,
    {
      contents: [{ role: 'user', parts: [{ text: messagesText }] }],
      generationConfig: { temperature: 0.2 },
    },
    { timeout: 120000 }
  );
  const t = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!t) throw new Error('LLM_EMPTY_RESPONSE');
  return String(t);
}

function isMissingTable(err) {
  const c = String(err?.code || '');
  const msg = String(err?.message || '');
  return c === 'ER_NO_SUCH_TABLE' || msg.includes("doesn't exist") || msg.includes('Unknown table');
}

/**
 * Prefix to prepend to every operator schedule-AI system prompt. Empty if no rows / table missing.
 */
async function getPlatformRulesPromptPrefix() {
  try {
    const [rows] = await pool.query(
      `SELECT rule_code AS ruleCode, title, body_md FROM cln_saasadmin_ai_md ORDER BY sort_order ASC, created_at ASC`
    );
    if (!rows?.length) return '';
    const parts = (rows || []).map((r) => {
      const code = String(r.ruleCode || '').trim();
      const codeTag = code ? `[${code}] ` : '';
      const t = String(r.title || '').trim() || 'Rule';
      const b = String(r.body_md || '').trim();
      return `# ${codeTag}${t}\n${b}`;
    });
    return `Platform rules (highest priority; must follow before anything else):\n\n${parts.join(
      '\n\n---\n\n'
    )}\n\n`;
  } catch (err) {
    if (isMissingTable(err)) return '';
    throw err;
  }
}

async function listSaasadminAiMd() {
  const [rows] = await pool.query(
    `SELECT id, rule_code AS ruleCode, title, body_md AS bodyMd, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
     FROM cln_saasadmin_ai_md
     ORDER BY sort_order ASC, created_at ASC`
  );
  return rows || [];
}

async function allocateNextRuleCode() {
  const [rows] = await pool.query(
    `SELECT LPAD(IFNULL(MAX(CAST(rule_code AS UNSIGNED)), 0) + 1, 4, '0') AS nextCode FROM cln_saasadmin_ai_md`
  );
  const c = rows?.[0]?.nextCode;
  return c != null ? String(c) : '0001';
}

async function createSaasadminAiMd({ title, bodyMd, sortOrder }) {
  const id = uuid();
  const t = String(title || '').trim();
  if (!t) throw new Error('TITLE_REQUIRED');
  const body = bodyMd != null ? String(bodyMd) : '';
  const so = Number.isFinite(Number(sortOrder)) ? Math.floor(Number(sortOrder)) : 0;
  const ruleCode = await allocateNextRuleCode();
  await pool.query(
    `INSERT INTO cln_saasadmin_ai_md (id, rule_code, title, body_md, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
    [id, ruleCode, t.slice(0, 512), body, so]
  );
  const [rows] = await pool.query(
    `SELECT id, rule_code AS ruleCode, title, body_md AS bodyMd, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
     FROM cln_saasadmin_ai_md WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0];
}

async function updateSaasadminAiMd(id, { title, bodyMd, sortOrder }) {
  const rid = String(id || '').trim();
  if (!rid) throw new Error('MISSING_ID');
  const patches = [];
  const vals = [];
  if (title !== undefined) {
    const t = String(title || '').trim();
    if (!t) throw new Error('TITLE_REQUIRED');
    patches.push('title = ?');
    vals.push(t.slice(0, 512));
  }
  if (bodyMd !== undefined) {
    patches.push('body_md = ?');
    vals.push(String(bodyMd));
  }
  if (sortOrder !== undefined && Number.isFinite(Number(sortOrder))) {
    patches.push('sort_order = ?');
    vals.push(Math.floor(Number(sortOrder)));
  }
  if (!patches.length) throw new Error('NOTHING_TO_UPDATE');
  vals.push(rid);
  const [r] = await pool.query(`UPDATE cln_saasadmin_ai_md SET ${patches.join(', ')} WHERE id = ?`, vals);
  if (!r.affectedRows) throw new Error('NOT_FOUND');
  const [rows] = await pool.query(
    `SELECT id, rule_code AS ruleCode, title, body_md AS bodyMd, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
     FROM cln_saasadmin_ai_md WHERE id = ? LIMIT 1`,
    [rid]
  );
  return rows[0];
}

async function deleteSaasadminAiMd(id) {
  const rid = String(id || '').trim();
  if (!rid) throw new Error('MISSING_ID');
  const [r] = await pool.query('DELETE FROM cln_saasadmin_ai_md WHERE id = ?', [rid]);
  if (!r.affectedRows) throw new Error('NOT_FOUND');
  return { ok: true };
}

function normalizeChatMessages(body) {
  if (Array.isArray(body?.messages) && body.messages.length) {
    return body.messages
      .map((m) => ({
        role: String(m?.role || 'user').toLowerCase(),
        content: String(m?.content ?? '').slice(0, 48000),
      }))
      .filter((m) => m.content && ['user', 'assistant', 'system'].includes(m.role));
  }
  const one = String(body?.message || '').trim();
  if (one) return [{ role: 'user', content: one.slice(0, 48000) }];
  return [];
}

/**
 * Admin assist chat — uses platform env key (not operator key).
 */
async function runSaasadminAiChat(body = {}) {
  const provider = String(process.env.CLEANLEMON_SAASADMIN_AI_PROVIDER || 'openai').toLowerCase();
  const apiKey = String(process.env.CLEANLEMON_SAASADMIN_AI_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('SAASADMIN_AI_NOT_CONFIGURED');
    err.code = 'SAASADMIN_AI_NOT_CONFIGURED';
    throw err;
  }
  const envModel = String(process.env.CLEANLEMON_SAASADMIN_AI_MODEL || '').trim();
  const model = envModel || defaultModel(provider);
  const extraSystem = String(process.env.CLEANLEMON_SAASADMIN_AI_CHAT_SYSTEM || '').trim();

  const msgs = normalizeChatMessages(body);
  if (!msgs.length) throw new Error('EMPTY_MESSAGES');

  if (provider === 'gemini') {
    const lines = [];
    if (extraSystem) lines.push(`System:\n${extraSystem}\n`);
    for (const m of msgs) {
      lines.push(`${m.role}:\n${m.content}\n`);
    }
    const text = await callGemini({ apiKey, model, messagesText: lines.join('\n') });
    return { reply: text };
  }

  const messages = [];
  if (extraSystem) {
    messages.push({ role: 'system', content: extraSystem.slice(0, 12000) });
  }
  for (const m of msgs) {
    messages.push({ role: m.role, content: m.content });
  }

  const reply = await callChatCompletionsOpenAiCompatible({
    apiKey,
    provider,
    model,
    messages,
    temperature: 0.2,
  });
  return { reply };
}

module.exports = {
  getPlatformRulesPromptPrefix,
  listSaasadminAiMd,
  createSaasadminAiMd,
  updateSaasadminAiMd,
  deleteSaasadminAiMd,
  runSaasadminAiChat,
};
