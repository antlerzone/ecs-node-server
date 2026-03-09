/* ======================================================
   Available Unit (Public Page) – MySQL/Node via backend/saas/availableunit.jsw
   Public: no subdomain = all clients' available units; ?subdomain=xxx = one client only.
   WhatsApp: wasap.my/{clientContact}/{propertyname%20roomname%20enquiry}; contact from item.clientContact or listData.clientContact.
====================================================== */

import { getData } from 'backend/saas/availableunit';
import wixLocation from 'wix-location';

/* ======================================================
   State
====================================================== */

let listData = { items: [], properties: [], clientContact: null, clientCurrency: 'MYR', totalPages: 1, currentPage: 1, total: 0 };
let currentFilter = { propertyId: 'ALL', sort: 'title', page: 1, pageSize: 20, keyword: '', country: 'ALL' };
let searchInputTimer = null;
let viewMode = 'grid'; // 'grid' | 'list'
let selectedItem = null; // current unit for detail popup
let loading = false;
let gridReadyCount = 0;
let expectedGridReadyCount = 0;
let sectionReadyResolve = null;

/* ======================================================
   Init: startInitAsync pattern – onReady sync UI + bind, then startInitAsync loads data and shows when ready
====================================================== */

$w.onReady(function () {
    const query = (typeof wixLocation !== 'undefined' && wixLocation.query) ? wixLocation.query : {};
    const subdomainFromUrl = (query.subdomain && String(query.subdomain).trim()) ? String(query.subdomain).trim().toLowerCase() : '';
    console.log('[available-unit] onReady subdomain from URL=', subdomainFromUrl || '(none, public all)');

    if ($w('#text20')) $w('#text20').text = 'Loading';
    if ($w('#sectiongrid')) $w('#sectiongrid').hide();
    $w('#sectionheader').expand();
    $w('#sectionheader').show();
    $w('#sectionlist').collapse();
    bindDropdowns();
    bindSearchInput();
    bindCountryDropdown();
    bindViewButton();
    bindGridRepeater();
    bindListRepeater();
    bindPagination();
    bindDetailPopups();
    startInitAsync();
});

async function startInitAsync() {
    try {
        await loadData();
    } catch (e) {
        console.error('[available-unit] startInitAsync error', e);
        showSectionWhenReady();
    }
}

/**
 * Load list data; returns a Promise that resolves when grid repeater has finished rendering (all onItemReady).
 * Used by startInitAsync to await before showing section; pagination/filter calls loadData without awaiting.
 */
async function loadData() {
    const query = (typeof wixLocation !== 'undefined' && wixLocation.query) ? wixLocation.query : {};
    const subdomain = (query.subdomain && String(query.subdomain).trim()) ? String(query.subdomain).trim().toLowerCase() : '';
    const opts = {
        propertyId: currentFilter.propertyId,
        sort: currentFilter.sort,
        page: currentFilter.page,
        pageSize: currentFilter.pageSize,
        keyword: (currentFilter.keyword && String(currentFilter.keyword).trim()) ? String(currentFilter.keyword).trim() : undefined,
        country: currentFilter.country && currentFilter.country !== 'ALL' ? currentFilter.country : undefined
    };
    if (subdomain) opts.subdomain = subdomain;
    console.log('[available-unit] loadData opts=', JSON.stringify(opts));
    if (loading) {
        console.log('[available-unit] loadData skip (loading)');
        return Promise.resolve();
    }
    loading = true;
    const sectionReadyPromise = new Promise(function (resolve) {
        sectionReadyResolve = resolve;
    });
    try {
        const res = await getData(opts);
        console.log('[available-unit] loadData res.ok=', res && res.ok, 'items.length=', (res && res.items) ? res.items.length : 0, 'total=', res && res.total);
        listData = {
            items: res.items || [],
            properties: res.properties || [],
            clientContact: res.clientContact != null ? res.clientContact : null,
            clientCurrency: (res.clientCurrency && String(res.clientCurrency).trim()) ? String(res.clientCurrency).trim().toUpperCase() : 'MYR',
            totalPages: res.totalPages || 1,
            currentPage: res.currentPage || 1,
            total: res.total || 0
        };
        const items = listData.items;
        gridReadyCount = 0;
        expectedGridReadyCount = items.length;
        if ($w('#repeatergrid')) {
            $w('#repeatergrid').data = items;
            console.log('[available-unit] loadData repeatergrid.data set, length=', items.length);
        }
        if ($w('#repeaterlist')) {
            $w('#repeaterlist').data = items;
            console.log('[available-unit] loadData repeaterlist.data set, length=', items.length);
        }
        setPropertyDropdownOptions(listData.properties);
        updatePagination();
        if (expectedGridReadyCount === 0) showSectionWhenReady();
    } catch (e) {
        console.error('[available-unit] loadData error', e);
        if ($w('#repeatergrid')) $w('#repeatergrid').data = [];
        if ($w('#repeaterlist')) $w('#repeaterlist').data = [];
        gridReadyCount = 0;
        expectedGridReadyCount = 0;
        showSectionWhenReady();
    } finally {
        loading = false;
    }
    return sectionReadyPromise;
}

