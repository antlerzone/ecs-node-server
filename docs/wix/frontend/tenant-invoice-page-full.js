/* =======================
   Tenant Invoice Page – 迁移版
   数据全部通过 backend/saas/tenantinvoice.jsw + backend/billing 请求 ECS Node，不读 Wix CMS。
   页面结构：#sectiondefault、#sectiontab（入口，始终 expand & show）。#sectiontab 内放 #buttonmeterinvoices、#buttoninvoice。
   规则：无 credit 且进入 sectiontopup 时、或无 permission、或 client 无 permission 时，sectiontab 内按钮全部 disable。
======================= */
import wixLocation from 'wix-location';
import wixWindow from 'wix-window';
import { getAccessContext } from 'backend/access/manage';
import { getMyBillingInfo, getCreditPlans, startNormalTopup } from 'backend/saas/topup';
import { submitTicket } from 'backend/saas/help';
import {
    getProperties,
    getTypes,
    getRentalList,
    getTenancyList,
    getMeterGroups,
    insertRentalRecords,
    deleteRentalRecords,
    updateRentalRecord,
    calculateMeterInvoice
} from 'backend/saas/tenantinvoice';
/* =======================
   GLOBAL
======================= */
let accessCtx = null;
let activeSection = null;
let lastSectionBeforeTopup = 'invoice';
let currentPage = 1;
const PAGE_SIZE = 10;
let totalInvoiceCount = 0;
let searchTimer = null;
let currentPayInvoiceId = null;
let currentClientId = null;
let topupInited = false;
let selectedTopupPlanId = null;
let selectedTopupPlanCache = null;
let topupRepeaterBound = false;
let topupCheckoutBound = false;
let topupCloseBound = false;
let invoiceUsageSnapshot = null;
let invoiceInputsBound = false;
let invoiceDateBound = false;
let currentInvoiceMeters = [];
let groupDataCache = [];
let invoiceGroupBound = false;
let sectionSwitchBound = false;
let defaultSectionCollapsed = false;
let lastSectionBeforeMeterReport = null;
let currentInvoiceGroupId = null;
let clientCurrency = 'MYR';
let clientId = null;
let invoiceLoaded = false;
let deleteConfirmId = null;
let filterState = { property: 'ALL', type: 'ALL', search: '', from: null, to: null, sort: 'newest' };
let mobileMenuBound = false;
/** 前端缓存：当前 server 条件（property/type/from/to）下的一次拉取；search/sort 只在前端对 cache 过滤排序，不重复请求 */
let invoiceCache = [];
let invoiceCacheKey = null;
const MAIN_SECTIONS = ['invoice', 'createinvoice', 'group', 'meterreport', 'topup'];
const INVOICE_SEARCH_DEBOUNCE_MS = 280;
const METER_REPORT_BUTTON_LABEL = 'Meter Report';

$w.onReady(async () => {
    disableEntryButtons();
    disableMainActions();
    initDefaultSection();
    if (wixWindow.formFactor === 'Mobile') {
        try {
            $w('#buttonmobilemenu')?.show();
            $w('#buttonmobilemenu')?.enable();
            $w('#boxmobilemenu')?.hide();
            $w('#boxmobilemenu')?.collapse();
            $w('#buttonmeterinvoice2')?.disable();
            $w('#buttoninvoice2')?.disable();
            bindMobileMenu();
        } catch (_) {}
    } else {
        try { $w('#buttonmobilemenu')?.hide(); $w('#boxmobilemenu')?.hide(); } catch (_) {}
    }
    $w('#textstatusloading').show();
    await startInitAsync();
    $w('#textstatusloading').hide();
});

async function startInitAsync() {
    if (wixWindow.formFactor === 'Mobile') {
        try { $w('#buttonmeterinvoice2')?.disable(); $w('#buttoninvoice2')?.disable(); } catch (_) {}
    }
    accessCtx = await getAccessContext();
    if (!accessCtx?.ok) {
        showAccessDenied(accessCtx.reason === 'NO_PERMISSION' ? "You don't have permission" : "You don't have account yet");
        return;
    }
    clientId = accessCtx.client.id;
    clientCurrency = String(accessCtx.client?.currency || 'MYR').toUpperCase();
    if (accessCtx.credit?.ok === false) {
        await enterForcedTopupModeManage();
        return;
    }
    bindSectionSwitch();
    bindTopupCloseButton();
    bindProblemBoxClose();
    bindDetailClose();
    bindPaymentActions();
    bindCreateInvoiceActions();
    bindCloseCreateSection();
    hideSectionLoading();
    enableEntryButtons();
    enableMainActions();
    bindMeterInvoiceEntry();
    bindMeterReportCloseButton();
    if (wixWindow.formFactor === 'Mobile') {
        try {
            $w('#buttonmeterinvoices')?.hide();
            $w('#buttoninvoice')?.hide();
            /* #buttontopup 保留顯示，不隱藏 */
            $w('#buttonmobilemenu')?.show();
            $w('#buttonmeterinvoice2')?.enable();
            $w('#buttoninvoice2')?.enable();
        } catch (_) {}
    } else {
        try { $w('#buttonmobilemenu')?.hide(); $w('#boxmobilemenu')?.hide(); } catch (_) {}
    }
}

