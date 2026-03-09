/* =======================
   Meter Setting – 前端 Wix + 后端 Node (backend/saas/metersetting.jsw)
   Cache + 前端 filter（与 expenses 一致）：最多 2000 条进 cache，改筛选不请求；超过 2000 走 server filter。
   Topup 使用 backend/saas/topup：getMyBillingInfo、getCreditPlans、startNormalTopup。
======================= */
import { getAccessContext } from 'backend/access/manage';
import wixLocation from 'wix-location';
import wixWindow from 'wix-window';
import { showToast } from 'wix-dashboard';
import { getMyBillingInfo, getCreditPlans, startNormalTopup } from 'backend/saas/topup';
import { submitTicket } from 'backend/saas/help';
import {
    getMeterList,
    getMeterFilters,
    getMeter,
    updateMeter,
    updateMeterStatus,
    deleteMeter,
    insertMeters,
    insertMetersFromPreview,
    getActiveMeterProvidersByClient,
    getUsageSummary,
    syncMeterByCmsMeterId,
    clientTopup,
    loadGroupList,
    deleteGroup,
    submitGroup
} from 'backend/saas/metersetting';

/* ====================================================== GLOBAL STATE ====================================================== */
let syncRepeaterBound = false;
let topupRepeaterBound = false;
let topupCheckoutBound = false;
let topupCloseBound = false;
let newMeterRepeaterBound = false;
let currentDetailMeter = null;
let meterGroupBound = false;
let groupModeLocked = false;
let submitGroupLocked = false;
let currentGroupId = null;
let currentGroupMeters = [];
let meterReportDateBound = false;
let childRepeaterBound = false;
let clientTopupBound = false;
let listViewLoading = false;
let listViewFilterBound = false;
let searchTimer = null;
let newMeterBound = false;
let selectedTopupPlanId = null;
let selectedTopupPlanCache = null;
let childMeterOptions = [];
let syncButtonBound = false;
let listViewPageSize = 20;
let activeSection = null;
let lastSectionBeforeTopup = 'default';
let groupRepeaterBound = false;
let clientCurrency = 'MYR';
let topupInited = false;
let pendingDeleteGroupId = null;
let deleteConfirmPending = false;
let accessCtx = null;
let currentClientId = null;
let lastSectionBeforeMeterReport = null;
/** When true, repeater data includes _disableButtons so all 4 list buttons (buttontopupclient, buttonsync, buttonupdatedetail, buttondetail) are disabled on every item. */
let meterListButtonsDisabled = false;
let __pageInitOnce = false;
let mobileMenuBound = false;

const PAGE_SECTIONS = [
    '#sectionlistview', '#sectiontopup', '#sectiontab', '#sectiondetail', '#sectionheader',
    '#sectionnewmeter', '#sectiongroup', '#sectionmeterreport', '#sectioncreategroup'
];

const listViewFilterState = { keyword: '', propertyId: 'ALL', filter: 'ALL' };

/** 前端缓存：最多 2000 条；若 total>2000 则走 server filter（与 expenses 一致） */
let meterCache = [];
let meterCacheTotal = 0;
let useServerFilter = false;
let currentMeterPage = 1;
const METER_CACHE_LIMIT = 2000;
const METER_PAGE_SIZE = 20;

/* ====================================================== onReady ====================================================== */
$w.onReady(() => {
    if (__pageInitOnce) return;
    __pageInitOnce = true;
    $w('#sectiondefault').expand();
    if (wixWindow.formFactor !== 'Mobile') $w('#sectiontab').expand(); else $w('#sectiontab').collapse();
    $w('#sectionlistview').collapse();
    $w('#sectiontopup').collapse();
    $w('#sectionmeterreport').collapse();
    $w('#sectiongroup').collapse();
    $w('#sectioncreategroup').collapse();
    $w('#sectionnewmeter').collapse();
    $w('#sectiondetail').collapse();
    $w('#boxnewmeter').hide();
    if (wixWindow.formFactor === 'Mobile') {
        $w('#buttonmobilemenu')?.show();
        $w('#buttonmobilemenu')?.enable();
        $w('#boxmobilemenu')?.hide();
        $w('#boxmobilemenu')?.collapse();
        // Only nav buttons in mobile menu need disable until startInit done; #buttonmobilemenu stays clickable
        $w('#buttonmeter2')?.disable();
        $w('#buttongroup2')?.disable();
        $w('#buttonnewmeter2')?.disable();
        bindMobileMenu();
    } else {
        $w('#buttonmobilemenu')?.hide();
        $w('#boxmobilemenu')?.hide();
    }
    $w('#buttonmeter')?.disable();
    $w('#buttonnewmeter')?.disable();
    $w('#buttongroup')?.disable();
    $w('#buttontopup')?.disable();
    startInitAsync();
});

/* ====================================================== INIT ====================================================== */
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

        if (accessCtx.credit?.ok === false) {
            enableTopupOnly();
            return;
        }
        if (!accessCtx.staff.permission.propertylisting && !accessCtx.staff.permission.admin) {
            showAccessDenied("You don't have permission");
            return;
        }

        $w('#buttonmeter').onClick(() => goToMeterList($w('#buttonmeter')));

    } catch (e) {
        showAccessDenied('Unable to verify account');
        return;
    }

    $w('#buttonclosemeterreport').onClick(async () => {
        const target = lastSectionBeforeMeterReport ? `section${lastSectionBeforeMeterReport}` : 'sectionlistview';
        await switchSectionAsync(target);
        if (target === 'sectionlistview') ensureListButtonsEnabled();
    });

    $w('#buttontopup').onClick(async () => {
        lastSectionBeforeTopup = activeSection || 'default';
        if (!topupInited) {
            await initTopupSection();
            topupInited = true;
        }
        await switchSectionAsync('sectiontopup');
    });

    $w('#buttonmeter').enable();
    $w('#buttonnewmeter').enable();
    $w('#buttongroup').enable();
    $w('#buttontopup').enable();
    $w('#textstatusloading').hide();

    // Preload meter list from meterdetail by client so #repeatermeter has data when user opens list
    (async () => {
        try {
            await initListViewDropdowns();
            await fetchAndFillMeterCache();
            applyFilterAndSort();
        } catch (e) {
            console.warn('[metersetting] preload meter list failed', e?.message || e);
        }
    })();

    bindButtonsSavedetail();
    bindParentMeterChange();
    bindButtonsaveneweter();
    bindButtonclosenewmeter();
    bindButtonaddchildmeter();
    bindButtonupdatebox();
    bindButtondeletemeter();
    bindButtondelete();
    bindDropdowngroupmode();
    bindButtonsyncmeter();
    bindNewMeterButton();
    bindClientTopupBox();
    bindProblemBoxClose();
    bindSyncMeterRepeater();
    bindMeterGroup();
    bindTopupCloseButton();
    bindButtonclosedetail2();

    if (wixWindow.formFactor === 'Mobile') {
        $w('#buttonmeter')?.hide();
        $w('#buttonnewmeter')?.hide();
        $w('#buttongroup')?.hide();
        $w('#buttonmobilemenu')?.show();
        $w('#boxmobilemenu')?.hide();
        $w('#boxmobilemenu')?.collapse();
        $w('#buttonmeter2')?.enable();
        $w('#buttonnewmeter2')?.enable();
        $w('#buttongroup2')?.enable();
        bindMobileMenu();
    } else {
        $w('#buttonmobilemenu')?.hide();
        $w('#boxmobilemenu')?.hide();
    }
}

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

