/* =======================
   Contact Setting page – Wix 前端 + Node 后端 + MySQL
   不再使用 wix-data；所有数据通过 backend/access/manage、backend/billing、backend/saas/contact 请求 ECS。

   Wix 元素 ID 需一致（否则改下面 REPEATER_CONTACT_IDS）：
   - 列表 Repeater: repeatercontact（或 repeater1）
   - 搜索框: inputcontact  筛选下拉: dropdownfiltercontact  分页: paginationcontact
   - 区块: sectioncontact（点击 Contact 时 expand，repeater 必须在此 section 内）

   使用 backend/saas/contact：getContactList、getOwner、getTenant、getSupplier（点编辑时拉最新）、
   updateOwnerAccount、updateTenantAccount、delete*、createSupplier、updateSupplier、
   submitOwnerApproval、submitTenantApproval。upsertContactTransit 已由后端 createSupplier 内部调用；
   若需单独「同步到 Bukku」可在此页直接调用 upsertContactTransit。
======================= */

import wixLocation from 'wix-location';
import wixWindow from 'wix-window';
import { getAccessContext } from 'backend/access/manage';
import { getMyBillingInfo, getCreditPlans, startNormalTopup } from 'backend/saas/topup';
import { submitTicket } from 'backend/saas/help';
import {
    getContactList,
    getOwner,
    getTenant,
    getSupplier,
    getBanks,
    getAccountSystem,
    updateOwnerAccount,
    updateTenantAccount,
    deleteOwnerOrCancel,
    deleteTenantOrCancel,
    deleteSupplierAccount,
    upsertContactTransit,
    createSupplier,
    updateSupplier,
    submitOwnerApproval,
    submitTenantApproval
} from 'backend/saas/contact';

/* =======================
   let
======================= */
let accessCtx = null;
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
let contactInited = false;
let contactRepeaterBound = false;
let contactDeleteConfirmId = null;
let contactAllData = [];
let contactViewData = [];
let contactDetailStatus = null;
/** 前端 cache：最多 CONTACT_CACHE_LIMIT 条；超过则 useServerFilter，筛选/翻页走 server */
let contactCache = [];
let contactCacheTotal = 0;
let useServerFilter = false;
let contactCurrentPage = 1;
let contactSearchDebounceTimer = null;

const CONTACT_PAGE_SIZE = 10;
const CONTACT_CACHE_LIMIT = 500;
const CONTACT_FILTER_DEBOUNCE_MS = 300;
const REPEATER_CONTACT_IDS = ['repeatercontact', 'repeater1'];

function getRepeaterContact() {
    for (const id of REPEATER_CONTACT_IDS) {
        try {
            const el = $w(`#${id}`);
            if (el && typeof el.data !== 'undefined') return el;
        } catch (_) {}
    }
    return null;
}

function setRepeaterContactData(data) {
    const arr = Array.isArray(data) ? data : [];
    const el = getRepeaterContact();
    if (el) {
        el.data = arr;
    } else {
        console.warn('[Contact] Repeater not found. Add an element with ID repeatercontact or repeater1 in the Contact section.');
    }
}
let contactDetailType = null;
let contactDetailRaw = null;
let lastSectionBeforeContactDetail = null;
let saveHandler = null;
/** Bank options from bankdetail for #dropdownbank (value = id → supplierdetail.bankdetail_id) */
let contactBankOptions = [];

function mapBankOptions(items) {
    if (!Array.isArray(items)) return [];
    return items.map((b) => ({
        value: String(b.id ?? b._id ?? ''),
        label: String(b.bankname ?? b.id ?? b._id ?? '—')
    })).filter((o) => o.value !== '');
}

/** Set #dropdownbank options (and re-apply after short delay so options stick when section was collapsed). */
function setDropdownBankOptions() {
    const opts = contactBankOptions.length ? contactBankOptions : [{ value: '', label: '— No banks —' }];
    $w('#dropdownbank').options = opts;
    setTimeout(() => { try { $w('#dropdownbank').options = opts; } catch (_) {} }, 80);
}

