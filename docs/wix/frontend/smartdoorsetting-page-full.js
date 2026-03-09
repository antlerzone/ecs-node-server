/* ======================================================
   SMART DOOR PAGE – 前端 Wix + 后端 ECS (backend/saas/smartdoorsetting + backend/saas/topup)
   - 列表/筛选/详情/更新/新增门锁与网关均走 backend/saas/smartdoorsetting，不读 Wix CMS。
   - Topup 使用 backend/saas/topup：getMyBillingInfo、getCreditPlans、startNormalTopup。
   - 列表采用 expenses 模式：cache + services filter（先 limit 拉全量入 cache，若 total>limit 则走 server 分页）。
====================================================== */

import { getAccessContext } from 'backend/access/manage';
import wixLocation from 'wix-location';
import wixWindow from 'wix-window';
import { getMyBillingInfo, getCreditPlans, startNormalTopup } from 'backend/saas/topup';
import { submitTicket } from 'backend/saas/help';
import {
    getSmartDoorList,
    getSmartDoorFilters,
    getLock,
    getGateway,
    updateLock,
    updateGateway,
    previewSmartDoorSelection,
    syncTTLockName,
    getSmartDoorIdsByProperty,
    resolveSmartDoorLocationLabel,
    getChildLockOptions,
    insertSmartDoors
} from 'backend/saas/smartdoorsetting';

/* ======================================================
   GLOBAL STATE
====================================================== */
let dropdownParentBound = false;
let currentChildOptions = [];
let paginationBound = false;
let topupRepeaterBound = false;
let topupCheckoutBound = false;
let topupCloseBound = false;
let selectedTopupPlanId = null;
let selectedTopupPlanCache = null;

let newSmartDoorRepeaterBound = false;
let currentDetailSmartDoor = null;
let childRepeaterBound = false;
/** 第一次点 Add 只 show repeater + 拉 options；第二次点才加 item */
let childRepeaterShownAndLoaded = false;
/** 已綁定過 close/onChange 的 row._id，避免重複綁定導致 remove 觸發多次 */
const childRepeaterBoundIds = new Set();

let listViewLoading = false;
let listViewFilterBound = false;
let searchTimer = null;
let newSmartDoorBound = false;

let listViewPageSize = 20;
let activeSection = null;
let lastSectionBeforeTopup = 'default';
let lastSectionBeforeNewSmartDoor = 'listview';

let clientCurrency = 'MYR';
let topupInited = false;

let accessCtx = null;
let currentClientId = null;
let __pageInitOnce = false;
let mobileMenuBound = false;

/** 前端缓存：当前筛选下的全量（最多 SMART_DOOR_CACHE_LIMIT）；若 total>limit 则走 server 分页 */
let smartDoorCache = [];
let smartDoorCacheTotal = 0;
let useServerFilter = false;
const SMART_DOOR_CACHE_LIMIT = 2000;
let currentListViewPage = 1;

/* ======================================================
   SECTIONS
====================================================== */

/** 只 collapse 内容区；sectiontab / sectionheader 不放入，进入非 default 时会 expand 并一直保持 */
const PAGE_SECTIONS = [
    '#sectionlistview',
    '#sectiontopup',
    '#sectiondetail',
    '#sectionnewsmartdoor'
];

/* ======================================================
   LIST VIEW FILTER STATE
====================================================== */

const listViewFilterState = {
    keyword: '',
    propertyId: 'ALL',
    filter: 'ALL'
};

/* ======================================================
   onReady
====================================================== */

$w.onReady(() => {
    if (__pageInitOnce) return;
    __pageInitOnce = true;

    $w('#sectiondefault').expand();
    if (wixWindow.formFactor !== 'Mobile') $w('#sectiontab').expand(); else $w('#sectiontab').collapse();
    $w('#sectionheader').expand();
    $w('#sectiontopup').collapse();
    $w('#sectionnewsmartdoor').collapse();
    $w('#sectiondetail').collapse();
    $w('#sectionlistview').collapse();

    activeSection = 'default';

    if (wixWindow.formFactor === 'Mobile') {
        $w('#buttonmobilemenu')?.show();
        $w('#buttonmobilemenu')?.enable();
        $w('#boxmobilemenu')?.hide();
        $w('#boxmobilemenu')?.collapse();
        // Only nav buttons in mobile menu need disable until startInit done; #buttonmobilemenu stays clickable
        $w('#buttonsmartdoor2')?.disable();
        $w('#buttonnewsmartdoor2')?.disable();
        bindMobileMenu();
    } else {
        $w('#buttonmobilemenu')?.hide();
        $w('#boxmobilemenu')?.hide();
    }
    $w('#buttonsmartdoor')?.disable();
    $w('#buttonnewsmartdoor')?.disable();
    $w('#buttontopup')?.disable();

    startInitAsync();
});

/* ======================================================
   INIT
====================================================== */

