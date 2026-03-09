/* =======================
   import — 门禁用 backend/access/manage，业务用 backend/saas/expenses.jsw (ECS Node)
   页面结构：#sectiondefault、#sectiontab（入口，始终 expand & show）。#sectiontab 内放 #buttonexpenses、#buttontopup 等。
   规则：无 credit 且进入 sectiontopup 时、或无 permission、或 client 无 permission 时，sectiontab 内按钮全部 disable。
======================= */
import wixLocation from 'wix-location';
import wixData from 'wix-data';
import { getAccessContext } from 'backend/access/manage';
import { getMyBillingInfo, startNormalTopup } from 'backend/saas/topup';
import { submitTicket } from 'backend/saas/help';
import {
    insertExpenses,
    deleteExpenses,
    updateExpense,
    bulkMarkPaid,
    getExpenses,
    getExpensesFilters,
    getExpensesIds,
    getExpensesSelectedTotal,
    getBulkTemplateFile,
    getBulkTemplateDownloadUrl,
    getBankBulkTransferData,
    getBankBulkTransferFiles,
    getBankBulkTransferDownloadUrls
} from 'backend/saas/expenses.jsw';
import wixWindow from 'wix-window';

/* =======================
   let
======================= */
let accessCtx = null;
/** true when client has "Bank Bulk Transfer" addon (plan.addons title matches). Used to disable #buttonbankfile when customer has no addon. */
let hasBankBulkTransferAddon = false;
let bankListLoaded = false;
let htmlUploadBound = false;
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
let expensesLoaded = false;
let expensesInputInited = false;
/** 当前「新增费用」repeater 行数据，用于增删行 */
let expensesInputRows = [];
/** 当前显示的页码（1-based），仅用于 #repeaterexpensesinput 与 #pagination1 的手动分页 */
let expensesInputCurrentPage = 1;
/** 供 repeater onItemReady 用的下拉选项（init 时拉取） */
let expensesInputPropertyOptions = [];
let expensesInputTypeOptions = [];
let menuVisible = false;
let bulkUploadRows = [];
let propertyMap = {};
let supplierMap = {};
let currentExpenseDetailId = null;
/** true = 从 #buttonbulkpaid 打开 #boxpayment，点 #buttonsubmitpayment 时做批量标记已付 */
let bulkPaymentMode = false;
let currentExpensePage = 1;
let selectedExpenseIds = new Set();
let currentFilteredExpenses = [];
let searchDebounceTimer = null;
let totalTextDebounceTimer = null;
let filterReloadDebounceTimer = null;

/** 前端缓存：当前日期范围内的全部 item（最多 2000）；若 total>2000 则走 server filter */
let expenseCache = [];
let expenseCacheTotal = 0;
let useServerFilter = false;
let cacheDateFrom = null;
let cacheDateTo = null;

const EXPENSE_PAGE_SIZE = 10;
const EXPENSE_INPUT_PAGE_SIZE = 10;
const EXPENSE_CACHE_LIMIT = 2000;
const FILTER_DEBOUNCE_MS = 280;

/** 规则：所有会发请求的按钮点击时 disable + label 改为 loadingLabel，完成后 enable + 恢复原 label */
function withButtonLoading(buttonId, loadingLabel, asyncFn) {
    return async () => {
        const btn = $w(buttonId);
        let originalLabel;
        try { originalLabel = btn.label; } catch (_) {}
        btn.disable();
        try { if (loadingLabel != null && btn.label !== undefined) btn.label = loadingLabel; } catch (_) {}
        try {
            await asyncFn();
        } finally {
            btn.enable();
            try { if (originalLabel !== undefined && btn.label !== undefined) btn.label = originalLabel; } catch (_) {}
        }
    };
}

function base64ToBlob(b64, mimeType) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mimeType || 'application/octet-stream' });
}

/** 仅在前端页面运行；Worker/后端无 document，勿放 .jsw */
function triggerDownload(blob, filename) {
    const g = typeof self !== 'undefined' ? self : null;
    const doc = g && g['document'];
    if (!doc) return;
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    a.click();
    URL.revokeObjectURL(url);
}