/** Ensure contactBankOptions is loaded (e.g. when opening supplier form before Contact tab was opened). */
async function ensureContactBankOptions() {
    if (contactBankOptions.length > 0) return;
    try {
        const bankRes = await getBanks();
        contactBankOptions = bankRes?.ok ? mapBankOptions(bankRes.items) : [];
    } catch (_) {
        contactBankOptions = [];
    }
}
/** Current client's account system: sql | autocount | bukku | xero. Decides which key in account[] to read/write. */
let contactAccountSystem = 'sql';
/** true when client has addonAccount configured (bukku/xero/autocount). When false, #inputbukkuid is disabled. */
let contactHasAccountSystem = false;

/* =======================
   const
======================= */
const MAIN_SECTIONS = ['topup', 'contact', 'contactdetail'];
const sectionLoaded = {
    topup: false,
    contactdetail: false,
    contact: false
};

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
    accessCtx = await getAccessContext();
    $w('#textstatusloading').hide();
    clientCurrency = String(accessCtx.client?.currency || 'MYR').toUpperCase();

    if (!accessCtx.ok) {
        const msg = accessCtx.reason === 'NO_PERMISSION' ? "You don't have permission" : "You don't have account yet";
        showAccessDenied(msg);
        return;
    }
    if (!accessCtx.staff?.permission?.tenantdetail && !accessCtx.staff?.permission?.admin) {
        showAccessDenied("You don't have permission");
        return;
    }
    if (accessCtx.credit?.ok === false) {
        await enterForcedTopupModeManage();
        return;
    }

    bindSectionSwitch();
    bindTopupCloseButton();
    bindContactDetailButtons();
    bindContactDetailCloseButton();
    enableMainActions();
    bindSaveButton();
    bindProblemBoxClose();
}

/* =======================
   Section Switch: disable button + label "Loading" until await completes, then switch section
======================= */
function withSectionSwitchLoading(buttonId, asyncFn) {
    return async function () {
        const btn = $w(buttonId);
        const originalLabel = (btn && typeof btn.label !== 'undefined') ? btn.label : '';
        try {
            if (btn) { btn.disable(); btn.label = 'Loading'; }
            await asyncFn();
        } finally {
            if (btn) { btn.label = originalLabel; btn.enable(); }
        }
    };
}

function bindSectionSwitch() {
    if (sectionSwitchBound) return;
    sectionSwitchBound = true;

    $w('#buttontopup').onClick(withSectionSwitchLoading('#buttontopup', async () => {
        lastSectionBeforeTopup = activeSection || 'default';
        if (!topupInited) {
            await initTopupSection();
            topupInited = true;
        }
        await switchSectionAsync('topup');
    }));

    $w('#buttoncontact').onClick(withSectionSwitchLoading('#buttoncontact', async () => {
        showSectionLoading('Loading contacts...');
        try {
            if (!contactInited) {
                await initContactSection({ skipHideLoading: true });
                contactInited = true;
            }
            await switchSectionAsync('contact');
        } finally {
            hideSectionLoading();
        }
    }));
}

async function switchSectionAsync(sectionKey) {
    if (activeSection === sectionKey) return;
    collapseAllSections();
    if (!defaultSectionCollapsed) {
        $w('#sectiondefault').collapse();
        defaultSectionCollapsed = true;
    }
    const sec = $w(`#section${sectionKey}`);
    sec.expand();
    activeSection = sectionKey;
}

function collapseAllSections() {
    MAIN_SECTIONS.forEach(k => {
        const sec = $w(`#section${k}`);
        if (sec) sec.collapse();
    });
}

function initDefaultSection() {
    $w('#sectionheader').expand();
    $w('#sectiondefault').expand();
    try { $w('#sectiontab').expand(); } catch (_) {}
    collapseAllSections();
}

function showSectionLoading(text = 'Loading...') {
    $w('#text19').text = text;
    $w('#text19').show();
}

function hideSectionLoading() {
    $w('#text19').hide();
}

/* =======================
   Permission / UI
======================= */
function disableMainActions() {
    ['#buttoncontact', '#buttontopup'].forEach(id => {
        const el = $w(id);
        el?.disable?.();
    });
}

function enableMainActions() {
    ['#buttoncontact', '#buttontopup'].forEach(id => {
        const el = $w(id);
        el?.enable?.();
    });
}

function showAccessDenied(message) {
    initDefaultSection();
    $w('#textstatusloading').text = message;
    $w('#textstatusloading').show();
    disableMainActions();
}

/* =======================
   Forced Topup
======================= */
async function enterForcedTopupModeManage() {
    collapseAllSections();
    $w('#sectiontopup').expand();
    activeSection = 'topup';
    defaultSectionCollapsed = true;
}

