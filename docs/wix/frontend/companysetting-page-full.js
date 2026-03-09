/* ======================================================
   Company Setting Page Frontend
   全部数据通过 backend/saas/companysetting.jsw 与 backend/saas/billing.jsw 请求 ECS，不读 Wix CMS。
   门禁：getAccessContext() 且 client.active === true。
   无 #boxintegration、#repeaterintegration；Onboard 按钮直接调 ECS，点击时 disable + Loading 再跳转/提交。
   #sectiontab：Section（始终 expand），内放 #buttonprofile、#buttonusersetting、#buttonintegration、#buttonadmin。#buttontopup 可在其外。
   Mobile：collapse sectiontab + 各内容 section，保留 #sectiondefault、#sectionheader 展开；#textstatusloading 保留并一直显示 "Please setting on pc version"（不 hide）。
   调试：编辑器内 Preview 的 Developer Console 不会显示本页 log。请用「在浏览器中预览」或打开 test/live site，再 F12→Console 查看（或打开 yi9ee.js）。Preview 测 mobile 可加 ?mobile=1。
====================================================== */

import wixLocation from 'wix-location';
import wixWindow from 'wix-window';
import {
    getAccessContext,
    getUploadCreds,
    getStaffList,
    createStaff,
    updateStaff,
    getProfile,
    updateProfile,
    getBanks,
    getAdmin,
    saveAdmin,
    getOnboardStatus,
    getIntegrationTemplate,
    stripeDisconnect,
    getStripeConnectOnboardUrl,
    stripeConnectOAuthComplete,
    cnyiotConnect,
    cnyiotDisconnect,
    getCnyiotCredentials,
    bukkuConnect,
    getBukkuCredentials,
    bukkuDisconnect,
    autocountConnect,
    getAutoCountCredentials,
    autocountDisconnect,
    sqlConnect,
    getSqlAccountCredentials,
    sqlDisconnect,
    updateAccountingEinvoice,
    getXeroAuthUrl,
    xeroConnect,
    xeroDisconnect,
    ttlockConnect,
    getTtlockCredentials,
    ttlockDisconnect
} from 'backend/saas/companysetting';
import { getMyBillingInfo, getCreditPlans, startNormalTopup } from 'backend/saas/topup';
import { submitTicket } from 'backend/saas/help';

console.log("[Company Setting] CODE FILE LOADED");

// 最早时机捕获 URL/query（Stripe 带着 code 返回时可能稍后被清掉，用快照保证能处理）
let capturedLoadUrl = '';
let capturedLoadQuery = {};
try {
    if (typeof wixLocation !== 'undefined') {
        capturedLoadUrl = wixLocation.url || '';
        capturedLoadQuery = (wixLocation.query && typeof wixLocation.query === 'object') ? { ...wixLocation.query } : {};
    }
    console.log('[Company Setting] URL at script load', capturedLoadUrl ? capturedLoadUrl.substring(0, 130) : '(empty)', 'queryKeys=', Object.keys(capturedLoadQuery).length ? Object.keys(capturedLoadQuery).join(',') : '(none)');
} catch (e) {
    console.warn('[Company Setting] URL capture at load failed', e);
}

const STAFF_PAGE_SIZE = 10;
const MAIN_SECTIONS = ['profile', 'usersetting', 'integration', 'topup', 'admin'];
const PERMISSION_OPTIONS = [
    { label: 'Finance', value: 'finance' },
    { label: 'Tenant Detail', value: 'tenantdetail' },
    { label: 'Account', value: 'accounting' },
    { label: 'Property Detail', value: 'propertylisting' },
    { label: 'Marketing', value: 'marketing' },
    { label: 'Booking', value: 'booking' },
    { label: 'Profile Setting', value: 'profilesetting' },
    { label: 'Billing', value: 'billing' },
    { label: 'Integration', value: 'integration' },
    { label: 'User Setting', value: 'usersetting' },
    { label: 'Admin', value: 'admin' }
];

const MONTH_END_REMARK = 'If this month has fewer days, we will proceed on the last day of the month.';

const UI_PERMISSION_MAP = {
    buttoneditprofile: ['profilesetting', 'admin'],
    buttonprofile: ['profilesetting', 'admin'],
    buttonadmin: ['admin'],
    sectionadmin: ['admin'],
    buttonusersetting: ['usersetting', 'admin'],
    sectionusersetting: ['usersetting', 'admin'],
    buttonintegration: ['integration', 'admin'],
    sectionintegration: ['integration', 'admin'],
    buttontopup: ['billing', 'admin'],
    buttonpricingplan: ['billing', 'admin']
};

const SECTION_BUTTON_IDS = {
    profile: '#buttonprofile',
    usersetting: '#buttonusersetting',
    integration: '#buttonintegration',
    topup: '#buttontopup',
    admin: '#buttonadmin'
};

let accessCtx = null;
let currentClientId = null;
let currentStaffId = null;
let clientCurrency = 'MYR';
let activeSection = null;
let sectionLoaded = { profile: false, usersetting: false, integration: false, topup: false, admin: false };
let allStaffItems = [];
let staffRepeaterBound = false;
let paginationUsersettingBound = false;
let closeUserSettingBound = false;
let currentEditingUserId = null;
let isCreateMode = false;
let updateUserButtonBound = false;
let newUserButtonBound = false;
let profileBound = false;
let adminBound = false;
let topupInited = false;
let topupRepeaterBound = false;
let topupCheckoutBound = false;
let selectedTopupPlanId = null;
let selectedTopupPlanCache = null;
let onboardButtonsBound = false;
let accountSelectionBound = false;
let currentOnboardType = null;
let lastSectionBeforeTopup = 'profile';
let onboardStatus = { stripeConnected: false, cnyiotConnected: false, cnyiotDisconnectedWithMode: null, accountingConnected: false, accountingProvider: null, accountingEinvoice: false, ttlockConnected: false, ttlockCreateEverUsed: false, ttlockDisconnectedWithMode: null };
let integrationTemplateCache = null;
let onboardEditMode = false;
let onboardSubmitConfirmPending = false;
let onboardDisconnectMode = false;
let profileUploadMessageBound = false;
let profilePhotoUrl = null;
let companyChopMessageBound = false;
let companyChopUrl = null;
let currentCompanyChop = '';
let mainAdminEmail = '';
/** Max staff allowed (1 + Extra User addon qty). Used to disable #buttonnewuser when at limit. */
let maxStaffAllowed = 1;
const CONFIRM_DISCONNECT_LABEL = 'Disconnect now?';
const XERO_DISCONNECT_LABEL = 'Disconnect xero now';
/** Wix SDK only accepts: "red"|"#FF0000"|"#FF000000"|"rgb(r,g,b)"|"rgba(r,g,b,a)". Use rgb/rgba to avoid validation errors. */
const BUTTON_DEFAULT_BG = 'rgba(224, 224, 224, 1)';
const BUTTON_DEFAULT_COLOR = 'rgb(0, 0, 0)';

function setAccountButtonDisconnectStyle(on) {
    const btn = $w('#buttonaccountonboard');
    if (!btn) return;
    try {
        if (btn.style) {
            btn.style.backgroundColor = on ? 'rgb(229, 57, 53)' : BUTTON_DEFAULT_BG;
            btn.style.color = on ? 'rgb(0, 0, 0)' : BUTTON_DEFAULT_COLOR;
        }
    } catch (_) {}
}
function setAccountButtonConnectedStyle(connected) {
    const btn = $w('#buttonaccountonboard');
    if (!btn) return;
    try {
        if (btn.style) {
            btn.style.backgroundColor = connected ? 'rgb(67, 160, 71)' : BUTTON_DEFAULT_BG;
            btn.style.color = connected ? 'rgb(0, 0, 0)' : BUTTON_DEFAULT_COLOR;
        }
    } catch (_) {}
}
function setStripeButtonConnectedStyle(connected) {
    const btn = $w('#buttonstripeonboard');
    if (!btn) return;
    try {
        if (btn.style) {
            btn.style.backgroundColor = connected ? 'rgb(67, 160, 71)' : BUTTON_DEFAULT_BG;
            btn.style.color = connected ? 'rgb(0, 0, 0)' : BUTTON_DEFAULT_COLOR;
        }
    } catch (_) {}
}
function setTtlockButtonConnectedStyle(connected) {
    const btn = $w('#buttonttlockonboard');
    if (!btn) return;
    try {
        if (btn.style) {
            btn.style.backgroundColor = connected ? 'rgb(67, 160, 71)' : BUTTON_DEFAULT_BG;
            btn.style.color = connected ? 'rgb(0, 0, 0)' : BUTTON_DEFAULT_COLOR;
        }
    } catch (_) {}
}
function setCnyiotButtonConnectedStyle(connected) {
    const btn = $w('#buttoncnyiotonboard');
    if (!btn) return;
    try {
        if (btn.style) {
            btn.style.backgroundColor = connected ? 'rgb(67, 160, 71)' : BUTTON_DEFAULT_BG;
            btn.style.color = connected ? 'rgb(0, 0, 0)' : BUTTON_DEFAULT_COLOR;
        }
    } catch (_) {}
}
function setOnboardCloseButtonEnabled(enabled) {
    try {
        const closeBtn = $w('#buttoncloseonboard');
        if (closeBtn) {
            if (enabled && closeBtn.enable) closeBtn.enable();
            else if (!enabled && closeBtn.disable) closeBtn.disable();
        }
    } catch (_) {}
}

/** 仅当 wixWindow.formFactor === "Mobile" 时走 mobile 分支；Tablet 走 desktop。加 console 便于真机调试。 */
let _isMobileView = false;
function isMobileView() {
    return _isMobileView;
}

function runMobileBranch() {
    _isMobileView = true;
    console.log("[Company Setting] this is mobile version");
    // Mobile: 保留 #textstatusloading，一直显示，不 hide
    $w('#textstatusloading').text = 'Please setting on pc version';
    $w('#textstatusloading').show();
    // Mobile: collapse sectiontab + 各内容 section，保留 sectiondefault、sectionheader
    function applyMobileSections() {
        try {
            safeCollapse($w('#sectiontab'));
            MAIN_SECTIONS.forEach(k => { safeCollapse($w(`#section${k}`)); });
            safeExpand($w('#sectiondefault'));
            safeExpand($w('#sectionheader'));
        } catch (e) {
            console.warn('[Company Setting] applyMobileSections error:', e);
        }
    }
    applyMobileSections();
    setTimeout(applyMobileSections, 100);
    setTimeout(applyMobileSections, 400);
}

function runDesktopBranch() {
    _isMobileView = false;
    console.log('[Company Setting] runDesktopBranch: full init');
    disableMainActions();
    initDefaultSection();
    $w('#textstatusloading').show();
    if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
    setOnboardError('');
    startInitAsync();
}

$w.onReady(function () {
    var _url = (typeof wixLocation !== 'undefined' && wixLocation.url) ? wixLocation.url : '';
    var _q = (typeof wixLocation !== 'undefined' && wixLocation.query) ? wixLocation.query : {};
    var _qk = _q && typeof _q === 'object' ? Object.keys(_q) : [];
    console.log("[Company Setting] ON READY RUNNING url=" + (_url ? _url.substring(0, 100) : '') + " queryKeys=" + (_qk.length ? _qk.join(',') : '(none)'));
    console.log("Device:", wixWindow.formFactor);
    try {
        const loadingEl = $w('#textstatusloading');
        if (loadingEl) { loadingEl.text = 'Company Setting loaded'; loadingEl.show(); }
    } catch (_) {}
    const q = (wixLocation && wixLocation.query) ? wixLocation.query : {};
    // Stripe OAuth 返回：在 getBoundingRect 之前立即处理，避免 URL 被清掉导致漏请求
    if (q && q.code && q.state) {
        console.log('[Company Setting] ON READY: Stripe OAuth return detected, handling before getBoundingRect');
        handleStripeConnectOAuthCallbackIfNeeded(q, _url || (typeof wixLocation !== 'undefined' && wixLocation.url ? wixLocation.url : ''));
        return;
    }
    if (q.mobile === '1' || q.mobile === 1) {
        console.log("[Company Setting] this is mobile version (?mobile=1)");
        runMobileBranch();
        return;
    }
    if (wixWindow.formFactor === "Mobile") {
        console.log("[Company Setting] this is mobile version");
        runMobileBranch();
        return;
    }
    if (typeof wixWindow.getBoundingRect === 'function') {
        wixWindow.getBoundingRect().then(function (rect) {
            const w = (rect && rect.window && rect.window.width) != null ? rect.window.width : 9999;
            console.log('[Company Setting] getBoundingRect width=', w);
            if (w < 992) {
                console.log("[Company Setting] this is mobile version (width<992)");
                runMobileBranch();
                return;
            }
            console.log('[Company Setting] width>=992 -> runDesktopBranch');
            runDesktopBranch();
        }).catch(function (err) {
            console.warn('[Company Setting] getBoundingRect failed:', err);
            runDesktopBranch();
        });
        return;
    }
    console.log('[Company Setting] -> runDesktopBranch');
    runDesktopBranch();
});

