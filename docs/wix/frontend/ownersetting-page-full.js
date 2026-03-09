/* =======================
   import — 门禁 backend/access/manage；业务 backend/saas/ownersetting；Topup backend/saas/topup
   列表业主名（如 Lim ye yong）来源：MySQL ownerdetail.ownername，由 getOwnerList 返回 ownername: { ownerName }。
======================= */
import wixLocation from 'wix-location';
import { getAccessContext } from 'backend/access/manage';
import { getMyBillingInfo, getCreditPlans, startNormalTopup } from 'backend/saas/topup';
import { submitTicket } from 'backend/saas/help';
import {
    getOwnerList,
    searchOwnerByEmail,
    getPropertyById,
    getPropertiesWithoutOwner,
    saveOwnerInvitation,
    deleteOwnerFromProperty,
    removeOwnerMapping
} from 'backend/saas/ownersetting';

/* =======================
   let
======================= */
let accessCtx = null;
let activeSection = null;
let lastSectionBeforeTopup = 'owner';
let topupInited = false;
let selectedTopupPlanId = null;
let selectedTopupPlanCache = null;
let lastSectionBeforeCreateOwner = 'owner';
let editingPendingContext = null;

let topupRepeaterBound = false;
let topupCheckoutBound = false;
let topupCloseBound = false;
let ownerListEventsBound = false;
let sectionSwitchBound = false;
let defaultSectionCollapsed = false;

let clientCurrency = 'MYR';

/* =======================
   Owner List State (cache + filter like expenses)
======================= */
let ownerListPageSize = 10;
let ownerListLoading = false;
let ownerSearchKeyword = '';
let ownerCache = [];
let ownerCacheTotal = 0;
let useServerFilter = false;
let currentOwnerPage = 1;

const OWNER_CACHE_LIMIT = 2000;

/* =======================
   const
======================= */
const MAIN_SECTIONS = ['owner', 'createowner', 'topup'];

/* =======================
   onReady
======================= */
$w.onReady(() => {
    disableMainActions();
    initDefaultSection();
    startInitAsync();
});

function bindOwnerListEvents() {
    if (ownerListEventsBound) return;
    ownerListEventsBound = true;

    let searchDebounce = null;
    $w('#inputlistowner').onInput(() => {
        ownerSearchKeyword = ($w('#inputlistowner').value || '').trim();
        if (searchDebounce) clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            searchDebounce = null;
            currentOwnerPage = 1;
            $w('#paginationlistowner').currentPage = 1;
            initOwnerList(1);
        }, 300);
    });

    $w('#paginationlistowner').onChange((e) => {
        initOwnerList(e.target.currentPage);
    });
}

function bindTopupCloseButton() {
    if (topupCloseBound) return;
    topupCloseBound = true;
    $w('#buttontopupclose').onClick(() => {
        $w('#sectiontopup').collapse();
        const target = lastSectionBeforeTopup || 'owner';
        if (target === 'default') {
            initDefaultSection();
            activeSection = null;
        } else {
            $w(`#section${target}`).expand();
            activeSection = target;
        }
    });
}

function bindProblemBoxClose() {
    $w('#buttoncloseproblem2').onClick(() => {
        $w('#boxproblem2').hide();
    });
}

async function loadOwnerFiltersForCreateOwner() {
    await loadPropertiesWithoutOwnerForDropdown();
}

async function loadPropertiesWithoutOwnerForDropdown() {
    const res = await getPropertiesWithoutOwner();
    if (res.ok === false) return;
    const items = res.items || [];
    $w('#dropdownproperty').options = items.map((p) => ({
        label: p.shortname || p._id || p.id,
        value: p._id || p.id
    }));
    if (items.length) $w('#dropdownproperty').expand();
}

async function doSearchOwnerByEmail(keyword) {
    const res = await searchOwnerByEmail(keyword);
    if (res.ok === false || !res.items) return false;
    $w('#checkboxgroupuser').options = res.items.map((o) => ({
        label: `${o.email || ''} | ${o.ownerName || ''}`,
        value: o._id || o.id
    }));
    return true;
}