/* =======================
   const
======================= */
const MAIN_SECTIONS = ['topup', 'expenses', 'expensesinput', 'bulkupload', 'bank'];
const bulkColumns = [
    { id: 'property', dataPath: 'property', label: 'Property', type: 'string' },
    { id: 'supplier', dataPath: 'supplier', label: 'Supplier', type: 'string' },
    { id: 'description', dataPath: 'description', label: 'Description', type: 'string' },
    { id: 'amount', dataPath: 'amount', label: 'Amount', type: 'string' },
    { id: 'period', dataPath: 'period', label: 'Period', type: 'string' }
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
$w.onReady(async () => {
    if (wixWindow.formFactor === "Mobile") {
        runMobileBranch();
        return;
    }
    initDefaultSection();
    disableAllMainButtons();
    $w('#textstatusloading').hide();
    await startInitAsync();
    if (accessCtx && accessCtx.ok) {
        $w('#textstatusloading').hide();
    }
});

function disableAllMainButtons() {
    ['#buttonprofile', '#buttonusersetting', '#buttonintegration', '#buttontopup', '#buttonexpenses'].forEach(id => {
        const el = $w(id);
        el?.disable?.();
    });
}

/* =======================
   init flow
======================= */
async function startInitAsync() {
    accessCtx = await getAccessContext();
    if (!accessCtx.ok) {
        const msg = accessCtx.reason === 'NO_PERMISSION' ? "You don't have permission" : "You don't have account yet";
        showAccessDenied(msg);
        return;
    }
    if (!accessCtx.staff?.permission?.finance && !accessCtx.staff?.permission?.admin) {
        showAccessDenied("You don't have permission");
        return;
    }
    clientCurrency = String(accessCtx.client?.currency || 'MYR').toUpperCase();
    const addons = accessCtx.plan?.addons || [];
    hasBankBulkTransferAddon = addons.some(a => /bank\s*bulk\s*transfer/i.test(String(a.title || '')));
    if (accessCtx.credit?.ok === false) {
        await enterForcedTopupModeManage();
        return;
    }
    bindExpenseDelete();
    bindExpensesMenu();
    bindBulkActions();
    bindBulkUploadSection();
    bindExpensePayment();
    bindSectionSwitch();
    bindBulkUploadNow();
    bindTopupCloseButton();
    bindProblemBoxClose();
    bindExpenseDetailClose();
    await loadBulkUploadMaps();
    bindHtmlUploadListener();
    enableMainActions();
    $w('#tablebulkupload').collapse();
    $w('#textotalbulkupload').collapse();
    $w('#buttonbulkuploadnow').disable();
    $w('#textstatusloading').hide();
}

/* =======================
   Section Switch
======================= */
function bindSectionSwitch() {
    if (sectionSwitchBound) return;
    sectionSwitchBound = true;
    $w('#buttontopup').onClick(async () => {
        lastSectionBeforeTopup = activeSection || 'profile';
        if (!topupInited) {
            await initTopupSection();
            topupInited = true;
        }
        await switchSectionAsync('topup');
    });
    $w('#buttonexpenses').onClick(async () => {
        if (!expensesLoaded) {
            await initExpensesSection();
            expensesLoaded = true;
        }
        await switchSectionAsync('expenses');
    });
}

async function switchSectionAsync(sectionKey) {
    if (activeSection === sectionKey) return;
    collapseAllSections();
    if (!defaultSectionCollapsed) {
        $w('#sectiondefault').collapse();
        defaultSectionCollapsed = true;
    }
    $w(`#section${sectionKey}`).expand();
    activeSection = sectionKey;
    try { $w('#sectiontab').expand(); $w('#sectiontab').show(); } catch (_) {}
    if (sectionKey === 'expensesinput') {
        try { $w('#repeaterexpensesinput').expand(); } catch (_) {}
        if (!expensesInputInited) await initExpensesInputSection();
    }
}

function collapseAllSections() {
    MAIN_SECTIONS.forEach(k => {
        const id = `#section${k}`;
        if (!$w(id)) return;
        try {
            if ($w(id).collapse) $w(id).collapse();
            else $w(id).hide();
        } catch (err) {
            console.warn(`Cannot collapse ${id}`);
        }
    });
}

function initDefaultSection() {
    $w('#sectionheader').expand();
    try { $w('#sectiontab').expand(); $w('#sectiontab').show(); } catch (_) {}
    $w('#sectiondefault').expand();
    collapseAllSections();
}

function showSectionLoading(text) {
    $w('#text19').text = text || 'Loading...';
    $w('#text19').show();
}

function hideSectionLoading() {
    $w('#text19').hide();
}

function disableMainActions() {
    ['#buttonexpenses', '#buttontopup'].forEach(id => { $w(id)?.disable?.(); });
}

function enableMainActions() {
    ['#buttontopup', '#buttonexpenses'].forEach(id => { $w(id)?.enable?.(); });
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
    try { $w('#sectiontab').expand(); $w('#sectiontab').show(); } catch (_) {}
    disableMainActions(); // 无 credit 时 sectiontab 内按钮全部 disable
}

/* =======================
   Topup Section
======================= */
async function initTopupSection() {
    const billing = await getMyBillingInfo();
    const credits = Array.isArray(billing.credit) ? billing.credit : [];
    const totalCredit = credits.reduce((s, c) => s + Number(c.amount || 0), 0);
    $w('#textcurrentcredit').text = `Current Credit Balance: ${totalCredit}`;
    const res = await wixData.query('creditplan').ascending('credit').find();
    $w('#repeatertopup').data = res.items;
    if (!topupRepeaterBound) {
        $w('#repeatertopup').onItemReady(($item, plan) => {
            $item('#textamount').text = `${clientCurrency} ${plan.sellingprice}`;
            $item('#textcreditamount').text = String(plan.credit);
            $item('#boxcolor').hide();
            $item('#containertopup').onClick(() => {
                selectedTopupPlanId = plan._id;
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
                    console.warn('[expenses] submitTicket topup_manual failed', e);
                }
                return;
            }
            const res = await startNormalTopup({ creditPlanId: selectedTopupPlanId, redirectUrl: wixLocation.url });
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
    let text = `Your top up amount is more than ${clientCurrency} 1000\nThe top up amount: ${clientCurrency} ${amount}\n\nPlease transfer to:\n`;
    if (clientCurrency === 'SGD') {
        text += 'Public Bank (Singapore)\nPlease contact customer service for account details\n';
    } else {
        text += 'Public Bank Account\nColiving Management Sdn Bhd\n3240130500\n';
    }
    text += '\nPlease drop your receipt to our customer services:\n📞 6019-857 9627';
    $w('#textproblem').text = text.trim();
}

function bindProblemBoxClose() {
    $w('#buttoncloseproblem2').onClick(() => $w('#boxproblem2').hide());
}

/* =====================================================
   EXPENSES SECTION
===================================================== */

/** 默认日期：上个月 1 号～上个月最后一天 */
function getDefaultDateRange() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: first, to: last };
}

async function initExpensesSection() {
    showSectionLoading('Loading Expenses...');
    bindExpensesRepeater();
    bindSelectAllCheckbox();
    bindExpensesPagination();
    const defaultRange = getDefaultDateRange();
    $w('#datepicker1').value = defaultRange.from;
    $w('#datepicker2').value = defaultRange.to;
    await setupExpensesFilters();
    bindExpensesFilterEvents();
    await fetchAndFillCache(defaultRange.from, defaultRange.to);
    applyFilterAndSort();
    hideSectionLoading();
}

async function setupExpensesFilters() {
    const res = await getExpensesFilters();
    const properties = res.properties || [];
    const types = res.types || [];
    $w('#dropdownproperty').options = [
        { label: 'All Property', value: 'ALL' },
        ...properties.map(p => ({ label: p.label || p.value, value: p.value }))
    ];
    $w('#dropdowntype').options = [
        { label: 'All Type', value: 'ALL' },
        ...types.map(t => ({ label: t.label || t.value, value: t.value }))
    ];
    $w('#dropdownsort').options = [
        { label: 'New to Old', value: 'new' },
        { label: 'Old to New', value: 'old' },
        { label: 'A > Z', value: 'az' },
        { label: 'Z > A', value: 'za' },
        { label: 'Amount Big to Small', value: 'amountdesc' },
        { label: 'Amount Small to Big', value: 'amountasc' },
        { label: 'Paid', value: 'paid' },
        { label: 'Unpaid', value: 'unpaid' }
    ];
}

function getCurrentFilterOpts() {
    return {
        property: $w('#dropdownproperty').value || 'ALL',
        type: $w('#dropdowntype').value || 'ALL',
        from: $w('#datepicker1').value || null,
        to: $w('#datepicker2').value || null,
        search: ($w('#inputsearch').value || '').trim(),
        sort: $w('#dropdownsort').value || 'new'
    };
}

/** 日期变更 → 从 server 拉新数据并更新 cache，并回到第一页 */
async function onDateRangeChange() {
    resetToFirstPage();
    const from = $w('#datepicker1').value;
    const to = $w('#datepicker2').value;
    $w('#repeaterexpenses').data = [];
    showSectionLoading('Loading...');
    await fetchAndFillCache(from, to);
    applyFilterAndSort();
    hideSectionLoading();
}

/** 访客在 UTC+8 选日期，DB 存 UTC+0；选 5 Jan 表示 5 Jan 00:00～23:59 +8，对应 UTC 可能是 4 Jan 16:00～5 Jan 15:59。把「选中的日期」转成该日在 +8 的起止时刻的 UTC ISO 给 API。 */
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

function toApiDateUtc(d, endOfDay) {
    if (d == null) return undefined;
    const date = d instanceof Date ? d : new Date(d);
    const y = date.getFullYear();
    const m = date.getMonth();
    const day = date.getDate();
    const utcMs = endOfDay
        ? Date.UTC(y, m, day, 23, 59, 59, 999) - TZ_OFFSET_MS
        : Date.UTC(y, m, day, 0, 0, 0, 0) - TZ_OFFSET_MS;
    return new Date(utcMs).toISOString();
}

/** 只根据 datepicker1 & datepicker2 去 MySQL 拿该日期范围内全部 item；不传 page/pageSize，只传 from/to/sort/limit */
async function fetchAndFillCache(from, to) {
    cacheDateFrom = from;
    cacheDateTo = to;
    const fromVal = toApiDateUtc(from, false);
    const toVal = toApiDateUtc(to, true);
    const res = await getExpenses({
        from: fromVal,
        to: toVal,
        sort: $w('#dropdownsort').value || 'new',
        limit: EXPENSE_CACHE_LIMIT
    });
    const total = res.total || 0;
    const items = res.items || [];
    if (total <= EXPENSE_CACHE_LIMIT) {
        expenseCache = items;
        expenseCacheTotal = total;
        useServerFilter = false;
    } else {
        expenseCache = [];
        expenseCacheTotal = total;
        useServerFilter = true;
    }
}

/** 写入后失效 cache 并重新拉取（第二轮检查，避免 DB 被改后前端还显示旧数据） */
function invalidateExpenseCache() {
    expenseCache = [];
    expenseCacheTotal = 0;
    cacheDateFrom = null;
    cacheDateTo = null;
}

/** 写入操作后统一调用：失效 cache → 按当前日期范围重新拉取 → applyFilterAndSort 会更新 #repeaterexpenses.data，列表即是最新 */
async function refetchAfterWrite() {
    const from = $w('#datepicker1').value;
    const to = $w('#datepicker2').value;
    invalidateExpenseCache();
    showSectionLoading('Loading...');
    await fetchAndFillCache(from, to);
    applyFilterAndSort();
    hideSectionLoading();
}

/** 任一筛选变更时先回到第一页，并让 #paginationexpenses 显示第 1 页 */
function resetToFirstPage() {
    currentExpensePage = 1;
    try {
        $w('#paginationexpenses').currentPage = 1;
    } catch (_) {}
}

function bindExpensesFilterEvents() {
    $w('#datepicker1').onChange(() => onDateRangeChange());
    $w('#datepicker2').onChange(() => onDateRangeChange());
    $w('#dropdownproperty').onChange(() => {
        resetToFirstPage();
        applyFilterAndSort();
    });
    $w('#dropdowntype').onChange(() => {
        resetToFirstPage();
        applyFilterAndSort();
    });
    $w('#dropdownsort').onChange(() => {
        resetToFirstPage();
        applyFilterAndSort();
    });
    $w('#inputsearch').onInput(() => {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            searchDebounceTimer = null;
            resetToFirstPage();
            applyFilterAndSort();
        }, 300);
    });
}