/** Mobile: #buttonmobilemenu 打開/收合 #boxmobilemenu；#buttonmeterinvoice2 / #buttoninvoice2 與 desktop 按鈕同邏輯，點後收合菜單 */
function bindMobileMenu() {
    if (mobileMenuBound) return;
    mobileMenuBound = true;
    let mobileMenuOpen = false;
    try {
        $w('#buttonmobilemenu').onClick(() => {
            mobileMenuOpen = !mobileMenuOpen;
            if (mobileMenuOpen) {
                $w('#boxmobilemenu').show();
                $w('#boxmobilemenu').expand();
            } else {
                $w('#boxmobilemenu').collapse();
                $w('#boxmobilemenu').hide();
            }
        });
        $w('#buttoninvoice2').onClick(async () => {
            $w('#textstatusloading').text = 'Loading...';
            $w('#textstatusloading').show();
            try {
                if (!invoiceLoaded) {
                    await loadInvoiceSection();
                    invoiceLoaded = true;
                } else {
                    currentPage = 1;
                    await loadInvoicesPage(1);
                    await waitRepeaterRendered('#repeaterinvoice');
                }
            } catch (err) {
                console.error('[buttoninvoice2]', err);
            } finally {
                await switchSectionAsync('invoice');
                $w('#textstatusloading').hide();
                $w('#boxmobilemenu').collapse();
                $w('#boxmobilemenu').hide();
                mobileMenuOpen = false;
            }
        });
        $w('#buttonmeterinvoice2').onClick(async () => {
            const btn = $w('#buttonmeterinvoice2');
            const saved = (btn && btn.label) ? btn.label : 'Meter';
            if (btn) { btn.disable(); btn.label = 'Loading...'; }
            try {
                $w('#sectiondefault').collapse();
                await openInvoiceGroupSection();
            } finally {
                if (btn) { btn.label = saved; btn.enable(); }
                $w('#boxmobilemenu').collapse();
                $w('#boxmobilemenu').hide();
                mobileMenuOpen = false;
            }
        });
    } catch (_) {}
}

function bindSectionSwitch() {
    if (sectionSwitchBound) return;
    sectionSwitchBound = true;
    $w('#buttoninvoice').onClick(async () => {
        $w('#textstatusloading').text = 'Loading...';
        $w('#textstatusloading').show();
        try {
            if (!invoiceLoaded) {
                await loadInvoiceSection();
                invoiceLoaded = true;
            } else {
                currentPage = 1;
                await loadInvoicesPage(1);
                await waitRepeaterRendered('#repeaterinvoice');
            }
        } catch (err) {
            console.error('[buttoninvoice]', err);
        } finally {
            await switchSectionAsync('invoice');
            $w('#textstatusloading').hide();
        }
    });
    $w('#buttoncreateinvoice').onClick(async () => {
        const btn = $w('#buttoncreateinvoice');
        btn.disable();
        const saved = btn.label || 'Create Invoice';
        btn.label = 'Loading...';
        try {
            resetCreateSection();
            await switchSectionAsync('createinvoice');
        } finally {
            btn.label = saved;
            btn.enable();
        }
    });
    $w('#buttoncreatenewinvoice').onClick(async () => {
        const btn = $w('#buttoncreatenewinvoice');
        btn.disable();
        const saved = btn.label || 'Create New';
        btn.label = 'Loading...';
        try {
            resetCreateSection();
            await switchSectionAsync('createinvoice');
        } finally {
            btn.label = saved;
            btn.enable();
        }
    });
    $w('#buttontopup').onClick(async () => {
        const btn = $w('#buttontopup');
        btn.disable();
        const saved = btn.label || 'Top-up';
        btn.label = 'Loading...';
        try {
            lastSectionBeforeTopup = (activeSection != null && activeSection !== '') ? activeSection : 'default';
            if (!topupInited) { await initTopupSection(); topupInited = true; }
            await switchSectionAsync('topup');
        } finally {
            btn.label = saved;
            btn.enable();
        }
    });
}