/* =======================
   Topup Section (ECS billing: credit-plans, topup/start)
======================= */
async function initTopupSection() {
    const billing = await getMyBillingInfo();
    const credits = Array.isArray(billing.credit) ? billing.credit : [];
    const totalCredit = credits.reduce((s, c) => s + Number(c.amount || 0), 0);
    $w('#textcurrentcredit').text = `Current Credit Balance: ${totalCredit}`;

    const plans = await getCreditPlans();
    const items = Array.isArray(plans) ? plans : [];
    $w('#repeatertopup').data = items;

    if (!topupRepeaterBound) {
        $w('#repeatertopup').onItemReady(($item, plan) => {
            $item('#textamount').text = `${clientCurrency} ${plan.sellingprice}`;
            $item('#textcreditamount').text = String(plan.credit);
            $item('#boxcolor').hide();
            $item('#containertopup').onClick(() => {
                selectedTopupPlanId = plan.id || plan._id;
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
                    console.warn('[contact-setting] submitTicket topup_manual failed', e);
                }
                return;
            }
            const res = await startNormalTopup({
                creditPlanId: selectedTopupPlanId,
                returnUrl: wixLocation.url
            });
            if (res && res.url) wixLocation.to(res.url);
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
   Contact Section (filter 同 expenses：cache + server 双模式)
======================= */
function getCurrentContactFilterOpts() {
    const val = $w('#dropdownfiltercontact').value;
    let type = null;
    let sort = null;
    if (val === 'owner' || val === 'tenant' || val === 'supplier') type = val;
    else if (val === 'A>z' || val === 'Z>a') sort = val;
    return {
        type: type || undefined,
        sort: sort || undefined,
        search: ($w('#inputcontact').value || '').trim()
    };
}

/** @param {{ skipHideLoading?: boolean }} opts - skipHideLoading: when true, do not hide #text19 (caller will hide after section switch) */
async function fetchAndFillContactCache(opts = {}) {
    const skipHideLoading = opts.skipHideLoading === true;
    showSectionLoading('Loading contacts...');
    setRepeaterContactData([]);
    try {
        const res = await getContactList({ limit: CONTACT_CACHE_LIMIT });
        const total = (res && res.ok && typeof res.total === 'number') ? res.total : 0;
        const items = (res && res.ok && Array.isArray(res.items)) ? res.items : [];
        if (!res || !res.ok) {
            console.warn('[Contact] getContactList not ok:', res?.reason || res);
            try { $w('#text19').text = 'Could not load contacts (' + (res?.reason || 'error') + ')'; $w('#text19').show(); } catch (_) {}
            contactCache = [];
            contactCacheTotal = 0;
            useServerFilter = false;
            if (!skipHideLoading) hideSectionLoading();
            return;
        }
        if (total <= CONTACT_CACHE_LIMIT) {
            contactCache = items;
            contactCacheTotal = total;
            useServerFilter = false;
        } else {
            contactCache = [];
            contactCacheTotal = total;
            useServerFilter = true;
        }
        if (items.length === 0) {
            try { $w('#text19').text = 'No contacts yet'; $w('#text19').show(); } catch (_) {}
            if (!skipHideLoading) hideSectionLoading();
            return;
        }
    } catch (err) {
        console.error('fetchAndFillContactCache ERROR', err);
        try { $w('#text19').text = 'Could not load contacts (check console)'; $w('#text19').show(); } catch (_) {}
        contactCache = [];
        contactCacheTotal = 0;
        useServerFilter = false;
        if (!skipHideLoading) hideSectionLoading();
        return;
    }
    if (!skipHideLoading) hideSectionLoading();
}

function invalidateContactCache() {
    contactCache = [];
    contactCacheTotal = 0;
}

function contactResetToFirstPage() {
    contactCurrentPage = 1;
    try { $w('#paginationcontact').currentPage = 1; } catch (_) {}
}

function sortContactList(list, sortKey) {
    const arr = [...list];
    if (sortKey === 'Z>a') return arr.sort((a, b) => (b.text || '').localeCompare(a.text || '', undefined, { sensitivity: 'base' }));
    return arr.sort((a, b) => (a.text || '').localeCompare(b.text || '', undefined, { sensitivity: 'base' }));
}

async function applyContactFilterAndSort() {
    if (useServerFilter) {
        await loadContactPageFromServer(contactCurrentPage);
        return;
    }
    applyContactFilterAndSortToCache();
}

function applyContactFilterAndSortToCache() {
    const opts = getCurrentContactFilterOpts();
    let list = contactCache;
    if (opts.type) list = list.filter((i) => i.type === opts.type);
    if (opts.search) {
        const s = opts.search.toLowerCase();
        list = list.filter((i) => (i.searchText || i.text || '').toLowerCase().includes(s));
    }
    list = sortContactList(list, opts.sort || 'A>z');
    contactViewData = list;
    renderContactPage(contactCurrentPage);
}

async function loadContactPageFromServer(pageNumber) {
    contactCurrentPage = pageNumber;
    const opts = getCurrentContactFilterOpts();
    setRepeaterContactData([]);
    showSectionLoading('Loading...');
    try {
        const res = await getContactList({
            type: opts.type,
            search: opts.search,
            sort: opts.sort,
            page: contactCurrentPage,
            pageSize: CONTACT_PAGE_SIZE
        });
        const items = (res && res.ok && Array.isArray(res.items)) ? res.items : [];
        const total = (res && res.ok && typeof res.total === 'number') ? res.total : 0;
        const totalPages = Math.max(1, (res && res.totalPages) || Math.ceil(total / CONTACT_PAGE_SIZE));
        try {
            $w('#paginationcontact').totalPages = totalPages;
            $w('#paginationcontact').currentPage = res && res.currentPage ? res.currentPage : contactCurrentPage;
        } catch (_) {}
        setRepeaterContactData(items);
    } catch (err) {
        console.error('loadContactPageFromServer ERROR', err);
        setRepeaterContactData([]);
    }
    hideSectionLoading();
}

/** @param {{ skipHideLoading?: boolean }} opts - skipHideLoading: passed to fetchAndFillContactCache so #text19 stays until section switch */
async function initContactSection(opts = {}) {
    $w('#dropdownfiltercontact').options = [
        { label: 'A > Z', value: 'A>z' },
        { label: 'Z > A', value: 'Z>a' },
        { label: 'Owner', value: 'owner' },
        { label: 'Tenant', value: 'tenant' },
        { label: 'Supplier', value: 'supplier' }
    ];
    $w('#dropdownfiltercontact').value = undefined;
    $w('#inputcontact').value = '';
    contactCurrentPage = 1;
    setRepeaterContactData([]);
    bindContactRepeater();
    await fetchAndFillContactCache({ skipHideLoading: opts.skipHideLoading });
    try {
        const bankRes = await getBanks();
        contactBankOptions = bankRes?.ok ? mapBankOptions(bankRes.items) : [];
    } catch (_) {
        contactBankOptions = [];
    }
    try {
        const sysRes = await getAccountSystem();
        contactAccountSystem = (sysRes?.ok && sysRes?.provider) ? sysRes.provider : 'sql';
        contactHasAccountSystem = contactAccountSystem !== 'sql';
    } catch (_) {
        contactAccountSystem = 'sql';
        contactHasAccountSystem = false;
    }
    await applyContactFilterAndSort();
    bindContactFilter();
    bindContactPagination();
    bindContactSearch();
}

async function refetchContactAfterWrite() {
    invalidateContactCache();
    showSectionLoading('Refreshing contacts...');
    await fetchAndFillContactCache();
    await applyContactFilterAndSort();
    hideSectionLoading();
}

function bindContactRepeater() {
    if (contactRepeaterBound) return;
    const repeater = getRepeaterContact();
    if (!repeater) return;
    contactRepeaterBound = true;

    repeater.onItemReady(($item, item) => {
        $item('#textcontact').text = item.text;
        $item('#textrole').text = item.role;
        $item('#textrole').style.color = item.roleColor;
        $item('#buttoneditcontact').enable();
        $item('#buttondeletecontact').disable();

        if (item.type === 'owner') {
            const isPending = item.__pending === true;
            if (isPending) {
                $item('#buttoneditcontact').disable();
                $item('#buttondeletecontact').enable();
                $item('#buttondeletecontact').label = 'Cancel';
            } else {
                $item('#buttoneditcontact').enable();
                $item('#buttondeletecontact').enable();
                $item('#buttondeletecontact').label = 'Delete';
            }
            $item('#buttondeletecontact').onClick(async () => {
                if (contactDeleteConfirmId !== item._id) {
                    contactDeleteConfirmId = item._id;
                    $item('#buttondeletecontact').label = 'Confirm Delete';
                    return;
                }
                contactDeleteConfirmId = null;
                $item('#buttondeletecontact').label = isPending ? 'Cancel' : 'Delete';
                await handleOwnerDeleteOrCancel(item.raw, isPending);
            });
        }

        if (item.type === 'tenant') {
            const isPending = item.__pending === true;
            if (isPending) {
                $item('#buttoneditcontact').disable();
                $item('#buttondeletecontact').enable();
                $item('#buttondeletecontact').label = 'Cancel';
            } else {
                $item('#buttoneditcontact').enable();
                $item('#buttondeletecontact').enable();
                $item('#buttondeletecontact').label = 'Delete';
            }
            $item('#buttondeletecontact').onClick(async () => {
                if (contactDeleteConfirmId !== item._id) {
                    contactDeleteConfirmId = item._id;
                    $item('#buttondeletecontact').label = 'Confirm Delete';
                    return;
                }
                contactDeleteConfirmId = null;
                $item('#buttondeletecontact').label = isPending ? 'Cancel' : 'Delete';
                await handleTenantDeleteOrCancel(item.raw, isPending);
            });
        }

        if (item.type === 'supplier') {
            $item('#buttondeletecontact').enable();
            $item('#buttondeletecontact').label = 'Delete';
            $item('#buttondeletecontact').onClick(async () => {
                if (contactDeleteConfirmId !== item._id) {
                    contactDeleteConfirmId = item._id;
                    $item('#buttondeletecontact').label = 'Confirm Delete';
                    return;
                }
                contactDeleteConfirmId = null;
                $item('#buttondeletecontact').label = 'Delete';
                try {
                    const res = await deleteSupplierAccount(item.raw._id);
                    if (res && res.ok) await refetchContactAfterWrite();
                } catch (err) {
                    console.error('DELETE SUPPLIER ACCOUNT ERROR', err);
                }
            });
        }
    });
}

function bindContactFilter() {
    $w('#dropdownfiltercontact').onChange(() => {
        contactResetToFirstPage();
        applyContactFilterAndSort();
    });
}

function bindContactPagination() {
    $w('#paginationcontact').onChange((event) => {
        contactCurrentPage = event.target.currentPage;
        if (useServerFilter) loadContactPageFromServer(contactCurrentPage);
        else applyContactFilterAndSortToCache();
    });
}

function bindContactSearch() {
    $w('#inputcontact').onInput(() => {
        if (contactSearchDebounceTimer) clearTimeout(contactSearchDebounceTimer);
        contactSearchDebounceTimer = setTimeout(() => {
            contactSearchDebounceTimer = null;
            contactResetToFirstPage();
            applyContactFilterAndSort();
        }, CONTACT_FILTER_DEBOUNCE_MS);
    });
}

function renderContactPage(page = 1) {
    const totalItems = contactViewData.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / CONTACT_PAGE_SIZE));
    try {
        $w('#paginationcontact').totalPages = totalPages;
        $w('#paginationcontact').currentPage = page;
    } catch (_) {}
    const start = (page - 1) * CONTACT_PAGE_SIZE;
    setRepeaterContactData(contactViewData.slice(start, start + CONTACT_PAGE_SIZE));
}

function truncateText(text, maxLength = 50) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 5) + '.....';
}