/** 前端排序（与 backend orderClause 一致） */
function sortExpenses(items, sortKey) {
    const key = (sortKey || 'new').toLowerCase();
    const arr = [...items];
    const cmp = (a, b) => {
        const ap = a.period ? new Date(a.period).getTime() : 0;
        const bp = b.period ? new Date(b.period).getTime() : 0;
        if (ap !== bp) return key === 'old' ? ap - bp : bp - ap;
        return 0;
    };
    if (key === 'old') return arr.sort((a, b) => cmp(a, b));
    if (key === 'new') return arr.sort((a, b) => cmp(a, b));
    if (key === 'az') return arr.sort((a, b) => (a.description || '').localeCompare(b.description || ''));
    if (key === 'za') return arr.sort((a, b) => (b.description || '').localeCompare(a.description || ''));
    if (key === 'amountasc') return arr.sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));
    if (key === 'amountdesc') return arr.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
    if (key === 'paid') return arr.sort((a, b) => (b.paid ? 1 : 0) - (a.paid ? 1 : 0) || cmp(a, b));
    if (key === 'unpaid') return arr.sort((a, b) => (a.paid ? 1 : 0) - (b.paid ? 1 : 0) || cmp(a, b));
    return arr;
}

/** 根据 useServerFilter 走前端过滤或 server 分页 */
function applyFilterAndSort() {
    if (useServerFilter) {
        loadExpensesPageFromServer(currentExpensePage);
        return;
    }
    applyFilterAndSortToCache();
}

