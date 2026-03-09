/* ======================================================
   Booking Page Frontend（与旧 frontend/booking.js 同流程）
   全部数据通过 backend/saas/booking.jsw 请求 ECS Node，不读 Wix CMS。
   门禁：getAccessContext() 来自 backend/access/manage。credit < 0 时强制显示 Top Up，需在 Wix 编辑器中添加 #buttontopup。
   权限：booking || admin 可进入；否则 section default 显示 You don't have permission。
   元素 ID：#sectiondefault、#sectionbooking、#sectiontopup（僅點 #buttontopup 時展開；#buttontopupclose 返回上一 section）、#textstatusloading/#textsummary；#inputagreementfees/#inputparkingfees 從 Company Setting 帶入預設，訪客可改；topup 可選 #repeatertopup、#buttoncheckout、#buttontopupclose。
====================================================== */

import wixLocation from 'wix-location';
import wixWindow from 'wix-window';
import { getAccessContext } from 'backend/access/manage';
import { getMyBillingInfo, getCreditPlans, startNormalTopup } from 'backend/saas/topup';
import { getAdmin } from 'backend/saas/companysetting';
import {
    getAdminRules,
    getAvailableRooms,
    searchTenants,
    getTenant,
    getRoom,
    getParkingLotsByProperty,
    createBooking
} from 'backend/saas/booking';

const BUKKUID = {
    FORFEIT_DEPOSIT: '1c7e41b6-9d57-4c03-8122-a76baad3b592',
    MAINTENANCE_FEES: 'ae94f899-7f34-4aba-b6ee-39b97496e2a3',
    TOPUP_AIRCOND: '18ba3daf-7208-46fc-8e97-43f34e898401',
    OWNER_COMMISSION: '86da59c0-992c-4e40-8efd-9d6d793eaf6a',
    TENANT_COMMISSION: '94b4e060-3999-4c76-8189-f969615c0a7d',
    RENTAL_INCOME: 'cf4141b1-c24e-4fc1-930e-cfea4329b178',
    REFERRAL_FEES: 'e4fd92bb-de15-4ca0-9c6b-05e410815c58',
    PARKING_FEES: 'bdf3b91c-d2ca-4e42-8cc7-a5f19f271e00',
    MANAGEMENT_FEES: '620b2d43-4b3a-448f-8a5b-99eb2c3209c7',
    DEPOSIT: 'd3f72d51-c791-4ef0-aeec-3ed1134e5c86',
    AGREEMENT_FEES: '3411c69c-bfec-4d35-a6b9-27929f9d5bf6',
    OWNER_PAYOUT: 'e053b254-5a3c-4b82-8ba0-fd6d0df231d3',
    OTHER: 'bf502145-6ec8-45bd-a703-13c810cfe186'
};

let accessContext = null;
let currentStaff = null;
let currentAdminRules = null;
let addOns = [];
let selectedTopupPlanId = null;
let selectedTopupPlanCache = null;
/** 點 #buttontopupclose 時要返回的 section（sectionbooking 或 sectiondefault） */
let sectionBeforeTopup = 'sectionbooking';
let mobileMenuBound = false;

/** 仅当元素有 disable/enable 时调用，避免 Box/Text 报错 */
function setElDisabled(id, disabled) {
    try {
        const el = $w(id);
        if (typeof el.disable === 'function' && typeof el.enable === 'function') {
            disabled ? el.disable() : el.enable();
        }
    } catch (_) {}
}

/** 显示/隐藏：优先 show/hide，否则 expand/collapse */
function setElVisible(id, visible) {
    try {
        const el = $w(id);
        if (visible) {
            if (typeof el.show === 'function') el.show();
            else if (typeof el.expand === 'function') el.expand();
        } else {
            if (typeof el.hide === 'function') el.hide();
            else if (typeof el.collapse === 'function') el.collapse();
        }
    } catch (_) {}
}

/** Repeater item 内元素显示/隐藏 */
function setElVisibleInItem($item, selector, visible) {
    try {
        const el = $item(selector);
        if (visible) {
            if (typeof el.show === 'function') el.show();
            else if (typeof el.expand === 'function') el.expand();
        } else {
            if (typeof el.hide === 'function') el.hide();
            else if (typeof el.collapse === 'function') el.collapse();
        }
    } catch (_) {}
}

function setFormDisabled(disabled) {
    const ids = [
        '#buttonsave', '#inputrental', '#inputdeposit', '#inputagreementfees', '#inputparkingfees',
        '#datepicker1', '#datepicker2', '#radiogroupuser', '#inputemail', '#radiogroupproperty',
        '#checkboxgroupparkinglot', '#buttonaddon'
    ];
    ids.forEach(id => setElDisabled(id, disabled));
}

