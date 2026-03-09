/* ======================================================
   Billing Page Frontend
   所有数据与操作均通过 backend/saas/billing.jsw 请求 ECS Node，不读 Wix CMS。
   Filter / 分页状态与 cache 保留在前端。
====================================================== */

import wixLocation from 'wix-location';
import wixWindow from 'wix-window';
import { getMyBillingInfo, getCreditPlans, startNormalTopup } from 'backend/saas/topup';
import {
    clearBillingCache,
    getStatementItems,
    getStatementExportUrl,
    getPlans,
    getAddons,
    previewPricingPlan,
    confirmPricingPlan,
    deductAddonCredit,
    getAccessContextByEmail
} from 'backend/saas/billing';
import { submitTicket } from 'backend/saas/help';
import wixUsers from 'wix-users';

/* ======================================================
   State
====================================================== */
const PAGE_SIZE = 10;
/** 前端緩存：Event Log 一次拉取筆數，filter/sort 在前端執行（同 expenses 頁） */
const STATEMENT_CACHE_SIZE = 2000;
let currentUserId = null;
let clientCurrency = 'MYR';
let pricingPreviewCache = null;
let currentClientId = null;
let topupInited = false;
let selectedTopupPlanId = null;
let topupRepeaterBound = false;
let lastSection = 'pricing';
let topupCheckoutBound = false;
let addonInited = false;
let cachedBilling = null;
let headerButtonsBound = false;
let confirmAddonBound = false;
let statementControlsBound = false;
let selectedTopupPlanCache = null;
let statementMergedCache = [];
let statementState = {
    page: 1,
    sort: 'new',
    filterType: null,
    search: ''
};
let confirmBound = false;
let statementInited = false;
/** Repeater ready: resolve when onItemReady has run for all items (for #buttonpricingplan / #buttoneventlogs). */
let pricingPlanRepeaterResolve = null;
let pricingPlanRepeaterExpected = 0;
let pricingPlanRepeaterCount = 0;
let eventLogsRepeaterResolve = null;
let eventLogsRepeaterExpected = 0;
let eventLogsRepeaterCount = 0;
let pricingPlanState = {
    selectedAddons: {},
    plans: [],
    addons: [],
    selectedPlanId: null,
    currentPlanId: null,
    currentCredit: 0,
    expiredDate: null
};

function safeCollapse(el) { try { if (el && typeof el.collapse === 'function') el.collapse(); } catch (_) {} }
function safeExpand(el) { try { if (el && typeof el.expand === 'function') el.expand(); } catch (_) {} }
function runMobileBranch() {
    $w('#textstatusloading').text = 'Please setting on pc version';
    $w('#textstatusloading').show();
    function applyMobileSections() {
        try {
            safeCollapse($w('#sectiontab'));
            safeCollapse($w('#sectioneventlogs'));
            safeCollapse($w('#sectiontopup'));
            safeCollapse($w('#sectionpricingplan'));
            safeExpand($w('#sectiondefault'));
            safeExpand($w('#sectionheader'));
        } catch (e) {}
    }
    applyMobileSections();
    setTimeout(applyMobileSections, 100);
    setTimeout(applyMobileSections, 400);
}

$w.onReady(() => {
    if (wixWindow.formFactor === "Mobile") {
        runMobileBranch();
        return;
    }
    currentUserId = wixUsers.currentUser.id;
    disableMainActions();
    initDefaultSection();
    $w('#boxpricingplan').hide();
    $w('#boxaddon').hide();
    $w('#textstatusloading').show();
    startInitAsync();
});

async function startInitAsync() {
    runPermissionFlow();
    bindSectionSwitch();
    bindExportButton();
    bindHeaderButtons();
    headerButtonsBound = true;
    loadStatementPricingPlan();
}

/* ======================================================
   UI Helpers
====================================================== */
function collapseAll() {
    $w('#sectionheader').expand();
    $w('#sectiondefault').expand();
    $w('#sectiontab').expand();
    $w('#sectioneventlogs').collapse();
    $w('#sectiontopup').collapse();
    $w('#sectionpricingplan').collapse();
    $w('#buttontopup').disable();
    $w('#buttonpricingplan').disable();
    $w('#buttoneventlogs').disable();
}

