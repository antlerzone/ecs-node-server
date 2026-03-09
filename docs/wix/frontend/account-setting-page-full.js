/* ======================================================
   Account Setting 页面（仅此页）
   数据通过 backend/saas/billing.jsw + backend/saas/account.jsw 请求 ECS Node，不读 Wix CMS。
   - 本页含：Topup 区块 + Account 区块（#sectiontab 内 #buttontopup、#buttonaccount）
   - Billing 页面是另一页，见 billing-page-full.js
   - #repeateraccount 表格：每行需有 #textaccounttitle, #textaccountid, #buttonedit；可选 #textaccounttype（Type 列）
   - 后端 account 表：每行 = 一个 account 模板（default item）；account_json 列 = 各 client 的映射数组
     [{ clientId, system, accountid, productId }, ...]。保存时 UPDATE account SET account_json = ? WHERE id = ?
====================================================== */

import wixLocation from 'wix-location';
import wixWindow from 'wix-window';
import { getAccessContext, getMyBillingInfo, getCreditPlans, startNormalTopup } from 'backend/saas/billing';
import { submitTicket } from 'backend/saas/help';
import { resolveAccountSystem, getAccountList, getAccountById, saveBukkuAccount, syncBukkuAccounts } from 'backend/saas/account';

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
let accountSectionBound = false;
let defaultSectionCollapsed = false;
let clientCurrency = 'MYR';
let accountAllItems = [];
let accountFilteredItems = [];
let accountSearchTimer = null;
const ACCOUNT_PAGE_SIZE = 10;
let accountDetailMode = null;
let accountDetailItem = null;
let previousSection = 'account';

/* =======================
   const
======================= */
const MAIN_SECTIONS = ['topup', 'accountdetail', 'account'];

const sectionLoaded = { topup: false, account: false };

const PROTECTED_BUKKUID_IDS = [
    'bf502145-6ec8-45bd-a703-13c810cfe186', '1c7e41b6-9d57-4c03-8122-a76baad3b592',
    'ae94f899-7f34-4aba-b6ee-39b97496e2a3', '18ba3daf-7208-46fc-8e97-43f34e898401',
    '86da59c0-992c-4e40-8efd-9d6d793eaf6a', '94b4e060-3999-4c76-8189-f969615c0a7d',
    'cf4141b1-c24e-4fc1-930e-cfea4329b178', 'e4fd92bb-de15-4ca0-9c6b-05e410815c58',
    'bdf3b91c-d2ca-4e42-8cc7-a5f19f271e00', '620b2d43-4b3a-448f-8a5b-99eb2c3209c7',
    'd3f72d51-c791-4ef0-aeec-3ed1134e5c86', '3411c69c-bfec-4d35-a6b9-27929f9d5bf6',
    'e053b254-5a3c-4b82-8ba0-fd6d0df231d3',
    '26a35506-0631-4d79-9b4f-a8195b69c8ed', 'd553cdbe-bc6b-46c2-aba8-f71aceedaf10'
];

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
    disableMainActions();
    initDefaultSection();
    $w('#textstatusloading').text = 'Loading...';
    $w('#textstatusloading').show();
    startInitAsync();
});

/* =======================
   init flow
======================= */
async function startInitAsync() {
    accessCtx = await getAccessContext();

    if (!accessCtx.ok) {
        showAccessDenied(accessCtx.reason === 'NO_PERMISSION' ? "You don't have permission" : "You don't have account yet");
        return;
    }
    if (!accessCtx.staff?.permission?.integration && !accessCtx.staff?.permission?.billing && !accessCtx.staff?.permission?.admin) {
        showAccessDenied("You don't have permission");
        return;
    }

    clientCurrency = String(accessCtx.client?.currency || 'MYR').toUpperCase();

    // 尽早绑定 Tab 按钮，保证点击能先切换 section
    bindSectionSwitch();
    bindAccountSection();

    if (accessCtx.credit?.ok === false) {
        await enterForcedTopupModeManage();
        $w('#textstatusloading').hide();
        enableMainActions();
        return;
    }

    if (!accessCtx?.capability?.accounting) {
        disableAccountSection('Your plan does not include Accounting feature.');
        $w('#textstatusloading').hide();
        enableMainActions();
        return;
    }

    const accountRes = await resolveAccountSystem(accessCtx.client.id);

    if (!accountRes.ok) {
        disableAccountSection('Please setup accounting integration first.');
        $w('#textstatusloading').hide();
        enableMainActions();
        return;
    }

    if (!accountRes.provider) {
        disableAccountSection('Please setup account integration first');
        $w('#textstatusloading').hide();
        enableMainActions();
        return;
    }

    accessCtx.accountSystem = accountRes.provider;
    accessCtx.accountIntegration = accountRes.integration?.values || {};

    bindSyncAccountButton();
    bindTopupCloseButton();
    bindProblemBoxClose();

    $w('#textstatusloading').hide();
    enableMainActions();
}

