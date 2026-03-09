/* =======================
   Property Setting – 前端 Wix + 后端 Node (backend/saas/propertysetting + topup + roomsetting)
   不读 Wix CMS；列表/筛选/详情/更新/车位/新建/业主协议/占用 均走 ECS。
   Topup：getMyBillingInfo、getCreditPlans、startNormalTopup 用 backend/saas/topup。
   参考 expenses：cache filter（getPropertyFilters 填下拉）+ services filter（All/Active only/Inactive only）。
======================= */

import { getAccessContext } from 'backend/access/manage';
import wixLocation from 'wix-location';
import wixWindow from 'wix-window';
import { getMyBillingInfo, getCreditPlans, startNormalTopup } from 'backend/saas/topup';
import { submitTicket } from 'backend/saas/help';
import {
    getPropertyList,
    getPropertyFilters,
    getProperty,
    updateProperty,
    setPropertyActive,
    getParkingLotsByProperty,
    saveParkingLots,
    insertProperties,
    isPropertyFullyOccupied,
    getApartmentNames,
    getSupplierOptions,
    getOwnerOptions,
    getAgreementTemplateOptions,
    saveOwnerAgreement
} from 'backend/saas/propertysetting.jsw';
import { getMeterDropdownOptions, getSmartDoorDropdownOptions } from 'backend/saas/roomsetting.jsw';

let parkingLotCache = [];
/** 按 propertyId 缓存 parking lots，点击 #buttonroom 或翻页时预拉当前页 */
let parkingLotsCacheByPropertyId = {};
let rentalUpdateBound = false;
let currentOwnerProperty = null;
let topupRepeaterBound = false;
let topupCheckoutBound = false;
let topupCloseBound = false;
let paginationDetailBound = false;
let detailRepeaterBound = false;
let tempApartmentNameCache = null;
let managementUpdateBound = false;

let listViewLoading = false;
/** 仅当从 Room 进入列表时使用：等待本页所有 repeater item 的 onItemReady（含 color/text）完成 */
let listViewExpectedCount = 0;
let listViewItemReadyPromises = [];
let tenantCache = {};
let searchTimer = null;
let listViewFilterBound = false;
let listViewRequestId = 0;
let selectedTopupPlanId = null;
let selectedTopupPlanCache = null;

let listViewPageSize = 20;
let currentDetailProperty = null;

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

let tenancyUIReady = false;

/** 前端缓存：当前筛选下的一页或整批（最多 2000）；超过则走 server 分页 */
let propertyCache = [];
let propertyCacheTotal = 0;
let useServerFilter = false;
const PROPERTY_CACHE_LIMIT = 2000;
const FILTER_DEBOUNCE_MS = 280;

const PAGE_SECTIONS = [
    '#sectiondefault',
    '#sectionlistview',
    '#sectiondetail',
    '#sectiontopup',
    '#sectiontab',
    '#sectionowner',
    '#sectionnewproperty',
    '#sectionheader'
];

const listViewFilterState = {
    keyword: '',
    propertyId: 'ALL'
};

