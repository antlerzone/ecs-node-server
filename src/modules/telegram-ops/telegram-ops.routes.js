/**
 * POST /api/telegram-ops/webhook
 * Telegram Bot updates (message + callback_query). Requires X-Telegram-Bot-Api-Secret-Token.
 */

const express = require('express');
const svc = require('./telegram-ops.service');

const router = express.Router();

function parseCallbackData(data) {
  const d = String(data || '');
  if (d.startsWith('cf:')) return { kind: 'confirm', id: d.slice(3) };
  if (d.startsWith('cn:')) return { kind: 'cancel', id: d.slice(3) };
  return null;
}

async function safeEditMessageText(chatId, messageId, text) {
  try {
    await svc.editMessageText(chatId, messageId, text);
  } catch (e) {
    console.warn('[telegram-ops] editMessageText', e?.message || e);
  }
}

async function handlePullConfirm(chatId, fromId, callbackQueryId, messageId, pendingId) {
  const taken = svc.takePending(pendingId, fromId);
  if (!taken.ok) {
    await svc.answerCallbackQuery(
      callbackQueryId,
      taken.reason === 'FORBIDDEN' ? 'Not allowed.' : 'Expired or already used. Send /pull again.',
      true
    );
    return;
  }
  if (taken.action !== 'GIT_PULL_MAIN') {
    await svc.answerCallbackQuery(callbackQueryId, 'Unknown action.', true);
    return;
  }
  await svc.answerCallbackQuery(callbackQueryId, 'Running…', false);
  await safeEditMessageText(chatId, messageId, 'Running git pull…');

  let pullOut = '';
  let pullOk = false;
  try {
    const r = await svc.runGitPullMain();
    pullOut = r.output;
    pullOk = true;
  } catch (e) {
    pullOut = e?.stderr || e?.stdout || e?.message || String(e);
    await svc.sendMessage(chatId, svc.truncateTelegram(`git pull failed:\n${pullOut}`));
    await safeEditMessageText(chatId, messageId, 'git pull failed (see next message).');
    return;
  }

  let pm2Out = '';
  try {
    const pm2 = await svc.runPm2RestartIfConfigured();
    if (pm2.ran) pm2Out = `\n\npm2:\n${pm2.output || '(no output)'}`;
  } catch (e) {
    pm2Out = `\n\npm2 restart error:\n${e?.message || String(e)}`;
  }

  const summary = svc.truncateTelegram(`git pull OK:\n${pullOut}${pm2Out}`);
  await svc.sendMessage(chatId, summary);
  await safeEditMessageText(
    chatId,
    messageId,
    pullOk ? 'Done. Output sent as a new message.' : 'Failed.'
  );
}

async function handleUpdate(update) {
  if (update.callback_query) {
    const cq = update.callback_query;
    const fromId = cq.from?.id;
    const chatId = cq.message?.chat?.id;
    const messageId = cq.message?.message_id;
    const data = parseCallbackData(cq.data);
    if (!fromId || !chatId || !messageId || !data || !data.id) return;

    if (!svc.isAllowedTelegramUser(fromId)) return;

    if (data.kind === 'cancel') {
      svc.deletePending(data.id);
      await svc.answerCallbackQuery(cq.id, 'Cancelled.', false);
      await safeEditMessageText(chatId, messageId, 'Cancelled. No action was run.');
      return;
    }

    if (data.kind === 'confirm') {
      await handlePullConfirm(chatId, fromId, cq.id, messageId, data.id);
    }
    return;
  }

  const msg = update.message;
  if (!msg || !msg.text) return;

  const fromId = msg.from?.id;
  const chatId = msg.chat?.id;
  if (!fromId || !chatId) return;

  if (!svc.isAllowedTelegramUser(fromId)) {
    console.log('[telegram-ops] ignored message from non-whitelisted user', fromId);
    return;
  }

  const cmd = svc.matchCommand(msg.text);
  if (cmd === 'start') {
    await svc.sendMessage(
      chatId,
      'ECS ops bot.\nCommands:\n/pull — preview git pull origin main, then confirm.'
    );
    return;
  }

  if (cmd === 'pull') {
    const pendingId = svc.createPending('GIT_PULL_MAIN', fromId);
    const preview = svc.buildPullPreviewPlain();
    await svc.sendMessage(chatId, preview, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Confirm', callback_data: `cf:${pendingId}` },
            { text: 'Cancel', callback_data: `cn:${pendingId}` }
          ]
        ]
      }
    });
  }
}

router.post('/webhook', async (req, res) => {
  if (!svc.verifyWebhookSecret(req)) {
    return res.status(401).send('Unauthorized');
  }

  const update = req.body;
  if (!update || typeof update !== 'object') {
    return res.status(400).send('Bad Request');
  }

  const longRunning =
    !!update.callback_query &&
    String(update.callback_query.data || '').startsWith('cf:');

  if (longRunning) {
    res.status(200).json({ ok: true });
    setImmediate(() => {
      handleUpdate(update).catch((e) => console.error('[telegram-ops] async update', e?.message || e));
    });
    return;
  }

  try {
    await handleUpdate(update);
  } catch (e) {
    console.error('[telegram-ops] handleUpdate', e?.message || e);
  }
  return res.status(200).json({ ok: true });
});

module.exports = router;
