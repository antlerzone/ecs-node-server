/* ======================================================
   Manual Billing 頁（SaaS 平台手動開戶／續費）
   - 資料全部從 ECS 取得，不讀 Wix CMS（不用 wix-data）。
   - backend/saas/manualbilling：getClients、getPlans、manualTopup、manualRenew。
   - #sectiontab：一直 expand & show，內有 #buttonclient / #buttondashboard / #buttoncredit / #buttonpricingplan 切換區塊。
   - #buttonclient → #sectionclient（預設）；#buttondashboard → #sectiondashboard；#buttoncredit → #sectiontopup；#buttonpricingplan → #section1。#sectiondetail 一併 hide/collapse。
   - #sectionclient：內有 #repeaterclient（每項 #textclient、#textpricingplan、#textexpireddate 綁 item.title、item.planTitle、item.expiredStr；三者無 label，僅顯示綁定值）。
   - #section1：pricing plan（renew/create）；#datepicker1 = 顧客支付日期。
   - #repeaterpending（在 sectiondashboard）：顯示待處理工單（mode=billing_manual / topup_manual），每筆含 mode, description, ticketid, _createdDate, clientTitle。
   - 元素：#dropdownclient, #dropdownclient2, #dropdownpricingplan, #datepicker1, #datepicker2,
     #inputcredit, #texttitleboxprofile, #buttonsubmitpricingplan, #buttonsubmittopup
====================================================== */

import { getClients, getPlans, getPendingTickets, manualTopup, manualRenew } from 'backend/saas/manualbilling';

let clientMap = {};
let pricingPlanMap = {};

const SECTION_IDS = ['#sectionclient', '#sectiondashboard', '#sectiontopup', '#section1', '#sectiondetail'];

$w.onReady(async () => {
    initSectionTab();
    await Promise.all([
        initClients(),
        initPricingPlans(),
        initRepeaterPending()
    ]);
    bindPricingPlanSubmit();
    bindTopupSubmit();
    updateSubmitPricingPlanLabel();
});

function initSectionTab() {
    const sectiontab = $w('#sectiontab');
    if (sectiontab) {
        sectiontab.expand();
        sectiontab.show();
    }
    if ($w('#buttonclient')) {
        $w('#buttonclient').onClick(() => showSection('sectionclient'));
    }
    if ($w('#buttondashboard')) {
        $w('#buttondashboard').onClick(() => showSection('sectiondashboard'));
    }
    if ($w('#buttoncredit')) {
        $w('#buttoncredit').onClick(() => showSection('sectiontopup'));
    }
    if ($w('#buttonpricingplan')) {
        $w('#buttonpricingplan').onClick(() => showSection('section1'));
    }
    showSection('sectionclient');
}

function showSection(sectionId) {
    SECTION_IDS.forEach((id) => {
        const el = $w(id);
        if (!el) return;
        if (el.id === sectionId) {
            el.show();
            if (el.expand) el.expand();
        } else {
            el.hide();
            if (el.collapse) el.collapse();
        }
    });
}

async function initRepeaterPending() {
    const repeater = $w('#repeaterpending');
    if (!repeater) return;
    const { items } = await getPendingTickets();
    repeater.data = items;
}

async function initClients() {
    const { items } = await getClients();
    clientMap = {};
    items.forEach((c) => { clientMap[c.id] = c; });

    const sorted = items
        .slice()
        .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
    const options = sorted.map((c) => ({ label: c.title || c.id, value: c.id }));

    $w('#dropdownclient').options = options;
    $w('#dropdownclient2').options = options;

    if ($w('#repeaterclient')) {
        $w('#repeaterclient').onItemReady(($item, itemData) => {
            $item('#textclient').text = itemData.title || '';
            $item('#textpricingplan').text = itemData.planTitle || '';
            $item('#textexpireddate').text = itemData.expiredStr || '';
        });
        $w('#repeaterclient').data = sorted;
    }

    $w('#dropdownclient').onChange(() => updateSubmitPricingPlanLabel());
}