let currentPropertyPage = 1;

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
            safeCollapse($w('#sectionowner'));
            safeCollapse($w('#sectionnewproperty'));
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
    if (__pageInitOnce) return;
    __pageInitOnce = true;

    $w('#sectiondefault').expand();
    const sectionTab = $w('#sectiontab');
    if (sectionTab) {
        if (sectionTab.expand) sectionTab.expand();
        if (sectionTab.show) sectionTab.show();
    }
    $w('#sectiontopup').collapse();
    $w('#sectionlistview').collapse();
    $w('#sectionowner').collapse();
    $w('#sectionnewproperty').collapse();
    $w('#sectiondetail').collapse();

    $w('#buttonroom')?.disable();
    $w('#buttonnewproperty')?.disable();
    $w('#buttontopup')?.disable();

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

        if (!accessCtx.staff.permission.propertylisting && !accessCtx.staff.permission.admin) {
            showAccessDenied("You don't have permission");
            return;
        }

        await setupDropdownFilters();

        try { if ($w('#inputtnb').label !== undefined) $w('#inputtnb').label = 'Electric Bill Number'; } catch (_) {}
        try { if ($w('#inputsaj').label !== undefined) $w('#inputsaj').label = 'Water bill Number'; } catch (_) {}
        try { if ($w('#inputfolder').label !== undefined) $w('#inputfolder').label = 'Report Folder Url'; } catch (_) {}
        // #input1: 当前代码未使用；若页面有该 ID 的元件，请在 Wix Editor 确认用途（或是否应为 #inputdetail1 等）

        $w('#buttonroom').onClick(async () => {
            const btn = $w('#buttonroom');
            let origLabel = '';
            try { origLabel = btn.label || ''; } catch (_) {}
            btn.disable();
            if (btn.label !== undefined) btn.label = 'Loading';
            $w('#text19').text = 'Loading...';
            $w('#text19').show();
            try {
                activeSection = 'listview';
                await initListViewDropdowns();
                const { items, total } = await fetchListViewPage(1);
                listViewItemReadyPromises = [];
                listViewExpectedCount = (items && items.length) || 0;
                setRepeaterListData(items || [], total || 0, 1);
                await waitForAllListItemsReady();
                await switchSectionAsync('sectionlistview');
            } finally {
                listViewExpectedCount = 0;
                listViewItemReadyPromises = [];
                $w('#text19').hide();
                btn.enable();
                if (btn.label !== undefined) btn.label = origLabel || 'Room';
            }
        });

        $w('#buttonupdatebox').onClick(async () => {
            if (!currentDetailProperty) return;
            $w('#buttonupdatebox').label = 'Updating...';
            $w('#buttonupdatebox').disable();
            try {
                const meterVal = $w('#dropdownmeter').value;
                const smartdoorVal = $w('#dropdownsmartdoor').value;
                const toNull = (v) => (v === undefined || v === null || v === '' || v === 'null') ? null : v;
                const res = await updateProperty(currentDetailProperty.id || currentDetailProperty._id, {
                    unitNumber: $w('#inputdetail1').value || '',
                    apartmentName: $w('#dropdowndetail1').value || null,
                    tnb: Number($w('#inputtnb').value) || null,
                    saj: $w('#inputsaj').value || '',
                    wifi: $w('#inputwifi').value || '',
                    internetType: $w('#dropdownwifi').value || null,
                    percentage: Number($w('#inputpercentage').value) || null,
                    address: $w('#inputaddress').value || '',
                    remark: $w('#inputremark').value || '',
                    folder: ($w('#inputfolder').value || '').trim() || null,
                    meter: toNull(meterVal),
                    smartdoor: toNull(smartdoorVal),
                    management: $w('#dropdownmanagement').value || null
                });
                if (res && res.ok === false) {
                    throw new Error(res.reason || 'Update failed');
                }
                currentDetailProperty = await getProperty(currentDetailProperty.id || currentDetailProperty._id);
                $w('#buttonupdatebox').label = 'Updated';
                setTimeout(async () => {
                    await switchSectionAsync('sectionlistview');
                    activeSection = 'listview';
                    await reloadListView(1);
                    $w('#buttonupdatebox').label = 'Update';
                    $w('#buttonupdatebox').enable();
                }, 800);
            } catch (e) {
                console.error('Update property failed', e);
                $w('#buttonupdatebox').label = 'Update';
                $w('#buttonupdatebox').enable();
            }
        });

        $w('#buttonclosedetail').onClick(() => {
            $w('#boxdetail').hide();
        });

        bindTenancyActions();
    } catch (err) {
        showAccessDenied('Unable to verify account');
        return;
    }

    bindTopupCloseButton();

    $w('#buttontopup').onClick(async () => {
        const btn = $w('#buttontopup');
        let origLabel = '';
        try { origLabel = btn.label || ''; } catch (_) {}
        btn.disable();
        if (btn.label !== undefined) btn.label = 'Loading';
        try {
            lastSectionBeforeTopup = activeSection || 'default';
            if (!topupInited) {
                await initTopupSection();
                topupInited = true;
            }
            await switchSectionAsync('sectiontopup');
        } finally {
            btn.enable();
            if (btn.label !== undefined) btn.label = origLabel || 'Top Up';
        }
    });

    $w('#textstatusloading').hide();
    $w('#buttonroom').enable();
    $w('#buttonnewproperty').enable();
    $w('#buttontopup').enable();

    // New Property
    $w('#buttonsaveaddproperty').onClick(async () => {
        const name = ($w('#inputproperty').value || '').trim();
        if (!name) return;
        $w('#buttonsaveaddproperty').disable();
        try {
            tempApartmentNameCache = name;
            if (!newRoomPropertiesCache.find(x => x.value === name)) {
                newRoomPropertiesCache.push({ label: name, value: name });
                newRoomPropertiesCache.sort((a, b) => a.label.localeCompare(b.label));
            }
            $w('#repeaternewproperty').forEachItem(($item) => {
                $item('#dropdownproperty').options = newRoomPropertiesCache;
                $item('#dropdownproperty').value = name;
            });
            $w('#boxaddpropertyname').hide();
        } finally {
            $w('#buttonsaveaddproperty').enable();
        }
    });

    $w('#buttoncloseaddpropertyname').onClick(() => {
        $w('#boxaddpropertyname').hide();
    });
    $w('#buttonapartmentname').onClick(() => {
        $w('#inputproperty').value = '';
        $w('#boxaddpropertyname').show();
    });

    $w('#buttonaddparkinglot').onClick(() => {
        parkingLotCache.push({
            _id: `tmp_${Date.now()}_${Math.random()}`,
            parkinglot: ''
        });
        $w('#repeaterparkinglot').data = parkingLotCache;
    });

    $w('#buttonsaveparkinglot').onClick(async () => {
        $w('#buttonsaveparkinglot').disable();
        if (!currentDetailProperty) return;
        const newData = [];
        $w('#repeaterparkinglot').forEachItem(($item, itemData) => {
            const v = ($item('#inputparkinglot').value || '').trim();
            if (v) newData.push(v);
        });
        const propertyId = currentDetailProperty.id || currentDetailProperty._id;
        const res = await saveParkingLots(propertyId, newData.map(n => ({ parkinglot: n })));
        if (res && res.ok === false) {
            console.error('Save parking failed', res.reason);
        } else {
            parkingLotsCacheByPropertyId[propertyId] = newData.map((name, i) => ({ _id: `tmp_${Date.now()}_${i}`, parkinglot: name }));
            $w('#boxdetail').hide();
        }
        $w('#buttonsaveparkinglot').enable();
    });

    bindNewRoomTab();
    bindProblemBoxClose();
}