/** 当前筛选条件下的全部 id（用于全选，不请求 ECS） */
function getFilteredCacheIds() {
    const opts = getCurrentFilterOpts();
    let list = expenseCache;
    if (opts.property && opts.property !== 'ALL') list = list.filter(i => (i.propertyId || i.property?._id) === opts.property);
    if (opts.type && opts.type !== 'ALL') list = list.filter(i => (i.typeWixId || i.billType?._id) === opts.type);
    if (opts.search) {
        const s = opts.search.toLowerCase();
        list = list.filter(i => (i.description || '').toLowerCase().includes(s) || (i.listingtitle || '').toLowerCase().includes(s));
    }
    return list.map(i => String(i._id || i.id)).filter(Boolean);
}

/** 前端：对 cache 过滤 + 排序 + 分页，#repeaterexpenses 只放当前页 10 条，用 #paginationexpenses 分页 */
function applyFilterAndSortToCache() {
    const opts = getCurrentFilterOpts();
    let list = expenseCache;
    if (opts.property && opts.property !== 'ALL') {
        list = list.filter(i => (i.propertyId || i.property?._id) === opts.property);
    }
    if (opts.type && opts.type !== 'ALL') {
        list = list.filter(i => (i.typeWixId || i.billType?._id) === opts.type);
    }
    if (opts.search) {
        const s = opts.search.toLowerCase();
        list = list.filter(i => (i.description || '').toLowerCase().includes(s) || (i.listingtitle || '').toLowerCase().includes(s));
    }
    list = sortExpenses(list, opts.sort);
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / EXPENSE_PAGE_SIZE));
    const start = (currentExpensePage - 1) * EXPENSE_PAGE_SIZE;
    currentFilteredExpenses = list.slice(start, start + EXPENSE_PAGE_SIZE);
    $w('#paginationexpenses').totalPages = totalPages;
    $w('#paginationexpenses').currentPage = currentExpensePage;
    $w('#repeaterexpenses').data = currentFilteredExpenses;
    updateSelectAllCheckbox();
    scheduleUpdateTotalText();
}

/** Server 分页：直接请求当前页 */
async function loadExpensesPageFromServer(pageNumber) {
    currentExpensePage = pageNumber;
    const opts = getCurrentFilterOpts();
    $w('#repeaterexpenses').data = [];
    showSectionLoading('Loading...');
    const res = await getExpenses({
        property: opts.property,
        type: opts.type,
        from: opts.from,
        to: opts.to,
        search: opts.search,
        sort: opts.sort,
        page: currentExpensePage,
        pageSize: EXPENSE_PAGE_SIZE
    });
    currentFilteredExpenses = res.items || [];
    $w('#paginationexpenses').totalPages = res.totalPages || 1;
    $w('#paginationexpenses').currentPage = res.currentPage || 1;
    $w('#repeaterexpenses').data = currentFilteredExpenses;
    hideSectionLoading();
    updateSelectAllCheckbox();
    scheduleUpdateTotalText();
}

function bindExpensesPagination() {
    $w('#paginationexpenses').onChange(async (event) => {
        currentExpensePage = event.target.currentPage;
        if (useServerFilter) await loadExpensesPageFromServer(currentExpensePage);
        else applyFilterAndSortToCache();
    });
}

function bindExpensesRepeater() {
    $w('#repeaterexpenses').onItemReady(($item, item) => {
        const id = String(item._id || item.id || '');
        $item('#texttitleexpenses').text = `Description: ${item.description || ''}`;
        $item('#texttype').text = item.billType?.title || '';
        $item('#textpropertyname').text = item.property?.shortname || '';
        $item('#textdate').text = formatDate(item.period);
        $item('#textrepeateramount').text = `${clientCurrency} ${Number(item.amount || 0).toFixed(2)}`;
        if (item.bukkuurl) {
            $item('#boxexpensescolor').style.backgroundColor = '#dff5f2';
        } else {
            $item('#boxexpensescolor').style.backgroundColor = '#fde2e2';
        }
        $item('#checkboxexpenses').checked = selectedExpenseIds.has(id);
        $item('#checkboxexpenses').onChange((e) => {
            if (e.target.checked) selectedExpenseIds.add(id);
            else selectedExpenseIds.delete(id);
            updateSelectAllCheckbox();
            scheduleUpdateTotalText();
        });
        $item('#buttonexpensesdetail').onClick(() => openExpenseDetail(item));
    });
}

/* #boxdetail：点击某条费用的详情时显示，内含说明 + #boxpayment（标记已付）；#buttonclosedetail 关闭，#buttondeleteexpenses 删除并关闭 */
function openExpenseDetail(item) {
    currentExpenseDetailId = item._id;
    $w('#textdetailexpenses').text = `Title: ${item.description || ''}\nType: ${item.billType?.title || ''}\nDate: ${formatDate(item.period)}\nAmount: ${clientCurrency} ${Number(item.amount || 0).toFixed(2)}\nDescription: ${item.description || ''}\nProperty: ${item.property?.shortname || ''}`;
    if (item.bukkuurl) {
        $w('#buttonexpensesurl').expand();
        $w('#buttonexpensesurl').onClick(() => wixLocation.to(item.bukkuurl));
    } else {
        $w('#buttonexpensesurl').collapse();
    }
    $w('#boxdetail').show();
}

