/* =======================
   Tenancy Setting Page – 前端 Wix + 后端 ECS (backend/saas/tenancysetting + backend/saas/topup)
   - 不读 Wix CMS，全部走 Node API
   - Cache filter + services filter 参考 expenses 页
   - Topup 用 backend/saas/topup

   功能对比旧代码（不少）：
   - Tab: tenancy / topup / view(grid-list) / companysetting
   - Grid: 下拉 property+status、搜索、分页、repeater 卡片、菜单(延租/换房/终止/上传协议/模板协议)、关闭菜单
   - List: 同上 + listView 分页、菜单(延租/换房/终止/取消预约/详情)、取消预约二次确认
   - 延租: 日期/租金/协议费/押金、提交后 switchSection + refresh
   - 换房: 房间下拉(Keep Current + 可用房)、租金/押金/协议费/日期、预览、提交后 switchSection + refresh
   - 终止: 没收金额、确认后 switchSection + refresh
   - 协议: 手动 URL 提交、模板(mode→templates)提交；#sectionagreement 内须有 #datepickeragreement1、#datepickeragreement2（续约期限）、#textnotify（提示，无内容时 hide），提交后 switchSection
   - Topup: 余额、套餐 repeater、选中、Checkout(>1000 提示)、关闭
   - 所有提交类按钮：点击时 disable + label 置为 Loading...，await 完成后再 switch section，finally 里 enable + 恢复 label
======================= */
import { getAccessContext } from 'backend/access/manage';
import wixLocation from 'wix-location';
import { getMyBillingInfo, getCreditPlans, startNormalTopup } from 'backend/saas/topup';
import { submitTicket } from 'backend/saas/help';
import {
    getTenancyList,
    getTenancyFilters,
    extendTenancy,
    changeRoom,
    previewChangeRoomProrate,
    terminateTenancy,
    cancelBooking,
    getRoomsForChange,
    getAgreementTemplates,
    insertAgreement
} from 'backend/saas/tenancysetting';

let changePreviewBound = false;
let uploadSubmitBound = false;
let topupRepeaterBound = false;
let topupCheckoutBound = false;
let topupCloseBound = false;
let listViewRenderCount = 0;
let listViewRenderRequestId = 0;
let listViewRenderResolveMap = {};
let currentListViewRenderId = 0;
let listViewLoading = false;
let lastSectionBeforeAction = 'tenancy';
let openedMenuItemId = null;
let openedGridMenuId = null;
let openedListMenuId = null;
let allTenanciesCache = [];
let tenanciesLoaded = false;
let uploadCloseBound = false;
let listViewFilterBound = false;
let listViewInitialized = false;
let listViewRequestId = 0;
let selectedTopupPlanId = null;
let selectedTopupPlanCache = null;
let isGridView = true;
let listViewPageSize = 20;
let listViewItems = [];
let currentListViewTenancy = null;
let viewToggleBound = false;
let repeaterRenderCount = 0;
let activeSection = null;
let currentTenancyForAgreement = null;
let agreementModeBound = false;
let agreementSubmitBound = false;
let agreementDatepickerBound = false;
let clientCurrency = 'MYR';
let topupInited = false;
let accessCtx = null;
let currentClientId = null;
let __pageInitOnce = false;
let tenancyActionBound = false;
let currentQuery;
let pageSize = 9;
let repeaterItems = [];
let tenancyUIReady = false;
let currentTenancyForExtend = null;
let currentTenancyForChange = null;
let currentTenancyForTerminate = null;

const TENANCY_CACHE_LIMIT = 2000;
let useServerFilter = false;
let tenancyCacheTotal = 0;

const MAIN_SECTIONS = [
    'tenancy', 'topup', 'terminate', 'change', 'extend', 'agreement'
];

const listViewFilterState = {
    keyword: '',
    propertyId: 'ALL',
    status: 'ALL'
};

/** #buttontenancy、#buttontopup、#buttonview、#buttoncompanysetting 在 #sectiontab 内，startInit 时先 disable，完成后再 enable */
const SECTIONTAB_BUTTON_IDS = ['#buttontenancy', '#buttontopup', '#buttonview', '#buttoncompanysetting'];

$w.onReady(() => {
    if (__pageInitOnce) return;
    __pageInitOnce = true;
    [
        '#sectiondefault', '#sectionuploadagreement', '#sectiontenancy', '#sectionextend',
        '#sectionchange', '#sectionterminate', '#sectiontopup', '#sectionagreement',
        '#sectionlistview'
    ].forEach(id => $w(id).collapse());
    $w('#sectiontab').expand();
    $w('#sectiondefault').expand();
    $w('#textstatusloading').text = 'Loading...';
    $w('#textstatusloading').show();
    SECTIONTAB_BUTTON_IDS.forEach(id => $w(id).disable?.());
    startInitAsync();
});

