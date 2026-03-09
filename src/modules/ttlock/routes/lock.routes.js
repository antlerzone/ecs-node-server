/**
 * TTLock Lock API routes (SaaS – client from clientresolver).
 * All use req.client.id as clientId.
 */

const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const lockWrapper = require('../wrappers/lock.wrapper');
const {
  params_lock_id_schema,
  rename_lock_schema,
  add_passcode_schema,
  change_passcode_schema
} = require('../validators/lock.validator');

function clientId(req) {
  const id = req?.client?.id;
  if (!id) throw new Error('missing client');
  return id;
}

function handleErr(res, err) {
  const msg = err?.message || 'unknown';
  if (msg === 'missing client') return res.status(400).json({ ok: false, error: msg });
  if (msg === 'TTLOCK_NOT_CONFIGURED' || msg === 'TTLOCK_NO_TOKEN' || msg === 'TTLOCK_APP_CREDENTIALS_MISSING') {
    return res.status(403).json({ ok: false, error: msg });
  }
  if (msg.startsWith('TTLOCK_') || msg.startsWith('LOCK_ID_REQUIRED')) {
    return res.status(400).json({ ok: false, error: msg });
  }
  return res.status(500).json({ ok: false, error: msg });
}

/* list all locks */
router.get('/', async (req, res) => {
  try {
    const data = await lockWrapper.listAllLocks(clientId(req));
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* electric quantity – more specific before /:lockId */
router.get('/:lockId/electric', validate(params_lock_id_schema, 'params'), async (req, res) => {
  try {
    const data = await lockWrapper.queryLockElectricQuantity(clientId(req), req.params.lockId);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* list active passcodes – more specific before /:lockId/passcodes */
router.get('/:lockId/passcodes/active', validate(params_lock_id_schema, 'params'), async (req, res) => {
  try {
    const data = await lockWrapper.listActivePasscodes(clientId(req), req.params.lockId);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* get one passcode */
router.get('/:lockId/passcodes/:keyboardPwdId', validate(params_lock_id_schema, 'params'), async (req, res) => {
  try {
    const data = await lockWrapper.getPasscode(clientId(req), req.params.lockId, req.params.keyboardPwdId);
    res.json({ ok: true, data: data ?? null });
  } catch (err) {
    handleErr(res, err);
  }
});

/* list passcodes */
router.get('/:lockId/passcodes', validate(params_lock_id_schema, 'params'), async (req, res) => {
  try {
    const data = await lockWrapper.listLockPasscodes(clientId(req), req.params.lockId);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* lock detail */
router.get('/:lockId', validate(params_lock_id_schema, 'params'), async (req, res) => {
  try {
    const data = await lockWrapper.getLockDetail(clientId(req), req.params.lockId);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* rename lock */
router.post('/:lockId/rename', validate(params_lock_id_schema, 'params'), validate(rename_lock_schema), async (req, res) => {
  try {
    const data = await lockWrapper.changeLockName(clientId(req), req.params.lockId, req.body.lockName);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* add passcode */
router.post('/:lockId/passcodes', validate(params_lock_id_schema, 'params'), validate(add_passcode_schema), async (req, res) => {
  try {
    const data = await lockWrapper.addPasscode(clientId(req), req.params.lockId, req.body);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* change passcode */
router.put('/:lockId/passcodes', validate(params_lock_id_schema, 'params'), validate(change_passcode_schema), async (req, res) => {
  try {
    const data = await lockWrapper.changePasscode(clientId(req), req.params.lockId, req.body);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* remote unlock */
router.post('/:lockId/unlock', validate(params_lock_id_schema, 'params'), async (req, res) => {
  try {
    const data = await lockWrapper.remoteUnlock(clientId(req), req.params.lockId);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

module.exports = router;