function debounce(fn, delay) {
    let timer;
    return function () {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, arguments), delay);
    };
}

/** 门禁拒绝统一文案：NO_PERMISSION → You don't have permission；其余 → You don't have account yet */
function getAccessDeniedMessage(reason) {
    return (reason === 'NO_PERMISSION') ? "You don't have permission" : "You don't have account yet";
}

/** 留在 sectiondefault，按钮 disable，显示 message */
function showAccessDenied(message) {
    try { $w('#sectiondefault').expand(); } catch (_) {}
    try { $w('#sectiontopup').collapse(); } catch (_) {}
    try { const t = $w('#textstatusloading'); t.text = message || "You don't have account yet"; t.show(); } catch (_) {}
    try { const s = $w('#textsummary'); s.text = message || "You don't have account yet"; s.show(); } catch (_) {}
    setFormDisabled(true);
    try { const b = $w('#buttontopup'); if (b?.disable) b.disable(); } catch (_) {}
}

let bookingTopupInited = false;
let bookingClientCurrency = 'MYR';
/** Credit < 0: 若有 #sectiontopup 则展开并初始化 topup；否则用 #textsummary + #buttontopup */
async function enterForcedTopupModeBooking() {
    sectionBeforeTopup = 'sectiondefault';
    setFormDisabled(true);
    try { $w('#sectiondefault').collapse(); } catch (_) {}
    try {
        const secTopup = $w('#sectiontopup');
        if (secTopup && typeof secTopup.expand === 'function') {
            secTopup.expand();
            if (!bookingTopupInited) {
                await initBookingTopupSection();
                bookingTopupInited = true;
            }
            return;
        }
    } catch (_) {}
    try {
        $w('#textsummary').text = 'Your credit balance is negative. Please top up to continue.';
        setElVisible('#textsummary', true);
    } catch (_) {}
    try {
        const btn = $w('#buttontopup');
        if (btn) {
            setElVisible('#buttontopup', true);
            if (typeof btn.label !== 'undefined') btn.label = 'Top Up';
            btn.onClick(async () => {
                try {
                    if (typeof btn.disable === 'function') btn.disable();
                    if (typeof btn.label !== 'undefined') btn.label = 'Loading...';
                    const plansRes = await getCreditPlans();
                    const plans = Array.isArray(plansRes) ? plansRes : (plansRes?.items || []);
                    const firstPlanId = plans[0]?.id || plans[0]?._id;
                    if (!firstPlanId) {
                        $w('#textsummary').text = 'No top-up plan available. Please contact support.';
                        if (typeof btn.enable === 'function') btn.enable();
                        if (typeof btn.label !== 'undefined') btn.label = 'Top Up';
                        return;
                    }
                    const topupRes = await startNormalTopup({ creditPlanId: firstPlanId, returnUrl: wixLocation.url });
                    const url = topupRes?.url || topupRes?.redirectUrl;
                    if (url) wixLocation.to(url);
                    else {
                        $w('#textsummary').text = 'Could not start top-up. Please try again or contact support.';
                        if (typeof btn.enable === 'function') btn.enable();
                        if (typeof btn.label !== 'undefined') btn.label = 'Top Up';
                    }
                } catch (e) {
                    console.error('[Booking] topup', e);
                    $w('#textsummary').text = `Error: ${e.message || 'Please try again.'}`;
                    if (typeof btn.enable === 'function') btn.enable();
                    if (typeof btn.label !== 'undefined') btn.label = 'Top Up';
                }
            });
        }
    } catch (_) {}
}