async function startInitAsync() {
    try {
        // 优先用「脚本加载时」的快照，避免 URL 在 onReady/getBoundingRect 之后被清掉
        const hasCaptured = capturedLoadQuery && capturedLoadQuery.code && capturedLoadQuery.state;
        const q = hasCaptured ? capturedLoadQuery : ((typeof wixLocation !== 'undefined' && wixLocation.query) ? wixLocation.query : {});
        const fullUrl = (hasCaptured && capturedLoadUrl) ? capturedLoadUrl : ((typeof wixLocation !== 'undefined' && wixLocation.url) ? wixLocation.url : '');
        const queryKeys = q && typeof q === 'object' ? Object.keys(q) : [];
        const urlPreview = fullUrl ? fullUrl.substring(0, 100) + (fullUrl.length > 100 ? '...' : '') : '';
        console.log('[Company Setting] startInitAsync url=', urlPreview, 'queryKeys=', queryKeys.length ? queryKeys.join(',') : '(none)', 'usedCapture=', !!hasCaptured);
        if (queryKeys.length) {
            console.log('[Company Setting] 返回页 URL', urlPreview, 'queryKeys=', queryKeys.join(','));
        }
        // Stripe Connect OAuth 回调优先：带 code+state 时先换 token 并跳转干净 URL
        if (q && q.code && q.state) {
            console.log('[Company Setting] 返回页：识别为 Stripe OAuth 回调，执行 handleStripeConnectOAuthCallbackIfNeeded');
            await handleStripeConnectOAuthCallbackIfNeeded(q, fullUrl);
            return;
        }
        accessCtx = await getAccessContext();
        if (!accessCtx.ok) {
            showAccessDenied(accessCtx.reason === 'NO_PERMISSION' ? "You don't have permission" : "You don't have account yet");
            return;
        }
        if (!accessCtx.client || !accessCtx.client.id) {
            showAccessDenied("You don't have account yet");
            return;
        }
        if (accessCtx.client.active !== true && accessCtx.client.status !== true) {
            showAccessDenied("You don't have account yet");
            return;
        }
        currentClientId = accessCtx.client.id;
        currentStaffId = accessCtx.staff?.id || null;
        clientCurrency = String(accessCtx.client.currency || 'MYR').toUpperCase();
        const permissions = accessCtx.staff?.permission || {};
        if (!Object.values(permissions).some(Boolean)) {
            showAccessDenied("You don't have permission");
            return;
        }
        applyUIPermissions(permissions);
        // Credit < 0: force topup section, do not load other sections
        if (accessCtx.credit?.ok === false) {
            await enterForcedTopupModeManage();
            if (!isMobileView()) { console.log('[Company Setting] text hide (#textstatusloading)'); $w('#textstatusloading').hide(); }
            enableMainActions();
            return;
        }
        // Seed accounting onboard from access context (capability.accounting = plan allows; accountProvider = actually connected)
        const accountProvider = accessCtx.capability?.accountProvider || null;
        onboardStatus.accountingProvider = accountProvider;
        onboardStatus.accountingConnected = !!accountProvider;
        bindSectionSwitch();
        bindOnboardButtons();
        await handleXeroCallbackIfNeeded();
        await refreshOnboardButtonLabels();
        bindNewUserButton();
        bindUpdateUserButton();
        bindCloseUserSettingBox();
        if (!isMobileView()) { console.log('[Company Setting] text hide (#textstatusloading)'); $w('#textstatusloading').hide(); }
        enableMainActions();
    } catch (err) {
        console.error('[INIT FAILED]', err);
        showAccessDenied('Unable to verify account');
    }
}

function applyUIPermissions(permissionResult) {
    Object.entries(UI_PERMISSION_MAP).forEach(([id, required]) => {
        const allow = required.some(p => permissionResult[p]);
        const el = $w(`#${id}`);
        if (!el) return;
        if (!allow) {
            if (el.disable) el.disable();
        } else {
            if (el.enable) el.enable();
        }
    });
}

function disableMainActions() {
    ['#buttonprofile', '#buttonusersetting', '#buttonintegration', '#buttontopup', '#buttonadmin'].forEach(id => {
        const el = $w(id);
        if (el?.disable) el.disable();
    });
}

function enableMainActions() {
    ['#buttonprofile', '#buttonusersetting', '#buttonintegration', '#buttontopup', '#buttonadmin'].forEach(id => {
        const el = $w(id);
        if (el?.enable) el.enable();
    });
}

function safeExpand(el) {
    try {
        if (!el) return;
        if (typeof (el.expand) === 'function') el.expand();
    } catch (_) {}
}
function safeCollapse(el) {
    try {
        if (!el) return;
        if (typeof (el.collapse) === 'function') el.collapse();
    } catch (_) {}
}

function initDefaultSection() {
    try {
        safeExpand($w('#sectionheader'));
        safeExpand($w('#sectiondefault'));
        MAIN_SECTIONS.forEach(k => {
            safeCollapse($w(`#section${k}`));
        });
    } catch (_) {}
}

function showAccessDenied(message) {
    try { initDefaultSection(); } catch (_) {}
    try {
        MAIN_SECTIONS.forEach(k => {
            safeCollapse($w(`#section${k}`));
        });
    } catch (_) {}
    const el = $w('#textstatusloading');
    if (el) {
        el.show();
        el.text = message || "You don't have permission";
    }
    disableMainActions();
}

function collapseAllSections() {
    try {
        MAIN_SECTIONS.forEach(k => {
            safeCollapse($w(`#section${k}`));
        });
    } catch (_) {}
}

/** Show onboard/integration error in #texterroronboard. Pass '' to clear and hide. #texttitleintegration stays as default label (e.g. System Integration). */
function setOnboardError(message) {
    try {
        const el = $w('#texterroronboard');
        if (!el) return;
        el.text = message || '';
        if (message) {
            if (el.show) el.show();
        } else {
            if (el.hide) el.hide();
        }
    } catch (_) {}
}

/** Credit < 0: show topup section only; user must top up before leaving */
async function enterForcedTopupModeManage() {
    collapseAllSections();
    safeCollapse($w('#sectiondefault'));
    if (!topupInited) {
        await initTopupSection();
        topupInited = true;
    }
    safeExpand($w('#sectiontopup'));
    activeSection = 'topup';
}

function bindSectionSwitch() {
    $w('#buttonprofile').onClick(() => switchSectionAsync('profile'));
    $w('#buttonusersetting').onClick(() => switchSectionAsync('usersetting'));
    $w('#buttonintegration').onClick(() => switchSectionAsync('integration'));
    $w('#buttonadmin').onClick(() => switchSectionAsync('admin'));
    $w('#buttontopup').onClick(() => {
        lastSectionBeforeTopup = activeSection || 'profile';
        switchSectionAsync('topup');
    });
}

async function switchSectionAsync(sectionKey) {
    if (activeSection === sectionKey) return;
    const btnId = SECTION_BUTTON_IDS[sectionKey];
    const btn = btnId ? $w(btnId) : null;
    let oldLabel = '';
    if (btn) {
        if (typeof btn.disable === 'function') btn.disable();
        if (typeof btn.label !== 'undefined') { oldLabel = btn.label; btn.label = 'Loading...'; }
    }
    try {
        collapseAllSections();
        safeCollapse($w('#sectiondefault'));
        if (sectionKey === 'topup' && !topupInited) {
            await initTopupSection();
            topupInited = true;
        }
        if (!sectionLoaded[sectionKey]) {
            if ($w('#text19')) { $w('#text19').show(); $w('#text19').text = 'Loading...'; }
            if (sectionKey === 'profile') await loadProfileSection();
            if (sectionKey === 'usersetting') await loadUserSettingSection();
            if (sectionKey === 'integration') {
                setOnboardError('');
                await refreshOnboardButtonLabels();
                if (!integrationTemplateCache && typeof getIntegrationTemplate === 'function') {
                    try {
                        const t = await getIntegrationTemplate();
                        if (t && Array.isArray(t.items)) integrationTemplateCache = t.items;
                    } catch (e) {
                        console.error('[getIntegrationTemplate]', e);
                    }
                }
            }
            if (sectionKey === 'admin') await loadAdminSection();
            if ($w('#text19')) $w('#text19').hide();
            sectionLoaded[sectionKey] = true;
        }
        safeExpand($w(`#section${sectionKey}`));
        activeSection = sectionKey;
    } finally {
        if (btn) {
            if (typeof btn.enable === 'function') btn.enable();
            if (typeof btn.label !== 'undefined' && oldLabel !== '') btn.label = oldLabel;
        }
    }
}

function bindHtmlUploadProfileMessage() {
    if (profileUploadMessageBound) return;
    profileUploadMessageBound = true;
    try {
        $w('#htmluploadbuttonprofile').onMessage((event) => {
            const d = event.data;
            if (d && d.type === 'UPLOAD_SUCCESS' && d.url) {
                profilePhotoUrl = d.url;
                if ($w('#imageprofile')) $w('#imageprofile').src = d.url;
                try { $w('#htmluploadbuttonprofile').postMessage({ type: 'SET_LABEL', label: 'Replace Company Logo / Profile photo' }); } catch (_) {}
            }
        });
    } catch (_) {}
}

function bindHtmlCompanyChopMessage() {
    if (companyChopMessageBound) return;
    companyChopMessageBound = true;
    try {
        $w('#htmlcompanychop').onMessage((event) => {
            const d = event.data;
            if (d && d.type === 'UPLOAD_SUCCESS' && d.url) {
                companyChopUrl = d.url;
                if ($w('#imagecompanychop')) $w('#imagecompanychop').src = d.url;
                try { $w('#htmlcompanychop').postMessage({ type: 'SET_LABEL', label: 'Replace Company Chop' }); } catch (_) {}
            }
        });
    } catch (_) {}
}

/** @param {boolean} [hasValue] - true = show "Replace ...", false/undefined = show "Upload ..." */
async function initHtmlUploadProfile(hasValue) {
    try {
        if (!currentClientId) return;
        const creds = await getUploadCreds();
        if (!creds.ok || !creds.baseUrl) return;
        const label = hasValue ? 'Replace Company Logo / Profile photo' : 'Upload Company logo/profile photo';
        $w('#htmluploadbuttonprofile').postMessage({
            type: 'INIT',
            baseUrl: creds.baseUrl,
            token: creds.token,
            username: creds.username,
            clientId: currentClientId,
            uploadId: 'profile',
            label,
            accept: 'image/*'
        });
    } catch (e) {
        console.error('initHtmlUploadProfile', e);
    }
}

/** @param {boolean} [hasValue] - true = show "Replace ...", false/undefined = show "Upload ..." */
async function initHtmlCompanyChop(hasValue) {
    try {
        if (!currentClientId) return;
        const creds = await getUploadCreds();
        if (!creds.ok || !creds.baseUrl) return;
        const label = hasValue ? 'Replace Company Chop' : 'Upload Company Chop';
        $w('#htmlcompanychop').postMessage({
            type: 'INIT',
            baseUrl: creds.baseUrl,
            token: creds.token,
            username: creds.username,
            clientId: currentClientId,
            uploadId: 'companychop',
            uploadPath: '/api/upload/chop',
            makeBackgroundWhite: true,
            label,
            accept: 'image/*'
        });
    } catch (e) {
        console.error('initHtmlCompanyChop', e);
    }
}

async function loadProfileSection() {
    const res = await getProfile();
    if (!res.ok) return;
    const { client, profile } = res;
    if ($w('#dropdowncurrency')) {
        $w('#dropdowncurrency').options = [{ label: 'MYR', value: 'MYR' }, { label: 'SGD', value: 'SGD' }];
        $w('#dropdowncurrency').value = client.currency || 'MYR';
        $w('#dropdowncurrency').disable(); // Currency is set at registration or by admin only; read-only here.
    }
    const bankRes = await getBanks();
    if (bankRes.ok && bankRes.items && $w('#dropdownbank')) {
        $w('#dropdownbank').options = bankRes.items;
        $w('#dropdownbank').value = profile.bankId || null;
    }
    $w('#textcompanynameprofile').text = client.title || '';
    $w('#textssmprofile').text = profile.ssm || '';
    $w('#textaddressprofile').text = profile.address || '';
    $w('#textcontactprofile').text = profile.contact || '';
    $w('#textsubdomainprofile').text = profile.subdomain || '';
    if ($w('#imageprofile')) $w('#imageprofile').src = client.profilephoto || '';
    if ($w('#input1profile')) $w('#input1profile').value = client.title || '';
    if ($w('#input2profile')) $w('#input2profile').value = profile.ssm || '';
    if ($w('#input3profile')) $w('#input3profile').value = profile.address || '';
    if ($w('#input4profile')) $w('#input4profile').value = profile.contact || '';
    if ($w('#input5profile')) $w('#input5profile').value = profile.subdomain || '';
    if ($w('#inputtin')) $w('#inputtin').value = profile.tin || '';
    if ($w('#inputaccountnumber')) $w('#inputaccountnumber').value = profile.accountnumber || '';
    if ($w('#inputaccountholder')) $w('#inputaccountholder').value = profile.accountholder || '';
    if ($w('#dropdownbank')) $w('#dropdownbank').value = profile.bankId || null;
    if ($w('#imagecompanychop')) {
        const chopUrl = profile.companyChop || '';
        $w('#imagecompanychop').src = chopUrl;
        if (chopUrl) $w('#imagecompanychop').show(); else $w('#imagecompanychop').hide();
    }
    if (!profileBound) {
        profileBound = true;
        $w('#buttoneditprofile').onClick(async () => {
            const latest = await getProfile();
            if (!latest.ok) return;
            const { client: c, profile: p } = latest;
            if ($w('#dropdowncurrency')) $w('#dropdowncurrency').value = c.currency || 'MYR';
            if ($w('#input1profile')) $w('#input1profile').value = c.title || '';
            if ($w('#input2profile')) $w('#input2profile').value = p.ssm || '';
            if ($w('#input3profile')) $w('#input3profile').value = p.address || '';
            if ($w('#input4profile')) $w('#input4profile').value = p.contact || '';
            if ($w('#input5profile')) $w('#input5profile').value = p.subdomain || '';
            if ($w('#inputtin')) $w('#inputtin').value = p.tin || '';
            if ($w('#inputaccountnumber')) $w('#inputaccountnumber').value = p.accountnumber || '';
            if ($w('#inputaccountholder')) $w('#inputaccountholder').value = p.accountholder || '';
            if ($w('#dropdownbank')) $w('#dropdownbank').value = p.bankId || null;
            profilePhotoUrl = null;
            companyChopUrl = null;
            currentCompanyChop = p.companyChop || '';
            if ($w('#boxprofile')) $w('#boxprofile').show();
            initHtmlUploadProfile(!!(c.profilephoto));
            initHtmlCompanyChop(!!(p.companyChop));
        });
        bindHtmlUploadProfileMessage();
        bindHtmlCompanyChopMessage();
        $w('#buttoncloseprofile').onClick(() => {
            if ($w('#boxprofile')) $w('#boxprofile').hide();
        });
        $w('#buttonsaveprofile').onClick(async () => {
            const btn = $w('#buttonsaveprofile');
            btn.disable();
            btn.label = 'Saving...';
            try {
                await updateProfile({
                    title: ($w('#input1profile').value || '').trim(),
                    ssm: ($w('#input2profile').value || '').trim(),
                    address: ($w('#input3profile').value || '').trim(),
                    contact: ($w('#input4profile').value || '').replace(/\s+/g, ''),
                    subdomain: ($w('#input5profile').value || '').trim().toLowerCase(),
                    tin: ($w('#inputtin').value || '').trim(),
                    accountnumber: ($w('#inputaccountnumber').value || '').trim(),
                    accountholder: ($w('#inputaccountholder').value || '').trim(),
                    bankId: $w('#dropdownbank').value || null,
                    profilephoto: profilePhotoUrl || null,
                    companyChop: (companyChopUrl != null ? companyChopUrl : currentCompanyChop) || ''
                });
                profilePhotoUrl = null;
                companyChopUrl = null;
                if ($w('#boxprofile')) $w('#boxprofile').hide();
                await loadProfileSection();
                $w('#textcompanynameprofile').text = ($w('#input1profile').value || '').trim();
                $w('#textssmprofile').text = ($w('#input2profile').value || '').trim();
                $w('#textaddressprofile').text = ($w('#input3profile').value || '').trim();
                $w('#textcontactprofile').text = ($w('#input4profile').value || '').trim();
                $w('#textsubdomainprofile').text = ($w('#input5profile').value || '').trim().toLowerCase();
            } catch (e) {
                console.error('[PROFILE SAVE]', e);
            } finally {
                btn.label = 'Update';
                btn.enable();
            }
        });
    }
}