async function startInitAsync() {
    try {
        accessCtx = await getAccessContext();
        if (!accessCtx?.ok) {
            showAccessDenied('You don\'t have permission');
            return;
        }
        clientCurrency = String(accessCtx.client?.currency || 'MYR').toUpperCase();
        if (!accessCtx.client?.active) {
            showAccessDenied('Client inactive');
            return;
        }
        if ($w('#buttonclosedetail')) {
            $w('#buttonclosedetail').onClick(() => $w('#boxdetail').hide());
        }
        currentClientId = accessCtx.client.id;
        if (accessCtx.credit?.ok === false) {
            enableTopupOnly();
            return;
        }
        if (!accessCtx.staff?.permission?.tenantdetail && !accessCtx.staff?.permission?.admin) {
            showAccessDenied("You don't have permission");
            return;
        }
        await setupDropdownFilters();
        bindTenancyActions();
        bindListViewMenuButtons();
        bindAgreementMenuButtons();
        bindTopupCloseButton();
        $w('#textstatusloading').hide();
        SECTIONTAB_BUTTON_IDS.forEach(id => $w(id).enable?.());
        tenancyUIReady = true;

        $w('#buttontenancy').onClick(async () => {
            if (!tenancyUIReady) return;
            $w('#buttontenancy').disable();
            $w('#sectiondefault').expand();
            $w('#text19').text = 'Loading...';
            $w('#text19').show();
            await filterAndDisplay(1);
            $w('#text19').hide();
            await switchSectionAsync('tenancy');
            $w('#buttontenancy').enable();
        });

        $w('#buttontopup').onClick(async () => {
            lastSectionBeforeAction = activeSection || 'tenancy';
            const btnTopup = $w('#buttontopup');
            let topupLabel;
            try { topupLabel = btnTopup.label; } catch (_) {}
            btnTopup.disable();
            if (!topupInited) {
                try { btnTopup.label = 'Loading...'; } catch (_) {}
                await initTopupSection();
                topupInited = true;
            }
            await switchSectionAsync('topup');
            btnTopup.enable();
            try { if (topupLabel !== undefined) btnTopup.label = topupLabel; } catch (_) {}
        });

        if (!viewToggleBound) {
            $w('#buttonview').onClick(async () => {
                if (!tenancyUIReady) return;
                const btnView = $w('#buttonview');
                btnView.disable();
                try { btnView.label = 'Loading...'; } catch (_) {}
                isGridView = !isGridView;
                try {
                    if (isGridView) {
                        await switchSectionAsync('tenancy');
                        btnView.label = 'List View';
                    } else {
                        if (!listViewInitialized) {
                            await initListView();
                            listViewInitialized = true;
                        }
                        await switchSectionAsync('listview');
                        btnView.label = 'Grid View';
                    }
                } finally {
                    btnView.enable();
                }
            });
            viewToggleBound = true;
        }
    } catch (err) {
        console.error('[TENANCY INIT FAILED]', err);
        showAccessDenied('Unable to verify account');
    }
}

/** 初始化下拉：从 ECS 取 properties + status 选项（参考 expenses filters） */
async function setupDropdownFilters() {
    const res = await getTenancyFilters();
    const properties = res.properties || [];
    const options1 = [
        { label: 'All', value: 'ALL' },
        ...properties.filter(p => p.value !== 'ALL').map(p => ({ label: p.label, value: p.value }))
    ];
    $w('#dropdown1').options = options1;
    $w('#dropdown1').value = 'ALL';
    $w('#dropdown2').options = [
        { label: 'All', value: 'ALL' },
        { label: 'Active', value: 'true' },
        { label: 'Inactive', value: 'false' }
    ];
    $w('#dropdown2').value = 'ALL';
    $w('#input1').onInput(() => filterAndDisplay(1));
    $w('#dropdown1').onChange(() => filterAndDisplay(1));
    $w('#dropdown2').onChange(() => filterAndDisplay(1));
    $w('#paginationtenantmanagement').onChange(ev => filterAndDisplay(ev.target.currentPage));
}

/** 拉取 tenancy 列表：若 total <= CACHE_LIMIT 则全量进 cache，否则走 server 分页 */
async function loadAllTenanciesIfNeeded() {
    if (tenanciesLoaded && !useServerFilter) return;
    const searchValue = ($w('#input1').value || '').trim();
    const selectedProperty = $w('#dropdown1').value;
    const selectedStatus = $w('#dropdown2').value;
    let res;
    try {
        res = await getTenancyList({
            propertyId: selectedProperty,
            status: selectedStatus,
            search: searchValue || undefined,
            sort: 'room',
            limit: TENANCY_CACHE_LIMIT
        });
    } catch (e) {
        console.error('[tenancysetting] getTenancyList failed:', e);
        res = { items: [], total: 0, _error: 'REQUEST_FAILED' };
    }
    if (res._error) console.warn('[tenancysetting] list _error:', res._error);
    const total = res.total || 0;
    const items = Array.isArray(res.items) ? res.items : [];
    if (total <= TENANCY_CACHE_LIMIT) {
        allTenanciesCache = items;
        tenancyCacheTotal = total;
        useServerFilter = false;
        tenanciesLoaded = true;
    } else {
        allTenanciesCache = [];
        tenancyCacheTotal = total;
        useServerFilter = true;
        tenanciesLoaded = true;
    }
}

/** 根据 cache 或 server 过滤并展示（参考 expenses applyFilterAndSort） */
async function filterAndDisplay(pageIndex) {
    repeaterItems = [];
    await loadAllTenanciesIfNeeded();

    const searchValue = ($w('#input1').value || '').trim().toLowerCase();
    const selectedProperty = $w('#dropdown1').value;
    const selectedStatus = $w('#dropdown2').value;
    const today = new Date();

    let items;
    let totalPages;
    if (useServerFilter) {
        let res;
        try {
            res = await getTenancyList({
                propertyId: selectedProperty,
                status: selectedStatus,
                search: searchValue || undefined,
                sort: 'room',
                page: pageIndex,
                pageSize
            });
        } catch (e) {
            console.error('[tenancysetting] getTenancyList(page) failed:', e);
            res = { items: [], totalPages: 1 };
        }
        items = Array.isArray(res.items) ? res.items : [];
        totalPages = res.totalPages || 1;
    } else {
        items = [...allTenanciesCache];
        if (selectedStatus !== 'ALL') {
            if (selectedStatus === 'true') items = items.filter(t => t.status === true || (t.end && new Date(t.end) >= today));
            if (selectedStatus === 'false') items = items.filter(t => t.status === false || (t.end && new Date(t.end) < today));
        }
        if (selectedProperty !== 'ALL') {
            items = items.filter(t => {
                const propertyId = t.room?.property?._id ?? t.property?._id ?? t.property?.id;
                return propertyId === selectedProperty;
            });
        }
        if (searchValue) {
            items = items.filter(t =>
                (t.remark || '').toLowerCase().includes(searchValue) ||
                (t.room?.title_fld || '').toLowerCase().includes(searchValue) ||
                (t.tenant?.fullname || '').toLowerCase().includes(searchValue)
            );
        }
        items.sort((a, b) => {
            if (a.status === 'pending_approval' && b.status !== 'pending_approval') return -1;
            if (b.status === 'pending_approval' && a.status !== 'pending_approval') return 1;
            return (a.room?.title_fld || '').localeCompare(b.room?.title_fld || '');
        });
        totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    }

    const start = (pageIndex - 1) * pageSize;
    const pageItems = useServerFilter ? items : items.slice(start, start + pageSize);

    $w('#repeatertenantmanagement').data = pageItems;
    $w('#paginationtenantmanagement').totalPages = totalPages;
    $w('#paginationtenantmanagement').currentPage = pageIndex;
}