async function initBookingTopupSection() {
    const currency = (accessContext?.client?.currency || 'MYR').toUpperCase();
    bookingClientCurrency = currency;
    try {
        const billing = await getMyBillingInfo();
        const credits = Array.isArray(billing?.credit) ? billing.credit : [];
        const totalCredit = credits.reduce((s, c) => s + Number(c.amount || 0), 0);
        const te = $w('#textcurrentcredit');
        if (te) te.text = `Current Credit Balance: ${totalCredit}`;
    } catch (_) {}
    const plansRes = await getCreditPlans();
    const plans = Array.isArray(plansRes) ? plansRes : (plansRes?.items || []);
    try { $w('#repeatertopup').data = plans; } catch (_) {}
    try {
        $w('#repeatertopup').onItemReady(($item, plan) => {
            const id = plan.id || plan._id;
            try { $item('#textamount').text = `${bookingClientCurrency} ${plan.sellingprice || 0}`; } catch (_) {}
            try { $item('#textcreditamount').text = String(plan.credit || 0); } catch (_) {}
            try { $item('#textcredit').text = 'Credits'; } catch (_) {}
            try { $item('#boxcolor').hide(); } catch (_) {}
            $item('#containertopup').onClick(() => {
                selectedTopupPlanId = id;
                selectedTopupPlanCache = plan;
                try { $w('#repeatertopup').forEachItem(($i) => { try { $i('#boxcolor').hide(); } catch (_) {} }); } catch (_) {}
                try { $item('#boxcolor').show(); } catch (_) {}
            });
        });
    } catch (_) {}
    try {
        $w('#buttoncheckout').onClick(async () => {
            const plan = selectedTopupPlanCache;
            if (!plan) return;
            const pid = plan.id || plan._id;
            if (!pid) return;
            try { $w('#buttoncheckout').disable(); $w('#buttoncheckout').label = 'Loading...'; } catch (_) {}
            try {
                const res = await startNormalTopup({ creditPlanId: pid, returnUrl: wixLocation.url });
                if (res?.url) wixLocation.to(res.url);
                else { $w('#buttoncheckout').enable(); $w('#buttoncheckout').label = 'Checkout'; }
            } catch (e) {
                $w('#buttoncheckout').enable(); $w('#buttoncheckout').label = 'Checkout';
            }
        });
    } catch (_) {}
    try {
        $w('#buttontopupclose').onClick(handleTopupClose);
    } catch (_) {}
}

/** Mobile: 僅 #buttonmobilemenu 打開/收合 #boxmobilemenu，無需禁用菜單內按鈕 */
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
    } catch (_) {}
}

/** 統一關閉 Top Up：收合 sectiontopup、展開上一個 section（在 onReady 綁定，不依賴 init 是否跑完） */
function handleTopupClose() {
    try { $w('#sectiontopup').collapse(); } catch (_) {}
    try {
        const sec = $w('#' + sectionBeforeTopup);
        if (sec && typeof sec.expand === 'function') sec.expand();
    } catch (_) {}
    setFormDisabled(false);
}

