/* =======================
   Agreement Setting – 前端 Wix + 后端 ECS Node (backend/saas/agreementsetting + topup)
   数据来自 MySQL agreementtemplate，不读 Wix CMS。
   列表仅用 inputlistagreement 搜索 + 分页（与旧代码一致，不增加 dropdown）。
   Topup 使用 backend/saas/topup：getMyBillingInfo、getCreditPlans、startNormalTopup。
   所需元素：sectionheader, sectiondefault, sectiontab（#buttonagreement 放在 section tab 内）,
   sectionagreementlist, sectionnewagreementtemplate, sectiontopup,
   buttonagreement, buttonnewagreement, buttontopup,
   inputlistagreement, repeaterlistagreement, paginationlistagreement,
   textlistviewagreement, buttontemplate, buttonfolder, buttondelete,
   inputagreementname, inputtemplateurl, inputfolderurl, dropdownmode, buttonsave, buttonclosenewagrement,
   textnotice, textproblem, boxproblem2, buttoncloseproblem2,
   textcurrentcredit, repeatertopup, buttoncheckout, buttontopupclose,
   text19, textstatusloading
======================= */

import wixLocation from 'wix-location';
import wixWindow from 'wix-window';
import { getAccessContext } from 'backend/access/manage';
import { getMyBillingInfo, getCreditPlans, startNormalTopup } from 'backend/saas/topup';
import { submitTicket } from 'backend/saas/help';
import {
    getAgreementList,
    createAgreement,
    updateAgreement,
    deleteAgreement,
    generateAgreementHtmlPreview
} from 'backend/saas/agreementsetting.jsw';

/* =======================
   let
======================= */
let accessCtx = null;
let activeSection = null;
let lastSectionBeforeTopup = 'agreementlist';
let topupInited = false;
let isEditMode = false;
let editingAgreementId = null;
let originalTemplateUrl = '';

let selectedTopupPlanId = null;
let selectedTopupPlanCache = null;

let topupRepeaterBound = false;
let topupCheckoutBound = false;
let topupCloseBound = false;
let agreementListEventsBound = false;

let sectionSwitchBound = false;
let defaultSectionCollapsed = false;

let clientCurrency = 'MYR';

/* =======================
   Agreement List State (cache + filter like expenses)
======================= */
let agreementListPageSize = 10;
let agreementListLoading = false;
let agreementCache = [];
let agreementCacheTotal = 0;
let useServerFilter = false;
let currentAgreementPage = 1;
const AGREEMENT_CACHE_LIMIT = 500;
let searchDebounceTimer = null;

/* =======================
   const
======================= */
const MAIN_SECTIONS = [
    'agreementlist',
    'newagreementtemplate',
    'topup'
];

/* =======================
   Button loading helper：点击时 disable + label Loading，await 完成后才 switch section 并恢复
======================= */
function withTabButtonLoading(buttonId, asyncFn) {
    return async () => {
        const btn = $w(buttonId);
        let originalLabel;
        try { originalLabel = btn.label; } catch (_) {}
        btn.disable();
        try { if (btn.label !== undefined) btn.label = 'Loading'; } catch (_) {}
        try {
            await asyncFn();
        } finally {
            btn.enable();
            try { if (originalLabel !== undefined && btn.label !== undefined) btn.label = originalLabel; } catch (_) {}
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
            MAIN_SECTIONS.forEach(k => safeCollapse($w(`#section${k}`)));
            safeExpand($w('#sectiondefault'));
            safeExpand($w('#sectionheader'));
            safeExpand($w('#sectionheader'));
        } catch (e) {}
    }
    applyMobileSections();
    setTimeout(applyMobileSections, 100);
    setTimeout(applyMobileSections, 400);
}

/* =======================
   onReady
======================= */
$w.onReady(() => {
    if (wixWindow.formFactor === "Mobile") {
        runMobileBranch();
        return;
    }
    console.log('[AGREEMENT] onReady');
    disableMainActions(); // buttonagreement + buttonnewagreement + buttontopup 一起 disable
    initDefaultSection();
    startInitAsync();
});