function showSectionWhenReady() {
    if ($w('#text20')) $w('#text20').text = 'Available Unit';
    if ($w('#sectiongrid')) $w('#sectiongrid').show();
    if (typeof sectionReadyResolve === 'function') {
        sectionReadyResolve();
        sectionReadyResolve = null;
    }
}

/** Format price as "CURRENCY amount" (e.g. MYR 1,200). Uses item.currency or listData.clientCurrency. */
function formatPrice(room) {
    const currency = (room.currency && String(room.currency).trim()) ? String(room.currency).trim().toUpperCase() : (listData.clientCurrency || 'MYR');
    if (room.price == null || room.price === '') return currency + ' -';
    const num = Number(room.price);
    if (isNaN(num)) return currency + ' -';
    const amount = num % 1 === 0 ? String(Math.round(num)) : num.toFixed(2);
    const withCommas = amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return currency + ' ' + withCommas;
}

function setPropertyDropdownOptions(properties) {
    const dropdown = $w('#dropdownproperty');
    if (!dropdown || !Array.isArray(properties)) return;
    dropdown.options = properties.map(p => ({ value: p.value, label: p.label }));
}

function bindDropdowns() {
    const sortOptions = [
        { value: 'title', label: 'Title A-Z' },
        { value: 'title_desc', label: 'Title Z-A' },
        { value: 'price_asc', label: 'Price Low to High' },
        { value: 'price_desc', label: 'Price High to Low' }
    ];
    if ($w('#dropdownsort')) {
        $w('#dropdownsort').options = sortOptions;
        $w('#dropdownsort').onChange(() => {
            currentFilter.sort = $w('#dropdownsort').value || 'title';
            currentFilter.page = 1;
            loadData();
        });
    }
    if ($w('#dropdownproperty')) {
        $w('#dropdownproperty').onChange(() => {
            currentFilter.propertyId = $w('#dropdownproperty').value || 'ALL';
            currentFilter.page = 1;
            loadData();
        });
    }
}

function bindSearchInput() {
    const input = $w('#inputsearch');
    if (!input) return;
    input.onInput(() => {
        if (searchInputTimer) clearTimeout(searchInputTimer);
        searchInputTimer = setTimeout(() => {
            currentFilter.keyword = (input.value && String(input.value).trim()) ? String(input.value).trim() : '';
            currentFilter.page = 1;
            loadData();
        }, 350);
    });
}

function bindCountryDropdown() {
    const countryOptions = [
        { value: 'ALL', label: 'All' },
        { value: 'Malaysia', label: 'Malaysia' },
        { value: 'Singapore', label: 'Singapore' }
    ];
    if ($w('#dropdowncountry')) {
        $w('#dropdowncountry').options = countryOptions;
        $w('#dropdowncountry').onChange(() => {
            currentFilter.country = $w('#dropdowncountry').value || 'ALL';
            currentFilter.page = 1;
            loadData();
        });
    }
}

function bindViewButton() {
    if (!$w('#buttonview')) return;
    $w('#buttonview').onClick(() => {
        viewMode = viewMode === 'grid' ? 'list' : 'grid';
        if (viewMode === 'grid') {
            if ($w('#sectiongrid')) $w('#sectiongrid').expand();
            if ($w('#sectionlist')) $w('#sectionlist').collapse();
        } else {
            if ($w('#sectiongrid')) $w('#sectiongrid').collapse();
            if ($w('#sectionlist')) $w('#sectionlist').expand();
        }
    });
}

