/* =======================
   import
   旧代码迁移：wixData→getAdminList/updateFeedback/removeFeedback/updateRefundDeposit/removeRefundDeposit；
   creditplan→getCreditPlans；getMyBillingInfo/startNormalTopup 用 topup。
   若没有 backend/saas/topup，可改为：getMyBillingInfo+getCreditPlans 来自 backend/billing/billing，startNormalTopup 来自 backend/billing/topup。
   Admin 必须用 backend/saas/admindashboard（粘贴 velo-backend-saas-admindashboard.jsw.snippet.js）。
   #boxrefund 内需有：#textrefund、#inputrefundamount（Wix 中 title: "Refund amount"，placeholder 填应退金额，可编辑且只能 ≤ 原 amount）、#buttonmarkasrefund、#buttoncloserefund、#buttondeleterefund。
   #buttonagreementlist 点击打开 #sectionproperty（按物业+状态看租约；#repeatertenancy 只显示当前 Staff 做的 booking 的 tenancy）。已删 #repeateragreement。无 #buttonproperty。
   页面结构：#sectiontab 内放 #buttonadmin、#buttonagreementlist、#buttonprofile；始终 expand & show。无 credit 或无 permission 时 sectiontab 内按钮全部 disable。
======================= */
import wixLocation from 'wix-location';
import { getAccessContext } from 'backend/access/manage';
import { getMyBillingInfo, getCreditPlans, startNormalTopup } from 'backend/saas/topup';
import { submitTicket } from 'backend/saas/help';
import {
    getAdminList,
    updateFeedback,
    updateRefundDeposit,
    removeFeedback,
    removeRefundDeposit,
    signAgreementOperator,
    getTenancyList,
    getTenancyFilters,
    getAgreementForOperator
} from 'backend/saas/admindashboard';
import { getAgreementTemplate } from 'backend/saas/ownerportal';
import { getTenantAgreementContext, getOwnerAgreementContext } from 'backend/access/agreementdetail';
import { getProfile } from 'backend/saas/companysetting';

/* =======================
   let
======================= */
let accessCtx = null;
let activeSection = null;
let lastSectionBeforeTopup = 'profile';
let topupInited = false;
let selectedTopupPlanId = null;
let selectedTopupPlanCache = null;
let topupRepeaterBound = false;
let topupCheckoutBound = false;
let topupCloseBound = false;
let sectionSwitchBound = false;
let defaultSectionCollapsed = false;
let clientCurrency = 'MYR';
let adminInited = false;
let adminDataCache = [];
let adminCurrentPage = 1;
let adminPageSize = 10;
let adminFilterType = 'ALL';
let adminSearchKeyword = '';
let deleteConfirmId = null;
let currentDetailItem = null;
let currentOperatorAgreementItem = null;
let agreementOperatorSubmitting = false;
let propertySectionInited = false;
let lastSectionBeforeProperty = 'admin';
let openedAgreementFromSection = 'admin';

/* =======================
   const
======================= */
const MAIN_SECTIONS = ['topup', 'admin', 'detail', 'property', 'agreement'];

const sectionLoaded = {
    topup: false
};

/* =======================
   onReady
======================= */
$w.onReady(() => {
    disableMainActions();
    initDefaultSection();
    $w('#textstatusloading').hide(); // 先隐藏，若 startInitAsync 里需要会再 show
    startInitAsync(); // 不 await
});

/* =======================
   init flow
======================= */
async function startInitAsync() {
    accessCtx = await getAccessContext();

    clientCurrency =
        String(accessCtx.client?.currency || 'MYR').toUpperCase();

    if (!accessCtx.ok) {
        showAccessDenied(accessCtx.reason === 'NO_PERMISSION' ? "You don't have permission" : "You don't have account yet");
        return;
    }

    if (accessCtx.credit?.ok === false) {
        await enterForcedTopupModeManage();
        try { $w('#textstatusloading').hide(); } catch (_) {}
        return;
    }

    bindSectionSwitch();
    bindTopupCloseButton();
    await applyAdminMainActions();
    bindProblemBoxClose(); // ⭐ 必须加
    bindAdminButton();
    try { $w('#textstatusloading').hide(); } catch (_) {}
}