async function doSaveOwnerInvitation() {
    const btn = $w('#buttonsave');
    btn.disable();
    btn.label = editingPendingContext ? 'Updating...' : 'Binding...';

    try {
        const ownerIdVal = $w('#checkboxgroupuser').value?.[0];
        const propertyId = $w('#dropdownproperty').value;
        const emailVal = ($w('#inputemailsearch').value || '').trim();

        if (!propertyId) {
            btn.enable();
            btn.label = editingPendingContext ? 'Update' : 'Bind Owner';
            return;
        }

        const payload = { propertyId, email: emailVal };
        if (ownerIdVal && !String(ownerIdVal).includes('@')) {
            payload.ownerId = ownerIdVal;
        } else if (ownerIdVal) {
            payload.email = ownerIdVal;
        }
        if (editingPendingContext) {
            payload.editingPendingContext = {
                propertyId: editingPendingContext.propertyId,
                pendingOwner: editingPendingContext.pendingOwner
            };
        }

        const res = await saveOwnerInvitation(payload);
        if (res && res.ok !== false) {
            await refetchOwnerListAfterWrite();
            resetCreateOwnerSection(true);
            editingPendingContext = null;
            $w('#sectioncreateowner').collapse();
            $w(`#section${lastSectionBeforeCreateOwner}`).expand();
            activeSection = lastSectionBeforeCreateOwner;
        }
    } finally {
        btn.enable();
        btn.label = editingPendingContext ? 'Update' : 'Bind Owner';
    }
}

function bindCreateOwnerEvents() {
    let emailSearchTimer = null;

    $w('#sectioncreateowner').onViewportEnter(async () => {
        if (!editingPendingContext) return;
        const { propertyId } = editingPendingContext;
        resetCreateOwnerSection(false);

        await loadPropertiesWithoutOwnerForDropdown();
        const propRes = await getPropertiesWithoutOwner();
        const items = (propRes.ok !== false && propRes.items) ? propRes.items : [];
        $w('#dropdownproperty').options = items.map((p) => ({
            label: p.shortname || p._id || p.id,
            value: p._id || p.id
        }));
        $w('#dropdownproperty').value = propertyId;

        const property = await getPropertyById(propertyId);
        if (property && property.percentage != null) {
            $w('#textsummary').text = `Management Sharing: ${property.percentage}%`;
            $w('#textsummary').expand();
        }
        $w('#dropdownproperty').expand();
        $w('#buttonsave').label = 'Update';
        $w('#buttonsave').expand();
    });

    $w('#inputemailsearch').onInput(() => {
        if (editingPendingContext) return;
        clearTimeout(emailSearchTimer);
        resetCreateOwnerSection(false);
        const raw = ($w('#inputemailsearch').value || '').trim();
        if (!raw) return;
        emailSearchTimer = setTimeout(async () => {
            const found = await doSearchOwnerByEmail(raw.toLowerCase());
            await loadPropertiesWithoutOwnerForDropdown();
            $w('#dropdownproperty').expand();
            if (found) {
                $w('#checkboxgroupuser').expand();
            } else {
                $w('#textsummary').text =
                    '新屋主（尚未批准）\nEmail: ' + raw + '\n\n保存后将创建该屋主并发送邀请。';
                $w('#textsummary').expand();
                $w('#checkboxgroupuser').options = [{ label: raw + ' (新屋主)', value: raw }];
                try { $w('#checkboxgroupuser').value = [raw]; } catch (_) {}
                $w('#checkboxgroupuser').expand();
            }
            $w('#buttonsave').expand();
        }, 500);
    });

    $w('#dropdownproperty').onChange(async () => {
        const propertyId = $w('#dropdownproperty').value;
        if (!propertyId) return;
        const property = await getPropertyById(propertyId);
        if (property && property.percentage != null) {
            $w('#textsummary').text = `Management Sharing: ${property.percentage}%`;
            $w('#textsummary').expand();
        }
        $w('#buttonsave').expand();
    });

    $w('#buttonsave').onClick(doSaveOwnerInvitation);

    $w('#buttonclosecreateowner').onClick(() => {
        editingPendingContext = null;
        $w('#sectioncreateowner').collapse();
        $w(`#section${lastSectionBeforeCreateOwner}`).expand();
        activeSection = lastSectionBeforeCreateOwner;
    });
}

/* =======================
   init flow
======================= */
async function startInitAsync() {
    try {
        accessCtx = await getAccessContext();

        if (!accessCtx?.ok) {
            showAccessDenied(accessCtx.reason === 'NO_PERMISSION' ? "You don't have permission" : "You don't have account yet");
            return;
        }
        if (!accessCtx.staff?.permission?.propertylisting && !accessCtx.staff?.permission?.admin) {
            showAccessDenied("You don't have permission");
            return;
        }

        clientCurrency = String(accessCtx.client?.currency || 'MYR').toUpperCase();

        if (accessCtx.credit?.ok === false) {
            await enterForcedTopupMode();
            return;
        }

        bindSectionSwitch();
        bindTopupCloseButton();
        bindCreateOwnerEvents();

        $w('#textstatusloading').hide();
        enableMainActions();
    } catch (err) {
        console.error('[OWNER INIT FAILED]', err);
        showAccessDenied('Unable to verify account');
    }
    bindProblemBoxClose();
}