/* ======================================================
   Grid repeater (renamed): #gallerygridview, #textgridprice, #textgridremark, #textgridavailable,
   #textgridproperty, #textgridroom, #buttongriddetail
====================================================== */

function bindGridRepeater() {
    const repeater = $w('#repeatergrid');
    if (!repeater) return;
    repeater.onItemReady(($item, itemData) => {
        const room = itemData;
        const propName = (room.property && room.property.shortname) ? room.property.shortname : '';
        const roomName = room.roomName || room.title_fld || '';
        const availableText = room.available ? 'Available' : (room.availablesoon ? 'Available Soon' : '');
        if ($item('#textgridprice')) $item('#textgridprice').text = formatPrice(room);
        if ($item('#textgridremark')) $item('#textgridremark').text = room.remark || '';
        if ($item('#textgridavailable')) $item('#textgridavailable').text = availableText;
        if ($item('#textgridproperty')) $item('#textgridproperty').text = propName;
        if ($item('#textgridroom')) $item('#textgridroom').text = roomName;
        if ($item('#gallerygridview')) {
            const urls = (room.mediaGallery && room.mediaGallery.length) ? room.mediaGallery.map(m => (typeof m === 'string' ? m : m.src || m.url)).filter(Boolean) : [];
            if (room.mainPhoto) urls.unshift(room.mainPhoto);
            $item('#gallerygridview').items = urls.length ? urls.map(src => ({ src, type: 'image' })) : [];
        }
        if ($item('#buttongriddetail')) {
            $item('#buttongriddetail').onClick(() => {
                selectedItem = room;
                showGridDetail();
            });
        }
        gridReadyCount++;
        if (gridReadyCount >= expectedGridReadyCount) showSectionWhenReady();
    });
}

function showGridDetail() {
    if (!selectedItem) return;
    const room = selectedItem;
    if ($w('#boxgrid')) $w('#boxgrid').show();
    const galleryUrls = (room.mediaGallery && room.mediaGallery.length) ? room.mediaGallery.map(m => (typeof m === 'string' ? m : m.src || m.url)).filter(Boolean) : [];
    if (room.mainPhoto) galleryUrls.unshift(room.mainPhoto);
    if ($w('#gallerygrid')) {
        $w('#gallerygrid').items = galleryUrls.length ? galleryUrls.map(src => ({ src, type: 'image' })) : [];
        if (galleryUrls.length > 0 && $w('#gallerygrid').expand) $w('#gallerygrid').expand();
        else if ($w('#gallerygrid').collapse) $w('#gallerygrid').collapse();
    }
    const videoUrl = (room.videoUrl && String(room.videoUrl).trim()) ? String(room.videoUrl).trim() : '';
    if ($w('#videoplayergrid')) {
        if (videoUrl) {
            if ($w('#videoplayergrid').src !== undefined) $w('#videoplayergrid').src = videoUrl;
            if ($w('#videoplayergrid').expand) $w('#videoplayergrid').expand();
        } else {
            if ($w('#videoplayergrid').collapse) $w('#videoplayergrid').collapse();
        }
    }
    if ($w('#textdescriptiongrid')) $w('#textdescriptiongrid').text = room.description_fld || room.remark || '';
    bindGridWhatsAppButton();
}

function bindGridWhatsAppButton() {
    const btn = $w('#buttongrid');
    if (!btn) return;
    btn.onClick(() => openWhatsApp(selectedItem));
}

/* ======================================================
   List repeater: #texttitlelist, #textpricelist, #textunitlist, #textavailablelist, #textroomlist, #textremarklist, #buttonmoredetaillist
====================================================== */

function bindListRepeater() {
    const repeater = $w('#repeaterlist');
    if (!repeater) return;
    repeater.onItemReady(($item, itemData) => {
        const room = itemData;
        const propName = (room.property && room.property.shortname) ? room.property.shortname : '';
        const roomName = room.roomName || room.title_fld || '';
        const availableText = room.available ? 'Available' : (room.availablesoon ? 'Available Soon' : '');
        if ($item('#texttitlelist')) $item('#texttitlelist').text = roomName;
        if ($item('#textpricelist')) $item('#textpricelist').text = formatPrice(room);
        if ($item('#textunitlist')) $item('#textunitlist').text = propName;
        if ($item('#textavailablelist')) $item('#textavailablelist').text = availableText;
        if ($item('#textroomlist')) $item('#textroomlist').text = roomName;
        if ($item('#textremarklist')) $item('#textremarklist').text = room.remark || '';
        if ($item('#buttonmoredetaillist')) {
            $item('#buttonmoredetaillist').onClick(() => {
                selectedItem = room;
                showListDetail();
            });
        }
    });
}