function bindAdminButton() {
    $w('#buttonadmin').onClick(async () => {
        $w('#buttonadmin').disable();
        try {
            if (!adminInited) {
                await initAdminSection();
                adminInited = true;
            }
            await switchSectionAsync('admin');
        } finally {
            $w('#buttonadmin').enable();
        }
    });
    $w('#buttonagreementlist').onClick(async () => {
        $w('#buttonagreementlist').disable();
        try {
            await switchSectionAsync('property');
        } finally {
            $w('#buttonagreementlist').enable();
        }
    });
}

async function initAdminSection() {
    $w('#dropdownfilter').options = [
        { label: 'All', value: 'ALL' },
        { label: 'Feedback', value: 'Feedback' },
        { label: 'Refund', value: 'Refund' },
        { label: 'Agreement', value: 'Agreement' }
    ];
    $w('#dropdownfilter').value = 'ALL';
    bindAdminSearch();
    bindAdminFilter();
    bindAdminPagination();
    bindAdminRepeater();
    bindOperatorAgreementButtons();
    showSectionLoading('Loading...');
    await loadAdminData();
    hideSectionLoading();
}

/* =======================
   Section Switch
======================= */
function bindSectionSwitch() {
    if (sectionSwitchBound) return;
    sectionSwitchBound = true;

    $w('#buttontopup').onClick(async () => {
        lastSectionBeforeTopup = activeSection || 'profile';

        if (!topupInited) {
            await initTopupSection();
            topupInited = true;
        }

        await switchSectionAsync('topup');
    });
}

async function switchSectionAsync(sectionKey) {
    if (activeSection === sectionKey) return;

    const prev = activeSection;
    collapseAllSections();

    if (!defaultSectionCollapsed) {
        $w('#sectiondefault').collapse();
        defaultSectionCollapsed = true;
    }

    $w(`#section${sectionKey}`).expand();
    activeSection = sectionKey;
    try { $w('#sectiontab').expand(); $w('#sectiontab').show(); } catch (_) {}

    if (sectionKey === 'property' && !propertySectionInited) {
        lastSectionBeforeProperty = prev || 'admin';
        await initPropertySection();
        propertySectionInited = true;
    }
}

/* =======================
   Section Helpers
======================= */
function collapseAllSections() {
    MAIN_SECTIONS.forEach(k => {
        const sec = $w(`#section${k}`);
        if (sec) sec.collapse();
    });
}

function initDefaultSection() {
    $w('#sectionheader').expand();
    try { $w('#sectiontab').expand(); $w('#sectiontab').show(); } catch (_) {}
    $w('#sectiondefault').expand();
    collapseAllSections();
}

function showSectionLoading(text = 'Loading...') {
    $w('#text19').text = text;
    $w('#text19').show();
}

function hideSectionLoading() {
    $w('#text19').hide();
}

/* =======================
   Permission / UI
======================= */
function disableMainActions() {
    [
        '#buttonprofile',
        '#buttonusersetting',
        '#buttonintegration',
        '#buttontopup',
        '#buttonadmin',
        '#buttonagreementlist'
    ].forEach(id => {
        try {
            $w(id).disable();
        } catch (_) {}
    });
}

function enableMainActions() {
    [
        '#buttonprofile',
        '#buttonusersetting',
        '#buttonintegration',
        '#buttontopup',
        '#buttonadmin',
        '#buttonagreementlist'
    ].forEach(id => {
        try {
            $w(id).enable();
        } catch (_) {}
    });
}