async function switchSectionAsync(sectionKey) {
    if (activeSection === sectionKey) return;
    collapseAllSections();
    if (!defaultSectionCollapsed) { $w('#sectiondefault').collapse(); defaultSectionCollapsed = true; }
    $w(`#section${sectionKey}`).expand();
    activeSection = sectionKey;
    try { $w('#sectiontab').expand(); $w('#sectiontab').show(); } catch (_) {}
}

function collapseAllSections() {
    MAIN_SECTIONS.forEach(k => { const sec = $w(`#section${k}`); if (sec) sec.collapse(); });
}

function initDefaultSection() {
    $w('#sectionheader').expand();
    try {
        if (wixWindow.formFactor !== 'Mobile') { $w('#sectiontab').expand(); $w('#sectiontab').show(); }
        else { $w('#sectiontab').collapse(); }
    } catch (_) {}
    $w('#sectiondefault').expand();
    collapseAllSections();
}

function showSectionLoading(text) { $w('#textstatusloading').text = text || 'Loading...'; $w('#textstatusloading').show(); }
function hideSectionLoading() { $w('#textstatusloading').hide(); }

function disableMainActions() {
    ['#buttonprofile', '#buttonusersetting', '#buttonintegration', '#buttontopup', '#buttoninvoice', '#buttonmeterinvoices'].forEach(id => { const el = $w(id); el?.disable?.(); });
}
function enableMainActions() {
    ['#buttonprofile', '#buttonusersetting', '#buttonintegration', '#buttontopup', '#buttoninvoice', '#buttonmeterinvoices'].forEach(id => { const el = $w(id); el?.enable?.(); });
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
    disableEntryButtons(); // 无 credit 时 sectiontab 内按钮全部 disable
}

async function loadInvoiceSection() {
    await setupInvoiceFilters();
    bindInvoiceRepeater();
    bindPagination();
    currentPage = 1;
    await loadInvoicesPage(1);
    await waitRepeaterRendered('#repeaterinvoice');
}

function bindInvoiceRepeater() {
    $w('#repeaterinvoice').onItemReady(($item, item) => {
        const currencyPrefix = clientCurrency === 'SGD' ? 'SGD ' : 'RM ';
        const typeTitle = item.type?.title || '';
        $item('#texttitleinvoice').text = item.title || '';
        $item('#textpropertyname').text = item.property?.shortname || '';
        $item('#texttype').text = typeTitle;
        let displayName = (typeTitle === 'Owner Comission' || typeTitle === 'Owner Comission 2')
            ? (item.property?.ownername?.ownerName || '') : (item.tenant?.fullname || '');
        $item('#texttenantname').text = displayName;
        $item('#textrepeateramount').text = currencyPrefix + Number(item.amount || 0).toFixed(2);
        $item('#boxinvoicecolor').style.backgroundColor = item.isPaid ? '#dff5f2' : '#fde2e2';
        $item('#buttoninvoicedetail').onClick(() => openInvoiceDetail(item));
    });
}

function waitRepeaterRendered(repeaterId) {
    return new Promise(resolve => {
        const repeater = $w(repeaterId);
        const data = repeater.data || [];
        if (!Array.isArray(data) || data.length === 0) {
            resolve();
            return;
        }
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        repeater.onItemReady(finish);
        setTimeout(finish, 3000);
    });
}

async function initTopupSection() {
    const billing = await getMyBillingInfo();
    const credits = Array.isArray(billing.credit) ? billing.credit : [];
    const totalCredit = credits.reduce((s, c) => s + Number(c.amount || 0), 0);
    $w('#textcurrentcredit').text = `Current Credit Balance: ${totalCredit}`;
    const plansRes = await getCreditPlans();
    const plans = Array.isArray(plansRes) ? plansRes : (plansRes && plansRes.items ? plansRes.items : []);
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
                        clientId: clientId || undefined
                    });
                } catch (e) {
                    console.warn('[tenant-invoice] submitTicket topup_manual failed', e);
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
        const target = lastSectionBeforeTopup || 'default';
        if (target === 'default') {
            $w('#sectiondefault').expand();
            defaultSectionCollapsed = false;
            activeSection = null;
        } else {
            collapseAllSections();
            if (!defaultSectionCollapsed) { $w('#sectiondefault').collapse(); defaultSectionCollapsed = true; }
            $w(`#section${target}`).expand();
            activeSection = target;
        }
    });
}