async function loadUserSettingSection() {
    const res = await getStaffList();
    allStaffItems = (res.ok && res.items) ? res.items : [];
    mainAdminEmail = (res.ok && res.mainAdminEmail) ? String(res.mainAdminEmail).trim().toLowerCase() : '';
    maxStaffAllowed = (res.ok && res.maxStaffAllowed != null) ? Number(res.maxStaffAllowed) : 1;
    const totalPages = Math.max(1, Math.ceil(allStaffItems.length / STAFF_PAGE_SIZE));
    if ($w('#paginationusersetting')) {
        $w('#paginationusersetting').totalPages = totalPages;
        $w('#paginationusersetting').currentPage = 1;
        if (!paginationUsersettingBound) {
            paginationUsersettingBound = true;
            $w('#paginationusersetting').onChange((e) => renderStaffPage(e.target.currentPage));
        }
    }
    const bankRes = await getBanks();
    if (bankRes.ok && bankRes.items && $w('#dropdownbanknameusersetting')) {
        $w('#dropdownbanknameusersetting').options = bankRes.items;
    }
    if ($w('#checkboxgroupusersetting')) $w('#checkboxgroupusersetting').options = PERMISSION_OPTIONS;
    renderStaffPage(1);
    updateNewUserButtonState();
    if (!staffRepeaterBound) {
        staffRepeaterBound = true;
        $w('#repeaterusersetting').onItemReady(($item, item) => {
            $item('#textnameusersetting').text = item.name || '';
            $item('#textemailusersetting').text = item.email || '';
            const isMainAdmin = mainAdminEmail && String((item.email || '')).trim().toLowerCase() === mainAdminEmail;
            $item('#checkboxusersetting').checked = item.status === true;
            if (isMainAdmin) $item('#checkboxusersetting').disable(); else $item('#checkboxusersetting').enable();
            $item('#checkboxusersetting').onChange(async (e) => {
                if (isMainAdmin) return;
                const cb = e.target;
                cb.disable();
                try {
                    await updateStaff(item._id, { status: cb.checked });
                    const r = await getStaffList();
                    allStaffItems = (r.ok && r.items) ? r.items : [];
                    maxStaffAllowed = (r.ok && r.maxStaffAllowed != null) ? Number(r.maxStaffAllowed) : 1;
                    renderStaffPage($w('#paginationusersetting').currentPage);
                    updateNewUserButtonState();
                } catch (err) {
                    cb.checked = !cb.checked;
                } finally {
                    cb.enable();
                }
            });
            $item('#buttoneditstaffdetail').onClick(() => openEditUserBox(item));
        });
    }
}

function renderStaffPage(page) {
    const start = (page - 1) * STAFF_PAGE_SIZE;
    const pageItems = allStaffItems.slice(start, start + STAFF_PAGE_SIZE);
    $w('#repeaterusersetting').data = pageItems;
}

/** Disable #buttonnewuser when at Extra User addon limit (allStaffItems.length >= maxStaffAllowed). */
function updateNewUserButtonState() {
    try {
        if (allStaffItems.length >= maxStaffAllowed) $w('#buttonnewuser').disable();
        else $w('#buttonnewuser').enable();
    } catch (_) {}
}

function openEditUserBox(item) {
    isCreateMode = false;
    currentEditingUserId = item._id;
    $w('#boxeditusersetting').show();
    $w('#buttonupdateusersetting').label = 'Update User';
    $w('#texttitleeditusersetting').text = 'Edit User';
    $w('#inputnameusersetting').value = item.name || '';
    $w('#inputemailusersetting').value = item.email || '';
    $w('#inputsalaryusersetting').value = item.salary != null ? String(item.salary) : '';
    $w('#inputbankaccountusersetting').value = item.bankAccount || '';
    $w('#dropdownbanknameusersetting').value = item.bankName || null;
    const isMainAdmin = mainAdminEmail && String((item.email || '')).trim().toLowerCase() === mainAdminEmail;
    if (isMainAdmin) {
        $w('#checkboxgroupusersetting').value = PERMISSION_OPTIONS.map(o => o.value);
        $w('#checkboxgroupusersetting').disable();
    } else {
        $w('#checkboxgroupusersetting').value = item.permission || [];
        $w('#checkboxgroupusersetting').enable();
    }
}

function bindCloseUserSettingBox() {
    if (closeUserSettingBound) return;
    closeUserSettingBound = true;
    $w('#buttoncloseusersetting').onClick(() => $w('#boxeditusersetting').hide());
}

function bindNewUserButton() {
    if (newUserButtonBound) return;
    newUserButtonBound = true;
    $w('#buttonnewuser').onClick(() => {
        isCreateMode = true;
        currentEditingUserId = null;
        $w('#boxeditusersetting').show();
        $w('#buttonupdateusersetting').label = 'Create User';
        $w('#texttitleeditusersetting').text = 'Create New User';
        $w('#inputnameusersetting').value = '';
        $w('#inputemailusersetting').value = '';
        $w('#inputsalaryusersetting').value = '';
        $w('#inputbankaccountusersetting').value = '';
        $w('#dropdownbanknameusersetting').value = null;
        $w('#checkboxgroupusersetting').value = [];
        $w('#checkboxgroupusersetting').enable();
    });
}

function getPermissionArray() {
    return $w('#checkboxgroupusersetting').value || [];
}

function bindUpdateUserButton() {
    if (updateUserButtonBound) return;
    updateUserButtonBound = true;
    $w('#buttonupdateusersetting').onClick(async () => {
        const btn = $w('#buttonupdateusersetting');
        btn.disable();
        btn.label = 'Saving...';
        try {
            const payload = {
                name: ($w('#inputnameusersetting').value || '').trim(),
                email: ($w('#inputemailusersetting').value || '').trim().toLowerCase(),
                salary: $w('#inputsalaryusersetting').value || '',
                bankAccount: ($w('#inputbankaccountusersetting').value || '').replace(/\s+/g, ''),
                bankName: $w('#dropdownbanknameusersetting').value || null,
                permission: getPermissionArray(),
                syncToAccounting: true
            };
            if (isCreateMode) {
                await createStaff(payload);
            } else if (currentEditingUserId) {
                await updateStaff(currentEditingUserId, payload);
                if (currentEditingUserId === currentStaffId && accessCtx) {
                    accessCtx.staff.permission = payload.permission.reduce((o, k) => ({ ...o, [k]: true }), {});
                    applyUIPermissions(accessCtx.staff.permission);
                }
            }
            $w('#boxeditusersetting').hide();
            const res = await getStaffList();
            allStaffItems = (res.ok && res.items) ? res.items : [];
            maxStaffAllowed = (res.ok && res.maxStaffAllowed != null) ? Number(res.maxStaffAllowed) : 1;
            renderStaffPage($w('#paginationusersetting').currentPage);
            updateNewUserButtonState();
        } catch (err) {
            console.error('[USER SAVE]', err);
            if (err?.message === 'STAFF_LIMIT_REACHED' && $w('#boxeditusersetting')) $w('#boxeditusersetting').hide();
        } finally {
            btn.label = isCreateMode ? 'Create User' : 'Update User';
            btn.enable();
        }
    });
}

async function loadAdminSection() {
    if (!adminBound) {
        adminBound = true;
        ['#inputagreementfees', '#inputotherfeesamount', '#inputduedate'].forEach(id => {
            if ($w(id)) $w(id).onInput(() => { $w(id).value = ($w(id).value || '').replace(/[^\d]/g, ''); });
        });
        $w('#dropdownpayout').options = [
            { label: 'First day of every month', value: 'first' },
            { label: 'Last day of every month', value: 'last' },
            { label: 'Specific date of every month', value: 'specific' }
        ];
        bindSpecificDateDropdown('#dropdownpayout', '#inputpayout');
        $w('#dropdownsalary').options = [
            { label: 'First day of every month', value: 'first' },
            { label: 'Last day of every month', value: 'last' },
            { label: 'Specific date of every month', value: 'specific' }
        ];
        bindSpecificDateDropdown('#dropdownsalary', '#inputsalary');
        $w('#dropdownrental').options = [
            { label: 'First day of every month', value: 'first' },
            { label: 'Last day of every month', value: 'last' },
            { label: 'Specific date of every month', value: 'specific' },
            { label: 'Move in date', value: 'movein' }
        ];
        $w('#dropdownrental').value = 'first';
        bindSpecificDateDropdown('#dropdownrental', '#inputrental');
        $w('#dropdowndeposit').options = [
            { label: '0.5 month of rental', value: '0.5' },
            { label: '1 month of rental', value: '1' },
            { label: '1.5 month of rental', value: '1.5' },
            { label: '2 month of rental', value: '2' },
            { label: '2.5 month of rental', value: '2.5' },
            { label: '3 month of rental', value: '3' },
            { label: 'Specific amount', value: 'specific' }
        ];
        $w('#dropdowndeposit').value = '1';
        bindSpecificAmountDropdown('#dropdowndeposit', '#inputdeposit');
        $w('#dropdownsmartdoor').options = [
            { label: 'Yes', value: 'yes' },
            { label: 'No', value: 'no' }
        ];
        $w('#dropdownsmartdoor').value = 'yes';
        $w('#dropdownmeter').options = [
            { label: 'Yes', value: 'yes' },
            { label: 'No', value: 'no' }
        ];
        $w('#dropdownmeter').value = 'yes';
        $w('#dropdowncomission').options = [
            { label: 'First day of every month', value: 'first' },
            { label: 'Last day of every month', value: 'last' },
            { label: 'Specific date of every month', value: 'specific' },
            { label: 'Move in date', value: 'movein' }
        ];
        bindSpecificDateDropdown('#dropdowncomission', '#inputcomission');
        if ($w('#inputpayout') && $w('#textpayoutremark')) bindDayInput('#inputpayout', '#textpayoutremark');
        if ($w('#inputsalary') && $w('#textsalaryremark')) bindDayInput('#inputsalary', '#textsalaryremark');
        if ($w('#inputrental') && $w('#textrentalremark')) bindDayInput('#inputrental', '#textrentalremark');
        if ($w('#inputcomission') && $w('#textcomissionremark')) bindDayInput('#inputcomission', '#textcomissionremark');
        initCommissionRepeater();
        $w('#buttonsaveadmindetail').onClick(saveAdminDetail);
    }
    await loadAdminDetail();
}

function bindSpecificDateDropdown(dropdownId, inputId) {
    const dropdown = $w(dropdownId);
    const input = $w(inputId);
    if (!dropdown || !input) return;
    input.hide();
    dropdown.onChange(() => {
        if (dropdown.value === 'specific') {
            input.show();
        } else {
            input.hide();
            input.value = '';
        }
    });
}

function bindSpecificAmountDropdown(dropdownId, inputId) {
    const dropdown = $w(dropdownId);
    const input = $w(inputId);
    if (!dropdown || !input) return;
    input.hide();
    dropdown.onChange(() => {
        if (dropdown.value === 'specific') {
            input.show();
        } else {
            input.hide();
            input.value = '';
        }
    });
}

function bindDayInput(inputId, remarkTextId) {
    const input = $w(inputId);
    const remark = $w(remarkTextId);
    if (!input || !remark) return;
    remark.hide();
    input.onInput(() => {
        let val = parseInt(input.value, 10);
        if (isNaN(val)) { remark.hide(); return; }
        if (val < 1) val = 1;
        if (val > 31) val = 31;
        input.value = String(val);
        if (val >= 28) {
            remark.text = MONTH_END_REMARK;
            remark.show();
        } else {
            remark.hide();
        }
    });
}

function initCommissionRepeater() {
    const commissionData = [];
    for (let i = 1; i <= 24; i++) {
        commissionData.push({
            _id: String(i),
            month: i,
            chargeon: i < 6 ? 'tenant' : 'owner',
            amountType: 'prorate',
            fixedAmount: ''
        });
    }
    $w('#repeatercomission').data = commissionData;
    $w('#repeatercomission').onItemReady(($item, item) => {
        const period = $item('#dropdowncomissionperiod');
        const chargeon = $item('#dropdowncomissionchargeon');
        const amount = $item('#dropdowncomissionamount');
        const inputAmount = $item('#inputcomissionamount');
        if (period) period.disable();
        if (period) {
            period.options = Array.from({ length: 24 }, (_, i) => ({ label: `${i + 1} month`, value: String(i + 1) }));
            period.value = String(item.month);
        }
        if (chargeon) {
            chargeon.options = [{ label: 'Owner', value: 'owner' }, { label: 'Tenant', value: 'tenant' }];
            chargeon.value = item.chargeon;
        }
        if (amount) {
            amount.options = [
                { label: '0.5 month of rental', value: '0.5' },
                { label: '1 month of rental', value: '1' },
                { label: '1.5 month of rental', value: '1.5' },
                { label: '2 month of rental', value: '2' },
                { label: '2.5 month of rental', value: '2.5' },
                { label: '3 month of rental', value: '3' },
                { label: 'Specific amount', value: 'specific' },
                { label: 'Prorate according tenancy', value: 'prorate' }
            ];
            amount.value = item.amountType;
        }
        if (inputAmount) inputAmount.hide();
        if (amount) {
            amount.onChange(() => {
                item.amountType = amount.value;
                if (amount.value === 'specific') {
                    if (inputAmount) inputAmount.show();
                } else {
                    if (inputAmount) { inputAmount.hide(); inputAmount.value = ''; item.fixedAmount = ''; }
                }
            });
        }
        if (inputAmount) inputAmount.onInput(() => { item.fixedAmount = inputAmount.value; });
    });
}

