/* =======================
   Room Setting – 前端 Wix + 后端 Node (backend/saas/roomsetting.jsw)
   Cache + 前端 filter（与 expenses 一致）：最多 2000 条进 cache，改筛选不请求；超过 2000 走 server filter。
   Topup 使用 backend/saas/topup：getMyBillingInfo、getCreditPlans、startNormalTopup。
======================= */
import { getAccessContext } from 'backend/access/manage';
import wixLocation from 'wix-location';
import wixWindow from 'wix-window';
import {
    getMyBillingInfo,
    getCreditPlans,
    startNormalTopup
} from 'backend/saas/topup';
import { submitTicket } from 'backend/saas/help';
import {
    getRoomList,
    getRoomFilters,
    getRoom,
    getUploadCreds,
    updateRoom,
    insertRooms,
    setRoomActive,
    getTenancyForRoom,
    getMeterDropdownOptions,
    getSmartDoorDropdownOptions,
    updateRoomMeter,
    updateRoomSmartDoor
} from 'backend/saas/roomsetting';

let topupRepeaterBound = false;
let topupCheckoutBound = false;
let topupCloseBound = false;
let paginationDetailBound = false;
let detailRepeaterBound = false;

let listViewLoading = false;
let searchTimer = null;
let listViewFilterBound = false;
let listViewRequestId = 0;
let selectedTopupPlanId = null;
let selectedTopupPlanCache = null;

let listViewPageSize = 20;
let currentDetailRoom = null;
let activeSection = null;
let lastSectionBeforeTopup = 'tenancy';
let defaultSectionCollapsed = false;
let clientCurrency = 'MYR';
let topupInited = false;
let accessCtx = null;
let currentClientId = null;
let __pageInitOnce = false;
let tenancyActionBound = false;
const DETAIL_GALLERY_PAGE_SIZE = 4;
let detailGalleryAllItems = [];
let detailGalleryPage = 1;
let roomMainPhotoUrl = null;
let roomMediaGalleryUrls = [];
let roomUploadMessageBound = false;

let tenancyUIReady = false;
const PAGE_SECTIONS = [
    '#sectiondefault',
    '#sectionlistview',
    '#sectiondetail',
    '#sectiontopup',
    '#sectiontab',
    '#sectionnewroom',
    '#sectionheader'
];

const listViewFilterState = {
    keyword: '',
    propertyId: 'ALL',
    type: 'ALL'  // ALL | AVAILABLE | AVAILABLE_SOON | NON_AVAILABLE
};

/** 前端缓存：最多 2000 条；若 total>2000 则走 server filter */
let roomCache = [];
let roomCacheTotal = 0;
let useServerFilter = false;
let currentRoomPage = 1;

/** 等 #repeaterlistview 全部 item 的 onItemReady（含 getTenancyForRoom + 底色）完成後 resolve */
let listViewAllItemsReadyResolve = null;
let listViewAllItemsReadyExpectedCount = 0;
let listViewAllItemsReadyCount = 0;
let listViewAllItemsReadyPromise = Promise.resolve();

/** 有 cache 時第二次點 #buttonroom 不請求 DMS，只用 cache；僅在 #buttonsave 後 refresh */
let roomListCacheValid = false;

/** getRoomFilters 結果快取，避免每次點 #buttonroom 都打 filters API */
let roomFiltersCache = null;

const ROOM_CACHE_LIMIT = 2000;
const LIST_VIEW_READY_TIMEOUT_MS = 2000;

/** 先展開 list section 讓 repeater 渲染，等 #boxlistview 都上色（依 room.available/availablesoon 同步設色）後再切 section，無需額外 element */
async function waitListViewReadyThenSwitchSection() {
    const section = $w('#sectionlistview');
    if (section && section.expand) section.expand();
    await Promise.race([
        listViewAllItemsReadyPromise,
        new Promise(r => setTimeout(r, LIST_VIEW_READY_TIMEOUT_MS))
    ]);
    collapseAllSectionsExcept('sectionlistview');
    $w('#sectiontab').expand();
    const target = $w('#sectionlistview');
    if (target && target.expand) target.expand();
    activeSection = 'listview';
    if ($w('#boxdetail')) $w('#boxdetail').hide();
}
const ROOM_PAGE_SIZE = 20;

/** 点击时 disable + label 'Loading'，async 完成后 restore label + enable（再 switch section） */
function withSectionSwitchLoading(buttonId, asyncFn) {
    return async function () {
        const btn = $w(buttonId);
        let originalLabel = '';
        try {
            if (btn && typeof btn.label !== 'undefined') originalLabel = btn.label;
            if (btn) {
                btn.disable();
                if (typeof btn.label !== 'undefined') btn.label = 'Loading';
            }
            await asyncFn();
        } finally {
            if (btn) {
                if (typeof btn.label !== 'undefined') btn.label = originalLabel;
                btn.enable();
            }
        }
    };
}