async function startInitAsync() {
    try {
        accessCtx = await getAccessContext();

        if (!accessCtx?.ok) {
            showAccessDenied(accessCtx.reason === 'NO_PERMISSION' ? "You don't have permission" : "You don't have account yet");
            return;
        }

        if (!accessCtx.client?.active) {
            showAccessDenied("You don't have account yet");
            return;
        }

        currentClientId = accessCtx.client.id;
        clientCurrency = String(accessCtx.client.currency || 'MYR').toUpperCase();

        await initListViewPropertyFilter();

        if (accessCtx.credit?.ok === false) {
            enableTopupOnly();
            return;
        }

        if (
            !accessCtx.staff.permission.propertylisting &&
            !accessCtx.staff.permission.admin
        ) {
            showAccessDenied("You don't have permission");
            return;
        }

        $w('#buttonsmartdoor').onClick(() => goToSmartDoorList($w('#buttonsmartdoor')));

    } catch (e) {
        showAccessDenied('Unable to verify account');
        return;
    }

    $w('#buttontopup').onClick(async () => {
        lastSectionBeforeTopup = activeSection || 'default';
        if (!topupInited) {
            await initTopupSection();
            topupInited = true;
        }
        await switchSectionAsync('sectiontopup');
    });

    /* filter: LOCK=仅门锁, GATEWAY=仅网关, ACTIVE/INACTIVE=仅门锁按状态, ALL=全部 */
    $w('#dropdownfilter').options = [
        { label: 'All', value: 'ALL' },
        { label: 'Smart Door', value: 'LOCK' },
        { label: 'Gateway', value: 'GATEWAY' },
        { label: 'Active', value: 'ACTIVE' },
        { label: 'Inactive', value: 'INACTIVE' }
    ];
    $w('#dropdownfilter').value = 'ALL';
    listViewFilterState.filter = 'ALL';

    $w('#buttonclosedetail2').onClick(async () => {
        currentDetailSmartDoor = null;
        await switchSectionAsync('sectionlistview');
    });

    $w('#buttonaddchildsmartdoor').onClick(async () => {
        if (!currentDetailSmartDoor || currentDetailSmartDoor.__type !== 'lock') return;
        $w('#buttonaddchildsmartdoor').disable();
        $w('#repeaterchildsmartdoor').forEachItem(($i) => { $i('#buttonclosechildsmartdoor').disable(); });
        if (!childRepeaterShownAndLoaded) {
            childRepeaterShownAndLoaded = true;
            $w('#repeaterchildsmartdoor').show();
            try {
                const res = await getChildLockOptions(currentDetailSmartDoor._id);
                currentChildOptions = Array.isArray(res?.options) ? res.options : [];
            } catch (e) {
                currentChildOptions = [];
            }
            const firstRow = { _id: `row_${Date.now()}`, doorId: null, __options: currentChildOptions || [] };
            $w('#repeaterchildsmartdoor').data = [firstRow];
            applyChildDropdownOptionsToRepeater();
            return;
        }
        const oldData = $w('#repeaterchildsmartdoor').data || [];
        const newRow = { _id: `row_${Date.now()}`, doorId: null, __options: currentChildOptions || [] };
        $w('#repeaterchildsmartdoor').data = [...oldData, newRow];
        applyChildDropdownOptionsToRepeater();
    });

    $w('#buttonupdatebox').onClick(async () => {
        if (!currentDetailSmartDoor) return;

        $w('#buttonupdatebox').label = 'Updating...';
        $w('#buttonupdatebox').disable();

        try {
            const newName = ($w('#inputdetailsmartdoorname').value || '').trim();
            if (!newName) return;

            if (currentDetailSmartDoor.__type === 'lock') {
                const updated = await getLock(currentDetailSmartDoor._id);
                if (!updated) return;
                const oldName = updated.lockAlias || '';
                const childIds = [];
                $w('#repeaterchildsmartdoor').forEachItem(($item) => {
                    const v = $item('#dropdownchildsmartdoor').value;
                    if (v && v !== '__none__' && v !== 'none') childIds.push(v);
                });
                await updateLock(currentDetailSmartDoor._id, { lockAlias: newName, childmeter: childIds });
                if (newName !== oldName && updated.brand === 'ttlock') {
                    await syncTTLockName({
                        type: 'lock',
                        externalId: String(updated.lockId),
                        name: newName
                    });
                }
            }

            if (currentDetailSmartDoor.__type === 'gateway') {
                const updated = await getGateway(currentDetailSmartDoor._id);
                if (!updated) return;
                const oldName = updated.gatewayName || '';
                await updateGateway(currentDetailSmartDoor._id, { gatewayName: newName });
                if (newName !== oldName) {
                    await syncTTLockName({
                        type: 'gateway',
                        externalId: String(updated.gatewayId),
                        name: newName
                    });
                }
            }

            invalidateSmartDoorCache();
            await switchSectionAsync('sectionlistview');
            await reloadListView(1);
        } catch (e) {
        } finally {
            $w('#buttonupdatebox').label = 'Update';
            $w('#buttonupdatebox').enable();
        }
    });

    $w('#buttonsmartdoor').enable();
    $w('#buttonnewsmartdoor').enable();
    $w('#buttontopup').enable();
    $w('#textstatusloading').hide();
    bindNewSmartDoorButton();
    bindListViewFilters();
    bindDropdownParentOnce();
    bindTopupCloseButton();
    bindProblemBoxClose();
    bindPaginationOnce();

    if (wixWindow.formFactor === 'Mobile') {
        $w('#buttonsmartdoor')?.hide();
        $w('#buttonnewsmartdoor')?.hide();
        $w('#buttonmobilemenu')?.expand();
        $w('#buttonmobilemenu')?.show();
        $w('#buttonsmartdoor2')?.enable();
        $w('#buttonnewsmartdoor2')?.enable();
        bindMobileMenu();
    } else {
        $w('#buttonmobilemenu')?.hide();
        $w('#boxmobilemenu')?.hide();
    }
}