/* ===============================  onReady  =============================== */
$w.onReady(async function () {
    try {
        /* Mobile: 僅 #buttonmobilemenu / #boxmobilemenu，onReady 即綁定以便訪客可立即打開菜單 */
        if (wixWindow.formFactor === 'Mobile') {
            try {
                $w('#buttonmobilemenu')?.show();
                $w('#buttonmobilemenu')?.enable();
                $w('#boxmobilemenu')?.hide();
                $w('#boxmobilemenu')?.collapse();
                bindMobileMenu();
            } catch (_) {}
        } else {
            try {
                $w('#buttonmobilemenu')?.hide();
                $w('#boxmobilemenu')?.hide();
            } catch (_) {}
        }

        accessContext = await getAccessContext();
        if (!accessContext?.ok) {
            showAccessDenied(getAccessDeniedMessage(accessContext.reason));
            return;
        }
        if (!accessContext.staff?.permission?.booking && !accessContext.staff?.permission?.admin) {
            showAccessDenied("You don't have permission");
            return;
        }

        if (accessContext.credit?.ok === false) {
            await enterForcedTopupModeBooking();
            return;
        }

        const res = await getAdminRules();
        if (!res?.ok) throw new Error('Failed to load admin rules');
        currentAdminRules = res.admin || null;
        currentStaff = accessContext.staff || null;

        await loadAvailableRooms();

        ['#inputrental', '#inputdeposit', '#inputagreementfees', '#inputparkingfees'].forEach(id => {
            try { $w(id).value = ''; } catch (_) {}
        });
        /* Company Setting 的 agreement fees / parking 自動帶入，訪客可改 */
        try {
            const adminRes = await getAdmin();
            if (adminRes?.ok && adminRes.admin) {
                const a = adminRes.admin;
                if (a.agreementFees != null && a.agreementFees !== '') try { $w('#inputagreementfees').value = String(a.agreementFees); } catch (_) {}
                if (a.parking != null && a.parking !== '') try { $w('#inputparkingfees').value = String(a.parking); } catch (_) {}
            }
        } catch (_) {}

        $w('#datepicker1').onChange(onDateChanged);
        $w('#datepicker2').onChange(onDateChanged);

        ['#inputrental', '#inputdeposit', '#inputagreementfees', '#inputparkingfees'].forEach(id => {
            try {
                $w(id).onInput(recalculateAll);
                $w(id).onChange(recalculateAll);
            } catch (_) {}
        });

        setElVisible('#radiogroupuser', false);
        $w('#inputemail').onInput(debounce(onEmailInput, 500));
        $w('#radiogroupuser').onChange(onTenantChanged);

        $w('#inputproperty').onInput(debounce(loadAvailableRooms, 400));
        $w('#radiogroupproperty').onChange(onPropertyChanged);

        $w('#checkboxgroupparkinglot').options = [];
        setElVisible('#checkboxgroupparkinglot', false);

        /* #textsummary、#texttenantdetail、#repeateraddon 初始无内容时隐藏 */
        $w('#textsummary').text = '';
        setElVisible('#textsummary', false);
        $w('#texttenantdetail').text = '';
        setElVisible('#texttenantdetail', false);
        $w('#repeateraddon').data = [];
        setElVisible('#repeateraddon', false);

        $w('#repeateraddon').onItemReady(($item, itemData, index) => {
            $item('#inputaddonname').value = itemData.name || '';
            $item('#inputaddonamount').value = itemData.amount != null ? String(itemData.amount) : '';
            $item('#inputaddonname').onInput(e => {
                addOns[index].name = e.target.value;
                recalculateAll();
            });
            $item('#inputaddonamount').onInput(e => {
                addOns[index].amount = Number(e.target.value) || 0;
                recalculateAll();
            });
            /* 只有 repeater 剩一个 item 时才显示可点的 #buttonremoveaddon；删掉后 collapse repeater */
            const removeBtn = $item('#buttonremoveaddon');
            if (addOns.length === 1) {
                setElVisibleInItem($item, '#buttonremoveaddon', true);
            } else {
                setElVisibleInItem($item, '#buttonremoveaddon', false);
            }
            removeBtn.onClick(() => {
                addOns.splice(index, 1);
                refreshAddOnRepeater();
                if (addOns.length === 0) {
                    setElVisible('#repeateraddon', false);
                }
                recalculateAll();
            });
        });

        $w('#buttonaddon').onClick(() => {
            addOns.push({ _id: String(Date.now()), name: '', amount: 0 });
            refreshAddOnRepeater();
            setElVisible('#repeateraddon', true);
        });

        $w('#buttonsave').onClick(onSubmit);

        setElVisible('#buttontopup', true);

        /* #sectiontopup 僅在點 #buttontopup 時展開；#buttontopupclose 返回上一個 section（onReady 即綁定） */
        sectionBeforeTopup = 'sectionbooking';
        try { $w('#sectiontopup').collapse(); } catch (_) {}
        try {
            $w('#buttontopupclose').onClick(handleTopupClose);
        } catch (_) {}
        try {
            $w('#buttontopup').onClick(async () => {
                sectionBeforeTopup = 'sectionbooking';
                const btn = $w('#buttontopup');
                try { if (btn?.disable) btn.disable(); if (btn?.label !== undefined) btn.label = 'Loading...'; } catch (_) {}
                try {
                    if (!bookingTopupInited) {
                        await initBookingTopupSection();
                        bookingTopupInited = true;
                    }
                } catch (e) {
                    console.error('[Booking] initBookingTopupSection', e);
                }
                try { $w('#sectionbooking').collapse(); } catch (_) {}
                try { $w('#sectiontopup').expand(); } catch (_) {}
                try { if (btn?.enable) btn.enable(); if (btn?.label !== undefined) btn.label = 'Top Up'; } catch (_) {}
            });
        } catch (_) {}

        /* init 成功後自動切到預約主畫面 */
        try { $w('#sectiondefault').collapse(); } catch (_) {}
        try { $w('#sectionbooking').expand(); } catch (_) {}
    } catch (err) {
        console.error('[Booking] onReady fatal:', err);
        showAccessDenied("You don't have account yet");
        setElDisabled('#buttonsave', true);
    }
});

/* ===============================  Tenant  =============================== */
async function onTenantChanged() {
    const tenantId = $w('#radiogroupuser').value;
    if (!tenantId) {
        clearTenantDetailText();
        return;
    }

    try {
        const res = await getTenant(tenantId);
        if (res?.ok && res.tenant) showTenantDetailText({ tenant: res.tenant });
    } catch (_) {}

    try { $w('#inputemail').value = ''; } catch (_) {}

    const start = $w('#datepicker1').value;
    const end = $w('#datepicker2').value;
    if (start && end) calculateTenancyFinancial();
}

