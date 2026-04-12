/**
 * Cron endpoints: daily tenancy check + Stripe settlement journal (run at 00:00 UTC+8).
 * Protect with header X-Cron-Secret === process.env.CRON_SECRET (or disable when CRON_SECRET not set).
 *
 * 涵蓋所有 SaaS client；當天全部跑完（queue 分批）：
 * - 欠租檢查：每批 500 筆，循環直到沒有為止
 * - Stripe 入賬：每個 client 每個 payout 日一筆，已寫過 skip；有 stripepayout 記錄才入賬，沒有就不用。一次撈全部 pending 處理完即可（不隔夜）
 * - 房間同步：全量更新，僅 DB
 */

const express = require('express');
const router = express.Router();
const { getTodayMalaysiaDate } = require('../../utils/dateMalaysia');
const {
  runDailyTenancyCheck,
  runEndedTenancyPasscodeRemoval,
  syncRoomAvailableFromTenancy
} = require('./tenancy-active.service');
const { runDailyBatteryCheckAndInsertFeedback } = require('./battery-feedback-cron.service');
const { runRefundDepositForEndedTenancies } = require('./refund-deposit-cron.service');
const { runPricingPlanExpiryCheck } = require('../billing/pricing-plan-expiry-cron.service');
const { runCoreCreditExpiryCheck } = require('../billing/core-credit-expiry-cron.service');
const { runMonthlyActiveRoomDeduction } = require('../billing/active-room-monthly-cron.service');
const { runTenantXenditAutoDebitForDueRentals } = require('../billing/tenant-xendit-auto-debit.service');
const { runTenantStripeAutoDebitForDueRentals } = require('../billing/tenant-stripe-auto-debit.service');
const { runDemoAccountRefresh } = require('./demo-refresh-cron.service');
const { runOwnerReportMonthlyAutomation } = require('../generatereport/generatereport.service');

function checkCronSecret(req) {
  const secret = process.env.CRON_SECRET;
  if (secret != null && secret !== '') {
    const provided = req.headers['x-cron-secret'] || req.body?.secret;
    if (provided !== secret) {
      return false;
    }
  }
  return true;
}

/** POST /api/cron/daily-tenancy-check — 检查欠租并封锁 */
router.post('/daily-tenancy-check', async (req, res) => {
  if (!checkCronSecret(req)) {
    return res.status(403).json({ ok: false, reason: 'FORBIDDEN' });
  }
  try {
    const result = await runDailyTenancyCheck();
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron] daily-tenancy-check', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'JOB_FAILED' });
  }
});

