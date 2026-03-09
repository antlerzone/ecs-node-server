/**
 * Owner Portal 页面 – 迁移版
 * 数据全部通过 backend/saas/ownerportal.jsw 请求 ECS Node，不读 Wix CMS。
 * Agreement 上下文仍用 backend/access/agreementdetail（已走 Node /api/agreement/*）。
 *
 * 依赖：backend/saas/ownerportal、backend/access/agreementdetail、wix-users（仅 getEmail）。
 * NRIC 上传：先上传到 OSS 取得 URL，再 updateOwnerProfile({ nricFront/nricback: url })。
 */

import wixUsers from 'wix-users';
import wixLocation from 'wix-location';
import {
    getOwner,
    getUploadCreds,
    loadCmsData,
    getClientsForOperator,
    getBanks,
    updateOwnerProfile,
    getOwnerPayoutList,
    getCostList,
    getAgreementList,
    getAgreementTemplate,
    getAgreement,
    updateAgreementSign,
    completeAgreementApproval,
    mergeOwnerMultiReference,
    removeApprovalPending,
    syncOwnerForClient,
    exportOwnerReportPdf,
    exportCostPdf
} from 'backend/saas/ownerportal';
import { getTenantAgreementContext, getOwnerAgreementContext, getOwnerTenantAgreementContext } from 'backend/access/agreementdetail';

/* ===============================
   GLOBAL STATE
================================ */
let OWNER = null;
let PROPERTIES = [];
let ROOMS = [];
let TENANCIES = [];
let TENANCY_MAP = {};
let previousSection = null;
let ownerReportRepeaterBound = false;
let ownerReportExportBound = false;
let COSTS = [];
let costPage = 1;
const COST_PER_PAGE = 10;
let activeSection = null;
let sectionSwitchBound = false;
let activeAgreementContext = null;
let agreementSubmitting = false;
let clientApprovalRepeaterBound = false;

const MAIN_SECTIONS = ['property', 'profile', 'agreement', 'report', 'cost'];
const MAIN_BUTTON_IDS = ['#buttonmyproperty', '#buttonprofile', '#buttonmyagreement', '#buttonmyreport', '#buttonsupport'];
/** Original button labels, set in onReady and restored after init */
let mainButtonLabels = {};

/* ===============================
   onReady
================================ */
$w.onReady(() => {
    $w('#repeaterclient').hide();
    MAIN_BUTTON_IDS.forEach(id => {
        const el = $w(id);
        if (el) {
            mainButtonLabels[id] = el.label || '';
            el.label = 'Loading...';
            el.disable();
        }
    });
    initDefaultSection();
    startInitAsync();
});

/* ===============================
   INIT FLOW
================================ */
async function startInitAsync() {
    try {
        const email = await wixUsers.currentUser.getEmail();
        if (!email) return showNotOwner();

        const ownerRes = await getOwner();
        if (!ownerRes.ok || !ownerRes.owner) return showNotOwner();

        OWNER = ownerRes.owner;

        bindSectionSwitch();

        if (!isOwnerProfileComplete(OWNER)) {
            console.warn('🚫 Profile incomplete');
            enableMainActions();
            return;
        }

        await loadAllCmsData();
        bindSectionSwitch();
        bindCloseButtons();
        bindHtmlUploadMessages();
        bindUpdateProfileButton();
        bindClientApprovalRepeater();
        renderClientApprovalRepeater();

        enableMainActions();
    } catch (err) {
        console.error('❌ startInitAsync error:', err);
        enableMainActions();
    }
}

function showNotOwner() {
    $w('#sectionownerportal').expand();
    $w('#texttitleownerportal').text = 'You Are Not our Owner Yet';
    MAIN_BUTTON_IDS.forEach(id => {
        const el = $w(id);
        if (el && mainButtonLabels[id] !== undefined) el.label = mainButtonLabels[id];
        if (el && el.disable) el.disable();
    });
}

function isOwnerProfileComplete(o) {
    return !!(
        o.ownerName &&
        o.bankName &&
        o.bankAccount &&
        o.nric &&
        o.nricFront &&
        o.accountholder &&
        o.mobileNumber
    );
}

/* ===============================
   LOAD CMS (from Node)
================================ */
async function loadAllCmsData() {
    console.log('▶️ loadAllCmsData start');

    const data = await loadCmsData();
    if (!data.ok) {
        console.warn('⚠️ loadCmsData failed', data);
        PROPERTIES = [];
        ROOMS = [];
        TENANCIES = [];
        TENANCY_MAP = {};
        return;
    }

    OWNER = data.owner;
    PROPERTIES = data.properties || [];
    ROOMS = data.rooms || [];
    TENANCIES = data.tenancies || [];

    let propertyIds = [];
    if (Array.isArray(OWNER.property)) {
        propertyIds = OWNER.property.map(p => (typeof p === 'object' && p._id ? p._id : p)).filter(Boolean);
    }
    if (propertyIds.length === 0 && PROPERTIES.length) {
        propertyIds = PROPERTIES.map(p => p._id);
    }

    const agreementRes = await getAgreementList({ ownerId: OWNER._id });
    const agreementItems = (agreementRes.ok && agreementRes.items) ? agreementRes.items : [];
    agreementItems.forEach(a => {
        const tid = a.tenancyid;
        if (!tid) return;
        const t = TENANCIES.find(x => x._id === tid);
        if (t) t.agreement = a.agreement || a;
    });

    TENANCY_MAP = {};
    TENANCIES.forEach(t => {
        const rid = typeof t.room === 'object' ? t.room : t.room;
        if (!rid) return;
        if (!TENANCY_MAP[rid]) TENANCY_MAP[rid] = [];
        TENANCY_MAP[rid].push(t);
    });

    renderPropertyDropdown();
    renderOperatorDropdown();
    renderTenancyRepeater(ROOMS);
}