function bindAddExpenseButtons() {
    const goToInput = async () => {
        await switchSectionAsync('expensesinput');
        try { $w('#repeaterexpensesinput').expand(); } catch (_) {}
        if (!expensesInputInited) await initExpensesInputSection();
        addExpensesInputRow();
        updateExpensesInputPagination();
    };
    try {
        $w('#buttoncreatenewexpenses').onClick(async () => {
            const btn = $w('#buttoncreatenewexpenses');
            const originalLabel = btn.label || 'Create New';
            btn.disable();
            btn.label = 'Loading...';
            try {
                if (!expensesInputInited) await initExpensesInputSection();
                await switchSectionAsync('expensesinput');
                try { $w('#repeaterexpensesinput').expand(); } catch (_) {}
                addExpensesInputRow();
                updateExpensesInputPagination();
            } finally {
                btn.enable();
                btn.label = originalLabel;
            }
        });
    } catch (_) {}
    try { $w('#buttonaddexpenses').onClick(goToInput); } catch (_) {}
}

/** 在「新增费用」repeater 里加一行（每次点 #buttonaddexpenses 加一条） */
function addExpensesInputRow() {
    if (!expensesInputInited) return;
    expensesInputRows.push({ _id: 'new-' + Date.now() });
    updateExpensesInputPagination();
}

/** 从「新增费用」repeater 里删一行（每行 #buttondeleteexpensesinput） */
function removeExpensesInputRow(itemId) {
    expensesInputRows = expensesInputRows.filter(r => String(r._id) !== String(itemId));
    updateExpensesInputPagination();
}

/** #pagination1：仅当 >10 条时显示；Repeater 无 pageSize/currentPage，用切片赋 data */
function updateExpensesInputPagination() {
    const total = expensesInputRows.length;
    const pagination = $w('#pagination1');
    const repeater = $w('#repeaterexpensesinput');
    if (total <= EXPENSE_INPUT_PAGE_SIZE) {
        try { pagination.hide(); } catch (_) {}
        expensesInputCurrentPage = 1;
        repeater.data = [...expensesInputRows];
        return;
    }
    const totalPages = Math.ceil(total / EXPENSE_INPUT_PAGE_SIZE);
    pagination.totalPages = totalPages;
    if (expensesInputCurrentPage > totalPages) expensesInputCurrentPage = totalPages;
    pagination.currentPage = expensesInputCurrentPage;
    const start = (expensesInputCurrentPage - 1) * EXPENSE_INPUT_PAGE_SIZE;
    repeater.data = expensesInputRows.slice(start, start + EXPENSE_INPUT_PAGE_SIZE);
    try { pagination.show(); } catch (_) {}
}

/** 初始化 #sectionexpensesinput：拉取 property/type 选项、至少一行 repeater、绑定保存/关闭/删除 */
async function initExpensesInputSection() {
    if (expensesInputInited) return;
    const res = await getExpensesFilters();
    const properties = res.properties || [];
    const types = res.types || [];
    const suppliers = res.suppliers || [];
    expensesInputPropertyOptions = properties.map(p => ({ label: p.label || p.value, value: p.value }));
    expensesInputTypeOptions = (types && types.length > 0)
        ? types.map(t => ({ label: t.label || t.value, value: t.value }))
        : (suppliers || []).map(s => ({ label: s.title || s.id, value: s.id || s.wix_id }));
    const repeater = $w('#repeaterexpensesinput');
    repeater.onItemReady(($item, itemData) => {
        $item('#dropdownpropertyexpensesinput').options = expensesInputPropertyOptions;
        $item('#dropdowntypeexpensesinput').options = expensesInputTypeOptions;
        const dp = $item('#datepickerexpenesesinput');
        if (dp && !dp.value) dp.value = new Date();
        /* 从 itemData 回填（分页切换时保留已填内容）；itemData 与 expensesInputRows 中同 _id 为同一引用 */
        const row = expensesInputRows.find(r => String(r._id) === String(itemData._id));
        if (row) {
            if (row.period != null && dp) dp.value = row.period;
            if (row.property != null) $item('#dropdownpropertyexpensesinput').value = row.property;
            if (row.billType != null) $item('#dropdowntypeexpensesinput').value = row.billType;
            if (row.description != null) $item('#inputdescriptionexpensesinput').value = row.description;
            if (row.amount != null) $item('#inputamountexpensesinput').value = String(row.amount);
        }
        /* 编辑时写回 expensesInputRows，保存时用完整列表 */
        function syncRow() {
            const r = expensesInputRows.find(x => String(x._id) === String(itemData._id));
            if (!r) return;
            r.period = $item('#datepickerexpenesesinput').value;
            r.property = $item('#dropdownpropertyexpensesinput').value;
            r.billType = $item('#dropdowntypeexpensesinput').value;
            r.description = $item('#inputdescriptionexpensesinput').value;
            r.amount = Number($item('#inputamountexpensesinput').value) || 0;
        }
        try { $item('#dropdownpropertyexpensesinput').onChange(syncRow); } catch (_) {}
        try { $item('#dropdowntypeexpensesinput').onChange(syncRow); } catch (_) {}
        try { if (dp) dp.onChange(syncRow); } catch (_) {}
        try { $item('#inputamountexpensesinput').onInput(syncRow); } catch (_) {}
        try { $item('#inputdescriptionexpensesinput').onInput(syncRow); } catch (_) {}
        try {
            $item('#buttondeleteexpensesinput').onClick(() => removeExpensesInputRow(itemData._id));
        } catch (_) {}
    });
    expensesInputRows = [];
    expensesInputCurrentPage = 1;
    repeater.data = [];
    try { $w('#pagination1').hide(); } catch (_) {}
    $w('#pagination1').onChange((event) => {
        const page = event.target.currentPage || 1;
        expensesInputCurrentPage = page;
        const start = (page - 1) * EXPENSE_INPUT_PAGE_SIZE;
        $w('#repeaterexpensesinput').data = expensesInputRows.slice(start, start + EXPENSE_INPUT_PAGE_SIZE);
    });
    $w('#buttoncloseexpensesinput').onClick(async () => { await switchSectionAsync('expenses'); });
    $w('#buttonsaveexpensesinput').onClick(withButtonLoading('#buttonsaveexpensesinput', 'Loading...', async () => {
        /* 先同步当前页表单到 expensesInputRows（onInput 可能未触发最后字符） */
        $w('#repeaterexpensesinput').forEachItem(($item, itemData) => {
            const r = expensesInputRows.find(x => String(x._id) === String(itemData._id));
            if (!r) return;
            r.period = $item('#datepickerexpenesesinput').value;
            r.property = $item('#dropdownpropertyexpensesinput').value;
            r.billType = $item('#dropdowntypeexpensesinput').value;
            r.description = $item('#inputdescriptionexpensesinput').value;
            r.amount = Number($item('#inputamountexpensesinput').value) || 0;
        });
        const records = expensesInputRows
            .map(r => ({ period: r.period || new Date(), property: r.property, billType: r.billType, description: r.description || '', amount: r.amount || 0 }))
            .filter(r => r.amount || (r.description && r.description.trim()));
        if (records.length === 0) return;
        await insertExpenses(records);
        await switchSectionAsync('expenses');
        await refetchAfterWrite();
    }));
    expensesInputInited = true;
}