/* =======================
   Contact Detail (Owner/Tenant/Supplier edit, Supplier create)
======================= */
function initContactDetailCreateSupplier() {
    $w('#inputname').enable();
    $w('#inputname').value = '';
    $w('#inputemail').show();
    $w('#inputemail').enable();
    $w('#inputemail').value = '';
    if (contactHasAccountSystem) $w('#inputbukkuid').enable(); else $w('#inputbukkuid').disable();
    $w('#inputbukkuid').value = '';
    setDropdownBankOptions();
    $w('#dropdownbank').value = undefined;
    $w('#dropdownmode').options = [
        { label: 'Jompay', value: 'jompay' },
        { label: 'Bank Transfer', value: 'bank' }
    ];
    $w('#dropdownmode').value = undefined;
    collapseJompay();
    collapseBankTransfer();
    bindSupplierModeSwitch();
    bindContactDetailSaveSupplierCreate();
}

async function initContactDetailEdit(item) {
    const id = item?.raw?._id;
    if (id == null) return;
    showSectionLoading('Loading...');
    if (contactDetailType === 'supplier') await ensureContactBankOptions();
    try {
        if (contactDetailType === 'owner') {
            const res = await getOwner(id);
            if (res && res.ok) {
                const owner = { _id: res._id, ownerName: res.ownerName, email: res.email, account: res.account };
                initEditOwner(owner);
            } else {
                try { $w('#text19').text = 'Could not load owner (' + (res?.reason || 'error') + ')'; $w('#text19').show(); } catch (_) {}
            }
        } else if (contactDetailType === 'tenant') {
            const res = await getTenant(id);
            if (res && res.ok) {
                const tenant = { _id: res._id, fullname: res.fullname, email: res.email, account: res.account };
                initEditTenant(tenant);
            } else {
                try { $w('#text19').text = 'Could not load tenant (' + (res?.reason || 'error') + ')'; $w('#text19').show(); } catch (_) {}
            }
        } else if (contactDetailType === 'supplier') {
            const res = await getSupplier(id);
            if (res && res.ok) {
                const supplier = { _id: res._id, title: res.title, email: res.email, account: res.account, billerCode: res.billerCode, bankName: res.bankName, bankAccount: res.bankAccount, bankHolder: res.bankHolder };
                initEditSupplier(supplier);
            } else {
                try { $w('#text19').text = 'Could not load supplier (' + (res?.reason || 'error') + ')'; $w('#text19').show(); } catch (_) {}
            }
        }
    } catch (err) {
        console.error('initContactDetailEdit ERROR', err);
        try { $w('#text19').text = 'Could not load contact (check console)'; $w('#text19').show(); } catch (_) {}
    }
    hideSectionLoading();
}