/* =======================
   Enter Owner Section
======================= */
async function enterOwnerSection() {
    $w('#inputlistowner').value = '';
    ownerSearchKeyword = '';
    invalidateOwnerCache();
    bindOwnerListEvents();
    await initOwnerList(1);
}

function setupTopupProblemBox(amount) {
    let text = `
Your top up amount is more than ${clientCurrency} 1000
The top up amount: ${clientCurrency} ${amount}

Please transfer to:
Public Bank Account
Coliving Management Sdn Bhd
3240130500

Please drop your receipt to our customer services:
📞 6019-857 9627
`;
    $w('#textproblem').text = text.trim();
}

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
            const id = plan.id || plan._id;
            const sellingprice = plan.sellingprice != null ? plan.sellingprice : 0;
            const credit = plan.credit != null ? plan.credit : 0;
            $item('#textamount').text = `${clientCurrency} ${sellingprice}`;
            $item('#textcreditamount').text = String(credit);
            $item('#boxcolor').hide();
            $item('#containertopup').onClick(() => {
                selectedTopupPlanId = id;
                selectedTopupPlanCache = plan;
                $w('#repeatertopup').forEachItem(($i) => $i('#boxcolor').hide());
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
                    console.warn('[ownersetting] submitTicket topup_manual failed', e);
                }
                return;
            }
            const res = await startNormalTopup({
                creditPlanId: selectedTopupPlanId,
                redirectUrl: wixLocation.url
            });
            if (res && res.url) wixLocation.to(res.url);
        });
        topupCheckoutBound = true;
    }
}

function resetCreateOwnerSection(resetInput = false) {
    if (resetInput) {
        $w('#inputemailsearch').value = '';
    }
    $w('#checkboxgroupuser').collapse();
    $w('#dropdownproperty').collapse();
    $w('#textsummary').collapse();
    $w('#buttonsave').collapse();
    try {
        $w('#checkboxgroupuser').value = [];
    } catch (_) {}
    try {
        $w('#dropdownproperty').value = null;
    } catch (_) {}
}

/* =======================
   Section Switch
======================= */
function bindSectionSwitch() {
    if (sectionSwitchBound) return;
    sectionSwitchBound = true;

    $w('#buttonowner').onClick(async () => {
        const btn = $w('#buttonowner');
        const origLabel = typeof btn.label !== 'undefined' ? btn.label : 'Owner';
        btn.disable();
        if (typeof btn.label !== 'undefined') btn.label = 'Loading...';
        try {
            await enterOwnerSection();
            collapseDefaultAndShowTab();
            await switchSectionAsync('owner');
        } finally {
            btn.enable();
            if (typeof btn.label !== 'undefined') btn.label = origLabel;
        }
    });

    $w('#buttoncreateowner').onClick(async () => {
        const btn = $w('#buttoncreateowner');
        const origLabel = typeof btn.label !== 'undefined' ? btn.label : 'Create Owner';
        btn.disable();
        if (typeof btn.label !== 'undefined') btn.label = 'Loading...';
        try {
            lastSectionBeforeCreateOwner = activeSection || 'owner';
            collapseDefaultAndShowTab();
            await switchSectionAsync('createowner');
            resetCreateOwnerSection(true);
        } finally {
            btn.enable();
            if (typeof btn.label !== 'undefined') btn.label = origLabel;
        }
    });

    $w('#buttontopup').onClick(async () => {
        const btn = $w('#buttontopup');
        const origLabel = typeof btn.label !== 'undefined' ? btn.label : 'Topup';
        btn.disable();
        if (typeof btn.label !== 'undefined') btn.label = 'Loading...';
        try {
            lastSectionBeforeTopup = (activeSection != null && activeSection !== '') ? activeSection : 'default';
            if (!topupInited) {
                await initTopupSection();
                topupInited = true;
            }
            collapseDefaultAndShowTab();
            await switchSectionAsync('topup');
        } finally {
            btn.enable();
            if (typeof btn.label !== 'undefined') btn.label = origLabel;
        }
    });
}

async function switchSectionAsync(sectionKey) {
    if (activeSection === sectionKey) return;
    collapseAllSections();
    $w(`#section${sectionKey}`).expand();
    activeSection = sectionKey;
}