/* ===============================  Summary  =============================== */
function updateSummary() {
    const currency = accessContext?.client?.currency || 'MYR';
    const rental = Number($w('#inputrental').value) || 0;
    const deposit = Number($w('#inputdeposit').value) || 0;
    const agreement = Number($w('#inputagreementfees').value) || 0;
    const parking = Number($w('#inputparkingfees').value) || 0;
    const addOnTotal = addOns.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
    const total = rental + deposit + agreement + parking + addOnTotal;
    const lines = [
        `Rental: ${currency} ${rental}`, `Deposit: ${currency} ${deposit}`,
        `Agreement Fees: ${currency} ${agreement}`, `Parking Fees: ${currency} ${parking}`,
        '--------------------------', 'ADD-ONS',
        ...(addOns.length ? addOns.map(a => `${a.name || 'Add-on'}: ${currency} ${Number(a.amount || 0)}`) : ['No Add-ons']),
        `Add-on Total: ${currency} ${addOnTotal}`, '--------------------------', `TOTAL: ${currency} ${total}`
    ];
    $w('#textsummary').text = lines.join('\n');
    const hasContent = total > 0 || addOns.length > 0 || rental > 0 || deposit > 0 || agreement > 0 || parking > 0;
    setElVisible('#textsummary', hasContent);
}

/* ===============================  Submit  =============================== */
async function onSubmit() {
    try {
        try { $w('#buttonsave').label = 'Loading...'; } catch (_) {}
        setFormDisabled(true);

        const tenantIdSelected = $w('#radiogroupuser').value;
        const emailInputRaw = ($w('#inputemail').value || '').trim();
        const emailInput = emailInputRaw.toLowerCase();
        const roomId = $w('#radiogroupproperty').value;
        const beginDate = $w('#datepicker1').value;
        const endDate = $w('#datepicker2').value;
        const rental = Number($w('#inputrental').value) || 0;
        const deposit = Number($w('#inputdeposit').value) || 0;
        const agreementFees = Number($w('#inputagreementfees').value) || 0;
        const parkingFees = Number($w('#inputparkingfees').value) || 0;
        const selectedParkingLots = $w('#checkboxgroupparkinglot').value || [];

        if (!roomId || !beginDate || !endDate) throw new Error('Room and dates required.');
        if (!tenantIdSelected && !emailInput) throw new Error('Tenant email is required.');

        const addOnsPayload = addOns.map(a => ({ name: a.name || '', amount: Number(a.amount) || 0 }));
        const billingBlueprint = generateBillingBlueprint();
        const commissionSnapshot = currentAdminRules?.commissionRules || [];

        const result = await createBooking({
            tenantIdSelected: tenantIdSelected || null,
            emailInput: emailInput || null,
            roomId,
            beginDate,
            endDate,
            rental,
            deposit,
            agreementFees,
            parkingFees,
            selectedParkingLots,
            addOns: addOnsPayload,
            billingBlueprint,
            commissionSnapshot,
            adminRules: currentAdminRules || null
        });

        if (!result?.ok) throw new Error(result?.reason || 'Create failed');

        try { $w('#buttonsave').label = 'Complete'; } catch (_) {}
        setTimeout(() => wixLocation.to(wixLocation.url), 5000);

    } catch (err) {
        console.error('[Booking Submit Error]', err);
        $w('#textsummary').text = `❌ ERROR\n\n${err.message || err}`;
        setElVisible('#textsummary', true);
        try { $w('#buttonsave').label = 'Save'; } catch (_) {}
        setFormDisabled(false);
    }
}

/* ===============================  Loaders  =============================== */
async function loadAvailableRooms() {
    if (!accessContext?.client?.id) return;

    const keyword = ($w('#inputproperty').value || '').trim();
    const res = await getAvailableRooms(keyword);

    if (!res?.ok || !res.items?.length) {
        $w('#radiogroupproperty').options = [{
            label: res?.message || 'No room available',
            value: ''
        }];
        return;
    }

    $w('#radiogroupproperty').options = [
        { label: 'Select Room', value: '' },
        ...res.items.map(r => ({ label: r.label || r.title_fld || r._id, value: r.value || r._id }))
    ];
}

async function onEmailInput() {
    const keywordRaw = ($w('#inputemail').value || '').trim();
    if (keywordRaw.length < 5) {
        $w('#radiogroupuser').options = [];
        setElVisible('#radiogroupuser', false);
        clearNewTenantMessage();
        return;
    }

    const keyword = keywordRaw.toLowerCase();
    const blockedDomains = ['gmail', 'hotmail', 'yahoo', 'outlook'];
    const isFullEmail = keyword.includes('@') && keyword.includes('.');
    const isBlockedShort = !isFullEmail && blockedDomains.some(d => keyword === d || keyword.startsWith(d));
    if (isBlockedShort) {
        $w('#radiogroupuser').options = [];
        setElVisible('#radiogroupuser', false);
        $w('#texttenantdetail').text = '⚠️ Public email keyword search is restricted.\n\nPlease enter a full email address.';
        setElVisible('#texttenantdetail', true);
        return;
    }

    const res = await searchTenants(keyword);
    const items = res?.ok && res.items ? res.items : [];

    if (!items.length) {
        $w('#radiogroupuser').options = [];
        setElVisible('#radiogroupuser', false);
        showNewTenantMessage(keywordRaw);
        return;
    }

    setElVisible('#texttenantdetail', false);
    $w('#radiogroupuser').options = items.map(t => ({
        label: `${t.fullname || ''} (${t.email || t.phone || ''})`.trim() || t._id,
        value: t.value || t._id
    }));
    $w('#radiogroupuser').value = null;
    setElVisible('#radiogroupuser', true);
    clearTenantDetailText();
}