/** Only enable #buttonadmin and #buttonagreementlist when company profile is filled (client title set). */
async function applyAdminMainActions() {
    const always = ['#buttonprofile', '#buttonusersetting', '#buttonintegration', '#buttontopup'];
    always.forEach(id => {
        try {
            $w(id).enable();
        } catch (_) {}
    });
    let profileFilled = false;
    try {
        const res = await getProfile();
        if (res && res.ok && res.client && String(res.client.title || '').trim()) {
            profileFilled = true;
        }
    } catch (_) {}
    ['#buttonadmin', '#buttonagreementlist'].forEach(id => {
        try {
            if (profileFilled) {
                $w(id).enable();
            } else {
                $w(id).disable();
            }
        } catch (_) {}
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
async function enterForcedTopupModeManage() {
    collapseAllSections();
    $w('#sectiontopup').expand();
    activeSection = 'topup';
    defaultSectionCollapsed = true;
    try { $w('#sectiontab').expand(); $w('#sectiontab').show(); } catch (_) {}
    disableMainActions(); // 无 credit 时 sectiontab 内按钮全部 disable
}

/* =======================
   Topup Section
======================= */
async function initTopupSection() {
    const billing = await getMyBillingInfo();
    const credits = Array.isArray(billing.credit) ? billing.credit : [];
    const totalCredit =
        credits.reduce((s, c) => s + Number(c.amount || 0), 0);

    $w('#textcurrentcredit').text =
        `Current Credit Balance: ${totalCredit}`;

    const plans = await getCreditPlans();
    $w('#repeatertopup').data = Array.isArray(plans) ? plans : [];

    if (!topupRepeaterBound) {
        $w('#repeatertopup').onItemReady(($item, plan) => {
            $item('#textamount').text =
                `${clientCurrency} ${plan.sellingprice}`;
            $item('#textcreditamount').text = String(plan.credit);
            $item('#boxcolor').hide();

            $item('#containertopup').onClick(() => {
                selectedTopupPlanId = plan._id || plan.id;
                selectedTopupPlanCache = plan;

                $w('#repeatertopup').forEachItem($i =>
                    $i('#boxcolor').hide()
                );

                $item('#boxcolor').show();
            });
        });

        topupRepeaterBound = true;
    }

    if (!topupCheckoutBound) {
        $w('#buttoncheckout').onClick(async () => {
            if (!selectedTopupPlanCache) return;

            const amount =
                Number(selectedTopupPlanCache.sellingprice || 0);

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
                    console.warn('[admindashboard] submitTicket topup_manual failed', e);
                }
                return;
            }

            const res = await startNormalTopup({
                creditPlanId: selectedTopupPlanId,
                returnUrl: wixLocation.url
            });

            wixLocation.to(res.url);
        });

        topupCheckoutBound = true;
    }
}

/* =======================
   Topup Close
======================= */
function bindTopupCloseButton() {
    if (topupCloseBound) return;
    topupCloseBound = true;

    $w('#buttontopupclose').onClick(async () => {
        if (accessCtx?.credit?.ok === false) return;

        $w('#sectiontopup').collapse();

        const target = lastSectionBeforeTopup || 'profile';
        $w(`#section${target}`).expand();
        activeSection = target;
    });
}

/* =======================
   Problem Box
======================= */
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

/* =======================
   Problem Box Close
======================= */
function bindProblemBoxClose() {
    $w('#buttoncloseproblem2').onClick(() => {
        $w('#boxproblem2').hide();
    });
}

/* =======================
   Admin – 与旧代码一致：一次拉取，前端筛选+分页
======================= */
async function loadAdminData() {
    adminCurrentPage = 1;

    try {
        const res = await getAdminList({ limit: 1000 });
        if (!res.ok) {
            adminDataCache = [];
        } else {
            adminDataCache = Array.isArray(res.items) ? res.items : [];
        }
    } catch (e) {
        adminDataCache = [];
    }

    adminDataCache.sort((a, b) =>
        new Date(b._createdDate || 0).getTime() -
        new Date(a._createdDate || 0).getTime()
    );
    applyAdminFilterAndRender();
}

function bindAdminSearch() {
    $w('#inputsearch').onInput(() => {
        adminSearchKeyword = ($w('#inputsearch').value || '').toLowerCase().trim();
        adminCurrentPage = 1;
        applyAdminFilterAndRender();
    });
}

function bindAdminFilter() {
    $w('#dropdownfilter').onChange(() => {
        adminFilterType = ($w('#dropdownfilter').value || 'ALL');
        adminCurrentPage = 1;
        applyAdminFilterAndRender();
    });
}

function applyAdminFilterAndRender() {
    let list = [...adminDataCache];

    if (adminFilterType === 'Feedback') {
        list = list.filter(i => i._type === 'FEEDBACK');
    }

    if (adminFilterType === 'Refund') {
        list = list.filter(i => i._type === 'REFUND');
    }

    if (adminFilterType === 'Agreement') {
        list = list.filter(i => i._type === 'PENDING_OPERATOR_AGREEMENT');
    }

    if (adminSearchKeyword) {
        list = list.filter(i => {
            const room = (i.room?.title_fld || '').toLowerCase();
            const tenant = (i.tenant?.fullname || '').toLowerCase();
            return room.includes(adminSearchKeyword) ||
                tenant.includes(adminSearchKeyword);
        });
    }

    const totalPages = Math.ceil(list.length / adminPageSize) || 1;

    $w('#paginationadmin').totalPages = totalPages;
    $w('#paginationadmin').currentPage = adminCurrentPage;

    const start = (adminCurrentPage - 1) * adminPageSize;
    const pageData = list.slice(start, start + adminPageSize);

    $w('#repeateradmin').data = pageData;

    const hasItems = list.length > 0;
    if (hasItems) {
        $w('#repeateradmin').show();
        $w('#paginationadmin').show();
        $w('#dropdownfilter').show();
        $w('#inputsearch').show();
        $w('#text50').hide();
    } else {
        $w('#repeateradmin').hide();
        $w('#paginationadmin').hide();
        $w('#dropdownfilter').hide();
        $w('#inputsearch').hide();
        $w('#text50').text = "You don't have refund item and feedback from tenant";
        $w('#text50').show();
    }
}

function bindAdminPagination() {
    $w('#paginationadmin').onChange((e) => {
        adminCurrentPage = e.target.currentPage;
        applyAdminFilterAndRender();
    });
}

function bindAdminRepeater() {
    $w('#repeateradmin').onItemReady(($item, item) => {
        const done = !!item.done;

        if (done) {
            $item('#boxcoloradmin').style.backgroundColor = '#00C851';
        } else {
            $item('#boxcoloradmin').style.backgroundColor = '#FF4444';
        }

        const roomName = item.room?.title_fld || item.room?.roomname || '';
        const tenantName = item.tenant?.fullname || '';
        if (item._type === 'PENDING_OPERATOR_AGREEMENT') {
            $item('#textadmindescription').text = `${roomName || item.property?.shortname || '—'} | ${tenantName || 'Owner'}`;
            $item('#buttonviewdetail').label = 'Sign Agreement';
            $item('#buttonviewdetail').onClick(() => openAgreementSectionForOperator(item));
            return;
        }
        if (item._type === 'REFUND') {
            $item('#textadmindescription').text = `Refund | ${roomName} - ${tenantName}`;
        } else if (/smart\s*door\s*battery\s*down/i.test(item.description || '')) {
            const propertyName = item.property?.shortname || '';
            $item('#textadmindescription').text = `${roomName || '—'} / ${propertyName || '—'} smart door battery low`;
        } else {
            $item('#textadmindescription').text = item.description || '';
        }

        $item('#buttonviewdetail').label = item._type === 'REFUND' ? 'More Detail' : 'View Detail';
        $item('#buttonviewdetail').onClick(() => {
            if (item._type === 'REFUND') {
                openRefundBox(item);
            } else {
                openDetailSection(item);
            }
        });
    });
}

/* =======================
   Operator agreement (Sign Agreement from repeateradmin)
   Opens #sectionagreement with #boxagreement, #signatureinputagreement, #htmlagreement, #buttonagree, #buttoncloseagreement.
======================= */
function renderOperatorAgreementHtml(templateHtml, variables = {}) {
    let html = templateHtml || '';
    const usedVars = [...html.matchAll(/{{\s*([\w]+)\s*}}/g)].map(m => m[1]);
    usedVars.forEach(key => {
        let value = variables[key];
        if (value === undefined || value === null) value = '';
        if (['sign', 'nricfront', 'nricback', 'operatorsign'].includes(key) && typeof value === 'string' && value.startsWith && value.startsWith('wix:image://')) {
            const m = value.match(/wix:image:\/\/v1\/([^/]+)/);
            value = m ? `<div style="margin-top:16px"><img src="https://static.wixstatic.com/media/${m[1]}" style="max-width:300px; border:1px solid #ccc;" /></div>` : '';
        }
        html = html.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value);
    });
    $w('#htmlagreement').postMessage({ type: 'render', html });
}