function setupTopupProblemBox(amount) {
    let text = `Your top up amount is more than ${clientCurrency} 1000\nThe top up amount: ${clientCurrency} ${amount}\n\nPlease transfer to:\n`;
    if (clientCurrency === 'SGD') text += '\nPublic Bank (Singapore)\nPlease contact customer service for account details\n';
    else text += '\nPublic Bank Account\nColiving Management Sdn Bhd\n3240130500\n';
    text += '\nPlease drop your receipt to our customer services:\n📞 6019-857 9627\n';
    $w('#textproblem').text = text.trim();
}

function bindProblemBoxClose() {
    $w('#buttoncloseproblem2').onClick(() => $w('#boxproblem2').hide());
}

async function setupInvoiceFilters() {
    let propItems = [];
    let typeItems = [];
    try {
        const propRes = await getProperties();
        propItems = (propRes && propRes.ok && Array.isArray(propRes.items)) ? propRes.items : [];
    } catch (e) { console.error('[setupInvoiceFilters] getProperties', e); }
    $w('#dropdownproperty').options = [
        { label: 'All Property', value: 'ALL' },
        ...propItems.map(p => ({ label: p.shortname || '', value: p.id || p._id || '' }))
    ];
    try {
        const typeRes = await getTypes();
        typeItems = (typeRes && typeRes.ok && Array.isArray(typeRes.items)) ? typeRes.items : [];
    } catch (e) { console.error('[setupInvoiceFilters] getTypes', e); }
    $w('#dropdowntype').options = [
        { label: 'All Type', value: 'ALL' },
        ...typeItems.map(t => ({ label: t.title || '', value: t.id || t._id || '' }))
    ];
    $w('#dropdownsort').options = [
        { label: 'Newest to Oldest', value: 'newest' },
        { label: 'A > Z', value: 'az' },
        { label: 'Z > A', value: 'za' },
        { label: 'Amount Small to Big', value: 'amountasc' },
        { label: 'Amount Big to Small', value: 'amountdesc' },
        { label: 'Owner', value: 'owner' },
        { label: 'Tenant', value: 'tenant' }
    ];
    bindInvoiceFilterEvents();
}

function getInvoiceCacheKey() {
    const property = $w('#dropdownproperty').value;
    const type = $w('#dropdowntype').value;
    const from = $w('#datepicker1').value;
    const to = $w('#datepicker2').value;
    return JSON.stringify({ property: property || 'ALL', type: type || 'ALL', from: from || '', to: to || '' });
}

async function fetchAndFillInvoiceCache() {
    const property = $w('#dropdownproperty').value;
    const type = $w('#dropdowntype').value;
    const from = $w('#datepicker1').value;
    const to = $w('#datepicker2').value;
    let listRes;
    try {
        listRes = await getRentalList({
            property: property && property !== 'ALL' ? property : undefined,
            type: type && type !== 'ALL' ? type : undefined,
            from: from || undefined,
            to: to || undefined
        });
    } catch (e) {
        console.error('[fetchAndFillInvoiceCache] getRentalList', e);
        listRes = { ok: false, items: [] };
    }
    invoiceCache = (listRes && listRes.ok && Array.isArray(listRes.items)) ? listRes.items : [];
    invoiceCacheKey = getInvoiceCacheKey();
}

function invalidateInvoiceCache() {
    invoiceCache = [];
    invoiceCacheKey = null;
}

function applyFilterAndSortToInvoiceCache(pageNumber) {
    const search = ($w('#inputsearch').value || '').trim().toLowerCase();
    let items = search
        ? invoiceCache.filter(i =>
            (i.invoiceid || '').toLowerCase().includes(search) ||
            (i.property?.shortname || '').toLowerCase().includes(search) ||
            (i.property?.ownername?.ownerName || '').toLowerCase().includes(search) ||
            (i.room?.title_fld || '').toLowerCase().includes(search) ||
            (i.tenant?.fullname || '').toLowerCase().includes(search))
        : [...invoiceCache];
    const sort = $w('#dropdownsort').value;
    if (sort === 'az') items.sort((a, b) => (a.property?.shortname || '').localeCompare(b.property?.shortname || ''));
    else if (sort === 'za') items.sort((a, b) => (b.property?.shortname || '').localeCompare(a.property?.shortname || ''));
    else if (sort === 'amountasc') items.sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));
    else if (sort === 'amountdesc') items.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
    else if (sort === 'owner') items = items.filter(i => i.type?.title === 'Owner Comission' || i.type?.title === 'Owner Comission 2');
    else if (sort === 'tenant') items = items.filter(i => i.type?.title !== 'Owner Comission' && i.type?.title !== 'Owner Comission 2');
    else items.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    totalInvoiceCount = items.length;
    const totalPages = Math.max(1, Math.ceil(totalInvoiceCount / PAGE_SIZE));
    $w('#paginationinvoice').totalPages = totalPages;
    $w('#paginationinvoice').currentPage = pageNumber;
    const start = (pageNumber - 1) * PAGE_SIZE;
    $w('#repeaterinvoice').data = items.slice(start, start + PAGE_SIZE);
}