/* ===============================
   SECTION SWITCH
================================ */
function bindSectionSwitch() {
    if (sectionSwitchBound) return;
    sectionSwitchBound = true;

    $w('#buttonmyproperty').onClick(() => switchSection('property'));
    $w('#buttonprofile').onClick(() => switchSection('profile'));
    $w('#buttonmyagreement').onClick(() => switchSection('agreement'));
    $w('#buttonmyreport').onClick(() => switchSection('report'));
    $w('#buttonownerreport').onClick(() => switchSection('report'));
    $w('#buttoncostreport').onClick(() => switchSection('cost'));
    $w('#buttonownerportal').onClick(() => switchToOwnerPortal());
}

function switchSection(sectionKey) {
    if (!isOwnerProfileComplete(OWNER)) {
        enableMainActions();
        switchSection('profile');
        return;
    }
    if (activeSection === sectionKey) return;

    previousSection = activeSection;
    collapseAllSections();
    $w('#sectionownerportal').collapse();
    $w('#sectionreportsubmenu').collapse();

    const target = $w(`#section${sectionKey}`);
    if (target) target.expand();
    activeSection = sectionKey;

    if (sectionKey === 'property') {
        renderPropertyDropdown();
        renderOperatorDropdown();
        renderTenancyRepeater(ROOMS);
        return;
    }
    if (sectionKey === 'profile') {
        initProfileSection();
        return;
    }
    if (sectionKey === 'report') {
        $w('#sectionreportsubmenu').expand();
        initOwnerReportSection();
        return;
    }
    if (sectionKey === 'cost') {
        $w('#sectionreportsubmenu').expand();
        initCostSection();
        return;
    }
    if (sectionKey === 'agreement') {
        initAgreementSection();
        return;
    }
}

function collapseAllSections() {
    MAIN_SECTIONS.forEach(k => {
        const sec = $w(`#section${k}`);
        if (sec) sec.collapse();
    });
}

/* ===============================
   PROPERTY DROPDOWN
================================ */
function renderPropertyDropdown() {
    const options = [
        { label: 'All Properties', value: 'all' },
        ...PROPERTIES.map(p => ({ label: p.shortname || 'Unnamed', value: p._id }))
    ];
    $w('#dropdownproperty').options = options;
    $w('#dropdownproperty').value = 'all';
    $w('#dropdownproperty').onChange(e => {
        const val = e.target.value;
        if (val === 'all') {
            renderTenancyRepeater(ROOMS);
        } else {
            const filtered = ROOMS.filter(r => {
                const pid = typeof r.property === 'object' ? r.property?._id : r.property;
                return pid === val;
            });
            renderTenancyRepeater(filtered);
        }
    });
}

/* ===============================
   OPERATOR DROPDOWN
================================ */
async function renderOperatorDropdown() {
    const data = await getClientsForOperator();
    const items = data.items || [];
    const options = [
        { label: 'All Operators', value: 'all' },
        ...items.map(c => ({ label: c.title || 'Unnamed Operator', value: c._id }))
    ];
    $w('#dropdownoperator').options = options;
    $w('#dropdownoperator').value = 'all';
}

/* ===============================
   TENANCY REPEATER
================================ */
function renderTenancyRepeater(roomList) {
    const repeater = $w('#repeatertenancy');
    repeater.data = roomList;

    repeater.onItemReady(($item, room) => {
        const prop = room.property;
        $item('#texttitleproperty').text = prop?.shortname || '-';

        const rid = room._id;
        const tenancies = TENANCY_MAP[rid] || [];
        const now = Date.now();

        const activeTenancies = tenancies.filter(t => {
            if (!t.end) return false;
            return new Date(t.end).getTime() >= now;
        });

        const btnAgreement = $item('#buttontenanttenancy');
        btnAgreement.disable();

        if (activeTenancies.length === 0) {
            $item('#texttenancydate').text = 'Available';
            $item('#texttenancydate').style.color = '#000000';
            $item('#texttenantname').text = '-';
            $item('#textrental').text = '-';
            return;
        }

        const current = activeTenancies.sort((a, b) => new Date(a.end).getTime() - new Date(b.end).getTime())[0];
        $item('#texttenantname').text = current.tenant?.fullname || '-';

        const dateEl = $item('#texttenancydate');
        dateEl.style.color = '#000000';
        if (current.begin && current.end) {
            const f = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
            dateEl.text = `${f.format(new Date(current.begin))} - ${f.format(new Date(current.end))}`;
            const diffDays = (new Date(current.end).getTime() - now) / (1000 * 60 * 60 * 24);
            if (diffDays <= 30) dateEl.style.color = '#FF0000';
        } else {
            dateEl.text = '-';
        }

        $item('#textrental').text = current.rental
            ? formatCurrency(current.rental, current.client?.currency)
            : '-';

        if (current.agreement) {
            btnAgreement.enable();
        }
    });
}

