/**
 * CNYIoT Meter API routes (SaaS – client from clientresolver).
 */

const express = require('express');
const router = express.Router();
const validate = require('../../../middleware/validate');
const meterWrapper = require('../wrappers/meter.wrapper');
const syncWrapper = require('../wrappers/sync.wrapper');
const {
  add_meters_schema,
  edit_meter_body_schema,
  set_relay_schema,
  set_power_gate_schema,
  set_ratio_schema,
  create_pending_topup_schema,
  confirm_topup_schema,
  usage_summary_schema,
  update_meter_name_rate_schema,
  sync_meter_schema
} = require('../validators/meter.validator');

function clientId(req) {
  const id = req?.client?.id;
  if (!id) throw new Error('missing client');
  return id;
}

function handleErr(res, err) {
  const msg = err?.message || 'unknown';
  if (msg === 'missing client') return res.status(400).json({ ok: false, error: msg });
  if (msg === 'CNYIOT_NOT_CONFIGURED' || msg === 'CNYIOT_ACCOUNT_INVALID' || msg === 'CLIENT_TEL_NOT_FOUND') {
    return res.status(403).json({ ok: false, error: msg });
  }
  if (msg.startsWith('CLIENT_ID_REQUIRED') || msg.startsWith('METHOD_REQUIRED') || msg.startsWith('CNYIOT_') ||
      msg.startsWith('EDIT_METER_') || msg.startsWith('GET_METER_') || msg.startsWith('ADD_PRICE_') ||
      msg.startsWith('PRICE_') || msg.startsWith('INVALID_') || msg.startsWith('CLIENT_OR_METER') ||
      msg.startsWith('CNYIOT_METER_ID_NOT_FOUND') || msg === 'EMPTY_METER_STATUS') {
    return res.status(400).json({ ok: false, error: msg });
  }
  return res.status(500).json({ ok: false, error: msg });
}

/* list meters */
router.get('/', async (req, res) => {
  try {
    const mt = req.query.mt ? Number(req.query.mt) : 1;
    const data = await meterWrapper.getMeters(clientId(req), mt);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* usage summary – before :meterId */
router.post('/usage-summary', validate(usage_summary_schema), async (req, res) => {
  try {
    const data = await meterWrapper.getUsageSummary(clientId(req), req.body);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* update meter name & rate – before :meterId */
router.post('/update-name-rate', validate(update_meter_name_rate_schema), async (req, res) => {
  try {
    const data = await meterWrapper.updateMeterNameAndRate(clientId(req), req.body);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* sync meter by CMS meterId */
router.post('/sync', validate(sync_meter_schema), async (req, res) => {
  try {
    const data = await syncWrapper.syncMeterByCmsMeterId(clientId(req), req.body.meterId);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* add meters */
router.post('/', validate(add_meters_schema), async (req, res) => {
  try {
    const data = await meterWrapper.addMeters(clientId(req), req.body.meters);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* delete meters */
router.delete('/', async (req, res) => {
  try {
    const meterIds = Array.isArray(req.body?.meterIds) ? req.body.meterIds : [];
    if (!meterIds.length) return res.status(400).json({ ok: false, error: 'meterIds required' });
    const data = await meterWrapper.deleteMeters(clientId(req), meterIds);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* usage records – query (before :meterId so "usage" is not captured as meterId) */
router.get('/usage/records', async (req, res) => {
  try {
    const { meterId, st, et, mYMD } = req.query;
    if (!meterId || !st || !et) return res.status(400).json({ ok: false, error: 'meterId, st, et required' });
    const data = await meterWrapper.getUsageRecords(clientId(req), meterId, st, et, mYMD ? Number(mYMD) : 1);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* month bill – query */
router.get('/usage/month-bill', async (req, res) => {
  try {
    const { meterIds, st, et, mYMD } = req.query;
    const ids = meterIds ? (Array.isArray(meterIds) ? meterIds : String(meterIds).split(',')) : [];
    if (!ids.length || !st || !et) return res.status(400).json({ ok: false, error: 'meterIds, st, et required' });
    const data = await meterWrapper.getMonthBill(clientId(req), ids, st, et, mYMD ? Number(mYMD) : 2);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* operation history */
router.get('/usage/history', async (req, res) => {
  try {
    const { st, et } = req.query;
    if (!st || !et) return res.status(400).json({ ok: false, error: 'st, et required' });
    const data = await meterWrapper.getOperationHistory(clientId(req), st, et);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* meter status */
router.get('/:meterId/status', async (req, res) => {
  try {
    const data = await meterWrapper.getMeterStatus(clientId(req), req.params.meterId);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* edit meter */
router.post('/:meterId/edit', validate(edit_meter_body_schema), async (req, res) => {
  try {
    const data = await meterWrapper.editMeterSafe(clientId(req), {
      meterId: req.params.meterId,
      meterName: req.body.meterName,
      priceId: req.body.priceId
    });
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* set relay */
router.post('/:meterId/relay', validate(set_relay_schema), async (req, res) => {
  try {
    const val = req.body.val ?? 2;
    const data = await meterWrapper.setRelay(clientId(req), req.params.meterId, val);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* set power gate */
router.post('/:meterId/power-gate', validate(set_power_gate_schema), async (req, res) => {
  try {
    const data = await meterWrapper.setPowerGate(clientId(req), req.params.meterId, req.body.value);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* set ratio */
router.post('/:meterId/ratio', validate(set_ratio_schema), async (req, res) => {
  try {
    const data = await meterWrapper.setRatio(clientId(req), req.params.meterId, req.body.ratio);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* create pending topup */
router.post('/topup', validate(create_pending_topup_schema), async (req, res) => {
  try {
    const data = await meterWrapper.createPendingTopup(clientId(req), req.body.meterId, req.body.amount);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

/* confirm topup */
router.post('/topup/confirm', validate(confirm_topup_schema), async (req, res) => {
  try {
    const data = await meterWrapper.confirmTopup(clientId(req), req.body.meterId, req.body.idx);
    res.json({ ok: true, data });
  } catch (err) {
    handleErr(res, err);
  }
});

module.exports = router;