function bindInvoiceFilterEvents() {
    const reload = async () => { currentPage = 1; await loadInvoicesPage(1); };
    $w('#dropdownproperty').onChange(reload);
    $w('#dropdowntype').onChange(reload);
    $w('#dropdownsort').onChange(reload);
    $w('#datepicker1').onChange(reload);
    $w('#datepicker2').onChange(reload);
    $w('#inputsearch').onInput(() => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => { currentPage = 1; await loadInvoicesPage(1); }, INVOICE_SEARCH_DEBOUNCE_MS);
    });
}

async function loadInvoicesPage(pageNumber) {
    currentPage = pageNumber;
    const key = getInvoiceCacheKey();
    if (invoiceCacheKey !== key || invoiceCacheKey === null) {
        await fetchAndFillInvoiceCache();
    }
    applyFilterAndSortToInvoiceCache(pageNumber);
}

function bindDetailClose() {
    $w('#buttonclosedetail').onClick(() => {
        $w('#boxdetail').hide();
        deleteConfirmId = null;
        $w('#buttondeleteinvoice').label = 'Delete';
    });
}

function openInvoiceDetail(item) {
    const prefix = clientCurrency === 'SGD' ? 'SGD ' : 'RM ';
    $w('#textdetailinvoice').text = `Date: ${formatDate(item.date)}\nTitle: ${item.title || ''}\nInvoice ID: ${item.invoiceid || ''}\nDescription: ${item.description || item.referenceid || ''}\nAmount: ${prefix}${Number(item.amount || 0).toFixed(2)}\nPaid: ${item.isPaid ? 'Yes' : 'No'}\nProperty: ${item.property?.shortname || ''}\nRoom: ${item.room?.title_fld || ''}\nTenant: ${item.tenant?.fullname || ''}\n`;
    if (item.isPaid) { $w('#boxdetail').style.backgroundColor = '#dff5f2'; $w('#buttonpay').collapse(); }
    else { $w('#boxdetail').style.backgroundColor = '#fde2e2'; $w('#buttonpay').expand(); }
    currentPayInvoiceId = item._id || item.id;
    if (item.invoiceurl) { $w('#buttoninvoiceurl').expand(); $w('#buttoninvoiceurl').onClick(() => wixLocation.to(item.invoiceurl)); }
    else $w('#buttoninvoiceurl').collapse();
    if (item.receipturl) { $w('#buttonreceipturl').expand(); $w('#buttonreceipturl').onClick(() => wixLocation.to(item.receipturl)); }
    else $w('#buttonreceipturl').collapse();
    bindDeleteConfirm(item._id || item.id);
    $w('#boxdetail').show();
}

function bindDeleteConfirm(id) {
    deleteConfirmId = null;
    $w('#buttondeleteinvoice').label = 'Delete';
    $w('#buttondeleteinvoice').onClick(async () => {
        if (deleteConfirmId !== id) { deleteConfirmId = id; $w('#buttondeleteinvoice').label = 'Confirm Delete'; return; }
        await deleteRentalRecords([id]);
        invalidateInvoiceCache();
        $w('#boxdetail').hide();
        currentPage = 1;
        await loadInvoicesPage(1);
    });
}

function resetCreateSection() {
    const repeater = $w('#repeatercreateinvoice');
    repeater.data = [];
    repeater.collapse();
}

function formatDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-GB');
}

function bindPagination() {
    $w('#paginationinvoice').onChange(async (event) => await loadInvoicesPage(event.target.currentPage));
}