async function loadAdminDetail() {
    const res = await getAdmin();
    const admin = res.ok ? res.admin : null;
    if (!admin) return;
    if (admin.dueDate !== undefined && $w('#inputduedate')) $w('#inputduedate').value = admin.dueDate;
    if (admin.payout && $w('#dropdownpayout')) {
        $w('#dropdownpayout').value = admin.payout.type;
        if (admin.payout.type === 'specific' && $w('#inputpayout')) {
            $w('#inputpayout').show();
            $w('#inputpayout').value = admin.payout.value || '';
        }
    }
    if (admin.salary && $w('#dropdownsalary')) {
        $w('#dropdownsalary').value = admin.salary.type;
        if (admin.salary.type === 'specific' && $w('#inputsalary')) {
            $w('#inputsalary').show();
            $w('#inputsalary').value = admin.salary.value || '';
        }
    }
    if (admin.rental && $w('#dropdownrental')) {
        $w('#dropdownrental').value = admin.rental.type;
        if (admin.rental.type === 'specific' && $w('#inputrental')) {
            $w('#inputrental').show();
            $w('#inputrental').value = admin.rental.value || '';
        }
    }
    if (admin.deposit && $w('#dropdowndeposit')) {
        $w('#dropdowndeposit').value = admin.deposit.type;
        if (admin.deposit.type === 'specific' && $w('#inputdeposit')) {
            $w('#inputdeposit').show();
            $w('#inputdeposit').value = admin.deposit.value || '';
        }
    }
    if (admin.agreementFees !== undefined && $w('#inputagreementfees')) $w('#inputagreementfees').value = admin.agreementFees;
    if (admin.otherFees) {
        if ($w('#inputotherfeesname')) $w('#inputotherfeesname').value = admin.otherFees.name || '';
        if ($w('#inputotherfeesamount')) $w('#inputotherfeesamount').value = admin.otherFees.amount || '';
    }
    if (admin.parking !== undefined && $w('#inputparking')) $w('#inputparking').value = admin.parking;
    if (admin.smartDoor && $w('#dropdownsmartdoor')) $w('#dropdownsmartdoor').value = admin.smartDoor;
    if (admin.meter && $w('#dropdownmeter')) $w('#dropdownmeter').value = admin.meter;
    if (admin.commissionDate && $w('#dropdowncomission')) {
        $w('#dropdowncomission').value = admin.commissionDate.type;
        if (admin.commissionDate.type === 'specific' && $w('#inputcomission')) {
            $w('#inputcomission').show();
            $w('#inputcomission').value = admin.commissionDate.value || '';
        }
    }
    if (Array.isArray(admin.commissionRules) && $w('#repeatercomission')) $w('#repeatercomission').data = admin.commissionRules;
}

async function saveAdminDetail() {
    const btn = $w('#buttonsaveadmindetail');
    const oldLabel = btn.label;
    btn.disable();
    btn.label = 'Updating...';
    try {
        const admin = {
            payout: { type: $w('#dropdownpayout').value, value: $w('#inputpayout').value || null },
            dueDate: $w('#inputduedate').value || null,
            salary: { type: $w('#dropdownsalary').value, value: $w('#inputsalary').value || null },
            rental: { type: $w('#dropdownrental').value, value: $w('#inputrental').value || null },
            deposit: { type: $w('#dropdowndeposit').value, value: $w('#inputdeposit').value || null },
            agreementFees: $w('#inputagreementfees').value || null,
            otherFees: { name: $w('#inputotherfeesname').value || null, amount: $w('#inputotherfeesamount').value || null },
            parking: $w('#inputparking').value || null,
            smartDoor: $w('#dropdownsmartdoor').value,
            meter: $w('#dropdownmeter').value,
            commissionDate: { type: $w('#dropdowncomission').value, value: $w('#inputcomission').value || null },
            commissionRules: $w('#repeatercomission').data || []
        };
        await saveAdmin(admin);
        btn.label = 'Complete';
        setTimeout(() => { btn.label = oldLabel; btn.enable(); }, 2000);
    } catch (err) {
        console.error('[ADMIN SAVE]', err);
        btn.label = oldLabel;
        btn.enable();
    }
}