/* ======================================================
   Pricing Plan Section (data from Node getPlans)
====================================================== */
function loadStatementPricingPlan() {
    $w('#repeaterpricingplan').onItemReady(($item, plan) => {
        $item('#boxcurrentplan').hide();
        $item('#boxcolorpricingplan').hide();
        $item('#texttitlepricingplan').text = plan.title;
        $item('#textdescriptionpricingplan').text = plan.description || '';
        $item('#textamountpricingplan').text = `${clientCurrency} ${plan.sellingprice}`;
        $item('#textcreditpricingplan').text = `Core Credit: ${plan.corecredit}`;
        if (plan.isCurrentPlan) {
            $item('#boxcurrentplan').show();
        }

        $item('#containerpricingplan').onClick(async () => {
            pricingPlanState.selectedPlanId = plan._id || plan.id;
            $w('#repeaterpricingplan').forEachItem(($i) => {
                $i('#boxcolorpricingplan').hide();
            });
            $item('#boxcolorpricingplan').show();

            const scenario = getPlanChangeScenario(
                pricingPlanState.currentPlanId,
                plan._id || plan.id
            );

            if (scenario === 'DOWNGRADE') {
                $w('#buttonconfirmpricingplan').label = 'Downgrade';
                $w('#buttonconfirmpricingplan').disable();
                $w('#texttotal').text =
                    'Downgrade is not allowed.\nPlease contact customer services';
                return;
            }

            try {
                const preview = await previewPricingPlan({
                    planId: plan._id || plan.id
                });
                pricingPreviewCache = preview;

                if (preview.scenario === 'RENEW') {
                    const allowRenew = canRenewPlan(pricingPlanState.expiredDate);
                    if (!allowRenew) {
                        $w('#buttonconfirmpricingplan').disable();
                        $w('#texttotal').text =
                            'Renew is only available within 2 months before plan expiration.\n' +
                            `Your plan expires on ${formatDate(pricingPlanState.expiredDate)}`;
                        return;
                    }
                }

                if (preview.scenario === 'NEW') {
                    $w('#texttotal').text =
                        `Total payment: ${formatMoney(preview.totalPayment)}\n` +
                        `Your pricing plan will expire on ${formatDate(preview.expiredDate)}`;
                    $w('#buttonconfirmpricingplan').label = 'Subscribe Now';
                    $w('#buttonconfirmpricingplan').enable();
                    return;
                }

                const credit = preview.credit || {};
                const stillNeed = Math.max(
                    0,
                    (credit.addonRequired || 0) - (credit.current || 0)
                );
                let text =
                    `To ${preview.scenario === 'RENEW' ? 'renew' : 'upgrade'} plan\n` +
                    `Payment required: ${formatMoney(preview.totalPayment)}\n\n` +
                    `Addon credit required: ${credit.addonRequired || 0}\n` +
                    `Current credit: ${credit.current || 0}\n` +
                    `Credit after pricing plan: ${credit.availableAfterRenew || 0}\n`;
                if (stillNeed > 0) {
                    text += `\nStill need ${stillNeed} credit`;
                    $w('#buttonconfirmpricingplan').label = 'Topup Now';
                } else {
                    $w('#buttonconfirmpricingplan').label =
                        preview.scenario === 'RENEW' ? 'Renew Plan' : 'Upgrade Now';
                }
                $w('#buttonconfirmpricingplan').enable();
                $w('#texttotal').text = text;
            } catch (e) {
                console.error('[PREVIEW FAILED]', e);
                $w('#texttotal').text =
                    'Unable to calculate payment. Please try again later.';
                $w('#buttonconfirmpricingplan').disable();
            }
        });
        pricingPlanRepeaterCount++;
        if (pricingPlanRepeaterResolve && pricingPlanRepeaterCount >= pricingPlanRepeaterExpected) {
            pricingPlanRepeaterResolve();
            pricingPlanRepeaterResolve = null;
        }
    });
}

/* ======================================================
   Event Log (cache + 前端 filter/sort，同 expenses 頁；僅首次從後端拉取)
====================================================== */
/** 前端：對 statementMergedCache 依 filterType / search / sort 過濾排序後分頁，寫入 repeater（不請求後端） */
function applyStatementFilterAndSort() {
    let list = [...statementMergedCache];
    const { filterType, sort, search, page } = statementState;

    if (filterType === 'Topup') list = list.filter((i) => i.type === 'credit' && (Number(i.amount) || 0) >= 0);
    if (filterType === 'Spending') list = list.filter((i) => i.type === 'credit' && (Number(i.amount) || 0) < 0);
    if (filterType === 'creditOnly') list = list.filter((i) => (i._id || '').startsWith('credit_'));
    if (filterType === 'planOnly') list = list.filter((i) => (i._id || '').startsWith('plan_'));

    if (search && search.trim()) {
        const term = search.trim().toLowerCase();
        list = list.filter((i) => (i.title || '').toLowerCase().includes(term));
    }

    const dateTs = (item) => (Number(new Date(item._createdDate).getTime()) || 0);
    const orderBy = sort === 'old'
        ? (a, b) => dateTs(a) - dateTs(b)
        : sort === 'amountAsc'
            ? (a, b) => (Number(a.amount) || (a.sellingprice != null ? a.sellingprice : 0)) - (Number(b.amount) || (b.sellingprice != null ? b.sellingprice : 0))
            : sort === 'amountDesc'
                ? (a, b) => (Number(b.amount) || (b.sellingprice != null ? b.sellingprice : 0)) - (Number(a.amount) || (a.sellingprice != null ? a.sellingprice : 0))
                : (a, b) => dateTs(b) - dateTs(a);
    list.sort(orderBy);

    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const start = (page - 1) * PAGE_SIZE;
    const pageItems = list.slice(start, start + PAGE_SIZE);

    eventLogsRepeaterExpected = pageItems.length;
    eventLogsRepeaterCount = 0;
    $w('#repeatereventlogs').data = pageItems;
    $w('#paginationeventlogs').totalPages = totalPages;
    $w('#paginationeventlogs').currentPage = page;
}