/* ===============================
   UI HELPERS
================================ */
function disableMainActions() {
    MAIN_BUTTON_IDS.forEach(id => {
        const el = $w(id);
        if (el) {
            if (mainButtonLabels[id] !== undefined) el.label = 'Loading...';
            if (el.disable) el.disable();
        }
    });
}

function enableMainActions() {
    MAIN_BUTTON_IDS.forEach(id => {
        const el = $w(id);
        if (el) {
            if (mainButtonLabels[id] !== undefined) el.label = mainButtonLabels[id];
            if (el.enable) el.enable();
        }
    });
}

function initDefaultSection() {
    collapseAllSections();
    $w('#sectionownerportal').expand();
    $w('#sectionreportsubmenu').collapse();
}

function formatCurrency(amount, currency) {
    if (!amount) return '-';
    const c = String(currency || '').toUpperCase();
    if (c === 'MYR') return `RM ${amount}`;
    if (c === 'SGD') return `SGD ${amount}`;
    if (c === 'USD') return `USD ${amount}`;
    return `${amount}`;
}

function goBack() {
    $w('#sectionreportsubmenu').collapse();
    collapseAllSections();
    if (previousSection) {
        const sec = $w(`#section${previousSection}`);
        if (sec) {
            sec.expand();
            activeSection = previousSection;
            previousSection = null;
            return;
        }
    }
    $w('#sectionownerportal').expand();
    activeSection = null;
}

function bindCloseButtons() {
    $w('#buttoncloseproperty').onClick(() => goBack());
    $w('#buttoncloseagreement').onClick(() => goBack());
    $w('#buttoncloseprofile').onClick(() => goBack());
    $w('#buttonclosereport').onClick(() => goBack());
}

function initNricImages(owner) {
    $w('#imagenric1').collapse();
    $w('#imagenric2').collapse();
    if (owner.nricFront) {
        $w('#imagenric1').src = owner.nricFront;
        $w('#imagenric1').expand();
    }
    if (owner.nricback) {
        $w('#imagenric2').src = owner.nricback;
        $w('#imagenric2').expand();
    }
}

function bindHtmlUploadMessages() {
    try {
        $w('#htmluploadbutton1').onMessage((event) => {
            const d = event.data;
            if (d && d.type === 'UPLOAD_SUCCESS' && d.url) {
                updateOwnerProfile({ nricFront: d.url }).then((res) => {
                    if (res.ok && res.owner) OWNER = res.owner;
                    $w('#imagenric1').src = d.url;
                    $w('#imagenric1').expand();
                }).catch((err) => console.error('❌ Update NRIC Front failed:', err));
            }
        });
    } catch (_) {}
    try {
        $w('#htmluploadbutton2').onMessage((event) => {
            const d = event.data;
            if (d && d.type === 'UPLOAD_SUCCESS' && d.url) {
                updateOwnerProfile({ nricback: d.url }).then((res) => {
                    if (res.ok && res.owner) OWNER = res.owner;
                    $w('#imagenric2').src = d.url;
                    $w('#imagenric2').expand();
                }).catch((err) => console.error('❌ Update NRIC Back failed:', err));
            }
        });
    } catch (_) {}
}

async function initHtmlUploadProfile() {
    try {
        const clientId = (Array.isArray(OWNER.client) && OWNER.client.length)
            ? OWNER.client[0]
            : (PROPERTIES[0] && PROPERTIES[0].client_id) ? PROPERTIES[0].client_id : null;
        if (!clientId) return;
        const creds = await getUploadCreds();
        if (!creds.ok || !creds.baseUrl) return;
        const initPayload = {
            type: 'INIT',
            baseUrl: creds.baseUrl,
            token: creds.token,
            username: creds.username,
            clientId
        };
        $w('#htmluploadbutton1').postMessage({ ...initPayload, uploadId: 'nric1', label: 'Upload NRIC Front / Passport', accept: 'image/*' });
        $w('#htmluploadbutton2').postMessage({ ...initPayload, uploadId: 'nric2', label: 'Upload NRIC Back', accept: 'image/*' });
    } catch (e) {
        console.error('initHtmlUploadProfile', e);
    }
}

function initProfileAddressFields() {
    const addr = OWNER.profile?.address || {};
    $w('#inputstreet').value = addr.street || '';
    $w('#inputcity').value = addr.city || '';
    $w('#inputstate').value = addr.state || '';
    $w('#inputpostcode').value = addr.postcode || '';
}

function initProfileSection() {
    initProfileFields();
    initProfileAddressFields();
    initProfileBankDropdown();
    initRegNoTypeDropdown();
    initEntityTypeDropdown();
    initNricImages(OWNER);
    initHtmlUploadProfile();
}