function bindPaymentActions() {
    $w('#buttonpay').onClick(() => {
        $w('#boxpayment').show();
        $w('#datepickerpayment').value = new Date();
        $w('#dropdownpaymentmethod').options = [{ label: 'Cash', value: 'Cash' }, { label: 'Bank', value: 'Bank' }];
        $w('#dropdownpaymentmethod').value = 'Cash';
    });
    $w('#buttonclosepayment').onClick(() => $w('#boxpayment').hide());
    $w('#buttonsubmitpayment').onClick(async () => {
        const invoiceId = currentPayInvoiceId;
        if (!invoiceId) return;
        $w('#buttonsubmitpayment').disable();
        try {
            const method = $w('#dropdownpaymentmethod').value;
            const paidDate = $w('#datepickerpayment').value || new Date();
            const staffName = accessCtx?.staff?.name || accessCtx?.user?.name || 'Staff';
            const referenceText = `Pay by ${method}, submit by ${staffName}, submit on ${formatDate(new Date())}`;
            await updateRentalRecord(invoiceId, { isPaid: true, paidAt: paidDate, referenceid: referenceText, paymentMethod: method });
            invalidateInvoiceCache();
            $w('#boxpayment').hide();
            $w('#boxdetail').hide();
            currentPage = 1;
            await loadInvoicesPage(1);
        } catch (err) { console.error(err); }
        $w('#buttonsubmitpayment').enable();
    });
}

async function bindCreateInvoiceActions() {
    const tenancyRes = await getTenancyList();
    const tenancyItems = tenancyRes.ok ? (tenancyRes.items || []) : [];
    $w('#dropdowntenancy').options = tenancyItems.map(t => ({ value: t.id || t._id, label: `${t.room?.title_fld || ''} - ${t.tenant?.fullname || ''}` }));
    const typeRes = await getTypes();
    const typeItems = typeRes.ok ? (typeRes.items || []) : [];
    $w('#dropdowncreatetype').options = typeItems.map(t => ({ value: t.id || t._id, label: t.title }));
    $w('#buttonaddinvoice').onClick(() => {
        const repeater = $w('#repeatercreateinvoice');
        let data = repeater.data || [];
        if (!Array.isArray(data)) data = [];
        if (repeater.collapsed) repeater.expand();
        data.push({ _id: Date.now().toString() });
        repeater.data = [...data];
    });
    $w('#buttoncreateinvoice').onClick(async () => {
        $w('#buttoncreateinvoice').disable();
        const records = [];
        $w('#repeatercreateinvoice').forEachItem(($item) => {
            records.push({
                date: $item('#datepickercreateinvoice').value,
                tenancy: $item('#dropdowntenancy').value,
                type: $item('#dropdowncreatetype').value,
                amount: Number($item('#inputcreateamount').value),
                description: $item('#inputdescription').value,
                referenceid: $item('#inputdescription').value
            });
        });
        await insertRentalRecords(records);
        invalidateInvoiceCache();
        const repeater = $w('#repeatercreateinvoice');
        repeater.data = [];
        repeater.collapse();
        $w('#buttoncreateinvoice').enable();
        await switchSectionAsync('invoice');
        currentPage = 1;
        await loadInvoicesPage(1);
    });
}

function bindCloseCreateSection() {
    $w('#sectionclosecreateinvoice').onClick(async () => {
        const repeater = $w('#repeatercreateinvoice');
        repeater.data = [];
        repeater.collapse();
        $w('#buttoncreateinvoice').enable();
        await switchSectionAsync('invoice');
        currentPage = 1;
        await loadInvoicesPage(1);
    });
}

function bindInvoiceDateChange(meters) {
    if (invoiceDateBound) return;
    invoiceDateBound = true;
    const handler = async () => {
        const startRaw = $w('#datepicker1meter').value;
        const endRaw = $w('#datepicker2meter').value;
        if (!startRaw || !endRaw) return;
        const { start, end } = toMYPeriodFromDatePicker(startRaw, endRaw);
        const res = await calculateMeterInvoice({ mode: 'usage', clientId, groupMeters: meters, period: { start, end } });
        if (res?.ok) {
            invoiceUsageSnapshot = res.usageSnapshot;
            renderTextAndExpand($w('#textdetail'), res.textdetail);
            renderTextAndExpand($w('#texttotalusage'), `Total usage: ${res.usageSnapshot.totalUsage.toFixed(2)} kWh`);
            $w('#textcalculation').collapse();
            $w('#textformula').collapse();
        }
    };
    $w('#datepicker1meter').onChange(handler);
    $w('#datepicker2meter').onChange(handler);
}

function bindMeterInvoiceEntry() {
    $w('#buttonmeterinvoices').onClick(async () => {
        const btn = $w('#buttonmeterinvoices');
        btn.disable();
        const saved = btn.label || 'Meter';
        btn.label = 'Loading...';
        try {
            $w('#sectiondefault').collapse();
            await openInvoiceGroupSection();
        } finally {
            btn.label = saved;
            btn.enable();
        }
    });
}