function showNewTenantMessage(keyword) {
    $w('#texttenantdetail').text = `⚠️ New Tenant\nKeyword: ${keyword}\n\nThis tenant is not yet registered.`;
    setElVisible('#texttenantdetail', true);
}

function clearNewTenantMessage() {
    $w('#texttenantdetail').text = '';
    setElVisible('#texttenantdetail', false);
}

async function onPropertyChanged() {
    const roomId = $w('#radiogroupproperty').value;
    if (!roomId) return;

    let room;
    try {
        const res = await getRoom(roomId);
        if (!res?.ok || !res.room) return;
        room = res.room;
    } catch (err) {
        console.error('[RoomChanged] load failed:', err);
        return;
    }

    const rental = Number(room.price != null ? room.price : room.rental) || 0;
    $w('#inputrental').value = String(rental);

    let deposit = 0;
    if (currentAdminRules?.deposit?.type === '1') deposit = rental;
    else if (currentAdminRules?.deposit?.type === 'specific') deposit = Number(currentAdminRules.deposit?.value) || 0;
    $w('#inputdeposit').value = String(deposit);

    let agreementFees = 0;
    if (currentAdminRules?.agreementFees != null) agreementFees = Number(currentAdminRules.agreementFees) || 0;
    else if (currentAdminRules?.payout?.type === 'specific') agreementFees = Number(currentAdminRules.payout?.value) || 0;
    $w('#inputagreementfees').value = String(agreementFees);

    const parkingFees = Number(currentAdminRules?.parking) || 0;
    $w('#inputparkingfees').value = String(parkingFees);

    addOns = [];
    if (currentAdminRules?.otherFees?.amount) {
        addOns.push({
            _id: String(Date.now()),
            name: currentAdminRules.otherFees.name || 'Admin Fee',
            amount: Number(currentAdminRules.otherFees.amount) || 0
        });
    }
    refreshAddOnRepeater();
    setElVisible('#repeateraddon', addOns.length > 0);

    const propertyId = room.property_id || room.property?._id || room.property;
    if (propertyId) {
        const parkRes = await getParkingLotsByProperty(propertyId);
        const parkItems = parkRes?.ok && parkRes.items ? parkRes.items : [];
        if (parkItems.length) {
            $w('#checkboxgroupparkinglot').options = parkItems.map(p => ({
                label: p.parkinglot || p.label || p._id,
                value: p.value || p._id
            }));
            $w('#checkboxgroupparkinglot').value = [];
            setElVisible('#checkboxgroupparkinglot', true);
        } else {
            $w('#checkboxgroupparkinglot').options = [];
            setElVisible('#checkboxgroupparkinglot', false);
        }
    } else {
        $w('#checkboxgroupparkinglot').options = [];
        setElVisible('#checkboxgroupparkinglot', false);
    }

    recalculateAll();
}

function showTenantDetailText({ tenant = null, keyword = null } = {}) {
    if (tenant) {
        $w('#texttenantdetail').text =
            `Tenant Selected\nName: ${tenant.fullname || '-'}\nEmail: ${tenant.email || '-'}\nPhone: ${tenant.phone || '-'}`;
        setElVisible('#texttenantdetail', true);
        return;
    }
    if (keyword) {
        $w('#texttenantdetail').text = `⚠️ New Tenant\nKeyword: ${keyword}\nThis tenant is not yet registered.`;
        setElVisible('#texttenantdetail', true);
        return;
    }
    $w('#texttenantdetail').text = '';
    setElVisible('#texttenantdetail', false);
}

function clearTenantDetailText() {
    $w('#texttenantdetail').text = '';
    setElVisible('#texttenantdetail', false);
}

/* ===============================  Date  =============================== */
function onDateChanged() {
    const startRaw = $w('#datepicker1').value;
    const endRaw = $w('#datepicker2').value;
    if (!startRaw || !endRaw) return;

    const start = toMYDate(startRaw);
    const end = toMYDate(endRaw);
    const rentalRule = currentAdminRules?.rental || {};
    const forcedEnd = getForcedEndDate(start, end, rentalRule);
    if (forcedEnd) {
        $w('#datepicker2').value = forcedEnd;
    }
    calculateTenancyFinancial();
}