function safeCollapse(el) { try { if (el && typeof el.collapse === 'function') el.collapse(); } catch (_) {} }
function safeExpand(el) { try { if (el && typeof el.expand === 'function') el.expand(); } catch (_) {} }
function runMobileBranch() {
    $w('#textstatusloading').text = 'Please setting on pc version';
    $w('#textstatusloading').show();
    function applyMobileSections() {
        try {
            safeCollapse($w('#sectiontab'));
            safeCollapse($w('#sectiontopup'));
            safeCollapse($w('#sectionlistview'));
            safeCollapse($w('#sectionnewroom'));
            safeCollapse($w('#sectiondetail'));
            safeExpand($w('#sectiondefault'));
            safeExpand($w('#sectionheader'));
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
    console.log('[TENANCY] onReady start');

    if (__pageInitOnce) {
        console.log('[TENANCY] onReady skipped (already inited)');
        return;
    }
    __pageInitOnce = true;

    $w('#sectiondefault').expand();
    $w('#sectiontopup').collapse();
    $w('#sectionlistview').collapse();
    // #sectiontab 保持 expand，不 collapse（#buttonroom 放在 #sectiontab 内，tab 一直可见）
    $w('#sectionnewroom').collapse();
    $w('#sectiondetail').collapse();

    $w('#buttonroom')?.disable();
    $w('#buttonnewroom')?.disable();
    $w('#buttontopup')?.disable();

    console.log('[TENANCY] call startInitAsync');
    startInitAsync();
});

async function startInitAsync() {
    try {
        accessCtx = await getAccessContext();

        if (!accessCtx.ok) {
            showAccessDenied(accessCtx.reason === 'NO_PERMISSION' ? "You don't have permission" : "You don't have account yet");
            return;
        }

        clientCurrency = String(accessCtx.client?.currency || 'MYR').toUpperCase();

        if (!accessCtx.client?.active) {
            showAccessDenied("You don't have account yet");
            return;
        }

        currentClientId = accessCtx.client.id;

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

        await setupDropdownFilters();

        $w('#buttonroom').onClick(withSectionSwitchLoading('#buttonroom', async () => {
            try {
                $w('#text19').text = 'Loading...';
                $w('#text19').show();
                activeSection = 'listview';
                await initListViewDropdowns();
                // 第一次點才請求 getRoomList；之後（含從 Add Room 返回）只用 cache
                if (roomListCacheValid && roomCache.length > 0) {
                    const hasTypeFields = roomCache[0].availablesoon !== undefined || roomCache[0].available !== undefined;
                    if (!hasTypeFields) {
                        roomListCacheValid = false;
                        console.log('[RoomSetting] cache 無 available/availablesoon，強制 refetch');
                    }
                }
                if (roomListCacheValid) {
                    console.log('[RoomSetting] using room list cache, skip getRoomList');
                    const section = $w('#sectionlistview');
                    if (section && section.expand) section.expand();
                } else {
                    await fetchAndFillRoomCache();
                }
                await applyFilterAndSort();
                // 等 #repeaterlistview 的 #boxlistview / #textlistviewproperty 都 ready 後才 switch section
                await waitListViewReadyThenSwitchSection();
            } finally {
                $w('#text19').hide();
            }
        }));

        $w('#buttonupdatebox').onClick(async () => {
            if (!currentDetailRoom) return;

            $w('#dropdownremark').options = [
                { label: '', value: '' },
                { label: 'Mix Gender', value: 'Mix Gender' },
                { label: 'Girl Only', value: 'Girl Only' },
                { label: 'Male Only', value: 'Male Only' }
            ];

            $w('#buttonupdatebox').label = 'Updating...';
            $w('#buttonupdatebox').disable();

            try {
                const roomId = currentDetailRoom._id || currentDetailRoom.id;
                const payload = {
                    roomName: $w('#inputdetail1').value || '',
                    description_fld: $w('#inputdetail2').value || '',
                    remark: $w('#dropdownremark').value || '',
                    price: Number($w('#inputdetail4').value || 0),
                    property: $w('#dropdowndetail1').value || null
                };

                const { mainPhoto, mediaGallery } = buildFinalMediaFields();
                payload.mainPhoto = roomMainPhotoUrl || mainPhoto;
                payload.mediaGallery = [...(mediaGallery || []), ...roomMediaGalleryUrls.map(src => ({ type: 'image', src }))];

                await updateRoom(roomId, payload);

                await updateRoomMeter(roomId, $w('#dropdownmeter').value || null);
                await updateRoomSmartDoor(roomId, $w('#dropdownsmartdoor').value || null);

                resetUploadButtons();
                const updated = await getRoom(roomId);
                if (updated && updated.ok !== false) currentDetailRoom = updated;

                $w('#buttonupdatebox').label = 'Updated';

                setTimeout(async () => {
                    activeSection = 'listview';
                    $w('#text19').text = 'Loading...';
                    $w('#text19').show();
                    try {
                        await fetchAndFillRoomCache();
                        await applyFilterAndSort();
                        await waitListViewReadyThenSwitchSection();
                    } finally {
                        $w('#text19').hide();
                        $w('#buttonupdatebox').label = 'Update';
                        $w('#buttonupdatebox').enable();
                    }
                }, 1200);
            } catch (e) {
                $w('#buttonupdatebox').label = 'Update';
                $w('#buttonupdatebox').enable();
            }
        });

        $w('#buttonclosedetail').onClick(() => {
            $w('#boxdetail').hide();
        });

        bindHtmlUploadRoomMessages();
        bindTenancyActions();
    } catch (err) {
        showAccessDenied('Unable to verify account');
        return;
    }

    bindTopupCloseButton();
    bindProblemBoxClose();

    $w('#buttontopup').onClick(withSectionSwitchLoading('#buttontopup', async () => {
        lastSectionBeforeTopup = activeSection || 'default';
        if (!topupInited) {
            await initTopupSection();
            topupInited = true;
        }
        await switchSectionAsync('sectiontopup');
    }));

    $w('#textstatusloading').hide();
    $w('#buttonroom').enable();
    $w('#buttonnewroom').enable();
    $w('#buttontopup').enable();

    bindNewRoomTab();
    initRemarkDropdown();
}

function bindNewRoomTab() {
    if (newRoomBound) return;
    newRoomBound = true;

    $w('#buttonnewroom').onClick(withSectionSwitchLoading('#buttonnewroom', async () => {
        if ($w('#boxdetail')) {
            $w('#boxdetail').hide();
        }
        await initNewRoomSection();
        await switchSectionAsync('sectionnewroom');
        activeSection = 'newroom';
    }));
}

async function setupDropdownFilters() {
    const res = await getRoomFilters();
    if (res && res.ok === false) return;
    const properties = res?.properties || [];
    const options1 = [
        { label: 'All', value: 'ALL' },
        ...properties.sort((a, b) => (a.label || '').localeCompare(b.label || '')).map(p => ({
            label: p.label,
            value: p.value
        }))
    ];
}

function enableTopupOnly() {
    $w('#buttontopup').enable();
    $w('#textstatusloading').show();
    $w('#textstatusloading').text = 'Insufficient credit. Please top up to continue.';
    switchSectionAsync('sectiontopup');
}

function showAccessDenied(message) {
    $w('#sectiondefault').expand();
    $w('#textstatusloading').show();
    $w('#textstatusloading').text = message || 'You don\'t have permission';
}

function bindTenancyActions() {
    if (tenancyActionBound) return;
    tenancyActionBound = true;
}

async function initTopupSection() {
    const billing = await getMyBillingInfo();
    const credits = Array.isArray(billing?.credit) ? billing.credit : [];
    const totalCredit = credits.reduce((s, c) => s + Number(c.amount || 0), 0);
    $w('#textcurrentcredit').text = `Current Credit Balance: ${totalCredit}`;

    const plans = await getCreditPlans();
    const items = Array.isArray(plans) ? plans : [];
    $w('#repeatertopup').data = items;

    if (!topupRepeaterBound) {
        $w('#repeatertopup').onItemReady(($item, plan) => {
            const id = plan.id || plan._id;
            $item('#textamount').text = `${clientCurrency} ${plan.sellingprice || 0}`;
            $item('#textcreditamount').text = String(plan.credit || 0);
            $item('#textcredit').text = 'Credits';
            $item('#boxcolor').hide();

            $item('#containertopup').onClick(() => {
                selectedTopupPlanId = id;
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
                    console.warn('[roomsetting] submitTicket topup_manual failed', e);
                }
                return;
            }
            const checkoutBtn = $w('#buttoncheckout');
            const originalCheckoutLabel = checkoutBtn.label || 'Checkout';
            checkoutBtn.label = 'Loading';
            checkoutBtn.disable();

            try {
                const res = await startNormalTopup({
                    creditPlanId: selectedTopupPlanId,
                    redirectUrl: wixLocation.url
                });

                if (!res?.url) {
                    throw new Error('NO_PAYMENT_URL');
                }
                wixLocation.to(res.url);
            } catch (e) {
                checkoutBtn.label = originalCheckoutLabel;
                checkoutBtn.enable();
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
        const target = lastSectionBeforeTopup || 'default';
        await switchSectionAsync(`section${target}`);
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

async function initListViewDropdowns() {
    // 先設至少「All」，避免 API 失敗時 dropdown 沒 option
    $w('#dropdownlistviewproperty').options = [{ label: 'All', value: 'ALL' }];
    $w('#dropdownlistviewproperty').value = 'ALL';

    let properties = [];
    if (roomFiltersCache !== null) {
        properties = roomFiltersCache;
    } else {
        const res = await getRoomFilters();
        console.log('[RoomSetting] getRoomFilters response:', JSON.stringify({ ok: res?.ok, reason: res?.reason, propertiesCount: res?.properties?.length, keys: res ? Object.keys(res) : [] }));
        properties = (res && res.ok !== false && Array.isArray(res.properties)) ? res.properties : [];
        roomFiltersCache = properties;
    }
    $w('#dropdownlistviewproperty').options = [
        { label: 'All', value: 'ALL' },
        ...properties.map(p => ({ label: p.label || p.value, value: p.value }))
    ];
    $w('#dropdownlistviewproperty').value = 'ALL';

    if (!listViewFilterBound) {
        $w('#inputlistviewsearch').onInput(() => {
            clearTimeout(searchTimer);
            const v = ($w('#inputlistviewsearch').value || '').trim().toLowerCase();
            if (v === '') {
                listViewFilterState.keyword = '';
                resetToFirstPage();
                applyFilterAndSort();
                return;
            }
            searchTimer = setTimeout(() => {
                listViewFilterState.keyword = v;
                resetToFirstPage();
                applyFilterAndSort();
            }, 300);
        });

        $w('#buttonclosedetail2').onClick(async () => {
            await switchSectionAsync('sectionlistview');
            activeSection = 'listview';
        });

        $w('#paginationlistview').onChange(e => {
            currentRoomPage = e.target.currentPage;
            if (useServerFilter) {
                loadRoomPageFromServer(currentRoomPage);
            } else {
                applyFilterAndSortToCache();
            }
        });

        try {
            $w('#dropdowntype').options = [
                { label: 'All', value: 'ALL' },
                { label: 'Available', value: 'AVAILABLE' },
                { label: 'Available Soon', value: 'AVAILABLE_SOON' },
                { label: 'Non-available', value: 'NON_AVAILABLE' }
            ];
            $w('#dropdowntype').value = listViewFilterState.type || 'ALL';
            $w('#dropdowntype').onChange(() => {
                listViewFilterState.type = $w('#dropdowntype').value || 'ALL';
                resetToFirstPage();
                applyFilterAndSort();
            });
        } catch (_) {}

        listViewFilterBound = true;
    }

    if (listViewFilterBound) {
        try {
            $w('#dropdowntype').value = listViewFilterState.type || 'ALL';
        } catch (_) {}
    }

    $w('#dropdownlistviewproperty').onChange(() => {
        const v = $w('#dropdownlistviewproperty').value || 'ALL';
        listViewFilterState.propertyId = v;
        resetToFirstPage();
        applyFilterAndSort();
    });
}


function resetToFirstPage() {
    currentRoomPage = 1;
    try {
        $w('#paginationlistview').currentPage = 1;
    } catch (_) {}
}

/** 拉取 room cache（最多 ROOM_CACHE_LIMIT 条，不传 keyword/propertyId） */
async function fetchAndFillRoomCache() {
    const res = await getRoomList({ limit: ROOM_CACHE_LIMIT });
    console.log('[RoomSetting] getRoomList response:', JSON.stringify({
        ok: res?.ok,
        reason: res?.reason,
        total: res?.total,
        itemsLength: res?.items?.length,
        keys: res ? Object.keys(res) : []
    }));
    if (res && res.ok === false) {
        console.log('[RoomSetting] list API failed, reason:', res.reason);
        roomCache = [];
        roomCacheTotal = 0;
        useServerFilter = false;
        roomListCacheValid = false;
        return;
    }
    const total = res.total || 0;
    const items = res.items || [];
    console.log('[RoomSetting] after parse: total=', total, 'items.length=', items.length, 'useServerFilter will be', total > ROOM_CACHE_LIMIT);
    if (total <= ROOM_CACHE_LIMIT) {
        roomCache = items;
        roomCacheTotal = total;
        useServerFilter = false;
        roomListCacheValid = true;
    } else {
        roomCache = [];
        roomCacheTotal = total;
        useServerFilter = true;
        roomListCacheValid = true;
    }
}

function getCurrentFilterOpts() {
    return {
        keyword: listViewFilterState.keyword,
        propertyId: listViewFilterState.propertyId || 'ALL',
        type: listViewFilterState.type || 'ALL'
    };
}

/** 根据 useServerFilter 走前端过滤或 server 分页；server 模式需 await 確保 repeater 有數據 */
async function applyFilterAndSort() {
    if (useServerFilter) {
        await loadRoomPageFromServer(currentRoomPage);
        return;
    }
    applyFilterAndSortToCache();
}

/** 前端：对 cache 过滤 + 排序 + 分页 */
function applyFilterAndSortToCache() {
    const opts = getCurrentFilterOpts();
    let list = roomCache;
    if (opts.propertyId && opts.propertyId !== 'ALL') {
        list = list.filter(i => String(i.propertyId || i.property?._id || '') === String(opts.propertyId));
    }
    if (opts.type && opts.type !== 'ALL') {
        /* roomdetail.available / availablesoon 在 table 是 1/0，篩選用 !! 兼容 true 與 1，且舊 cache 無此欄位時為 undefined→false */
        if (opts.type === 'AVAILABLE') {
            list = list.filter(i => !!i.available);
        } else if (opts.type === 'AVAILABLE_SOON') {
            list = list.filter(i => !!i.availablesoon);
        } else if (opts.type === 'NON_AVAILABLE') {
            list = list.filter(i => !i.available && !i.availablesoon);
        }
    }
    if (opts.keyword) {
        const s = opts.keyword.toLowerCase();
        list = list.filter(i =>
            (i.title_fld || '').toLowerCase().includes(s) ||
            (i.roomName || '').toLowerCase().includes(s)
        );
    }
    list = [...list].sort((a, b) => (a.title_fld || '').localeCompare(b.title_fld || ''));
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / ROOM_PAGE_SIZE));
    const start = (currentRoomPage - 1) * ROOM_PAGE_SIZE;
    const pageItems = list.slice(start, start + ROOM_PAGE_SIZE);
    $w('#paginationlistview').totalPages = totalPages;
    $w('#paginationlistview').currentPage = currentRoomPage;
    listViewAllItemsReadyCount = 0;
    listViewAllItemsReadyExpectedCount = pageItems.length;
    listViewAllItemsReadyPromise = pageItems.length === 0
        ? Promise.resolve()
        : new Promise(resolve => { listViewAllItemsReadyResolve = resolve; });
    $w('#repeaterlistview').data = pageItems;
}

async function loadRoomPageFromServer(pageNumber) {
    currentRoomPage = pageNumber;
    const opts = getCurrentFilterOpts();
    listViewAllItemsReadyPromise = Promise.resolve();
    $w('#repeaterlistview').data = [];
    $w('#text19').show();
    $w('#text19').text = 'Loading...';

    const res = await getRoomList({
        keyword: opts.keyword || undefined,
        propertyId: opts.propertyId === 'ALL' ? undefined : opts.propertyId,
        page: currentRoomPage,
        pageSize: ROOM_PAGE_SIZE
    });

    $w('#text19').hide();

    if (res && res.ok === false) {
        listViewAllItemsReadyPromise = Promise.resolve();
        $w('#repeaterlistview').data = [];
        return;
    }
    const items = res.items || [];
    const totalPages = res.totalPages || 1;
    $w('#paginationlistview').totalPages = totalPages;
    $w('#paginationlistview').currentPage = res.currentPage || currentRoomPage;
    listViewAllItemsReadyCount = 0;
    listViewAllItemsReadyExpectedCount = items.length;
    listViewAllItemsReadyPromise = items.length === 0
        ? Promise.resolve()
        : new Promise(resolve => { listViewAllItemsReadyResolve = resolve; });
    $w('#repeaterlistview').data = items;
}

async function reloadListView(page) {
    if (listViewLoading) return;
    listViewLoading = true;
    $w('#paginationlistview').disable();

    if (useServerFilter) {
        await loadRoomPageFromServer(page || currentRoomPage);
    } else {
        currentRoomPage = page || 1;
        applyFilterAndSortToCache();
    }

    $w('#paginationlistview').enable();
    listViewLoading = false;
}

$w('#repeaterlistview').onItemReady(($item, room) => {
    const mainText = `${room.title_fld || room.roomName || ''} | RM ${room.price || 0}`;
    $item('#textlistviewproperty').text = mainText;
    const originalText = mainText;

    // 顏色只跟 table roomdetail：availablesoon=true 深青，available=true 青，否則紅
    if (room.availablesoon === true) {
        $item('#boxlistview').style.backgroundColor = '#0f766e';
    } else if (room.available === true) {
        $item('#boxlistview').style.backgroundColor = '#dff5f2';
    } else {
        $item('#boxlistview').style.backgroundColor = '#fde2e2';
    }
    listViewAllItemsReadyCount++;
    if (listViewAllItemsReadyCount >= listViewAllItemsReadyExpectedCount && typeof listViewAllItemsReadyResolve === 'function') {
        listViewAllItemsReadyResolve();
        listViewAllItemsReadyResolve = null;
    }

    $item('#buttondetail').onClick(async () => {
        let tenancy = null;
        let tenant = null;
        try {
            const tenancyRes = await getTenancyForRoom(room._id || room.id);
            tenancy = tenancyRes && tenancyRes.ok !== false ? tenancyRes : null;
            tenant = tenancy?.tenant || null;
        } catch (_) {}
        openRoomDetail(room, tenancy, tenant);
    });

    $item('#buttonupdatedetail').onClick(async () => {
        $w('#text19').text = 'Loading...';
        $w('#text19').show();
        $item('#buttondetail').disable();
        $item('#buttonupdatedetail').disable();
        try {
            await openRoomDetailSection(room);
        } finally {
            $w('#text19').hide();
            $item('#buttondetail').enable();
            $item('#buttonupdatedetail').enable();
        }
    });

    let updating = false;

    function syncButtonsByActive(isActive) {
        if (isActive) {
            $item('#buttondetail').enable();
            $item('#buttonupdatedetail').enable();
        } else {
            $item('#buttondetail').disable();
            $item('#buttonupdatedetail').disable();
        }
    }

    const isActive = room.active === true;
    $item('#checkboxstatus').checked = isActive;
    syncButtonsByActive(isActive);

    const hasTenancy = room.hasActiveTenancy === true;
    if (room.meter || room.smartdoor || hasTenancy) {
        $item('#checkboxstatus').disable();
    }

    if (!hasTenancy) {
        $item('#checkboxstatus').onChange(async (event) => {
            if (updating) return;
            updating = true;

            const newActive = event.target.checked === true;
            const roomId = room._id || room.id;

            $w('#repeaterlistview').forEachItem(($i) => {
                $i('#checkboxstatus').disable();
            });

            try {
                const result = await setRoomActive(roomId, newActive);

                if (result && result.ok === false) {
                    $item('#checkboxstatus').checked = true;
                    syncButtonsByActive(true);
                    $item('#textlistviewproperty').text =
                        result.reason === 'REMOVE_METER_OR_SMART_DOOR_FIRST'
                            ? 'Please remove meter or smart door before deactivating'
                            : (result.reason || 'Update failed');
                    setTimeout(() => {
                        $item('#textlistviewproperty').text = originalText;
                    }, 5000);
                    return;
                }

                room.active = newActive;
                syncButtonsByActive(newActive);
            } catch (err) {
                $item('#checkboxstatus').checked = room.active === true;
                syncButtonsByActive(room.active === true);
            }

            $w('#repeaterlistview').forEachItem(($i) => {
                $i('#checkboxstatus').enable();
            });
            updating = false;
        });
    }
});

function openRoomDetail(room, tenancy, tenant) {
    $w('#textlistview2').text = room?.title_fld || room?.roomName || '';
    $w('#textlistview2').show();

    $w('#textliveview6').hide();
    $w('#textliveviewcontact').hide();
    $w('#textrental').hide();
    $w('#textliveview8').hide();

    if (tenancy && tenant) {
        $w('#textliveview6').text = tenant.fullname || '';
        $w('#textliveview6').show();
        $w('#textliveviewcontact').text = tenant.phone || '';
        $w('#textliveviewcontact').show();
        $w('#textrental').text = `RM ${tenancy.rental || 0}`;
        $w('#textrental').show();
        if (tenancy.begin && tenancy.end) {
            const f = new Intl.DateTimeFormat('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            });
            $w('#textliveview8').text =
                `${f.format(new Date(tenancy.begin))} - ${f.format(new Date(tenancy.end))}`;
            $w('#textliveview8').show();
        }
    }

    $w('#boxdetail').show();
}

async function switchSectionAsync(sectionId) {
    if (!sectionId) return;
    collapseAllSections();
    $w('#sectiontab').expand();
    const target = $w(`#${sectionId}`);
    if (target && target.expand) {
        target.expand();
        activeSection = sectionId.replace('section', '');
    }
}

function collapseAllSections() {
    PAGE_SECTIONS.forEach(id => {
        if (id === '#sectionheader' || id === '#sectiontab') return;
        const el = $w(id);
        if (el && el.collapse) el.collapse();
    });
    if ($w('#boxdetail')) $w('#boxdetail').hide();
}

/** 收起除 exceptSectionId 外的 section（用于 list 已 ready 后只收其他、不收 list，避免 repeater 重渲染） */
function collapseAllSectionsExcept(exceptSectionId) {
    const exceptId = (exceptSectionId || '').replace(/^#/, '');
    PAGE_SECTIONS.forEach(id => {
        if (id === '#sectionheader' || id === '#sectiontab') return;
        if (id === '#' + exceptId) return;
        const el = $w(id);
        if (el && el.collapse) el.collapse();
    });
    if ($w('#boxdetail')) $w('#boxdetail').hide();
}

/* ========== NEW ROOM SECTION ========== */
let newRoomBound = false;
let newRoomPropertiesCache = [];
let savingNewRoom = false;

async function initNewRoomSection() {
    if (newRoomPropertiesCache.length === 0) {
        const res = await getRoomFilters();
        if (res && res.ok === false) {
            newRoomPropertiesCache = [];
        } else {
            newRoomPropertiesCache = (res?.properties || []).map(p => ({
                label: p.label,
                value: p.value
            }));
        }
    }

    if ($w('#repeaternewroom').data.length === 0) {
        $w('#repeaternewroom').data = [{
            _id: `tmp_${Date.now()}`,
            roomName: '',
            property: null
        }];
    } else {
        $w('#repeaternewroom').data = [...$w('#repeaternewroom').data];
    }

    bindNewRoomRepeater();
    bindNewRoomButtons();
}

function bindNewRoomRepeater() {
    $w('#repeaternewroom').onItemReady(($item, itemData, index) => {
        $item('#textnumber').text = `${index + 1})`;
        $item('#dropdownproperty').options = newRoomPropertiesCache;
        $item('#dropdownproperty').value = itemData.property || null;
        $item('#inputname').value = itemData.roomName || '';

        $item('#buttonclosenewroom').onClick(() => {
            if (savingNewRoom) return;
            syncRepeaterData();
            const data = $w('#repeaternewroom').data || [];
            const newData = data.filter(d => d._id !== itemData._id);
            $w('#repeaternewroom').data = newData.length > 0 ? newData : [{ _id: `tmp_${Date.now()}`, roomName: '', property: null }];
        });
    });
}

function syncRepeaterData() {
    const data = [];
    $w('#repeaternewroom').forEachItem(($item, itemData) => {
        data.push({
            _id: itemData._id,
            roomName: $item('#inputname').value || '',
            property: $item('#dropdownproperty').value || null
        });
    });
    $w('#repeaternewroom').data = data;
}

function bindNewRoomButtons() {
    $w('#buttonaddnewroom').onClick(() => {
        if (savingNewRoom) return;
        const oldData = $w('#repeaternewroom').data || [];
        const newItem = {
            _id: `tmp_${Date.now()}_${Math.random()}`,
            roomName: '',
            property: null
        };
        $w('#repeaternewroom').data = [...oldData, newItem];
    });

    $w('#buttonsave').onClick(() => {
        syncRepeaterData();
        buildSavePreview();
        $w('#boxsave').show();
    });

    $w('#buttoncloseboxsave').onClick(() => {
        $w('#boxsave').hide();
    });

    $w('#buttonsavedetail').onClick(async () => {
        if (savingNewRoom) return;
        savingNewRoom = true;
        $w('#buttonsavedetail').label = 'Saving...';
        $w('#buttonsavedetail').disable();

        try {
            syncRepeaterData();
            const data = $w('#repeaternewroom').data || [];
            const records = data
                .filter(item => item.roomName && item.property)
                .map(item => ({ roomName: item.roomName, property: item.property }));

            if (records.length > 0) {
                await insertRooms(records);
            }

            $w('#buttonsavedetail').label = 'Complete';
            setTimeout(async () => {
                $w('#boxsave').hide();
                $w('#repeaternewroom').data = [{
                    _id: `tmp_${Date.now()}`,
                    roomName: '',
                    property: null
                }];
                $w('#buttonsavedetail').label = 'Save';
                $w('#buttonsavedetail').enable();
                savingNewRoom = false;
                activeSection = 'listview';
                // 僅在 save 後才重新從 DMS 拉列表；等 #boxlistview/#textlistviewproperty ready 後再跳轉
                $w('#text19').text = 'Loading...';
                $w('#text19').show();
                try {
                    await fetchAndFillRoomCache();
                    await applyFilterAndSort();
                    await waitListViewReadyThenSwitchSection();
                } finally {
                    $w('#text19').hide();
                }
            }, 5000);
        } catch (e) {
            $w('#buttonsavedetail').label = 'Save';
            $w('#buttonsavedetail').enable();
            savingNewRoom = false;
        }
    });
}

function buildSavePreview() {
    syncRepeaterData();
    const data = $w('#repeaternewroom').data;
    let text = '';
    let count = 0;
    data.forEach(item => {
        if (!item.roomName || !item.property) return;
        const p = newRoomPropertiesCache.find(x => x.value === item.property);
        text += `${p?.label || ''} | ${item.roomName}\n`;
        count++;
    });
    text += `\nTotal ${count} Room`;
    $w('#textsavedetail').text = text.trim();
}

async function openRoomDetailSection(room) {
    const roomId = room._id || room.id;
    const res = await getRoom(roomId);
    currentDetailRoom = (res && res.ok !== false) ? res : room;

    await switchSectionAsync('sectiondetail');
    await fillDetailSection(currentDetailRoom);
    activeSection = 'detail';
}

async function fillDetailSection(room) {
    if (!room) return;

    initRemarkDropdown();

    $w('#inputdetail1').value = room.roomName || '';
    $w('#inputdetail2').value = room.description_fld || '';
    $w('#dropdownremark').value = typeof room.remark === 'string' ? room.remark : '';
    $w('#inputdetail4').value = room.price != null ? String(room.price) : '';

    const filtersRes = await getRoomFilters();
    const properties = (filtersRes && filtersRes.ok !== false) ? (filtersRes.properties || []) : [];
    $w('#dropdowndetail1').options = properties.map(p => ({ label: p.label, value: p.value }));
    $w('#dropdowndetail1').value = room.propertyId || room.property?._id || room.property || null;

    buildMediaGallery(room);

    // #dropdownmeter / #dropdownsmartdoor: 已绑定本 room 的 + 未绑定的；option value 统一 string 以匹配下拉
    const roomId = room._id || room.id;
    const meterRes = await getMeterDropdownOptions(roomId, null);
    const meterOpts = (meterRes && meterRes.ok !== false) ? (meterRes.options || []) : [];
    $w('#dropdownmeter').options = [{ label: 'Select meter', value: null }, ...meterOpts];
    $w('#dropdownmeter').value = room.meter != null ? String(room.meter) : null;

    const doorRes = await getSmartDoorDropdownOptions(roomId, null);
    const doorOpts = (doorRes && doorRes.ok !== false) ? (doorRes.options || []) : [];
    $w('#dropdownsmartdoor').options = [{ label: 'Select smart door', value: null }, ...doorOpts];
    $w('#dropdownsmartdoor').value = room.smartdoor != null ? String(room.smartdoor) : null;

    if (room.active === false) {
        $w('#dropdownsmartdoor').disable();
    } else {
        $w('#dropdownsmartdoor').enable();
    }

    roomMainPhotoUrl = null;
    roomMediaGalleryUrls = [];
    initHtmlUploadRoom();
}

function bindHtmlUploadRoomMessages() {
    if (roomUploadMessageBound) return;
    roomUploadMessageBound = true;
    try {
        $w('#htmluploadbutton1').onMessage((event) => {
            const d = event.data;
            if (d && d.type === 'UPLOAD_SUCCESS' && d.url) {
                roomMainPhotoUrl = d.url;
            }
        });
    } catch (_) {}
    try {
        $w('#htmluploadbutton2').onMessage((event) => {
            const d = event.data;
            if (d && d.type === 'UPLOAD_SUCCESS' && d.url) {
                roomMediaGalleryUrls = [...roomMediaGalleryUrls, d.url];
            }
        });
    } catch (_) {}
}

async function initHtmlUploadRoom() {
    try {
        if (!currentClientId) return;
        const creds = await getUploadCreds();
        if (!creds.ok || !creds.baseUrl) return;
        const initPayload = {
            type: 'INIT',
            baseUrl: creds.baseUrl,
            token: creds.token,
            username: creds.username,
            clientId: currentClientId
        };
        $w('#htmluploadbutton1').postMessage({ ...initPayload, uploadId: 'main', label: 'Upload main photo', accept: 'image/*' });
        $w('#htmluploadbutton2').postMessage({ ...initPayload, uploadId: 'gallery', label: 'Upload gallery images', accept: 'image/*' });
    } catch (e) {
        console.error('initHtmlUploadRoom', e);
    }
}

function buildMediaGallery(room) {
    const mainPhoto = room.mainPhoto || room.mainphoto;
    const gallery = Array.isArray(room.mediaGallery) ? room.mediaGallery : [];

    const allImagesRaw = [
        ...(mainPhoto ? [{ type: 'image', src: mainPhoto }] : []),
        ...gallery
    ];

    detailGalleryAllItems = allImagesRaw.map((img, index) => ({
        _id: `img-${index}-${Date.now()}`,
        src: img.src || img,
        type: img.type || 'image'
    }));

    detailGalleryPage = 1;
    setupDetailGalleryRepeater();
    setupDetailPagination();
    renderDetailGalleryPage(1);
}

function setupDetailGalleryRepeater() {
    if (detailRepeaterBound) return;
    detailRepeaterBound = true;

    $w('#repeatermediagallery').onItemReady(($item, itemData) => {
        const box = $item('#container4');
        const img = $item('#imagedetail');
        box.expand();
        img.fitMode = 'fit';
        img.src = itemData.src;
        img.show();

        $item('#buttondelete').onClick(() => {
            detailGalleryAllItems = detailGalleryAllItems.filter(img => img._id !== itemData._id);
            const maxPage = Math.max(1, Math.ceil(detailGalleryAllItems.length / DETAIL_GALLERY_PAGE_SIZE));
            if (detailGalleryPage > maxPage) detailGalleryPage = maxPage;
            renderDetailGalleryPage(detailGalleryPage);
            setupDetailPagination();
        });
    });
}

function renderDetailGalleryPage(page) {
    const start = (page - 1) * DETAIL_GALLERY_PAGE_SIZE;
    const end = start + DETAIL_GALLERY_PAGE_SIZE;
    const pageItems = detailGalleryAllItems.slice(start, end);
    $w('#repeatermediagallery').data = pageItems;
    $w('#repeatermediagallery').expand();
}

function setupDetailPagination() {
    const totalPages = Math.max(1, Math.ceil(detailGalleryAllItems.length / DETAIL_GALLERY_PAGE_SIZE));
    $w('#paginationdetail').totalPages = totalPages;
    $w('#paginationdetail').currentPage = 1;
    $w('#paginationdetail').expand();
}

if (!paginationDetailBound) {
    paginationDetailBound = true;
    $w('#paginationdetail').onChange(e => {
        renderDetailGalleryPage(e.target.currentPage);
    });
}

function resetUploadButtons() {
    roomMainPhotoUrl = null;
    roomMediaGalleryUrls = [];
}

function buildFinalMediaFields() {
    if (!detailGalleryAllItems || detailGalleryAllItems.length === 0) {
        return { mainPhoto: null, mediaGallery: [] };
    }
    const [first, ...rest] = detailGalleryAllItems;
    return {
        mainPhoto: first.src,
        mediaGallery: rest.map(img => ({ type: 'image', src: img.src }))
    };
}

function initRemarkDropdown() {
    if ($w('#dropdownremark').options.length > 0) return;
    $w('#dropdownremark').options = [
        { label: '', value: '' },
        { label: 'Mix Gender', value: 'Mix Gender' },
        { label: 'Girl Only', value: 'Girl Only' },
        { label: 'Male Only', value: 'Male Only' }
    ];
}

/** 等 repeater 渲染；若 itemCount 為 0 則不等待（onItemReady 不會觸發）避免卡住 */
function waitRepeaterRendered(repeaterId, itemCount) {
    if (itemCount === 0) return Promise.resolve();
    return new Promise(resolve => {
        let done = false;
        $w(repeaterId).onItemReady(() => {
            if (!done) {
                done = true;
                resolve();
            }
        });
    });
}

function bindProblemBoxClose() {
    $w('#buttoncloseproblem2').onClick(() => {
        $w('#boxproblem2').hide();
    });
}