function initEditOwner(owner) {
    resetSaveButton();
    $w('#dropdownmode').collapse();
    $w('#inputname').disable();
    $w('#inputname').value = owner.ownerName || '';
    hideSupplierFields();
    $w('#inputemail').show();
    $w('#inputemail').disable();
    $w('#inputemail').value = owner.email || '';
    if (contactHasAccountSystem) $w('#inputbukkuid').enable(); else $w('#inputbukkuid').disable();
    const clientId = accessCtx.client?.id || accessCtx.client?._id;
    const accountEntry = (owner.account || []).find(a => a.provider === contactAccountSystem && a.clientId === clientId);
    $w('#inputbukkuid').value = accountEntry?.id || '';

    saveHandler = async () => {
        try {
            setSaveButtonLoading(true);
            const contactId = ($w('#inputbukkuid').value || '').trim();
            const res = await updateOwnerAccount(owner._id, contactId);
            if (res && res.ok) await afterContactDetailSaved();
        } catch (err) {
            console.error('UPDATE OWNER ERROR', err);
        }
        setSaveButtonLoading(false);
    };
}

function initEditTenant(tenant) {
    resetSaveButton();
    $w('#dropdownmode').collapse();
    $w('#inputname').disable();
    $w('#inputname').value = tenant.fullname || '';
    hideSupplierFields();
    $w('#inputemail').show();
    $w('#inputemail').disable();
    $w('#inputemail').value = tenant.email || '';
    if (contactHasAccountSystem) $w('#inputbukkuid').enable(); else $w('#inputbukkuid').disable();
    const clientId = accessCtx.client?.id || accessCtx.client?._id;
    const accountEntry = (tenant.account || []).find(a => a.provider === contactAccountSystem && a.clientId === clientId);
    $w('#inputbukkuid').value = accountEntry?.id || '';

    saveHandler = async () => {
        try {
            setSaveButtonLoading(true);
            const contactId = ($w('#inputbukkuid').value || '').trim();
            const res = await updateTenantAccount(tenant._id, contactId);
            if (res && res.ok) await afterContactDetailSaved();
        } catch (err) {
            console.error('UPDATE TENANT ERROR', err);
        }
        setSaveButtonLoading(false);
    };
}

