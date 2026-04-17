/**
 * Cleanlemons portal — Smart Door Setting (same behavior as Coliving /api/smartdoorsetting).
 * TTLock + lockdetail rows scoped by cln_operatordetail.id (operator) or cln_clientdetail.id (B2B client).
 * Integrations: cln_operator_integration / cln_client_integration (smartDoor + ttlock) via ttlockToken.service.
 */

const express = require('express');
const router = express.Router();
const { verifyPortalToken } = require('../portal-auth/portal-auth.service');
const { getCleanlemonsPortalContext } = require('../access/access.service');
const svc = require('./cleanlemon.service');
const {
  getSmartDoorList,
  getSmartDoorFilters,
  getLock,
  getGateway,
  updateLock,
  updateGateway,
  remoteUnlockLock,
  previewSmartDoorSelection,
  syncTTLockName,
  getSmartDoorIdsByProperty,
  resolveSmartDoorLocationLabel,
  getChildLockOptions,
  insertGateways,
  insertLocks,
  deleteLock,
  deleteGateway,
  syncSmartDoorStatusFromTtlock,
  syncSingleLockStatusFromTtlock,
  syncSingleGatewayStatusFromTtlock,
} = require('../smartdoorsetting/smartdoorsetting.service');

function clientPortalAuthFromRequest(req, bodyEmail) {
  const auth = String(req.headers.authorization || '');
  const m = /^Bearer\s+(\S+)/i.exec(auth);
  if (m) {
    const payload = verifyPortalToken(m[1].trim());
    if (payload?.email) {
      return {
        email: String(payload.email).trim().toLowerCase(),
        jwtVerified: true,
      };
    }
    return { email: String(bodyEmail || '').trim().toLowerCase(), jwtVerified: false };
  }
  return { email: String(bodyEmail || '').trim().toLowerCase(), jwtVerified: false };
}

function stripSmartDoorBody(req) {
  const b = req.body && typeof req.body === 'object' ? { ...req.body } : {};
  delete b.email;
  delete b.operatorId;
  delete b.operator_id;
  return b;
}