async function loadOperatorAgreementHtml(item) {
    if (!item || !item.agreement) return;
    const ag = item.agreement;
    const templateId = ag.agreementtemplate || ag.agreementtemplate_id;
    if (!templateId) return;
    const tplRes = await getAgreementTemplate({ templateId });
    const tpl = tplRes?.template;
    if (!tpl?.html) return;
    const staffVars = {
        staffname: accessCtx?.staff?.fullname || accessCtx?.staff?.ownername || 'Staff',
        staffnric: accessCtx?.staff?.nric || '',
        staffcontact: accessCtx?.staff?.mobilenumber || accessCtx?.staff?.phone || '',
        staffemail: accessCtx?.staff?.email || ''
    };
    let ctx;
    if (ag.mode === 'tenant_operator') {
        ctx = await getTenantAgreementContext(ag.tenancy, templateId, staffVars);
    } else {
        ctx = await getOwnerAgreementContext(ag.owner, ag.property, accessCtx?.client?.id || ag.client, templateId, staffVars);
    }
    if (!ctx?.ok || !ctx.variables) return;
    renderOperatorAgreementHtml(tpl.html, ctx.variables);
    $w('#boxagreement').show();
    $w('#signatureinputagreement').clear();
    $w('#buttonagree').enable();
}

async function openAgreementSectionForOperator(item) {
    currentOperatorAgreementItem = item;
    openedAgreementFromSection = activeSection || 'admin';
    await switchSectionAsync('agreement');
    await loadOperatorAgreementHtml(item);
}