function disableAccountSection(message) {
    collapseAllSections();
    $w('#sectiondefault').expand();
    const sectiontab = $w('#sectiontab');
    if (sectiontab) sectiontab.expand();
    activeSection = null;
    $w('#buttonaccount').disable();
    $w('#textstatusloading').text = message;
    $w('#textstatusloading').show();
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

/** 尝试展开 section，兼容 Wix 里 ID 为 sectionaccount 或 sectionAccount 等 */
function expandSection(sectionKey) {
    const idLower = `section${sectionKey}`;
    const idCamel = `section${sectionKey.charAt(0).toUpperCase()}${sectionKey.slice(1)}`;
    let el = $w(`#${idLower}`);
    if (el && typeof el.expand === 'function') {
        el.expand();
        return true;
    }
    el = $w(`#${idCamel}`);
    if (el && typeof el.expand === 'function') {
        el.expand();
        return true;
    }
    return false;
}

/** 尝试折叠 section */
function collapseSection(sectionKey) {
    const idLower = `section${sectionKey}`;
    const idCamel = `section${sectionKey.charAt(0).toUpperCase()}${sectionKey.slice(1)}`;
    let el = $w(`#${idLower}`);
    if (el && typeof el.collapse === 'function') el.collapse();
    el = $w(`#${idCamel}`);
    if (el && typeof el.collapse === 'function') el.collapse();
}

async function switchSectionAsync(sectionKey) {
    if (activeSection === sectionKey) return;
    collapseAllSections();
    if (!defaultSectionCollapsed) {
        const def = $w('#sectiondefault');
        if (def && typeof def.collapse === 'function') {
            def.collapse();
            defaultSectionCollapsed = true;
        }
    }
    expandSection(sectionKey);
    activeSection = sectionKey;
    const sectiontab = $w('#sectiontab');
    if (sectiontab && typeof sectiontab.expand === 'function') sectiontab.expand();
}

function collapseAllSections() {
    MAIN_SECTIONS.forEach(k => collapseSection(k));
}

function initDefaultSection() {
    $w('#sectionheader').expand();
    $w('#sectiondefault').expand();
    const sectiontab = $w('#sectiontab');
    if (sectiontab) sectiontab.expand();
    collapseAllSections();
}

function showSectionLoading(text = 'Loading...') {
    $w('#text19').text = text;
    $w('#text19').show();
}

function hideSectionLoading() {
    $w('#text19').hide();
}

function disableMainActions() {
    ['#buttontopup', '#buttonaccount'].forEach(id => {
        const el = $w(id);
        el?.disable?.();
    });
}

function enableMainActions() {
    ['#buttontopup', '#buttonaccount'].forEach(id => {
        const el = $w(id);
        el?.enable?.();
    });
}

function showAccessDenied(message) {
    initDefaultSection();
    $w('#textstatusloading').text = message;
    $w('#textstatusloading').show();
    disableMainActions();
}

async function enterForcedTopupModeManage() {
    collapseAllSections();
    expandSection('topup');
    activeSection = 'topup';
    defaultSectionCollapsed = true;
}

/* =======================
   Topup Section（本页上的 Topup，数据来自 Node getCreditPlans）
======================= */
async function initTopupSection() {
    const billing = await getMyBillingInfo();
    const credits = Array.isArray(billing.credit) ? billing.credit : [];
    const totalCredit = credits.reduce((s, c) => s + Number(c.amount || 0), 0);
    $w('#textcurrentcredit').text = `Current Credit Balance: ${totalCredit}`;

    const plans = await getCreditPlans();
    $w('#repeatertopup').data = Array.isArray(plans) ? plans : [];

    if (!topupRepeaterBound) {
        $w('#repeatertopup').onItemReady(($item, plan) => {
            $item('#textamount').text = `${clientCurrency} ${plan.sellingprice}`;
            $item('#textcreditamount').text = String(plan.credit);
            $item('#boxcolor').hide();
            $item('#containertopup').onClick(() => {
                selectedTopupPlanId = plan._id || plan.id;
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
                        clientId: accessCtx?.client?.id || undefined
                    });
                } catch (e) {
                    console.warn('[account-setting] submitTicket topup_manual failed', e);
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

function bindTopupCloseButton() {
    if (topupCloseBound) return;
    topupCloseBound = true;
    $w('#buttontopupclose').onClick(async () => {
        if (accessCtx?.credit?.ok === false) return;
        collapseSection('topup');
        const target = lastSectionBeforeTopup || 'profile';
        expandSection(target);
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

function bindProblemBoxClose() {
    $w('#buttoncloseproblem2').onClick(() => $w('#boxproblem2').hide());
}

/* =======================
   Account Section（数据来自 Node getAccountList）
======================= */
function bindAccountSection() {
    if (accountSectionBound) return;
    accountSectionBound = true;
    const btn = $w('#buttonaccount');
    if (!btn) return;
    btn.onClick(async () => {
        // 先显示 Loading...，等数据加载完成后再切换 section
        showSectionLoading('Loading...');

        if (!accessCtx?.capability?.accounting) {
            showSectionLoading('You don\'t have permission');
            return;
        }

        const provider = accessCtx.accountSystem;
        if (!provider) {
            showSectionLoading('Please setup account integration first');
            return;
        }

        if (!sectionLoaded.account) {
            sectionLoaded.account = true;
            if (provider === 'xero') initxeroAccountSetting(accessCtx.accountIntegration);
            if (provider === 'bukku') initBukkuAccountSetting(accessCtx.accountIntegration);
            await initAccountList();
        }

        await switchSectionAsync('account');
        hideSectionLoading();
    });
}

function initxeroAccountSetting(integration) {
    // 在这里用 integration.values
}

function initBukkuAccountSetting(integration) {
    // 在这里用 integration.values
}

async function initAccountList() {
    showSectionLoading('Loading accounts...');

    const res = await getAccountList();
    if (!res.ok) {
        showSectionLoading('Failed to load accounts');
        return;
    }

    const items = res.items || [];
    accountAllItems = items.map(item => ({
        ...item,
        _myAccount: item._myAccount || null,
        _protected: PROTECTED_BUKKUID_IDS.includes(item._id || item.id)
    }));
    accountFilteredItems = [...accountAllItems];

    bindAccountSearch();
    bindAccountDropdownFilter();
    setupAccountDropdownOptions();
    initAccountPagination();

    if (items.length === 0) {
        const msg = $w('#text19');
        if (msg) {
            msg.text = 'No account templates. Run "Sync Account" to create from Bukku, or import bukkuid.csv to account table (see docs).';
            msg.show();
        }
    }

    hideSectionLoading();
}

function bindAccountRepeater(items) {
    $w('#repeateraccount').data = items;
    $w('#repeateraccount').onItemReady(($item, data) => {
        const typeRaw = String(data.type || '').toLowerCase();
        const typeLabel = typeRaw.charAt(0).toUpperCase() + typeRaw.slice(1);
        // Table 列：Title | Type | Account ID | 操作
        $item('#textaccounttitle').text = data.title ? String(data.title) : '-';
        if ($item('#textaccounttype')) $item('#textaccounttype').text = typeLabel;
        if (data._myAccount) {
            $item('#textaccountid').text = data._myAccount.accountid ? String(data._myAccount.accountid) : '-';
            $item('#textaccountid').style.color = '#000000';
        } else {
            $item('#textaccountid').text = 'Not set';
            $item('#textaccountid').style.color = '#d9534f';
        }
        const editBtn = $item('#buttonedit');
        const defaultEditLabel = (editBtn.label != null && editBtn.label !== '') ? String(editBtn.label) : 'Edit';
        editBtn.onClick(async () => {
            editBtn.disable();
            editBtn.label = 'Loading...';
            try {
                await openAccountDetail(data);
            } finally {
                editBtn.enable();
                editBtn.label = defaultEditLabel;
            }
        });
    });
}

async function openAccountDetail(data) {
    accountDetailMode = 'update';
    previousSection = 'account';

    const res = await getAccountById(data._id || data.id);
    if (!res.ok) {
        showSectionLoading('Failed to load account');
        return;
    }
    const freshItem = res.item;
    accountDetailItem = {
        ...freshItem,
        _myAccount: freshItem._myAccount || null,
        _protected: PROTECTED_BUKKUID_IDS.includes(freshItem._id || freshItem.id)
    };
    openAccountDetailSection();
}

function bindAccountSearch() {
    $w('#inputaccountsearch').onInput(() => {
        if (accountSearchTimer) clearTimeout(accountSearchTimer);
        accountSearchTimer = setTimeout(() => applyAccountFilter(), 300);
    });
}

function bindAccountDropdownFilter() {
    $w('#dropdownfilteraccount').onChange(() => applyAccountFilter());
}

function applyAccountFilter() {
    const keyword = ($w('#inputaccountsearch').value || '').trim().toLowerCase();
    const filterVal = String($w('#dropdownfilteraccount').value || '').toLowerCase();
    let list = [...accountAllItems];

    if (keyword) {
        list = list.filter(item => {
            const title = String(item.title || '').toLowerCase();
            const type = String(item.type || '').toLowerCase();
            return title.includes(keyword) || type.includes(keyword);
        });
    }

    if (filterVal === 'az') {
        list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
    } else if (filterVal === 'za') {
        list.sort((a, b) => String(b.title || '').localeCompare(String(a.title || '')));
    } else if (['asset', 'liability', 'liabilities', 'income', 'expenses', 'product'].includes(filterVal)) {
        list = list.filter(item => String(item.type || '').toLowerCase() === filterVal);
    }

    accountFilteredItems = list;
    initAccountPagination();
}

let paginationBound = false;

function initAccountPagination() {
    const totalPages = Math.max(1, Math.ceil(accountFilteredItems.length / ACCOUNT_PAGE_SIZE));
    $w('#paginationaccount').totalPages = totalPages;
    $w('#paginationaccount').currentPage = 1;
    renderAccountPage(1);
    if (!paginationBound) {
        $w('#paginationaccount').onChange(event => renderAccountPage(event.target.currentPage));
        paginationBound = true;
    }
}

function renderAccountPage(page) {
    const start = (page - 1) * ACCOUNT_PAGE_SIZE;
    const end = start + ACCOUNT_PAGE_SIZE;
    bindAccountRepeater(accountFilteredItems.slice(start, end));
}

function setupAccountDropdownOptions() {
    $w('#dropdownfilteraccount').options = [
        { label: 'All', value: '' },
        { label: 'A → Z', value: 'az' },
        { label: 'Z → A', value: 'za' },
        { label: 'Asset', value: 'asset' },
        { label: 'Liability', value: 'liability' },
        { label: 'Income', value: 'income' },
        { label: 'Expenses', value: 'expenses' },
        { label: 'Product', value: 'product' }
    ];
    $w('#dropdownfilteraccount').value = '';
}

function openAccountDetailSection() {
    collapseAllSections();
    expandSection('accountdetail');
    activeSection = 'accountdetail';

    if (accountDetailMode === 'create') {
        $w('#texttitleaccountdetail').text = 'Create new Account';
        $w('#buttonsave').label = 'Create';
    } else {
        $w('#texttitleaccountdetail').text = 'Update Account';
        $w('#buttonsave').label = 'Update';
    }

    const systemLabel = String(accessCtx.accountSystem || '').toLowerCase();
    const systemName = systemLabel.charAt(0).toUpperCase() + systemLabel.slice(1);
    $w('#textaccountsystem').text = `Account: ${systemName}`;

    initAccountDetailForm();
    bindAccountDetailButtons();
}

function initAccountDetailForm() {
    $w('#inputname').value = '';
    $w('#inputaccountid').value = '';
    $w('#inputproductid').value = '';
    $w('#inputaccounttype').value = '';
    $w('#inputproductid').hide();

    if (accountDetailMode === 'create') {
        $w('#inputname').enable();
        $w('#inputaccountid').enable();
        $w('#inputaccounttype').disable();
        return;
    }

    const item = accountDetailItem;
    $w('#inputname').value = item.title ? String(item.title) : '';
    $w('#inputaccounttype').value = item.bukkuaccounttype ? String(item.bukkuaccounttype) : '';
    $w('#inputaccounttype').disable();

    if (item._myAccount) {
        $w('#inputaccountid').value = String(item._myAccount.accountid || '');
    }

    const hasType = item.type !== undefined && item.type !== null && String(item.type).trim() !== '';
    if (hasType) {
        $w('#inputproductid').show();
        if (item._myAccount) $w('#inputproductid').value = String(item._myAccount.productId || '');
    } else {
        $w('#inputproductid').hide();
    }

    if (item._protected) $w('#inputname').disable();
    else $w('#inputname').enable();
}

let accountDetailButtonsBound = false;

function bindAccountDetailButtons() {
    if (accountDetailButtonsBound) return;
    accountDetailButtonsBound = true;

    $w('#buttoncloseaccountdetail').onClick(() => {
        collapseAllSections();
        expandSection('account');
        activeSection = previousSection;
    });

    $w('#buttonsave').onClick(async () => handleSaveAccountDetail());
}

async function handleSaveAccountDetail() {
    $w('#buttonsave').disable();
    try {
        const accountId = $w('#inputaccountid').value.trim();
        const productId = $w('#inputproductid').value.trim();
        if (!accountId) return;
        if (accountDetailMode !== 'update') return;

        await saveBukkuAccount({
            item: accountDetailItem,
            clientId: accessCtx.client.id,
            system: accessCtx.accountSystem,
            accountId,
            productId
        });

        collapseAllSections();
        expandSection('account');
        activeSection = 'account';
        await initAccountList();
    } finally {
        $w('#buttonsave').enable();
    }
}

function bindSyncAccountButton() {
    $w('#buttonsyncaccount').onClick(async () => {
        if (!accessCtx?.accountSystem) {
            showSectionLoading('No accounting integration found');
            return;
        }
        const provider = (accessCtx.accountSystem || '').toLowerCase();
        const providerLabel = { xero: 'Xero', bukku: 'Bukku', autocount: 'AutoCount', sql: 'SQL Account' }[provider] || provider;

        const btn = $w('#buttonsyncaccount');
        btn.disable();
        btn.label = 'Syncing...';
        showSectionLoading(`Syncing ${providerLabel} accounts...`);

        try {
            const result = await syncBukkuAccounts({ clientId: accessCtx.client.id });
            if (!result?.ok) {
                const msg = result?.message || result?.reason || 'Sync failed';
                showSectionLoading(msg);
                return;
            }
            await initAccountList();
            showSectionLoading(
                `Sync completed.\nAccounts Created: ${result.createdAccounts ?? 0}\nAccounts Linked: ${result.linkedAccounts ?? 0}\nProducts Created: ${result.createdProducts ?? 0}\nProducts Linked: ${result.linkedProducts ?? 0}`
            );
            setTimeout(() => hideSectionLoading(), 2000);
        } catch (err) {
            showSectionLoading('Unexpected error');
        } finally {
            btn.enable();
            btn.label = 'Sync Account';
        }
    });
}