bindAddExpenseButtons();

function formatDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-GB');
}

/* #checkboxall: 全选/取消。取消时 selectedExpenseIds.clear() → 清空全部选中（跨 filter 也清掉），不做「只取消当前 filter」逻辑。 */
function bindSelectAllCheckbox() {
    $w('#checkboxall').onChange(async (e) => {
        const checked = e.target.checked;

        if (checked) {
            currentFilteredExpenses.forEach((item) => {
                const id = item._id || item.id;
                if (id != null) selectedExpenseIds.add(String(id));
            });
            $w('#repeaterexpenses').forEachItem(($item) => { $item('#checkboxexpenses').checked = true; });
            updateSelectAllCheckbox();
            scheduleUpdateTotalText();

            if (useServerFilter) {
                try {
                    const res = await getExpensesIds(getCurrentFilterOpts());
                    (res.ids || []).forEach((id) => selectedExpenseIds.add(String(id)));
                    refreshRepeaterCheckbox();
                    updateSelectAllCheckbox();
                    await updateTotalText();
                } catch (err) { console.warn('getExpensesIds failed', err); }
            } else {
                getFilteredCacheIds().forEach((id) => selectedExpenseIds.add(id));
                refreshRepeaterCheckbox();
                updateSelectAllCheckbox();
                await updateTotalText();
            }
        } else {
            /* 取消全选 = 直接清空全部选中（跨 filter 也清掉） */
            selectedExpenseIds.clear();
            $w('#repeaterexpenses').forEachItem(($item) => { $item('#checkboxexpenses').checked = false; });
            $w('#checkboxall').checked = false;
            await updateTotalText();
        }
    });
}

function refreshRepeaterCheckbox() {
    $w('#repeaterexpenses').forEachItem(($item, item) => {
        const id = item._id || item.id;
        $item('#checkboxexpenses').checked = id != null && selectedExpenseIds.has(String(id));
    });
}

function updateSelectAllCheckbox() {
    const total = currentFilteredExpenses.length;
    if (!total) {
        $w('#checkboxall').checked = false;
        return;
    }
    const selectedCount = currentFilteredExpenses.filter(i => selectedExpenseIds.has(String(i._id || i.id))).length;
    $w('#checkboxall').checked = selectedCount === total;
}

/** 防抖：多次勾选只触发一次 total 更新 */
function scheduleUpdateTotalText() {
    if (totalTextDebounceTimer) clearTimeout(totalTextDebounceTimer);
    totalTextDebounceTimer = setTimeout(() => {
        totalTextDebounceTimer = null;
        updateTotalText();
    }, 150);
}

/** 优先用当前页数据前端算合计（无请求）；跨页或全选才打 ECS /selected-total */
async function updateTotalText() {
    if (!selectedExpenseIds.size) {
        $w('#texttotal').hide();
        updateBulkButtonState();
        return;
    }
    const ids = Array.from(selectedExpenseIds);
    const inMemory = currentFilteredExpenses.filter(i => selectedExpenseIds.has(String(i._id || i.id)));
    const canComputeLocal = ids.length === inMemory.length;
    let count, totalAmount;
    if (canComputeLocal) {
        count = inMemory.length;
        totalAmount = inMemory.reduce((s, i) => s + Number(i.amount || 0), 0);
    } else {
        const res = await getExpensesSelectedTotal(ids);
        count = res.count || 0;
        totalAmount = res.totalAmount || 0;
    }
    $w('#texttotal').text = `Selected: ${count} | Total Amount: ${clientCurrency} ${totalAmount.toFixed(2)}`;
    $w('#texttotal').show();
    updateBulkButtonState();
}