/* =======================
   init flow
======================= */
async function startInitAsync() {
    try {
        accessCtx = await getAccessContext();

        if (!accessCtx?.ok) {
            showAccessDenied(accessCtx.reason === 'NO_PERMISSION' ? "You don't have permission" : "You don't have account yet");
            return;
        }
        if (!accessCtx.staff?.permission?.propertylisting && !accessCtx.staff?.permission?.admin) {
            showAccessDenied("You don't have permission");
            return;
        }

        clientCurrency =
            String(accessCtx.client?.currency || 'MYR').toUpperCase();

        if (accessCtx.credit?.ok === false) {
            await enterForcedTopupMode();
            return;
        }

        bindSectionSwitch();
        bindTopupCloseButton();
        bindCloseNewAgreementButton();
        initDropdownMode();

        bindNewAgreementSave();
        bindProblemBoxClose();

        $w('#textstatusloading').hide();
        enableMainActions();
    } catch (err) {
        console.error('[AGREEMENT INIT FAILED]', err);
        showAccessDenied('Unable to verify account');
    }
}

/* =======================
   Section Switch
======================= */
function bindSectionSwitch() {
    if (sectionSwitchBound) return;
    sectionSwitchBound = true;

    $w('#buttonagreement').onClick(withTabButtonLoading('#buttonagreement', async () => {
        await enterAgreementListSection();
        collapseDefaultAndShowTab();
        await switchSectionAsync('agreementlist');
    }));

    $w('#buttonnewagreement').onClick(withTabButtonLoading('#buttonnewagreement', async () => {
        collapseDefaultAndShowTab();
        await switchSectionAsync('newagreementtemplate');
    }));

    $w('#buttontopup').onClick(withTabButtonLoading('#buttontopup', async () => {
        lastSectionBeforeTopup = activeSection || 'agreementlist';
        if (!topupInited) {
            await initTopupSection();
            topupInited = true;
        }
        collapseDefaultAndShowTab();
        await switchSectionAsync('topup');
    }));
}

async function switchSectionAsync(sectionKey) {
    if (activeSection === sectionKey) return;
    collapseAllSections();
    $w(`#section${sectionKey}`).expand();
    activeSection = sectionKey;
}

/* =======================
   Section Helpers
======================= */
function collapseAllSections() {
    MAIN_SECTIONS.forEach(k => {
        const sec = $w(`#section${k}`);
        sec?.collapse();
    });
}

function initDefaultSection() {
    $w('#sectionheader').expand();
    $w('#sectiondefault').expand();
    $w('#sectiontab').expand(); // sectiontab 一直 show & expand
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
    ['#buttonagreement', '#buttonnewagreement', '#buttontopup'].forEach(id => {
        $w(id)?.disable?.();
    });
}