function toMYDate(date) {
    const d = new Date(date);
    return new Date(d.getTime() + 8 * 60 * 60 * 1000);
}

function getForcedEndDate(startDate, inputEndDate, rentalRule) {
    const type = rentalRule?.type;
    if (!type || type === 'movein') return null;
    const y = inputEndDate.getFullYear();
    const m = inputEndDate.getMonth();
    const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
    if (type === 'first' || type === 'last') return new Date(y, m + 1, 0);
    if (type === 'specific' && rentalRule.value) {
        const billingDay = Number(rentalRule.value);
        const monthDays = daysInMonth(y, m);
        const actualBillingDay = Math.min(billingDay, monthDays);
        const boundaryDay = actualBillingDay - 1;
        return new Date(y, m, boundaryDay);
    }
    return null;
}

/* ===============================  Financial + Billing  =============================== */
function calculateTenancyFinancial() {
    if (!currentAdminRules) return;
    const currency = accessContext?.client?.currency || 'MYR';
    const startDate = $w('#datepicker1').value;
    const endDate = $w('#datepicker2').value;
    if (!startDate || !endDate) return;

    const rentalMonthly = Number($w('#inputrental').value) || 0;
    const parkingMonthly = Number($w('#inputparkingfees').value) || 0;
    const agreement = Number($w('#inputagreementfees').value) || 0;
    const deposit = Number($w('#inputdeposit').value) || 0;
    const addOnTotal = addOns.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);

    const toMY = d => new Date(new Date(d).toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
    const s = toMY(startDate);
    const e = toMY(endDate);
    const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
    const prorate = (monthly, used, total) => Number(((monthly / total) * used).toFixed(2));

    const sy = s.getFullYear(), sm = s.getMonth(), sd = s.getDate(), smDays = daysInMonth(sy, sm);
    const firstDays = smDays - sd + 1;
    const firstRental = prorate(rentalMonthly, firstDays, smDays);
    const firstParking = prorate(parkingMonthly, firstDays, smDays);

    let rentalTotal = firstRental, parkingTotal = firstParking;
    let cursor = new Date(sy, sm + 1, 1);
    while (cursor <= e) {
        const y = cursor.getFullYear(), m = cursor.getMonth(), mdays = daysInMonth(y, m);
        const monthEnd = new Date(y, m, mdays);
        if (monthEnd > e) {
            const usedDays = e.getDate();
            rentalTotal += prorate(rentalMonthly, usedDays, mdays);
            parkingTotal += prorate(parkingMonthly, usedDays, mdays);
            break;
        }
        rentalTotal += rentalMonthly;
        parkingTotal += parkingMonthly;
        cursor = new Date(y, m + 1, 1);
    }

    const totalMonths = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
    const effectiveMonth = Math.min(totalMonths, 24);
    const commissionRule = currentAdminRules?.commissionRules?.find(r => Number(r.month) === effectiveMonth);
    let commission = 0, commissionByTenant = false;
    if (commissionRule) {
        if (commissionRule.chargeon === 'tenant') commissionByTenant = true;
        switch (commissionRule.amountType) {
            case 'prorate': commission = firstRental; break;
            case '0.5': case '1': case '1.5': case '2': case '2.5': case '3':
                commission = rentalMonthly * Number(commissionRule.amountType); break;
            case 'specific': commission = Number(commissionRule.fixedAmount) || 0; break;
            default: commission = 0;
        }
    }
    const amountToMoveIn = deposit + agreement + addOnTotal + (commissionByTenant ? commission : 0) + firstRental + firstParking;

    const lines = [
        `Tenancy Period Months = ${totalMonths}`,
        `Commission Rule Used = Month ${effectiveMonth}`,
        '--------------------------',
        `Prorate Rental = ${currency}${firstRental.toFixed(2)}`,
        `Prorate Parking = ${currency}${firstParking.toFixed(2)}`,
        '--------------------------',
        `Rental Total = ${currency}${rentalTotal.toFixed(2)}`,
        `Parking Total = ${currency}${parkingTotal.toFixed(2)}`,
        '--------------------------',
        commissionByTenant ? `Commission (Tenant) = ${currency}${commission.toFixed(2)}` : 'Commission = Paid by Owner',
        '==========================',
        `TOTAL MOVE IN = ${currency}${amountToMoveIn.toFixed(2)}`
    ];
    $w('#textsummary').text = lines.join('\n');
    setElVisible('#textsummary', true);
}

function recalculateAll() {
    const start = $w('#datepicker1').value;
    const end = $w('#datepicker2').value;
    if (!start || !end) {
        updateSummary();
        return;
    }
    calculateTenancyFinancial();
}