/* ====================================================== TOPUP ====================================================== */
async function initTopupSection() {
    const billing = await getMyBillingInfo();
    const credits = Array.isArray(billing?.credit) ? billing.credit : [];
    const totalCredit = credits.reduce((s, c) => s + Number(c.amount || 0), 0);
    $w('#textcurrentcredit').text = `Current Credit Balance: ${totalCredit}`;

    const plans = await getCreditPlans();
    $w('#repeatertopup').data = Array.isArray(plans) ? plans : [];

    if (!topupRepeaterBound) {
        $w('#repeatertopup').onItemReady(($item, plan) => {
            const sellingprice = plan.sellingprice ?? plan.sellingPrice ?? 0;
            const credit = plan.credit ?? 0;
            $item('#textamount').text = `${clientCurrency} ${sellingprice}`;
            $item('#textcreditamount').text = String(credit);
            $item('#textcredit').text = 'Credits';
            $item('#boxcolor').hide();
            $item('#containertopup').onClick(() => {
                selectedTopupPlanId = plan.id ?? plan._id;
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
                    console.warn('[metersetting] submitTicket topup_manual failed', e);
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

function setupTopupProblemBox(amount) {
    let text = `Your top up amount is more than ${clientCurrency} 1000\nThe top up amount: ${clientCurrency} ${amount}\n\nPlease transfer to:\nPublic Bank Account\nColiving Management Sdn Bhd\n3240130500\n\nPlease drop your receipt to our customer services:\n📞 6019-857 9627`;
    $w('#textproblem').text = text.trim();
}

function bindProblemBoxClose() {
    $w('#buttoncloseproblem2').onClick(() => { $w('#boxproblem2').hide(); });
}

/* ====================================================== LIST VIEW – cache + filter (like expenses) ====================================================== */
function getCurrentFilterOpts() {
    const rawProperty = $w('#dropdownlistviewproperty')?.value;
    const rawFilter = $w('#dropdownfilter')?.value;
    return {
        keyword: ($w('#inputlistviewsearch')?.value || '').trim().toLowerCase(),
        propertyId: (rawProperty && rawProperty !== '') ? rawProperty : 'ALL',
        filter: (rawFilter && rawFilter !== '') ? rawFilter : 'ALL',
        sort: 'title'
    };
}

async function initListViewDropdowns() {
    if (listViewFilterBound) return;
    const defaultOptions = [
        { label: 'All', value: 'ALL' },
        { label: 'Prepaid', value: 'PREPAID' },
        { label: 'Postpaid', value: 'POSTPAID' },
        { label: 'Online', value: 'ONLINE' },
        { label: 'Offline', value: 'OFFLINE' },
        { label: 'Active', value: 'ACTIVE' },
        { label: 'Inactive', value: 'INACTIVE' }
    ];
    const res = await getMeterFilters();
    const properties = (res && res.ok !== false && Array.isArray(res.properties)) ? res.properties : [];
    const services = (res && res.ok !== false && Array.isArray(res?.services) && res.services.length) ? res.services : defaultOptions;
    if ($w('#dropdownlistviewproperty')) {
        $w('#dropdownlistviewproperty').options = [{ label: 'All', value: 'ALL' }, ...properties.map(p => ({ label: p.label, value: p.value }))];
        $w('#dropdownlistviewproperty').value = 'ALL';
    }
    if ($w('#dropdownfilter')) {
        $w('#dropdownfilter').options = services;
        $w('#dropdownfilter').value = 'ALL';
    }

    $w('#inputlistviewsearch').onInput(() => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            listViewFilterState.keyword = ($w('#inputlistviewsearch').value || '').trim().toLowerCase();
            currentMeterPage = 1;
            applyFilterAndSort();
        }, 300);
    });
    $w('#dropdownlistviewproperty').onChange(() => {
        listViewFilterState.propertyId = $w('#dropdownlistviewproperty').value || 'ALL';
        currentMeterPage = 1;
        applyFilterAndSort();
    });
    $w('#dropdownfilter').onChange(() => {
        listViewFilterState.filter = $w('#dropdownfilter').value || 'ALL';
        currentMeterPage = 1;
        applyFilterAndSort();
    });
    $w('#paginationlistview').onChange((e) => {
        currentMeterPage = e.target.currentPage;
        if (useServerFilter) loadMeterPageFromServer(currentMeterPage);
        else applyFilterAndSortToCache();
    });
    listViewFilterBound = true;
}

/** 只根据当前 keyword/propertyId/filter 去 ECS 拿一页或整 cache（limit=METER_CACHE_LIMIT）。List 按 client 查 meterdetail，client 由后端用当前登录 email 从 staffdetail.client_id 解析。 */
async function fetchAndFillMeterCache() {
    const opts = getCurrentFilterOpts();
    const res = await getMeterList({
        keyword: opts.keyword || undefined,
        propertyId: opts.propertyId === 'ALL' ? undefined : opts.propertyId,
        filter: opts.filter === 'ALL' ? undefined : opts.filter,
        sort: opts.sort,
        limit: METER_CACHE_LIMIT
    });
    if (!res || res.ok === false) {
        meterCache = [];
        meterCacheTotal = 0;
        applyFilterAndSortToCache();
        if (res && res.reason) console.warn('[metersetting] list failed:', res.reason, '- ensure staffdetail.client_id for your email matches the client that owns the meters.');
        return;
    }
    const total = res.total || 0;
    const items = Array.isArray(res.items) ? res.items : [];
    if (total <= METER_CACHE_LIMIT) {
        meterCache = items;
        meterCacheTotal = total;
        useServerFilter = false;
    } else {
        meterCache = [];
        meterCacheTotal = total;
        useServerFilter = true;
    }
}

function applyFilterAndSort() {
    if (useServerFilter) {
        loadMeterPageFromServer(currentMeterPage);
        return;
    }
    applyFilterAndSortToCache();
}

function sortMeters(list, sortKey) {
    const key = (sortKey || 'title').toLowerCase();
    const arr = [...list];
    if (key === 'title_desc') return arr.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
    if (key === 'meterid') return arr.sort((a, b) => (a.meterId || '').localeCompare(b.meterId || ''));
    if (key === 'meterid_desc') return arr.sort((a, b) => (b.meterId || '').localeCompare(a.meterId || ''));
    return arr.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

function applyFilterAndSortToCache() {
    const opts = getCurrentFilterOpts();
    let list = meterCache;
    if (opts.propertyId && opts.propertyId !== 'ALL') {
        list = list.filter(i => (i.property || i.propertyId) === opts.propertyId);
    }
    if (opts.filter && opts.filter !== 'ALL') {
        if (opts.filter === 'PREPAID' || opts.filter === 'MODE_PREPAID') list = list.filter(i => i.mode === 'prepaid');
        else if (opts.filter === 'POSTPAID' || opts.filter === 'MODE_POSTPAID') list = list.filter(i => i.mode === 'postpaid');
        else if (opts.filter === 'ONLINE') list = list.filter(i => i.isOnline === true);
        else if (opts.filter === 'OFFLINE') list = list.filter(i => !i.isOnline);
        else if (opts.filter === 'ACTIVE') list = list.filter(i => i.status === true);
        else if (opts.filter === 'INACTIVE') list = list.filter(i => !i.status);
        else if (opts.filter === 'BRAND_CNYIOT') list = list.filter(i => (i.productName || '').toUpperCase() === 'CNYIOT');
    }
    if (opts.keyword) {
        const s = opts.keyword;
        list = list.filter(i =>
            (i.meterId || '').toLowerCase().includes(s) ||
            (i.title || '').toLowerCase().includes(s) ||
            (i.productName || '').toLowerCase().includes(s)
        );
    }
    list = sortMeters(list, opts.sort);
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / METER_PAGE_SIZE));
    const start = (currentMeterPage - 1) * METER_PAGE_SIZE;
    const pageItems = list.slice(start, start + METER_PAGE_SIZE);
    $w('#paginationlistview').totalPages = totalPages;
    $w('#paginationlistview').currentPage = currentMeterPage;
    // 使用新对象引用，确保 repeater 重新渲染（#textmetername、#textmetertitle、#boxlistview 等会更新）；_disableButtons 控制 4 个按钮全 item 禁用
    $w('#repeatermeter').data = pageItems.map(i => ({ ...i, _disableButtons: meterListButtonsDisabled }));
}

/** 立即禁用当前页所有 repeater item 的 4 个按钮（点击任一按钮时先调用，再 await） */
function disableAllMeterListButtonsNow() {
    try {
        $w('#repeatermeter').forEachItem(($item) => {
            $item('#buttondetail').disable();
            if ($item('#buttonsync')) $item('#buttonsync').disable();
            $item('#buttontopupclient').disable();
            $item('#buttonupdatedetail').disable();
        });
    } catch (e) { /* repeater 可能未渲染 */ }
}

/** 立即启用当前页所有 repeater item 的 4 个按钮（不依赖 repeater 重新渲染） */
function enableAllMeterListButtonsNow() {
    try {
        $w('#repeatermeter').forEachItem(($item) => {
            $item('#buttondetail').enable();
            if ($item('#buttonsync')) { $item('#buttonsync').enable(); $item('#buttonsync').label = 'Sync'; }
            $item('#buttontopupclient').enable();
            $item('#buttonupdatedetail').enable();
        });
    } catch (e) { /* repeater 可能未渲染 */ }
}

/** 回到列表时恢复 4 个按钮可点：先直接 enable 每个 item，再更新 data 保持一致 */
function ensureListButtonsEnabled() {
    meterListButtonsDisabled = false;
    enableAllMeterListButtonsNow();
    applyFilterAndSort();
}

async function loadMeterPageFromServer(pageNumber) {
    currentMeterPage = pageNumber;
    const opts = getCurrentFilterOpts();
    $w('#repeatermeter').data = [];
    const res = await getMeterList({
        keyword: opts.keyword || undefined,
        propertyId: opts.propertyId === 'ALL' ? undefined : opts.propertyId,
        filter: opts.filter === 'ALL' ? undefined : opts.filter,
        sort: opts.sort,
        page: currentMeterPage,
        pageSize: METER_PAGE_SIZE
    });
    if (!res || res.ok === false) return;
    const items = res.items || [];
    $w('#paginationlistview').totalPages = res.totalPages || 1;
    $w('#paginationlistview').currentPage = res.currentPage || 1;
    $w('#repeatermeter').data = items;
}

/* ====================================================== REPEATER METER onItemReady ====================================================== */
$w('#repeatermeter').onItemReady(($item, meterdetail) => {
    if (meterdetail._disableButtons) {
        $item('#buttondetail').disable();
        if ($item('#buttonsync')) $item('#buttonsync').disable();
        $item('#buttontopupclient').disable();
        $item('#buttonupdatedetail').disable();
    } else {
        $item('#buttondetail').enable();
        if ($item('#buttonsync')) { $item('#buttonsync').enable(); $item('#buttonsync').label = 'Sync'; }
        $item('#buttontopupclient').enable();
        $item('#buttonupdatedetail').enable();
    }
    $item('#buttontopupclient').onClick(() => {
        disableAllMeterListButtonsNow();
        meterListButtonsDisabled = true;
        applyFilterAndSort();
        $w('#inputtopupclient').value = '';
        $w('#boxtopupclient').show();
        currentDetailMeter = meterdetail;
    });
    const titleEl = $item('#textmetertitle');
    if (titleEl) titleEl.text = meterdetail.title || '';
    const meterId = meterdetail.meterId || '';
    const productName = meterdetail.productName || '';
    const modeText = meterdetail.mode ? `(${meterdetail.mode})` : '';
    const balanceKwhz = meterdetail.balance != null ? Number(meterdetail.balance) : 0;
    $item('#textmetername').text = `${meterId} | ${productName} ${modeText} | ${balanceKwhz} kwhz`.trim();

    const syncBtn = $item('#buttonsync');
    if (syncBtn) {
        syncBtn.enable();
        syncBtn.label = 'Sync';
        syncBtn.onClick(async () => {
            disableAllMeterListButtonsNow();
            meterListButtonsDisabled = true;
            applyFilterAndSort();
            console.log('[buttonsync] click meterId=', meterdetail.meterId);
            syncBtn.disable();
            syncBtn.label = 'Syncing...';
            try {
                const syncRes = await syncMeterByCmsMeterId(meterdetail.meterId);
                if (syncRes && syncRes.ok === false) {
                    console.error('[buttonsync] SYNC FAILED meterId=', meterdetail.meterId, 'reason=', syncRes.reason);
                    syncBtn.label = 'Failed';
                    const reason = syncRes.reason || '';
                    const msg = reason === 'CNYIOT_NOT_CONFIGURED' ? '请先在 Company Setting 配置电表(CNYIoT)' : (reason || 'Sync failed');
                    try { showToast({ message: msg, type: 'warning' }); } catch (_) {}
                    setTimeout(() => { syncBtn.label = 'Sync'; syncBtn.enable(); ensureListButtonsEnabled(); }, 1200);
                    return;
                }
                console.log('[buttonsync] syncMeterByCmsMeterId OK meterId=', meterdetail.meterId);
                syncBtn.label = 'Synced';
                // 先把 sync 返回的 after 合并进 cache，再拉列表，这样 repeater 一定能拿到最新 balance/isOnline
                const after = syncRes.after;
                if (after && (after.id || after.meterid != null)) {
                    const idx = meterCache.findIndex(m => String(m.id || m._id) === String(after.id) || String(m.meterId) === String(after.meterid || after.meterId));
                    if (idx >= 0) {
                        const merged = {
                            ...meterCache[idx],
                            balance: after.balance != null ? Number(after.balance) : meterCache[idx].balance,
                            isOnline: after.isonline === 1 || after.isonline === true,
                            status: after.status === 1 || after.status === true,
                            lastSyncAt: after.lastsyncat || meterCache[idx].lastSyncAt
                        };
                        meterCache[idx] = merged;
                    }
                }
                await fetchAndFillMeterCache();
                applyFilterAndSort();
                await safeWait(waitRepeaterRendered('#repeatermeter'));
                // 若当前详情就是刚 sync 的表，拉取最新数据并更新 #textdetail2（不论当前在 list 还是 detail）
                if (currentDetailMeter && String(currentDetailMeter.meterId) === String(meterdetail.meterId)) {
                    const fresh = await getMeter(currentDetailMeter.id || currentDetailMeter._id);
                    if (fresh) {
                        currentDetailMeter = fresh;
                        updateTextdetail2FromMeter(fresh);
                    }
                }
            } catch (e) {
                console.error('[buttonsync] SYNC ITEM ERROR meterId=', meterdetail.meterId, e?.message || e);
                syncBtn.label = 'Failed';
                try { showToast({ message: e?.message || 'Sync failed', type: 'warning' }); } catch (_) {}
            }
            setTimeout(() => { syncBtn.label = 'Sync'; syncBtn.enable(); ensureListButtonsEnabled(); }, 1200);
        });
    }

    const checkbox = $item('#checkboxstatus');
    if (checkbox) {
        checkbox.checked = meterdetail.status === true;
        checkbox.onChange(async () => {
            checkbox.disable();
            try {
                await updateMeterStatus(meterdetail.id || meterdetail._id, checkbox.checked === true);
            } catch (e) {
                console.error('[STATUS UPDATE ERROR]', e);
                checkbox.checked = !checkbox.checked;
            }
            checkbox.enable();
        });
    }

    const box = $item('#boxlistview');
    if (box) box.style.backgroundColor = meterdetail.isOnline === true ? '#e6f7f1' : '#fdeaea';

    $item('#buttondetail').onClick(async () => {
        disableAllMeterListButtonsNow();
        meterListButtonsDisabled = true;
        applyFilterAndSort();
        const btn = $item('#buttondetail');
        btn.label = 'Loading...';
        btn.disable();
        try {
            await openMeterReportSection({
                source: 'meter',
                groupId: null,
                meters: [{
                    _id: meterdetail._id,
                    id: meterdetail.id,
                    meterId: meterdetail.meterId,
                    title: meterdetail.title,
                    productName: meterdetail.productName,
                    mode: meterdetail.mode,
                    balance: meterdetail.balance,
                    rate: meterdetail.rate,
                    lastSyncAt: meterdetail.lastSyncAt,
                    room: meterdetail.room,
                    property: meterdetail.property,
                    propertyShortname: meterdetail.propertyShortname,
                    role: 'parent'
                }]
            });
        } finally {
            btn.label = 'Detail';
            btn.enable();
            ensureListButtonsEnabled();
        }
    });

    $item('#buttonupdatedetail').onClick(async () => {
        disableAllMeterListButtonsNow();
        meterListButtonsDisabled = true;
        applyFilterAndSort();
        currentDetailMeter = meterdetail;
        try {
            await openMeterDetailSection(meterdetail);
        } finally {
            ensureListButtonsEnabled();
        }
    });
});

/* ====================================================== SECTION SWITCH ====================================================== */
function collapseAllSections() {
    PAGE_SECTIONS.forEach(id => {
        if (id === '#sectionheader' || id === '#sectiontab') return;
        $w(id)?.collapse();
    });
}

function safeWait(promise, timeout = 1500) {
    return Promise.race([promise, new Promise(r => setTimeout(r, timeout))]);
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

async function switchSectionAsync(sectionId) {
    collapseAllSections();
    $w('#sectiondefault')?.collapse();
    if (wixWindow.formFactor !== 'Mobile') $w('#sectiontab').expand();
    const target = $w(`#${sectionId}`);
    if (target) target.expand();
    activeSection = sectionId.replace('section', '');
}

/** Shared nav: go to meter list (used by #buttonmeter and #buttonmeter2). Wait all await done then switch section. */
async function goToMeterList(btn) {
    btn = btn || $w('#buttonmeter');
    btn.disable();
    const origLabel = btn.label || 'Meter';
    btn.label = 'Loading...';
    try {
        await initListViewDropdowns();
        await fetchAndFillMeterCache();
        applyFilterAndSort();
        await switchSectionAsync('sectionlistview');
        ensureListButtonsEnabled();
        await safeWait(waitRepeaterRendered('#repeatermeter'));
    } finally {
        btn.label = origLabel;
        btn.enable();
    }
}

/** Shared nav: go to new meter section (used by #buttonnewmeter and #buttonnewmeter2). Wait await then switch section. */
async function goToNewMeterSection(btn) {
    btn = btn || $w('#buttonnewmeter');
    btn.disable();
    const origLabel = btn.label || 'Add Meter';
    btn.label = 'Loading...';
    try {
            $w('#repeaternewmeter').data = [];
            $w('#repeaternewmeter').collapse();
            $w('#repeaternewmeter').hide();
            $w('#buttonsaveneweter').disable();
            $w('#boxnewmeter').hide();
            await initNewMeterSection();
            await switchSectionAsync('sectionnewmeter');
        activeSection = 'newmeter';
    } finally {
        btn.label = origLabel;
        btn.enable();
    }
}

/** Shared nav: go to meter group section (used by #buttongroup and #buttongroup2). Wait await then switch section. */
async function goToGroupSection(btn) {
    btn = btn || $w('#buttongroup');
    btn.disable();
    const origLabel = (btn.label || 'Meter Group').toString();
    btn.label = 'Loading...';
    try {
        const res = await loadGroupList();
        const groups = (res && res.ok !== false) ? (res.groups || []) : [];
        $w('#repeatergroup').data = groups;
        await safeWait(waitRepeaterRendered('#repeatergroup'));
        await switchSectionAsync('sectiongroup');
        $w('#sectiongroup').expand();
        $w('#repeatergroup').expand();
    } finally {
        btn.label = origLabel;
        btn.enable();
    }
}

/* ====================================================== BUTTONS: savedetail, newmeter, update, delete, group, topup client ====================================================== */
function bindButtonsSavedetail() {
    $w('#buttonsavedetail').onClick(async () => {
        $w('#buttonsavedetail').disable();
        $w('#buttonsavedetail').label = 'Saving...';
        try {
            const records = [];
            $w('#repeaternewmeter').forEachItem(($item, itemData) => {
                const meterId = ($item('#inputmeterid').value || '').trim();
                const mode = $item('#dropdowntype').value || 'prepaid';
                const title = ($item('#inputname').value || itemData.title || itemData.name || '').trim();
                if (!meterId) return;
                records.push({
                    meterId,
                    title,
                    mode
                });
            });
            if (records.length === 0) {
                throw new Error('NO_VALID_METER');
            }
            setSavedetailSummary();
            console.log('[buttonsavedetail] 1) records (from preview)=', JSON.stringify(records));
            const insertResult = await insertMetersFromPreview(records);
            console.log('[buttonsavedetail] 2) insertMetersFromPreview result=', JSON.stringify(insertResult));
            if (insertResult && insertResult.ok === false) {
                throw new Error(insertResult.reason || 'INSERT_FAILED');
            }
            const inserted = insertResult?.inserted ?? records.length;
            if ($w('#textsavedetail')) $w('#textsavedetail').text = `Saved. ${inserted} meter(s) added to list.`;
            $w('#repeaternewmeter').data = [];
            $w('#repeaternewmeter').collapse();
            $w('#repeaternewmeter').hide();
            $w('#buttonsaveneweter').disable();
            $w('#boxnewmeter').hide();
            $w('#buttonsavedetail').label = 'Saved';
            setTimeout(async () => {
                $w('#buttonsavedetail').label = 'Save';
                $w('#buttonsavedetail').enable();
                await switchSectionAsync('sectionlistview');
                await initListViewDropdowns();
                listViewFilterState.propertyId = 'ALL';
                listViewFilterState.filter = 'ALL';
                listViewFilterState.keyword = '';
                currentMeterPage = 1;
                $w('#dropdownlistviewproperty').value = 'ALL';
                $w('#dropdownfilter').value = 'ALL';
                $w('#inputlistviewsearch').value = '';
                await fetchAndFillMeterCache();
                ensureListButtonsEnabled();
                await safeWait(waitRepeaterRendered('#repeatermeter'));
                if (wixWindow.formFactor === 'Mobile') {
                    $w('#boxmobilemenu')?.collapse();
                    $w('#boxmobilemenu')?.hide();
                }
            }, 800);
        } catch (e) {
            console.error('[metersetting-add] frontend ERROR:', e?.message || e);
            console.error('[metersetting-add] frontend ERROR stack:', e?.stack || '');
            $w('#buttonsavedetail').label = 'Failed';
            const msg = (e?.message || '').toString();
            const isGenericError = /Unable to handle the request|Contact the site administrator|BACKEND_ERROR/i.test(msg);
            if (isGenericError && $w('#textsavedetail')) {
                $w('#textsavedetail').text = 'Request failed. If CNYIOT add returned 5006, the account has no permission to add meters. Check site monitoring or try again.';
            } else if (msg.startsWith('CNYIOT_LOGIN_FAILED') || msg === 'CNYIOT_NOT_CONFIGURED' || msg === 'CNYIOT_ACCOUNT_INVALID') {
                const friendly = msg === 'CNYIOT_NOT_CONFIGURED'
                    ? '请先在 System Integration 中连接 Meter (CNYIoT) 并保存账号与密码。'
                    : msg === 'CNYIOT_ACCOUNT_INVALID'
                        ? 'Meter 集成账号或密码未填写完整，请在 System Integration 中检查。'
                        : 'CNYIoT 登录失败（账号或密码错误），请在 System Integration 中检查电表集成的账号与密码。';
                if ($w('#textsavedetail')) $w('#textsavedetail').text = friendly;
            } else if (msg.startsWith('CNYIOT_ADD_FAILED_')) {
                const code = msg.replace('CNYIOT_ADD_FAILED_', '');
                const friendly = code === '5006'
                    ? 'CNYIoT 添加电表失败 (5006 无权操作)。当前已用主账号(平台账号)调用 addMeter，若仍返回 5006 请确认该主账号在 CNYIoT 平台是否有添加电表权限或联系平台方。'
                    : code === '4132'
                        ? 'CNYIoT 4132：该表号已存在或已被添加，请换新表号或到平台确认。'
                        : code === '4142'
                            ? 'CNYIoT 4142：此表已存在，请换表号或到平台查看。'
                            : `CNYIoT 添加电表失败 (${code})，请稍后重试或联系管理员。`;
                if ($w('#textsavedetail')) $w('#textsavedetail').text = friendly;
            }
            setTimeout(() => {
                $w('#buttonsavedetail').label = 'Save';
                $w('#buttonsavedetail').enable();
            }, 1500);
        }
    });
}

function bindParentMeterChange() {
    $w('#dropdownparent').onChange(() => {
        const mode = $w('#dropdowngroupmode').value;
        if (mode === 'brother') return;
        const parentId = $w('#dropdownparent').value;
        if (!parentId) {
            $w('#buttonaddchildmeter').disable();
            $w('#repeaterchildmeter').forEachItem($item => { $item('#dropdownchildmeter').disable(); });
            return;
        }
        $w('#buttonaddchildmeter').enable();
        $w('#repeaterchildmeter').forEachItem($item => { $item('#dropdownchildmeter').enable(); });
        safeWait(waitRepeaterRendered('#repeaterchildmeter')).then(() => rebuildChildDropdownOptions());
    });
}

function setSavedetailSummary() {
    const preview = [];
    $w('#repeaternewmeter').forEachItem(($item) => {
        const meterId = ($item('#inputmeterid').value || '').trim();
        const name = ($item('#inputname').value || '').trim();
        const mode = $item('#dropdowntype').value || 'prepaid';
        if (meterId) preview.push(`${meterId} | ${name || '-'} (${mode})`);
    });
    const summary = preview.length
        ? `Total ${preview.length} meter(s)\n\n${preview.join('\n')}`
        : 'No meters to save. Add at least one row and fill Meter ID.';
    const el = $w('#textsavedetail');
    if (el) el.text = summary;
    return summary;
}

function bindButtonsaveneweter() {
    $w('#buttonsaveneweter').onClick(() => {
        setSavedetailSummary();
        $w('#boxnewmeter').expand();
        $w('#boxnewmeter').show();
    });
}

function bindButtonclosenewmeter() {
    $w('#buttonclosenewmeter').onClick(() => { $w('#boxnewmeter').hide(); });
}

function bindButtonaddchildmeter() {
    $w('#buttonaddchildmeter').onClick(async () => {
        $w('#repeaterchildmeter').show();
        const oldData = $w('#repeaterchildmeter').data || [];
        $w('#repeaterchildmeter').data = [...oldData, { _id: `row_${Date.now()}`, meterId: null }];
        await safeWait(waitRepeaterRendered('#repeaterchildmeter'));
        updateChildMeterNumbers();
        rebuildChildDropdownOptions();
    });
}

function updateChildMeterNumbers() {
    $w('#repeaterchildmeter').forEachItem(($item, itemData, index) => {
        $item('#textnumber2').text = `${index + 1})`;
    });
}

function bindButtonupdatebox() {
    $w('#buttonupdatebox').onClick(async () => {
        console.log('[buttonupdatebox] clicked, currentDetailMeter=', currentDetailMeter ? (currentDetailMeter.meterId || currentDetailMeter.id) : null);
        if (!currentDetailMeter) return;
        $w('#buttonupdatebox').label = 'Updating...';
        $w('#buttonupdatebox').disable();
        try {
            const meterId = currentDetailMeter.id || currentDetailMeter._id;
            const newName = ($w('#inputdetailmetername').value || '').trim();
            const rate = Number($w('#inputrate').value || 0);
            console.log('[buttonupdatebox] edit meter: meterId=', meterId, 'newName=', newName, 'rate=', rate);
            if (Number.isNaN(rate) || rate <= 0) {
                $w('#buttonupdatebox').label = 'Invalid Rate';
                setTimeout(() => { $w('#buttonupdatebox').label = 'Update'; $w('#buttonupdatebox').enable(); }, 1500);
                return;
            }
            const updateResult = await updateMeter(meterId, {
                title: newName,
                rate,
                mode: $w('#dropdownmode').value || null
            });
            if (updateResult && updateResult.ok === false) {
                if (updateResult.reason === 'RATE_NOT_IN_PRICE_LIST') {
                    $w('#buttonupdatebox').label = 'Rate not in price list';
                    if ($w('#textsavedetail')) $w('#textsavedetail').text = 'This rate is not in the CNYIOT price list. Add the price (e.g. 1/kwhz) in the platform first, then try again.';
                } else if (updateResult.reason === 'RATE_CREATE_FAILED') {
                    $w('#buttonupdatebox').label = 'Create price failed';
                    if ($w('#textsavedetail')) $w('#textsavedetail').text = 'Could not create price on platform. Please try again or add the price in the platform first.';
                } else {
                    $w('#buttonupdatebox').label = 'Failed';
                }
                setTimeout(() => { $w('#buttonupdatebox').label = 'Update'; $w('#buttonupdatebox').enable(); }, 2000);
                return;
            }
            console.log('[buttonupdatebox] updateMeter result=', updateResult);
            $w('#buttonupdatebox').label = 'Updated';
            if (updateResult && updateResult.meter) {
                currentDetailMeter = updateResult.meter;
                $w('#inputrate').value = updateResult.meter.rate !== undefined && updateResult.meter.rate !== null ? String(updateResult.meter.rate) : $w('#inputrate').value;
                $w('#inputdetailmetername').value = updateResult.meter.title || '';
                $w('#dropdownmode').value = updateResult.meter.mode || null;
                updateTextdetail2FromMeter(updateResult.meter);
            }
            setTimeout(async () => {
                $w('#buttonupdatebox').label = 'Update';
                $w('#buttonupdatebox').enable();
                await switchSectionAsync('sectionlistview');
                await fetchAndFillMeterCache();
                ensureListButtonsEnabled();
                await safeWait(waitRepeaterRendered('#repeatermeter'));
            }, 1200);
        } catch (e) {
            console.error('[buttonupdatebox] UPDATE METER ERROR:', e?.message || e, e?.stack);
            $w('#buttonupdatebox').label = 'Update';
            $w('#buttonupdatebox').enable();
            if (e?.message === 'RATE_NOT_IN_PRICE_LIST' && $w('#textsavedetail')) {
                $w('#textsavedetail').text = 'This rate is not in the CNYIOT price list. Add the price in the platform first.';
            }
            if (e?.message === 'RATE_CREATE_FAILED' && $w('#textsavedetail')) {
                $w('#textsavedetail').text = 'Could not create price on platform. Please try again.';
            }
        }
    });
}

function bindButtondeletemeter() {
    $w('#buttondeletemeter').onClick(async () => {
        if (!currentDetailMeter) return;
        const meterId = currentDetailMeter.id || currentDetailMeter._id;
        await deleteMeter(meterId);
        $w('#boxdelete').hide();
        await switchSectionAsync('sectionlistview');
        await fetchAndFillMeterCache();
        ensureListButtonsEnabled();
    });
}

function bindButtondelete() {
    $w('#buttondelete').onClick(async () => {
        if (!currentDetailMeter) return;
        const ms = Array.isArray(currentDetailMeter.metersharing) ? currentDetailMeter.metersharing : [];
        if (ms.length > 0) {
            $w('#buttondeletemeter').disable();
            const groupId = ms[0].sharinggroupId;
            try {
                const res = await loadGroupList();
                const groups = (res && res.ok !== false) ? (res.groups || []) : [];
                const g = groups.find(gr => gr.groupId === groupId);
                const otherMeters = (g?.meters || []).filter(m => (m._id || m.id) !== (currentDetailMeter.id || currentDetailMeter._id));
                const otherNames = otherMeters.map(m => `• ${m.title || m.meterId}`).join('\n');
                $w('#textdeletedetail').text = `This meter is currently linked with other meters and cannot be deleted.\n\nConnected meters:\n${otherNames || '(none)'}\n\nPlease change this meter to "Single Meter" to remove all connections before deleting.`;
            } catch (_) {
                $w('#textdeletedetail').text = `This meter is linked with other meters. Please change to "Single Meter" before deleting. Group: ${groupId}`;
            }
            $w('#boxdelete').show();
            return;
        }
        if (deleteConfirmPending) {
            const meterId = currentDetailMeter.id || currentDetailMeter._id;
            $w('#buttondelete').disable();
            deleteConfirmPending = false;
            try {
                await deleteMeter(meterId);
                await fetchAndFillMeterCache();
                applyFilterAndSort();
                await safeWait(waitRepeaterRendered('#repeatermeter'));
                await switchSectionAsync('sectionlistview');
                ensureListButtonsEnabled();
            } catch (e) {
                console.error('[buttondelete] delete failed', e?.message || e);
                $w('#buttondelete').enable();
                $w('#buttondelete').label = 'Delete';
            }
            return;
        }
        $w('#buttondelete').label = 'Confirm delete?';
        deleteConfirmPending = true;
    });
}

function bindDropdowngroupmode() {
    $w('#dropdowngroupmode').onChange(async () => {
        if ($w('#dropdowngroupmode').value === 'single') $w('#dropdownsharing').collapse();
        else $w('#dropdownsharing').expand();
        if (groupModeLocked) return;
        const mode = $w('#dropdowngroupmode').value;
        if (mode === 'single' && currentGroupId) {
            $w('#dropdownparent').collapse();
            $w('#repeaterchildmeter').collapse();
            $w('#buttonsubmitgroup').label = 'Delete Meter Group';
            $w('#buttonsubmitgroup').enable();
            return;
        }
        if (!mode || mode === 'single') {
            $w('#dropdownparent').collapse();
            $w('#repeaterchildmeter').collapse();
            return;
        }
        if (mode === 'brother') {
            $w('#dropdownparent').collapse();
            $w('#repeaterchildmeter').expand();
            $w('#buttonaddchildmeter').enable();
            await initChildMeterSection({ _id: null, metersharing: [] });
            return;
        }
        $w('#dropdownparent').expand();
        $w('#repeaterchildmeter').expand();
        $w('#buttonaddchildmeter').disable();
        await initChildMeterSection({ _id: null, metersharing: [] });
        await initParentDropdownOptions();
    });
}

const SYNC_METER_DEFAULT_LABEL = 'Add Meter';

function bindButtonsyncmeter() {
    $w('#buttonsyncmeter').onClick(() => {
        const current = $w('#repeaternewmeter').data || [];
        const blank = {
            _id: `new_${Date.now()}`,
            meterId: '',
            title: '',
            name: '',
            mode: 'prepaid'
        };
        $w('#repeaternewmeter').data = [...current, blank];
        $w('#repeaternewmeter').show();
        if (current.length === 0) $w('#repeaternewmeter').expand();
        $w('#buttonsaveneweter').enable();
    });
}

function bindButtonclosedetail2() {
    $w('#buttonclosedetail2').onClick(async () => {
        groupModeLocked = false;
        $w('#dropdowngroupmode').enable();
        await switchSectionAsync('sectionlistview');
        ensureListButtonsEnabled();
    });
}

/* ====================================================== DETAIL SECTION ====================================================== */
/** Update #textdetail2 and #textmetertitle (if in detail section) from meterdetail (e.g. after sync / after update). */
function updateTextdetail2FromMeter(meterdetail) {
    if (!meterdetail) return;
    const titleText = meterdetail.title || '';
    const tt = $w('#textmetertitle');
    if (tt) tt.text = titleText;
    let propertyName = '-';
    let roomName = 'Null';
    if (meterdetail.propertyShortname) propertyName = meterdetail.propertyShortname;
    if (meterdetail.roomName) roomName = meterdetail.roomName;
    $w('#textdetail2').text = `
Current Property: ${propertyName}
Current Room: ${roomName}
Meter Brand: ${meterdetail.productName || '-'}
Current Balance: ${meterdetail.balance ?? '-'} kwhz
Current Status: ${meterdetail.isOnline ? 'Online' : 'Not online'}
Current Activation: ${meterdetail.status ? 'Active' : 'Non Active'}
`.trim();
}

async function openMeterDetailSection(meterdetail) {
    const meterId = meterdetail.id || meterdetail._id;
    const fresh = await getMeter(meterId);
    const data = fresh || meterdetail;
    switchSectionAsync('sectiondetail');
    await new Promise(r => setTimeout(r, 220));
    currentDetailMeter = data;
    updateTextdetail2FromMeter(data);
    $w('#inputdetailmeterid').value = data.meterId || '';
    $w('#inputdetailmetername').value = data.title || '';
    $w('#inputrate').value = data.rate !== undefined ? String(data.rate) : '';
    $w('#dropdownmode').options = [
        { label: 'Prepaid', value: 'prepaid' },
        { label: 'Postpaid', value: 'postpaid' }
    ];
    $w('#dropdownmode').value = data.mode || null;
    if ($w('#dropdowngroupmode').options.length === 0) {
        $w('#dropdowngroupmode').options = [
            { label: 'Single Meter', value: 'single' },
            { label: 'Parent Meter (Auto)', value: 'parent_auto' },
            { label: 'Parent Meter (Manual)', value: 'parent_manual' },
            { label: 'Brother Meter', value: 'brother' }
        ];
    }
    $w('#dropdowngroupmode').disable();
    groupModeLocked = true;
    $w('#repeaterchildmeter').hide();
    $w('#buttonupdatebox').enable();
    deleteConfirmPending = false;
    if ($w('#buttondelete')) {
        $w('#buttondelete').label = 'Delete';
        $w('#buttondelete').enable();
    }
}

/* ====================================================== CHILD METER / GROUP HELPERS (stub – full logic as in your original) ====================================================== */
function getSharingRow(meter, groupId) {
    return (meter.metersharing || []).find(ms => ms.sharinggroupId === groupId) || null;
}

async function initChildMeterSection(meterdetail, optionalChildData) {
    const mode = $w('#dropdowngroupmode').value;
    const isParentMode = mode === 'parent_auto' || mode === 'parent_manual';
    const isBrotherMode = mode === 'brother';
    if (!isParentMode && !isBrotherMode) {
        $w('#repeaterchildmeter').hide();
        return;
    }
    $w('#repeaterchildmeter').show();
    const res = await getMeterList({ pageSize: 1000 });
    const items = (res && res.ok !== false) ? (res.items || []) : [];
    childMeterOptions = items
        .filter(m => m.status !== false)
        .map(m => ({ label: m.title || m.meterId, value: m.id || m._id, __raw: m }));
    const groupId = currentGroupId;
    let childData = [];
    if (optionalChildData && optionalChildData.length > 0) {
        childData = optionalChildData;
    } else if (groupId && currentGroupMeters && currentGroupMeters.length > 0) {
        const children = currentGroupMeters.filter(m => m.role !== 'parent');
        childData = children.map(m => ({
            _id: `row_${m._id || m.id}`,
            meterId: m._id || m.id,
            active: m.active !== false
        }));
    } else if (groupId && meterdetail && meterdetail.metersharing) {
        const inGroup = (meterdetail.metersharing || []).filter(ms => ms.sharinggroupId === groupId);
        childData = inGroup.map(ms => ({ _id: `row_${ms.meterId || Date.now()}`, meterId: ms.meterId || null, active: ms.active !== false }));
    }
    if (childData.length === 0) childData = [{ _id: `row_${Date.now()}`, meterId: null }];
    $w('#repeaterchildmeter').data = childData;
    await safeWait(waitRepeaterRendered('#repeaterchildmeter'));
    if (typeof updateChildMeterNumbers === 'function') updateChildMeterNumbers();
    if (!childRepeaterBound) {
        childRepeaterBound = true;
        $w('#repeaterchildmeter').onItemReady(($item, itemData, index) => {
            const all = $w('#repeaterchildmeter').data || [];
            const idx = all.findIndex(d => d._id === itemData._id);
            const num = (idx >= 0 ? idx : index) + 1;
            $item('#textnumber2').text = `${num})`;
            $item('#dropdownchildmeter').options = sortOptionsByLabel(childMeterOptions);
            $item('#dropdownchildmeter').value = itemData.meterId || null;
            const mode = $w('#dropdowngroupmode').value;
            const parentSelected = $w('#dropdownparent').value;
            if ((mode === 'parent_auto' || mode === 'parent_manual') && !parentSelected) {
                $item('#dropdownchildmeter').disable();
                $item('#buttonclosechildmeter')?.disable();
            } else {
                $item('#dropdownchildmeter').enable();
                $item('#buttonclosechildmeter')?.enable();
            }
            const cbActive = $item('#checkboxactive');
            if (cbActive) {
                cbActive.checked = itemData.active !== false;
                cbActive.onChange(() => {
                    const data = getChildData();
                    const i = data.findIndex(d => d._id === itemData._id);
                    if (i !== -1) { data[i].active = cbActive.checked === true; $w('#repeaterchildmeter').data = data; }
                });
            }
            $item('#dropdownchildmeter').onChange(() => {
                const data = getChildData();
                const i = data.findIndex(d => d._id === itemData._id);
                if (i !== -1) { data[i].meterId = $item('#dropdownchildmeter').value || null; $w('#repeaterchildmeter').data = data; }
                rebuildChildDropdownOptions();
            });
            const btnClose = $item('#buttonclosechildmeter');
            if (btnClose) {
                btnClose.onClick(() => {
                    const current = $w('#repeaterchildmeter').data || [];
                    const newData = current.filter(d => d._id !== itemData._id);
                    if (newData.length === 0) {
                        $w('#repeaterchildmeter').data = [];
                        $w('#repeaterchildmeter').hide();
                    } else {
                        $w('#repeaterchildmeter').data = newData;
                        safeWait(waitRepeaterRendered('#repeaterchildmeter')).then(() => {
                            updateChildMeterNumbers();
                            rebuildChildDropdownOptions();
                        });
                    }
                });
            }
        });
    }
    if (typeof updateChildMeterNumbers === 'function') updateChildMeterNumbers();
    rebuildChildDropdownOptions();
}

function sortOptionsByLabel(opts) {
    return [...(opts || [])].sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'en', { sensitivity: 'base' }));
}

// A meter can be parent in one group and child in another (grand-parent). We only exclude from this
// group's child list if the meter is already child or peer in another group (not if only parent elsewhere).
function rebuildChildDropdownOptions() {
    const data = $w('#repeaterchildmeter').data || [];
    const selectedIds = data.map(d => d.meterId).filter(Boolean);
    const parentId = $w('#dropdowngroupmode').value === 'brother' ? null : $w('#dropdownparent').value;
    const editingGroupId = currentGroupId;
    $w('#repeaterchildmeter').forEachItem(($item, itemData) => {
        const current = itemData.meterId || null;
        const options = childMeterOptions.filter(opt => {
            if (opt.value === current) return true;
            if (parentId && opt.value === parentId) return false;
            if (selectedIds.includes(opt.value)) return false;
            const meter = opt.__raw;
            if (!meter) return true;
            const ms = getSharingRow(meter, editingGroupId);
            const role = ms?.role;
            const hasOtherGroupAsChildOrPeer = Array.isArray(meter.metersharing) && meter.metersharing.some(x =>
                x.sharinggroupId !== editingGroupId && (x.role === 'child' || x.role === 'peer'));
            if (hasOtherGroupAsChildOrPeer) return false;
            return true;
        });
        $item('#dropdownchildmeter').options = sortOptionsByLabel(options);
        $item('#dropdownchildmeter').value = current;
    });
}

// A meter can be parent in one group and child in another (grand-parent). We only exclude from being
// parent here if the meter is already parent in another group (meter can still be child elsewhere).
async function initParentDropdownOptions() {
    const res = await getMeterList({ pageSize: 1000 });
    const items = (res && res.ok !== false) ? (res.items || []) : [];
    const childData = $w('#repeaterchildmeter').data || [];
    const childIds = childData.map(d => d.meterId).filter(Boolean);
    const editingGroupId = currentGroupId;
    const parentOptions = items.filter(m => {
        const ms = getSharingRow(m, editingGroupId);
        const role = ms?.role;
        const gid = ms?.sharinggroupId;
        if (childIds.includes(m.id || m._id)) return false;
        if (editingGroupId) {
            if (gid === editingGroupId && role === 'parent') return true;
            if (gid === editingGroupId) return false;
        }
        if (gid && gid !== editingGroupId && role === 'parent') return false;
        return true;
    }).map(m => ({ label: m.title || m.meterId, value: m.id || m._id }));
    $w('#dropdownparent').options = sortOptionsByLabel(parentOptions);
    $w('#dropdownparent').enable();
}

function getChildData() {
    return $w('#repeaterchildmeter').data || [];
}

/* ====================================================== NEW METER ====================================================== */
function bindNewMeterButton() {
    if (newMeterBound) return;
    newMeterBound = true;
    $w('#buttonnewmeter').onClick(() => goToNewMeterSection($w('#buttonnewmeter')));
}

async function initNewMeterSection() {
    $w('#boxnewmeter').hide();
    const res = await getActiveMeterProvidersByClient();
    const providers = (res && res.ok !== false) ? (res.providers || []) : [];
    const productOptions = providers.map(p => ({ label: (p.provider || 'CNYIOT').toUpperCase(), value: p.provider || 'CNYIOT' }));
    $w('#repeaternewmeter').data = [];
    $w('#repeaternewmeter').collapse();
    $w('#repeaternewmeter').hide();
    $w('#buttonsaveneweter').disable();
    if ($w('#buttonsyncmeter')) $w('#buttonsyncmeter').label = SYNC_METER_DEFAULT_LABEL;
}

function bindSyncMeterRepeater() {
    if (syncRepeaterBound) return;
    syncRepeaterBound = true;
    $w('#repeaternewmeter').onItemReady(($item, itemData, index) => {
        $item('#textnumber').text = `${index + 1})`;
        const meterInput = $item('#inputmeterid');
        meterInput.value = itemData.meterId || '';
        if (meterInput.enable) meterInput.enable();
        const nameInput = $item('#inputname');
        nameInput.value = itemData.title ?? itemData.name ?? '';
        nameInput.onInput(() => {
            const val = (nameInput.value || '').trim();
            const data = $w('#repeaternewmeter').data;
            const idx = data.findIndex(d => d._id === itemData._id);
            if (idx !== -1) {
                data[idx].title = val;
                data[idx].name = val;
                $w('#repeaternewmeter').data = data;
            }
        });
        const typeDropdown = $item('#dropdowntype');
        typeDropdown.options = [
            { label: 'Prepaid', value: 'prepaid' },
            { label: 'Postpaid', value: 'postpaid' }
        ];
        typeDropdown.value = itemData.mode || 'prepaid';
        if (typeDropdown.enable) typeDropdown.enable();
        const deleteBtn = $item('#buttondeletenewmeter');
        if (deleteBtn) {
            deleteBtn.onClick(() => {
                const currentData = $w('#repeaternewmeter').data || [];
                const newData = currentData.filter(d => d._id !== itemData._id);
                $w('#repeaternewmeter').data = newData;
                if (newData.length === 0) {
                    $w('#repeaternewmeter').collapse();
                    $w('#repeaternewmeter').hide();
                    $w('#buttonsaveneweter').disable();
                } else {
                    updateNewMeterNumbers();
                }
            });
        }
    });
}

function updateNewMeterNumbers() {
    $w('#repeaternewmeter').forEachItem(($item, itemData, index) => {
        $item('#textnumber').text = `${index + 1})`;
    });
}

/* ====================================================== CLIENT TOPUP BOX ====================================================== */
function bindClientTopupBox() {
    $w('#buttonclosetopupclient').onClick(() => {
        $w('#buttonclosetopupclient').disable();
        $w('#boxtopupclient').hide();
        currentDetailMeter = null;
        ensureListButtonsEnabled();
        setTimeout(() => $w('#buttonclosetopupclient').enable(), 300);
    });
    $w('#buttonconfirmtopupclient').onClick(async () => {
        if (!currentDetailMeter) return;
        const sellAmount = Number($w('#inputtopupclient').value || 0);
        if (Number.isNaN(sellAmount) || sellAmount <= 0) return;
        $w('#buttonconfirmtopupclient').disable();
        $w('#buttonclosetopupclient').disable();
        $w('#buttonconfirmtopupclient').label = 'Processing...';
        try {
            const meterId = currentDetailMeter.meterId;
            await clientTopup(meterId, sellAmount);
            await syncMeterByCmsMeterId(meterId);
            $w('#boxtopupclient').hide();
            currentDetailMeter = null;
            await fetchAndFillMeterCache();
            ensureListButtonsEnabled();
        } catch (e) {
            console.error('[CLIENT TOPUP ERROR]', e);
        } finally {
            $w('#buttonconfirmtopupclient').label = 'Confirm';
            $w('#buttonconfirmtopupclient').enable();
            $w('#buttonclosetopupclient').enable();
        }
    });
}

/* ====================================================== METER REPORT ====================================================== */
async function openMeterReportSection({ source, groupId, meters }) {
    lastSectionBeforeMeterReport = activeSection;
    meterReportDateBound = false;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    $w('#datepicker1').value = start;
    $w('#datepicker2').value = end;
    await refreshMeterReport({ source, start, end, meters });
    await switchSectionAsync('sectionmeterreport');
    bindMeterReportDateChange(source, meters);
}

async function refreshMeterReport({ source, start, end, meters }) {
    $w('#datepicker1').disable();
    $w('#datepicker2').disable();
    try {
        const meterIds = meters.map(m => m.meterId);
        const usageSummary = await getUsageSummary({
            meterIds,
            start,
            end
        });
        renderMeterReportText({ source, start, end, meters, usageSummary });
        $w('#html1').postMessage({
            type: 'drawChart',
            payload: JSON.stringify(usageSummary?.records || [])
        });
    } catch (e) {
        console.error('[METER REPORT LOAD ERROR]', e);
        renderMeterReportText({ source, start, end, meters, usageSummary: null });
        $w('#html1').postMessage({ type: 'drawChart', payload: JSON.stringify([]) });
    } finally {
        $w('#datepicker1').enable();
        $w('#datepicker2').enable();
    }
}

function bindMeterReportDateChange(source, meters) {
    if (meterReportDateBound) return;
    meterReportDateBound = true;
    const handler = async () => {
        const start = $w('#datepicker1').value;
        const end = $w('#datepicker2').value;
        if (!start || !end) return;
        await refreshMeterReport({ source, start, end, meters });
    };
    $w('#datepicker1').onChange(handler);
    $w('#datepicker2').onChange(handler);
}

function fmtDate(d) {
    return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function renderMeterReportText({ source, start, end, meters, usageSummary }) {
    let text = `Date from: ${fmtDate(start)}\nDate to: ${fmtDate(end)}\n`;
    const parent = meters.find(m => m.role === 'parent') || (meters.length === 1 ? meters[0] : null);
    if (parent) {
        const parentUsage = usageSummary?.children?.[parent.meterId] ?? (typeof usageSummary?.total === 'number' ? usageSummary.total : null);
        text += `\nMeter ID: ${parent.meterId || '-'}\nMeter Name: ${parent.title || '-'}\nUsage (${fmtDate(start)} → ${fmtDate(end)}): ${parentUsage != null ? `${Number(parentUsage).toFixed(2)} kWhz` : '--'}\n`;
    }
    $w('#textdetail').text = text.trim();
}

/* ====================================================== METER GROUP (stub – wire loadGroupList, deleteGroup, submitGroup) ====================================================== */
function bindMeterGroup() {
    if (meterGroupBound) return;
    meterGroupBound = true;
    $w('#buttongroup').onClick(() => goToGroupSection($w('#buttongroup')));
    if (!groupRepeaterBound) {
        groupRepeaterBound = true;
        $w('#repeatergroup').onItemReady(($item, data) => {
            $item('#textgroupname').text = data.name || `Group ${data.groupId}`;
            $item('#buttondetailgroup').onClick(async () => {
                const parent = data.meters.find(m => m.role === 'parent');
                const children = data.meters.filter(m => m.role !== 'parent');
                if (!parent) return;
                await openMeterReportSection({
                    source: 'group',
                    groupId: data.groupId,
                    meters: [{ ...parent, role: 'parent' }, ...children]
                });
            });
            $item('#buttoneditgroup').onClick(async () => {
                currentGroupId = data.groupId;
                currentGroupMeters = data.meters;
                await openEditGroup();
            });
            $item('#buttondeletegroup').onClick(async () => {
                if (pendingDeleteGroupId !== data.groupId) {
                    pendingDeleteGroupId = data.groupId;
                    $item('#buttondeletegroup').label = 'Confirm Delete';
                    setTimeout(() => { if (pendingDeleteGroupId === data.groupId) { pendingDeleteGroupId = null; $item('#buttondeletegroup').label = 'Delete'; } }, 3000);
                    return;
                }
                await deleteGroup(data.groupId);
                pendingDeleteGroupId = null;
                const res = await loadGroupList();
                $w('#repeatergroup').data = (res && res.ok !== false) ? (res.groups || []) : [];
            });
        });
    }
    $w('#buttoncreategroup').onClick(async () => {
        currentGroupId = null;
        currentGroupMeters = [];
        const btn = $w('#buttoncreategroup');
        btn.disable();
        const origLabel = (btn.label || 'Create Group').toString();
        btn.label = 'Loading...';
        try {
            await switchSectionAsync('sectioncreategroup');
            await initCreateGroupUI();
            activeSection = 'creategroup';
        } finally {
            btn.label = origLabel;
            btn.enable();
        }
    });
    $w('#buttonsubmitgroup').onClick(async () => {
        if (submitGroupLocked) return;
        submitGroupLocked = true;
        try {
            const mode = $w('#dropdowngroupmode').value;
            const groupName = ($w('#inputtextgroupname').value || '').trim();
            if (!groupName) { $w('#text53').text = 'Group name required'; $w('#text53').show(); return; }
            const childIds = [];
            const childActive = {};
            $w('#repeaterchildmeter').forEachItem($item => {
                const id = $item('#dropdownchildmeter').value;
                if (id) childIds.push(id);
            });
            getChildData().forEach(d => {
                if (d.meterId) childActive[d.meterId] = d.active !== false;
            });
            const parentId = $w('#dropdownparent').value;
            await submitGroup({
                groupId: currentGroupId,
                mode,
                groupName,
                sharingType: $w('#dropdownsharing').value || 'percentage',
                parentId: mode === 'brother' ? null : parentId,
                childIds: [...new Set(childIds)].filter(id => id !== parentId),
                childActive
            });
            await switchSectionAsync('sectiongroup');
            const res = await loadGroupList();
            $w('#repeatergroup').data = (res && res.ok !== false) ? (res.groups || []) : [];
        } catch (e) {
            console.error('[SUBMIT GROUP ERROR]', e);
            $w('#text53').text = (e && e.message) || 'Failed';
            $w('#text53').show();
        } finally {
            submitGroupLocked = false;
        }
    });
    $w('#buttonclosecreategroupdetail').onClick(async () => {
        groupModeLocked = false;
        $w('#dropdowngroupmode').enable();
        await switchSectionAsync('sectiongroup');
    });
}

/* ====================================================== MOBILE MENU (Sectionheader: only show & expand on mobile) ====================================================== */
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
    $w('#buttonmeter2').onClick(async () => {
        await goToMeterList($w('#buttonmeter2'));
        $w('#boxmobilemenu').collapse();
        $w('#boxmobilemenu').hide();
        mobileMenuOpen = false;
    });
    $w('#buttonnewmeter2').onClick(async () => {
        await goToNewMeterSection($w('#buttonnewmeter2'));
        $w('#boxmobilemenu').collapse();
        $w('#boxmobilemenu').hide();
        mobileMenuOpen = false;
    });
    $w('#buttongroup2').onClick(async () => {
        await goToGroupSection($w('#buttongroup2'));
        $w('#boxmobilemenu').collapse();
        $w('#boxmobilemenu').hide();
        mobileMenuOpen = false;
    });
}

async function initCreateGroupUI() {
    setGroupModeAndSharingOptions();
    $w('#dropdowngroupmode').value = null;
    $w('#dropdownparent').collapse();
    $w('#repeaterchildmeter').collapse();
    $w('#inputtextgroupname').value = '';
    $w('#dropdowngroupmode').enable();
    groupModeLocked = false;
    $w('#repeaterchildmeter').data = [{ _id: `row_${Date.now()}`, meterId: null }];
    $w('#dropdownsharing').value = 'percentage';
    $w('#dropdownsharing').collapse();
    await initChildMeterSection({ _id: null, metersharing: [] });
}

function setGroupModeAndSharingOptions() {
    $w('#dropdowngroupmode').options = [
        { label: '— Please Select —', value: null },
        { label: 'Single Meter', value: 'single' },
        { label: 'Parent Meter (Auto)', value: 'parent_auto' },
        { label: 'Parent Meter (Manual)', value: 'parent_manual' },
        { label: 'Brother Meter', value: 'brother' }
    ];
    $w('#dropdownsharing').options = [
        { label: 'Percentage', value: 'percentage' },
        { label: 'Divide Equally', value: 'divide_equally' },
        { label: 'Room (Active Only)', value: 'room' }
    ];
}

async function openEditGroup() {
    if (!currentGroupId) return;
    await switchSectionAsync('sectioncreategroup');
    setGroupModeAndSharingOptions();
    const parentMeter = currentGroupMeters.find(m => m.role === 'parent');
    // loadGroupList returns flat groupName/sharingmode/sharingType on each meter (no metersharing array)
    const parentSharing = parentMeter
        ? (getSharingRow(parentMeter, currentGroupId) || {
            groupName: parentMeter.groupName,
            sharingType: parentMeter.sharingType,
            sharingmode: parentMeter.sharingmode
          })
        : null;
    $w('#dropdownsharing').value = parentSharing?.sharingType || 'percentage';
    $w('#dropdownsharing').expand();
    $w('#inputtextgroupname').value = parentSharing?.groupName || '';
    $w('#dropdowngroupmode').value = parentSharing?.sharingmode ?? null;
    $w('#dropdowngroupmode').disable();
    groupModeLocked = true;
    $w('#buttonsubmitgroup').label = 'Update Now';
    $w('#buttonsubmitgroup').enable();
    const childData = currentGroupMeters
        .filter(m => m.role !== 'parent')
        .map(m => ({ _id: `row_${m._id || m.id}`, meterId: m._id || m.id, active: m.active !== false }));
    await initChildMeterSection(parentMeter || { _id: null, metersharing: [] }, childData.length > 0 ? childData : undefined);
    await initParentDropdownOptions();
    $w('#dropdownparent').value = parentMeter?._id || parentMeter?.id || null;
    $w('#dropdownparent').expand();
    $w('#repeaterchildmeter').expand();
    if (parentMeter) {
        $w('#buttonaddchildmeter').enable();
        $w('#repeaterchildmeter').forEachItem($item => {
            $item('#dropdownchildmeter').enable();
            $item('#buttonclosechildmeter')?.enable();
        });
    }
    rebuildChildDropdownOptions();
}