/* =======================
   Section Helpers
======================= */
function collapseAllSections() {
    MAIN_SECTIONS.forEach(k => {
        $w(`#section${k}`)?.collapse();
    });
}

function initDefaultSection() {
    defaultSectionCollapsed = false;
    $w('#sectionheader').expand();
    $w('#sectiondefault').expand();
    $w('#sectiontab').expand();
    collapseAllSections();
}

function collapseDefaultAndShowTab() {
    $w('#sectiondefault').collapse();
    defaultSectionCollapsed = true;
}

function showLoading() {
    $w('#text19').text = 'Loading...';
    $w('#text19').show();
}

function hideLoading() {
    $w('#text19').hide();
}

/* =======================
   Permission / UI
======================= */
function disableMainActions() {
    ['#buttonowner', '#buttoncreateowner', '#buttontopup'].forEach(id => {
        const el = $w(id);
        if (el && typeof el.disable === 'function') el.disable();
    });
}

function enableMainActions() {
    ['#buttonowner', '#buttoncreateowner', '#buttontopup'].forEach(id => {
        const el = $w(id);
        if (el && typeof el.enable === 'function') el.enable();
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
async function enterForcedTopupMode() {
    collapseAllSections();
    collapseDefaultAndShowTab();
    $w('#sectiontopup').expand();
    activeSection = 'topup';
}

/* =======================
   Owner List — cache + filter (like expenses)
======================= */
/** Fetch list; when limit set, fill cache (no search). When total > limit, useServerFilter = true. */
async function fetchAndFillOwnerCache() {
    const res = await getOwnerList({
        limit: OWNER_CACHE_LIMIT
    });
    if (res.ok === false) {
        ownerCache = [];
        ownerCacheTotal = 0;
        useServerFilter = true;
        return;
    }
    const total = res.total || 0;
    const items = res.items || [];
    if (total <= OWNER_CACHE_LIMIT) {
        ownerCache = items;
        ownerCacheTotal = total;
        useServerFilter = false;
    } else {
        ownerCache = [];
        ownerCacheTotal = total;
        useServerFilter = true;
    }
}

function getCurrentOwnerFilterOpts() {
    return {
        search: (typeof $w('#inputlistowner').value !== 'undefined' ? $w('#inputlistowner').value : ownerSearchKeyword) || ''
    };
}

/** Apply filter: useServerFilter ? load from server : filter cache + paginate. */
function applyOwnerFilterAndSort() {
    if (useServerFilter) {
        loadOwnerPageFromServer(currentOwnerPage);
        return;
    }
    applyOwnerFilterToCache();
}

/** Front-end: filter cache by search, then paginate. */
function applyOwnerFilterToCache() {
    const opts = getCurrentOwnerFilterOpts();
    let list = ownerCache;
    if (opts.search && opts.search.trim()) {
        const s = opts.search.trim().toLowerCase();
        list = list.filter(
            (it) =>
                (it.ownername?.ownerName || '').toLowerCase().includes(s) ||
                (it.propertiesLabel || '').toLowerCase().includes(s) ||
                (it.__pending && 'pending owner'.includes(s))
        );
    }
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / ownerListPageSize));
    if (currentOwnerPage > totalPages) currentOwnerPage = totalPages;
    const start = (currentOwnerPage - 1) * ownerListPageSize;
    const pageItems = list.slice(start, start + ownerListPageSize);
    $w('#paginationlistowner').totalPages = totalPages;
    $w('#paginationlistowner').currentPage = currentOwnerPage;
    $w('#repeaterlistowner').data = pageItems;
}

/** Server pagination. */
async function loadOwnerPageFromServer(pageNumber) {
    currentOwnerPage = pageNumber;
    const opts = getCurrentOwnerFilterOpts();
    showLoading();
    const res = await getOwnerList({
        search: opts.search || undefined,
        page: currentOwnerPage,
        pageSize: ownerListPageSize
    });
    hideLoading();
    if (res.ok === false) {
        $w('#repeaterlistowner').data = [];
        return;
    }
    const items = res.items || [];
    $w('#paginationlistowner').totalPages = res.totalPages || 1;
    $w('#paginationlistowner').currentPage = res.currentPage || 1;
    $w('#repeaterlistowner').data = items;
}

async function initOwnerList(page = 1) {
    if (ownerListLoading) return;
    ownerListLoading = true;
    try {
        currentOwnerPage = page;
        if (ownerCache.length === 0 && !useServerFilter) {
            await fetchAndFillOwnerCache();
        }
        applyOwnerFilterAndSort();
    } finally {
        ownerListLoading = false;
    }
}

function invalidateOwnerCache() {
    ownerCache = [];
    ownerCacheTotal = 0;
    useServerFilter = false;
}

async function refetchOwnerListAfterWrite() {
    invalidateOwnerCache();
    showLoading();
    await fetchAndFillOwnerCache();
    currentOwnerPage = 1;
    applyOwnerFilterAndSort();
    hideLoading();
}

/* =======================
   Repeater Owner — item = one owner, label = ownername | property A, property B (only this client's properties)
   #buttonedit: enabled only when isPending (pending invitation row).
   #buttondelete: first click → "Confirm Delete", second click → disconnect mapping (see below).

   Disconnect mapping (第二次点击 #buttondelete) 包括：
   1) 若该业主下有物业：先 deleteOwnerFromProperty(propertyId)
      → 后端：propertydetail.owner_id = null，并 DELETE owner_property 对应行。
   2) 若该业主在本 client 下只剩这一间物业（onlyOneProperty）：再 removeOwnerMapping(ownerId)
      → 后端：DELETE FROM owner_client WHERE client_id = ? AND owner_id = ?。
   3) 若该业主下没有物业：只做 removeOwnerMapping(ownerId)。
   完成后 refetchOwnerListAfterWrite() 刷新 #repeaterlistowner；若 API 失败会恢复按钮并打 log。
======================= */
$w('#repeaterlistowner').onItemReady(($item, item) => {
    const isPending = item.__pending === true;
    const isComplete = !!item.ownername && !isPending;
    const ownerName = item.ownername?.ownerName || 'Owner';
    const propertiesLabel = item.propertiesLabel || (item.properties && item.properties.length ? item.properties.map((p) => p.shortname).join(', ') : '—');
    const label = `${ownerName} | ${propertiesLabel}`;

    $item('#textlistviewowner').text = label;
    $item('#textlistviewowner').style.color = '#000000';
    $item('#buttonedit').disable();
    $item('#buttondelete').enable();

    if (isPending) {
        $item('#textlistviewowner').style.color = '#D32F2F';
        $item('#buttonedit').enable();
        $item('#buttondelete').disable();
    }

    const firstPropertyId = item.properties && item.properties[0] ? item.properties[0].id : null;
    const ownerId = item._id || item.id;

    $item('#buttonedit').onClick(() => {
        if (isComplete) return;
        lastSectionBeforeCreateOwner = activeSection || 'owner';
        const editPropertyId = firstPropertyId || (item.properties && item.properties[0] ? item.properties[0].id : null);
        editingPendingContext = {
            propertyId: editPropertyId,
            pendingOwner: item.__pendingOwner
        };
        collapseDefaultAndShowTab();
        switchSectionAsync('createowner');
        if (item.__pendingOwner?.email) {
            $w('#inputemailsearch').value = item.__pendingOwner.email;
        }
    });

    let confirmDelete = false;
    $item('#buttondelete').label = 'Delete';
    $item('#buttondelete').onClick(async () => {
        if (!isComplete) return;
        if (!confirmDelete) {
            confirmDelete = true;
            $item('#buttondelete').label = 'Confirm Delete';
            return;
        }
        $item('#buttondelete').disable();
        $item('#buttondelete').label = 'Deleting...';
        try {
            let res = { ok: true };
            if (firstPropertyId) {
                res = await deleteOwnerFromProperty(firstPropertyId);
                const onlyOneProperty = (item.properties && item.properties.length === 1);
                if (res && res.ok !== false && onlyOneProperty) {
                    res = await removeOwnerMapping(ownerId);
                }
            } else {
                res = await removeOwnerMapping(ownerId);
            }
            if (res && res.ok !== false) {
                await refetchOwnerListAfterWrite();
            } else {
                console.warn('[ownersetting] Delete/disconnect failed:', res?.reason || res);
                confirmDelete = false;
                $item('#buttondelete').label = 'Delete';
                $item('#buttondelete').enable();
            }
        } catch (err) {
            console.error('[ownersetting] Delete/disconnect error:', err);
            confirmDelete = false;
            $item('#buttondelete').label = 'Delete';
            $item('#buttondelete').enable();
        } finally {
            resetAllOwnerDeleteButtons();
        }
    });
});

function resetAllOwnerDeleteButtons() {
    try {
        const repeater = $w('#repeaterlistowner');
        if (repeater && typeof repeater.forEachItem === 'function') {
            repeater.forEachItem(($i, row) => {
                if (row.ownername && !row.__pending) {
                    $i('#buttondelete').label = 'Delete';
                    $i('#buttondelete').enable();
                }
            });
        }
    } catch (_) {}
}
