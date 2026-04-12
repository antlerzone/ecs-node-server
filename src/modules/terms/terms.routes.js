/**
 * Terms & Conditions API – SaaS–Operator: get terms content + acceptance status, sign with hash.
 * All endpoints require operator context (email → clientId via access).
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail } = require('../access/access.service');
const { getClientIp } = require('../../utils/requestIp');
const { getTermsSaasOperator, signTermsSaasOperator } = require('./terms.service');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

async function requireClient(req, res, next) {
  const path = (req.originalUrl || req.url || req.path || '').split('?')[0];
  const email = getEmail(req);
  console.log('[terms requireClient]', path, 'req.clientId=', req.clientId ?? '(null)', 'req.client=', !!req.client, 'body.email=', email ?? '(none)', 'req.apiUser=', !!req.apiUser);
  if (req.clientId != null && req.client) {
    console.log('[terms requireClient] pass (has client)', path);
    req.ctx = { client: req.client };
    return next();
  }
  // Portal proxy calls with empty body {} (no email). Allow through so handler returns terms content only; acceptance is per-client so we use no client here.
  if (req.apiUser && !email) {
    console.log('[terms requireClient] pass (apiUser + no email → saasAdminNoClient)', path);
    req.clientId = null;
    req.saasAdminNoClient = true;
    return next();
  }
  if (req.apiUser && email) {
    const ctx = await getAccessContextByEmail(email);
    console.log('[terms requireClient] getAccessContextByEmail', path, 'ctx.ok=', ctx.ok, 'ctx.client?.id=', ctx.client?.id ?? '(null)', 'ctx.isSaasAdmin=', !!ctx.isSaasAdmin);
    const clientId = ctx.client?.id ?? null;
    // Portal: email may not resolve to a client (e.g. NO_STAFF, NO_CLIENT). Still allow through to return terms content only.
    if (!ctx.ok || !clientId) {
      console.log('[terms requireClient] pass (apiUser+email but no client → saasAdminNoClient)', path, 'ctx.reason=', ctx.reason);
      req.clientId = null;
      req.saasAdminNoClient = true;
      return next();
    }
    req.clientId = clientId;
    console.log('[terms requireClient] pass (clientId from email)', path);
    return next();
  }
  if (!email) {
    console.log('[terms requireClient] 400 NO_EMAIL', path);
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  }
  const ctx = await getAccessContextByEmail(email);
  console.log('[terms requireClient] getAccessContextByEmail (no apiUser)', path, 'ctx.ok=', ctx.ok, 'ctx.client?.id=', ctx.client?.id ?? '(null)');
  if (!ctx.ok) {
    console.log('[terms requireClient] 403 ACCESS_DENIED', path, 'reason=', ctx.reason);
    return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
  }
  const clientId = ctx.client?.id ?? null;
  if (!clientId && ctx.isSaasAdmin) {
    console.log('[terms requireClient] pass (isSaasAdmin no client)', path);
    req.clientId = null;
    req.saasAdminNoClient = true;
    return next();
  }
  if (!clientId) {
    console.log('[terms requireClient] 403 NO_CLIENT', path);
    return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
  }
  req.clientId = clientId;
  console.log('[terms requireClient] pass (clientId from email)', path);
  next();
}

/**
 * POST /api/terms/saas-operator
 * Body: { email, clientId? }
 * Returns: { ok, content, version, contentHash, accepted, acceptedAt?, signatureHash? }
 */
router.post('/saas-operator', requireClient, async (req, res, next) => {
  try {
    const apiUserId = req.saasAdminNoClient && req.apiUser ? req.apiUser.id : null;
    console.log('[terms /saas-operator] handler', 'req.clientId=', req.clientId ?? '(null)', 'req.saasAdminNoClient=', !!req.saasAdminNoClient, 'apiUserId=', apiUserId ?? '(null)');
    const result = await getTermsSaasOperator(req.clientId, apiUserId);
    console.log('[terms /saas-operator] getTermsSaasOperator result.ok=', result.ok, 'result.noClient=', !!result.noClient);
    if (!result.ok) {
      const status = result.reason === 'TERMS_TABLE_MISSING' ? 503 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[terms] saas-operator', err?.message || err);
    next(err);
  }
});

/**
 * POST /api/terms/saas-operator/sign
 * Body: { email, clientId?, signature }
 * Records signature + IP + signature_hash (SHA256 chain for non-repudiation).
 * When operator has no client (saasAdminNoClient), signing is allowed and stored by api_user_id.
 */
router.post('/saas-operator/sign', requireClient, async (req, res, next) => {
  try {
    const apiUserId = req.saasAdminNoClient && req.apiUser ? req.apiUser.id : null;
    const canSignByClient = req.clientId != null;
    const canSignByApiUser = req.saasAdminNoClient && apiUserId != null;
    console.log('[terms /saas-operator/sign] handler', 'req.clientId=', req.clientId ?? '(null)', 'req.saasAdminNoClient=', !!req.saasAdminNoClient, 'apiUserId=', apiUserId ?? '(null)', 'body.signature=', req.body?.signature ? '(present)' : '(missing)');
    if (!canSignByClient && !canSignByApiUser) {
      console.log('[terms /saas-operator/sign] 403 SIGN_REQUIRES_OPERATOR (no client and no apiUser)');
      return res.status(403).json({
        ok: false,
        reason: 'SIGN_REQUIRES_OPERATOR',
        message: 'You must be logged in to accept the terms.'
      });
    }
    const signature = req.body?.signature;
    const signedIp = getClientIp(req);
    const clientId = req.clientId || null;
    console.log('[terms /saas-operator/sign] calling signTermsSaasOperator clientId=', clientId ?? '(null)', 'apiUserId=', apiUserId ?? '(null)');
    const result = await signTermsSaasOperator(clientId, apiUserId, { signature }, signedIp);
    console.log('[terms /saas-operator/sign] signTermsSaasOperator result.ok=', result.ok, 'result.reason=', result.reason ?? '(none)');
    if (!result.ok) {
      const status = result.reason === 'TERMS_TABLE_MISSING' ? 503 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[terms] saas-operator/sign', err?.message || err);
    next(err);
  }
});

module.exports = router;