function bindSupplierModeSwitch() {
    $w('#dropdownmode').onChange(() => {
        const mode = $w('#dropdownmode').value;
        if (mode === 'jompay') {
            expandJompay();
            collapseBankTransfer();
        } else if (mode === 'bank') {
            collapseJompay();
            expandBankTransfer();
        }
    });
}

function expandJompay() {
    $w('#boxjompay').expand();
    $w('#boxtransfer').collapse();
}

function expandBankTransfer() {
    $w('#boxtransfer').expand();
    $w('#boxjompay').collapse();
}

function collapseJompay() {
    $w('#boxjompay').collapse();
}

function collapseBankTransfer() {
    $w('#boxtransfer').collapse();
}

function bindContactDetailSaveSupplierCreate() {
    resetSaveButton();
    saveHandler = async () => {
        try {
            setSaveButtonLoading(true);
            let productidVal = '';
            try { productidVal = ($w('#inputproductid').value || '').trim(); } catch (_) {}
            const payload = {
                name: $w('#inputname').value,
                email: normalizeEmail($w('#inputemail').value),
                billerCode: $w('#inputbillercode').value,
                bankName: $w('#dropdownbank').value,
                bankAccount: $w('#inputbankaccount').value,
                bankHolder: $w('#inputbankholder').value,
                productid: productidVal || undefined
            };
            /* bankName = bankdetail_id (FK). account (Bukku id per client) set by backend from upsert-transit. productid optional. */
            const res = await createSupplier(payload);
            if (!res?.ok) {
                setSaveButtonLoading(false);
                return;
            }
            await afterContactDetailSaved();
        } catch (err) {
            console.error('SAVE SUPPLIER ERROR', err);
            setSaveButtonLoading(false);
        }
    };
}