function disableRepeaterButtons() {
    repeaterItems.forEach(obj => {
        const $i = obj.$item;
        if ($i('#buttonterminate')) $i('#buttonterminate').disable();
        if ($i('#buttonextend')) $i('#buttonextend').disable();
        if ($i('#buttonchange')) $i('#buttonchange').disable();
    });
}

function enableRepeaterButtons() {
    if (!accessCtx || accessCtx.credit?.ok === false ||
        (!accessCtx.staff.permission.tenantdetail && !accessCtx.staff.permission.admin)) return;
    repeaterItems.forEach(obj => {
        const $i = obj.$item;
        if ($i('#buttonterminate')) $i('#buttonterminate').enable();
        if ($i('#buttonextend')) $i('#buttonextend').enable();
        if ($i('#buttonchange')) $i('#buttonchange').enable();
    });
}

function enableTopupOnly() {
    disableRepeaterButtons();
    lastSectionBeforeAction = activeSection || 'default';
    $w('#text19').text = 'Insufficient credit. Please top up to continue.';
    $w('#text19').show();
    switchSectionAsync('topup');
}

function showAccessDenied(message) {
    disableRepeaterButtons();
    $w('#text19').text = message || 'You don\'t have permission';
    $w('#text19').show();
    switchSectionAsync('default');
}

function bindTenancyActions() {
    if (tenancyActionBound) return;
    tenancyActionBound = true;

    $w('#buttonextensionsubmit').onClick(async () => {
        const btn = $w('#buttonextensionsubmit');
        let origLabel;
        try { origLabel = btn.label; } catch (_) {}
        btn.disable();
        try { btn.label = 'Loading...'; } catch (_) {}
        try {
            const newEnd = $w('#datepickerextension').value;
            const newRental = Number($w('#inputextension').value || 0);
            const agreementFees = Number($w('#inputextend').value || 0);
            const newDeposit = Number($w('#inputextenddeposit').value || 0);
            if (!currentTenancyForExtend?._id) throw new Error('No tenancy selected');
            if (!newEnd || !newRental || newRental <= 0) throw new Error('Invalid input for extend tenancy');
            const result = await extendTenancy(currentTenancyForExtend._id, {
                newEnd, newRental, agreementFees, newDeposit
            });
            if (!result?.success) throw new Error(result?.message || 'Extend failed');
            tenanciesLoaded = false;
            $w('#text19').hide();
            $w('#inputextend').value = '';
            await switchSectionAsync(lastSectionBeforeAction);
            enableRepeaterButtons();
            await filterAndDisplay(1);
        } catch (err) {
            console.error('Extend error:', err);
            $w('#text19').text = err.message || 'Extend tenancy failed';
            $w('#text19').show();
        } finally {
            btn.enable();
            try { if (origLabel !== undefined) btn.label = origLabel; } catch (_) {}
        }
    });

    $w('#buttonchangesubmit').onClick(async () => {
        const btn = $w('#buttonchangesubmit');
        let origLabel;
        try { origLabel = btn.label; } catch (_) {}
        btn.disable();
        try { btn.label = 'Loading...'; } catch (_) {}
        try {
            if (!currentTenancyForChange?._id) throw new Error('No tenancy selected');
            const newRoomId = $w('#dropdownchange').value;
            const newEnd = $w('#datepickerchange').value;
            const changeDate = $w('#datepickerchange').value;
            const newRental = Number($w('#inputrental').value);
            const newDeposit = Number($w('#inputdeposit').value);
            const agreementFees = Number($w('#inputagreementfees').value);
            if (!newRoomId || !newEnd || !newRental || newRental <= 0) throw new Error('Invalid input');
            const result = await changeRoom(currentTenancyForChange._id, {
                newRoomId, newRental, newEnd, agreementFees, changeDate, newDeposit
            });
            if (!result?.success) throw new Error(result?.message || 'Change failed');
            tenanciesLoaded = false;
            $w('#text19').hide();
            await switchSectionAsync(lastSectionBeforeAction);
            enableRepeaterButtons();
            await filterAndDisplay(1);
        } catch (err) {
            console.error('Change error:', err);
            $w('#text19').text = err.message || 'Change failed';
            $w('#text19').show();
        } finally {
            btn.enable();
            try { if (origLabel !== undefined) btn.label = origLabel; } catch (_) {}
        }
    });

    $w('#buttoncloseterminate').onClick(() => switchSectionAsync(lastSectionBeforeAction));
    $w('#buttonclosechange').onClick(() => switchSectionAsync(lastSectionBeforeAction));
    $w('#buttoncloseextend').onClick(() => switchSectionAsync(lastSectionBeforeAction));

    $w('#buttonterminateconfirm').onClick(async () => {
        const btn = $w('#buttonterminateconfirm');
        let origLabel;
        try { origLabel = btn.label; } catch (_) {}
        btn.disable();
        try { btn.label = 'Loading...'; } catch (_) {}
        try {
            if (!currentTenancyForTerminate?._id) throw new Error('No tenancy selected');
            const forfeitAmount = Number($w('#inputforfeitamount').value || 0);
            if (isNaN(forfeitAmount) || forfeitAmount < 0) throw new Error('Invalid forfeit amount');
            $w('#text19').text = 'Processing termination...';
            $w('#text19').show();
            const result = await terminateTenancy(currentTenancyForTerminate._id, forfeitAmount);
            if (!result?.success) throw new Error(result?.message || 'Terminate failed');
            tenanciesLoaded = false;
            $w('#text19').hide();
            await switchSectionAsync(lastSectionBeforeAction);
            enableRepeaterButtons();
            await filterAndDisplay(1);
        } catch (err) {
            console.error('Terminate error:', err);
            $w('#text19').text = err.message || 'Terminate failed';
            $w('#text19').show();
        } finally {
            btn.enable();
            try { if (origLabel !== undefined) btn.label = origLabel; } catch (_) {}
        }
    });

    bindAgreementSection();
}