/* =======================
   Section Property (tenancy list by property + status; open agreement from repeatertenancy)
======================= */
function formatRental(amount, currency) {
    if (amount == null) return '-';
    const c = String(currency || clientCurrency || 'MYR').toUpperCase();
    if (c === 'MYR') return `RM ${amount}`;
    if (c === 'SGD') return `SGD ${amount}`;
    return `${amount}`;
}

async function initPropertySection() {
    const filtersRes = await getTenancyFilters();
    const properties = filtersRes.properties || [];
    const statusOptions = filtersRes.statusOptions || [];
    const propOptions = properties.length ? properties : [{ label: 'All', value: 'ALL' }];
    const statusOpts = statusOptions.length ? statusOptions : [{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }];

    try {
        $w('#dropdownproperty').options = propOptions;
        $w('#dropdownproperty').value = 'ALL';
    } catch (_) {}
    try {
        $w('#dropdownstatus').options = statusOpts;
        $w('#dropdownstatus').value = 'true';
    } catch (_) {}

    const loadPropertyTenancyList = async () => {
        const propertyId = ($w('#dropdownproperty').value || 'ALL');
        const status = ($w('#dropdownstatus').value || 'true');
        const res = await getTenancyList({ propertyId: propertyId === 'all' ? 'ALL' : propertyId, status, limit: 500 });
        const items = Array.isArray(res.items) ? res.items : [];
        try {
            $w('#repeatertenancy').data = items;
        } catch (_) {}
    };

    try {
        $w('#dropdownproperty').onChange(() => loadPropertyTenancyList());
        $w('#dropdownstatus').onChange(() => loadPropertyTenancyList());
    } catch (_) {}
    await loadPropertyTenancyList();

    try {
        $w('#repeatertenancy').onItemReady(($item, tenancy) => {
            const prop = tenancy.property || tenancy.room?.property;
            $item('#texttitleproperty').text = prop?.shortname || '-';
            $item('#texttenantname').text = tenancy.tenant?.fullname || '-';
            const begin = tenancy.begin;
            const end = tenancy.end;
            if (begin && end) {
                const f = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                $item('#texttenancydate').text = `${f.format(new Date(begin))} - ${f.format(new Date(end))}`;
            } else {
                $item('#texttenancydate').text = '-';
            }
            $item('#textrental').text = formatRental(tenancy.rental);
            const agreements = tenancy.agreements || [];
            const withUrl = agreements.filter(a => a.url);
            const firstAgreementId = withUrl.length ? (withUrl[0]._id || withUrl[0].id) : null;
            const btn = $item('#buttontenanttenancy');
            if (firstAgreementId) {
                btn.enable();
                btn.onClick(async () => {
                    const res = await getAgreementForOperator({ agreementId: firstAgreementId });
                    if (res.ok && res.item) {
                        await openAgreementSectionForOperator(res.item);
                    }
                });
            } else {
                btn.disable();
            }
        });
    } catch (_) {}
}