/* ======================================================
   ACCESS / STATUS
====================================================== */

function showAccessDenied(message) {
    $w('#sectiondefault').expand();
    $w('#textstatusloading').show();
    $w('#textstatusloading').text = message || 'Access denied';
}

function enableTopupOnly() {
    $w('#buttontopup').enable();
    $w('#textstatusloading').show();
    $w('#textstatusloading').text = 'Insufficient credit. Please top up to continue.';
    switchSectionAsync('sectiontopup');
}

/* ======================================================
   TOP UP (backend/saas/topup)
====================================================== */

async function initTopupSection() {
    const billing = await getMyBillingInfo();
    const credits = Array.isArray(billing?.credit) ? billing.credit : [];
    const totalCredit = credits.reduce((s, c) => s + Number(c.amount || 0), 0);
    $w('#textcurrentcredit').text = `Current Credit Balance: ${totalCredit}`;

    const plans = await getCreditPlans();
    $w('#repeatertopup').data = Array.isArray(plans) ? plans : [];

    if (!topupRepeaterBound) {
        $w('#repeatertopup').onItemReady(($item, plan) => {
            $item('#textamount').text = `${clientCurrency} ${plan.sellingprice ?? plan.sellingPrice ?? 0}`;
            $item('#textcreditamount').text = String(plan.credit ?? 0);
            $item('#textcredit').text = 'Credits';
            $item('#boxcolor').hide();
            $item('#containertopup').onClick(() => {
                selectedTopupPlanId = plan._id || plan.id;
                selectedTopupPlanCache = plan;
                $w('#repeatertopup').forEachItem($i => { $i('#boxcolor').hide(); });
                $item('#boxcolor').show();
            });
        });
        topupRepeaterBound = true;
    }

    if (!topupCheckoutBound) {
        $w('#buttoncheckout').onClick(async () => {
            if (!selectedTopupPlanCache) return;
            const amount = Number(selectedTopupPlanCache.sellingprice ?? selectedTopupPlanCache.sellingPrice ?? 0);
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
                    console.warn('[smartdoorsetting] submitTicket topup_manual failed', e);
                }
                return;
            }
            $w('#buttoncheckout').disable();
            try {
                const res = await startNormalTopup({
                    creditPlanId: selectedTopupPlanId,
                    redirectUrl: wixLocation.url
                });
                if (res?.url) wixLocation.to(res.url);
            } finally {
                $w('#buttoncheckout').enable();
            }
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
        await switchSectionAsync(`section${lastSectionBeforeTopup}`);
    });
}

/* ======================================================
   SECTION SWITCH
====================================================== */

/** Shared nav: go to smart door list (used by #buttonsmartdoor and #buttonsmartdoor2). */
async function goToSmartDoorList(btn) {
    btn = btn || $w('#buttonsmartdoor');
    const originalLabel = (btn.label != null) ? btn.label : 'Smart Door';
    btn.label = 'Loading';
    btn.disable();
    try {
        await reloadListView(1);
        await switchSectionAsync('sectionlistview');
        if (smartDoorCache.length > 0 || useServerFilter) {
            await safeWait(waitRepeaterRendered('#repeatersmartdoor'), 1200);
        }
    } finally {
        btn.enable();
        if (btn.label != null) btn.label = originalLabel;
    }
}

/** Shared nav: go to new smart door section (used by #buttonnewsmartdoor and #buttonnewsmartdoor2). */
async function goToNewSmartDoorSection(btn) {
    btn = btn || $w('#buttonnewsmartdoor');
    btn.disable();
    const originalLabel = (btn.label != null) ? btn.label : 'Add Smart Door';
    btn.label = 'Loading';
    try {
        lastSectionBeforeNewSmartDoor = activeSection || 'listview';
        await initNewSmartDoorSection();
        await switchSectionAsync('sectionnewsmartdoor');
        activeSection = 'newsmartdoor';
    } finally {
        btn.enable();
        if (btn.label != null) btn.label = originalLabel;
    }
}

async function switchSectionAsync(sectionId) {
    if (sectionId !== 'sectiondefault') {
        $w('#sectiondefault').collapse();
    }
    collapseAllSections();
    if (sectionId !== 'sectiondefault') {
        if (wixWindow.formFactor !== 'Mobile') $w('#sectiontab').expand(); else $w('#sectiontab').collapse();
        $w('#sectionheader').expand();
    }
    $w(`#${sectionId}`)?.expand();
    activeSection = sectionId.replace('section', '');
    if (sectionId === 'sectionlistview') {
        if (smartDoorCache.length > 0 || useServerFilter) {
            if (useServerFilter) {
                await loadListViewFromServer(currentListViewPage);
            } else {
                applyFilterAndSortToCache();
            }
        } else {
            $w('#repeatersmartdoor').data = [];
        }
    }
}