function enableMainActions() {
    ['#buttonagreement', '#buttonnewagreement', '#buttontopup'].forEach(id => {
        $w(id)?.enable?.();
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
async function enterForcedTopupMode() {
    collapseAllSections();
    collapseDefaultAndShowTab();
    $w('#sectiontopup').expand();
    activeSection = 'topup';
}

/* =======================
   Topup Section (backend/saas/topup)
======================= */
async function initTopupSection() {
    const billing = await getMyBillingInfo();
    const credits = Array.isArray(billing.credit) ? billing.credit : [];
    const totalCredit =
        credits.reduce((s, c) => s + Number(c.amount || 0), 0);

    $w('#textcurrentcredit').text =
        `Current Credit Balance: ${totalCredit}`;

    const plans = await getCreditPlans();
    const items = Array.isArray(plans) ? plans : [];
    $w('#repeatertopup').data = items;

    if (!topupRepeaterBound) {
        $w('#repeatertopup').onItemReady(($item, plan) => {
            const pid = plan.id || plan._id;
            $item('#textamount').text =
                `${clientCurrency} ${plan.sellingprice ?? plan.credit ?? 0}`;
            $item('#textcreditamount').text = String(plan.credit ?? '');

            $item('#boxcolor').hide();

            $item('#containertopup').onClick(() => {
                selectedTopupPlanId = pid;
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
                Number(selectedTopupPlanCache.sellingprice ?? 0);

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
                    console.warn('[agreementsetting] submitTicket topup_manual failed', e);
                }
                return;
            }

            const res = await startNormalTopup({
                creditPlanId: selectedTopupPlanId,
                redirectUrl: wixLocation.url
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

    $w('#buttontopupclose').onClick(() => {
        if (accessCtx?.credit?.ok === false) return;
        $w('#sectiontopup').collapse();
        const target = lastSectionBeforeTopup || 'agreementlist';
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

function bindProblemBoxClose() {
    $w('#buttoncloseproblem2').onClick(() => {
        $w('#boxproblem2').hide();
    });
}

/* =======================
   Agreement List – cache + filter (like expenses)
======================= */
function getCurrentFilterOpts() {
    return {
        search: ($w('#inputlistagreement').value || '').trim(),
        sort: 'new'
    };
}

/** 首次进入列表或刷新：拉取 cache（limit）或仅 total */
async function fetchAndFillAgreementCache() {
    const opts = getCurrentFilterOpts();
    const res = await getAgreementList({
        sort: opts.sort,
        limit: AGREEMENT_CACHE_LIMIT
    });
    if (res && res.ok === false) {
        agreementCache = [];
        agreementCacheTotal = 0;
        useServerFilter = true;
        return;
    }
    const total = res?.total ?? 0;
    const items = res?.items ?? [];

    if (total <= AGREEMENT_CACHE_LIMIT) {
        agreementCache = items;
        agreementCacheTotal = total;
        useServerFilter = false;
    } else {
        agreementCache = [];
        agreementCacheTotal = total;
        useServerFilter = true;
    }
}

function resetAgreementListToFirstPage() {
    currentAgreementPage = 1;
    try {
        $w('#paginationlistagreement').currentPage = 1;
    } catch (_) {}
}

/** 前端：对 cache 按 search 过滤，排序，分页（与旧代码一致，无 mode 下拉） */
function applyFilterAndSortToCache() {
    const opts = getCurrentFilterOpts();
    let list = agreementCache;

    if (opts.search) {
        const s = opts.search.toLowerCase();
        list = list.filter(i => (i.title || '').toLowerCase().includes(s));
    }

    list = sortAgreements(list, opts.sort);
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / agreementListPageSize));
    const start = (currentAgreementPage - 1) * agreementListPageSize;
    const pageItems = list.slice(start, start + agreementListPageSize);

    $w('#paginationlistagreement').totalPages = totalPages;
    $w('#paginationlistagreement').currentPage = currentAgreementPage;
    $w('#repeaterlistagreement').data = pageItems;
}

function sortAgreements(items, sortKey) {
    const key = (sortKey || 'new').toLowerCase();
    const arr = [...items];
    const byDate = (a, b) => {
        const at = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
        return key === 'old' ? at - bt : bt - at;
    };
    if (key === 'old' || key === 'new') return arr.sort(byDate);
    if (key === 'az') return arr.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    if (key === 'za') return arr.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
    return arr.sort(byDate);
}

/** 根据 useServerFilter 走前端过滤或 server 分页 */
function applyFilterAndSort() {
    if (useServerFilter) {
        loadAgreementPageFromServer(currentAgreementPage);
        return;
    }
    applyFilterAndSortToCache();
}

/** Server 分页 */
async function loadAgreementPageFromServer(pageNumber) {
    currentAgreementPage = pageNumber;
    const opts = getCurrentFilterOpts();
    $w('#repeaterlistagreement').data = [];
    showSectionLoading('Loading...');

    const res = await getAgreementList({
        search: opts.search || undefined,
        sort: opts.sort,
        page: currentAgreementPage,
        pageSize: agreementListPageSize
    });

    hideSectionLoading();
    if (res && res.ok === false) {
        $w('#repeaterlistagreement').data = [];
        return;
    }
    const pageItems = res?.items ?? [];
    $w('#paginationlistagreement').totalPages = res?.totalPages ?? 1;
    $w('#paginationlistagreement').currentPage = res?.currentPage ?? 1;
    $w('#repeaterlistagreement').data = pageItems;
}

/* =======================
   Init Agreement List Section
======================= */
async function initAgreementListSectionFirstTime() {
    if (agreementListLoading) return;
    agreementListLoading = true;

    showSectionLoading('Loading...');
    bindAgreementRepeater();
    await fetchAndFillAgreementCache();
    applyFilterAndSort();
    hideSectionLoading();

    agreementListLoading = false;
}

async function enterAgreementListSection() {
    try {
        $w('#inputlistagreement').value = '';
    } catch (_) {}

    bindAgreementListEvents();
    await initAgreementListSectionFirstTime();
}

function modeToLabel(mode) {
    if (!mode) return '';
    const map = { owner_tenant: 'Owner & Tenant', owner_operator: 'Owner & Operator', tenant_operator: 'Tenant & Operator' };
    return map[mode] || mode;
}

/* =======================
   Repeater
======================= */
function bindAgreementRepeater() {
    $w('#repeaterlistagreement').onItemReady(($item, agreement) => {
        const id = agreement.id || agreement._id;
        const title = agreement.title || '';
        const modeLabel = modeToLabel(agreement.mode);
        $item('#textlistviewagreement').text = modeLabel ? `${title} | ${modeLabel}` : title;

        if (agreement.templateurl) {
            $item('#buttontemplate').enable();
            $item('#buttontemplate').onClick(() => wixLocation.to(agreement.templateurl));
        } else {
            $item('#buttontemplate').disable();
        }
        if (agreement.folderurl) {
            $item('#buttonfolder').enable();
            $item('#buttonfolder').onClick(() => wixLocation.to(agreement.folderurl));
        } else {
            $item('#buttonfolder').disable();
        }

        let confirmDelete = false;
        $item('#buttondelete').label = 'Delete';

        $item('#buttondelete').onClick(async () => {
            if (!confirmDelete) {
                confirmDelete = true;
                $item('#buttondelete').label = 'Confirm Delete';
                return;
            }

            $item('#buttondelete').disable();
            $item('#buttondelete').label = 'Deleting...';

            const id = agreement.id || agreement._id;
            const delRes = await deleteAgreement(id);

            if (delRes && delRes.deleted) {
                if (!useServerFilter) {
                    agreementCache = agreementCache.filter(i => (i.id || i._id) !== id);
                    agreementCacheTotal = Math.max(0, agreementCacheTotal - 1);
                } else {
                    await fetchAndFillAgreementCache();
                }
                applyFilterAndSort();
            } else {
                $item('#buttondelete').label = 'Delete';
                confirmDelete = false;
                showNotice('Failed to delete agreement template');
            }
        });
    });
}

/* =======================
   Search / Pagination / Filter events
======================= */
function bindAgreementListEvents() {
    if (agreementListEventsBound) return;
    agreementListEventsBound = true;

    try {
        $w('#inputlistagreement').onInput(() => {
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                searchDebounceTimer = null;
                resetAgreementListToFirstPage();
                applyFilterAndSort();
            }, 300);
        });
    } catch (_) {}

    try {
        $w('#paginationlistagreement').onChange(e => {
            const page = e.target?.currentPage ?? 1;
            if (useServerFilter) {
                loadAgreementPageFromServer(page);
            } else {
                currentAgreementPage = page;
                applyFilterAndSortToCache();
            }
        });
    } catch (_) {}
}

/* =======================
   New Agreement Template
======================= */
function resetNewAgreementForm() {
    $w('#inputagreementname').value = '';
    $w('#inputtemplateurl').value = '';
    $w('#inputfolderurl').value = '';
    try {
        $w('#dropdownmode').value = undefined;
    } catch (_) {}
}

/* =======================
   Save Agreement Template
======================= */
function bindNewAgreementSave() {
    $w('#buttonsave').onClick(async () => {
        const btn = $w('#buttonsave');
        btn.disable();

        try {
            const title = ($w('#inputagreementname').value || '').trim();
            let templateurl = ($w('#inputtemplateurl').value || '').trim();
            let folderurl = ($w('#inputfolderurl').value || '').trim();
            const mode = $w('#dropdownmode').value;

            templateurl = normalizeUrl(templateurl);
            folderurl = normalizeUrl(folderurl);

            if (!title) throw new Error('Agreement name is required');
            if (!mode) throw new Error('Mode is required');
            if (!templateurl) throw new Error('Template URL is required');
            if (!isStrictGoogleDoc(templateurl)) {
                throw new Error('Template must be a valid Google Docs document link');
            }

            if (isEditMode && editingAgreementId) {
                const needRegenHtml = templateurl !== originalTemplateUrl;

                await updateAgreement(editingAgreementId, {
                    title,
                    templateurl,
                    folderurl,
                    mode
                });

                if (needRegenHtml) {
                    generateAgreementHtmlPreview(editingAgreementId)
                        .catch(err => console.error('[HTML REGEN FAILED]', err));
                }
            } else {
                const inserted = await createAgreement({
                    title,
                    templateurl,
                    folderurl,
                    mode
                });

                if (inserted && inserted.id) {
                    generateAgreementHtmlPreview(inserted.id)
                        .catch(err => console.error('[HTML GEN FAILED]', err));
                }
            }

            resetNewAgreementForm();
            isEditMode = false;
            editingAgreementId = null;
            originalTemplateUrl = '';

            showSectionLoading('Saving...');
            await switchSectionAsync('agreementlist');
            await fetchAndFillAgreementCache();
            applyFilterAndSort();
            hideSectionLoading();
        } catch (err) {
            console.error('[AGREEMENT SAVE FAILED]', err);
            showNotice(err.message || 'Failed to save agreement template');
        } finally {
            btn.enable();
        }
    });
}

function collapseDefaultAndShowTab() {
    if (defaultSectionCollapsed) return;
    $w('#sectiondefault').collapse();
    $w('#sectiontab').expand();
    defaultSectionCollapsed = true;
}

function normalizeUrl(url) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    return `https://${url}`;
}

function bindCloseNewAgreementButton() {
    $w('#buttonclosenewagrement').onClick(async () => {
        isEditMode = false;
        editingAgreementId = null;
        originalTemplateUrl = '';
        resetNewAgreementForm();
        showSectionLoading('Loading...');
        await switchSectionAsync('agreementlist');
        await fetchAndFillAgreementCache();
        applyFilterAndSort();
        hideSectionLoading();
    });
}

function isStrictGoogleDoc(url) {
    if (!url) return false;
    if (!url.startsWith('https://')) return false;
    if (!/^https:\/\/docs\.google\.com\/document\/d\/[a-zA-Z0-9-_]{20,}/i.test(url)) {
        return false;
    }
    return true;
}

function initDropdownMode() {
    $w('#dropdownmode').options = [
        { label: 'Owner & Tenant', value: 'owner_tenant' },
        { label: 'Owner & Operator', value: 'owner_operator' },
        { label: 'Tenant & Operator', value: 'tenant_operator' }
    ];
    $w('#dropdownmode').placeholder = 'Select Agreement Mode';
}

function showNotice(message) {
    $w('#textnotice').text = message;
    $w('#textnotice').show();
}

function hideNotice() {
    $w('#textnotice').hide();
}