async function openInvoiceGroupSection() {
    invoiceUsageSnapshot = null;
    await loadInvoiceGroupList();
    collapseAllSections();
    $w('#sectiondefault').collapse();
    $w('#sectiongroup').expand();
    $w('#sectiongroup').show();
    $w('#repeatergroup').expand();
    $w('#repeatergroup').show();
    activeSection = 'group';
    await new Promise(r => setTimeout(r, 0));
}

async function loadInvoiceGroupList() {
    if (!invoiceGroupBound) { bindInvoiceGroupRepeater(); invoiceGroupBound = true; }
    const res = await getMeterGroups();
    const items = res.ok ? (res.items || []) : [];
    groupDataCache = items;
    const totalPages = Math.ceil(groupDataCache.length / PAGE_SIZE);
    $w('#paginationgroup').totalPages = totalPages;
    $w('#paginationgroup').currentPage = 1;
    renderGroupPage(1);
    $w('#paginationgroup').onChange((e) => renderGroupPage(e.target.currentPage));
}

function renderGroupPage(page) {
    const start = (page - 1) * PAGE_SIZE;
    $w('#repeatergroup').data = groupDataCache.slice(start, start + PAGE_SIZE);
}

function bindInvoiceGroupRepeater() {
    $w('#repeatergroup').onItemReady(($item, data) => {
        $item('#textgroupname').text = data.name || `Group ${data.groupId}`;
        $item('#buttoninvoicemeter').enable();
        $item('#buttoninvoicemeter').onClick(async () => {
            const btn = $item('#buttoninvoicemeter');
            const savedLabel = btn.label || METER_REPORT_BUTTON_LABEL;
            btn.disable();
            btn.label = 'Loading...';
            $w('#repeatergroup').forEachItem(($i) => {
                if ($i !== $item) $i('#buttoninvoicemeter').disable();
            });
            try {
                invoiceUsageSnapshot = null;
                currentInvoiceGroupId = data.groupId;
                const parent = data.meters.find(m => m.role === 'parent');
                const peers = data.meters.filter(m => m.role === 'peer');
                const children = data.meters.filter(m => m.role === 'child');
                let metersForInvoice = [];
                if (parent) metersForInvoice = [{ ...parent }, ...children, ...peers];
                else if (peers.length > 0) metersForInvoice = peers;
                if (metersForInvoice.length === 0) {
                    $w('#sectiongroup').collapse();
                    $w('#sectionmeterreport').expand();
                    activeSection = 'meterreport';
                    renderTextAndExpand($w('#textdetail'), 'No meters in this group.');
                    return;
                }
                currentInvoiceMeters = metersForInvoice;
                await openInvoiceMeterReport({ meters: currentInvoiceMeters });
            } catch (err) {
                console.error('[buttoninvoicemeter]', err);
                $w('#sectiongroup').collapse();
                $w('#sectionmeterreport').expand();
                activeSection = 'meterreport';
                renderTextAndExpand($w('#textdetail'), 'Failed to load. Please try again.');
            } finally {
                enableAllInvoiceButtons();
                $w('#repeatergroup').forEachItem(($i) => { $i('#buttoninvoicemeter').label = METER_REPORT_BUTTON_LABEL; });
            }
        });
    });
}

async function openInvoiceMeterReport({ meters }) {
    invoiceUsageSnapshot = null;
    lastSectionBeforeMeterReport = activeSection;
    invoiceInputsBound = false;
    invoiceDateBound = false;
    $w('#dropdownsharing').options = [
        { label: 'Percentage (by usage)', value: 'percentage' },
        { label: 'Divide Equally', value: 'divide_equally' },
        { label: 'Room (Active Only)', value: 'room' }
    ];
    $w('#dropdownsharing').value = null;
    $w('#inputamount').value = '';
    $w('#buttoncalculation').disable();
    $w('#textdetail').collapse();
    $w('#textcalculation').collapse();
    $w('#texttotalusage').collapse();
    $w('#textformula').collapse();
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth(), 0);
    $w('#datepicker1meter').value = startDate;
    $w('#datepicker2meter').value = endDate;
    const { start, end } = toMYPeriodFromDatePicker(startDate, endDate);
    const res = await calculateMeterInvoice({ mode: 'usage', clientId, groupMeters: meters, period: { start, end } });
    $w('#sectiongroup').collapse();
    $w('#sectionmeterreport').expand();
    activeSection = 'meterreport';
    if (!res?.ok) {
        renderTextAndExpand($w('#textdetail'), 'Unable to load usage. Please try again.');
        return;
    }
    invoiceUsageSnapshot = res.usageSnapshot;
    renderTextAndExpand($w('#textdetail'), res.textdetail);
    renderTextAndExpand($w('#texttotalusage'), `Total usage: ${res.usageSnapshot.totalUsage.toFixed(2)} kWh`);
    await new Promise(r => setTimeout(r, 0));
    bindInvoiceDateChange(meters);
    bindInvoiceInputs(meters);
}