function showListDetail() {
    if (!selectedItem) return;
    const room = selectedItem;
    if ($w('#boxlist')) $w('#boxlist').show();
    const galleryUrls = (room.mediaGallery && room.mediaGallery.length) ? room.mediaGallery.map(m => (typeof m === 'string' ? m : m.src || m.url)).filter(Boolean) : [];
    if (room.mainPhoto) galleryUrls.unshift(room.mainPhoto);
    if ($w('#gallerylist')) {
        $w('#gallerylist').items = galleryUrls.length ? galleryUrls.map(src => ({ src, type: 'image' })) : [];
        if (galleryUrls.length > 0 && $w('#gallerylist').expand) $w('#gallerylist').expand();
        else if ($w('#gallerylist').collapse) $w('#gallerylist').collapse();
    }
    const videoUrl = (room.videoUrl && String(room.videoUrl).trim()) ? String(room.videoUrl).trim() : '';
    if ($w('#videoplayerlist')) {
        if (videoUrl) {
            if ($w('#videoplayerlist').src !== undefined) $w('#videoplayerlist').src = videoUrl;
            if ($w('#videoplayerlist').expand) $w('#videoplayerlist').expand();
        } else {
            if ($w('#videoplayerlist').collapse) $w('#videoplayerlist').collapse();
        }
    }
    if ($w('#textdescriptionlist')) $w('#textdescriptionlist').text = room.description_fld || room.remark || '';
    bindListWhatsAppButton();
}

function bindListWhatsAppButton() {
    const btn = $w('#buttonwhatsaplist');
    if (!btn) return;
    btn.onClick(() => openWhatsApp(selectedItem));
}

/* ======================================================
   WhatsApp: wasap.my/{clientContact}/{propertyname%20roomname%20enquiry}
   clientContact must include country code (e.g. 60122113361). Same as tenantdashboard.
====================================================== */

function openWhatsApp(room) {
    if (!room) return;
    const contact = (room.clientContact != null && String(room.clientContact).trim())
        ? room.clientContact
        : (listData.clientContact != null && String(listData.clientContact).trim() ? listData.clientContact : null);
    const phone = contact ? String(contact).trim().replace(/\D/g, '') : null;
    if (!phone) {
        console.warn('[available-unit] No client contact for WhatsApp');
        return;
    }
    const propName = (room.property && room.property.shortname) ? room.property.shortname : '';
    const roomName = room.title_fld || room.roomName || '';
    const message = [propName, roomName, 'enquiry'].filter(Boolean).join(' ');
    const path = message ? `/${encodeURIComponent(message).replace(/%20/g, '%20')}` : '';
    const url = `https://wasap.my/${phone}${path}`;
    wixLocation.to(url);
}

/* ======================================================
   Detail popup close & pagination
====================================================== */

function bindDetailPopups() {
    if ($w('#buttonclosegrid')) {
        $w('#buttonclosegrid').onClick(() => {
            if ($w('#boxgrid')) $w('#boxgrid').hide();
        });
    }
    const closeList = $w('#buttoncloselist');
    if (closeList) {
        closeList.onClick(() => {
            if ($w('#boxlist')) $w('#boxlist').hide();
        });
    }
}

function bindPagination() {
    const paginationGrid = $w('#paginationgrid');
    const paginationList = $w('#paginationlist');
    const go = (page) => {
        currentFilter.page = page;
        loadData();
    };
    if (paginationGrid) {
        paginationGrid.onChange((e) => go(e.target.currentPage));
    }
    if (paginationList) {
        paginationList.onChange((e) => go(e.target.currentPage));
    }
}

function updatePagination() {
    const totalPages = listData.totalPages || 1;
    const currentPage = listData.currentPage || 1;
    if ($w('#paginationgrid')) {
        $w('#paginationgrid').totalPages = totalPages;
        $w('#paginationgrid').currentPage = currentPage;
    }
    if ($w('#paginationlist')) {
        $w('#paginationlist').totalPages = totalPages;
        $w('#paginationlist').currentPage = currentPage;
    }
}
