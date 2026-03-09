/* =======================
   Migrated: Wix frontend + Node backend + MySQL.
   Cache + 前端 filter（与 expenses 一致）：日期范围内最多 2000 条进 cache，改筛选/排序不请求；超过 2000 走 server filter。
   页面结构：#sectiontab 内放 Tab 按钮（#buttonreport、#buttontopup、#buttonbankfile、#buttongeneratereport 等），始终 expand。
======================= */
import wixLocation from 'wix-location';
import wixWindow from 'wix-window';
import { getAccessContext } from 'backend/access/manage';
import { getMyBillingInfo, getCreditPlans, startNormalTopup } from 'backend/saas/topup';
import { submitTicket } from 'backend/saas/help';
import * as generatereportBackend from 'backend/saas/generatereport.jsw';
import { getBankBulkTransferData, getBankBulkTransferDownloadUrl } from 'backend/access/bankbulktransfer.jsw';

/* =======================
   let
======================= */
let accessCtx = null;
/** true when client has "Bank Bulk Transfer" addon (plan.addons title matches). Used to disable #buttonbankfile when customer has no addon. */
let hasBankBulkTransferAddon = false;
let activeSection = null;
let lastSectionBeforeTopup = 'profile';
let topupInited = false;
let selectedTopupPlanId = null;
let selectedTopupPlanCache = null;
let topupRepeaterBound = false;
let topupCheckoutBound = false;
let topupCloseBound = false;
let sectionSwitchBound = false;
let defaultSectionCollapsed = false;
let clientCurrency = 'MYR';
let selectedGRPropertyIds = new Set();
let currentGRData = {};
let currentRows = [];
let currentColumns = [];
let bulkQueue = [];
let isBulkRunning = false;
let grBound = false;
let reportLoaded = false;
let currentReportPage = 1;
let selectedReportIds = new Set();
let currentFilteredReports = [];
let currentReportDetailId = null;
let bankListLoaded = false;
let paymentMode = null; // 'single' | 'bulk'
/** 进入 gr / grdetail 前的 section，供 #buttonclosegr、#buttonclosegrdetail 返回上一个 section */
let sectionBeforeGr = null;
let sectionBeforeGrdetail = null;

/** 前端缓存：当前日期范围内最多 REPORT_CACHE_LIMIT 条；若 total > REPORT_CACHE_LIMIT 则走 server filter */
let reportCache = [];
let reportCacheTotal = 0;
let useServerFilter = false;
let cacheDateFrom = null;
let cacheDateTo = null;
let searchReportDebounceTimer = null;

const REPORT_PAGE_SIZE = 10;
const REPORT_CACHE_LIMIT = 2000;
const REPORT_SEARCH_DEBOUNCE_MS = 300;

/* =======================
   const
======================= */
const MAIN_SECTIONS = [
    'default',
    'report',
    'gr',
    'grdetail',
    'bank',
    'topup'
];

const sectionLoaded = { topup: false };

function safeCollapse(el) { try { if (el && typeof el.collapse === 'function') el.collapse(); } catch (_) {} }
function safeExpand(el) { try { if (el && typeof el.expand === 'function') el.expand(); } catch (_) {} }
function runMobileBranch() {
    $w('#textstatusloading').text = 'Please setting on pc version';
    $w('#textstatusloading').show();
    function applyMobileSections() {
        try {
            safeCollapse($w('#sectiontab'));
            MAIN_SECTIONS.forEach(k => safeCollapse($w(`#section${k}`)));
            safeExpand($w('#sectiondefault'));
            safeExpand($w('#sectionheader'));
        } catch (e) {}
    }
    applyMobileSections();
    setTimeout(applyMobileSections, 100);
    setTimeout(applyMobileSections, 400);
}

/* =======================
   onReady
======================= */
$w.onReady(() => {
    if (wixWindow.formFactor === "Mobile") {
        runMobileBranch();
        return;
    }
    disableMainActions();
    initDefaultSection();
    startInitAsync();
});

/* =======================
   init flow
======================= */
async function startInitAsync() {
    showPageLoading("Initializing...");
    accessCtx = await getAccessContext();
    clientCurrency = String(accessCtx.client?.currency || 'MYR').toUpperCase();
    const addons = accessCtx.plan?.addons || [];
    hasBankBulkTransferAddon = addons.some(a => /bank\s*bulk\s*transfer/i.test(String(a.title || '')));

    if (!accessCtx.ok) {
        showAccessDenied(accessCtx.reason === 'NO_PERMISSION' ? "You don't have permission" : "You don't have account yet");
        return;
    }
    if (!accessCtx.staff?.permission?.finance && !accessCtx.staff?.permission?.admin) {
        showAccessDenied("You don't have permission");
        return;
    }
    if (accessCtx.credit?.ok === false) {
        await enterForcedTopupModeManage();
        return;
    }
    bindAllButtons();
    bindSectionSwitch();
    bindTopupCloseButton();
    enableMainActions();
    bindProblemBoxClose();
    bindReportSection();
    updateBulkButtonState();
    bindMenuButton();
    hidePageLoading();
}

function showPageLoading(text = "Loading...") {
    $w('#textstatusloading').text = text;
    $w('#textstatusloading').show();
}

function hidePageLoading() {
    $w('#textstatusloading').hide();
}

/* =======================
   Section Switch
======================= */
function bindSectionSwitch() {
    if (sectionSwitchBound) return;
    sectionSwitchBound = true;
    $w('#buttontopup').onClick(async () => {
        const btn = $w('#buttontopup');
        btn.disable();
        const originalLabel = btn.label;
        btn.label = 'Loading...';
        try {
            lastSectionBeforeTopup = activeSection || 'profile';
            if (!topupInited) {
                await initTopupSection();
                topupInited = true;
            }
            await switchSectionAsync('topup');
        } finally {
            btn.enable();
            btn.label = originalLabel;
        }
    });
}