function initProfileFields() {
    $w('#inputlegalname').value = OWNER.ownerName || '';
    $w('#inputregno').value = OWNER.nric || '';
    $w('#inputphone').value = OWNER.mobileNumber || '';
    $w('#inputbankaccount').value = OWNER.bankAccount || '';
    $w('#inputaccountholder').value = OWNER.accountholder || '';
    $w('#inputemail').value = OWNER.email || '';
    $w('#inputemail').disable();
    if (OWNER.profile) {
        $w('#inputtaxidno').value = OWNER.profile.tax_id_no || '';
    }
}

async function initProfileBankDropdown() {
    const res = await getBanks();
    const items = (res.ok && res.items) ? res.items : [];
    const options = [
        { label: 'Select Bank', value: '' },
        ...items.map(b => ({ label: b.bankname, value: b._id }))
    ];
    $w('#dropdownbank').options = options;
    if (OWNER.bankName) {
        const bankId = typeof OWNER.bankName === 'object' ? OWNER.bankName._id : OWNER.bankName;
        $w('#dropdownbank').value = bankId;
    }
    $w('#dropdownbank').onChange(() => {
        OWNER.bankName = $w('#dropdownbank').value;
    });
}

function initEntityTypeDropdown() {
    $w('#dropdownentitytype').options = [
        { label: 'Select', value: 'SELECT' },
        { label: 'MALAYSIAN_COMPANY', value: 'MALAYSIAN_COMPANY' },
        { label: 'MALAYSIAN_INDIVIDUAL', value: 'MALAYSIAN_INDIVIDUAL' },
        { label: 'FOREIGN_COMPANY', value: 'FOREIGN_COMPANY' },
        { label: 'FOREIGN_INDIVIDUAL', value: 'FOREIGN_INDIVIDUAL' },
        { label: 'EXEMPTED_PERSON', value: 'EXEMPTED_PERSON' }
    ];
    $w('#dropdownentitytype').value = OWNER.profile?.entity_type || 'SELECT';
    applyEntityTypeLogic($w('#dropdownentitytype').value);
    $w('#dropdownentitytype').onChange(() => applyEntityTypeLogic($w('#dropdownentitytype').value));
}

function initRegNoTypeDropdown() {
    $w('#dropdownregnotype').options = [
        { label: 'Select', value: '' },
        { label: 'NRIC', value: 'NRIC' },
        { label: 'BRN', value: 'BRN' },
        { label: 'PASSPORT', value: 'PASSPORT' }
    ];
    $w('#dropdownregnotype').value = OWNER.profile?.reg_no_type || '';
}

function applyEntityTypeLogic(type) {
    $w('#dropdownregnotype').enable();
    $w('#inputregno').enable();
    $w('#inputtaxidno').enable();
    $w('#inputregno').placeholder = '';
    $w('#inputtaxidno').placeholder = '';
    switch (type) {
        case 'MALAYSIAN_COMPANY':
            $w('#dropdownregnotype').value = 'BRN';
            $w('#inputregno').placeholder = 'SSM No';
            $w('#inputtaxidno').placeholder = 'TIN No';
            break;
        case 'MALAYSIAN_INDIVIDUAL':
            $w('#dropdownregnotype').value = 'NRIC';
            $w('#inputregno').placeholder = 'NRIC No';
            $w('#inputtaxidno').placeholder = 'Tax ID';
            break;
        case 'FOREIGN_INDIVIDUAL':
            $w('#dropdownregnotype').value = 'PASSPORT';
            $w('#inputregno').placeholder = 'Passport No';
            $w('#inputtaxidno').placeholder = 'Tax ID';
            break;
        case 'FOREIGN_COMPANY':
            $w('#dropdownregnotype').value = 'PASSPORT';
            $w('#inputregno').placeholder = 'Registration No';
            $w('#inputtaxidno').placeholder = 'Tax ID';
            break;
        case 'EXEMPTED_PERSON':
            $w('#dropdownregnotype').value = '';
            $w('#inputregno').value = '';
            $w('#inputtaxidno').value = '';
            $w('#dropdownregnotype').disable();
            $w('#inputregno').disable();
            $w('#inputtaxidno').disable();
            break;
        default:
            break;
    }
}

function bindUpdateProfileButton() {
    $w('#buttonupdateprofile').onClick(async () => {
        const btn = $w('#buttonupdateprofile');
        btn.label = 'Updating...';
        btn.disable();

        try {
            const payload = {
                ownerName: $w('#inputlegalname').value,
                mobileNumber: $w('#inputphone').value,
                nric: $w('#inputregno').value,
                bankAccount: $w('#inputbankaccount').value,
                accountholder: $w('#inputaccountholder').value,
                bankName: OWNER.bankName || null,
                profile: {
                    ...(OWNER.profile || {}),
                    entity_type: $w('#dropdownentitytype').value,
                    reg_no_type: $w('#dropdownregnotype').value,
                    tax_id_no: $w('#inputtaxidno').value,
                    address: {
                        ...(OWNER.profile?.address || {}),
                        street: $w('#inputstreet').value,
                        city: $w('#inputcity').value,
                        state: $w('#inputstate').value,
                        postcode: $w('#inputpostcode').value
                    }
                }
            };

            const res = await updateOwnerProfile(payload);
            if (!res.ok) throw new Error(res.reason || 'UPDATE_FAILED');
            if (res.owner) OWNER = res.owner;

            if (Array.isArray(OWNER.account) && OWNER.account.length) {
                for (const acc of OWNER.account) {
                    try {
                        await syncOwnerForClient({ ownerId: OWNER._id, clientId: acc.clientId });
                    } catch (e) {
                        console.warn('Owner accounting sync failed:', e);
                    }
                }
            }

            btn.label = 'Update Complete';
            setTimeout(() => {
                btn.label = 'Update Profile';
                btn.enable();
                goBack();
            }, 1500);
        } catch (err) {
            console.error('❌ Update profile failed:', err);
            btn.label = 'Update Profile';
            btn.enable();
        }
    });
}

