/**
 * Telegram Bot API helpers + pending two-step confirm for ECS ops.
 *
 * setWebhook (run once on machine with curl):
 *   curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
 *     -H "Content-Type: application/json" \
 *     -d "{\"url\":\"https://<YOUR_API_HOST>/api/telegram-ops/webhook\",\"secret_token\":\"<same as TELEGRAM_WEBHOOK_SECRET>\"}"
 */

const crypto = require('crypto');
const { execFile } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/** @type {Map<string, { action: string, fromId: number, expiresAt: number }>} */
const pendingById = new Map();

function getRepoRoot() {
  const r = String(process.env.APP_ROOT || process.cwd()).trim();
  return r || process.cwd();
}

function getPendingTtlMs() {
  const min = Number(process.env.TELEGRAM_OPS_PENDING_TTL_MINUTES || 10);
  return Math.max(1, Math.min(120, min)) * 60 * 1000;
}

function parseAllowedIds() {
  const raw = String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '').trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function isAllowedTelegramUser(fromId) {
  const set = parseAllowedIds();
  if (!set.size) return false;
  return set.has(String(fromId));
}

function verifyWebhookSecret(req) {
  const want = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  const got = String(req.get('X-Telegram-Bot-Api-Secret-Token') || '').trim();
  return !!(want && got && got === want);
}

function getBotToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

function pruneExpiredPending() {
  const now = Date.now();
  for (const [id, row] of pendingById.entries()) {
    if (row.expiresAt <= now) pendingById.delete(id);
  }
}

function createPending(action, fromId) {
  pruneExpiredPending();
  const id = crypto.randomBytes(20).toString('hex');
  pendingById.set(id, {
    action,
    fromId,
    expiresAt: Date.now() + getPendingTtlMs()
  });
  return id;
}

function takePending(id, fromId) {
  pruneExpiredPending();
  const row = pendingById.get(id);
  if (!row) return { ok: false, reason: 'EXPIRED_OR_MISSING' };
  if (row.expiresAt <= Date.now()) {
    pendingById.delete(id);
    return { ok: false, reason: 'EXPIRED_OR_MISSING' };
  }
  if (row.fromId !== fromId) return { ok: false, reason: 'FORBIDDEN' };
  pendingById.delete(id);
  return { ok: true, action: row.action };
}

function deletePending(id) {
  pendingById.delete(id);
}

async function telegramApi(method, body) {
  const token = getBotToken();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN missing');
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    console.warn('[telegram-ops] telegramApi', method, data?.description || res.status);
  }
  return data;
}

function truncateTelegram(s, max = 3500) {
  const t = String(s || '');
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…(truncated)`;
}

function getPm2RestartNames() {
  const on =
    String(process.env.TELEGRAM_OPS_PULL_RESTART_PM2 || '')
      .trim()
      .toLowerCase() === '1' ||
    String(process.env.TELEGRAM_OPS_PULL_RESTART_PM2 || '')
      .trim()
      .toLowerCase() === 'true';
  if (!on) return [];
  const raw = String(process.env.TELEGRAM_OPS_PM2_NAMES || '').trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[a-zA-Z0-9_.-]+$/.test(s));
}

function buildPullPreviewPlain() {
  const root = getRepoRoot();
  const scriptRel = 'scripts/ops-git-pull-main.sh';
  const scriptAbs = path.join(root, scriptRel);
  const pm2Names = getPm2RestartNames();
  const pm2Line =
    pm2Names.length > 0
      ? `After success: pm2 restart ${pm2Names.join(' ')}`
      : 'After success: no PM2 restart (set TELEGRAM_OPS_PULL_RESTART_PM2=1 and TELEGRAM_OPS_PM2_NAMES to enable).';
  return [
    'Pending action: git pull origin main',
    `Repo root: ${root}`,
    `Script: ${scriptAbs}`,
    'Steps: git fetch origin → git pull origin main',
    pm2Line,
    '',
    'Tap Confirm to run, or Cancel.'
  ].join('\n');
}

function matchCommand(text) {
  const t = String(text || '').trim();
  if (/^\/pull(@\w+)?$/i.test(t)) return 'pull';
  if (/^\/start(@\w+)?$/i.test(t)) return 'start';
  return null;
}

async function sendMessage(chatId, text, extra = {}) {
  return telegramApi('sendMessage', {
    chat_id: chatId,
    text: truncateTelegram(text, 4090),
    ...extra
  });
}

async function answerCallbackQuery(callbackQueryId, text, showAlert = false) {
  return telegramApi('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: text ? String(text).slice(0, 200) : undefined,
    show_alert: showAlert
  });
}

async function editMessageText(chatId, messageId, text) {
  return telegramApi('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: truncateTelegram(text, 4090)
  });
}

async function runGitPullMain() {
  const root = getRepoRoot();
  const scriptPath = path.join(root, 'scripts', 'ops-git-pull-main.sh');
  const { stdout, stderr } = await execFileAsync('/bin/bash', [scriptPath], {
    cwd: root,
    env: { ...process.env, APP_ROOT: root },
    timeout: 120000,
    maxBuffer: 512 * 1024
  });
  const out = [stdout, stderr].filter(Boolean).join('\n');
  return { ok: true, output: out || '(no output)' };
}

async function runPm2RestartIfConfigured() {
  const names = getPm2RestartNames();
  if (!names.length) return { ran: false, output: '' };
  try {
    const { stdout, stderr } = await execFileAsync('pm2', ['restart', ...names], {
      env: process.env,
      timeout: 120000,
      maxBuffer: 256 * 1024
    });
    return { ran: true, output: [stdout, stderr].filter(Boolean).join('\n') };
  } catch (err) {
    const msg = err?.stderr || err?.message || String(err);
    throw new Error(`pm2 restart failed: ${msg}`);
  }
}

function isTelegramOpsConfigured() {
  return !!(
    String(process.env.TELEGRAM_BOT_TOKEN || '').trim() &&
    String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim() &&
    String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '').trim()
  );
}

module.exports = {
  isTelegramOpsConfigured,
  verifyWebhookSecret,
  isAllowedTelegramUser,
  createPending,
  takePending,
  deletePending,
  matchCommand,
  buildPullPreviewPlain,
  sendMessage,
  answerCallbackQuery,
  editMessageText,
  runGitPullMain,
  runPm2RestartIfConfigured,
  truncateTelegram
};