/* #boxpayment：在 #boxdetail 内。#buttonpay 打开 #boxpayment（单条）；#buttonbulkpaid 也打开 #boxpayment，选方式+日期后 #buttonsubmitpayment 才批量写入 */
function bindExpensePayment() {
    try {
        $w('#buttonpay').onClick(() => {
            bulkPaymentMode = false;
            $w('#boxpayment').show();
            try { $w('#boxpayment').expand(); } catch (_) {}
        });
    } catch (_) {}
    $w('#buttonsubmitpayment').onClick(withButtonLoading('#buttonsubmitpayment', 'Loading...', async () => {
        const method = $w('#dropdownpaymentmethod').value;
        const paidDate = $w('#datepickerpayment').value || new Date();
        if (bulkPaymentMode) {
            const ids = Array.from(selectedExpenseIds);
            if (!ids.length) {
                $w('#boxpayment').hide();
                bulkPaymentMode = false;
                return;
            }
            await bulkMarkPaid(ids, paidDate, method);
            selectedExpenseIds.clear();
            refreshRepeaterCheckbox();
            updateSelectAllCheckbox();
        } else {
            if (!currentExpenseDetailId) return;
            await updateExpense(currentExpenseDetailId, { paid: true, paidat: paidDate, paymentmethod: method });
        }
        $w('#boxpayment').hide();
        if (!bulkPaymentMode) $w('#boxdetail').hide();
        bulkPaymentMode = false;
        await refetchAfterWrite();
    }));
}

function bindExpenseDetailClose() {
    $w('#buttonclosedetail').onClick(() => {
        currentExpenseDetailId = null;
        bulkPaymentMode = false;
        $w('#boxdetail').hide();
    });
}

const CONFIRM_DELETE_LABEL = 'Confirm delete';
let originalLabelSingleDelete = 'Delete';
let originalLabelBulkDelete = 'Bulk Delete';

function bindExpenseDelete() {
    $w('#buttondeleteexpenses').onClick(async () => {
        const btn = $w('#buttondeleteexpenses');
        if (btn.label === CONFIRM_DELETE_LABEL) {
            if (!currentExpenseDetailId) return;
            btn.disable();
            btn.label = 'Loading...';
            try {
                await deleteExpenses([currentExpenseDetailId]);
                console.log('[expenses] single delete confirmed, id:', currentExpenseDetailId);
                currentExpenseDetailId = null;
                $w('#boxdetail').hide();
                await refetchAfterWrite();
            } finally {
                btn.enable();
                btn.label = originalLabelSingleDelete;
            }
            return;
        }
        originalLabelSingleDelete = btn.label || originalLabelSingleDelete;
        btn.label = CONFIRM_DELETE_LABEL;
    });
}

function bindExpensesMenu() {
    const isDesktop = wixWindow.formFactor === 'Desktop';
    $w('#boxmenu').hide();
    if (isDesktop) {
        $w('#menugroup').onMouseIn(() => {
            updateBulkButtonState();
            $w('#boxmenu').show();
            $w('#boxmenu').expand();
        });
        $w('#menugroup').onMouseOut(() => {
            $w('#boxmenu').hide();
            $w('#boxmenu').collapse();
        });
    } else {
        $w('#buttonmenu').onClick(() => {
            const isHidden = !$w('#boxmenu').isVisible;
            if (isHidden) {
                updateBulkButtonState();
                $w('#boxmenu').show();
                $w('#boxmenu').expand();
            } else {
                $w('#boxmenu').hide();
                $w('#boxmenu').collapse();
            }
        });
    }
}

function updateBulkButtonState() {
    const hasSelection = selectedExpenseIds.size > 0;
    if (hasSelection) {
        if (hasBankBulkTransferAddon) $w('#buttonbankfile').enable();
        else $w('#buttonbankfile').disable();
        $w('#buttonbulkpaid').enable();
        $w('#buttonbulkdelete').enable();
    } else {
        $w('#buttonbankfile').disable();
        $w('#buttonbulkpaid').disable();
        $w('#buttonbulkdelete').disable();
    }
}

function bindBulkActions() {
    $w('#buttonbulkupload').onClick(withButtonLoading('#buttonbulkupload', 'Loading...', async () => {
        $w('#boxmenu').hide();
        await switchSectionAsync('bulkupload');
    }));
    $w('#buttonbankfile').onClick(withButtonLoading('#buttonbankfile', 'Loading...', async () => {
        if (!selectedExpenseIds.size) return;
        $w('#boxmenu').hide();
        if (!bankListLoaded) {
            await initBankSection();
            bankListLoaded = true;
        }
        await switchSectionAsync('bank');
    }));
    $w('#buttonbulkpaid').onClick(() => {
        if (!selectedExpenseIds.size) return;
        bulkPaymentMode = true;
        $w('#boxpayment').show();
        try { $w('#boxpayment').expand(); } catch (_) {}
        $w('#boxmenu').hide();
    });
    $w('#buttonbulkdelete').onClick(async () => {
        const btn = $w('#buttonbulkdelete');
        if (btn.label === CONFIRM_DELETE_LABEL) {
            const ids = Array.from(selectedExpenseIds);
            if (!ids.length) return;
            btn.disable();
            btn.label = 'Loading...';
            try {
                await deleteExpenses(ids);
                console.log('[expenses] bulk delete confirmed, ids:', ids);
                selectedExpenseIds.clear();
                await refetchAfterWrite();
                refreshRepeaterCheckbox();
                updateSelectAllCheckbox();
                $w('#boxmenu').hide();
            } finally {
                btn.enable();
                btn.label = originalLabelBulkDelete;
            }
            return;
        }
        originalLabelBulkDelete = btn.label || originalLabelBulkDelete;
        btn.label = CONFIRM_DELETE_LABEL;
    });
}