/* ===============================
   REPORT
================================ */
function initOwnerReportDate() {
    const today = new Date();
    const firstJan = new Date(today.getFullYear(), 0, 1);
    $w('#datepickerownerreport1').value = firstJan;
    $w('#datepickerownerreport2').value = today;
}

function initOwnerReportPropertyDropdown() {
    const options = PROPERTIES.map(p => ({ label: p.shortname || 'Unnamed', value: p._id }));
    $w('#dropdownownerreportproperty').options = options;
    if (options.length) $w('#dropdownownerreportproperty').value = options[0].value;
}

function bindOwnerReportFilters() {
    $w('#dropdownownerreportproperty').onChange(updateOwnerReportRepeater);
    $w('#datepickerownerreport1').onChange(updateOwnerReportRepeater);
    $w('#datepickerownerreport2').onChange(updateOwnerReportRepeater);
}

async function updateOwnerReportRepeater() {
    const propertyId = $w('#dropdownownerreportproperty').value;
    const startDate = $w('#datepickerownerreport1').value;
    const endDate = $w('#datepickerownerreport2').value;
    if (!propertyId || !startDate || !endDate) return;

    const res = await getOwnerPayoutList({ propertyId, startDate, endDate });
    const items = (res.ok && res.items) ? res.items : [];
    $w('#repeaterownerreport').data = items;
    updateOwnerReportSummary(items);
}

function updateOwnerReportSummary(items) {
    let totalRental = 0, totalUtility = 0, totalGross = 0, totalExpenses = 0, totalNet = 0;
    items.forEach(i => {
        totalRental += i.totalrental || 0;
        totalUtility += i.totalutility || 0;
        totalGross += i.totalcollection || 0;
        totalExpenses += i.expenses || 0;
        totalNet += i.netpayout || 0;
    });
    $w('#texttotalrental').text = formatRM(totalRental);
    $w('#textutility').text = formatRM(totalUtility);
    $w('#textgross').text = formatRM(totalGross);
    $w('#textexpenses').text = formatRM(totalExpenses);
    $w('#textnet').text = formatRM(totalNet);
}

function formatRM(val = 0) {
    return 'RM ' + Number(val).toLocaleString('en-MY');
}