function collapseAllSections() {
    PAGE_SECTIONS.forEach(id => { $w(id)?.collapse(); });
}

async function switchSectionWhenReady({ sectionId, wait }) {
    if (sectionId !== 'sectiondefault') {
        $w('#sectiondefault').collapse();
    }
    collapseAllSections();
    if (sectionId !== 'sectiondefault') {
        if (wixWindow.formFactor !== 'Mobile') $w('#sectiontab').expand(); else $w('#sectiontab').collapse();
        $w('#sectionheader').expand();
    }
    $w(`#${sectionId}`)?.expand();
    activeSection = sectionId.replace('section', '');
    if (sectionId === 'sectionlistview' && smartDoorCache.length === 0 && !useServerFilter) {
        $w('#repeatersmartdoor').data = [];
    }
    if (typeof wait === 'function') await wait();
}

/* ====================================================== MOBILE MENU (sectionheader: only show & expand on mobile) ====================================================== */
function bindMobileMenu() {
    if (mobileMenuBound) return;
    mobileMenuBound = true;
    let mobileMenuOpen = false;
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
    $w('#buttonsmartdoor2').onClick(async () => {
        await goToSmartDoorList($w('#buttonsmartdoor2'));
        $w('#boxmobilemenu').collapse();
        $w('#boxmobilemenu').hide();
        mobileMenuOpen = false;
    });
    $w('#buttonnewsmartdoor2').onClick(async () => {
        await goToNewSmartDoorSection($w('#buttonnewsmartdoor2'));
        $w('#boxmobilemenu').collapse();
        $w('#boxmobilemenu').hide();
        mobileMenuOpen = false;
    });
}