function bindOperatorAgreementButtons() {
    $w('#buttoncloseagreement').onClick(() => {
        $w('#boxagreement').hide();
        switchSectionAsync(openedAgreementFromSection || 'admin');
    });
    $w('#buttoncloseproperty').onClick(() => {
        const target = activeSection === 'agreement' ? (openedAgreementFromSection || 'admin') : (lastSectionBeforeProperty || 'admin');
        switchSectionAsync(target);
    });
    $w('#buttonagree').onClick(async () => {
        if (agreementOperatorSubmitting || !currentOperatorAgreementItem) return;
        const signatureValue = $w('#signatureinputagreement').value || '';
        if (!signatureValue) return;
        agreementOperatorSubmitting = true;
        $w('#buttonagree').disable();
        $w('#buttonagree').label = 'Submitting...';
        try {
            const res = await signAgreementOperator({
                agreementId: currentOperatorAgreementItem.agreement._id,
                operatorsign: signatureValue
            });
            if (res && res.ok) {
                $w('#boxagreement').hide();
                currentOperatorAgreementItem = null;
                await loadAdminData();
                await switchSectionAsync(openedAgreementFromSection || 'admin');
            }
        } finally {
            agreementOperatorSubmitting = false;
            $w('#buttonagree').enable();
            $w('#buttonagree').label = 'Agree';
        }
    });
}

async function openRefundBox(item) {
    currentDetailItem = item;
    deleteConfirmId = null;

    const currency =
        String(item.client?.currency || 'MYR').toUpperCase();
    const fullAmount = Number(item.amount) || 0;
    const amountPlaceholder = fullAmount > 0 ? String(fullAmount) : '';

    const bankName = item.tenant?.bankName?.bankname || '';
    const bankAccount = item.tenant?.bankAccount || '';
    const accountholder = item.tenant?.accountholder || '';

    $w('#textrefund').text = `
Room: ${item.room?.title_fld || ''}
Tenant: ${item.tenant?.fullname || ''}
Amount: ${currency} ${item.amount}

Bank Detail:
${bankName}
${bankAccount}
${accountholder}
`.trim();

    // Refund amount: title "Refund amount", placeholder = full amount; client can edit but only <= amount (less = forfeit)
    if ($w('#inputrefundamount')) {
        $w('#inputrefundamount').value = amountPlaceholder;
        $w('#inputrefundamount').placeholder = amountPlaceholder;
    }

    $w('#boxrefund').show();
}