async function loadStatementEventLog() {
    console.log('[BILLING eventlogs] loadStatementEventLog currentClientId=%s', currentClientId || 'null');
    try {
        const res = await getStatementItems({
            page: 1,
            pageSize: STATEMENT_CACHE_SIZE,
            sort: 'new',
            filterType: null,
            search: ''
        });

        const items = res.items || [];
        const total = res.total || 0;
        console.log('[BILLING eventlogs] getStatementItems cache items=%s total=%s', items.length, total);
        if (items.length === 0 && res.reason) console.warn('[BILLING eventlogs] empty items, backend reason=%s', res.reason);

        statementMergedCache = [...items];

        eventLogsRepeaterExpected = 0;
        eventLogsRepeaterCount = 0;
        const eventLogsPromise = new Promise(r => { eventLogsRepeaterResolve = r; });
        applyStatementFilterAndSort();
        if (eventLogsRepeaterExpected === 0) eventLogsRepeaterResolve();
        return eventLogsPromise;
    } catch (e) {
        console.error('[LOAD STATEMENT FAILED]', e);
        statementMergedCache = [];
        $w('#repeatereventlogs').data = [];
        $w('#paginationeventlogs').totalPages = 1;
        $w('#paginationeventlogs').currentPage = 1;
        return Promise.resolve();
    }
}

$w('#repeatereventlogs').onItemReady(($item, item) => {
    eventLogsRepeaterCount++;
    if (eventLogsRepeaterResolve && eventLogsRepeaterCount >= eventLogsRepeaterExpected) {
        eventLogsRepeaterResolve();
        eventLogsRepeaterResolve = null;
    }
    const date = item._createdDate ? new Date(item._createdDate) : null;
    $item('#textdateeventlogs').text = date
        ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : '-';
    $item('#textinvoicetitle').text = item.title || '-';

    if (item.type === 'plan') {
        $item('#textcrediteventlogs').text = `+ Core Credit ${item.corecredit}`;
        $item('#textcrediteventlogs').style.color = '#1F8B4C';
        const planCurr = item.currency || clientCurrency;
        $item('#textamountplan').text = `${planCurr} ${item.sellingprice}`;
        $item('#textamountplan').show();
    } else {
        const amount = Number(item.amount) || 0;
        const absAmount = Math.abs(amount);
        // credit 僅在 Stripe（topup / buy package）有 currency，deduction 等不顯示貨幣
        const amountText = item.currency ? `${item.currency} ${absAmount}` : String(absAmount);
        if (amount >= 0) {
            $item('#textcrediteventlogs').text = `+ Credit ${amountText}`;
            $item('#textcrediteventlogs').style.color = '#1F8B4C';
        } else {
            $item('#textcrediteventlogs').text = `- Credit ${amountText}`;
            $item('#textcrediteventlogs').style.color = '#D92C2C';
        }
        $item('#textamountplan').hide();
    }

    // 僅 topup / pricing plan renew·extend 有 invoice；deduction 等無發票，不顯示按鈕
    if (item.invoiceUrl) {
        $item('#buttoninvoiceeventlogs').show();
        $item('#buttoninvoiceeventlogs').enable();
        $item('#buttoninvoiceeventlogs').onClick(() => {
            wixLocation.to(item.invoiceUrl);
        });
    } else {
        $item('#buttoninvoiceeventlogs').hide();
    }
});

/* ======================================================
   Addon Section (data from Node getAddons)
====================================================== */
async function initAddons() {
    const res = await getAddons();
    pricingPlanState.addons = res || [];
    $w('#repeateraddon').data = pricingPlanState.addons;
}

$w('#repeateraddon').onItemReady(($item, addon) => {
    $item('#textcheckboxtitleaddon').text = addon.title;
    $item('#textcheckboxdescriptionaddon').text =
        Array.isArray(addon.description)
            ? addon.description.join('\n')
            : (addon.description || '');
    $item('#textcreditaddon').text = `${addon.credit} Credit / year`;
    setupQtyDropdown($item, addon.qty);

    const existingQty =
        Number(pricingPlanState.selectedAddonsFromBilling?.[addon._id || addon.id]) || 0;
    if (existingQty > 0) {
        $item('#checkboxaddon').checked = true;
        $item('#checkboxaddon').disable();
        $item('#dropdownqtyaddon').value = String(existingQty);
        const options = $item('#dropdownqtyaddon').options || [];
        $item('#dropdownqtyaddon').options =
            options.filter((o) => Number(o.value) >= existingQty);
        pricingPlanState.selectedAddons[addon._id || addon.id] = existingQty;
    }

    $item('#checkboxaddon').onChange(() => {
        if (existingQty > 0) {
            $item('#checkboxaddon').checked = true;
            return;
        }
        const qty = Number($item('#dropdownqtyaddon').value) || 1;
        if ($item('#checkboxaddon').checked) {
            pricingPlanState.selectedAddons[addon._id || addon.id] = qty;
        } else {
            delete pricingPlanState.selectedAddons[addon._id || addon.id];
        }
        updateAddonTotalText();
    });

    $item('#dropdownqtyaddon').onChange(() => {
        const qty = Number($item('#dropdownqtyaddon').value) || 1;
        if (existingQty > 0 && qty < existingQty) {
            $item('#dropdownqtyaddon').value = String(existingQty);
            return;
        }
        if (!$item('#checkboxaddon').checked) {
            $w('#texttotaladdon').text = 'Please tick the add on to apply';
            return;
        }
        pricingPlanState.selectedAddons[addon._id || addon.id] = qty;
        updateAddonTotalText();
    });
});