async function initPricingPlans() {
    const plans = await getPlans();
    pricingPlanMap = {};
    plans.forEach((p) => { pricingPlanMap[p.id] = p; pricingPlanMap[p._id] = p; });

    $w('#dropdownpricingplan').options = plans.map((p) => ({
        label: p.title,
        value: p.id || p._id
    }));

    $w('#dropdownpricingplan').onChange(() => {
        const planId = $w('#dropdownpricingplan').value;
        const plan = pricingPlanMap[planId];
        if (!plan) {
            if ($w('#texttitleboxprofile')) $w('#texttitleboxprofile').text = '';
            return;
        }
        const currency = String(plan.currency || '').toUpperCase() === 'SGD' ? 'SGD' : 'RM';
        let text = '';
        if (plan.description) text += `${plan.description}\n\n`;
        text += `Credit: ${plan.corecredit != null ? plan.corecredit : '-'}\n`;
        text += `Price: ${currency} ${plan.sellingprice != null ? plan.sellingprice : '-'}\n\n`;
        if (Array.isArray(plan.addon) && plan.addon.length > 0) {
            plan.addon.forEach((a) => {
                if (typeof a === 'string') text += `• ${a}\n`;
                else if (a && typeof a === 'object') text += `• ${a.title || a.name || ''}\n`;
            });
        }
        if ($w('#texttitleboxprofile')) $w('#texttitleboxprofile').text = text.trim();
    });
}

function updateSubmitPricingPlanLabel() {
    const clientId = $w('#dropdownclient').value;
    const client = clientId ? clientMap[clientId] : null;
    const label = client && client.hasPlan ? 'Renew' : 'Create';
    if ($w('#buttonsubmitpricingplan')) $w('#buttonsubmitpricingplan').label = label;
}

function bindTopupSubmit() {
    $w('#buttonsubmittopup').onClick(async () => {
        const clientId = $w('#dropdownclient2').value;
        const amount = Number($w('#inputcredit').value);
        const paidDate = $w('#datepicker2').value;

        if (!clientId || !amount || amount <= 0 || !paidDate) return;

        $w('#buttonsubmittopup').disable();
        try {
            await manualTopup({
                clientId,
                amount,
                paidDate: formatPaidDate(paidDate)
            });
            resetDropdown($w('#dropdownclient2'));
            $w('#inputcredit').value = '';
            $w('#datepicker2').value = null;
        } catch (e) {
            console.error('[MANUAL TOPUP FAILED]', e);
        } finally {
            $w('#buttonsubmittopup').enable();
        }
    });
}

function bindPricingPlanSubmit() {
    $w('#buttonsubmitpricingplan').onClick(async () => {
        const clientId = $w('#dropdownclient').value;
        const planId = $w('#dropdownpricingplan').value;
        const paidDate = $w('#datepicker1').value;

        if (!clientId || !planId || !paidDate) return;

        $w('#buttonsubmitpricingplan').disable();
        try {
            await manualRenew({
                clientId,
                planId,
                paidDate: formatPaidDate(paidDate)
            });
            resetDropdown($w('#dropdownclient'));
            resetDropdown($w('#dropdownpricingplan'));
            $w('#datepicker1').value = null;
            if ($w('#texttitleboxprofile')) $w('#texttitleboxprofile').text = '';
            updateSubmitPricingPlanLabel();
        } catch (e) {
            console.error('[MANUAL RENEW FAILED]', e);
        } finally {
            $w('#buttonsubmitpricingplan').enable();
        }
    });
}

function formatPaidDate(val) {
    if (!val) return '';
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val).slice(0, 10);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function resetDropdown(dropdown) {
    if (!dropdown) return;
    dropdown.selectedIndex = undefined;
    dropdown.value = undefined;
}