async function initTopupSection() {
    const billing = await getMyBillingInfo();
    const credits = Array.isArray(billing.credit) ? billing.credit : [];
    const totalCredit = credits.reduce((s, c) => s + Number(c.amount || 0), 0);
    $w('#textcurrentcredit').text = `Current Credit Balance: ${totalCredit}`;
    const plans = await getCreditPlans();
    $w('#repeatertopup').data = Array.isArray(plans) ? plans : [];
    if (!topupRepeaterBound) {
        $w('#repeatertopup').onItemReady(($item, plan) => {
            const pid = plan._id || plan.id;
            $item('#textamount').text = `${clientCurrency} ${plan.sellingprice}`;
            $item('#textcreditamount').text = String(plan.credit);
            $item('#textcredit').text = 'Credits';
            $item('#boxcolor').hide();
            $item('#containertopup').onClick(() => {
                selectedTopupPlanId = pid;
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
                        clientId: currentClientId || undefined
                    });
                } catch (e) {
                    console.warn('[tenancysetting] submitTicket topup_manual failed', e);
                }
                return;
            }
            const btnCheckout = $w('#buttoncheckout');
            let origCheckoutLabel;
            try { origCheckoutLabel = btnCheckout.label; } catch (_) {}
            btnCheckout.disable();
            try { btnCheckout.label = 'Loading...'; } catch (_) {}
            try {
                const res = await startNormalTopup({
                    creditPlanId: selectedTopupPlanId,
                    redirectUrl: wixLocation.url,
                    returnUrl: wixLocation.url
                });
                if (!res?.url) throw new Error('NO_PAYMENT_URL');
                wixLocation.to(res.url);
            } catch (e) {
                console.error('[TOPUP FAILED]', e);
                btnCheckout.enable();
                try { if (origCheckoutLabel !== undefined) btnCheckout.label = origCheckoutLabel; } catch (_) {}
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
        await switchSectionAsync(lastSectionBeforeAction || 'tenancy');
    });
}