function bindInvoiceInputs(meters) {
    if (invoiceInputsBound) return;
    invoiceInputsBound = true;
    const checkReady = () => {
        const amount = Number($w('#inputamount').value || 0);
        const sharing = $w('#dropdownsharing').value;
        if (amount > 0 && sharing && invoiceUsageSnapshot) $w('#buttoncalculation').enable();
        else $w('#buttoncalculation').disable();
    };
    $w('#inputamount').onInput(() => { const v = $w('#inputamount').value || ''; $w('#inputamount').value = v.replace(/[^\d.]/g, ''); checkReady(); });
    $w('#dropdownsharing').onChange(checkReady);
    $w('#buttoncalculation').onClick(async () => {
        $w('#buttoncalculation').disable();
        $w('#textcalculation').collapse();
        $w('#textformula').collapse();
        const amount = Number($w('#inputamount').value || 0);
        const sharing = $w('#dropdownsharing').value;
        const res = await calculateMeterInvoice({ mode: 'calculation', groupMeters: meters, usageSnapshot: invoiceUsageSnapshot, inputAmount: amount, sharingType: sharing });
        if (res?.ok) {
            renderTextAndExpand($w('#textcalculation'), normalizeMoneyText(res.textcalculation));
            const formulaLines = [];
            if (sharing === 'divide_equally' || sharing === 'room') {
                const activeCount = meters.filter(m => m.role !== 'parent' && m.active !== false).length;
                formulaLines.push(`Calculation: ${formatMoney(amount)} ÷ ${activeCount} meter(s)`);
            }
            if (sharing === 'percentage') {
                const usageMap = invoiceUsageSnapshot.usageMap || {};
                const totalUsage = meters.filter(m => m.active !== false).reduce((s, m) => s + Number(usageMap[m.meterId] || 0), 0);
                meters.filter(m => m.active !== false).forEach(m => {
                    const usage = Number(usageMap[m.meterId] || 0);
                    const ratio = totalUsage > 0 ? usage / totalUsage : 0;
                    formulaLines.push(`${m.title}\n${(ratio * 100).toFixed(2)}% = ${usage.toFixed(2)} ÷ ${totalUsage.toFixed(2)}\nAmount = ${(ratio * 100).toFixed(2)}% × ${formatMoney(amount)} = ${formatMoney(ratio * amount)}`);
                });
            }
            if (formulaLines.length > 0) renderTextAndExpand($w('#textformula'), normalizeMoneyText(formulaLines.join('\n\n')));
        }
        $w('#buttoncalculation').enable();
    });
}

function bindMeterReportCloseButton() {
    $w('#buttonclosemeterreport').onClick(() => {
        collapseAllSections();
        const target = lastSectionBeforeMeterReport || 'group';
        const sec = $w(`#section${target}`);
        if (sec) sec.expand();
        activeSection = target;
    });
}

function toMYPeriodFromDatePicker(startRaw, endRaw) {
    const start = new Date(startRaw); start.setHours(0, 0, 0, 0);
    const end = new Date(endRaw); end.setHours(23, 59, 59, 999);
    return { start, end };
}

function renderTextAndExpand(el, text) { el.text = text; setTimeout(() => el.expand(), 0); }

function enableAllInvoiceButtons() {
    $w('#repeatergroup').forEachItem(($item) => $item('#buttoninvoicemeter').enable());
}

function normalizeMoneyText(text) {
    if (!text) return text;
    return text.replace(/(SGD|MYR)\s*([\d]+(?:\.\d+)?)/g, (_, c, v) => `${c} ${Math.round(Number(v))}`);
}

function formatMoney(amount) {
    return `${clientCurrency || 'MYR'} ${Number(amount || 0).toFixed(2)}`;
}

/** sectiontab 内按钮：无 credit 或无 permission 时 disable */
function disableEntryButtons() {
    ['#buttonmeterinvoices', '#buttoninvoice', '#buttontopup'].forEach(id => { const el = $w(id); el?.disable?.(); });
}

function enableEntryButtons() {
    ['#buttonmeterinvoices', '#buttoninvoice', '#buttontopup'].forEach(id => { const el = $w(id); el?.enable?.(); });
}