function bindBulkUploadSection() {
    $w('#buttonclosebulkupload').onClick(async () => { await switchSectionAsync('expenses'); });

    $w('#buttondownloadtemplate').onClick(withButtonLoading('#buttondownloadtemplate', 'Loading...', async () => {
        try {
            const res = await getBulkTemplateDownloadUrl();
            if (res?.downloadUrl) {
                wixLocation.to(res.downloadUrl);
            } else {
                const fallback = await getBulkTemplateFile();
                if (fallback?.filename && fallback?.data) {
                    const blob = base64ToBlob(fallback.data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                    triggerDownload(blob, fallback.filename);
                }
            }
        } catch (err) {
            console.error('Template download error:', err);
        }
    }));
}

/* #htmlupload：访客上传文件 → 解析后 postMessage BULK_PREVIEW → 本页展示在 #tablebulkupload → 点击 #buttonbulkuploadnow 调用 insertExpenses 写入 table（不用 CMS）。iframe 内容见 docs/wix/frontend/bulk-upload-iframe.html */
function bindHtmlUploadListener() {
    if (htmlUploadBound) return;
    htmlUploadBound = true;
    $w('#htmlupload').onMessage((event) => {
        if (event.data?.type !== 'BULK_PREVIEW') return;
        const newRows = event.data.rows || [];
        let errorMessages = [];
        let validRows = [];
        newRows.forEach((r, index) => {
            const rowNumber = index + 2;
            if (!r.property) { errorMessages.push(`Row ${rowNumber}: Property missing`); return; }
            if (!r.amount || Number(r.amount) <= 0) { errorMessages.push(`Row ${rowNumber}: Invalid amount`); return; }
            const propertyId = propertyMap[r.property];
            const supplierId = supplierMap[r.supplier];
            if (!propertyId) { errorMessages.push(`Row ${rowNumber}: Property not found`); return; }
            if (!supplierId) { errorMessages.push(`Row ${rowNumber}: Supplier not found`); return; }
            validRows.push({ propertyName: r.property, supplierName: r.supplier, description: r.description, amount: r.amount, period: r.period, propertyId, supplierId });
        });
        bulkUploadRows = [...bulkUploadRows, ...validRows];
        refreshBulkTable();
        if (errorMessages.length) {
            $w('#textotalbulkupload').text = '⚠️ Errors:\n' + errorMessages.join('\n');
            $w('#textotalbulkupload').style.color = 'red';
        }
    });
}

async function loadBulkUploadMaps() {
    const res = await getExpensesFilters();
    const properties = res.properties || [];
    const suppliers = res.suppliers || [];
    propertyMap = {};
    supplierMap = {};
    properties.forEach(p => { propertyMap[p.label] = p.value; });
    suppliers.forEach(s => { supplierMap[s.title] = s.id; });
}

function refreshBulkTable() {
    if (!bulkUploadRows.length) {
        $w('#tablebulkupload').collapse();
        $w('#textotalbulkupload').collapse();
        updateBulkUploadButtonState();
        return;
    }
    const formattedRows = bulkUploadRows.map(r => ({
        property: r.propertyName,
        supplier: r.supplierName,
        description: r.description,
        amount: `${clientCurrency} ${Number(r.amount).toFixed(2)}`,
        period: formatDate(r.period)
    }));
    $w('#tablebulkupload').columns = bulkColumns;
    $w('#tablebulkupload').rows = formattedRows;
    $w('#tablebulkupload').expand();
    const total = bulkUploadRows.reduce((s, r) => s + Number(r.amount || 0), 0);
    $w('#textotalbulkupload').text = `Total Items: ${bulkUploadRows.length} | Total Amount: ${clientCurrency} ${total.toFixed(2)}`;
    $w('#textotalbulkupload').style.color = 'black';
    $w('#textotalbulkupload').expand();
    updateBulkUploadButtonState();
}

function bindBulkUploadNow() {
    $w('#buttonbulkuploadnow').onClick(withButtonLoading('#buttonbulkuploadnow', 'Loading...', async () => {
        if (!bulkUploadRows.length) {
            $w('#textotalbulkupload').text = 'No valid items to upload';
            return;
        }
        if (bulkUploadRows.length > 500) {
            $w('#textotalbulkupload').text = '⚠️ Maximum 500 items per upload';
            $w('#textotalbulkupload').style.color = 'red';
            return;
        }
        try {
            const records = bulkUploadRows.map(r => ({
                property: r.propertyId,
                billType: r.supplierId,
                description: r.description,
                amount: Number(r.amount),
                period: new Date(r.period)
            }));
            await insertExpenses(records);
            bulkUploadRows = [];
            refreshBulkTable();
            $w('#textotalbulkupload').text = '✅ Bulk Upload Successful';
            $w('#textotalbulkupload').style.color = 'green';
            $w('#textotalbulkupload').expand();
            await switchSectionAsync('expenses');
            await refetchAfterWrite();
        } catch (err) {
            console.error('Bulk Insert Failed:', err);
            $w('#textotalbulkupload').text = '❌ Upload failed. Please try again.';
            $w('#textotalbulkupload').style.color = 'red';
        }
    }));
}

function updateBulkUploadButtonState() {
    if (bulkUploadRows.length > 0) $w('#buttonbulkuploadnow').enable();
    else $w('#buttonbulkuploadnow').disable();
}

async function initBankSection() {
    const res = await getBankBulkTransferData();
    if (!res?.banks?.length) return;
    $w('#dropdownbank').options = res.banks.map(b => ({ label: b.label, value: b.value }));
    $w('#dropdownbank').value = res.banks[0].value;
    bindBankDownload();
    $w('#buttonclosebank').onClick(async () => { await switchSectionAsync('expenses'); });
}

/** 银行文件下载：全部走 Node 的 download URL，wixLocation.to(url)。后端支持一次最多 500 条，超过 99 条时自动拆成 JP01/JP02…、PM01/PM02… 打成一个 zip。 */
function bindBankDownload() {
    $w('#buttondownloadfile').onClick(withButtonLoading('#buttondownloadfile', 'Loading...', async () => {
        const selectedBank = $w('#dropdownbank').value;
        const allIds = Array.from(selectedExpenseIds);
        if (!allIds.length) return;
        try {
            const urlRes = await getBankBulkTransferDownloadUrls({ bank: selectedBank, type: 'supplier', ids: allIds });
            if (urlRes?.urls?.length >= 1) {
                wixLocation.to(urlRes.urls[0].url);
            } else {
                console.warn('No download URL returned (e.g. all items skipped or no data). Check errors.txt in zip if applicable.');
            }
        } catch (err) {
            console.error('Bank File Error:', err);
        }
    }));
}