async function initTopupSection() {
    const billing = await getMyBillingInfo();
    const credits = Array.isArray(billing.credit) ? billing.credit : [];
    const totalCredit = credits.reduce((s, c) => s + Number(c.amount || 0), 0);
    if ($w('#textcurrentcredit')) $w('#textcurrentcredit').text = `Current Credit Balance: ${totalCredit}`;
    const plansRes = await getCreditPlans();
    const plans = Array.isArray(plansRes) ? plansRes : [];
    $w('#repeatertopup').data = plans;
    if (!topupRepeaterBound) {
        topupRepeaterBound = true;
        $w('#repeatertopup').onItemReady(($item, plan) => {
            $item('#textamount').text = `${clientCurrency} ${plan.sellingprice}`;
            $item('#textcreditamount').text = String(plan.credit || 0);
            $item('#textcredit').text = 'Credits';
            $item('#boxcolor').hide();
            $item('#containertopup').onClick(() => {
                selectedTopupPlanId = plan._id || plan.id;
                selectedTopupPlanCache = plan;
                $w('#repeatertopup').forEachItem(($i) => $i('#boxcolor').hide());
                $item('#boxcolor').show();
            });
        });
    }
    if (!topupCheckoutBound) {
        topupCheckoutBound = true;
        $w('#buttoncheckout').onClick(async () => {
            if (!selectedTopupPlanCache) return;
            const amount = Number(selectedTopupPlanCache.sellingprice || 0);
            if (amount > 1000) {
                setupTopupProblemBox(amount);
                if ($w('#boxproblem2')) $w('#boxproblem2').show();
                try {
                    await submitTicket({
                        mode: 'topup_manual',
                        description: `[topup_manual] Client requested topup above 1000. Amount: ${clientCurrency} ${amount}. Please send invoice and update credit manually.`,
                        clientId: currentClientId || undefined
                    });
                } catch (e) {
                    console.warn('[companysetting] submitTicket topup_manual failed', e);
                }
                return;
            }
            const btn = $w('#buttoncheckout');
            btn.label = 'Loading...';
            btn.disable();
            try {
                const res = await startNormalTopup({ creditPlanId: selectedTopupPlanId, returnUrl: wixLocation.url });
                if (res?.url) wixLocation.to(res.url);
                else throw new Error('NO_PAYMENT_URL');
            } catch (e) {
                console.error('[TOPUP]', e);
                btn.label = 'Checkout';
                btn.enable();
            }
        });
    }
    if ($w('#buttontopupclose')) {
        $w('#buttontopupclose').onClick(() => {
            if (accessCtx?.credit?.ok === false) return;
            safeCollapse($w('#sectiontopup'));
            switchSectionAsync(lastSectionBeforeTopup || 'profile');
        });
    }
    if ($w('#buttoncloseproblem2')) {
        $w('#buttoncloseproblem2').onClick(() => { if ($w('#boxproblem2')) $w('#boxproblem2').hide(); });
    }
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

We will manually update your credit within 48 hours.
`;
    if ($w('#textproblem')) $w('#textproblem').text = text.trim();
}

const ACCOUNTING_BUTTON_LABELS = {
    xero: 'Connecting Xero',
    bukku: 'Connecting Bukku',
    sql: 'Connecting SQL',
    autocount: 'Connecting AutoCount'
};
const ACCOUNTING_CONNECT_LABEL = 'Accounting Connect';

/** If page loaded with ?code= & ?state= (Stripe Connect OAuth callback for MY), exchange code and refresh, then clean URL. Optional capturedQuery/capturedUrl 使用脚本加载时的快照，避免 URL 已被清掉。 */
async function handleStripeConnectOAuthCallbackIfNeeded(capturedQuery, capturedUrl) {
    try {
        const q = (capturedQuery && typeof capturedQuery === 'object') ? capturedQuery : ((typeof wixLocation !== 'undefined' && wixLocation.query) ? wixLocation.query : {});
        const code = typeof q === 'object' && q && q.code;
        const state = typeof q === 'object' && q && q.state;
        if (!code || !state) return;
        const fullUrl = (capturedUrl && String(capturedUrl)) ? String(capturedUrl) : ((typeof wixLocation !== 'undefined' && wixLocation.url) ? wixLocation.url : '');
        const redirectUri = fullUrl.indexOf('?') >= 0 ? fullUrl.slice(0, fullUrl.indexOf('?')) : fullUrl;
        console.log('[Company Setting] Stripe OAuth callback: code+state present', { state: state ? String(state).substring(0, 8) + '...' : state, codeLen: code ? String(code).length : 0, redirectUri: redirectUri ? redirectUri.substring(0, 50) + '...' : '' });
        if (!redirectUri) {
            console.warn('[Company Setting] Stripe OAuth callback: redirectUri empty, abort');
            return;
        }
        console.log('[Company Setting] Stripe OAuth: calling stripeConnectOAuthComplete...');
        const result = await stripeConnectOAuthComplete({ code, state });
        console.log('[Company Setting] Stripe OAuth complete result', result ? { ok: result.ok, reason: result.reason, accountId: result.accountId } : result);
        if (result && result.ok) {
            await refreshOnboardButtonLabels();
            if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
            setOnboardError('');
        } else if (result && result.reason) {
            setOnboardError(result.reason);
        }
        console.log('[Company Setting] Stripe OAuth: redirecting to clean URL', redirectUri);
        wixLocation.to(redirectUri);
    } catch (e) {
        console.error('[STRIPE CONNECT OAUTH CALLBACK]', e);
        try {
            const fullUrl = (typeof wixLocation !== 'undefined' && wixLocation.url) ? wixLocation.url : '';
            const redirectUri = fullUrl.indexOf('?') >= 0 ? fullUrl.slice(0, fullUrl.indexOf('?')) : fullUrl;
            if (redirectUri) wixLocation.to(redirectUri);
        } catch (_) {}
    }
}

/** If page loaded with ?code= (Xero OAuth callback), exchange code and refresh labels, then clean URL. */
async function handleXeroCallbackIfNeeded() {
    try {
        const q = (typeof wixLocation !== 'undefined' && wixLocation.query) ? wixLocation.query : {};
        const code = typeof q === 'object' && q && q.code;
        const state = typeof q === 'object' && q && q.state;
        if (!code) return;
        if (state) return; // Stripe OAuth uses code+state; Xero uses code only
        const fullUrl = (typeof wixLocation !== 'undefined' && wixLocation.url) ? wixLocation.url : '';
        const redirectUri = fullUrl.indexOf('?') >= 0 ? fullUrl.slice(0, fullUrl.indexOf('?')) : fullUrl;
        if (!redirectUri) return;
        await xeroConnect({ code, redirectUri });
        await refreshOnboardButtonLabels();
        if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
        wixLocation.to(redirectUri);
    } catch (e) {
        console.error('[XERO CALLBACK]', e);
    }
}

async function refreshOnboardButtonLabels() {
    try {
        const res = await getOnboardStatus();
        if (!res.ok) {
            const msg = res.reason === 'NO_PERMISSION' ? "You don't have permission" : (res.reason === 'CLIENT_INACTIVE' ? "You don't have account yet" : (res.reason || ''));
            setOnboardError(msg || '无法加载集成状态');
            return;
        }
        setOnboardError('');
        onboardStatus = {
            stripeConnected: !!res.stripeConnected,
            cnyiotConnected: !!res.cnyiotConnected,
            cnyiotDisconnectedWithMode: res.cnyiotDisconnectedWithMode || null,
            accountingConnected: !!res.accountingConnected,
            accountingProvider: res.accountingProvider || accessCtx?.capability?.accountProvider || null,
            accountingEinvoice: !!res.accountingEinvoice,
            ttlockConnected: !!res.ttlockConnected,
            ttlockCreateEverUsed: !!res.ttlockCreateEverUsed,
            ttlockDisconnectedWithMode: res.ttlockDisconnectedWithMode || null
        };
        if ($w('#buttonstripeonboard')) {
            $w('#buttonstripeonboard').label = onboardStatus.stripeConnected ? 'Disconnect Stripe' : 'Connect Stripe';
            setStripeButtonConnectedStyle(!!onboardStatus.stripeConnected);
        }
        if ($w('#buttoncnyiotonboard')) {
            $w('#buttoncnyiotonboard').label = onboardStatus.cnyiotConnected ? 'Meter Edit' : 'Connecting Meter';
            setCnyiotButtonConnectedStyle(!!onboardStatus.cnyiotConnected);
            $w('#buttoncnyiotonboard').disable();
        }
        if ($w('#buttonaccountonboard')) {
            const p = onboardStatus.accountingProvider;
            $w('#buttonaccountonboard').label = p && ACCOUNTING_BUTTON_LABELS[p]
                ? ACCOUNTING_BUTTON_LABELS[p]
                : ACCOUNTING_CONNECT_LABEL;
            setAccountButtonDisconnectStyle(false);
            setAccountButtonConnectedStyle(!!onboardStatus.accountingConnected);
        }
        if ($w('#buttonttlockonboard')) {
            $w('#buttonttlockonboard').label = onboardStatus.ttlockConnected ? 'Smart Door Edit' : 'Connect Smartdoor';
            setTtlockButtonConnectedStyle(!!onboardStatus.ttlockConnected);
        }
        if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
    } catch (e) {
        console.error('[ONBOARD STATUS]', e);
    }
}

async function openOnboardBoxEdit(type, title) {
    onboardEditMode = true;
    onboardDisconnectMode = false;
    onboardSubmitConfirmPending = false;
    currentOnboardType = type;
    if ($w('#textonboardtitle')) $w('#textonboardtitle').text = title;
    if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
    if ($w('#buttonsubmitonboard')) $w('#buttonsubmitonboard').label = 'Update';
    $w('#inputuseronboard').value = '';
    $w('#inputpasswordonboard').value = '';
    if ($w('#inputbookidonboard')) $w('#inputbookidonboard').value = '';
    if ($w('#inputuseronboard')?.enable) $w('#inputuseronboard').enable();
    if ($w('#inputpasswordonboard')?.enable) $w('#inputpasswordonboard').enable();
    if (type === 'bukku') {
        if ($w('#inputuseronboard')) { $w('#inputuseronboard').label = 'Token'; if ($w('#inputuseronboard').expand) $w('#inputuseronboard').expand(); if ($w('#inputuseronboard').show) $w('#inputuseronboard').show(); }
        if ($w('#inputpasswordonboard')) { $w('#inputpasswordonboard').label = 'Subdomain'; if ($w('#inputpasswordonboard').expand) $w('#inputpasswordonboard').expand(); if ($w('#inputpasswordonboard').show) $w('#inputpasswordonboard').show(); }
        if ($w('#inputbookidonboard')?.collapse) $w('#inputbookidonboard').collapse();
        if ($w('#inputbookidonboard')?.hide) $w('#inputbookidonboard').hide();
        if ($w('#checkboxeinvoiceonboard')) { $w('#checkboxeinvoiceonboard').checked = onboardStatus.accountingEinvoice ?? false; if ($w('#checkboxeinvoiceonboard').expand) $w('#checkboxeinvoiceonboard').expand(); if ($w('#checkboxeinvoiceonboard').show) $w('#checkboxeinvoiceonboard').show(); }
        if (typeof getBukkuCredentials === 'function') {
            try {
                const res = await getBukkuCredentials();
                if (res && res.ok !== false) { $w('#inputuseronboard').value = res.token ?? ''; $w('#inputpasswordonboard').value = res.subdomain ?? ''; }
            } catch (e) { console.error('[BUKKU CREDENTIALS]', e); }
        }
    } else if (type === 'xero') {
        if ($w('#inputuseronboard')?.collapse) $w('#inputuseronboard').collapse();
        if ($w('#inputpasswordonboard')?.collapse) $w('#inputpasswordonboard').collapse();
        if ($w('#inputbookidonboard')?.collapse) $w('#inputbookidonboard').collapse();
        if ($w('#inputbookidonboard')?.hide) $w('#inputbookidonboard').hide();
        if ($w('#checkboxeinvoiceonboard')) { $w('#checkboxeinvoiceonboard').checked = onboardStatus.accountingEinvoice ?? false; if ($w('#checkboxeinvoiceonboard').expand) $w('#checkboxeinvoiceonboard').expand(); if ($w('#checkboxeinvoiceonboard').show) $w('#checkboxeinvoiceonboard').show(); }
    } else if (type === 'autocount') {
        if ($w('#inputuseronboard')) { if ($w('#inputuseronboard').expand) $w('#inputuseronboard').expand(); if ($w('#inputuseronboard').show) $w('#inputuseronboard').show(); $w('#inputuseronboard').label = 'API Key'; }
        if ($w('#inputpasswordonboard')) { if ($w('#inputpasswordonboard').expand) $w('#inputpasswordonboard').expand(); if ($w('#inputpasswordonboard').show) $w('#inputpasswordonboard').show(); $w('#inputpasswordonboard').label = 'Key ID'; }
        if ($w('#inputbookidonboard')) { if ($w('#inputbookidonboard').expand) $w('#inputbookidonboard').expand(); if ($w('#inputbookidonboard').show) $w('#inputbookidonboard').show(); $w('#inputbookidonboard').label = 'Account Book ID'; $w('#inputbookidonboard').value = ''; }
        if ($w('#checkboxeinvoiceonboard')) { $w('#checkboxeinvoiceonboard').checked = onboardStatus.accountingEinvoice ?? false; if ($w('#checkboxeinvoiceonboard').expand) $w('#checkboxeinvoiceonboard').expand(); if ($w('#checkboxeinvoiceonboard').show) $w('#checkboxeinvoiceonboard').show(); }
        if (typeof getAutoCountCredentials === 'function') {
            try {
                const res = await getAutoCountCredentials();
                if (res && res.ok !== false) { $w('#inputuseronboard').value = res.apiKey ?? ''; $w('#inputpasswordonboard').value = res.keyId ?? ''; if ($w('#inputbookidonboard')) $w('#inputbookidonboard').value = res.accountBookId ?? ''; }
            } catch (e) { console.error('[AUTOCOUNT CREDENTIALS]', e); }
        }
    } else if (type === 'sql') {
        if ($w('#inputuseronboard')) { $w('#inputuseronboard').label = 'Access Key'; if ($w('#inputuseronboard').expand) $w('#inputuseronboard').expand(); if ($w('#inputuseronboard').show) $w('#inputuseronboard').show(); }
        if ($w('#inputpasswordonboard')) { $w('#inputpasswordonboard').label = 'Secret Key'; if ($w('#inputpasswordonboard').expand) $w('#inputpasswordonboard').expand(); if ($w('#inputpasswordonboard').show) $w('#inputpasswordonboard').show(); }
        if ($w('#inputbookidonboard')) { $w('#inputbookidonboard').label = 'Base URL (optional, collapse to use default)'; if ($w('#inputbookidonboard').collapse) $w('#inputbookidonboard').collapse(); if ($w('#inputbookidonboard').show) $w('#inputbookidonboard').show(); $w('#inputbookidonboard').value = ''; }
        if ($w('#checkboxeinvoiceonboard')) { $w('#checkboxeinvoiceonboard').checked = onboardStatus.accountingEinvoice ?? false; if ($w('#checkboxeinvoiceonboard').expand) $w('#checkboxeinvoiceonboard').expand(); if ($w('#checkboxeinvoiceonboard').show) $w('#checkboxeinvoiceonboard').show(); }
        if ($w('#buttonsubmitonboard')) { $w('#buttonsubmitonboard').enable(); $w('#buttonsubmitonboard').label = 'Update'; }
        if (typeof getSqlAccountCredentials === 'function') {
            try {
                const res = await getSqlAccountCredentials();
                if (res && res.ok !== false) { $w('#inputuseronboard').value = res.accessKey ?? ''; $w('#inputpasswordonboard').value = res.secretKey ?? ''; if ($w('#inputbookidonboard')) $w('#inputbookidonboard').value = res.baseUrl ?? ''; }
            } catch (e) { console.error('[SQL CREDENTIALS]', e); }
        }
    } else {
        if ($w('#inputuseronboard')?.expand) $w('#inputuseronboard').expand();
        if ($w('#inputpasswordonboard')?.expand) $w('#inputpasswordonboard').expand();
        if ($w('#inputuseronboard')) $w('#inputuseronboard').label = 'Username';
        if ($w('#inputpasswordonboard')) $w('#inputpasswordonboard').label = 'Password';
        if ($w('#inputbookidonboard')?.collapse) $w('#inputbookidonboard').collapse();
        if ($w('#inputbookidonboard')?.hide) $w('#inputbookidonboard').hide();
        if ($w('#checkboxeinvoiceonboard')?.hide) $w('#checkboxeinvoiceonboard').hide();
        if (type === 'cnyiot' && typeof getCnyiotCredentials === 'function') {
            try {
                const res = await getCnyiotCredentials();
                if (res && res.ok !== false) {
                    $w('#inputuseronboard').value = res.username ?? '';
                    const pwd = (res.password != null && String(res.password).trim() !== '') ? res.password : '0123456789';
                    $w('#inputpasswordonboard').value = pwd;
                }
            } catch (e) { console.error('[CNYIOT CREDENTIALS]', e); }
        }
        if (type === 'ttlock' && typeof getTtlockCredentials === 'function') {
            try {
                const res = await getTtlockCredentials();
                if (res && res.ok !== false) { $w('#inputuseronboard').value = res.username ?? ''; $w('#inputpasswordonboard').value = res.password ?? ''; }
            } catch (e) { console.error('[TTLOCK CREDENTIALS]', e); }
        }
        if (type === 'ttlock' && onboardStatus.ttlockConnected) {
            if ($w('#inputuseronboard')?.show) $w('#inputuseronboard').show();
            if ($w('#inputpasswordonboard')?.show) $w('#inputpasswordonboard').show();
            if ($w('#inputuseronboard')?.expand) $w('#inputuseronboard').expand();
            if ($w('#inputpasswordonboard')?.expand) $w('#inputpasswordonboard').expand();
            if ($w('#inputuseronboard')?.disable) $w('#inputuseronboard').disable();
            if ($w('#inputpasswordonboard')?.disable) $w('#inputpasswordonboard').disable();
            if ($w('#buttonsubmitonboard')) $w('#buttonsubmitonboard').label = 'Disconnect';
        }
        if (type === 'cnyiot' && onboardStatus.cnyiotConnected) {
            if ($w('#inputuseronboard')?.show) $w('#inputuseronboard').show();
            if ($w('#inputpasswordonboard')?.show) $w('#inputpasswordonboard').show();
            if ($w('#inputuseronboard')?.expand) $w('#inputuseronboard').expand();
            if ($w('#inputpasswordonboard')?.expand) $w('#inputpasswordonboard').expand();
            if ($w('#inputuseronboard')?.disable) $w('#inputuseronboard').disable();
            if ($w('#inputpasswordonboard')?.disable) $w('#inputpasswordonboard').disable();
            if ($w('#buttonsubmitonboard')) {
                $w('#buttonsubmitonboard').label = 'Disconnect';
                $w('#buttonsubmitonboard').disable();
            }
        }
    }
    $w('#boxonboard').show();
}

function openOnboardBoxDisconnect(provider, bukkuCreds, autocountCreds) {
    onboardEditMode = false;
    onboardDisconnectMode = true;
    onboardSubmitConfirmPending = false;
    currentOnboardType = provider;
    if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
    const textTitle = $w('#textonboardtitle');
    const inputUser = $w('#inputuseronboard');
    const inputPass = $w('#inputpasswordonboard');
    const inputBook = $w('#inputbookidonboard');
    const checkboxInv = $w('#checkboxeinvoiceonboard');
    const btnSubmit = $w('#buttonsubmitonboard');
    if (provider === 'bukku') {
        if (textTitle) textTitle.text = 'Disconnect with Bukku';
        if (inputUser) { inputUser.label = 'Token'; if (inputUser.expand) inputUser.expand(); if (inputUser.show) inputUser.show(); }
        if (inputPass) { inputPass.label = 'Subdomain'; if (inputPass.expand) inputPass.expand(); if (inputPass.show) inputPass.show(); }
        if (inputUser) inputUser.value = bukkuCreds?.token ?? '';
        if (inputPass) inputPass.value = bukkuCreds?.subdomain ?? '';
        if (inputBook?.collapse) inputBook.collapse();
        if (inputBook?.hide) inputBook.hide();
        if (checkboxInv) { checkboxInv.checked = onboardStatus.accountingEinvoice ?? false; if (checkboxInv.expand) checkboxInv.expand(); if (checkboxInv.show) checkboxInv.show(); }
        if (btnSubmit) btnSubmit.label = 'Disconnect';
    } else if (provider === 'autocount') {
        if (textTitle) textTitle.text = 'Disconnect with AutoCount';
        if (inputUser) { if (inputUser.expand) inputUser.expand(); if (inputUser.show) inputUser.show(); inputUser.label = 'API Key'; }
        if (inputPass) { if (inputPass.expand) inputPass.expand(); if (inputPass.show) inputPass.show(); inputPass.label = 'Key ID'; }
        if (inputBook) { if (inputBook.expand) inputBook.expand(); if (inputBook.show) inputBook.show(); inputBook.label = 'Account Book ID'; }
        if (inputUser) inputUser.value = autocountCreds?.apiKey ?? '';
        if (inputPass) inputPass.value = autocountCreds?.keyId ?? '';
        if (inputBook) inputBook.value = autocountCreds?.accountBookId ?? '';
        if (checkboxInv) { checkboxInv.checked = onboardStatus.accountingEinvoice ?? false; if (checkboxInv.expand) checkboxInv.expand(); if (checkboxInv.show) checkboxInv.show(); }
        if (btnSubmit) btnSubmit.label = 'Disconnect';
    } else if (provider === 'sql') {
        if (textTitle) textTitle.text = 'Disconnect with SQL Account';
        if (inputUser) { inputUser.label = 'Access Key'; if (inputUser.expand) inputUser.expand(); if (inputUser.show) inputUser.show(); }
        if (inputPass) { inputPass.label = 'Secret Key'; if (inputPass.expand) inputPass.expand(); if (inputPass.show) inputPass.show(); }
        if (inputBook) { if (inputBook.collapse) inputBook.collapse(); if (inputBook.show) inputBook.show(); inputBook.label = 'Base URL (optional)'; inputBook.value = bukkuCreds?.baseUrl ?? ''; }
        if (inputUser) inputUser.value = bukkuCreds?.accessKey ?? '';
        if (inputPass) inputPass.value = bukkuCreds?.secretKey ?? '';
        if (checkboxInv) { checkboxInv.checked = onboardStatus.accountingEinvoice ?? false; if (checkboxInv.expand) checkboxInv.expand(); if (checkboxInv.show) checkboxInv.show(); }
        if (btnSubmit) btnSubmit.label = 'Disconnect';
    } else if (provider === 'ttlock') {
        if (textTitle) textTitle.text = 'Disconnect Smart Door';
        if (inputUser?.collapse) inputUser.collapse();
        if (inputPass?.collapse) inputPass.collapse();
        if (inputBook?.collapse) inputBook.collapse();
        if (inputBook?.hide) inputBook.hide();
        if (checkboxInv?.hide) checkboxInv.hide();
        if (btnSubmit) btnSubmit.label = 'Disconnect';
    } else {
        if (textTitle) textTitle.text = 'Disconnect with Xero';
        if (inputUser?.collapse) inputUser.collapse();
        if (inputPass?.collapse) inputPass.collapse();
        if (inputBook?.collapse) inputBook.collapse();
        if (inputBook?.hide) inputBook.hide();
        if (checkboxInv) { checkboxInv.checked = onboardStatus.accountingEinvoice ?? false; if (checkboxInv.expand) checkboxInv.expand(); if (checkboxInv.show) checkboxInv.show(); }
        if (btnSubmit) btnSubmit.label = 'Disconnect';
    }
    $w('#boxonboard').show();
}

function bindOnboardButtons() {
    if (onboardButtonsBound) return;
    onboardButtonsBound = true;

    $w('#buttonstripeonboard').onClick(async () => {
        console.log('[Company Setting] Connect Stripe clicked');
        const btn = $w('#buttonstripeonboard');
        const oldLabel = btn.label;
        btn.disable();
        btn.label = 'Loading...';
        if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
        try {
            if (onboardStatus.stripeConnected) {
                await stripeDisconnect();
                await refreshOnboardButtonLabels();
                setOnboardError('');
                if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                btn.enable();
                return;
            }
            // redirect_uri 必须与 Stripe Dashboard 配置完全一致（仅基 URL，无 query）
            const baseUrl = (typeof wixLocation !== 'undefined' && wixLocation.url) ? (wixLocation.url.indexOf('?') >= 0 ? wixLocation.url.slice(0, wixLocation.url.indexOf('?')) : wixLocation.url) : '';
            const returnUrl = baseUrl || wixLocation.url;
            const result = await getStripeConnectOnboardUrl({ returnUrl, refreshUrl: returnUrl });
            console.log('[Company Setting] Stripe connect result', result ? { ok: result.ok, reason: result.reason, url: result.url ? '(set)' : undefined, alreadyConnected: result.alreadyConnected } : result);
            if (result && result.ok === false) {
                let errMsg = result.reason || 'Request failed';
                if (result.reason === 'STRIPE_CONNECT_MY_LOSS_LIABLE_RESTRICTION') {
                    errMsg = 'Stripe Connect (MY)：当前 Stripe 马来西亚风控不允许「平台承担负余额」的 Connect。请在 Stripe Dashboard → Connect → Platform setup 确认 Negative balance liability 为「Stripe 承担」；若已为 Stripe 承担仍报错，需联系 Stripe Support 开通 MY Connect。';
                } else if (result.reason === 'STRIPE_CONNECT_PLATFORM_SETUP_REQUIRED' || errMsg.includes('dashboard.stripe.com') || errMsg.includes('platform-profile') || errMsg.includes('responsibilities')) {
                    errMsg = 'Stripe Connect: 请在 Stripe Dashboard 完成平台设置。';
                }
                if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                setOnboardError(errMsg);
                btn.label = oldLabel;
                btn.enable();
                return;
            }
            if (result && result.alreadyConnected) {
                setOnboardError('');
                if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                await refreshOnboardButtonLabels();
                btn.label = oldLabel;
                btn.enable();
                return;
            }
            if (result && result.url) wixLocation.to(result.url);
            else { btn.label = oldLabel; btn.enable(); }
        } catch (e) {
            console.error('[STRIPE ONBOARD]', e);
            let msg = (e && e.message) ? String(e.message) : 'Request failed';
            if (/abort|timeout|TIMEOUT/i.test(msg)) msg = '请求超时，请稍后重试或检查网络。';
            if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
            setOnboardError(msg);
            btn.label = oldLabel;
            btn.enable();
        }
    });

    $w('#buttoncnyiotonboard').onClick(async () => {
        if (onboardStatus.cnyiotConnected) {
            await openOnboardBoxEdit('cnyiot', 'Edit Meter');
            return;
        }
        currentOnboardType = 'cnyiot';
        onboardEditMode = false;
        if ($w('#textaccounttitle')) $w('#textaccounttitle').text = 'Connecting Meter';
        if ($w('#boxaccountselection')) {
            const afterDisconnectCnyiot = onboardStatus.cnyiotDisconnectedWithMode === 'create' || onboardStatus.cnyiotDisconnectedWithMode === 'existing';
            $w('#dropdownaccountonboard').options = afterDisconnectCnyiot
                ? [{ label: 'Connect to own account', value: 'create' }, { label: 'Connect to old account', value: 'connect' }]
                : [{ label: 'Create New Account', value: 'create' }, { label: 'Connect Existing Account', value: 'connect' }];
            $w('#dropdownaccountonboard').value = null;
            $w('#buttonsubmitaccountselection').label = 'Connect';
            $w('#boxaccountselection').show();
        }
    });

    $w('#buttonaccountonboard').onClick(async () => {
        if (onboardStatus.accountingConnected) {
            const provider = onboardStatus.accountingProvider || 'bukku';
            if (provider === 'bukku') {
                let creds = { token: '', subdomain: '' };
                if (typeof getBukkuCredentials === 'function') {
                    try {
                        const res = await getBukkuCredentials();
                        creds = { token: res.token ?? '', subdomain: res.subdomain ?? '' };
                    } catch (e) {
                        console.error('[BUKKU CREDENTIALS]', e);
                    }
                }
                openOnboardBoxDisconnect('bukku', creds, null);
                return;
            }
            if (provider === 'xero') {
                openOnboardBoxDisconnect('xero', null, null);
                return;
            }
            if (provider === 'autocount') {
                let creds = { apiKey: '', keyId: '', accountBookId: '' };
                if (typeof getAutoCountCredentials === 'function') {
                    try {
                        const res = await getAutoCountCredentials();
                        creds = { apiKey: res.apiKey ?? '', keyId: res.keyId ?? '', accountBookId: res.accountBookId ?? '' };
                    } catch (e) {
                        console.error('[AUTOCOUNT CREDENTIALS]', e);
                    }
                }
                openOnboardBoxDisconnect('autocount', null, creds);
                return;
            }
            if (provider === 'sql') {
                let creds = { accessKey: '', secretKey: '' };
                if (typeof getSqlAccountCredentials === 'function') {
                    try {
                        const res = await getSqlAccountCredentials();
                        creds = { accessKey: res.accessKey ?? '', secretKey: res.secretKey ?? '', baseUrl: res.baseUrl ?? '' };
                    } catch (e) {
                        console.error('[SQL CREDENTIALS]', e);
                    }
                }
                openOnboardBoxDisconnect('sql', creds, null);
                return;
            }
            const editTitles = { sql: 'Accounting Edit (SQL)', autocount: 'Accounting Edit (AutoCount)' };
            await openOnboardBoxEdit(provider, editTitles[provider] || 'Accounting Edit');
            return;
        }
        currentOnboardType = 'accountSystem';
        onboardEditMode = false;
        if ($w('#textaccounttitle')) $w('#textaccounttitle').text = 'Connect accounting';
        if ($w('#boxaccountselection')) {
            const addon = integrationTemplateCache && integrationTemplateCache.find(i => i.key === 'addonAccount');
            const providerField = addon && addon.fields && addon.fields.find(f => f.key === 'provider' && f.type === 'dropdown');
            const options = (providerField && Array.isArray(providerField.options) && providerField.options.length > 0)
                ? providerField.options
                : [
                    { label: 'Xero', value: 'xero' },
                    { label: 'Bukku', value: 'bukku' },
                    { label: 'SQL Account', value: 'sql' },
                    { label: 'AutoCount', value: 'autocount' }
                ];
            $w('#dropdownaccountonboard').options = options;
            $w('#dropdownaccountonboard').value = null;
            $w('#buttonsubmitaccountselection').label = 'Connect';
            $w('#boxaccountselection').show();
        }
    });

    $w('#buttonttlockonboard').onClick(async () => {
        if (onboardStatus.ttlockConnected) {
            await openOnboardBoxEdit('ttlock', 'Edit Smart Door');
            return;
        }
        currentOnboardType = 'ttlock';
        onboardEditMode = false;
        if ($w('#textaccounttitle')) $w('#textaccounttitle').text = 'Connect Smartdoor';
        if ($w('#boxaccountselection')) {
            const afterDisconnectTt = onboardStatus.ttlockDisconnectedWithMode === 'create' || onboardStatus.ttlockDisconnectedWithMode === 'existing';
            $w('#dropdownaccountonboard').options = afterDisconnectTt
                ? [{ label: 'Connect Own Account', value: 'create' }, { label: 'Connect Old Account', value: 'connect' }]
                : [{ label: 'Create New Account', value: 'create' }, { label: 'Connect Existing Account', value: 'connect' }];
            $w('#dropdownaccountonboard').value = null;
            $w('#buttonsubmitaccountselection').label = 'Connect';
            $w('#boxaccountselection').show();
        }
    });

    if ($w('#buttoncloseonboard')) $w('#buttoncloseonboard').onClick(() => {
        onboardSubmitConfirmPending = false;
        onboardDisconnectMode = false;
        if ($w('#boxonboard')) $w('#boxonboard').hide();
    });

    if ($w('#checkboxeinvoiceonboard') && typeof updateAccountingEinvoice === 'function') {
        $w('#checkboxeinvoiceonboard').onChange(async () => {
            const provider = currentOnboardType;
            if (provider && ['bukku', 'xero', 'autocount', 'sql'].includes(provider)) {
                try {
                    await updateAccountingEinvoice({ provider, einvoice: $w('#checkboxeinvoiceonboard').checked });
                    if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                } catch (e) {
                    console.error('[checkboxeinvoiceonboard]', e);
                }
            }
        });
    }

    if (!accountSelectionBound && $w('#buttonsubmitaccountselection')) {
        accountSelectionBound = true;
        $w('#buttoncloseaccountselection').onClick(() => { if ($w('#boxaccountselection')) $w('#boxaccountselection').hide(); });
        $w('#buttonsubmitaccountselection').onClick(async () => {
            const dropdown = $w('#dropdownaccountonboard');
            const action = dropdown.value;
            if (!action || !currentOnboardType) return;
            const btn = $w('#buttonsubmitaccountselection');
            const oldLabel = btn.label;
            btn.disable();
            btn.label = 'Loading...';
            try {
                if (currentOnboardType === 'accountSystem') {
                    const provider = action;
                    if (provider === 'xero') {
                        let redirectUri = (typeof wixLocation !== 'undefined' && wixLocation.url) ? wixLocation.url : '';
                        // Normalise to canonical host so it matches Xero app Redirect URI (e.g. always www)
                        if (redirectUri && redirectUri.includes('colivingjb.com/company-setting') && !redirectUri.startsWith('https://www.')) {
                            redirectUri = 'https://www.colivingjb.com/company-setting';
                        }
                        const result = await getXeroAuthUrl({ redirectUri });
                        if (result && result.url) {
                            $w('#boxaccountselection').hide();
                            wixLocation.to(result.url);
                            return;
                        }
                        setOnboardError(result && result.reason ? result.reason : 'Could not get Xero login URL');
                        btn.label = oldLabel;
                        btn.enable();
                        return;
                    }
                    $w('#boxaccountselection').hide();
                    onboardEditMode = false;
                    onboardSubmitConfirmPending = false;
                    if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                    const opts = $w('#dropdownaccountonboard').options;
                    const titleMap = (opts && opts.length) ? opts.reduce((m, o) => { m[o.value] = 'Connect ' + (o.label || o.value); return m; }, {}) : { bukku: 'Connect Bukku', xero: 'Connect Xero', sql: 'Connect SQL Account', autocount: 'Connect Autocount' };
                    if ($w('#textonboardtitle')) $w('#textonboardtitle').text = titleMap[provider] || 'Connect';
                    $w('#boxonboard').show();
                    if (provider === 'bukku') {
                        if ($w('#inputuseronboard')) { $w('#inputuseronboard').label = 'Token'; if ($w('#inputuseronboard').expand) $w('#inputuseronboard').expand(); if ($w('#inputuseronboard').show) $w('#inputuseronboard').show(); }
                        if ($w('#inputpasswordonboard')) { $w('#inputpasswordonboard').label = 'Subdomain'; if ($w('#inputpasswordonboard').expand) $w('#inputpasswordonboard').expand(); if ($w('#inputpasswordonboard').show) $w('#inputpasswordonboard').show(); }
                        if ($w('#inputbookidonboard')?.collapse) $w('#inputbookidonboard').collapse();
                        if ($w('#inputbookidonboard')?.hide) $w('#inputbookidonboard').hide();
                        if ($w('#checkboxeinvoiceonboard')) { if ($w('#checkboxeinvoiceonboard').expand) $w('#checkboxeinvoiceonboard').expand(); if ($w('#checkboxeinvoiceonboard').show) $w('#checkboxeinvoiceonboard').show(); }
                    } else if (provider === 'autocount') {
                        if ($w('#inputuseronboard')) { if ($w('#inputuseronboard').expand) $w('#inputuseronboard').expand(); if ($w('#inputuseronboard').show) $w('#inputuseronboard').show(); $w('#inputuseronboard').label = 'API Key'; }
                        if ($w('#inputpasswordonboard')) { if ($w('#inputpasswordonboard').expand) $w('#inputpasswordonboard').expand(); if ($w('#inputpasswordonboard').show) $w('#inputpasswordonboard').show(); $w('#inputpasswordonboard').label = 'Key ID'; }
                        if ($w('#inputbookidonboard')) { if ($w('#inputbookidonboard').expand) $w('#inputbookidonboard').expand(); if ($w('#inputbookidonboard').show) $w('#inputbookidonboard').show(); $w('#inputbookidonboard').label = 'Account Book ID'; $w('#inputbookidonboard').value = ''; }
                        if ($w('#checkboxeinvoiceonboard')) { if ($w('#checkboxeinvoiceonboard').expand) $w('#checkboxeinvoiceonboard').expand(); if ($w('#checkboxeinvoiceonboard').show) $w('#checkboxeinvoiceonboard').show(); }
                    } else if (provider === 'sql') {
                        if ($w('#inputuseronboard')) { $w('#inputuseronboard').label = 'Access Key'; if ($w('#inputuseronboard').expand) $w('#inputuseronboard').expand(); if ($w('#inputuseronboard').show) $w('#inputuseronboard').show(); }
                        if ($w('#inputpasswordonboard')) { $w('#inputpasswordonboard').label = 'Secret Key'; if ($w('#inputpasswordonboard').expand) $w('#inputpasswordonboard').expand(); if ($w('#inputpasswordonboard').show) $w('#inputpasswordonboard').show(); }
                        if ($w('#inputbookidonboard')) { $w('#inputbookidonboard').label = 'Base URL (optional, expand to set custom)'; if ($w('#inputbookidonboard').collapse) $w('#inputbookidonboard').collapse(); if ($w('#inputbookidonboard').show) $w('#inputbookidonboard').show(); $w('#inputbookidonboard').value = ''; }
                        if ($w('#checkboxeinvoiceonboard')) { if ($w('#checkboxeinvoiceonboard').expand) $w('#checkboxeinvoiceonboard').expand(); if ($w('#checkboxeinvoiceonboard').show) $w('#checkboxeinvoiceonboard').show(); }
                        if ($w('#buttonsubmitonboard')) { $w('#buttonsubmitonboard').enable(); $w('#buttonsubmitonboard').label = 'Connect SQL Account'; }
                    } else if (provider === 'xero') {
                        if ($w('#inputuseronboard')?.collapse) $w('#inputuseronboard').collapse();
                        if ($w('#inputpasswordonboard')?.collapse) $w('#inputpasswordonboard').collapse();
                        if ($w('#inputbookidonboard')?.collapse) $w('#inputbookidonboard').collapse();
                        if ($w('#inputbookidonboard')?.hide) $w('#inputbookidonboard').hide();
                        if ($w('#checkboxeinvoiceonboard')) { if ($w('#checkboxeinvoiceonboard').expand) $w('#checkboxeinvoiceonboard').expand(); if ($w('#checkboxeinvoiceonboard').show) $w('#checkboxeinvoiceonboard').show(); }
                    } else {
                        if ($w('#inputuseronboard')) $w('#inputuseronboard').label = 'Username';
                        if ($w('#inputpasswordonboard')) $w('#inputpasswordonboard').label = 'Password';
                        if ($w('#inputbookidonboard')?.collapse) $w('#inputbookidonboard').collapse();
                        if ($w('#inputbookidonboard')?.hide) $w('#inputbookidonboard').hide();
                        if ($w('#checkboxeinvoiceonboard')?.hide) $w('#checkboxeinvoiceonboard').hide();
                    }
                    $w('#inputuseronboard').value = '';
                    $w('#inputpasswordonboard').value = '';
                    if ($w('#inputbookidonboard') && provider !== 'autocount' && provider !== 'sql') $w('#inputbookidonboard').value = '';
                    currentOnboardType = provider;
                    if (provider === 'bukku' && typeof getBukkuCredentials === 'function') {
                        try {
                            const res = await getBukkuCredentials();
                            if (res && res.ok !== false) { $w('#inputuseronboard').value = res.token ?? ''; $w('#inputpasswordonboard').value = res.subdomain ?? ''; }
                        } catch (e) { console.error('[BUKKU CREDENTIALS]', e); }
                    } else if (provider === 'autocount' && typeof getAutoCountCredentials === 'function') {
                        try {
                            const res = await getAutoCountCredentials();
                            if (res && res.ok !== false) { $w('#inputuseronboard').value = res.apiKey ?? ''; $w('#inputpasswordonboard').value = res.keyId ?? ''; if ($w('#inputbookidonboard')) $w('#inputbookidonboard').value = res.accountBookId ?? ''; }
                        } catch (e) { console.error('[AUTOCOUNT CREDENTIALS]', e); }
                    } else if (provider === 'sql' && typeof getSqlAccountCredentials === 'function') {
                        try {
                            const res = await getSqlAccountCredentials();
                            if (res && res.ok !== false) { $w('#inputuseronboard').value = res.accessKey ?? ''; $w('#inputpasswordonboard').value = res.secretKey ?? ''; if ($w('#inputbookidonboard')) $w('#inputbookidonboard').value = res.baseUrl ?? ''; }
                        } catch (e) { console.error('[SQL CREDENTIALS]', e); }
                    }
                    if ($w('#buttonsubmitonboard')) $w('#buttonsubmitonboard').label = (provider === 'sql' ? 'Connect SQL Account' : 'Connect');
                    btn.label = oldLabel;
                    btn.enable();
                    return;
                }
                if (action === 'connect') {
                    if (currentOnboardType === 'ttlock') {
                        btn.label = 'Connecting...';
                        btn.disable();
                        try {
                            const credsRes = typeof getTtlockCredentials === 'function' ? await getTtlockCredentials() : { ok: false };
                            const username = (credsRes && credsRes.ok !== false && credsRes.username) ? credsRes.username : '';
                            const password = (credsRes && credsRes.ok !== false && credsRes.password) ? credsRes.password : '';
                            if (!username || !password) {
                                if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                                btn.label = oldLabel;
                                btn.enable();
                                return;
                            }
                            const res = await ttlockConnect({ mode: 'existing', username, password });
                            if (res && res.ok === false) {
                                const msg = res.reason || 'Request failed';
                                let show = msg;
                                if (msg === 'USERNAME_AND_PASSWORD_REQUIRED') show = '请填写 Username 与 Password。';
                                else if (msg === 'TTLOCK_APP_CREDENTIALS_MISSING') show = '服务端未配置 TTLock 应用，请联系管理员。';
                                if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                                setOnboardError(show);
                                btn.label = oldLabel;
                                btn.enable();
                                return;
                            }
                            await refreshOnboardButtonLabels();
                            if ($w('#buttonttlockonboard')) {
                                $w('#buttonttlockonboard').label = 'Smart Door Edit';
                                setTtlockButtonConnectedStyle(true);
                            }
                            if ($w('#boxaccountselection')) $w('#boxaccountselection').hide();
                            if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                        } catch (e) {
                            console.error('[TTLOCK CONNECT OLD]', e);
                            const msg = (e && e.message) ? String(e.message) : 'Request failed';
                            if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                            setOnboardError(msg);
                        }
                        btn.label = oldLabel;
                        btn.enable();
                        return;
                    }
                    if (currentOnboardType === 'cnyiot') {
                        btn.label = 'Connecting...';
                        btn.disable();
                        try {
                            const credsRes = typeof getCnyiotCredentials === 'function' ? await getCnyiotCredentials() : { ok: false };
                            let username = (credsRes && credsRes.ok !== false && credsRes.username) ? credsRes.username : '';
                            let password = (credsRes && credsRes.ok !== false && credsRes.password) ? credsRes.password : '';
                            if (!password && username) password = '0123456789';
                            if (!username || !password) {
                                $w('#boxaccountselection').hide();
                                if ($w('#textonboardtitle')) $w('#textonboardtitle').text = 'Connect CNYIOT (Existing)';
                                if ($w('#inputuseronboard')) $w('#inputuseronboard').label = 'Username';
                                if ($w('#inputpasswordonboard')) $w('#inputpasswordonboard').label = 'Password';
                                $w('#inputuseronboard').value = '';
                                $w('#inputpasswordonboard').value = '';
                                if (typeof getCnyiotCredentials === 'function') {
                                    try {
                                        const res = await getCnyiotCredentials();
                                        if (res && res.ok !== false) { $w('#inputuseronboard').value = res.username ?? ''; $w('#inputpasswordonboard').value = (res.password && String(res.password).trim()) ? res.password : '0123456789'; }
                                    } catch (e) { console.error('[CNYIOT CREDENTIALS]', e); }
                                }
                                if ($w('#buttonsubmitonboard')) $w('#buttonsubmitonboard').label = 'Connect';
                                $w('#boxonboard').show();
                                btn.label = oldLabel;
                                btn.enable();
                                return;
                            }
                            const res = await cnyiotConnect({ mode: 'existing', username, password });
                            if (res && res.ok === false) {
                                const msg = res.reason || 'Request failed';
                                let show = msg;
                                if (msg === 'USERNAME_AND_PASSWORD_REQUIRED') show = '请填写 Username 与 Password。';
                                else if (msg === 'CNYIOT_PLATFORM_ACCOUNT_MISSING') show = '服务端未配置 Meter 母账号，请联系管理员。';
                                if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                                setOnboardError(show);
                                btn.label = oldLabel;
                                btn.enable();
                                return;
                            }
                            await refreshOnboardButtonLabels();
                            if ($w('#buttoncnyiotonboard')) {
                                $w('#buttoncnyiotonboard').label = 'Meter Edit';
                                setCnyiotButtonConnectedStyle(true);
                            }
                            if ($w('#boxaccountselection')) $w('#boxaccountselection').hide();
                            setOnboardError('');
                        } catch (e) {
                            console.error('[CNYIOT CONNECT OLD]', e);
                            const msg = (e && e.message) ? String(e.message) : 'Request failed';
                            if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                            setOnboardError(msg);
                        }
                        btn.label = oldLabel;
                        btn.enable();
                        return;
                    }
                    $w('#boxaccountselection').hide();
                    onboardEditMode = false;
                    onboardSubmitConfirmPending = false;
                    if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                    if ($w('#inputuseronboard')) $w('#inputuseronboard').label = 'Username';
                    if ($w('#inputpasswordonboard')) $w('#inputpasswordonboard').label = 'Password';
                    if ($w('#inputbookidonboard')?.collapse) $w('#inputbookidonboard').collapse();
                    if ($w('#inputbookidonboard')?.hide) $w('#inputbookidonboard').hide();
                    if ($w('#textonboardtitle')) $w('#textonboardtitle').text = currentOnboardType === 'cnyiot' ? 'Connect CNYIOT (Existing)' : 'Connect TTLock (Existing)';
                    $w('#inputuseronboard').value = '';
                    $w('#inputpasswordonboard').value = '';
                    if (currentOnboardType === 'cnyiot' && typeof getCnyiotCredentials === 'function') {
                        try {
                            const res = await getCnyiotCredentials();
                            if (res && res.ok !== false) { $w('#inputuseronboard').value = res.username ?? ''; $w('#inputpasswordonboard').value = res.password ?? ''; }
                        } catch (e) { console.error('[CNYIOT CREDENTIALS]', e); }
                    }
                    if (currentOnboardType === 'ttlock' && typeof getTtlockCredentials === 'function') {
                        try {
                            const res = await getTtlockCredentials();
                            if (res && res.ok !== false) { $w('#inputuseronboard').value = res.username ?? ''; $w('#inputpasswordonboard').value = res.password ?? ''; }
                        } catch (e) { console.error('[TTLOCK CREDENTIALS]', e); }
                    }
                    if ($w('#checkboxeinvoiceonboard')) $w('#checkboxeinvoiceonboard').hide();
                    if ($w('#buttonsubmitonboard')) $w('#buttonsubmitonboard').label = 'Connect';
                    $w('#boxonboard').show();
                    btn.label = oldLabel;
                    btn.enable();
                    return;
                }
                if (action === 'create') {
                    let res;
                    if (currentOnboardType === 'cnyiot') {
                        setOnboardError('');
                        try {
                            res = await cnyiotConnect({ mode: 'create' });
                        } catch (e) {
                            console.error('[ONBOARD CNYIOT] create', e);
                            throw e;
                        }
                    } else if (currentOnboardType === 'ttlock') {
                        res = await ttlockConnect({ mode: 'create' });
                    } else {
                        res = { ok: false, reason: 'INVALID_STATE' };
                    }
                    if (res && res.ok === false) {
                        const msg = res.reason || '';
                        let show = msg;
                        if (msg === 'CNYIOT_ACCOUNT_INVALID') {
                            show = '请先选择「已有账号」并输入 CNYIoT 账号与密码保存，再选择「创建子账号」。';
                        } else if (msg === 'CNYIOT_PLATFORM_ACCOUNT_MISSING') {
                            show = '服务端未配置母账号 (CNYIOT_LOGIN_NAME / CNYIOT_LOGIN_PSW)，请联系管理员。';
                        } else if (msg === 'CONTACT_REQUIRED') {
                            show = 'Please fill in contact number in profile setting';
                        } else if (msg === 'CLIENT_SUBDOMAIN_REQUIRED') {
                            show = 'Please fill in subdomain in profile setting';
                        } else if (msg === 'SUBDOMAIN_ALREADY_USED' || msg === 'CLIENT_ALREADY_USED_CREATE_ONCE') {
                            show = msg === 'CLIENT_ALREADY_USED_CREATE_ONCE' ? '该客户已创建过子账号，不可重复创建。' : 'Subdomain 已被使用，请换一个。';
                        } else if (msg === 'TTLOCK_APP_CREDENTIALS_MISSING') {
                            show = '服务端未配置 TTLock 应用 (TTLOCK_CLIENT_ID / TTLOCK_CLIENT_SECRET)，请联系管理员。';
                        } else if (msg === 'CNYIOT_PLATFORM_ACCOUNT_MISSING') {
                            show = '服务端未配置 Meter 母账号 (CNYIOT_LOGIN_NAME / CNYIOT_LOGIN_PSW)，请联系管理员。';
                        } else if (msg && msg.startsWith('CNYIOT_ADD_USER_FAILED_')) {
                            show = 'Meter 创建子账号失败 (CNYIOT ' + msg.replace('CNYIOT_ADD_USER_FAILED_', '') + ')，可能 subdomain 已被使用或请稍后重试。';
                        } else if (msg === 'CNYIOT_NETWORK_TIMEOUT' || /abort|timeout|TIMEOUT/i.test(msg)) {
                            show = '请求超时，请稍后重试或检查网络。';
                        }
                        const displayMsg = show || msg || 'Request failed.';
                        if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                        setOnboardError(displayMsg);
                    } else {
                        if ($w('#boxaccountselection')) $w('#boxaccountselection').hide();
                        if (currentOnboardType === 'cnyiot' && res && (res.station_index != null || res.cnyiot_subuser_id != null)) {
                            const sid = res.station_index ?? res.cnyiot_subuser_id;
                            console.log('[ONBOARD CNYIOT] create OK station_index=', sid, 'subdomain=', res.subdomain);
                            if ($w('#textonboardmessage')) {
                                $w('#textonboardmessage').text = 'Created. station_index=' + sid + ' (used for addMeter link2User).';
                                $w('#textonboardmessage').show();
                            }
                        }
                        await refreshOnboardButtonLabels();
                    }
                }
            } catch (e) {
                console.error('[ONBOARD]', e);
                const msg = (e && e.message) ? String(e.message) : '';
                let show = msg;
                if (msg === 'CNYIOT_ACCOUNT_INVALID') {
                    show = '请先选择「已有账号」并输入 CNYIoT 账号与密码保存，再选择「创建子账号」。';
                } else if (msg === 'CNYIOT_PLATFORM_ACCOUNT_MISSING') {
                    show = '服务端未配置母账号 (CNYIOT_LOGIN_NAME / CNYIOT_LOGIN_PSW)，请联系管理员。';
                } else if (msg === 'CONTACT_REQUIRED') {
                    show = 'Please fill in contact number in profile setting';
                } else if (msg === 'CLIENT_SUBDOMAIN_REQUIRED') {
                    show = 'Please fill in subdomain in profile setting';
                } else if (msg === 'SUBDOMAIN_ALREADY_USED' || msg === 'CLIENT_ALREADY_USED_CREATE_ONCE') {
                    show = msg === 'CLIENT_ALREADY_USED_CREATE_ONCE' ? '该客户已创建过子账号，不可重复创建。' : 'Subdomain 已被使用，请换一个。';
                } else if (msg === 'TTLOCK_APP_CREDENTIALS_MISSING') {
                    show = '服务端未配置 TTLock 应用 (TTLOCK_CLIENT_ID / TTLOCK_CLIENT_SECRET)，请联系管理员。';
                } else if (msg === 'CNYIOT_PLATFORM_ACCOUNT_MISSING') {
                    show = '服务端未配置 Meter 母账号 (CNYIOT_LOGIN_NAME / CNYIOT_LOGIN_PSW)，请联系管理员。';
                } else if (msg && msg.startsWith('CNYIOT_ADD_USER_FAILED_')) {
                    show = 'Meter 创建子账号失败 (CNYIOT ' + msg.replace('CNYIOT_ADD_USER_FAILED_', '') + ')，可能 subdomain 已被使用或请稍后重试。';
                } else if (msg === 'CNYIOT_NETWORK_TIMEOUT' || /abort|timeout|TIMEOUT/i.test(msg)) {
                    show = '请求超时，请稍后重试或检查网络。';
                }
                const displayMsg = show || 'Request failed. See console.';
                if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                setOnboardError(displayMsg);
            } finally {
                btn.label = oldLabel;
                btn.enable();
            }
        });
    }
    $w('#buttonsubmitonboard').onClick(async () => {
        const btn = $w('#buttonsubmitonboard');
        if (onboardEditMode && currentOnboardType === 'ttlock' && onboardStatus.ttlockConnected) {
            if (btn.label !== CONFIRM_DISCONNECT_LABEL) {
                btn.label = CONFIRM_DISCONNECT_LABEL;
                return;
            }
            const ttlockBtn = $w('#buttonttlockonboard');
            if (ttlockBtn?.disable) ttlockBtn.disable();
            btn.disable();
            btn.label = 'Loading...';
            setOnboardCloseButtonEnabled(false);
            try {
                if (typeof ttlockDisconnect === 'function') {
                    await ttlockDisconnect();
                    await refreshOnboardButtonLabels();
                    if ($w('#buttonttlockonboard')) {
                        $w('#buttonttlockonboard').label = 'Connect Smartdoor';
                        setTtlockButtonConnectedStyle(false);
                        if ($w('#buttonttlockonboard').enable) $w('#buttonttlockonboard').enable();
                    }
                    if ($w('#boxonboard')) $w('#boxonboard').hide();
                    onboardEditMode = false;
                    onboardSubmitConfirmPending = false;
                    if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                }
            } catch (e) { console.error('[ONBOARD DISCONNECT TTLOCK]', e); }
            finally { setOnboardCloseButtonEnabled(true); btn.enable(); btn.label = 'Disconnect'; if (ttlockBtn?.enable) ttlockBtn.enable(); }
            return;
        }
        if (onboardEditMode && currentOnboardType === 'cnyiot' && onboardStatus.cnyiotConnected) {
            if (btn.label !== CONFIRM_DISCONNECT_LABEL) {
                btn.label = CONFIRM_DISCONNECT_LABEL;
                return;
            }
            const cnyiotBtn = $w('#buttoncnyiotonboard');
            if (cnyiotBtn?.disable) cnyiotBtn.disable();
            btn.disable();
            btn.label = 'Loading...';
            setOnboardCloseButtonEnabled(false);
            try {
                if (typeof cnyiotDisconnect === 'function') {
                    await cnyiotDisconnect();
                    await refreshOnboardButtonLabels();
                    if ($w('#buttoncnyiotonboard')) {
                        $w('#buttoncnyiotonboard').label = 'Connecting Meter';
                        setCnyiotButtonConnectedStyle(false);
                        if ($w('#buttoncnyiotonboard').enable) $w('#buttoncnyiotonboard').enable();
                    }
                    if ($w('#boxonboard')) $w('#boxonboard').hide();
                    onboardEditMode = false;
                    onboardSubmitConfirmPending = false;
                    if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                }
            } catch (e) { console.error('[ONBOARD DISCONNECT CNYIOT]', e); }
            finally { setOnboardCloseButtonEnabled(true); btn.enable(); btn.label = 'Disconnect'; if (cnyiotBtn?.enable) cnyiotBtn.enable(); }
            return;
        }
        if (onboardDisconnectMode) {
            if (btn.label !== CONFIRM_DISCONNECT_LABEL) {
                btn.label = CONFIRM_DISCONNECT_LABEL;
                return;
            }
            btn.disable();
            btn.label = 'Loading...';
            try {
                if (currentOnboardType === 'bukku') {
                    if (typeof bukkuDisconnect !== 'function') {
                        setOnboardError('请更新 backend/saas/companysetting.jsw，确保导出 bukkuDisconnect');
                        if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                        btn.enable();
                        if (onboardDisconnectMode) btn.label = 'Disconnect';
                        return;
                    }
                    await bukkuDisconnect();
                    if ($w('#boxonboard')) $w('#boxonboard').hide();
                    onboardDisconnectMode = false;
                    setAccountButtonConnectedStyle(false);
                    setAccountButtonDisconnectStyle(false);
                    await refreshOnboardButtonLabels();
                    if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                } else if (currentOnboardType === 'xero') {
                    if (typeof xeroDisconnect !== 'function') {
                        setOnboardError('请更新 backend/saas/companysetting.jsw，确保导出 xeroDisconnect');
                        if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                        btn.enable();
                        if (onboardDisconnectMode) btn.label = 'Disconnect';
                        return;
                    }
                    await xeroDisconnect();
                    if ($w('#boxonboard')) $w('#boxonboard').hide();
                    onboardDisconnectMode = false;
                    setAccountButtonConnectedStyle(false);
                    setAccountButtonDisconnectStyle(false);
                    await refreshOnboardButtonLabels();
                    if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                } else if (currentOnboardType === 'autocount') {
                    if (typeof autocountDisconnect !== 'function') {
                        setOnboardError('请更新 backend/saas/companysetting.jsw，确保导出 autocountDisconnect');
                        if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                        btn.enable();
                        if (onboardDisconnectMode) btn.label = 'Disconnect';
                        return;
                    }
                    await autocountDisconnect();
                    if ($w('#boxonboard')) $w('#boxonboard').hide();
                    onboardDisconnectMode = false;
                    setAccountButtonConnectedStyle(false);
                    setAccountButtonDisconnectStyle(false);
                    await refreshOnboardButtonLabels();
                    if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                } else if (currentOnboardType === 'sql') {
                    if (typeof sqlDisconnect !== 'function') {
                        setOnboardError('请更新 backend/saas/companysetting.jsw，确保导出 sqlDisconnect');
                        if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                        btn.enable();
                        if (onboardDisconnectMode) btn.label = 'Disconnect';
                        return;
                    }
                    await sqlDisconnect();
                    if ($w('#boxonboard')) $w('#boxonboard').hide();
                    onboardDisconnectMode = false;
                    setAccountButtonConnectedStyle(false);
                    setAccountButtonDisconnectStyle(false);
                    await refreshOnboardButtonLabels();
                    if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                } else if (currentOnboardType === 'ttlock') {
                    if (typeof ttlockDisconnect !== 'function') {
                        setOnboardError('请更新 backend/saas/companysetting.jsw，确保导出 ttlockDisconnect');
                        if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                        btn.enable();
                        if (onboardDisconnectMode) btn.label = 'Disconnect';
                        return;
                    }
                    await ttlockDisconnect();
                    if ($w('#boxonboard')) $w('#boxonboard').hide();
                    onboardDisconnectMode = false;
                    await refreshOnboardButtonLabels();
                    if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                }
            } catch (e) {
                console.error('[ONBOARD DISCONNECT]', e);
            } finally {
                btn.enable();
                if (onboardDisconnectMode) btn.label = 'Disconnect';
                else btn.label = 'Update';
            }
            return;
        }
        if (onboardEditMode && !onboardSubmitConfirmPending) {
            btn.label = 'Confirm Update?';
            onboardSubmitConfirmPending = true;
            return;
        }
        const oldLabel = onboardEditMode ? 'Update' : btn.label;
        btn.disable();
        btn.label = 'Loading...';
        try {
            let connectOk = true;
            let connectReason = '';
            setOnboardCloseButtonEnabled(false);
            if (currentOnboardType === 'bukku') {
                const res = await bukkuConnect({
                    token: $w('#inputuseronboard').value || '',
                    subdomain: $w('#inputpasswordonboard').value || '',
                    einvoice: $w('#checkboxeinvoiceonboard') ? $w('#checkboxeinvoiceonboard').checked : false
                });
                if (res && res.ok === false) { connectOk = false; connectReason = res.reason || ''; }
                else if ($w('#boxonboard')) $w('#boxonboard').hide();
            } else if (currentOnboardType === 'autocount') {
                const res = await autocountConnect({
                    apiKey: $w('#inputuseronboard').value || '',
                    keyId: $w('#inputpasswordonboard').value || '',
                    accountBookId: ($w('#inputbookidonboard') && $w('#inputbookidonboard').value) ? String($w('#inputbookidonboard').value).trim() : '',
                    einvoice: $w('#checkboxeinvoiceonboard') ? $w('#checkboxeinvoiceonboard').checked : false
                });
                if (res && res.ok === false) { connectOk = false; connectReason = res.reason || ''; }
                else if ($w('#boxonboard')) $w('#boxonboard').hide();
            } else if (currentOnboardType === 'sql') {
                if (typeof sqlConnect !== 'function') {
                    setOnboardError('请更新 backend/saas/companysetting.jsw，确保导出 sqlConnect');
                    if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                    connectOk = false;
                } else {
                    const res = await sqlConnect({
                        accessKey: $w('#inputuseronboard').value || '',
                        secretKey: $w('#inputpasswordonboard').value || '',
                        baseUrl: ($w('#inputbookidonboard') && $w('#inputbookidonboard').value) ? String($w('#inputbookidonboard').value).trim() : '',
                        einvoice: $w('#checkboxeinvoiceonboard') ? $w('#checkboxeinvoiceonboard').checked : false
                    });
                    if (res && res.ok === false) { connectOk = false; connectReason = res.reason || ''; }
                    else if ($w('#boxonboard')) $w('#boxonboard').hide();
                }
            } else if (currentOnboardType === 'cnyiot' || currentOnboardType === 'ttlock') {
                const username = $w('#inputuseronboard').value || '';
                const password = $w('#inputpasswordonboard').value || '';
                let res;
                if (currentOnboardType === 'cnyiot') {
                    res = await cnyiotConnect({ mode: 'existing', username, password });
                } else {
                    res = await ttlockConnect({ mode: 'existing', username, password });
                }
                if (res && res.ok === false) { connectOk = false; connectReason = res.reason || ''; }
                else if ($w('#boxonboard')) $w('#boxonboard').hide();
            }
            if (!connectOk) {
                let showReason = connectReason || 'Request failed.';
                if (connectReason === 'USERNAME_AND_PASSWORD_REQUIRED') showReason = '请填写 Username 与 Password。';
                else if (connectReason === 'CONTACT_REQUIRED') showReason = 'Please fill in contact number in profile setting';
                else if (connectReason === 'CLIENT_SUBDOMAIN_REQUIRED') showReason = currentOnboardType === 'ttlock' ? 'Please fill in subdomain in profile setting (Smart Door).' : 'Please fill in subdomain in profile setting (Meter).';
                else if (connectReason === 'NO_PERMISSION' || connectReason === 'CLIENT_INACTIVE') showReason = connectReason === 'CLIENT_INACTIVE' ? "You don't have account yet." : "You don't have permission.";
                else if (connectReason === 'CNYIOT_PLATFORM_ACCOUNT_MISSING') showReason = '服务端未配置 Meter 母账号 (CNYIOT_LOGIN_NAME / CNYIOT_LOGIN_PSW)，请联系管理员。';
                else if (connectReason === 'TTLOCK_APP_CREDENTIALS_MISSING') showReason = '服务端未配置 TTLock 应用 (TTLOCK_CLIENT_ID / TTLOCK_CLIENT_SECRET)，请联系管理员。';
                else if (connectReason && connectReason.startsWith('CNYIOT_ADD_USER_FAILED_')) showReason = 'Meter 创建子账号失败 (CNYIOT ' + connectReason.replace('CNYIOT_ADD_USER_FAILED_', '') + ')，可能 subdomain 已被使用或请稍后重试。';
                else if (connectReason === 'CNYIOT_NETWORK_TIMEOUT' || /abort|timeout|TIMEOUT/i.test(connectReason)) showReason = '请求超时，请稍后重试或检查网络。';
                if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
                setOnboardError(showReason);
            } else if (onboardEditMode) {
                await refreshOnboardButtonLabels();
                onboardEditMode = false;
                onboardSubmitConfirmPending = false;
                setOnboardError('');
                if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
            } else {
                await refreshOnboardButtonLabels();
                setOnboardError('');
                if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
            }
        } catch (e) {
            console.error('[ONBOARD SUBMIT]', e);
            const msg = (e && e.message) ? String(e.message) : '';
            let show = msg;
            if (msg === 'CNYIOT_ACCOUNT_INVALID' || msg === 'USERNAME_AND_PASSWORD_REQUIRED') {
                show = msg === 'USERNAME_AND_PASSWORD_REQUIRED' ? '请填写 Username 与 Password。' : '账号或密码无效，请检查后重试。';
            } else if (msg === 'CNYIOT_NOT_CONFIGURED') show = '请先保存 CNYIoT 账号与密码。';
            else if (msg === 'CNYIOT_PLATFORM_ACCOUNT_MISSING') show = '服务端未配置 Meter 母账号 (CNYIOT_LOGIN_NAME / CNYIOT_LOGIN_PSW)，请联系管理员。';
            else if (msg === 'TTLOCK_APP_CREDENTIALS_MISSING') show = '服务端未配置 TTLock 应用 (TTLOCK_CLIENT_ID / TTLOCK_CLIENT_SECRET)，请联系管理员。';
            else if (msg && msg.startsWith('CNYIOT_ADD_USER_FAILED_')) show = 'Meter 创建子账号失败 (CNYIOT ' + msg.replace('CNYIOT_ADD_USER_FAILED_', '') + ')，可能 subdomain 已被使用或请稍后重试。';
            else if (msg === 'CNYIOT_NETWORK_TIMEOUT' || /abort|timeout|TIMEOUT/i.test(msg)) show = '请求超时，请稍后重试或检查网络。';
            const displayMsg = show || msg || 'Request failed.';
            if ($w('#textonboardmessage')) $w('#textonboardmessage').hide();
            setOnboardError(displayMsg);
        } finally {
            setOnboardCloseButtonEnabled(true);
            btn.label = oldLabel;
            btn.enable();
        }
    });
}