function formatMonth(date) {
    if (!(date instanceof Date)) return '';
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function initOwnerReportSection() {
    initOwnerReportDate();
    initOwnerReportPropertyDropdown();
    bindOwnerReportFilters();
    bindOwnerReportRepeater();
    bindOwnerReportExport();
    updateOwnerReportRepeater();
}

function bindOwnerReportRepeater() {
    if (ownerReportRepeaterBound) return;
    ownerReportRepeaterBound = true;
    $w('#repeaterownerreport').onItemReady(($item, item) => {
        const date = new Date(item.period);
        $item('#textperiod').text = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        $item('#texttotalrental').text = formatRM(item.totalrental);
        $item('#textutility').text = formatRM(item.totalutility);
        $item('#textgross').text = formatRM(item.totalcollection);
        $item('#textexpenses').text = formatRM(item.expenses);
        $item('#textnet').text = formatRM(item.netpayout);
        if (item.monthlyreport) {
            $item('#buttondownloadreport').show();
            $item('#buttondownloadreport').link = item.monthlyreport;
        } else {
            $item('#buttondownloadreport').hide();
        }
    });
}

function bindOwnerReportExport() {
    if (ownerReportExportBound) return;
    ownerReportExportBound = true;
    $w('#buttonexportpdf').onClick(async () => {
        const propertyId = $w('#dropdownownerreportproperty').value;
        const startDate = $w('#datepickerownerreport1').value;
        const endDate = $w('#datepickerownerreport2').value;
        if (!propertyId || !startDate || !endDate) return;
        const btn = $w('#buttonexportpdf');
        const origLabel = btn.label || 'Export PDF';
        btn.disable();
        btn.label = 'Loading...';
        try {
            const res = await exportOwnerReportPdf({ propertyId, startDate, endDate });
            if (res.ok && res.downloadUrl) {
                wixLocation.to(res.downloadUrl);
            } else {
                console.warn('Export failed', res?.reason);
            }
        } finally {
            btn.label = origLabel;
            btn.enable();
        }
    });
}

/* ===============================
   COST
================================ */
function initCostSection() {
    costPage = 1;
    bindCloseCostButton();
    initCostPropertyDropdown();
    initCostReportDate();
    bindCostReportFilters();
    bindCostExportButton();
    loadCostData();
}

function bindCloseCostButton() {
    $w('#buttonclosecost').onClick(() => goBack());
}

function initCostPropertyDropdown() {
    const options = PROPERTIES.map(p => ({ label: p.shortname || 'Unnamed', value: p._id }));
    $w('#dropdowncostproperty').options = options;
    if (options.length) $w('#dropdowncostproperty').value = options[0].value;
    $w('#dropdowncostproperty').onChange(() => {
        costPage = 1;
        loadCostData();
    });
}

async function loadCostData() {
    const propertyId = $w('#dropdowncostproperty').value;
    const startDate = $w('#datepickercostreport1').value;
    const endDate = $w('#datepickercostreport2').value;
    if (!propertyId || !startDate || !endDate) return;

    const skip = (costPage - 1) * COST_PER_PAGE;
    const res = await getCostList({
        propertyId,
        startDate,
        endDate,
        skip,
        limit: COST_PER_PAGE
    });
    COSTS = (res.ok && res.items) ? res.items : [];
    renderCostRepeater(COSTS);
    updateCostPagination(res.totalCount || 0);
}

function renderCostRepeater(items) {
    $w('#repeatercost').data = items;
    $w('#repeatercost').onItemReady(($item, item) => {
        $item('#textcostproperty').text = item.listingTitle || item.property?.shortname || '-';
        $item('#textcostdate').text = item.period ? formatMonth(item.period) : '-';
        $item('#textcostamount').text = formatCurrency(item.amount, item.client?.currency);
        $item('#textcostdescription').text = item.description || '-';
        if (item.bukkuurl) {
            $item('#buttondownloadinvoice').show();
            $item('#buttondownloadinvoice').link = item.bukkuurl;
        } else {
            $item('#buttondownloadinvoice').hide();
        }
    });
}

function updateCostPagination(totalCount) {
    const totalPages = Math.max(1, Math.ceil(totalCount / COST_PER_PAGE));
    $w('#paginationcost').totalPages = totalPages;
    $w('#paginationcost').currentPage = costPage;
    $w('#paginationcost').onChange(e => {
        costPage = e.target.currentPage;
        loadCostData();
    });
}

function bindCostExportButton() {
    $w('#buttonexportpdfcost').onClick(async () => {
        const propertyId = $w('#dropdowncostproperty').value;
        const startDate = $w('#datepickercostreport1').value;
        const endDate = $w('#datepickercostreport2').value;
        if (!propertyId || !startDate || !endDate) return;
        const btn = $w('#buttonexportpdfcost');
        const origLabel = btn.label || 'Export PDF';
        btn.disable();
        btn.label = 'Loading...';
        try {
            const res = await exportCostPdf({ propertyId, startDate, endDate });
            if (res.ok && res.downloadUrl) {
                wixLocation.to(res.downloadUrl);
            } else {
                console.warn('Export failed', res?.reason);
            }
        } finally {
            btn.label = origLabel;
            btn.enable();
        }
    });
}

function initCostReportDate() {
    const today = new Date();
    const firstJan = new Date(today.getFullYear(), 0, 1);
    $w('#datepickercostreport1').value = firstJan;
    $w('#datepickercostreport2').value = today;
}

function bindCostReportFilters() {
    $w('#datepickercostreport1').onChange(() => { costPage = 1; loadCostData(); });
    $w('#datepickercostreport2').onChange(() => { costPage = 1; loadCostData(); });
}

function switchToOwnerPortal() {
    collapseAllSections();
    $w('#sectionreportsubmenu').collapse();
    $w('#sectionownerportal').expand();
    activeSection = null;
    previousSection = null;
}

/* ===============================
   AGREEMENT
================================ */
let agreementRepeaterBound = false;

function bindAgreementRepeater() {
    if (agreementRepeaterBound) return;
    agreementRepeaterBound = true;

    $w('#repeateragreement').onItemReady(($item, item) => {
        const property = item.property;
        const btn = $item('#buttonagreement');
        $item('#textproperty').text = property?.shortname || 'Unknown Property';
        const status = item.status;

        if (status === 'pending') {
            $item('#textproperty').style.color = '#D32F2F';
            btn.label = 'Sign Agreement';
            btn.enable();
            btn.onClick(async () => {
                setAgreementButtonsDisabled(true);
                try {
                    await openAgreementBox(item);
                } catch (err) {
                    console.error(err);
                    setAgreementButtonsDisabled(false);
                }
            });
            return;
        }
        if (status === 'waiting_third') {
            $item('#textproperty').style.color = '#999999';
            btn.label = 'Pending Complete';
            btn.disable();
            return;
        }
        if (status === 'completed') {
            $item('#textproperty').style.color = '#000000';
            btn.label = 'View Agreement';
            btn.enable();
            btn.onClick(() => {
                if (item.agreement?.pdfurl) wixLocation.to(item.agreement.pdfurl);
            });
            return;
        }
        $item('#textproperty').style.color = '#999999';
        btn.label = 'Unavailable';
        btn.disable();
    });
}

async function initAgreementSection() {
    $w('#boxagreement').hide();
    activeAgreementContext = null;
    agreementSubmitting = false;
    $w('#signatureinputagreement').clear();
    $w('#buttonagree').disable();
    bindAgreementRepeater();
    bindAgreementAgreeButton();
    await loadAgreementList();
}

async function loadAgreementList() {
    if (!OWNER || OWNER._id == null) {
        $w('#repeateragreement').data = [];
        return;
    }
    try {
        const res = await getAgreementList({ ownerId: OWNER._id });
        const items = (res.ok && Array.isArray(res.items)) ? res.items : [];
        $w('#repeateragreement').data = items;
    } catch (err) {
        console.error('loadAgreementList error:', err);
        $w('#repeateragreement').data = [];
    }
}

async function renderAgreementHtml(templateHtml, variables = {}) {
    let html = templateHtml || '';
    const usedVars = [...html.matchAll(/{{\s*([\w]+)\s*}}/g)].map(m => m[1]);
    usedVars.forEach(key => {
        let value = variables[key];
        if (value === undefined || value === null) value = '';
        if (['sign', 'nricfront', 'nricback'].includes(key) && typeof value === 'string' && value.startsWith('wix:image://')) {
            value = wixImageToStatic(value) ? `<div style="margin-top:16px"><img src="${wixImageToStatic(value)}" style="max-width:300px; border:1px solid #ccc;" /></div>` : '';
        }
        html = html.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value);
    });
    $w('#htmlagreement').postMessage({ type: 'render', html });
}