/** POST /api/cron/daily — 每日一次：1) 欠租 2) 租约日历到期→TTLock 删密码 3) 房间可租同步 4) refunddeposit … */
router.post('/daily', async (req, res) => {
  if (!checkCronSecret(req)) {
    return res.status(403).json({ ok: false, reason: 'FORBIDDEN' });
  }
  try {
    const tenancyResult = await runDailyTenancyCheck();
    let endedPasscodes = null;
    try {
      endedPasscodes = await runEndedTenancyPasscodeRemoval();
    } catch (endedErr) {
      console.error('[cron] ended tenancy passcode removal', endedErr?.message);
      endedPasscodes = { processed: 0, errors: [{ reason: endedErr?.message || 'JOB_FAILED' }], batches: 0 };
    }
    let demoRefresh = null;
    try {
      demoRefresh = await runDemoAccountRefresh();
    } catch (demoErr) {
      console.error('[cron] demo refresh', demoErr?.message);
      demoRefresh = { updated: 0, clientIds: [], errors: [demoErr?.message || 'JOB_FAILED'] };
    }
    const roomSyncResult = await syncRoomAvailableFromTenancy();
    const refundDepositResult = await runRefundDepositForEndedTenancies();
    const pricingPlanExpiryResult = await runPricingPlanExpiryCheck();
    const coreCreditExpiryResult = await runCoreCreditExpiryCheck();

    const today = getTodayMalaysiaDate();
    const isFirstOfMonth = today.endsWith('-01');
    let activeRoomMonthly = null;
    if (isFirstOfMonth) {
      activeRoomMonthly = await runMonthlyActiveRoomDeduction();
    }
    let ownerReportAutomation = null;
    try {
      ownerReportAutomation = await runOwnerReportMonthlyAutomation(today);
    } catch (ownerReportErr) {
      console.error('[cron] owner report automation', ownerReportErr?.message);
      ownerReportAutomation = { generated: [], skippedReports: [], errors: [{ reason: ownerReportErr?.message || 'JOB_FAILED' }] };
    }

    const { getStripePayoutsPendingJournal, processPendingStripePayoutJournals } = require('../stripe/settlement-journal.service');
    const pending = await getStripePayoutsPendingJournal(null);
    const settlementResult = pending.length > 0
      ? await processPendingStripePayoutJournals(pending)
      : { created: 0, errors: [] };
    let payexSettlements = null;
    try {
      const { fetchAndSaveSettlementsForAllClients } = require('../payex/payex.service');
      payexSettlements = await fetchAndSaveSettlementsForAllClients();
    } catch (payexErr) {
      console.error('[cron] Payex settlements', payexErr?.message);
      payexSettlements = { totalSaved: 0, totalSkipped: 0, error: payexErr?.message };
    }
    let payexJournalResult = { created: 0, errors: [] };
    try {
      const { getPayexSettlementsPendingJournal, processPendingPayexSettlementJournals } = require('../payex/settlement-journal.service');
      const payexPending = await getPayexSettlementsPendingJournal(null);
      if (payexPending.length > 0) {
        payexJournalResult = await processPendingPayexSettlementJournals(payexPending);
      }
    } catch (payexJErr) {
      console.error('[cron] Payex settlement journal', payexJErr?.message);
      payexJournalResult = { created: 0, errors: [{ id: '', reason: payexJErr?.message || 'JOB_FAILED' }] };
    }
    let tenantXenditAutoDebit = null;
    try {
      tenantXenditAutoDebit = await runTenantXenditAutoDebitForDueRentals();
    } catch (autoDebitErr) {
      console.error('[cron] tenant Xendit auto-debit', autoDebitErr?.message);
      tenantXenditAutoDebit = { enabled: false, error: autoDebitErr?.message || 'JOB_FAILED' };
    }
    let tenantStripeAutoDebit = null;
    try {
      tenantStripeAutoDebit = await runTenantStripeAutoDebitForDueRentals();
    } catch (stripeAutoErr) {
      console.error('[cron] tenant Stripe auto-debit', stripeAutoErr?.message);
      tenantStripeAutoDebit = { enabled: false, error: stripeAutoErr?.message || 'JOB_FAILED' };
    }
    const batteryResult = await runDailyBatteryCheckAndInsertFeedback();
    const body = {
      ok: true,
      tenancy: tenancyResult,
      endedTenancyPasscodes: endedPasscodes,
      roomAvailable: roomSyncResult,
      refundDeposit: { inserted: refundDepositResult.inserted, errors: refundDepositResult.errors },
      pricingPlanExpiry: { inactived: pricingPlanExpiryResult.inactived, clientIds: pricingPlanExpiryResult.clientIds },
      coreCreditExpiry: { processed: coreCreditExpiryResult.processed, expiredByClient: coreCreditExpiryResult.expiredByClient, errors: coreCreditExpiryResult.errors },
      settlement: { created: settlementResult.created, errors: settlementResult.errors, processed: pending.length },
      payexSettlements: payexSettlements ? { totalSaved: payexSettlements.totalSaved, totalSkipped: payexSettlements.totalSkipped, byClient: payexSettlements.byClient, error: payexSettlements.error } : null,
      payexSettlementJournal: { created: payexJournalResult.created, errors: payexJournalResult.errors },
      batteryFeedback: { inserted: batteryResult.inserted, errors: batteryResult.errors },
      demoRefresh: { updated: demoRefresh.updated, clientIds: demoRefresh.clientIds, errors: demoRefresh.errors },
      ownerReportAutomation,
      tenantXenditAutoDebit,
      tenantStripeAutoDebit
    };
    if (activeRoomMonthly) body.activeRoomMonthly = activeRoomMonthly;
    return res.json(body);
  } catch (err) {
    console.error('[cron] daily', err);
    return res.status(500).json({ ok: false, reason: err?.message || 'JOB_FAILED' });
  }
});

module.exports = router;