function refreshAddOnRepeater() {
    $w('#repeateraddon').data = addOns.map(a => ({ _id: a._id, name: a.name, amount: a.amount }));
}

function generateBillingBlueprint() {
    if (!currentAdminRules) return [];
    const startDate = $w('#datepicker1').value;
    const endDate = $w('#datepicker2').value;
    if (!startDate || !endDate) return [];

    const rentalMonthly = Number($w('#inputrental').value) || 0;
    const parkingMonthly = Number($w('#inputparkingfees').value) || 0;
    const agreement = Number($w('#inputagreementfees').value) || 0;
    const deposit = Number($w('#inputdeposit').value) || 0;
    const s = new Date(startDate);
    const e = new Date(endDate);
    const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
    const prorate = (monthly, used, total) => Number(((monthly / total) * used).toFixed(2));
    const billing = [];
    const totalMonths = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
    const effectiveMonth = Math.min(totalMonths, 24);
    let monthIndex = 1;
    let cursor = new Date(s);
    let firstRentalAmount = 0;

    while (cursor <= e) {
        const y = cursor.getFullYear(), m = cursor.getMonth(), mdays = daysInMonth(y, m);
        const monthStart = new Date(y, m, 1), monthEnd = new Date(y, m, mdays);
        const periodStart = monthIndex === 1 ? s : monthStart;
        const periodEnd = monthEnd > e ? e : monthEnd;
        const usedDays = (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24) + 1;
        const rentalAmount = usedDays === mdays ? rentalMonthly : prorate(rentalMonthly, usedDays, mdays);
        const parkingAmount = usedDays === mdays ? parkingMonthly : prorate(parkingMonthly, usedDays, mdays);
        if (monthIndex === 1) firstRentalAmount = rentalAmount;
        const dueDate = getDueDateForMonth(y, m, s, currentAdminRules?.rental);

        if (rentalAmount > 0) billing.push({
            type: 'rental', monthIndex, periodStart, periodEnd, dueDate, chargeon: 'tenant',
            amount: rentalAmount, bukkuid: BUKKUID.RENTAL_INCOME
        });
        if (parkingAmount > 0) billing.push({
            type: 'parking', monthIndex, periodStart, periodEnd, dueDate, chargeon: 'tenant',
            amount: parkingAmount, bukkuid: BUKKUID.PARKING_FEES
        });
        cursor = new Date(y, m + 1, 1);
        monthIndex++;
    }

    if (deposit > 0) billing.push({ type: 'deposit', dueDate: s, chargeon: 'tenant', amount: deposit, bukkuid: BUKKUID.DEPOSIT });
    if (agreement > 0) billing.push({ type: 'agreement', dueDate: s, chargeon: 'tenant', amount: agreement, bukkuid: BUKKUID.AGREEMENT_FEES });
    addOns.forEach(a => {
        if (a.amount > 0) billing.push({ type: 'addon', dueDate: s, chargeon: 'tenant', amount: Number(a.amount), bukkuid: BUKKUID.OTHER });
    });

    const commissionRule = currentAdminRules?.commissionRules?.find(r => Number(r.month) === effectiveMonth);
    if (commissionRule) {
        let commissionAmount = 0;
        switch (commissionRule.amountType) {
            case 'prorate': commissionAmount = firstRentalAmount; break;
            case '0.5': case '1': case '1.5': case '2': case '2.5': case '3':
                commissionAmount = rentalMonthly * Number(commissionRule.amountType); break;
            case 'specific': commissionAmount = Number(commissionRule.fixedAmount) || 0; break;
        }
        if (commissionAmount > 0) billing.push({
            type: 'commission', dueDate: s, chargeon: commissionRule.chargeon, amount: commissionAmount,
            bukkuid: commissionRule.chargeon === 'tenant' ? BUKKUID.TENANT_COMMISSION : BUKKUID.OWNER_COMMISSION
        });
    }
    return billing;
}

function getDueDateForMonth(year, month, moveInDate, billingRule) {
    const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
    const type = billingRule?.type;
    if (!type || type === 'movein') {
        const moveInDay = moveInDate.getDate();
        const maxDay = daysInMonth(year, month);
        return new Date(year, month, Math.min(moveInDay, maxDay));
    }
    if (type === 'first') return new Date(year, month, 1);
    if (type === 'last') return new Date(year, month + 1, 0);
    if (type === 'specific' && billingRule.value) {
        const specificDay = Number(billingRule.value);
        const maxDay = daysInMonth(year, month);
        return new Date(year, month, Math.min(specificDay, maxDay));
    }
    return new Date(year, month, 1);
}