/** lockdetail / gatewaydetail scope: Coliving uses plain operatordetail id; Cleanlemons uses dedicated columns. */
function clnOperatorScope(clnOperatorId) {
  return { kind: 'cln_operator', clnOperatorId: String(clnOperatorId || '').trim() };
}
/** Optional TTLock account slot (Cleanlemons B2B multi-login). Omitted / invalid → slot 0. */
function parseTtlockSlotFromRequest(req) {
  const v = req.body?.ttlockSlot ?? req.body?.ttlock_slot ?? req.query?.ttlockSlot ?? req.query?.ttlock_slot;
  if (v == null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function clnClientScope(clnClientId, ttlockSlotOpt) {
  const base = { kind: 'cln_client', clnClientId: String(clnClientId || '').trim() };
  if (ttlockSlotOpt == null || ttlockSlotOpt === '') return base;
  const n = Number(ttlockSlotOpt);
  if (!Number.isFinite(n) || n < 0) return base;
  return { ...base, ttlockSlot: n };
}

async function resolveOperatorTtlockClientId(req, res) {
  const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
  let operatorId = String(req.body?.operatorId || req.body?.operator_id || '').trim();
  if (!email) {
    res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    return null;
  }
  if (!operatorId && jwtVerified) {
    try {
      const ctx = await getCleanlemonsPortalContext(email);
      const choices = Array.isArray(ctx?.operatorChoices) ? ctx.operatorChoices : [];
      if (choices.length === 1) {
        operatorId = String(choices[0]?.operatorId || '').trim();
      }
    } catch (e) {
      console.warn('[cleanlemon-smartdoor] infer operatorId:', e?.message || e);
    }
  }
  if (!operatorId) {
    res.status(400).json({ ok: false, reason: 'MISSING_OPERATOR_ID' });
    return null;
  }
  if (jwtVerified) {
    try {
      await svc.assertClnOperatorStaffEmail(operatorId, email);
    } catch (err) {
      if (err?.code === 'OPERATOR_ACCESS_DENIED' || err?.code === 'OPERATORDETAIL_REQUIRED' || err?.code === 'MISSING_OPERATOR_OR_EMAIL') {
        res.status(403).json({ ok: false, reason: err.code });
        return null;
      }
      throw err;
    }
  }
  return operatorId;
}

async function resolveClientTtlockClientId(req, res) {
  const { email, jwtVerified } = clientPortalAuthFromRequest(req, req.body?.email);
  const operatorId = String(req.body?.operatorId || req.body?.operator_id || '').trim();
  if (!email) {
    res.status(400).json({ ok: false, reason: 'MISSING_EMAIL' });
    return null;
  }
  if (!jwtVerified && !operatorId) {
    res.status(400).json({ ok: false, reason: 'MISSING_EMAIL_OR_OPERATOR' });
    return null;
  }
  try {
    return await svc.resolveClnClientdetailIdForClientPortal(email, operatorId, {
      ensureClientdetailIfMissing: jwtVerified,
    });
  } catch (err) {
    if (err?.code === 'CLIENT_PORTAL_ACCESS_DENIED') {
      res.status(403).json({ ok: false, reason: err.code });
      return null;
    }
    if (err?.code === 'CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL') {
      res.status(409).json({ ok: false, reason: err.code });
      return null;
    }
    throw err;
  }
}

// ─── Operator (cln_operator_integration + cln_operatordetail id) ───────────

router.post('/operator/smartdoorsetting/list', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const b = stripSmartDoorBody(req);
    const result = await getSmartDoorList(sdScope, {
      keyword: b.keyword,
      propertyId: b.propertyId,
      filter: b.filter,
      sort: b.sort,
      page: b.page,
      pageSize: b.pageSize,
      limit: b.limit,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/operator/smartdoorsetting/filters', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const result = await getSmartDoorFilters(sdScope);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/operator/smartdoorsetting/get-lock', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const row = await getLock(sdScope, id);
    if (!row) return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.post('/operator/smartdoorsetting/get-gateway', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const row = await getGateway(sdScope, id);
    if (!row) return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.post('/operator/smartdoorsetting/update-lock', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await updateLock(sdScope, id, {
      lockAlias: req.body?.lockAlias,
      active: req.body?.active,
      childmeter: req.body?.childmeter,
    });
    if (result.ok === false) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/operator/smartdoorsetting/update-gateway', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await updateGateway(sdScope, id, { gatewayName: req.body?.gatewayName });
    if (result.ok === false) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/operator/smartdoorsetting/unlock', async (req, res, next) => {
  try {
    const { email } = clientPortalAuthFromRequest(req, req.body?.email);
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    await remoteUnlockLock(sdScope, id, {
      actorEmail: email || '',
      portalSource: 'cln_operator_smartdoor',
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.message && err.message.startsWith('TTLOCK_')) {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

router.post('/operator/smartdoorsetting/preview-selection', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const result = await previewSmartDoorSelection(sdScope);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/operator/smartdoorsetting/sync-status-from-ttlock', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const result = await syncSmartDoorStatusFromTtlock(sdScope);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/operator/smartdoorsetting/sync-locks-from-ttlock', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const result = await syncSmartDoorStatusFromTtlock(sdScope);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/operator/smartdoorsetting/sync-single-lock-from-ttlock', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await syncSingleLockStatusFromTtlock(sdScope, id);
    if (result.ok === false) return res.status(result.reason === 'LOCK_NOT_FOUND' ? 404 : 400).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/operator/smartdoorsetting/sync-single-gateway-from-ttlock', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await syncSingleGatewayStatusFromTtlock(sdScope, id);
    if (result.ok === false) return res.status(result.reason === 'GATEWAY_NOT_FOUND' ? 404 : 400).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/operator/smartdoorsetting/sync-name', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const { type, externalId, name } = req.body || {};
    if (!type || !externalId || !name) {
      return res.status(400).json({ ok: false, reason: 'TYPE_EXTERNALID_NAME_REQUIRED' });
    }
    await syncTTLockName(sdScope, { type, externalId, name });
    res.json({ ok: true });
  } catch (err) {
    if (err.message && err.message.startsWith('TTLOCK_')) {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

router.post('/operator/smartdoorsetting/ids-by-property', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const propertyId = req.body?.propertyId;
    if (!propertyId) return res.json({ ids: [] });
    const ids = await getSmartDoorIdsByProperty(sdScope, propertyId);
    res.json({ ids });
  } catch (err) {
    next(err);
  }
});

router.post('/operator/smartdoorsetting/location-label', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const lockDetailId = req.body?.lockDetailId;
    if (!lockDetailId) return res.json({ label: 'no connect' });
    const label = await resolveSmartDoorLocationLabel(sdScope, lockDetailId);
    res.json({ label });
  } catch (err) {
    next(err);
  }
});

router.post('/operator/smartdoorsetting/child-lock-options', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const excludeLockId = req.body?.excludeLockId;
    const options = await getChildLockOptions(sdScope, excludeLockId);
    res.json({ options });
  } catch (err) {
    next(err);
  }
});

router.post('/operator/smartdoorsetting/insert-smartdoors', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const gateways = Array.isArray(req.body?.gateways) ? req.body.gateways : [];
    const locks = Array.isArray(req.body?.locks) ? req.body.locks : [];
    const gatewayMap = new Map();
    if (gateways.length > 0) {
      const inserted = await insertGateways(sdScope, gateways);
      inserted.forEach(({ id, gatewayId }) => gatewayMap.set(String(gatewayId), id));
    }
    if (locks.length > 0) {
      await insertLocks(sdScope, locks, gatewayMap);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/operator/smartdoorsetting/delete-lock', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await deleteLock(sdScope, id);
    if (result.ok === false) {
      const st = result.reason === 'CLN_CLIENT_OWNED_DISCONNECT_FIRST' ? 400 : 404;
      return res.status(st).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/operator/smartdoorsetting/delete-gateway', async (req, res, next) => {
  try {
    const clientId = await resolveOperatorTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnOperatorScope(clientId);
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await deleteGateway(sdScope, id);
    if (result.ok === false) {
      const st = result.reason === 'CLN_CLIENT_OWNED_DISCONNECT_FIRST' ? 400 : 404;
      return res.status(st).json(result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── B2B Client portal (cln_client_integration + cln_clientdetail id) ───────

router.post('/client/smartdoorsetting/list', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const b = stripSmartDoorBody(req);
    const result = await getSmartDoorList(sdScope, {
      keyword: b.keyword,
      propertyId: b.propertyId,
      filter: b.filter,
      sort: b.sort,
      page: b.page,
      pageSize: b.pageSize,
      limit: b.limit,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/client/smartdoorsetting/filters', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const result = await getSmartDoorFilters(sdScope);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/client/smartdoorsetting/get-lock', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const row = await getLock(sdScope, id);
    if (!row) return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.post('/client/smartdoorsetting/get-gateway', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const row = await getGateway(sdScope, id);
    if (!row) return res.status(404).json({ ok: false, reason: 'NOT_FOUND' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.post('/client/smartdoorsetting/update-lock', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await updateLock(sdScope, id, {
      lockAlias: req.body?.lockAlias,
      active: req.body?.active,
      childmeter: req.body?.childmeter,
    });
    if (result.ok === false) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/client/smartdoorsetting/update-gateway', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await updateGateway(sdScope, id, { gatewayName: req.body?.gatewayName });
    if (result.ok === false) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/client/smartdoorsetting/unlock', async (req, res, next) => {
  try {
    const { email } = clientPortalAuthFromRequest(req, req.body?.email);
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    await remoteUnlockLock(sdScope, id, {
      actorEmail: email || '',
      portalSource: 'cln_client_smartdoor',
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.message && err.message.startsWith('TTLOCK_')) {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

router.post('/client/smartdoorsetting/preview-selection', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const result = await previewSmartDoorSelection(sdScope);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/client/smartdoorsetting/sync-status-from-ttlock', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const result = await syncSmartDoorStatusFromTtlock(sdScope);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/client/smartdoorsetting/sync-locks-from-ttlock', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const result = await syncSmartDoorStatusFromTtlock(sdScope);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/client/smartdoorsetting/sync-single-lock-from-ttlock', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await syncSingleLockStatusFromTtlock(sdScope, id);
    if (result.ok === false) return res.status(result.reason === 'LOCK_NOT_FOUND' ? 404 : 400).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/client/smartdoorsetting/sync-single-gateway-from-ttlock', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await syncSingleGatewayStatusFromTtlock(sdScope, id);
    if (result.ok === false) return res.status(result.reason === 'GATEWAY_NOT_FOUND' ? 404 : 400).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/client/smartdoorsetting/sync-name', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const { type, externalId, name } = req.body || {};
    if (!type || !externalId || !name) {
      return res.status(400).json({ ok: false, reason: 'TYPE_EXTERNALID_NAME_REQUIRED' });
    }
    await syncTTLockName(sdScope, { type, externalId, name });
    res.json({ ok: true });
  } catch (err) {
    if (err.message && err.message.startsWith('TTLOCK_')) {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

router.post('/client/smartdoorsetting/ids-by-property', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const propertyId = req.body?.propertyId;
    if (!propertyId) return res.json({ ids: [] });
    const ids = await getSmartDoorIdsByProperty(sdScope, propertyId);
    res.json({ ids });
  } catch (err) {
    next(err);
  }
});

router.post('/client/smartdoorsetting/location-label', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const lockDetailId = req.body?.lockDetailId;
    if (!lockDetailId) return res.json({ label: 'no connect' });
    const label = await resolveSmartDoorLocationLabel(sdScope, lockDetailId);
    res.json({ label });
  } catch (err) {
    next(err);
  }
});

router.post('/client/smartdoorsetting/child-lock-options', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const excludeLockId = req.body?.excludeLockId;
    const options = await getChildLockOptions(sdScope, excludeLockId);
    res.json({ options });
  } catch (err) {
    next(err);
  }
});

router.post('/client/smartdoorsetting/insert-smartdoors', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const gateways = Array.isArray(req.body?.gateways) ? req.body.gateways : [];
    const locks = Array.isArray(req.body?.locks) ? req.body.locks : [];
    const gatewayMap = new Map();
    if (gateways.length > 0) {
      const inserted = await insertGateways(sdScope, gateways);
      inserted.forEach(({ id, gatewayId }) => gatewayMap.set(String(gatewayId), id));
    }
    if (locks.length > 0) {
      await insertLocks(sdScope, locks, gatewayMap);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/client/smartdoorsetting/delete-lock', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await deleteLock(sdScope, id);
    if (result.ok === false) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/client/smartdoorsetting/delete-gateway', async (req, res, next) => {
  try {
    const clientId = await resolveClientTtlockClientId(req, res);
    if (clientId == null) return;
    const sdScope = clnClientScope(clientId, parseTtlockSlotFromRequest(req));
    const id = req.body?.id;
    if (!id) return res.status(400).json({ ok: false, reason: 'NO_ID' });
    const result = await deleteGateway(sdScope, id);
    if (result.ok === false) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