async function switchSectionAsync(sectionKey) {
    if (activeSection === sectionKey) return;
    openedMenuItemId = null;
    openedGridMenuId = null;
    openedListMenuId = null;
    currentListViewTenancy = null;
    if ($w('#boxmenu')) $w('#boxmenu').hide();
    if ($w('#boxmenu2')) $w('#boxmenu2').hide();
    const ALL_SECTIONS = ['default', 'tenancy', 'listview', 'extend', 'change', 'terminate', 'topup', 'agreement', 'uploadagreement'];
    ALL_SECTIONS.forEach(key => {
        const sec = $w(`#section${key}`);
        if (sec) sec.collapse();
    });
    const target = $w(`#section${sectionKey}`);
    if (target) target.expand();
    activeSection = sectionKey;
    /* #sectiontab 不 collapse/hide，始终展开 */
    if (target) await target.scrollTo();
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

async function initListViewDropdowns() {
    const res = await getTenancyFilters();
    const properties = res.properties || [];
    $w('#dropdownlistviewproperty').options = [
        { label: 'All', value: 'ALL' },
        ...properties.filter(p => p.value !== 'ALL').map(p => ({ label: p.label, value: p.value }))
    ];
    $w('#dropdownlistviewproperty').value = 'ALL';
    $w('#dropdownlistviewstatus').options = [
        { label: 'All', value: 'ALL' },
        { label: 'Active', value: 'true' },
        { label: 'Inactive', value: 'false' }
    ];
    $w('#dropdownlistviewstatus').value = 'ALL';
    if (!listViewFilterBound) {
        $w('#inputlistviewsearch').onInput(() => {
            listViewFilterState.keyword = ($w('#inputlistviewsearch').value || '').trim().toLowerCase();
            reloadListView(1);
        });
        $w('#dropdownlistviewproperty').onChange(() => {
            listViewFilterState.propertyId = $w('#dropdownlistviewproperty').value || 'ALL';
            reloadListView(1);
        });
        $w('#dropdownlistviewstatus').onChange(() => {
            listViewFilterState.status = $w('#dropdownlistviewstatus').value || 'ALL';
            reloadListView(1);
        });
        $w('#paginationlistview').onChange(e => reloadListView(e.target.currentPage));
        listViewFilterBound = true;
    }
}

async function initListView() {
    listViewLoading = true;
    listViewFilterState.keyword = '';
    listViewFilterState.propertyId = 'ALL';
    listViewFilterState.status = 'ALL';
    await initListViewDropdowns();
    $w('#inputlistviewsearch').value = '';
    $w('#dropdownlistviewproperty').value = 'ALL';
    $w('#dropdownlistviewstatus').value = 'ALL';
    await loadListView(1);
    listViewLoading = false;
}

async function loadListView(page) {
    await loadAllTenanciesIfNeeded();
    const { keyword, propertyId, status } = listViewFilterState;
    const today = new Date();
    let items;
    let totalPages = 1;
    if (useServerFilter) {
        const res = await getTenancyList({
            propertyId,
            status,
            search: keyword || undefined,
            sort: 'room',
            page,
            pageSize: listViewPageSize
        });
        items = res.items || [];
        totalPages = res.totalPages || 1;
    } else {
        let list = [...allTenanciesCache];
        if (status !== 'ALL') {
            if (status === 'true') list = list.filter(t => t.status === true || (t.end && new Date(t.end) >= today));
            if (status === 'false') list = list.filter(t => t.status === false || (t.end && new Date(t.end) < today));
        }
        if (propertyId !== 'ALL') {
            list = list.filter(t => {
                const pId = t.property?._id ?? t.property?.id ?? t.room?.property?._id;
                return pId === propertyId;
            });
        }
        if (keyword) {
            list = list.filter(t =>
                (t.remark || '').toLowerCase().includes(keyword) ||
                (t.room?.title_fld || '').toLowerCase().includes(keyword) ||
                (t.tenant?.fullname || '').toLowerCase().includes(keyword)
            );
        }
        list.sort((a, b) => (a.room?.title_fld || '').localeCompare(b.room?.title_fld || ''));
        totalPages = Math.max(1, Math.ceil(list.length / listViewPageSize));
        const start = (page - 1) * listViewPageSize;
        items = list.slice(start, start + listViewPageSize);
    }
    $w('#repeaterlistview').data = items;
    $w('#paginationlistview').totalPages = totalPages;
    $w('#paginationlistview').currentPage = page;
}

function openListViewDetail(tenancy, tenant, room) {
    $w('#textlistview2').text = room?.title_fld || '';
    $w('#textliveview6').text = tenant?.fullname || '';
    $w('#textliveviewcontact').text = tenant?.phone || '';
    $w('#textrental').text = `RM ${tenancy?.rental || 0}`;
    if (tenancy.begin && tenancy.end) {
        const f = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        $w('#textliveview8').text = `${f.format(new Date(tenancy.begin))} - ${f.format(new Date(tenancy.end))}`;
    }
    $w('#boxdetail').show();
}

$w('#repeaterlistview').onItemReady(($item, tenancy) => {
    const room = tenancy.room;
    const tenant = tenancy.tenant;
    const isPending = tenancy.status === 'pending_approval';
    const isActive = tenancy.status === true;
    if (isPending) $item('#boxlistview').style.backgroundColor = '#fff3cd';
    else $item('#boxlistview').style.backgroundColor = isActive ? '#dff5f2' : '#fde2e2';
    const roomLabel = room?.title_fld || '';
    const tenantName = tenant?.fullname || '';
    $item('#textlistviewproperty').text = tenantName ? `${roomLabel} - ${tenantName}` : roomLabel;
    $item('#boxmenu2').hide();
    if (isPending) {
        $item('#buttonterminate2')?.hide();
        $item('#buttonextend2')?.hide();
        $item('#buttonchange2')?.hide();
        $item('#buttoncancel2')?.show();
    } else {
        $item('#buttonterminate2')?.show();
        $item('#buttonextend2')?.show();
        $item('#buttonchange2')?.show();
        $item('#buttoncancel2')?.hide();
    }
    $item('#buttonmenu2').onClick(() => {
        if (openedListMenuId === tenancy._id) {
            openedListMenuId = null;
            $item('#boxmenu2').hide();
            return;
        }
        $w('#repeaterlistview').forEachItem($i => $i('#boxmenu2').hide());
        openedListMenuId = tenancy._id;
        currentListViewTenancy = { tenancy, tenant };
        $item('#boxmenu2').show();
    });
    $item('#buttondetail').onClick(() => openListViewDetail(tenancy, tenant, room));
});

$w('#repeatertenantmanagement').onItemReady(($item, tenancy) => {
    repeaterItems.push({ $item, tenancy });
    const room = tenancy.room;
    const tenant = tenancy.tenant;
    const property = tenancy.property || tenancy.room?.property;
    const isPending = tenancy.status === 'pending_approval';
    const isActive = tenancy.status === true;
    if (isPending) $item('#box1').style.backgroundColor = '#fff3cd';
    else $item('#box1').style.backgroundColor = isActive ? '#dff5f2' : '#fde2e2';
    $item('#text1').text = property?.shortname || 'No Property';
    $item('#text2').text = room?.title_fld || 'No Room';
    $item('#text3').text = 'RM ' + (tenancy.rental || 0);
    $item('#text6').text = tenant?.fullname || '';
    $item('#textcontact').text = tenant?.phone || '';
    if (tenancy.begin && tenancy.end) {
        const f = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        $item('#text8').text = `${f.format(new Date(tenancy.begin))} - ${f.format(new Date(tenancy.end))}`;
    }
    $item('#buttoncancel')?.hide();
    if (isPending) {
        $item('#buttonterminate')?.hide();
        $item('#buttonextend')?.hide();
        $item('#buttonchange')?.hide();
        $item('#buttoncancel')?.show();
    } else {
        $item('#buttonterminate')?.show();
        $item('#buttonextend')?.show();
        $item('#buttonchange')?.show();
    }
    $item('#boxmenu').hide();
    $item('#buttonmenu').onClick(() => {
        if (openedMenuItemId === tenancy._id) {
            openedMenuItemId = null;
            $item('#boxmenu').hide();
            enableRepeaterButtons();
            return;
        }
        $w('#repeatertenantmanagement').forEachItem($i => $i('#boxmenu').hide());
        openedMenuItemId = tenancy._id;
        disableRepeaterButtons();
        $item('#boxmenu').show();
    });
    $item('#buttonclosemenu').onClick(() => {
        openedMenuItemId = null;
        $item('#boxmenu').hide();
        enableRepeaterButtons();
    });
});

async function reloadListView(page = 1) {
    const reqId = ++listViewRequestId;
    listViewLoading = true;
    $w('#paginationlistview').disable();
    await loadListView(page);
    if (reqId !== listViewRequestId) return;
    $w('#paginationlistview').enable();
    listViewLoading = false;
}

function openTerminateBox(tenancy, tenant) {
    currentTenancyForTerminate = tenancy;
    lastSectionBeforeAction = activeSection || 'tenancy';
    const depositAmount = Number(tenancy?.deposit ?? tenancy?.depositamount ?? 0);
    $w('#texttitleterminate').text = 'Terminate & Forfeit';
    $w('#textterminatename').text = tenant?.fullname || 'Unknown Tenant';
    $w('#textdepositamount').text = `Deposit RM ${depositAmount}`;
    $w('#inputforfeitamount').value = String(depositAmount);
    switchSectionAsync('terminate');
}

function openExtendBox(tenancy) {
    currentTenancyForExtend = tenancy;
    lastSectionBeforeAction = activeSection || 'tenancy';
    $w('#texttitleextend').text = 'Extend Tenancy';
    if (tenancy.end) $w('#datepickerextension').value = new Date(tenancy.end);
    const depositAmount = Number(tenancy?.deposit ?? tenancy?.depositamount ?? 0);
    $w('#inputextenddeposit').value = String(depositAmount);
    switchSectionAsync('extend');
}

async function openChangeBox(tenancy, tenant) {
    currentTenancyForChange = tenancy;
    lastSectionBeforeAction = activeSection || 'tenancy';
    $w('#texttitlechange').text = 'Change Room / Adjust Rental';
    $w('#textchangename').text = tenant?.fullname || 'Unknown Tenant';
    $w('#inputagreementfees').value = '250';
    const depositAmount = Number(tenancy?.deposit ?? tenancy?.depositamount ?? 0);
    $w('#inputdeposit').value = String(depositAmount);
    $w('#inputrental').value = String(tenancy?.rental || 0);
    const rooms = await getRoomsForChange(tenancy.room?._id || tenancy.room);
    $w('#dropdownchange').options = [
        { label: 'Keep Current Room', value: tenancy.room?._id || tenancy.room },
        ...rooms.map(r => ({ label: r.title_fld, value: r._id || r.id }))
    ];
    $w('#dropdownchange').value = tenancy.room?._id || tenancy.room;
    if (tenancy.end) $w('#datepickerchange').value = new Date(tenancy.end);
    bindChangePreview(tenancy);
    switchSectionAsync('change');
}

let listMenuBound = false;

function bindListViewMenuButtons() {
    if (listMenuBound) return;
    listMenuBound = true;
    $w('#buttonterminate2').onClick(() => {
        if (!currentListViewTenancy) return;
        openedListMenuId = null;
        $w('#boxmenu2').hide();
        openTerminateBox(currentListViewTenancy.tenancy, currentListViewTenancy.tenant);
    });
    $w('#buttonclosemenu2').onClick(() => {
        openedListMenuId = null;
        currentListViewTenancy = null;
        $w('#boxmenu2').hide();
    });
    let confirmDeleteMode = false;
    $w('#buttoncancel2').onClick(async () => {
        if (!currentListViewTenancy) return;
        const btn = $w('#buttoncancel2');
        if (!confirmDeleteMode) {
            confirmDeleteMode = true;
            btn.label = 'Confirm Delete Booking';
            btn.style.backgroundColor = '#dc3545';
            return;
        }
        const tenancy = currentListViewTenancy.tenancy;
        let origCancelLabel;
        try { origCancelLabel = btn.label; } catch (_) {}
        btn.disable();
        try { btn.label = 'Loading...'; } catch (_) {}
        try {
            await cancelBooking(tenancy._id);
            tenanciesLoaded = false;
            confirmDeleteMode = false;
            btn.label = 'Delete Booking';
            btn.style.backgroundColor = '';
            openedListMenuId = null;
            $w('#boxmenu2').hide();
            await switchSectionAsync(lastSectionBeforeAction);
            await filterAndDisplay(1);
            await reloadListView(1);
        } catch (err) {
            console.error('Cancel booking failed:', err);
        } finally {
            btn.enable();
            if (confirmDeleteMode) {
                try { if (origCancelLabel !== undefined) btn.label = origCancelLabel; } catch (_) {}
            } else {
                try { btn.label = 'Delete Booking'; } catch (_) {}
            }
        }
    });
    $w('#buttonextend2').onClick(() => {
        if (!currentListViewTenancy) return;
        openedListMenuId = null;
        $w('#boxmenu2').hide();
        openExtendBox(currentListViewTenancy.tenancy);
    });
    $w('#buttonchange2').onClick(() => {
        if (!currentListViewTenancy) return;
        openedListMenuId = null;
        $w('#boxmenu2').hide();
        openChangeBox(currentListViewTenancy.tenancy, currentListViewTenancy.tenant);
    });
}

function bindChangePreview(currentTenancy) {
    if (!currentTenancy) return;
    const oldRental = Number(currentTenancy.rental || 0);
    async function calculatePreview() {
        const newRental = Number($w('#inputrental').value || 0);
        const changeDate = $w('#datepickerchange').value;
        const depositTopup = Number($w('#inputdeposit').value || 0);
        const agreement = Number($w('#inputagreementfees').value || 0);
        if (newRental < oldRental) {
            $w('#textchangedetail').text = 'Rental cannot be reduced.';
            return;
        }
        if (!changeDate) {
            $w('#textchangedetail').text = 'Please select change date.';
            return;
        }
        const today = new Date();
        const selected = new Date(changeDate);
        const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        if (selected < todayOnly) {
            $w('#textchangedetail').text = 'Change date cannot be in the past.';
            return;
        }
        try {
            const { prorate } = await previewChangeRoomProrate({
                oldRental,
                newRental,
                changeDate
            });
            const total = Number(prorate || 0) + depositTopup + agreement;
            $w('#textchangedetail').text =
                `Total Topup by Tenant\n\n` +
                `Prorate: ${clientCurrency} ${Number(prorate || 0).toFixed(2)}\n` +
                `Deposit Topup: ${clientCurrency} ${depositTopup.toFixed(2)}\n` +
                `Agreement Fees: ${clientCurrency} ${agreement.toFixed(2)}\n` +
                `Start from: ${selected.toLocaleDateString()}\n\n----------------------------------\n` +
                `Total Payable: ${clientCurrency} ${total.toFixed(2)}`;
        } catch (err) {
            console.error('Preview error:', err);
            $w('#textchangedetail').text = 'Unable to calculate preview.';
        }
    }
    if (!changePreviewBound) {
        $w('#inputrental').onInput(calculatePreview);
        $w('#inputdeposit').onInput(calculatePreview);
        $w('#inputagreementfees').onInput(calculatePreview);
        $w('#datepickerchange').onChange(calculatePreview);
        changePreviewBound = true;
    }
    calculatePreview();
}

function bindAgreementMenuButtons() {
    $w('#buttonuploadagreement').onClick(() => {
        if (!openedMenuItemId) return;
        const itemObj = repeaterItems.find(obj => obj.tenancy._id === openedMenuItemId);
        if (!itemObj) return;
        currentTenancyForAgreement = itemObj.tenancy;
        lastSectionBeforeAction = activeSection || 'tenancy';
        $w('#boxmenu').hide();
        openedMenuItemId = null;
        openUploadAgreementSection(itemObj.tenancy);
    });
    $w('#buttonuploadagreement2').onClick(() => {
        if (!currentListViewTenancy) return;
        currentTenancyForAgreement = currentListViewTenancy.tenancy;
        lastSectionBeforeAction = activeSection || 'listview';
        $w('#boxmenu2').hide();
        openedListMenuId = null;
        openUploadAgreementSection(currentListViewTenancy.tenancy);
    });
    $w('#buttonagreement').onClick(() => {
        if (!openedMenuItemId) return;
        const itemObj = repeaterItems.find(obj => obj.tenancy._id === openedMenuItemId);
        if (!itemObj) return;
        currentTenancyForAgreement = itemObj.tenancy;
        lastSectionBeforeAction = activeSection || 'tenancy';
        $w('#boxmenu').hide();
        openedMenuItemId = null;
        openAgreementSection(itemObj.tenancy);
    });
    $w('#buttonagreement2').onClick(() => {
        if (!currentListViewTenancy) return;
        currentTenancyForAgreement = currentListViewTenancy.tenancy;
        lastSectionBeforeAction = activeSection || 'listview';
        $w('#boxmenu2').hide();
        openedListMenuId = null;
        openAgreementSection(currentListViewTenancy.tenancy);
    });
}

/** Set date to YYYY-MM-DD for API; Wix DatePicker .value is Date. */
function toDateValue(d) {
    if (d == null) return undefined;
    const date = d instanceof Date ? d : new Date(d);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

function formatDateForNotify(d) {
    if (d == null) return '';
    const date = d instanceof Date ? d : new Date(d);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/** Extend: 续约日期范围 = previous_end（合约到期）→ end（新到期）。New: begin → end。 */
function getAgreementDateRange(tenancy) {
    const end = tenancy?.end ? new Date(tenancy.end) : null;
    const endMs = end && !Number.isNaN(end.getTime()) ? end.getTime() : null;
    const hasExtend = tenancy?.previous_end != null && String(tenancy.previous_end).trim() !== '';
    const rangeStart = hasExtend ? (tenancy.previous_end ? new Date(tenancy.previous_end) : null) : (tenancy?.begin ? new Date(tenancy.begin) : null);
    const rangeStartMs = rangeStart && !Number.isNaN(rangeStart.getTime()) ? rangeStart.getTime() : null;
    return { rangeStart, rangeStartMs, end, endMs, hasExtend };
}

/** Update #textnotify from tenancy + datepicker values; hide when no message. */
function updateAgreementNotify() {
    const tenancy = currentTenancyForAgreement;
    try {
        const el = $w('#textnotify');
        const { rangeStart, rangeStartMs, end, endMs, hasExtend } = getAgreementDateRange(tenancy || {});
        let d1 = null;
        let d2 = null;
        try {
            const v1 = $w('#datepickeragreement1')?.value;
            const v2 = $w('#datepickeragreement2')?.value;
            if (v1 != null) d1 = v1 instanceof Date ? v1 : new Date(v1);
            if (v2 != null) d2 = v2 instanceof Date ? v2 : new Date(v2);
        } catch (_) {}
        const d1Ms = d1 && !Number.isNaN(d1.getTime()) ? d1.getTime() : null;
        const d2Ms = d2 && !Number.isNaN(d2.getTime()) ? d2.getTime() : null;

        let msg = '';
        if (rangeStartMs != null && endMs != null) {
            const startStr = formatDateForNotify(rangeStart);
            const endStr = formatDateForNotify(end);
            if (hasExtend) {
                msg = `Your current tenancy: from contract end ${startStr} until ${endStr} (extended).`;
            } else {
                msg = `Your current tenancy: start from ${startStr} until ${endStr}.`;
            }
        }
        if (d1Ms != null && d2Ms != null && rangeStartMs != null && endMs != null) {
            if (d1Ms < rangeStartMs || d2Ms > endMs || d1Ms > d2Ms) {
                msg = 'You have chosen dates outside your tenancy.';
            } else {
                msg = hasExtend ? 'You have chosen dates within the extension period.' : 'You have chosen dates within your tenancy period.';
            }
        }
        if (msg) {
            el.text = msg;
            el.show();
        } else {
            el.hide();
        }
    } catch (_) {
        try { $w('#textnotify').hide(); } catch (_) {}
    }
}

async function openAgreementSection(tenancy) {
    currentTenancyForAgreement = tenancy;
    $w('#dropdownmode').options = [
        { label: 'Owner & Tenant (Tenancy)', value: 'owner_tenant' },
        { label: 'Tenant & Operator (Tenancy)', value: 'tenant_operator' }
    ];
    $w('#dropdownmode').value = undefined;
    $w('#dropdownagreement').options = [];
    try {
        const { rangeStart, end, hasExtend } = getAgreementDateRange(tenancy || {});
        if (rangeStart && !Number.isNaN(rangeStart.getTime())) {
            try { $w('#datepickeragreement1').value = rangeStart; } catch (_) {}
        }
        if (end && !Number.isNaN(end.getTime())) {
            try { $w('#datepickeragreement2').value = end; } catch (_) {}
        }
    } catch (_) {}
    updateAgreementNotify();
    await switchSectionAsync('agreement');
}

function bindAgreementSection() {
    if (!uploadCloseBound) {
        $w('#buttoncloseuploadagreement').onClick(() => {
            $w('#inputagreementurl').value = '';
            switchSectionAsync(lastSectionBeforeAction);
        });
        uploadCloseBound = true;
    }
    $w('#buttoncloseagreement').onClick(() => switchSectionAsync(lastSectionBeforeAction));

    if (!uploadSubmitBound) {
        $w('#buttonsubmitagreementurl').onClick(async () => {
            const btn = $w('#buttonsubmitagreementurl');
            let origLabel;
            try { origLabel = btn.label; } catch (_) {}
            btn.disable();
            try { btn.label = 'Loading...'; } catch (_) {}
            try {
                if (!currentTenancyForAgreement?._id) throw new Error('No tenancy selected');
                const selectedMode = $w('#dropdownmode').value;
                const url = ($w('#inputagreementurl').value || '').trim();
                if (!selectedMode) throw new Error('Please select mode');
                if (!url) throw new Error('Please enter agreement URL');
                const propertyId = currentTenancyForAgreement.property?._id ?? currentTenancyForAgreement.property?.id ?? currentTenancyForAgreement.room?.property?._id;
                const property = currentTenancyForAgreement.property || {};
                await insertAgreement({
                    tenancyId: currentTenancyForAgreement._id,
                    propertyId,
                    ownerName: property.ownername || null,
                    mode: selectedMode,
                    type: 'manual',
                    url,
                    status: 'complete',
                    createdBy: accessCtx.staff?._id || null
                });
                tenanciesLoaded = false;
                $w('#inputagreementurl').value = '';
                await switchSectionAsync(lastSectionBeforeAction);
            } catch (err) {
                console.error('Upload agreement error:', err);
                $w('#text19').text = err.message || 'Upload failed';
                $w('#text19').show();
            } finally {
                btn.enable();
                try { if (origLabel !== undefined) btn.label = origLabel; } catch (_) {}
            }
        });
        uploadSubmitBound = true;
    }

    if (!agreementModeBound) {
        $w('#dropdownmode').onChange(async () => {
            const selectedMode = $w('#dropdownmode').value;
            if (!selectedMode) return;
            const res = await getAgreementTemplates(selectedMode);
            $w('#dropdownagreement').options = (res || []).map(t => ({
                label: t.title,
                value: t._id || t.id
            }));
            $w('#dropdownagreement').value = undefined;
        });
        agreementModeBound = true;
    }

    if (!agreementDatepickerBound) {
        try {
            $w('#datepickeragreement1').onChange(() => updateAgreementNotify());
            $w('#datepickeragreement2').onChange(() => updateAgreementNotify());
            agreementDatepickerBound = true;
        } catch (_) {}
    }

    if (!agreementSubmitBound) {
        $w('#buttonsubmitagreement').onClick(async () => {
            const btn = $w('#buttonsubmitagreement');
            let origLabel;
            try { origLabel = btn.label; } catch (_) {}
            btn.disable();
            try { btn.label = 'Loading...'; } catch (_) {}
            try {
                if (!currentTenancyForAgreement?._id) throw new Error('No tenancy selected');
                const selectedMode = $w('#dropdownmode').value;
                const templateId = $w('#dropdownagreement').value;
                if (!selectedMode || !templateId) throw new Error('Please select mode and template');
                const propertyId = currentTenancyForAgreement.property?._id ?? currentTenancyForAgreement.property?.id ?? currentTenancyForAgreement.room?.property?._id;
                const property = currentTenancyForAgreement.property || {};
                let extendBegin, extendEnd;
                try {
                    extendBegin = $w('#datepickeragreement1')?.value != null ? toDateValue($w('#datepickeragreement1').value) : undefined;
                    extendEnd = $w('#datepickeragreement2')?.value != null ? toDateValue($w('#datepickeragreement2').value) : undefined;
                } catch (_) {}
                await insertAgreement({
                    tenancyId: currentTenancyForAgreement._id,
                    propertyId,
                    ownerName: property.ownername || null,
                    mode: selectedMode,
                    type: 'system',
                    templateId,
                    status: 'pending',
                    createdBy: accessCtx.staff?._id || null,
                    extendBegin,
                    extendEnd
                });
                tenanciesLoaded = false;
                await switchSectionAsync(lastSectionBeforeAction);
            } catch (err) {
                console.error('Agreement error:', err);
                $w('#text19').text = err.message || 'Agreement failed';
                $w('#text19').show();
            } finally {
                btn.enable();
                try { if (origLabel !== undefined) btn.label = origLabel; } catch (_) {}
            }
        });
        agreementSubmitBound = true;
    }
}

async function openUploadAgreementSection(tenancy) {
    currentTenancyForAgreement = tenancy;
    $w('#inputagreementurl').value = '';
    await switchSectionAsync('uploadagreement');
}