$w('#buttoncloserefund').onClick(() => {
    $w('#boxrefund').hide();
});

$w('#buttonmarkasrefund').onClick(async () => {
    if (!currentDetailItem) return;

    const fullAmount = Number(currentDetailItem.amount) || 0;
    let refundAmount = fullAmount;
    if ($w('#inputrefundamount') && $w('#inputrefundamount').value !== undefined) {
        const raw = $w('#inputrefundamount').value;
        if (raw !== '' && raw != null) {
            const num = Number(String(raw).replace(/,/g, '').trim());
            if (!Number.isFinite(num)) refundAmount = fullAmount;
            else if (num < 0 || num > fullAmount) refundAmount = Math.min(Math.max(0, num), fullAmount);
            else refundAmount = num;
        }
    }

    const payload = { id: currentDetailItem._id, done: true };
    if (refundAmount > 0) payload.refundAmount = refundAmount;

    const res = await updateRefundDeposit(payload);
    if (!res.ok) return;

    await loadAdminData();
    $w('#boxrefund').hide();
});

$w('#buttondeleterefund').onClick(async (e) => {
    if (!currentDetailItem) return;

    if (deleteConfirmId !== currentDetailItem._id) {
        deleteConfirmId = currentDetailItem._id;
        e.target.label = 'Confirm Delete';
        return;
    }

    const res = await removeRefundDeposit({ id: currentDetailItem._id });
    if (!res.ok) return;

    deleteConfirmId = null;
    await loadAdminData();
    $w('#boxrefund').hide();
});

async function openDetailSection(item) {
    currentDetailItem = item;
    deleteConfirmId = null;

    $w('#textdetaildescription').text = item.description || '';
    $w('#inputremark').value = item.remark || '';

    const photos = item.photo || [];
    const hasPhotos = Array.isArray(photos) && photos.length > 0;
    const hasVideo = !!(item.video && String(item.video).trim());
    const isBatteryFeedback = /smart\s*door\s*battery\s*down/i.test(item.description || '');

    $w('#photogallery').items = hasPhotos ? photos.map(p => ({ type: 'image', src: p.src || '' })) : [];
    $w('#videogallery').collapse();
    $w('#photogallery').collapse();

    if (isBatteryFeedback) {
        $w('#photogallery').collapse();
        $w('#videogallery').collapse();
    } else if (hasVideo) {
        $w('#photogallery').collapse();
        $w('#videogallery').src = item.video;
        $w('#videogallery').expand();
    } else if (hasPhotos) {
        $w('#photogallery').expand();
        $w('#videogallery').collapse();
    }

    await switchSectionAsync('detail');
}

$w('#buttonmarkascomplete').onClick(async () => {
    if (!currentDetailItem) return;

    const res = await updateFeedback({
        id: currentDetailItem._id,
        done: true,
        remark: $w('#inputremark').value
    });
    if (!res.ok) return;

    await loadAdminData();
    await switchSectionAsync('admin');
});

$w('#buttondeletedetail').onClick(async (e) => {
    if (!currentDetailItem) return;

    if (deleteConfirmId !== currentDetailItem._id) {
        deleteConfirmId = currentDetailItem._id;
        e.target.label = 'Confirm Delete';
        return;
    }

    const res = await removeFeedback({ id: currentDetailItem._id });
    if (!res.ok) return;

    deleteConfirmId = null;
    await loadAdminData();
    await switchSectionAsync('admin');
});