async function switchSectionAsync(sectionKey, opts) {
    if (activeSection === sectionKey) return;
    if (sectionKey === 'gr') sectionBeforeGr = activeSection;
    if (sectionKey === 'grdetail') sectionBeforeGrdetail = activeSection;
    collapseAllSections();
    try { $w('#sectiontab').expand(); } catch (_) {}
    try {
        const sec = $w(`#section${sectionKey}`);
        if (sectionKey === 'gr' && typeof sec.parent === 'function') {
            try {
                const parent = sec.parent();
                if (parent && typeof parent.expand === 'function') parent.expand();
            } catch (_) {}
        }
        sec.expand();
    } catch (_) {}
    activeSection = sectionKey;
    if (sectionKey === 'gr') {
        await new Promise(r => setTimeout(r, 150));
        if (!opts?.skipGrLoad) {
            await loadGrDataOnly();
        } else {
            if (opts?.grItems && Array.isArray(opts.grItems)) {
                try { $w('#repeatergr').data = opts.grItems; } catch (_) {}
            }
        }
        hideGRDescriptionIfEmpty();
        updateBulkButtonState();
    }
}

function collapseAllSections() {
    MAIN_SECTIONS.forEach(k => {
        const sec = $w(`#section${k}`);
        if (sec) sec.collapse();
    });
    try { $w('#sectiontab').expand(); } catch (_) {}
}

function initDefaultSection() {
    safeExpand($w('#sectionheader'));
    try { $w('#sectiontab').expand(); } catch (_) {}
    collapseAllSections();
    try { $w('#sectiondefault').expand(); } catch (_) {}
    activeSection = 'default';
}

function showSectionLoading(text = 'Loading...') {
    $w('#text19').text = text;
    $w('#text19').show();
}

function hideSectionLoading() {
    $w('#text19').hide();
}

function disableMainActions() {
    ['#buttontopup', '#buttonreport', '#buttonbankfile', '#buttongeneratereport'].forEach(id => {
        $w(id)?.disable?.();
    });
}

function enableMainActions() {
    ['#buttontopup', '#buttonreport', '#buttonbankfile', '#buttongeneratereport'].forEach(id => {
        $w(id)?.enable?.();
    });
}

function showAccessDenied(message) {
    initDefaultSection();
    $w('#textstatusloading').text = message;
    $w('#textstatusloading').show();
    disableMainActions();
}

async function enterForcedTopupModeManage() {
    collapseAllSections();
    $w('#sectiontopup').expand();
    activeSection = 'topup';
    defaultSectionCollapsed = true;
}

/* =======================
   Topup Section (credit plans from Node /api/billing/credit-plans)
======================= */
async function initTopupSection() {
    const billing = await getMyBillingInfo();
    const credits = Array.isArray(billing.credit) ? billing.credit : [];
    const totalCredit = credits.reduce((s, c) => s + Number(c.amount || 0), 0);
    $w('#textcurrentcredit').text = `Current Credit Balance: ${totalCredit}`;

    const plans = await getCreditPlans();
    $w('#repeatertopup').data = plans;

    if (!topupRepeaterBound) {
        $w('#repeatertopup').onItemReady(($item, plan) => {
            $item('#textamount').text = `${clientCurrency} ${plan.sellingprice}`;
            $item('#textcreditamount').text = String(plan.credit);
            $item('#boxcolor').hide();
            $item('#containertopup').onClick(() => {
                selectedTopupPlanId = plan._id || plan.id;
                selectedTopupPlanCache = plan;
                $w('#repeatertopup').forEachItem($i => $i('#boxcolor').hide());
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
                        clientId: accessCtx?.client?.id || undefined
                    });
                } catch (e) {
                    console.warn('[generatereport] submitTicket topup_manual failed', e);
                }
                return;
            }
            const res = await startNormalTopup({
                creditPlanId: selectedTopupPlanId,
                redirectUrl: wixLocation.url
            });
            wixLocation.to(res.url);
        });
        topupCheckoutBound = true;
    }
}