function bindNewRoomTab() {
    if (newRoomBound) return;
    newRoomBound = true;
    $w('#buttonnewproperty').onClick(async () => {
        const btn = $w('#buttonnewproperty');
        let origLabel = '';
        try { origLabel = btn.label || ''; } catch (_) {}
        btn.disable();
        if (btn.label !== undefined) btn.label = 'Loading';
        try {
            if ($w('#boxdetail')) $w('#boxdetail').hide();
            await initNewRoomSection();
            await switchSectionAsync('sectionnewproperty');
            activeSection = 'newproperty';
        } finally {
            btn.enable();
            if (btn.label !== undefined) btn.label = origLabel || 'New Property';
        }
    });
}

async function setupDropdownFilters() {
    const res = await getPropertyFilters();
    if (res && res.ok === false) return;
    const properties = res.properties || [];
    const options1 = [
        { label: 'All', value: 'ALL' },
        ...properties.map(p => ({ label: p.label, value: p.value }))
    ];
    listViewFilterState.propertyId = 'ALL';
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
    const credits = Array.isArray(billing.credit) ? billing.credit : [];
    const totalCredit = credits.reduce((s, c) => s + Number(c.amount || 0), 0);
    $w('#textcurrentcredit').text = `Current Credit Balance: ${totalCredit}`;

    const plans = await getCreditPlans();
    const items = Array.isArray(plans) ? plans : [];
    $w('#repeatertopup').data = items;

    if (!topupRepeaterBound) {
        $w('#repeatertopup').onItemReady(($item, plan) => {
            const id = plan.id || plan._id;
            $item('#textamount').text = `${clientCurrency} ${plan.sellingprice}`;
            $item('#textcreditamount').text = String(plan.credit);
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
                    console.warn('[propertysetting] submitTicket topup_manual failed', e);
                }
                return;
            }
            $w('#buttoncheckout').label = 'Loading';
            $w('#buttoncheckout').disable();
            try {
                const res = await startNormalTopup({
                    creditPlanId: selectedTopupPlanId,
                    redirectUrl: wixLocation.url
                });
                const url = res?.url || res?.redirectUrl;
                if (url) wixLocation.to(url);
            } catch (e) {
                console.error(e);
            }
            $w('#buttoncheckout').enable();
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
    const res = await getPropertyFilters();
    if (res && res.ok === false) return;
    const properties = res.properties || [];

    $w('#dropdownlistviewproperty').options = [
        { label: 'All', value: 'ALL' },
        ...properties.map(p => ({ label: p.label, value: p.value }))
    ];
    $w('#dropdownlistviewproperty').value = listViewFilterState.propertyId || 'ALL';

    if (!listViewFilterBound) {
        $w('#inputlistviewsearch').onInput(() => {
            clearTimeout(searchTimer);
            const v = ($w('#inputlistviewsearch').value || '').trim().toLowerCase();
            if (v === '') {
                listViewFilterState.keyword = '';
                reloadListView(1);
                return;
            }
            searchTimer = setTimeout(() => {
                listViewFilterState.keyword = v;
                reloadListView(1);
            }, FILTER_DEBOUNCE_MS);
        });
        $w('#buttonclosedetail2').onClick(async () => {
            const btn = $w('#buttonclosedetail2');
            try { btn.disable(); } catch (_) {}
            try {
                await switchSectionAsync('sectionlistview');
                activeSection = 'listview';
            } finally {
                try { btn.enable(); } catch (_) {}
            }
        });
        $w('#paginationlistview').onChange(e => {
            reloadListView(e.target.currentPage);
        });
        listViewFilterBound = true;
    }

    $w('#dropdownlistviewproperty').onChange(() => {
        listViewFilterState.propertyId = $w('#dropdownlistviewproperty').value || 'ALL';
        reloadListView(1);
    });
}

/** 只拉列表数据，不写 repeater；供 Room 按钮先拿 count 再 set data 用 */
async function fetchListViewPage(page = 1) {
    const { keyword, propertyId } = listViewFilterState;
    const res = await getPropertyList({
        keyword: keyword || undefined,
        propertyId: propertyId === 'ALL' ? undefined : propertyId,
        page,
        pageSize: listViewPageSize
    });
    if (res && res.ok === false) {
        console.error('getPropertyList failed', res.reason);
        return { items: [], total: 0, totalPages: 1 };
    }
    const items = res.items || [];
    const total = res.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / listViewPageSize));
    return { items, total, totalPages };
}