function bindAgreementAgreeButton() {
    const btn = $w('#buttonagree');
    btn.onClick(async () => {
        if (agreementSubmitting || !activeAgreementContext) return;
        agreementSubmitting = true;
        btn.disable();
        btn.label = 'Submitting...';

        try {
            const signatureValue = $w('#signatureinputagreement').value || '';
            if (!signatureValue) throw new Error('Signature required');

            const freshRes = await getAgreement({ agreementId: activeAgreementContext.agreement._id });
            if (!freshRes.ok || !freshRes.agreement) throw new Error('Agreement not found');
            const freshAgreement = freshRes.agreement;

            const fullyCompleted = freshAgreement.tenantsign && signatureValue;
            const newStatus = fullyCompleted ? 'completed' : 'waiting_third';

            await updateAgreementSign({
                agreementId: freshAgreement._id,
                ownersign: signatureValue,
                ownerSignedAt: new Date(),
                status: newStatus
            });

            const approvalRes = await completeAgreementApproval({
                ownerId: OWNER._id,
                propertyId: activeAgreementContext.propertyid,
                clientId: freshAgreement.client,
                agreementId: freshAgreement._id
            });
            if (!approvalRes?.ok) throw new Error(approvalRes?.message || 'APPROVAL_UPDATE_FAILED');

            btn.label = 'Complete';
            setTimeout(async () => {
                $w('#boxagreement').collapse();
                $w('#signatureinputagreement').clear();
                btn.label = 'Agree';
                btn.disable();
                agreementSubmitting = false;
                activeAgreementContext = null;
                await loadAgreementList();
                await renderClientApprovalRepeater();
                setAgreementButtonsDisabled(false);
                switchToOwnerPortal();
            }, 1000);
        } catch (err) {
            console.error('❌ Owner agreement failed:', err);
            btn.label = 'Agree';
            btn.enable();
            agreementSubmitting = false;
        }
    });
}

async function openAgreementBox(item) {
    activeAgreementContext = item;
    $w('#boxagreement').hide();
    $w('#signatureinputagreement').clear();
    $w('#buttonagree').disable();

    const tplRes = await getAgreementTemplate({ templateId: item.agreementid });
    const tpl = tplRes?.template;
    if (!tpl?.html) {
        console.error('Template HTML missing');
        return;
    }

    let ctx;
    const mode = item.agreement?.mode;
    const staffVars = {
        staffname: OWNER.ownerName,
        staffnric: OWNER.nric,
        staffcontact: OWNER.mobileNumber,
        staffemail: OWNER.email
    };

    const clientId = item.clientid ?? (item.agreement && (typeof item.agreement.client === 'object' ? item.agreement.client?._id : item.agreement.client));
    if (mode === 'tenant_operator') {
        ctx = await getTenantAgreementContext(item.tenancyid, item.agreementid, staffVars);
    } else if (mode === 'owner_tenant') {
        ctx = await getOwnerTenantAgreementContext(item.tenancyid, item.agreementid, staffVars);
    } else {
        ctx = await getOwnerAgreementContext(OWNER._id, item.propertyid, clientId, item.agreementid, staffVars);
    }

    if (!ctx?.ok) {
        console.error('Agreement context failed', ctx);
        return;
    }

    await renderAgreementHtml(tpl.html, ctx.variables);
    setTimeout(() => $w('#boxagreement').show(), 200);
    $w('#signatureinputagreement').onChange(() => {
        $w('#buttonagree').enable();
        if (!$w('#signatureinputagreement').value?.length) $w('#buttonagree').disable();
    });
}

function setAgreementButtonsDisabled(disabled, loadingLabel = 'Loading...') {
    $w('#repeateragreement').forEachItem(($item) => {
        const btn = $item('#buttonagreement');
        if (!btn) return;
        if (disabled) {
            btn.disable();
            btn.label = loadingLabel;
        } else {
            btn.enable();
            btn.label = 'Sign Agreement';
        }
    });
}

function wixImageToStatic(url = '') {
    if (!url.startsWith('wix:image://')) return url;
    const match = url.match(/wix:image:\/\/v1\/([^/]+)/);
    return match ? `https://static.wixstatic.com/media/${match[1]}` : '';
}