function setupTopupProblemBox(amount) {
    const text = `
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

function bindProblemBoxClose() {
    $w('#buttoncloseproblem2').onClick(() => { $w('#boxproblem2').hide(); });
}

/* ======================================================
   CACHE + SERVICES FILTER（与 expenses 页一致）
   - 先 limit 拉一页全量入 smartDoorCache；若 total>limit 则 useServerFilter=true 走 server 分页。
   - 有 cache 时切回 sectionlistview 只从 cache 恢复 repeater，不重复请求 table。
====================================================== */

function invalidateSmartDoorCache() {
    smartDoorCache = [];
    smartDoorCacheTotal = 0;
}

/** 首次进入列表或筛选变更：与 expenses 一致，拉全量入 cache 时用 filter=ALL，类型筛选在前端做；若 total>limit 则 useServerFilter=true 走 server 分页 */
async function fetchAndFillCache() {
    $w('#repeatersmartdoor').data = [];
    const res = await getSmartDoorList({
        keyword: listViewFilterState.keyword,
        propertyId: listViewFilterState.propertyId === 'ALL' ? undefined : listViewFilterState.propertyId,
        filter: 'ALL',
        limit: SMART_DOOR_CACHE_LIMIT
    });
    if (res && res.ok === false) {
        smartDoorCache = [];
        smartDoorCacheTotal = 0;
        useServerFilter = true;
        $w('#repeatersmartdoor').data = [];
        return;
    }
    const total = res.total || 0;
    const items = Array.isArray(res.items) ? res.items : [];
    if (total <= SMART_DOOR_CACHE_LIMIT) {
        smartDoorCache = items;
        smartDoorCacheTotal = total;
        useServerFilter = false;
    } else {
        smartDoorCache = [];
        smartDoorCacheTotal = total;
        useServerFilter = true;
    }
}

/** dropdownfilter 类型筛选：ALL=全部, LOCK=仅门锁, GATEWAY=仅网关, ACTIVE/INACTIVE=仅门锁按状态 */
function filterSmartDoorListByType(list, filterValue) {
    if (!filterValue || filterValue === 'ALL') return list;
    if (filterValue === 'LOCK') return list.filter(i => i.__type === 'lock');
    if (filterValue === 'GATEWAY') return list.filter(i => i.__type === 'gateway');
    if (filterValue === 'ACTIVE') return list.filter(i => i.__type === 'lock' && i.active === true);
    if (filterValue === 'INACTIVE') return list.filter(i => i.__type === 'lock' && i.active === false);
    return list;
}

/** 根据 useServerFilter 走前端过滤或 server 分页 */
async function applyFilterAndSort() {
    if (useServerFilter) {
        await loadListViewFromServer(currentListViewPage);
        return;
    }
    applyFilterAndSortToCache();
}

/** 前端：cache 按 keyword/propertyId 已拉取，此处按 dropdownfilter 做类型筛选 + 分页（与 expenses 一致） */
function applyFilterAndSortToCache() {
    const raw = Array.isArray(smartDoorCache) ? smartDoorCache : [];
    const list = filterSmartDoorListByType(raw, listViewFilterState.filter);
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / listViewPageSize));
    const start = (currentListViewPage - 1) * listViewPageSize;
    const pageItems = list.slice(start, start + listViewPageSize);
    $w('#repeatersmartdoor').data = pageItems;
    $w('#repeatersmartdoor').expand();
    $w('#paginationlistview').totalPages = totalPages;
    $w('#paginationlistview').currentPage = currentListViewPage;
}

/** Server 分页：直接请求当前页 */
async function loadListViewFromServer(page) {
    currentListViewPage = page;
    $w('#repeatersmartdoor').data = [];
    const res = await getSmartDoorList({
        keyword: listViewFilterState.keyword,
        propertyId: listViewFilterState.propertyId === 'ALL' ? undefined : listViewFilterState.propertyId,
        filter: listViewFilterState.filter,
        page: currentListViewPage,
        pageSize: listViewPageSize
    });
    if (res && res.ok === false) {
        $w('#repeatersmartdoor').data = [];
        return;
    }
    const items = Array.isArray(res.items) ? res.items : [];
    $w('#repeatersmartdoor').data = items;
    $w('#repeatersmartdoor').expand();
    $w('#paginationlistview').totalPages = res.totalPages || 1;
    $w('#paginationlistview').currentPage = res.currentPage || 1;
}

/* ======================================================
   LOAD LIST VIEW
====================================================== */

async function loadListView(page) {
    currentListViewPage = page;
    if (smartDoorCache.length === 0 && !useServerFilter) {
        await fetchAndFillCache();
    }
    await applyFilterAndSort();
}

async function reloadListView(page) {
    if (listViewLoading) return;
    listViewLoading = true;
    try {
        invalidateSmartDoorCache();
        await fetchAndFillCache();
        currentListViewPage = page || 1;
        await applyFilterAndSort();
    } finally {
        listViewLoading = false;
    }
}

/* ======================================================
   REPEATER RENDER
====================================================== */

$w('#repeatersmartdoor').onItemReady(($item, smartdoor) => {
    const titleEl = $item('#textsmartdoortitle');
    if (titleEl) {
        if (smartdoor.__type === 'lock') {
            const isParent = Array.isArray(smartdoor.childmeter) && smartdoor.childmeter.length > 0;
            const isChild = smartdoor.parentLockAlias;
            if (isParent) {
                titleEl.show();
                const names = smartdoor.childmeterAliases && smartdoor.childmeterAliases.length ? smartdoor.childmeterAliases : (smartdoor.childmeter || []);
                titleEl.text = 'Parent Lock | connect with lock ' + (Array.isArray(names) ? names.join(', ') : names);
            } else if (isChild) {
                titleEl.show();
                titleEl.text = 'Child lock | connect with lock ' + (smartdoor.parentLockAlias || '');
            } else {
                titleEl.hide();
            }
        } else {
            titleEl.text = 'gateway';
        }
    }

    if (smartdoor.__type === 'gateway') {
        $item('#textsmartdoorname').text = `${smartdoor.gatewayName} | ${smartdoor.gatewayId} [gateway]`;
        $item('#checkboxstatus')?.hide();
        const btn = $item('#buttonupdatedetail');
        if (btn) {
            btn.show();
            btn.onClick(async () => {
                currentDetailSmartDoor = smartdoor;
                await openSmartDoorDetailSection(smartdoor);
            });
        }
        const box = $item('#boxlistview');
        if (box) box.style.backgroundColor = smartdoor.isOnline === true ? '#e6f7f1' : '#fdeaea';
        return;
    }

    const gatewayLabel = smartdoor.hasGateway === true ? ' (Gateway connected)' : '';
    $item('#textsmartdoorname').text = `${smartdoor.lockAlias} | ${smartdoor.lockId}${gatewayLabel} [smartdoor]`;

    const checkbox = $item('#checkboxstatus');
    if (checkbox) {
        checkbox.show();
        checkbox.checked = smartdoor.active === true;
        checkbox.disable();
        checkbox.enable();
        checkbox.onChange(async () => {
            const newValue = checkbox.checked;
            checkbox.disable();
            try {
                await updateLock(smartdoor._id, { active: newValue });
                smartdoor.active = newValue;
            } catch (e) {
                checkbox.checked = !newValue;
            } finally {
                checkbox.enable();
            }
        });
    }

    const box = $item('#boxlistview');
    if (box) box.style.backgroundColor = smartdoor.isOnline === true ? '#e6f7f1' : '#fdeaea';

    const btn = $item('#buttonupdatedetail');
    if (btn) {
        btn.show();
        btn.onClick(async () => {
            currentDetailSmartDoor = smartdoor;
            await openSmartDoorDetailSection(smartdoor);
        });
    }
});

/* ======================================================
   NEW SMART DOOR ENTRY
====================================================== */

function bindNewSmartDoorButton() {
    if (newSmartDoorBound) return;
    newSmartDoorBound = true;

    $w('#buttonnewsmartdoor').onClick(() => goToNewSmartDoorSection($w('#buttonnewsmartdoor')));
    $w('#buttonclosenewsmartdoor').onClick(async () => {
        await switchSectionAsync('section' + lastSectionBeforeNewSmartDoor);
    });

    $w('#buttonsavedetail').onClick(async () => {
        $w('#buttonsavedetail').disable();
        try {
            const gatewaysToInsert = [];
            const locksToInsert = [];

            $w('#repeaternewsmartdoor').forEachItem(($item, itemData) => {
                if (!$item('#checkboxselection').checked) return;
                const alias = ($item('#inputname').value || '').trim();
                if (!alias) return;

                if (itemData.type === 'gateway') {
                    gatewaysToInsert.push({
                        gatewayId: Number(itemData.externalId),
                        gatewayName: alias,
                        networkName: itemData.networkName || '',
                        lockNum: itemData.lockNum || 0,
                        isOnline: Boolean(itemData.isOnline),
                        type: 'Gateway'
                    });
                }
                if (itemData.type === 'lock') {
                    locksToInsert.push({
                        __tmpGatewayExternalId: itemData.gatewayId || null,
                        lockId: Number(itemData.externalId),
                        lockName: itemData.lockName || '',
                        electricQuantity: Number(itemData.electricQuantity || 0),
                        type: 'Smartlock',
                        hasGateway: Boolean(itemData.hasGateway),
                        brand: 'ttlock',
                        lockAlias: alias,
                        active: Boolean(itemData.active),
                        gatewayId: itemData.gatewayId != null ? String(itemData.gatewayId) : null
                    });
                }
            });

            if (gatewaysToInsert.length === 0 && locksToInsert.length === 0) return;

            await insertSmartDoors({ gateways: gatewaysToInsert, locks: locksToInsert });

            for (const g of gatewaysToInsert) {
                await syncTTLockName({ type: 'gateway', externalId: String(g.gatewayId), name: g.gatewayName });
            }
            for (const l of locksToInsert) {
                await syncTTLockName({ type: 'lock', externalId: String(l.lockId), name: l.lockAlias });
            }

            $w('#repeaternewsmartdoor').data = [];
            $w('#repeaternewsmartdoor').collapse();
            $w('#text34').hide();

            invalidateSmartDoorCache();
            await switchSectionWhenReady({
                sectionId: 'sectionlistview',
                wait: async () => { await reloadListView(1); }
            });
            if (wixWindow.formFactor === 'Mobile') {
                $w('#boxmobilemenu')?.collapse();
                $w('#boxmobilemenu')?.hide();
            }
        } catch (e) {
        } finally {
            $w('#buttonsavedetail').enable();
        }
    });

    $w('#buttonsavenesmartdoor').onClick(() => {
        buildNewSmartDoorPreview();
        $w('#textsavedetail').show();
        $w('#boxnewsmartdoor').show();
    });
}

async function initNewSmartDoorSection() {
    $w('#boxnewsmartdoor').hide();
    $w('#textsavedetail').hide();
    $w('#repeaternewsmartdoor').data = [];
    $w('#repeaternewsmartdoor').collapse();
    $w('#buttonsavenesmartdoor').disable();

    $w('#buttonsyncsmartdoor').onClick(async () => {
        $w('#buttonsyncsmartdoor').label = 'Syncing';
        $w('#buttonsyncsmartdoor').disable();
        $w('#buttonsavenesmartdoor').disable();
        try {
            const res = await previewSmartDoorSelection();
            const list = res?.list || [];
            if (!res || res.total === 0) {
                $w('#repeaternewsmartdoor').data = [];
                $w('#repeaternewsmartdoor').collapse();
                $w('#text34').text = 'No Found new lock & gateway';
                $w('#text34').show();
                setTimeout(() => { $w('#text34').hide(); }, 10000);
                return;
            }
            $w('#text34').hide();
            const data = list.map((item, index) => ({
                ...item,
                _id: item._id,
                __index: index + 1,
                selected: false
            }));
            $w('#repeaternewsmartdoor').data = data;
            $w('#repeaternewsmartdoor').expand();
            $w('#buttonsavenesmartdoor').enable();
        } catch (e) {
        } finally {
            $w('#buttonsyncsmartdoor').label = 'Sync';
            $w('#buttonsyncsmartdoor').enable();
        }
    });

    if (!newSmartDoorRepeaterBound) {
        newSmartDoorRepeaterBound = true;
        $w('#repeaternewsmartdoor').onItemReady(($item, itemData, index) => {
            if ($item('#textnumber')) $item('#textnumber').text = `${index + 1})`;
            const typeLabel = itemData.type === 'gateway' ? 'Gateway' : 'Lock';
            let brandLabel = 'Other';
            if (itemData.provider === 'ttlock') brandLabel = 'TTLock';
            $item('#texttype').text = `${typeLabel} | ${brandLabel}`;
            if ($item('#checkboxselection')) $item('#checkboxselection').checked = false;
            if ($item('#inputname')) $item('#inputname').value = itemData.lockAlias || itemData.gatewayName || '';
        });
    }
}

/* ======================================================
   DETAIL OPEN / UPDATE
====================================================== */

async function openSmartDoorDetailSection(smartdoor) {
    await switchSectionAsync('sectiondetail');

    $w('#textdetail2').text = smartdoor.lockAlias || smartdoor.gatewayName || '';
    $w('#inputdetailsmartdoorname').label = smartdoor.__type === 'gateway' ? 'Gateway Name' : 'Smart Door Name';
    $w('#inputdetailsmartdoorname').value = smartdoor.lockAlias || smartdoor.gatewayName || '';

    if (smartdoor.__type === 'lock') {
        $w('#dropdownparent').show();
        $w('#dropdownparent').options = [
            { label: 'No', value: 'no' },
            { label: 'Yes', value: 'yes' }
        ];
        const isParent = Array.isArray(smartdoor.childmeter) && smartdoor.childmeter.length > 0;
        $w('#dropdownparent').value = isParent ? 'yes' : 'no';
        await initChildSmartDoorSection(smartdoor);
        return;
    }

    $w('#dropdownparent').hide();
    $w('#buttonaddchildsmartdoor').hide();
    $w('#repeaterchildsmartdoor').hide();
}

/* ======================================================
   CHILD SMART DOOR
====================================================== */

/** 設 options、排除已被其他 item 選走的門鎖、綁定關閉鈕與 onChange（每個 row._id 只綁一次）。
 *  dataOverride：刪除後傳入新陣列。onChange 時傳入的 next 已含剛選的 doorId，一律用 data 重算 options 與 value 讓選中值能保留。 */
function applyChildDropdownOptionsToRepeater(dataOverride) {
    try {
        const rep = $w('#repeaterchildsmartdoor');
        const data = dataOverride !== undefined ? dataOverride : (rep.data || []);
        rep.forEachItem(($item, itemData, index) => {
            if (index >= data.length) return;
            const row = data[index];
            const dd = $item('#dropdownchildsmartdoor');
            $item('#textnumber2').text = `${index + 1})`;
            const needBind = !childRepeaterBoundIds.has(row._id);

            dd.disable();
            const raw = Array.isArray(currentChildOptions) && currentChildOptions.length > 0 ? currentChildOptions : (Array.isArray(row.__options) && row.__options.length > 0 ? row.__options : []);
            const usedByOthers = data.map((r, i) => (i !== index && r.doorId ? String(r.doorId) : null)).filter(Boolean);
            const filtered = raw.length > 0 ? raw.filter(o => !usedByOthers.includes(String(o.value != null ? o.value : ''))) : [];
            const list = filtered.map(o => ({ label: String(o.label || o.value || ''), value: String(o.value != null ? o.value : '') }));
            const opts = [{ label: '— Select lock —', value: 'none' }, ...list];
            let val = row.doorId && row.doorId !== '' && row.doorId !== 'none' ? String(row.doorId) : 'none';
            if (val !== 'none' && usedByOthers.includes(val)) val = 'none';
            dd.options = opts;
            dd.value = val;
            dd.enable();
            if (needBind) {
                childRepeaterBoundIds.add(row._id);
                $item('#buttonclosechildsmartdoor').onClick(() => {
                    const cur = rep.data || [];
                    const next = cur.filter((r) => r._id !== row._id);
                    rep.data = next;
                    applyChildDropdownOptionsToRepeater(next);
                });
                dd.onChange(() => {
                    const cur = rep.data || [];
                    const rowId = row._id;
                    const next = cur.map((r) => r._id === rowId ? { ...r, doorId: (dd.value && dd.value !== 'none' ? dd.value : null) } : r);
                    rep.data = next;
                    applyChildDropdownOptionsToRepeater(next);
                });
            }
        });
        $w('#buttonaddchildsmartdoor').enable();
        rep.forEachItem(($i) => { $i('#buttonclosechildsmartdoor').enable(); });
    } catch (e) {}
}

async function initChildSmartDoorSection(smartdoor) {
    const isParent = $w('#dropdownparent').value === 'yes';
    if (!isParent) {
        $w('#repeaterchildsmartdoor').hide();
        $w('#buttonaddchildsmartdoor').hide();
        return;
    }
    /* Parent=Yes: 只 show Add 按钮，repeater 等第一次点击 Add 后再 show；第二次点击才加 item */
    childRepeaterShownAndLoaded = false;
    $w('#buttonaddchildsmartdoor').show();
    $w('#repeaterchildsmartdoor').hide();

    try {
        const res = await getChildLockOptions(smartdoor._id);
        currentChildOptions = Array.isArray(res?.options) ? res.options : [];
    } catch (e) {
        currentChildOptions = [];
    }
    if (currentChildOptions.length === 0) {
        $w('#buttonaddchildsmartdoor').disable();
    }

    let childData = [];
    const optsForRows = currentChildOptions || [];
    if (Array.isArray(smartdoor.childmeter) && smartdoor.childmeter.length > 0) {
        childData = smartdoor.childmeter.map(c => ({
            _id: `row_${c}`,
            doorId: typeof c === 'string' ? c : (c && c._id) || c,
            __options: optsForRows
        }));
    }
    const currentRepeaterData = $w('#repeaterchildsmartdoor').data || [];
    if (currentRepeaterData.length > childData.length) {
        return;
    }

    if (!childRepeaterBound) {
        childRepeaterBound = true;
        $w('#repeaterchildsmartdoor').onItemReady(($item, itemData, index) => {
            $item('#textnumber2').text = `${index + 1})`;
            const dd = $item('#dropdownchildsmartdoor');
            const raw = Array.isArray(itemData.__options) && itemData.__options.length > 0
                ? itemData.__options
                : (Array.isArray(currentChildOptions) && currentChildOptions.length > 0 ? currentChildOptions : []);
            const opts = raw.length > 0
                ? raw.map(o => ({ label: String(o.label || o.value || ''), value: String(o.value != null ? o.value : '') }))
                : [{ label: '— Select lock —', value: 'none' }];
            const val = itemData.doorId != null && itemData.doorId !== '' && itemData.doorId !== 'none'
                ? String(itemData.doorId) : 'none';
            try {
                dd.options = opts.length ? opts : [{ label: '— Select lock —', value: 'none' }];
                dd.value = val;
                dd.enable();
            } catch (e) {}
            $w('#buttonaddchildsmartdoor').enable();
            $w('#repeaterchildsmartdoor').forEachItem(($i) => { $i('#buttonclosechildsmartdoor').enable(); });
            $item('#buttonclosechildsmartdoor').onClick(() => {
                const data = $w('#repeaterchildsmartdoor').data || [];
                const next = data.filter((row) => row._id !== itemData._id);
                $w('#repeaterchildsmartdoor').data = next;
                applyChildDropdownOptionsToRepeater(next);
            });
        });
    }
    if (childData.length > 0) {
        childRepeaterBoundIds.clear();
        $w('#repeaterchildsmartdoor').show();
        $w('#repeaterchildsmartdoor').data = childData;
        childRepeaterShownAndLoaded = true;
        applyChildDropdownOptionsToRepeater();
    } else {
        $w('#repeaterchildsmartdoor').data = [];
    }
}

function safeWait(promise, timeout = 1500) {
    return Promise.race([promise, new Promise(resolve => setTimeout(resolve, timeout))]);
}

function waitRepeaterRendered(repeaterId) {
    return new Promise(resolve => {
        let done = false;
        $w(repeaterId).onItemReady(() => {
            if (done) return;
            done = true;
            resolve();
        });
    });
}

/* ======================================================
   LIST VIEW FILTERS
====================================================== */

async function initListViewPropertyFilter() {
    const res = await getSmartDoorFilters();
    const properties = res?.properties || [];
    const options = [
        { label: 'All Properties', value: 'ALL' },
        ...properties.map(p => ({ label: p.label, value: p.value }))
    ];
    $w('#dropdownlistviewproperty').options = options;
    $w('#dropdownlistviewproperty').value = 'ALL';
}

function bindListViewFilters() {
    if (listViewFilterBound) return;
    listViewFilterBound = true;

    $w('#inputlistviewsearch').onInput(() => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
            listViewFilterState.keyword = ($w('#inputlistviewsearch').value || '').trim();
            currentListViewPage = 1;
            invalidateSmartDoorCache();
            await fetchAndFillCache();
            applyFilterAndSort();
        }, 300);
    });

    $w('#dropdownlistviewproperty').onChange(async () => {
        listViewFilterState.propertyId = $w('#dropdownlistviewproperty').value;
        invalidateSmartDoorCache();
        currentListViewPage = 1;
        await fetchAndFillCache();
        applyFilterAndSort();
    });

    $w('#dropdownfilter').onChange(() => {
        listViewFilterState.filter = $w('#dropdownfilter').value;
        currentListViewPage = 1;
        try { $w('#paginationlistview').currentPage = 1; } catch (_) {}
        applyFilterAndSort();
    });
}

function bindPaginationOnce() {
    if (paginationBound) return;
    paginationBound = true;
    $w('#paginationlistview').onChange(async (e) => {
        const page = e.target.currentPage;
        currentListViewPage = page;
        if (useServerFilter) await loadListViewFromServer(page);
        else applyFilterAndSortToCache();
    });
}

function buildNewSmartDoorPreview() {
    let text = '';
    let count = 0;
    $w('#repeaternewsmartdoor').forEachItem(($item) => {
        const name = ($item('#inputname').value || '').trim();
        if (!name) return;
        text += `${name} |\n`;
        count++;
    });
    if (count === 0) return;
    text += `\nTotal ${count} Smart Door`;
    $w('#textsavedetail').text = text.trim();
}

function bindDropdownParentOnce() {
    if (dropdownParentBound) return;
    dropdownParentBound = true;
    $w('#dropdownparent').onChange(async () => {
        if (!currentDetailSmartDoor) return;
        const isYes = $w('#dropdownparent').value === 'yes';
        if (isYes) await initChildSmartDoorSection(currentDetailSmartDoor);
        else {
            $w('#repeaterchildsmartdoor').hide();
            $w('#buttonaddchildsmartdoor').hide();
        }
    });
}