function setRepeaterListData(items, total, page) {
    const totalPages = Math.max(1, Math.ceil(total / listViewPageSize));
    $w('#repeaterlistview').data = items;
    $w('#paginationlistview').totalPages = totalPages;
    $w('#paginationlistview').currentPage = page;
    prefetchParkingLotsForProperties(items || []);
}

/** 后台预拉当前页每个 property 的 parking lots 写入 parkingLotsCacheByPropertyId */
function prefetchParkingLotsForProperties(properties) {
    (properties || []).forEach((p) => {
        const id = p.id || p._id;
        if (!id) return;
        getParkingLotsByProperty(id).then((res) => {
            const list = (res && res.items) ? res.items : [];
            parkingLotsCacheByPropertyId[id] = list.map(x => ({ _id: x.id || x._id, parkinglot: x.parkinglot || '' }));
        }).catch(() => {});
    });
}

async function loadListView(page = 1) {
    const { items, total, totalPages } = await fetchListViewPage(page);
    if (items.length === 0 && total === 0) {
        $w('#repeaterlistview').data = [];
        $w('#paginationlistview').totalPages = 1;
        $w('#paginationlistview').currentPage = 1;
        return;
    }
    setRepeaterListData(items, total, page);
}

$w('#repeaterlistview').onItemReady(async ($item, room) => {
    /** @type {((value?: any) => void) | undefined} */
    let itemResolve;
    const itemReadyPromise = new Promise((r) => { itemResolve = r; });
    if (typeof listViewItemReadyPromises !== 'undefined' && Array.isArray(listViewItemReadyPromises)) {
        listViewItemReadyPromises.push(itemReadyPromise);
    }

    const propertyId = room.id || room._id;

    let fullyOccupied = false;
    try {
        const occ = await isPropertyFullyOccupied(propertyId);
        fullyOccupied = occ && occ.fullyOccupied === true;
    } catch (e) {
        console.warn('occupancy check failed', e);
    }

    if (fullyOccupied) {
        $item('#boxlistview').style.backgroundColor = '#dff5f2';
    } else {
        $item('#boxlistview').style.backgroundColor = '#fde2e2';
    }

    $item('#textlistviewproperty').text = room.shortname || '';
    if (typeof itemResolve === 'function') itemResolve();

    $item('#buttondetail').onClick(() => {
        openPropertyParkingLot(room);
    });

    $item('#buttonupdatedetail').onClick(async () => {
        try {
            $item('#buttonupdatedetail').disable();
            $item('#buttonupdatedetail').label = 'Loading...';
            await openPropertyDetailSection(room);
        } catch (err) {
            console.error('Open detail failed:', err);
        } finally {
            $item('#buttonupdatedetail').enable();
            $item('#buttonupdatedetail').label = 'Update Detail';
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

    $item('#buttonowner').onClick(async () => {
        const ownerBtn = $item('#buttonowner');
        let origLabel = '';
        try { origLabel = ownerBtn.label || ''; } catch (_) {}
        ownerBtn.disable();
        if (ownerBtn.label !== undefined) ownerBtn.label = 'Loading';
        try {
            currentOwnerProperty = await getProperty(propertyId);
            if (currentOwnerProperty) {
                await initOwnerSection(currentOwnerProperty);
                await switchSectionAsync('sectionowner');
                activeSection = 'owner';
            }
        } finally {
            ownerBtn.enable();
            if (ownerBtn.label !== undefined) ownerBtn.label = origLabel || 'Owner';
        }
    });

    $item('#checkboxstatus').onChange(async (event) => {
        if (updating) return;
        updating = true;
        const newActive = event.target.checked === true;
        $w('#repeaterlistview').forEachItem(($i) => {
            $i('#checkboxstatus').disable();
        });
        try {
            const res = await setPropertyActive(propertyId, newActive);
            if (res && res.ok === false) throw new Error(res.reason);
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
});

async function switchSectionAsync(sectionId) {
    if (!sectionId) return;
    collapseAllSections();
    const sectionTab = $w('#sectiontab');
    if (sectionTab) {
        if (sectionTab.expand) sectionTab.expand();
        if (sectionTab.show) sectionTab.show();
    }
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

async function reloadListView(page = 1) {
    if (listViewLoading) return;
    listViewLoading = true;
    $w('#paginationlistview').disable();
    await loadListView(page);
    $w('#paginationlistview').enable();
    listViewLoading = false;
}

let newRoomBound = false;
let newRoomPropertiesCache = [];
let savingNewRoom = false;

async function initNewRoomSection() {
    tempApartmentNameCache = null;
    newRoomPropertiesCache = [];
    const res = await getApartmentNames();
    const names = (res && res.names) ? res.names : [];
    newRoomPropertiesCache = names
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .map(name => ({ label: name, value: name }));
    if ($w('#repeaternewproperty').data.length === 0) {
        $w('#repeaternewproperty').data = [{
            _id: `tmp_${Date.now()}`,
            unitNumber: '',
            apartmentName: null
        }];
    } else {
        $w('#repeaternewproperty').data = [...$w('#repeaternewproperty').data];
    }
    bindNewRoomRepeater();
    bindNewRoomButtons();
}

function bindNewRoomRepeater() {
    $w('#repeaternewproperty').onItemReady(($item, itemData, index) => {
        $item('#textnumber').text = `${index + 1})`;
        $item('#dropdownproperty').options = newRoomPropertiesCache;
        $item('#dropdownproperty').value = itemData.apartmentName || null;
        $item('#inputname').value = itemData.unitNumber || '';
    });
}

function syncRepeaterData() {
    const data = [];
    $w('#repeaternewproperty').forEachItem(($item, itemData) => {
        data.push({
            _id: itemData._id,
            unitNumber: $item('#inputname').value || '',
            apartmentName: $item('#dropdownproperty').value || null
        });
    });
    $w('#repeaternewproperty').data = data;
}

function bindNewRoomButtons() {
    $w('#buttonaddnewproperty').onClick(async () => {
        const btn = $w('#buttonaddnewproperty');
        let origLabel = '';
        try { origLabel = btn.label || ''; } catch (_) {}
        btn.disable();
        if (btn.label !== undefined) btn.label = 'Loading';
        try {
            await switchSectionAsync('sectionnewproperty');
            activeSection = 'newproperty';
            if (savingNewRoom) return;
            const oldData = $w('#repeaternewproperty').data || [];
            const newItem = {
                _id: `tmp_${Date.now()}_${Math.random()}`,
                unitNumber: '',
                apartmentName: null
            };
            $w('#repeaternewproperty').data = [...oldData, newItem];
        } finally {
            btn.enable();
            if (btn.label !== undefined) btn.label = origLabel || 'Add';
        }
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
            const data = $w('#repeaternewproperty').data || [];
            const records = data
                .filter(item => item.unitNumber && item.apartmentName)
                .map(item => ({ unitNumber: item.unitNumber, apartmentName: item.apartmentName }));
            if (records.length > 0) {
                const res = await insertProperties(records);
                if (res && res.ok === false) throw new Error(res.reason);
            }
            $w('#buttonsavedetail').label = 'Complete';
            setTimeout(async () => {
                $w('#boxsave').hide();
                $w('#repeaternewproperty').data = [{
                    _id: `tmp_${Date.now()}`,
                    unitNumber: '',
                    apartmentName: null
                }];
                $w('#buttonsavedetail').label = 'Save';
                $w('#buttonsavedetail').enable();
                savingNewRoom = false;
                await switchSectionAsync('sectionlistview');
                activeSection = 'listview';
                await initListViewDropdowns();
                await reloadListView(1);
            }, 5000);
        } catch (e) {
            console.error(e);
            $w('#buttonsavedetail').label = 'Save';
            $w('#buttonsavedetail').enable();
            savingNewRoom = false;
        }
    });
}

function buildSavePreview() {
    syncRepeaterData();
    const data = $w('#repeaternewproperty').data || [];
    let text = '';
    let count = 0;
    data.forEach(item => {
        if (!item.unitNumber || !item.apartmentName) return;
        text += `${item.apartmentName || ''} | ${item.unitNumber || ''}\n`;
        count++;
    });
    text += `\nTotal ${count} Room`;
    $w('#textsavedetail').text = text.trim();
}

async function openPropertyDetailSection(property) {
    const propertyId = property.id || property._id;
    currentDetailProperty = await getProperty(propertyId);
    if (!currentDetailProperty) return;
    await fillPropertyDetailSection(currentDetailProperty);
    await switchSectionAsync('sectiondetail');
    activeSection = 'detail';
}

/** 等本页所有 list item 的 onItemReady（含 occupancy/color/text）都完成后再 resolve；最多等 15 秒 */
function waitForAllListItemsReady() {
    if (listViewExpectedCount <= 0) return Promise.resolve();
    const timeoutMs = 15000;
    const start = Date.now();
    return new Promise((resolve) => {
        function check() {
            if (listViewItemReadyPromises.length >= listViewExpectedCount) {
                Promise.all(listViewItemReadyPromises).then(resolve).catch(resolve);
                return;
            }
            if (Date.now() - start >= timeoutMs) {
                resolve();
                return;
            }
            setTimeout(check, 30);
        }
        check();
    });
}

async function fillPropertyDetailSection(property) {
    if (!property) return;

    const apartmentRes = await getApartmentNames();
    const names = apartmentRes && apartmentRes.names ? apartmentRes.names : [];
    const apartmentOptions = [
        { label: 'Select apartment', value: null },
        ...names.filter(Boolean).sort((a, b) => a.localeCompare(b)).map(name => ({ label: name, value: name }))
    ];
    $w('#dropdowndetail1').options = apartmentOptions;
    $w('#dropdowndetail1').value = property.apartmentName || null;

    $w('#inputdetail1').value = property.unitNumber || '';
    $w('#inputtnb').value = property.tnb != null ? property.tnb : '';
    $w('#inputsaj').value = property.saj != null ? property.saj : '';
    $w('#inputwifi').value = property.wifi || '';
    $w('#inputpercentage').value = property.percentage != null ? property.percentage : '';
    $w('#inputaddress').value = property.address || '';
    $w('#inputremark').value = property.remark || '';
    $w('#inputfolder').value = property.folder || '';

    const supplierRes = await getSupplierOptions();
    const supplierOptions = supplierRes && supplierRes.options ? supplierRes.options : [];
    const supplierDropdownOptions = [
        { label: 'Select supplier', value: null },
        ...supplierOptions.map(s => ({ label: s.label, value: s.value }))
    ];
    $w('#dropdownwifi').options = supplierDropdownOptions;
    $w('#dropdownmanagement').options = supplierDropdownOptions;
    $w('#dropdownwifi').value = property.internetType || null;
    $w('#dropdownmanagement').value = property.management || null;

    // #dropdownmeter / #dropdownsmartdoor: 已绑定本 property 的 + 未绑定的；必须传 propertyId 给后端才能看到已绑定的项
    const propertyIdForApi = property.id != null ? String(property.id) : (property._id != null ? String(property._id) : null);
    const meterRes = await getMeterDropdownOptions(null, propertyIdForApi);
    const meterOpts = (meterRes && meterRes.ok !== false) ? (meterRes.options || []) : [];
    $w('#dropdownmeter').options = [{ label: 'Select meter', value: null }, ...meterOpts];
    $w('#dropdownmeter').value = property.meter != null ? String(property.meter) : null;

    const doorRes = await getSmartDoorDropdownOptions(null, propertyIdForApi);
    const doorOpts = (doorRes && doorRes.ok !== false) ? (doorRes.options || []) : [];
    $w('#dropdownsmartdoor').options = [{ label: 'Select smart door', value: null }, ...doorOpts];
    $w('#dropdownsmartdoor').value = property.smartdoor != null ? String(property.smartdoor) : null;
}

async function openPropertyParkingLot(property) {
    currentDetailProperty = property;
    const propertyId = property.id || property._id;
    let list = parkingLotsCacheByPropertyId[propertyId];
    if (list === undefined) {
        const res = await getParkingLotsByProperty(propertyId);
        const items = (res && res.items) ? res.items : [];
        list = items.map(p => ({ _id: p.id || p._id, parkinglot: p.parkinglot || '' }));
        parkingLotsCacheByPropertyId[propertyId] = list;
    }
    parkingLotCache = list.length > 0 ? [...list] : [{ _id: `tmp_${Date.now()}`, parkinglot: '' }];
    $w('#repeaterparkinglot').data = parkingLotCache;
    $w('#boxdetail').show();
}

$w('#repeaterparkinglot').onItemReady(($item, itemData, index) => {
    $item('#textnumber2').text = `${index + 1})`;
    $item('#inputparkinglot').value = itemData.parkinglot || '';
    $item('#buttondeleteparkinglot').onClick(() => {
        parkingLotCache = parkingLotCache.filter(x => (x._id || x.id) !== (itemData._id || itemData.id));
        if (parkingLotCache.length === 0) {
            parkingLotCache = [{ _id: `tmp_${Date.now()}`, parkinglot: '' }];
        }
        $w('#repeaterparkinglot').data = parkingLotCache;
    });
});

async function initOwnerSection(property) {
    $w('#dropdownowner').expand();
    $w('#dropdownagreementtype').expand();
    $w('#dropdownagreement').collapse();
    $w('#inputagreementurl').collapse();

    $w('#buttoncloseowner').onClick(async () => {
        const btn = $w('#buttoncloseowner');
        try { btn.disable(); } catch (_) {}
        try {
            await switchSectionAsync('sectionlistview');
            activeSection = 'listview';
        } finally {
            try { btn.enable(); } catch (_) {}
        }
    });

    const latestProperty = await getProperty(property.id || property._id);
    if (!latestProperty) return;

    const ownerRes = await getOwnerOptions();
    const ownerOpts = (ownerRes && ownerRes.options) ? ownerRes.options : [];
    $w('#dropdownowner').options = [
        { label: 'Select Owner', value: null },
        ...ownerOpts.map(o => ({ label: o.label, value: o.value }))
    ];
    $w('#dropdownowner').value = latestProperty.owner_id || null;

    $w('#dropdownagreementtype').options = [
        { label: 'No agreement', value: null },
        { label: 'System Template', value: 'system' },
        { label: 'Manual Upload', value: 'manual' }
    ];
    $w('#dropdownagreementtype').value = null;

    /** #dropdownagreement、#inputagreementurl 只用 collapse/expand，不用 hide/show。选 system 时后台拉模板填下拉。 */
    function applyAgreementTypeVisibility() {
        const type = $w('#dropdownagreementtype').value;
        const collapse = (id) => { try { $w(id).collapse(); } catch (_) {} };
        const expand = (id) => { try { $w(id).expand(); } catch (_) {} };
        if (type === 'system') {
            collapse('#inputagreementurl');
            $w('#dropdownagreement').options = [{ label: 'Loading...', value: null }];
            expand('#dropdownagreement');
            getAgreementTemplateOptions().then((templateRes) => {
                const opts = (templateRes && templateRes.options) ? templateRes.options : [];
                $w('#dropdownagreement').options = [
                    { label: 'Select Template', value: null },
                    ...opts.map(t => ({ label: t.label, value: t.value }))
                ];
            }).catch(() => {
                $w('#dropdownagreement').options = [{ label: 'Select Template', value: null }];
            });
        } else if (type === 'manual') {
            collapse('#dropdownagreement');
            expand('#inputagreementurl');
        } else {
            collapse('#dropdownagreement');
            collapse('#inputagreementurl');
        }
    }

    if (latestProperty.signagreement) {
        $w('#buttonagreementcopy').label = 'Open agreement';
        $w('#buttonagreementcopy').expand();
        $w('#buttonagreementcopy').show();
        $w('#buttonagreementcopy').onClick(() => {
            wixLocation.to(latestProperty.signagreement);
        });
        const agreementLabel = (latestProperty.agreementDetailLabel || latestProperty.agreementdetail || '').trim();
        try {
            if (agreementLabel) {
                $w('#textagreementdetail').text = agreementLabel;
                $w('#textagreementdetail').expand();
                $w('#textagreementdetail').show();
            } else {
                $w('#textagreementdetail').collapse();
                $w('#textagreementdetail').hide();
            }
        } catch (_) {}
    } else {
        $w('#buttonagreementcopy').collapse();
        $w('#buttonagreementcopy').hide();
        try {
            $w('#textagreementdetail').collapse();
            $w('#textagreementdetail').hide();
        } catch (_) {}
    }

    $w('#dropdownagreementtype').onChange(() => {
        applyAgreementTypeVisibility();
    });

    $w('#buttonsaveownerdetail').onClick(null);
    $w('#buttonsaveownerdetail').onClick(async () => {
        const selectedOwnerId = $w('#dropdownowner').value;
        const type = $w('#dropdownagreementtype').value;
        if (!selectedOwnerId) return;
        $w('#buttonsaveownerdetail').disable();
        $w('#buttonsaveownerdetail').label = 'Saving...';
        try {
            const propertyId = property.id || property._id;
            const payload = { propertyId, ownerId: selectedOwnerId };
            if (type === 'manual') {
                payload.type = 'manual';
                payload.url = ($w('#inputagreementurl').value || '').trim();
                if (!payload.url) throw new Error('Agreement URL required');
            } else if (type === 'system') {
                payload.type = 'system';
                payload.templateId = $w('#dropdownagreement').value;
                if (!payload.templateId) throw new Error('Template required');
            }
            const res = await saveOwnerAgreement(payload);
            if (res && res.ok === false) throw new Error(res.reason);
            $w('#buttonsaveownerdetail').label = 'Save complete';
            setTimeout(async () => {
                await switchSectionAsync('sectionlistview');
                activeSection = 'listview';
                try {
                    $w('#buttonsaveownerdetail').label = 'Save';
                    $w('#buttonsaveownerdetail').enable();
                } catch (_) {}
            }, 5000);
        } catch (e) {
            console.error('Owner agreement failed:', e);
            $w('#buttonsaveownerdetail').enable();
            $w('#buttonsaveownerdetail').label = 'Save';
        }
    });
}

function bindProblemBoxClose() {
    $w('#buttoncloseproblem2').onClick(() => {
        $w('#boxproblem2').hide();
    });
}

/** 旧代码保留：若页面有上传按钮调用，可返回上传后的 fileUrl */
async function uploadIfAny(uploadButtonId) {
    const btn = $w(uploadButtonId);
    if (!btn || btn.value.length === 0) return null;
    const res = await btn.startUpload();
    return res?.fileUrl || null;
}

/** 旧代码保留：日期短格式，若页面有文案用到 */
function formatDateShort(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}