function setSaveButtonLoading(isLoading) {
    if (isLoading) {
        $w('#buttonsave').disable();
        $w('#buttonsave').label = 'Updating...';
    } else {
        $w('#buttonsave').enable();
        $w('#buttonsave').label = 'Save';
    }
}

async function afterContactDetailSaved() {
    setSaveButtonLoading(false);
    $w('#sectioncontactdetail').collapse();
    const target = lastSectionBeforeContactDetail || 'contact';
    $w(`#section${target}`).expand();
    activeSection = target;
    await refetchContactAfterWrite();
}

function resetSaveButton() {
    saveHandler = null;
}

function bindSaveButton() {
    $w('#buttonsave').onClick(async () => {
        if (!saveHandler) return;
        await saveHandler();
    });
}

function hideSupplierFields() {
    $w('#boxjompay').collapse();
    $w('#boxtransfer').collapse();
}

function initEditSupplier(supplier) {
    resetSaveButton();
    $w('#inputname').enable();
    $w('#inputname').value = supplier.title || '';
    $w('#inputemail').show();
    $w('#inputemail').value = supplier.email || '';
    if (contactHasAccountSystem) $w('#inputbukkuid').enable(); else $w('#inputbukkuid').disable();
    const clientId = accessCtx.client?.id || accessCtx.client?._id;
    const accountEntry = (supplier.account || []).find(a => a.provider === contactAccountSystem && a.clientId === clientId);
    $w('#inputbukkuid').value = accountEntry?.id || '';
    setDropdownBankOptions();
    $w('#dropdownmode').expand();
    $w('#dropdownmode').options = [
        { label: 'Jompay', value: 'jompay' },
        { label: 'Bank Transfer', value: 'bank' }
    ];
    collapseJompay();
    collapseBankTransfer();
    if (supplier.billerCode) {
        $w('#dropdownmode').value = 'jompay';
        expandJompay();
        $w('#inputbillercode').value = supplier.billerCode || '';
    } else {
        $w('#dropdownmode').value = 'bank';
        expandBankTransfer();
        $w('#dropdownbank').value = supplier.bankName || '';
        $w('#inputbankaccount').value = supplier.bankAccount || '';
        $w('#inputbankholder').value = supplier.bankHolder || '';
    }
    try { $w('#inputproductid').value = supplier.productid || ''; } catch (_) { /* #inputproductid optional in #sectioncontactdetail */ }
    bindSupplierModeSwitch();

    saveHandler = async () => {
        try {
            setSaveButtonLoading(true);
            const contactId = ($w('#inputbukkuid').value || '').trim();
            let productidVal = '';
            try { productidVal = ($w('#inputproductid').value || '').trim(); } catch (_) {}
            const payload = {
                name: $w('#inputname').value,
                email: normalizeEmail($w('#inputemail').value),
                billerCode: $w('#inputbillercode').value,
                bankName: $w('#dropdownbank').value,
                bankAccount: $w('#inputbankaccount').value,
                bankHolder: $w('#inputbankholder').value,
                contactId: contactId || undefined,
                productid: productidVal || undefined
            };
            /* bankName = bankdetail_id. contactId → supplierdetail.account. productid → supplierdetail.productid (optional, for purchase). */
            const res = await updateSupplier(supplier._id, payload);
            if (!res?.ok) {
                setSaveButtonLoading(false);
                return;
            }
            await afterContactDetailSaved();
        } catch (err) {
            console.error('UPDATE SUPPLIER ERROR', err);
            setSaveButtonLoading(false);
        }
    };
}