/* ===============================
   CLIENT APPROVAL REPEATER
================================ */
async function renderClientApprovalRepeater() {
    const rows = [];
    const pendingClients = Array.isArray(OWNER.approvalpending) ? OWNER.approvalpending : [];
    pendingClients.forEach(p => {
        const clientName = p.clientName || 'Operator';
        const propertyName = p.propertyShortname || 'Property';
        rows.push({
            _id: `client_${p.propertyid || p.propertyId}_${p.clientid || p.clientId}`,
            type: 'client',
            propertyid: p.propertyid || p.propertyId,
            clientid: p.clientid || p.clientId,
            clientName,
            propertyShortname: propertyName,
            title: `${clientName} | ${propertyName} | Pending Approval`
        });
    });

    try {
        const res = await getAgreementList({ ownerId: OWNER._id });
        const items = (res.ok && res.items) ? res.items : [];
        items.filter(a => a.status === 'pending' && !a.agreement?.ownersign).forEach(a => {
            rows.push({
                _id: `agreement_${a._id}`,
                type: 'agreement',
                agreement: a.agreement
            });
        });
    } catch (err) {
        console.error('renderClientApprovalRepeater error:', err);
    }

    if (!rows.length) {
        $w('#repeaterclient').hide();
        return;
    }
    $w('#repeaterclient').show();
    $w('#repeaterclient').data = rows;
}

function bindClientApprovalRepeater() {
    if (clientApprovalRepeaterBound) return;
    clientApprovalRepeaterBound = true;

    $w('#repeaterclient').onItemReady(($item, item) => {
        const approveBtn = $item('#buttonapprove');
        const rejectBtn = $item('#buttonreject');

        if (item.type === 'agreement') {
            $item('#textclient').text = 'Pending Signing Agreement';
            approveBtn.hide();
            rejectBtn.label = 'Sign Agreement';
            rejectBtn.show();
            rejectBtn.enable();
            rejectBtn.onClick(async () => {
                setAgreementButtonsDisabled(true);
                try {
                    await openAgreementBox({
                        agreementid: item.agreement?.agreementtemplate,
                        propertyid: item.agreement?.property,
                        tenancyid: item.agreement?.tenancy,
                        clientid: item.agreement?.client ?? item.agreement?.clientid,
                        agreement: item.agreement
                    });
                } catch (err) {
                    console.error(err);
                    setAgreementButtonsDisabled(false);
                }
            });
            return;
        }

        $item('#textclient').text = item.title || `${item.clientName || 'Operator'} | ${item.propertyShortname || 'Property'} | Pending Approval`;
        approveBtn.show();
        rejectBtn.show();

        approveBtn.onClick(async () => {
            approveBtn.disable();
            rejectBtn.disable();
            approveBtn.label = 'Loading...';
            try {
                const mrRes = await mergeOwnerMultiReference({
                    ownerId: OWNER._id,
                    propertyId: item.propertyid,
                    clientId: item.clientid
                });
                if (!mrRes?.ok) throw new Error(mrRes?.message || 'MR_FAILED');

                await removeApprovalPending({
                    ownerId: OWNER._id,
                    propertyId: item.propertyid,
                    clientId: item.clientid
                });

                // Approval success = owner bound to client. Do not block on accounting sync.
                approveBtn.label = 'Complete';
                setTimeout(async () => {
                    const ownerRes = await getOwner();
                    if (ownerRes.ok && ownerRes.owner) OWNER = ownerRes.owner;
                    await renderClientApprovalRepeater();
                    renderOperatorDropdown();
                }, 1000);

                // Best-effort: sync owner to client's account (Bukku/Xero/etc.). Failure must not affect approval.
                syncOwnerForClient({ ownerId: OWNER._id, clientId: item.clientid }).then((syncRes) => {
                    const reason = syncRes?.reason || '';
                    const silentReasons = ['NO_ACCOUNT_INTEGRATION', 'NO_ACCOUNTING_CAPABILITY', 'BACKEND_ERROR', 'BUKKU_SYNC_SKIPPED'];
                    if (!syncRes?.ok && !silentReasons.includes(reason)) {
                        console.warn('Accounting sync skipped (owner already approved):', reason);
                    }
                }).catch(() => {});
            } catch (err) {
                console.error('Approve failed:', err);
                approveBtn.label = 'Approve';
                approveBtn.enable();
                rejectBtn.enable();
            }
        });

        rejectBtn.onClick(async () => {
            approveBtn.disable();
            rejectBtn.disable();
            rejectBtn.label = 'Loading...';
            try {
                await removeApprovalPending({
                    ownerId: OWNER._id,
                    propertyId: item.propertyid,
                    clientId: item.clientid
                });
                const ownerRes = await getOwner();
                if (ownerRes.ok && ownerRes.owner) OWNER = ownerRes.owner;
                rejectBtn.label = 'Complete';
                setTimeout(() => renderClientApprovalRepeater(), 1500);
            } catch (err) {
                console.error('Reject failed:', err);
                rejectBtn.label = 'Reject';
                approveBtn.enable();
                rejectBtn.enable();
            }
        });
    });
}