function bindTopupCloseButton() {
    if (topupCloseBound) return;
    topupCloseBound = true;
    $w('#buttontopupclose').onClick(async () => {
        if (accessCtx?.credit?.ok === false) return;
        $w('#sectiontopup').collapse();
        const target = lastSectionBeforeTopup || 'profile';
        $w(`#section${target}`).expand();
        activeSection = target;
    });
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
`;
    $w('#textproblem').text = text.trim();
}

function bindProblemBoxClose() {
    $w('#buttoncloseproblem2').onClick(() => $w('#boxproblem2').hide());
}

/* =======================
   Report / GR: properties from Node /api/generatereport/properties
   Wix 编辑器内 GR 区必须：先有一个容器（Strip/Box）ID 设为 sectiongr，再在该容器「内部」添加
   #datepicker1gr #datepicker2gr #repeatergr #textdescription #checkboxallgr #buttongr #buttonclosegr；
   repeater 项内：#textitlegr #checkboxgr #buttongrdetail。否则展开后 sectiongr 会看不到任何 element。
======================= */
function hideGRDescriptionIfEmpty() {
    try {
        const t = $w('#textdescription');
        if (!t.text || String(t.text).trim() === '') t.hide();
    } catch (e) { /* #textdescription optional */ }
}

/** 只加载 GR 区数据（repeatergr），不切换 section；datepicker1gr/2gr 默认上个月 1 号～上个月最后一天。返回 items 供按钮先 await 再 switch 时重设 repeater。 */
async function loadGrDataOnly() {
    selectedGRPropertyIds.clear();
    currentGRData = {};
    let items = [];
    try {
        const res = await generatereportBackend.getReportProperties();
        items = Array.isArray(res?.items) ? res.items : [];
    } catch (e) {
        const msg = (e && typeof e.message === 'string' && e.message) ? e.message : 'Check connection or contact support.';
        try {
            $w('#textdescription').text = 'Unable to load properties: ' + msg;
            $w('#textdescription').show();
        } catch (_) {}
    }
    const { firstDay, lastDay } = getLastMonthRangeMY();
    try {
        $w('#datepicker1gr').value = firstDay;
        $w('#datepicker2gr').value = lastDay;
    } catch (_) {}
    try {
        $w('#repeatergr').data = items;
    } catch (_) {}
    try {
        $w('#checkboxallgr').checked = false;
    } catch (_) {}
    try {
        if (items.length === 0) {
            $w('#textdescription').text = 'No properties for this account. Add properties in Company Setting first.';
            $w('#textdescription').show();
        } else {
            $w('#textdescription').text = '';
            $w('#textdescription').hide();
        }
    } catch (_) {}
    if (!grBound) {
        bindGRRepeater();
        bindGRSelectAll();
        grBound = true;
    }
    return items;
}

async function initReportSection() {
    await loadGrDataOnly();
    await switchSectionAsync('gr');
}

function bindReportSection() {
    $w('#buttonclosegr').onClick(async () => switchSectionAsync(sectionBeforeGr || 'report'));
    // PDF 由 Node 生成，不再使用 html2 iframe
}

/** 默认日期：上个月 1 号～上个月最后一天（与 GR 一致），马来西亚 UTC+8 */
function getDefaultReportDateRange() {
    const { firstDay, lastDay } = getLastMonthRangeMY();
    return { from: firstDay, to: lastDay };
}

/** 将 Date 转为马来西亚 (UTC+8) 的日期字符串 YYYY-MM-DD；datepicker 可能给本地午夜或 UTC，此处统一按 UTC+8 取“日”供 API from/to 与后端查表（表存 UTC+0）对齐 */
function toMalaysiaDateOnly(d) {
    if (!d) return null;
    const x = d instanceof Date ? d : new Date(d);
    const malaysiaMs = x.getTime() + (8 * 60 * 60 * 1000);
    return new Date(malaysiaMs).toISOString().substring(0, 10);
}

/** 将 Date 转为显示用字符串（马来西亚 UTC+8），如 "1 Feb 2026" */
function formatDateDisplay(d) {
    if (!d) return '';
    const x = d instanceof Date ? d : new Date(d);
    const malaysiaMs = x.getTime() + (8 * 60 * 60 * 1000);
    const my = new Date(malaysiaMs);
    const day = my.getUTCDate();
    const month = my.toLocaleString('en-GB', { month: 'short' }).toUpperCase();
    const year = my.getUTCFullYear();
    return `${day} ${month} ${year}`;
}

function getCurrentReportFilterOpts() {
    return {
        property: $w('#dropdownproperty').value || 'ALL',
        type: $w('#dropdowntype').value || 'ALL',
        from: $w('#datepicker1').value || null,
        to: $w('#datepicker2').value || null,
        search: ($w('#inputsearch').value || '').trim(),
        sort: $w('#dropdownsort').value || 'new'
    };
}

async function initReportSectionList() {
    showSectionLoading('Loading Reports...');
    await setupReportFilters();
    bindReportRepeater();
    bindReportSelectAll();
    bindReportPagination();
    const defaultRange = getDefaultReportDateRange();
    $w('#datepicker1').value = defaultRange.from;
    $w('#datepicker2').value = defaultRange.to;
    bindReportFilterEvents();
    await fetchAndFillCache(defaultRange.from, defaultRange.to);
    applyFilterAndSort();
    hideSectionLoading();
}

async function setupReportFilters() {
    const { items } = await generatereportBackend.getReportProperties();
    $w('#dropdowntype').options = [
        { label: "All", value: "ALL" },
        { label: "Paid", value: "PAID" },
        { label: "Unpaid", value: "UNPAID" }
    ];
    $w('#dropdowntype').value = "ALL";
    $w('#dropdownproperty').options = [
        { label: 'All Property', value: 'ALL' },
        ...items.map(p => ({ label: p.shortname, value: String(p.id || p._id || '') }))
    ];
    $w('#dropdownsort').options = [
        { label: 'New to Old', value: 'new' },
        { label: 'Old to New', value: 'old' },
        { label: 'Amount Big to Small', value: 'amountdesc' },
        { label: 'Amount Small to Big', value: 'amountasc' }
    ];
}

/** 日期变更 → 从 server 拉新数据并更新 cache，回到第一页 */
async function onReportDateRangeChange() {
    resetReportToFirstPage();
    const from = $w('#datepicker1').value;
    const to = $w('#datepicker2').value;
    $w('#repeaterreport').data = [];
    showSectionLoading('Loading...');
    await fetchAndFillCache(from, to);
    applyFilterAndSort();
    hideSectionLoading();
}

async function fetchAndFillCache(from, to) {
    cacheDateFrom = from;
    cacheDateTo = to;
    const fromVal = toMalaysiaDateOnly(from);
    const toVal = toMalaysiaDateOnly(to);
    const res = await generatereportBackend.getOwnerReports({
        from: fromVal,
        to: toVal,
        sort: $w('#dropdownsort').value || 'new',
        limit: REPORT_CACHE_LIMIT
    });
    const total = Number(res.totalCount) || 0;
    const items = Array.isArray(res.items) ? res.items : [];
    if (total <= REPORT_CACHE_LIMIT) {
        reportCache = items;
        reportCacheTotal = total;
        useServerFilter = false;
    } else {
        reportCache = [];
        reportCacheTotal = total;
        useServerFilter = true;
    }
}

function invalidateReportCache() {
    reportCache = [];
    reportCacheTotal = 0;
    cacheDateFrom = null;
    cacheDateTo = null;
}

async function refetchAfterWrite() {
    const from = $w('#datepicker1').value;
    const to = $w('#datepicker2').value;
    invalidateReportCache();
    showSectionLoading('Loading...');
    await fetchAndFillCache(from, to);
    applyFilterAndSort();
    hideSectionLoading();
}

function resetReportToFirstPage() {
    currentReportPage = 1;
    try { $w('#paginationreport').currentPage = 1; } catch (_) {}
}

function bindReportFilterEvents() {
    $w('#datepicker1').onChange(() => onReportDateRangeChange());
    $w('#datepicker2').onChange(() => onReportDateRangeChange());
    $w('#dropdownproperty').onChange(() => {
        resetReportToFirstPage();
        applyFilterAndSort();
    });
    $w('#dropdowntype').onChange(() => {
        resetReportToFirstPage();
        applyFilterAndSort();
    });
    $w('#dropdownsort').onChange(() => {
        resetReportToFirstPage();
        applyFilterAndSort();
    });
    $w('#inputsearch').onInput(() => {
        if (searchReportDebounceTimer) clearTimeout(searchReportDebounceTimer);
        searchReportDebounceTimer = setTimeout(() => {
            searchReportDebounceTimer = null;
            resetReportToFirstPage();
            applyFilterAndSort();
        }, REPORT_SEARCH_DEBOUNCE_MS);
    });
}

function sortReports(items, sortKey) {
    const key = String(sortKey || 'new').toLowerCase();
    const arr = [...items];
    if (key === 'old') return arr.sort((a, b) => (new Date(a.period || 0)).getTime() - (new Date(b.period || 0)).getTime());
    if (key === 'new') return arr.sort((a, b) => (new Date(b.period || 0)).getTime() - (new Date(a.period || 0)).getTime());
    if (key === 'az') return arr.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    if (key === 'za') return arr.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
    if (key === 'amountasc') return arr.sort((a, b) => Number(a.netpayout || 0) - Number(b.netpayout || 0));
    if (key === 'amountdesc') return arr.sort((a, b) => Number(b.netpayout || 0) - Number(a.netpayout || 0));
    return arr;
}

/** 根据 useServerFilter 走前端过滤或 server 分页 */
function applyFilterAndSort() {
    if (useServerFilter) {
        loadReportPageFromServer(currentReportPage);
        return;
    }
    applyFilterAndSortToCache();
}

/** 前端：对 cache 过滤 + 排序 + 分页（与 expenses 一致：cache + 前端 filter） */
function applyFilterAndSortToCache() {
    const opts = getCurrentReportFilterOpts();
    let list = reportCache;
    if (opts.property && opts.property !== 'ALL') {
        list = list.filter(i => String(i.property?._id ?? i.property?.id ?? '') === String(opts.property));
    }
    if (opts.type === 'PAID') list = list.filter(i => i.paid);
    if (opts.type === 'UNPAID') list = list.filter(i => !i.paid);
    if (opts.search) {
        const s = opts.search.toLowerCase();
        list = list.filter(i => (i.title || '').toLowerCase().includes(s));
    }
    list = sortReports(list, opts.sort);
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE));
    const start = (currentReportPage - 1) * REPORT_PAGE_SIZE;
    currentFilteredReports = list.slice(start, start + REPORT_PAGE_SIZE);
    $w('#paginationreport').totalPages = totalPages;
    $w('#paginationreport').currentPage = currentReportPage;
    $w('#repeaterreport').data = currentFilteredReports;
    updateReportSelectAll();
    updateReportTotalText();
    updateBulkButtonState();
}

async function loadReportPageFromServer(pageNumber) {
    currentReportPage = pageNumber;
    const opts = getCurrentReportFilterOpts();
    $w('#repeaterreport').data = [];
    showSectionLoading('Loading...');
    const fromVal = toMalaysiaDateOnly(opts.from);
    const toVal = toMalaysiaDateOnly(opts.to);
    const res = await generatereportBackend.getOwnerReports({
        property: opts.property,
        from: fromVal,
        to: toVal,
        search: opts.search,
        sort: opts.sort,
        type: opts.type,
        page: currentReportPage,
        pageSize: REPORT_PAGE_SIZE
    });
    currentFilteredReports = Array.isArray(res.items) ? res.items : [];
    $w('#paginationreport').totalPages = res.totalPages || 1;
    $w('#paginationreport').currentPage = res.currentPage || 1;
    $w('#repeaterreport').data = currentFilteredReports;
    hideSectionLoading();
    updateReportSelectAll();
    updateReportTotalText();
    updateBulkButtonState();
}

/** 当前筛选条件下的全部 id（用于全选） */
function getFilteredReportIds() {
    if (useServerFilter) return null;
    const opts = getCurrentReportFilterOpts();
    let list = reportCache;
    if (opts.property && opts.property !== 'ALL') list = list.filter(i => String(i.property?._id ?? i.property?.id ?? '') === String(opts.property));
    if (opts.type === 'PAID') list = list.filter(i => i.paid);
    if (opts.type === 'UNPAID') list = list.filter(i => !i.paid);
    if (opts.search) {
        const s = opts.search.toLowerCase();
        list = list.filter(i => (i.title || '').toLowerCase().includes(s));
    }
    return list.map(i => i._id).filter(Boolean);
}

function bindReportRepeater() {
    $w('#repeaterreport').onItemReady(($item, item) => {
        const id = item._id;
        $item('#textpropertyname').text = item.property?.shortname || '';
        $item('#textdate').text = formatDateDisplay(item.period);
        $item('#texttitlereport').text = item.title || '';
        $item('#textnetpayout').text = `${clientCurrency} ${Number(item.netpayout || 0).toFixed(2)}`;
        if (item.paid) {
            $item('#boxexpensescolor').style.backgroundColor = '#dff5f2';
        } else {
            $item('#boxexpensescolor').style.backgroundColor = '#fde2e2';
        }
        $item('#checkboxreport').checked = selectedReportIds.has(id);
        $item('#checkboxreport').onChange((e) => {
            if (e.target.checked) selectedReportIds.add(id);
            else selectedReportIds.delete(id);
            updateBulkButtonState();
            updateReportSelectAll();
            updateReportTotalText();
        });
        $item('#buttonreportdetail').onClick(() => openReportDetail(item));
    });
}

function bindReportSelectAll() {
    $w('#checkboxall').onChange(async (e) => {
        const checked = e.target.checked;
        if (useServerFilter) {
            const allFiltered = await getAllFilteredReports();
            if (checked) allFiltered.forEach(item => selectedReportIds.add(item._id));
            else allFiltered.forEach(item => selectedReportIds.delete(item._id));
        } else {
            const ids = getFilteredReportIds();
            if (ids) {
                if (checked) ids.forEach(id => selectedReportIds.add(id));
                else ids.forEach(id => selectedReportIds.delete(id));
            }
        }
        refreshReportCheckbox();
        updateReportSelectAll();
        updateReportTotalText();
        updateBulkButtonState();
    });
}

function refreshReportCheckbox() {
    $w('#repeaterreport').forEachItem(($item, item) => {
        $item('#checkboxreport').checked = selectedReportIds.has(item._id);
    });
}

function updateReportSelectAll() {
    const total = currentFilteredReports.length;
    const selectedCount = currentFilteredReports.filter(i => selectedReportIds.has(i._id)).length;
    $w('#checkboxall').checked = total && selectedCount === total;
}

function openReportDetail(item) {
    currentReportDetailId = item._id;
    $w('#textdetailexpenses').text = `
Total Rental: ${clientCurrency} ${Number(item.totalrental).toFixed(2)}
Total Utility: ${clientCurrency} ${Number(item.totalutility).toFixed(2)}
Total Collection: ${clientCurrency} ${Number(item.totalcollection).toFixed(2)}
(-) Total Expenses: ${clientCurrency} ${Number(item.expenses).toFixed(2)}

Net Payout: ${clientCurrency} ${Number(item.netpayout).toFixed(2)}
`;
    if (item.bukkuinvoice) {
        $w('#buttoninvoice').expand();
        $w('#buttoninvoice').onClick(() => wixLocation.to(item.bukkuinvoice));
    } else {
        $w('#buttoninvoice').collapse();
    }
    if (item.bukkubills) {
        $w('#buttonpayout').expand();
        $w('#buttonpayout').onClick(() => wixLocation.to(item.bukkubills));
    } else {
        $w('#buttonpayout').collapse();
    }
    // Node 生成 PDF：若在 Wix 里加了「下载 PDF」「上传到 Drive」按钮，请把其 ID 设为 buttondownloadpdf、buttonuploadpdf，
    // 然后在本文件顶部取消注释并启用下面两段（或复制到 openReportDetail 内）。
    // 下载：getOwnerReportPdfDownloadUrl(currentReportDetailId) -> wixLocation.to(res.downloadUrl)
    // 上传：generateAndUploadOwnerReportPdf(currentReportDetailId)
    $w('#boxdetail').show();
}

/* =======================
   Buttons
======================= */
function bindAllButtons() {
    $w('#buttonsubmitpayment').onClick(handleSubmitPayment);
    $w("#buttongr").onClick(async () => {
        if (!selectedGRPropertyIds.size) return;
        const btn = $w("#buttongr");
        btn.disable();
        const originalLabel = btn.label;
        btn.label = "Loading";
        const ids = Array.from(selectedGRPropertyIds);
        const noFolderNames = [];
        try {
            const { firstDay, lastDay } = getLastMonthRangeMY();
            const safePeriod = new Date(firstDay);
            safePeriod.setHours(12, 0, 0, 0);
            const monthName = firstDay.toLocaleString("en-US", { month: "long" });
            const year = firstDay.getFullYear();
            for (const propertyId of ids) {
                const property = $w('#repeatergr').data.find(p => (p.id || p._id) === propertyId);
                if (!property) continue;
                const shortname = property.shortname || '';
                try {
                    const payout = await generatereportBackend.generateOwnerPayout(propertyId, shortname, firstDay, lastDay);
                    const inserted = await generatereportBackend.insertOwnerReport({
                        property: propertyId,
                        period: safePeriod,
                        title: `${monthName} ${year} ${shortname}`,
                        totalrental: payout.totalrental,
                        totalutility: payout.totalutility,
                        totalcollection: payout.totalcollection,
                        expenses: payout.expenses,
                        managementfee: payout.managementfee,
                        netpayout: payout.netpayout
                    });
                    if (inserted?.record?._id) {
                        try {
                            await generatereportBackend.generateAndUploadOwnerReportPdf(inserted.record._id);
                        } catch (e) {
                            if (String(e?.message || '').includes('PROPERTY_FOLDER_NOT_SET') || String(e?.message || '').includes('FOLDER')) {
                                noFolderNames.push(shortname || propertyId);
                            }
                        }
                    }
                } catch (_) {}
            }
            try {
                const desc = $w('#textdescription');
                desc.text = noFolderNames.length
                    ? "No folder set for: " + noFolderNames.join(", ")
                    : "Your report will be ready in 5 mins";
                desc.show();
            } catch (e) { /* optional */ }
            selectedGRPropertyIds.clear();
            $w('#repeatergr').forEachItem($item => { $item('#checkboxgr').checked = false; });
            if (reportLoaded) await refetchAfterWrite();
            else {
                await initReportSectionList();
                reportLoaded = true;
            }
            await switchSectionAsync('report');
        } catch (_) {}
        finally {
            btn.enable();
            btn.label = originalLabel;
        }
    });

    $w('#buttonclosegrdetail').onClick(async () => switchSectionAsync(sectionBeforeGrdetail || 'gr', { skipGrLoad: true }));
    $w('#buttonreport').onClick(async () => {
        const btn = $w('#buttonreport');
        btn.disable();
        const originalLabel = btn.label;
        btn.label = "Loading";
        try {
            if (!reportLoaded) {
                await initReportSectionList();
                reportLoaded = true;
            }
            await switchSectionAsync('report');
        } finally {
            btn.enable();
            btn.label = originalLabel;
        }
    });

    $w('#buttonbankfile').onClick(async () => {
        if (!selectedReportIds.size) return;
        const btn = $w('#buttonbankfile');
        btn.disable();
        const origLabel = btn.label;
        btn.label = "Loading";
        try {
            if (!bankListLoaded) {
                await initBankSection();
                bankListLoaded = true;
            }
            await switchSectionAsync('bank');
        } finally {
            btn.enable();
            btn.label = origLabel;
        }
    });

    // 下载选中报告 PDF：Report 列表勾选用 selectedReportIds；GR 区勾选物业用 selectedGRPropertyIds（按 GR 日期查 report 再下载）。
    try {
        $w('#buttondownloadpdfgr').onClick(async () => {
            let ids = Array.from(selectedReportIds);
            if (ids.length === 0 && selectedGRPropertyIds.size > 0) {
                const from = $w('#datepicker1gr').value;
                const to = $w('#datepicker2gr').value;
                const fromVal = toMalaysiaDateOnly(from);
                const toVal = toMalaysiaDateOnly(to);
                const res = await generatereportBackend.getOwnerReports({ from: fromVal, to: toVal, limit: REPORT_CACHE_LIMIT });
                const items = Array.isArray(res?.items) ? res.items : [];
                const propertyIdSet = new Set([...selectedGRPropertyIds].map(String));
                ids = items.filter(i => propertyIdSet.has(String(i.property?._id || i.property_id || ''))).map(i => i._id || i.id).filter(Boolean);
                if (!ids.length) return;
            } else if (!ids.length) return;
            const btn = $w('#buttondownloadpdfgr');
            btn.disable();
            const originalLabel = btn.label;
            btn.label = "Loading";
            try {
                const res = await generatereportBackend.getOwnerReportsPdfDownloadUrl(ids);
                if (res?.downloadUrl) wixLocation.to(res.downloadUrl);
            } catch (_) {}
            finally {
                btn.enable();
                btn.label = originalLabel;
            }
        });
    } catch (e) { /* #buttondownloadpdfgr 未添加时忽略 */ }

    $w('#buttongeneratereport').onClick(async () => {
        const btn = $w('#buttongeneratereport');
        btn.disable();
        const originalLabel = btn.label;
        btn.label = "Loading...";
        try {
            const grItems = await loadGrDataOnly();
            await switchSectionAsync('gr', { skipGrLoad: true, grItems });
        } catch (_) {}
        finally {
            btn.enable();
            btn.label = originalLabel;
        }
    });

    $w('#buttonclosegr').onClick(async () => switchSectionAsync(sectionBeforeGr || 'report'));
    $w('#checkboxall').onChange(handleReportSelectAll);
    $w('#buttonclosedetail').onClick(() => {
        currentReportDetailId = null;
        $w('#boxdetail').hide();
    });
    $w('#buttonpay').onClick(handleReportPay);
    $w('#buttondeletereport').onClick(handleReportDelete);
    $w('#buttonbulkpaid').onClick(handleReportBulkPaid);
    $w('#buttonbulkdelete').onClick(handleReportBulkDelete);
}


async function handleReportSelectAll(e) {
    const checked = e.target.checked;
    const allFiltered = await getAllFilteredReports();
    if (checked) {
        allFiltered.forEach(item => selectedReportIds.add(item._id));
    } else {
        allFiltered.forEach(item => selectedReportIds.delete(item._id));
    }
    await updateReportTotalText();
    refreshReportCheckbox();
    updateBulkButtonState();
    updateReportSelectAll();
}

async function handleReportPay() {
    if (!currentReportDetailId) return;
    paymentMode = 'single';
    $w('#datepickerpayment').value = null;
    $w('#dropdownpaymentmethod').value = undefined;
    $w('#boxpayment').show();
}

let deleteConfirm = false;
async function handleReportDelete() {
    if (!deleteConfirm) {
        deleteConfirm = true;
        $w('#buttondeletereport').label = "Confirm Delete";
        return;
    }
    await generatereportBackend.deleteOwnerReport(currentReportDetailId);
    deleteConfirm = false;
    $w('#buttondeletereport').label = "Delete";
    $w('#boxdetail').hide();
    await refetchAfterWrite();
}

/** #buttonbulkpaid 点击后打开 #boxpayment（批量填 payment 日期/方式并提交） */
async function handleReportBulkPaid() {
    if (!selectedReportIds.size) return;
    paymentMode = 'bulk';
    $w('#datepickerpayment').value = null;
    $w('#dropdownpaymentmethod').value = undefined;
    $w('#boxpayment').show();
}

let bulkDeleteConfirm = false;
async function handleReportBulkDelete() {
    const btn = $w('#buttonbulkdelete');
    if (!bulkDeleteConfirm) {
        bulkDeleteConfirm = true;
        btn.label = "Confirm Delete";
        return;
    }
    btn.disable();
    const originalLabel = btn.label;
    btn.label = "Deleting...";
    try {
        for (const id of selectedReportIds) {
            await generatereportBackend.deleteOwnerReport(id);
        }
        selectedReportIds.clear();
        bulkDeleteConfirm = false;
        await refetchAfterWrite();
    } catch (_) {}
    finally {
        btn.enable();
        btn.label = "Delete";
    }
}

function bindReportPagination() {
    $w('#paginationreport').onChange(async (event) => {
        currentReportPage = event.target.currentPage;
        if (useServerFilter) await loadReportPageFromServer(currentReportPage);
        else applyFilterAndSortToCache();
    });
}

async function updateReportTotalText() {
    if (!selectedReportIds.size) {
        $w('#texttotal').hide();
        return;
    }
    const ids = Array.from(selectedReportIds);
    const res = await generatereportBackend.getOwnerReportsTotal(ids);
    const count = res.count || 0;
    const total = res.total || 0;
    $w('#texttotal').text = `Selected: ${count} | Total: ${clientCurrency} ${total.toFixed(2)}`;
    $w('#texttotal').show();
}

/** 当前筛选条件下的全部 item（全选时用）。cache 模式从 cache 取；server 模式分页请求拼全量 */
async function getAllFilteredReports() {
    if (!useServerFilter) {
        const opts = getCurrentReportFilterOpts();
        let list = reportCache;
        if (opts.property && opts.property !== 'ALL') list = list.filter(i => String(i.property?._id ?? i.property?.id ?? '') === String(opts.property));
        if (opts.type === 'PAID') list = list.filter(i => i.paid);
        if (opts.type === 'UNPAID') list = list.filter(i => !i.paid);
        if (opts.search) list = list.filter(i => (i.title || '').toLowerCase().includes(opts.search.toLowerCase()));
        return sortReports(list, opts.sort);
    }
    let page = 1;
    let allItems = [];
    let totalPages = 1;
    const opts = getCurrentReportFilterOpts();
    const fromVal = toMalaysiaDateOnly(opts.from);
    const toVal = toMalaysiaDateOnly(opts.to);
    do {
        const res = await generatereportBackend.getOwnerReports({
            property: opts.property,
            from: fromVal,
            to: toVal,
            search: opts.search,
            sort: opts.sort,
            type: opts.type,
            page,
            pageSize: 1000
        });
        allItems = [...allItems, ...(res.items || [])];
        totalPages = res.totalPages || 1;
        page++;
    } while (page <= totalPages);
    return allItems;
}

function bindMenuButton() {
    const isDesktop = wixWindow.formFactor === "Desktop";
    $w("#boxmenu").hide();
    if (isDesktop) {
        $w("#buttonmenu").onMouseIn(() => {
            updateBulkButtonState();
            $w("#boxmenu").show();
            $w("#boxmenu").expand();
        });
        $w("#boxmenu").onMouseOut(() => {
            $w("#boxmenu").hide();
            $w("#boxmenu").collapse();
        });
    } else {
        $w("#buttonmenu").onClick(() => {
            const isHidden = !$w("#boxmenu").isVisible;
            if (isHidden) {
                updateBulkButtonState();
                $w("#boxmenu").show();
                $w("#boxmenu").expand();
            } else {
                $w("#boxmenu").hide();
                $w("#boxmenu").collapse();
            }
        });
    }
}

function updateBulkButtonState() {
    const hasReportSelection = selectedReportIds.size > 0;
    const hasGRPropertySelection = selectedGRPropertyIds.size > 0;
    if (hasReportSelection) {
        $w('#buttonbulkpaid').enable();
        $w('#buttonbulkdelete').enable();
        if (hasBankBulkTransferAddon) $w('#buttonbankfile').enable();
        else $w('#buttonbankfile').disable();
    } else {
        $w('#buttonbulkpaid').disable();
        $w('#buttonbulkdelete').disable();
        $w('#buttonbankfile').disable();
    }
    try {
        if (hasReportSelection || hasGRPropertySelection) {
            $w('#buttondownloadpdfgr').enable();
        } else {
            $w('#buttondownloadpdfgr').disable();
        }
    } catch (e) { /* optional */ }
}

async function initBankSection() {
    const res = await getBankBulkTransferData();
    if (!res?.banks?.length) return;
    $w('#dropdownbank').options = res.banks.map(b => ({ label: b.label, value: b.value }));
    $w('#dropdownbank').value = res.banks[0].value;
    bindBankDownload();
    $w('#buttonclosebank').onClick(async () => switchSectionAsync('report'));
}

/** 银行文件下载：与 expenses 一致，Node 生成 Excel/zip 返回 download URL；#dropdownbank 传入 bank 决定用哪个 template（后期可有别的银行） */
function bindBankDownload() {
    $w('#buttondownloadfile').onClick(async () => {
        const selectedBank = $w('#dropdownbank').value;
        const allIds = Array.from(selectedReportIds);
        if (!allIds.length) return;
        const btn = $w('#buttondownloadfile');
        btn.disable();
        const originalLabel = btn.label;
        btn.label = "Loading";
        try {
            const res = await getBankBulkTransferDownloadUrl({
                bank: selectedBank,
                type: "owner",
                ids: allIds
            });
            if (res?.urls?.length && res.urls[0].url) {
                wixLocation.to(res.urls[0].url);
            }
        } catch (_) {}
        finally {
            btn.enable();
            btn.label = originalLabel;
        }
    });
}

async function handleSubmitPayment() {
    const btn = $w('#buttonsubmitpayment');
    const date = $w('#datepickerpayment').value;
    const method = $w('#dropdownpaymentmethod').value;
    if (!date || !method) return;
    btn.disable();
    const originalLabel = btn.label;
    btn.label = "Saving...";
    try {
        if (paymentMode === 'single') {
            if (!currentReportDetailId) return;
            await generatereportBackend.updateOwnerReport(currentReportDetailId, {
                paid: true,
                accountingStatus: 'pending',
                paymentDate: date,
                paymentMethod: method
            });
        } else if (paymentMode === 'bulk') {
            if (!selectedReportIds.size) return;
            await generatereportBackend.bulkUpdateOwnerReport(Array.from(selectedReportIds), {
                paid: true,
                accountingStatus: 'pending',
                paymentDate: date,
                paymentMethod: method
            });
            selectedReportIds.clear();
        }
        paymentMode = null;
        $w('#boxpayment').hide();
        $w('#boxdetail').hide();
        await refetchAfterWrite();
    } catch (_) {}
    finally {
        btn.enable();
        btn.label = originalLabel;
    }
}

function bindGRRepeater() {
    $w('#repeatergr').onItemReady(($item, property) => {
        const id = String(property.id || property._id || '');
        $item('#textitlegr').text = property.shortname || '';
        $item('#checkboxgr').checked = selectedGRPropertyIds.has(id);
        $item('#checkboxgr').onChange((e) => {
            if (e.target.checked) selectedGRPropertyIds.add(id);
            else selectedGRPropertyIds.delete(id);
            updateGRSelectAll();
        });
        $item('#buttongrdetail').onClick(async () => {
            const detailBtn = $item('#buttongrdetail');
            detailBtn.disable();
            const origLabel = detailBtn.label;
            detailBtn.label = 'Loading...';
            try {
                await loadGRDetail(property);
            } catch (_) {}
            finally {
                detailBtn.enable();
                detailBtn.label = origLabel;
            }
        });
    });
}

function bindGRSelectAll() {
    $w('#checkboxallgr').onChange((e) => {
        const checked = e.target.checked;
        $w('#repeatergr').forEachItem(($item, property) => {
            const id = String(property.id || property._id || '');
            if (checked) selectedGRPropertyIds.add(id);
            else selectedGRPropertyIds.delete(id);
            $item('#checkboxgr').checked = checked;
        });
        updateBulkButtonState();
    });
}

function updateGRSelectAll() {
    const data = $w('#repeatergr').data || [];
    const total = data.length;
    const selectedCount = data.filter(p => selectedGRPropertyIds.has(String(p.id || p._id || ''))).length;
    $w('#checkboxallgr').checked = total && selectedCount === total;
    updateBulkButtonState();
}

async function loadGRDetail(property) {
    const datepicker1grValue = $w('#datepicker1gr').value;
    const datepicker2grValue = $w('#datepicker2gr').value;
    console.log('[tablegr] datepicker1gr (from)', {
        value: datepicker1grValue,
        type: typeof datepicker1grValue,
        iso: datepicker1grValue?.toISOString?.(),
        malaysiaDate: datepicker1grValue != null ? toMalaysiaDateOnly(datepicker1grValue) : null
    });
    console.log('[tablegr] datepicker2gr (to)', {
        value: datepicker2grValue,
        type: typeof datepicker2grValue,
        iso: datepicker2grValue?.toISOString?.(),
        malaysiaDate: datepicker2grValue != null ? toMalaysiaDateOnly(datepicker2grValue) : null
    });
    let firstDay = datepicker1grValue;
    let lastDay = datepicker2grValue;
    if (!firstDay || !lastDay) {
        const range = getLastMonthRangeMY();
        firstDay = range.firstDay;
        lastDay = range.lastDay;
        console.log('[tablegr] date empty, using default range', { firstDay: firstDay?.toISOString?.(), lastDay: lastDay?.toISOString?.() });
    }
    const propertyId = property.id || property._id;
    const shortname = property.shortname || '';
    const firstDayStr = toMalaysiaDateOnly(firstDay) || '';
    const lastDayStr = toMalaysiaDateOnly(lastDay) || '';
    console.log('[tablegr] loadGRDetail API params', { propertyId, shortname, firstDayStr, lastDayStr });
    const payout = await generatereportBackend.generateOwnerPayout(propertyId, shortname, firstDayStr, lastDayStr);
    const rowCount = payout?.rows?.length ?? 0;
    console.log('[tablegr] generateOwnerPayout result', { rowCount, hasRows: Array.isArray(payout?.rows), keys: payout ? Object.keys(payout) : [] });
    if (rowCount === 0 && payout) {
        console.log('[tablegr] payout (no rows)', JSON.stringify({ totalrental: payout.totalrental, totalutility: payout.totalutility, totalcollection: payout.totalcollection, expenses: payout.expenses, managementfee: payout.managementfee, netpayout: payout.netpayout }));
    }
    // 与旧代码一致：columns 含 alignment；rows 为 plain object 数组，key 对应 dataPath
    const columns = [
        { id: "no", dataPath: "no", label: "No", type: "string", width: 40, alignment: "center" },
        { id: "description", dataPath: "description", label: "Description", type: "string", width: 400, alignment: "left" },
        { id: "amount", dataPath: "amount", label: "Amount", type: "string", width: 120, alignment: "right" }
    ];
    const toTableRow = (r) => ({
        no: r.no != null ? String(r.no) : "",
        description: r.description != null ? String(r.description) : "",
        amount: r.amount != null ? String(r.amount) : ""
    });
    const rows = (payout?.rows ?? []).map(toTableRow);
    console.log('[tablegr] loaded data items (rows)', rows.length, rows);
    $w("#tablegr").columns = columns;
    $w("#tablegr").rows = rows;
    await switchSectionAsync('grdetail');
    try { $w("#tablegr").expand(); } catch (_) {}
}

/** 当前时刻在马来西亚 (UTC+8)：返回的 Date 的 getUTCDate/getUTCMonth/getUTCFullYear 即为马来西亚的日/月/年 */
function getMalaysiaNow() {
    const now = new Date();
    return new Date(now.getTime() + (8 * 60 * 60 * 1000));
}

/** 上个月 1 号～上个月最后一天，按马来西亚 (UTC+8) 计算；用于 datepicker 默认与 API 传参（表里存 UTC+0，后端用 UTC+8 范围查） */
function getLastMonthRangeMY() {
    const myNow = getMalaysiaNow();
    const year = myNow.getUTCFullYear();
    const month = myNow.getUTCMonth(); // 0-indexed
    const lastYear = month === 0 ? year - 1 : year;
    const lastMonth = month === 0 ? 11 : month - 1;
    // 马来西亚该日 00:00 = UTC 前一日 16:00，用 Date.UTC - 8h 得到
    const firstDay = new Date(Date.UTC(lastYear, lastMonth, 1) - (8 * 60 * 60 * 1000));
    const lastDay = new Date(Date.UTC(lastYear, lastMonth + 1, 0) - (8 * 60 * 60 * 1000));
    return { firstDay, lastDay };
}