function bindContactDetailButtons() {
    $w('#buttoncreatecontact').onClick(() => $w('#boxcontact').show());

    $w('#buttonsupplier').onClick(async () => {
        $w('#boxcontact').hide();
        lastSectionBeforeContactDetail = activeSection || 'contact';
        contactDetailStatus = 'create';
        contactDetailType = 'supplier';
        contactDetailRaw = null;
        await ensureContactBankOptions();
        collapseAllSections();
        $w('#sectioncontactdetail').expand();
        activeSection = 'contactdetail';
        initContactDetailCreateSupplier();
    });

    $w('#buttonowner').onClick(() => {
        contactDetailType = 'owner';
        $w('#inputemail2').value = '';
        $w('#boxcontact2').show();
    });

    $w('#buttontenant').onClick(() => {
        contactDetailType = 'tenant';
        $w('#inputemail2').value = '';
        $w('#boxcontact2').show();
    });

    $w('#buttonclosecontact').onClick(() => $w('#boxcontact').hide());
    $w('#buttoncloseboxcontact2').onClick(() => {
        $w('#boxcontact').hide();
        $w('#boxcontact2').hide();
    });

    $w('#buttonsubmitapproval2').onClick(async () => {
        const btn = $w('#buttonsubmitapproval2');
        btn.disable();
        btn.label = 'Creating...';
        try {
            const email = normalizeEmail($w('#inputemail2').value);
            if (!email) {
                btn.enable();
                btn.label = 'Save';
                return;
            }
            if (contactDetailType === 'owner') await submitOwnerApproval(email);
            if (contactDetailType === 'tenant') await submitTenantApproval(email);
            $w('#boxcontact').hide();
            $w('#boxcontact2').hide();
            contactDetailType = null;
            showSectionLoading('Submitting approval...');
            await refetchContactAfterWrite();
            hideSectionLoading();
        } finally {
            btn.enable();
            btn.label = 'Save';
        }
    });

    const repeater = getRepeaterContact();
    if (repeater) {
        repeater.onItemReady(($item, item) => {
            $item('#buttoneditcontact').onClick(async () => {
                const btn = $item('#buttoneditcontact');
                const originalLabel = (typeof btn.label !== 'undefined') ? btn.label : 'Edit';
                btn.disable();
                btn.label = 'Loading';
                try {
                    lastSectionBeforeContactDetail = activeSection || 'contact';
                    contactDetailStatus = 'edit';
                    contactDetailType = item.type;
                    contactDetailRaw = item.raw;
                    await initContactDetailEdit(item);
                    collapseAllSections();
                    $w('#sectioncontactdetail').expand();
                    activeSection = 'contactdetail';
                } finally {
                    btn.label = originalLabel;
                    btn.enable();
                }
            });
        });
    }
}

function bindContactDetailCloseButton() {
    $w('#buttonclosecontactdetail').onClick(() => {
        $w('#sectioncontactdetail').collapse();
        const target = lastSectionBeforeContactDetail || 'contact';
        $w(`#section${target}`).expand();
        activeSection = target;
        contactDetailStatus = null;
        contactDetailType = null;
        contactDetailRaw = null;
        saveHandler = null;
    });
}

async function handleOwnerDeleteOrCancel(owner, isPending) {
    try {
        const res = await deleteOwnerOrCancel(owner._id, isPending);
        if (!res?.ok) return;
        await refetchContactAfterWrite();
    } catch (err) {
        console.error('OWNER DELETE ERROR', err);
    }
}

async function handleTenantDeleteOrCancel(tenant, isPending) {
    try {
        const res = await deleteTenantOrCancel(tenant._id, isPending);
        if (!res?.ok) return;
        await refetchContactAfterWrite();
    } catch (err) {
        console.error('TENANT DELETE ERROR', err);
    }
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}