function setupQtyDropdown($item, maxQty) {
    const safeMax = Number(maxQty) > 0 ? Number(maxQty) : 1;
    const options = [];
    for (let i = 1; i <= safeMax; i++) {
        options.push({ label: String(i), value: String(i) });
    }
    $item('#dropdownqtyaddon').options = options;
    $item('#dropdownqtyaddon').value = '1';
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

function getPlanChangeScenario(currentPlanId, selectedPlanId) {
    if (!pricingPlanState.plans || pricingPlanState.plans.length === 0) return 'UNKNOWN';
    if (!currentPlanId) return 'NEW';
    if (currentPlanId === selectedPlanId) return 'RENEW';
    const currentPlan = pricingPlanState.plans.find((p) => (p._id || p.id) === currentPlanId);
    const selectedPlan = pricingPlanState.plans.find((p) => (p._id || p.id) === selectedPlanId);
    if (!currentPlan || !selectedPlan) return 'UNKNOWN';
    if (Number(selectedPlan.sellingprice) > Number(currentPlan.sellingprice)) return 'UPGRADE';
    return 'DOWNGRADE';
}

function updateAddonTotalText() {
    const deduct = calculateAddonProratedCredit();
    const current = Number(pricingPlanState.currentCredit) || 0;
    const balance = current - deduct;
    $w('#texttotaladdon').text =
        `Your current credit: ${current}\n` +
        `Total credit to deduct: ${deduct}\n` +
        `Balance credit: ${balance}`;
    if (deduct <= 0) {
        $w('#buttonconfirmaddon').disable();
        $w('#buttonconfirmaddon').label = 'Confirm';
        return;
    }
    if (current < deduct) {
        $w('#buttonconfirmaddon').label = 'Topup Now';
        $w('#buttonconfirmaddon').enable();
        return;
    }
    $w('#buttonconfirmaddon').label = 'Confirm';
    $w('#buttonconfirmaddon').enable();
}

function calculateAddonProratedCredit() {
    let total = 0;
    const today = new Date();
    const expired = pricingPlanState.expiredDate;
    let remainingDays = 365;
    if (expired && today < expired) {
        const msPerDay = 1000 * 60 * 60 * 24;
        remainingDays = Math.ceil((expired.getTime() - today.getTime()) / msPerDay);
    }
    const daysInYear = 365;
    pricingPlanState.addons.forEach((addon) => {
        const aid = addon._id || addon.id;
        const selectedQty = Number(pricingPlanState.selectedAddons[aid]) || 0;
        const existingQty = Number(pricingPlanState.selectedAddonsFromBilling?.[aid]) || 0;
        const deltaQty = selectedQty - existingQty;
        if (deltaQty <= 0) return;
        const yearlyCredit = parseFloat(String(addon.credit).replace(/[^\d.]/g, ''));
        if (isNaN(yearlyCredit)) return;
        total += Math.ceil((yearlyCredit * remainingDays / daysInYear) * deltaQty);
    });
    return total;
}

function loadBillingSummary(billing) {
    $w('#textcompanynamepricingplan').text = billing.title || '-';
    const planItem = (billing.pricingplandetail || []).find((i) => i.type === 'plan');
    pricingPlanState.currentPlanId = planItem?.planId || null;
    pricingPlanState.selectedPlanId = pricingPlanState.currentPlanId;
    pricingPlanState.expiredDate = billing.expired ? new Date(billing.expired) : null;
    pricingPlanState.selectedAddons = {};
    pricingPlanState.selectedAddonsFromBilling = {};
    (billing.pricingplandetail || [])
        .filter((i) => i.type === 'addon')
        .forEach((a) => {
            const qty = Number(a.qty) || 0;
            pricingPlanState.selectedAddons[a.planId] = qty;
            pricingPlanState.selectedAddonsFromBilling[a.planId] = qty;
        });

    const hasPlan = !!pricingPlanState.currentPlanId;
    const notExpired =
        pricingPlanState.expiredDate && new Date() < pricingPlanState.expiredDate;
    if (hasPlan && notExpired) {
        $w('#buttonaddon').enable();
    } else {
        $w('#buttonaddon').disable();
    }

    const credits = Array.isArray(billing.credit) ? billing.credit : [];
    pricingPlanState.currentCredit = credits.reduce((sum, c) => sum + Number(c.amount || 0), 0);

    let text = '';
    if (planItem?.title) {
        text += `Balance Credit\nPlan name: ${planItem.title}\n\n`;
    }
    const core = credits
        .filter((c) => c.type === 'core' && Number(c.amount) > 0)
        .sort((a, b) => {
            if (!a.expired) return 1;
            if (!b.expired) return -1;
            return new Date(a.expired).getTime() - new Date(b.expired).getTime();
        });
    const flex = credits.filter((c) => c.type === 'flex' && c.amount > 0);
    core.forEach((c) => {
        text += `CORE Credit: ${c.amount}\nExpired: ${formatDate(c.expired)}\n\n`;
    });
    flex.forEach((c) => {
        text += `FLEX Credit: ${c.amount}\n\n`;
    });
    if (pricingPlanState.expiredDate) {
        text += `Plan Expired on: ${pricingPlanState.expiredDate.toLocaleDateString('en-GB')}`;
    }
    if (text.trim()) {
        $w('#textbalancecreditpricingplan').text = text;
        $w('#textbalancecreditpricingplan').expand();
    } else {
        $w('#textbalancecreditpricingplan').collapse();
    }
    if (billing.creditusage && billing.creditusage.trim()) {
        $w('#textcreditusagepricingplan').text = billing.creditusage;
        $w('#textcreditusagepricingplan').expand();
    } else {
        $w('#textcreditusagepricingplan').collapse();
    }
    renderAddonUsage(billing);
    updateSwitchPlanButton();
}

function bindHeaderButtons() {
    $w('#buttonswitchplan').onClick(async () => {
        let billing;
        try {
            billing = await getMyBillingInfo();
        } catch (e) {
            console.error('[getMyBillingInfo]', e);
            return;
        }
        if (billing.noPermission || billing.reason) {
            $w('#text19').text = billing.reason || 'No permission';
            return;
        }
        cachedBilling = billing;
        $w('#repeaterpricingplan').forEachItem(($i) => {
            $i('#boxcolorpricingplan').hide();
        });
        $w('#boxpricingplan').show();
    });
    $w('#buttoncloseproblem').onClick(() => {
        $w('#boxproblem').hide();
        $w('#boxpricingplan').hide();
    });
    $w('#buttoncloseproblem2').onClick(() => {
        $w('#boxproblem2').hide();
    });

    $w('#buttonaddon').onClick(async () => {
        let billing;
        try {
            billing = await getMyBillingInfo();
        } catch (e) {
            console.error('[getMyBillingInfo]', e);
            return;
        }
        if (billing.noPermission || billing.reason) {
            $w('#text19').text = billing.reason || 'No permission';
            return;
        }
        cachedBilling = billing;
        await loadBillingSummary(billing);
        $w('#texttotaladdon').text = 'Please choose your add on';
        $w('#boxaddon').show();
        $w('#buttonconfirmaddon').disable();
        $w('#buttonconfirmaddon').label = 'Confirm';
        if (!addonInited) {
            await initAddons();
            addonInited = true;
        }
        $w('#repeateraddon').data = pricingPlanState.addons;
        updateAddonTotalText();
    });

    $w('#buttoncancelpricingplan').onClick(() => {
        $w('#boxpricingplan').hide();
    });
    $w('#buttoncanceladdon').onClick(() => {
        $w('#boxaddon').hide();
    });
    $w('#buttontopupclose').onClick(async () => {
        if (lastSection === 'eventlogs') {
            switchMainSection('eventlogs');
            return;
        }
        const billing = cachedBilling || await getMyBillingInfo();
        cachedBilling = billing;
        await initPricingPlanSection(billing);
        lastSection = 'pricing';
        switchMainSection('pricing');
    });
}

/** Returns a Promise that resolves when #repeaterpricingplan has finished rendering all items. */
async function loadPricingPlanBox() {
    $w('#texttotal').text = 'Please choose your plan';
    $w('#buttonconfirmpricingplan').disable();

    const res = await getPlans();
    pricingPlanState.plans = (res || []).map((plan) => ({
        ...plan,
        isCurrentPlan: (plan._id || plan.id) === pricingPlanState.currentPlanId
    }));
    const plans = pricingPlanState.plans;
    pricingPlanRepeaterExpected = plans.length;
    pricingPlanRepeaterCount = 0;
    const promise = new Promise(r => { pricingPlanRepeaterResolve = r; });
    if (plans.length === 0) pricingPlanRepeaterResolve();
    $w('#repeaterpricingplan').data = plans;
    return promise;
}

function bindConfirmPricingPlan() {
    if (confirmBound) return;
    confirmBound = true;

    $w('#buttonconfirmpricingplan').onClick(async () => {
        const selectedPlanId = pricingPlanState.selectedPlanId;
        const label = $w('#buttonconfirmpricingplan').label;
        if (!selectedPlanId) {
            $w('#texttotal').text = 'Please choose your plan';
            return;
        }
        if (label === 'Topup Now') {
            lastSection = 'pricing';
            if (!topupInited) {
                await initTopupSection();
                topupInited = true;
            }
            switchMainSection('topup');
            return;
        }
        const btnConfirm = $w('#buttonconfirmpricingplan');
        btnConfirm.disable();
        const oldLabelConfirm = btnConfirm.label;
        btnConfirm.label = 'Loading...';
        try {
            const res = await confirmPricingPlan({
                planId: selectedPlanId,
                returnUrl: wixLocation.url
            });
            await clearBillingCache();
            cachedBilling = null;
            if (res?.provider === 'manual') {
                setupProblemBox();
                const currentText = $w('#titleboxproblem').text || '';
                const refLine = res.referenceNumber ? `\n\n单号 / Reference: ${res.referenceNumber}` : '';
                $w('#titleboxproblem').text = currentText + refLine;
                $w('#boxproblem').show();
                btnConfirm.label = oldLabelConfirm;
                btnConfirm.enable();
                return;
            }
            if (res?.url) {
                wixLocation.to(res.url);
                return;
            }
            throw new Error('NO_CHECKOUT_URL');
        } catch (e) {
            console.error('[CONFIRM PRICING PLAN FAILED]', e);
            $w('#texttotal').text = 'Unable to proceed, please try again.';
            btnConfirm.label = oldLabelConfirm;
            btnConfirm.enable();
        }
    });
}

function bindConfirmAddon() {
    if (confirmAddonBound) return;
    confirmAddonBound = true;
    $w('#buttonconfirmaddon').onClick(async () => {
        $w('#buttonconfirmaddon').disable();
        $w('#buttonconfirmaddon').label = 'Confirm';
        try {
            if (!pricingPlanState.expiredDate) {
                $w('#texttotaladdon').text =
                    'Please purchase or renew a plan before buying addons';
                return;
            }
            const billing = await getMyBillingInfo();
            cachedBilling = billing;
            if (!pricingPlanState.currentPlanId) {
                $w('#texttotaladdon').text = 'Please purchase a plan first';
                return;
            }
            const deduct = calculateAddonProratedCredit();
            if (deduct <= 0) {
                $w('#texttotaladdon').text = 'Please select addon';
                return;
            }
            const credits = Array.isArray(billing.credit) ? billing.credit : [];
            let currentCredit = 0;
            credits.forEach((c) => {
                currentCredit += Number(c.amount) || 0;
            });
            if (currentCredit < deduct) {
                lastSection = 'addon';
                if (!topupInited) {
                    await initTopupSection();
                    topupInited = true;
                }
                switchMainSection('topup');
                return;
            }
            const expired = pricingPlanState.expiredDate;
            const title =
                `Addon Prorate (${new Date().toLocaleDateString('en-GB')} → ${expired.toLocaleDateString('en-GB')})`;
            await deductAddonCredit({
                amount: deduct,
                title,
                addons: pricingPlanState.selectedAddons
            });
            await clearBillingCache();
            cachedBilling = null;
            pricingPlanState.selectedAddons = {};
            const freshBilling = await getMyBillingInfo();
            await initPricingPlanSection(freshBilling);
            renderAddonUsage(freshBilling);
            $w('#repeaterpricingplan').forEachItem(($i) => {
                $i('#boxcolorpricingplan').hide();
            });
            $w('#boxaddon').hide();
            $w('#texttotaladdon').text = '';
        } catch (e) {
            if (handleNoPermission(e)) return;
            console.error('[CONFIRM ADDON FAILED]', e);
            $w('#texttotaladdon').text = 'Unable to proceed';
        } finally {
            $w('#buttonconfirmaddon').enable();
        }
    });
}

function handleNoPermission(err) {
    if (err?.message === 'NO_PERMISSION' || err?.code === 'NO_PERMISSION') {
        collapseAll();
        $w('#texttitlepricingplan2').text = "You don't have permission";
        $w('#texttitlepricingplan2').expand();
        return true;
    }
    return false;
}

async function initPricingPlanSection(billing) {
    await loadBillingSummary(billing);
    await loadPricingPlanBox();
}

function updateSwitchPlanButton() {
    const btn = $w('#buttonswitchplan');
    if (!pricingPlanState.currentPlanId) {
        btn.label = 'Buy Plan';
        return;
    }
    if (
        pricingPlanState.expiredDate &&
        new Date() > pricingPlanState.expiredDate
    ) {
        btn.label = 'Buy Plan';
        return;
    }
    btn.label = 'Switch Plan';
}

function canRenewPlan(expiredDate) {
    if (!expiredDate) return false;
    const now = Date.now();
    const expire = new Date(expiredDate).getTime();
    const msPerDay = 1000 * 60 * 60 * 24;
    const diffDays = Math.ceil((expire - now) / msPerDay);
    return diffDays <= 60 && diffDays > 0;
}

async function enterForcedTopupMode() {
    $w('#buttonpricingplan').disable();
    $w('#buttoneventlogs').disable();
    $w('#buttontopup').disable();
    $w('#buttontopupclose').hide();
    lastSection = 'topup';
    if (!topupInited) {
        await initTopupSection();
        topupInited = true;
    }
    switchMainSection('topup');
}

async function runPermissionFlow() {
    const user = wixUsers.currentUser;
    if (!user.loggedIn) {
        wixLocation.to('/login');
        return;
    }
    let email;
    try {
        email = await user.getEmail();
    } catch (e) {
        console.error('[PERMISSION] cannot get email', e);
        collapseAll();
        $w('#textstatusloading').show();
        $w('#textstatusloading').text = 'Unable to verify account';
        $w('#text19').text = 'Unable to verify account';
        return;
    }
    try {
        const access = await getAccessContextByEmail(email);
        clientCurrency = (access.client?.currency || 'MYR').toUpperCase();
        currentClientId = access.client?.id || null;

        if (!access?.ok) {
            collapseAll();
            $w('#textstatusloading').show();
            $w('#text19').show();
            const msg = access.reason === 'NO_PERMISSION' ? "You don't have permission" : "You don't have account yet";
            $w('#textstatusloading').text = msg;
            $w('#text19').text = msg;
            return;
        }
        if (!access?.staff?.id) {
            collapseAll();
            $w('#textstatusloading').show();
            $w('#textstatusloading').text = "You don't have account yet";
            $w('#text19').text = "You don't have account yet";
            return;
        }
        if (access.staff.active !== true) {
            collapseAll();
            $w('#textstatusloading').show();
            $w('#textstatusloading').text = "You don't have permission";
            $w('#text19').text = "You don't have permission";
            return;
        }
        if (!access.staff.permission?.billing) {
            collapseAll();
            $w('#textstatusloading').show();
            $w('#textstatusloading').text = "You don't have permission";
            $w('#text19').text = "You don't have permission";
            return;
        }
        if (!access.client?.id) {
            collapseAll();
            $w('#textstatusloading').show();
            $w('#textstatusloading').text = "You don't have account yet";
            $w('#text19').text = "You don't have account yet";
            return;
        }
        if (access.client.active !== true) {
            collapseAll();
            $w('#textstatusloading').show();
            $w('#textstatusloading').text = "You don't have account yet";
            $w('#text19').text = "You don't have account yet";
            return;
        }

        $w('#textstatusloading').hide();
        disableMainActions();

        const hasPlan = !!access.plan?.mainPlan;
        if (!hasPlan) {
            $w('#buttonpricingplan').enable();
            return;
        }
        if (access.credit?.ok === false) {
            await enterForcedTopupMode();
            return;
        }
        if (access.expired?.isExpired === true) {
            $w('#buttonpricingplan').enable();
            $w('#buttontopup').enable();
            return;
        }
        enableMainActions();
    } catch (err) {
        console.error('[PERMISSION] unexpected error', err);
        collapseAll();
        $w('#textstatusloading').hide();
        $w('#text19').show();
        $w('#text19').text = 'Unable to load billing information';
    }
}

function disableMainActions() {
    $w('#buttontopup').disable();
    $w('#buttonpricingplan').disable();
    $w('#buttoneventlogs').disable();
}

function enableMainActions() {
    $w('#buttontopup').enable();
    $w('#buttonpricingplan').enable();
    $w('#buttoneventlogs').enable();
}

function switchMainSection(target) {
    $w('#sectionheader').expand();
    $w('#sectiondefault').collapse();
    $w('#sectiontab').collapse();
    $w('#sectionpricingplan').collapse();
    $w('#sectioneventlogs').collapse();
    $w('#sectiontopup').collapse();

    if (target === 'pricing') {
        $w('#sectiontab').expand();
        $w('#sectionpricingplan').expand();
    }
    if (target === 'eventlogs') {
        $w('#sectiontab').expand();
        $w('#sectioneventlogs').expand();
    }
    if (target === 'topup') {
        $w('#sectiontopup').expand();
    }
    if (target === 'default') {
        $w('#sectiontab').expand();
        $w('#sectiondefault').expand();
    }
}

function initDefaultSection() {
    $w('#sectionheader').expand();
    $w('#sectiontab').expand();
    $w('#sectiondefault').expand();
    $w('#sectionpricingplan').collapse();
    $w('#sectioneventlogs').collapse();
    $w('#sectiontopup').collapse();
}

function bindSectionSwitch() {
    $w('#buttonpricingplan').onClick(async () => {
        const btn = $w('#buttonpricingplan');
        const oldLabel = (btn && typeof btn.label !== 'undefined') ? btn.label : 'Pricing Plan';
        btn.disable();
        btn.label = 'Loading';
        $w('#text19').text = 'Loading..';
        try {
            await clearBillingCache();
            cachedBilling = null;
            let billing;
            try {
                billing = await getMyBillingInfo();
            } catch (e) {
                console.error('[getMyBillingInfo]', e);
                $w('#text19').text = e?.message || 'Unable to load billing';
                return;
            }
            if (billing.noPermission || billing.reason) {
                $w('#text19').text = billing.reason || 'No permission to view billing';
                return;
            }
            cachedBilling = billing;
            await initPricingPlanSection(billing);
            bindConfirmPricingPlan();
            bindConfirmAddon();
            switchMainSection('pricing');
            lastSection = 'pricing';
        } finally {
            btn.enable();
            btn.label = oldLabel;
        }
    });

    $w('#buttoneventlogs').onClick(async () => {
        const btn = $w('#buttoneventlogs');
        const oldLabel = (btn && typeof btn.label !== 'undefined') ? btn.label : 'Event Logs';
        btn.disable();
        btn.label = 'Loading';
        $w('#text19').text = 'Loading..';
        lastSection = 'eventlogs';
        try {
            if (!statementInited) {
                await initStatementSection();
                statementInited = true;
            } else {
                await loadStatementEventLog();
            }
            switchMainSection('eventlogs');
        } catch (e) {
            console.error('[INIT STATEMENT FAILED]', e);
            statementInited = false;
        } finally {
            btn.enable();
            btn.label = oldLabel;
        }
    });

    $w('#buttontopup').onClick(async () => {
        lastSection = 'default';
        if (!topupInited) {
            await initTopupSection();
            topupInited = true;
        }
        switchMainSection('topup');
    });
}

async function initStatementSection() {
    statementState = {
        page: 1,
        sort: 'new',
        filterType: null,
        search: ''
    };
    $w('#dropdownfiltereventlogs').options = [
        { label: 'Newest', value: 'new' },
        { label: 'Oldest', value: 'old' },
        { label: 'Amount ↑', value: 'amountAsc' },
        { label: 'Amount ↓', value: 'amountDesc' },
        { label: 'Credit only', value: 'creditOnly' },
        { label: 'Plan only', value: 'planOnly' }
    ];
    $w('#dropdownfiltereventlogs').value = 'new';
    $w('#dropdownfiltereventlogs').selectedIndex = 0;
    $w('#inputeventlogs').value = '';

    if (!statementControlsBound) {
        bindStatementControls();
        statementControlsBound = true;
    }
    return await loadStatementEventLog();
}

function bindStatementControls() {
    $w('#inputeventlogs').onInput(() => {
        statementState.page = 1;
        statementState.search = $w('#inputeventlogs').value.trim();
        applyStatementFilterAndSort();
    });
    $w('#dropdownfiltereventlogs').onChange(() => {
        const value = $w('#dropdownfiltereventlogs').value;
        statementState.page = 1;
        statementState.sort = 'new';
        statementState.filterType = null;
        if (value === 'creditOnly') statementState.filterType = 'creditOnly';
        if (value === 'planOnly') statementState.filterType = 'planOnly';
        if (value === 'old') statementState.sort = 'old';
        if (value === 'amountAsc') statementState.sort = 'amountAsc';
        if (value === 'amountDesc') statementState.sort = 'amountDesc';
        if (value === 'Topup') statementState.filterType = 'Topup';
        if (value === 'Spending') statementState.filterType = 'Spending';
        applyStatementFilterAndSort();
    });
    $w('#paginationeventlogs').onChange((e) => {
        statementState.page = e.target.currentPage;
        applyStatementFilterAndSort();
    });
}

async function initTopupSection() {
    const billing = cachedBilling || await getMyBillingInfo();
    const credits = Array.isArray(billing.credit) ? billing.credit : [];
    const totalCredit = credits.reduce((s, c) => s + Number(c.amount || 0), 0);
    $w('#textcurrentcredit').text = `Current Credit Balance: ${totalCredit}`;

    const res = await getCreditPlans();
    const plans = res || [];
    $w('#repeatertopup').data = plans;

    if (!topupRepeaterBound) {
        $w('#repeatertopup').onItemReady(($item, plan) => {
            $item('#textamount').text = `${clientCurrency} ${plan.sellingprice}`;
            $item('#textcreditamount').text = String(plan.credit);
            $item('#textcredit').text = 'Credits';
            $item('#boxcolor').hide();
            $item('#containertopup').onClick(() => {
                selectedTopupPlanId = plan._id || plan.id;
                selectedTopupPlanCache = plan;
                $w('#repeatertopup').forEachItem(($i) => {
                    $i('#boxcolor').hide();
                });
                $item('#boxcolor').show();
            });
        });
        topupRepeaterBound = true;
    }

    if (!topupCheckoutBound) {
        $w('#buttoncheckout').onClick(async () => {
            if (!selectedTopupPlanCache) return;
            const amount = Number(selectedTopupPlanCache.sellingprice || 0);
            if (amount > 1000) {
                setupTopupProblemBox(amount);
                $w('#boxproblem2').show();
                try {
                    await submitTicket({
                        mode: 'topup_manual',
                        description: `[topup_manual] Client requested topup above 1000. Amount: ${clientCurrency} ${amount}. Please send invoice and update credit manually.`,
                        clientId: currentClientId || undefined
                    });
                } catch (e) {
                    console.warn('[billing] submitTicket topup_manual failed', e);
                }
                return;
            }
            const btnCheckout = $w('#buttoncheckout');
            btnCheckout.label = 'Loading...';
            btnCheckout.disable();
            try {
                const res = await startNormalTopup({
                    creditPlanId: selectedTopupPlanId,
                    returnUrl: wixLocation.url
                });
                if (!res?.url) throw new Error('NO_PAYMENT_URL');
                wixLocation.to(res.url);
            } catch (e) {
                console.error('[TOPUP FAILED]', e);
                btnCheckout.label = 'Checkout';
                btnCheckout.enable();
            }
        });
        topupCheckoutBound = true;
    }
}

function renderAddonUsage(billing) {
    const addons = (billing.pricingplandetail || []).filter((i) => i.type === 'addon');
    if (!addons.length) {
        $w('#textcreditusagepricingplan').collapse();
        return;
    }
    let text = '⭐ Current Add-ons\n';
    addons.forEach((a) => {
        text += `• ${a.title} × ${a.qty}\n`;
    });
    $w('#textcreditusagepricingplan').text = text.trim();
    $w('#textcreditusagepricingplan').expand();
}

function setupProblemBox() {
    const preview = pricingPreviewCache;
    if (!preview) return;
    const currency = clientCurrency;
    const amount = Number(preview.totalPayment || 0);
    let actionText = 'update your plan';
    if (preview.scenario === 'RENEW') actionText = 'renew your plan';
    if (preview.scenario === 'UPGRADE') actionText = 'upgrade your plan';
    if (preview.scenario === 'NEW') actionText = 'subscribe to a plan';
    let text = `
You are going to ${actionText}

Your payment required is more than ${currency} 1000
The payment required: ${currency} ${amount}

Please transfer to:
`;
    if (currency === 'SGD') {
        text += `
Public Bank (Singapore)
Please contact customer service for account details
`;
    } else {
        text += `
Public Bank Account
Coliving Management Sdn Bhd
3240130500
`;
    }
    text += `

Please drop your receipt to our customer services:
📞 6019-857 9627

We will manually update your account within 48 hours.
`;
    $w('#titleboxproblem').text = text.trim();
}

function formatMoney(amount) {
    return `${clientCurrency} ${Number(amount || 0)}`;
}

function setupTopupProblemBox(amount) {
    let text = `
Your top up amount is more than ${clientCurrency} 1000
The top up amount: ${clientCurrency} ${amount}

Please transfer to:
`;
    if (clientCurrency === 'SGD') {
        text += `
Public Bank (Singapore)
Please contact customer service for account details
`;
    } else {
        text += `
Public Bank Account
Coliving Management Sdn Bhd
3240130500
`;
    }
    text += `

Please drop your receipt to our customer services:
📞 6019-857 9627

We will manually update your credit within 48 hours.
`;
    $w('#textproblem').text = text.trim();
}

/** 导出：请求 Node 生成 Excel 并返回一次性下载 URL，再跳转下载（不依赖 XLSX/document）。 */
function bindExportButton() {
    $w('#buttonexport').onClick(async () => {
        $w('#buttonexport').disable();
        try {
            const res = await getStatementExportUrl({
                sort: statementState.sort,
                filterType: statementState.filterType,
                search: statementState.search
            });
            const url = res?.downloadUrl;
            if (url) {
                wixLocation.to(url);
            } else {
                console.error('[EXPORT] No downloadUrl in response', res);
            }
        } catch (e) {
            console.error('[EXPORT FAILED]', e);
        } finally {
            $w('#buttonexport').enable();
        }
    });
}
