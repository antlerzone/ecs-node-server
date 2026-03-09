/* ======================================================
   Enquiry (Public Page) – New Customer / Demo Registration
   Data via backend/saas/enquiry.jsw → ECS /api/enquiry (no login).
   Profile logo: #htmluploadbuttonprofile (HTML Embed → OSS), clientId 'enquiry'.
   No payment here; client stays inactive until Indoor Admin manual billing sets active.
====================================================== */

import {
    getPlans,
    getAddons,
    getBanks,
    getUploadCreds,
    submitEnquiry
} from 'backend/saas/enquiry';

/* ======================================================
   State
====================================================== */

let selectedCountry = null; // MY / SG
let selectedCurrency = 'MYR'; // MYR / SGD
let selectedPlanId = null;
let pricingPlans = [];
let addonLoaded = false;
let addonList = [];
let profilePhotoUrl = null; // OSS URL from #htmluploadbuttonprofile
let enquiryProfileUploadBound = false;

/* ======================================================
   On Ready
====================================================== */

$w.onReady(function () {

    bindPricingRepeater();
    initSections();
    bindCountrySelection();
    bindDefaultColumns();
    bindConfirmButton();
    bindAddonButton();
    initDetailSection();
    bindDemoButton();
    bindBackButtons();
    bindAddonRepeater();
    bindInputFormatting();
    bindEnquiryProfileUploadMessage();
    if ($w('#buttoncloseproblem')) {
        $w('#buttoncloseproblem').onClick(() => {
            if ($w('#boxproblem')) $w('#boxproblem').hide();
        });
    }

    $w('#textotherusage').text =
        "• Agreement created by system – 10 Credits per unit\n" +
        "• Each active room – 10 Credits per unit per month (charged on the 1st of each month)";
});

/* ======================================================
   Section Control
====================================================== */

function initSections() {

    $w('#sectioncountry').expand();
    $w('#sectiondefault').collapse();
    $w('#sectionpricingplan').collapse();
    $w('#sectiondetail').collapse();
}

function switchSection(target) {

    $w('#sectioncountry').collapse();
    $w('#sectiondefault').collapse();
    $w('#sectionpricingplan').collapse();
    $w('#sectiondetail').collapse();

    if (target === 'country') {
        $w('#sectioncountry').expand();
    }

    if (target === 'default') {
        $w('#sectiondefault').expand();
    }

    if (target === 'pricing') {
        $w('#sectionpricingplan').expand();
    }

    if (target === 'detail') {
        $w('#sectiondetail').expand();
        initHtmlUploadProfile();
    }
}

/* ======================================================
   Country Selection
====================================================== */

/** 国家选择：前端切 section；repeater 预拉或按新货币刷新（back 到 country 换国家后 repeater 要 reload 换货币） */
function bindCountrySelection() {

    $w('#buttonmalaysia').onClick(() => {
        console.log('[enquiry] #buttonmalaysia clicked → MY, MYR');
        selectedCountry = 'MY';
        selectedCurrency = 'MYR';
        switchSection('default');
        if (pricingPlans.length > 0) {
            refreshRepeaterCurrency();
            console.log('[enquiry] refreshRepeaterCurrency(), plans:', pricingPlans.length);
        } else {
            loadPricingPlans();
            console.log('[enquiry] loadPricingPlans()');
        }
    });

    $w('#buttonsingapore').onClick(() => {
        console.log('[enquiry] #buttonsingapore clicked → SG, SGD');
        selectedCountry = 'SG';
        selectedCurrency = 'SGD';
        switchSection('default');
        if (pricingPlans.length > 0) {
            refreshRepeaterCurrency();
            console.log('[enquiry] refreshRepeaterCurrency(), plans:', pricingPlans.length);
        } else {
            loadPricingPlans();
            console.log('[enquiry] loadPricingPlans()');
        }
    });
}

/** 返回带当前货币的 repeater 数据（新数组+新对象，强制 Wix 重绘；onItemReady 用 plan.displayCurrency） */
function getRepeaterDataWithCurrency() {
    var currency = selectedCurrency || 'MYR';
    return pricingPlans.map(function (p) {
        return {
            _id: p._id || p.id,
            id: p.id || p._id,
            title: p.title,
            description: p.description,
            features: p.features,
            sellingprice: p.sellingprice,
            corecredit: p.corecredit,
            displayCurrency: currency
        };
    });
}

/** 已有 plan 数据时只重绑 repeater，并写入当前 selectedCurrency 到每条 item */
function refreshRepeaterCurrency() {
    $w('#repeaterpricingplan').data = getRepeaterDataWithCurrency();
}

/** 进入 pricing section 后按当前货币刷新 repeater：先清空再赋新数据，强制 Wix 重绘 #textamountpricingplan */
function refreshRepeaterWhenEnterPricing() {
    if (pricingPlans.length === 0) return;
    var repeater = $w('#repeaterpricingplan');
    repeater.data = [];
    setTimeout(function () {
        var data = getRepeaterDataWithCurrency();
        repeater.data = data;
        console.log('[enquiry] refreshRepeaterWhenEnterPricing currency:', selectedCurrency, 'items:', data.length, 'first displayCurrency:', data[0] && data[0].displayCurrency);
    }, 150);
}

/* ======================================================
   Default Section
====================================================== */

/** default 区 column1、column2：点击后直接切 #sectionpricingplan，并按当前 selectedCurrency 刷新 repeater（back 换国家后再进 pricing 才显示 SGD/MYR） */
function bindDefaultColumns() {

    $w('#column2').onClick(() => {
        if (!selectedCountry) {
            switchSection('country');
            return;
        }
        switchSection('pricing');
        refreshRepeaterWhenEnterPricing();
    });

    $w('#column1').onClick(() => {
        if (!selectedCountry) {
            switchSection('country');
            return;
        }
        switchSection('pricing');
        refreshRepeaterWhenEnterPricing();
    });
}

/* ======================================================
   Load Pricing Plans (ECS via enquiry.jsw)
====================================================== */

async function loadPricingPlans() {

    $w('#buttonconfirmpricingplan').disable();
    selectedPlanId = null;

    try {
        const res = await getPlans();
        if (Array.isArray(res)) {
            pricingPlans = res;
        } else if (res && Array.isArray(res.items)) {
            pricingPlans = res.items;
        } else {
            pricingPlans = [];
        }
        pricingPlans = pricingPlans.map((p) => ({
            _id: p.id || p._id,
            id: p.id || p._id,
            title: p.title || '',
            description: p.description || '',
            features: Array.isArray(p.features) ? p.features : [],
            sellingprice: p.sellingprice != null ? p.sellingprice : 0,
            corecredit: p.corecredit != null ? p.corecredit : 0
        }));
    } catch (e) {
        console.error('[enquiry] getPlans', e);
        pricingPlans = [];
    }

    if (pricingPlans.length === 0) {
        pricingPlans = [{
            _id: '_empty',
            id: '_empty',
            title: 'No plans available',
            description: 'Check database pricingplan table or ECS connection.',
            features: [],
            sellingprice: 0,
            corecredit: 0
        }];
    }

    var repeater = $w('#repeaterpricingplan');
    setTimeout(function () {
        repeater.data = getRepeaterDataWithCurrency();
    }, 150);
}

/* ======================================================
   Pricing Repeater
====================================================== */

function bindPricingRepeater() {

    $w('#repeaterpricingplan').onItemReady(($item, plan) => {

        $item('#boxcolorpricingplan').hide();

        $item('#texttitlepricingplan').text = plan.title || '';

        $item('#textdescriptionpricingplan').text =
            plan.description || '';

        if (Array.isArray(plan.features)) {
            const bulletText = plan.features
                .map(f => `• ${f}`)
                .join('\n');
            $item('#textfeature').text = bulletText;
        } else {
            $item('#textfeature').text = '';
        }

        $item('#textcreditpricingplan').text =
            `Core Credit: ${plan.corecredit != null ? plan.corecredit : 0}`;

        var currency = plan.displayCurrency || selectedCurrency || 'MYR';
        var amountText = currency + ' ' + (plan.sellingprice != null ? plan.sellingprice : 0);
        $item('#textamountpricingplan').text = amountText;

        $item('#containerpricingplan').onClick(() => {

            selectedPlanId = plan.id || plan._id;

            $w('#repeaterpricingplan').forEachItem(($i) => {
                $i('#boxcolorpricingplan').hide();
            });

            $item('#boxcolorpricingplan').show();

            $w('#buttonconfirmpricingplan').enable();
        });
    });
}

/* ======================================================
   Confirm Plan
====================================================== */

function bindConfirmButton() {

    $w('#buttonconfirmpricingplan').onClick(() => {

        if (!selectedPlanId) {
            return;
        }

        $w('#boxpricingplan').show();

        $w('#textcontactcs').text =
            "Please contact 6019-857 9627 to activate your plan.";

        $w('#buttoncloseboxpricingplan').onClick(() => {
            $w('#boxpricingplan').hide();
        });
    });
}

function bindAddonButton() {

    $w('#buttonaddon').onClick(async () => {

        if (!addonLoaded) {
            await loadAddons();
            addonLoaded = true;
        }

        $w('#boxaddon').show();
    });

    $w('#buttoncanceladdon').onClick(() => {
        $w('#boxaddon').hide();
    });
}

async function loadAddons() {

    try {
        const res = await getAddons();
        const items = (res && res.items) ? res.items : [];
        $w('#repeateraddon').data = items;
    } catch (e) {
        console.error('[enquiry] getAddons', e);
        $w('#repeateraddon').data = [];
    }
}

function bindAddonRepeater() {

    $w('#repeateraddon').onItemReady(($item, addon) => {

        const unitCredit = parseAddonCredit(addon.credit);

        $item('#textcheckboxtitleaddon').text = addon.title || '';

        $item('#textcheckboxdescriptionaddon').text =
            Array.isArray(addon.description) ?
                addon.description.join('\n') :
                (addon.description || '');

        $item('#textcreditaddon').text =
            `${unitCredit} Credit per year`;

        setupPublicQtyDropdown($item, addon.qty);

        $item('#dropdownqtyaddon').onChange(() => {

            const qty =
                Number($item('#dropdownqtyaddon').value) || 1;

            const total = unitCredit * qty;

            $item('#textcreditaddon').text =
                `${unitCredit} Credit per year\n` +
                `Total required: ${total} Credit`;
        });
    });
}

function setupPublicQtyDropdown($item, maxQty) {

    const safeMax = Number(maxQty) > 0 ? Number(maxQty) : 1;

    const options = [];

    for (let i = 1; i <= safeMax; i++) {
        options.push({
            label: String(i),
            value: String(i)
        });
    }

    $item('#dropdownqtyaddon').options = options;
    $item('#dropdownqtyaddon').value = '1';
}

function parseAddonCredit(raw) {

    if (!raw) return 0;

    if (Array.isArray(raw)) {
        raw = raw[0];
    }

    if (typeof raw === 'string') {
        const match = raw.match(/\d+/);
        return match ? Number(match[0]) : 0;
    }

    if (typeof raw === 'number') {
        return raw;
    }

    return 0;
}

function bindEnquiryProfileUploadMessage() {
    if (enquiryProfileUploadBound) return;
    enquiryProfileUploadBound = true;
    try {
        $w('#htmluploadbuttonprofile').onMessage((event) => {
            const d = event.data;
            if (d && d.type === 'UPLOAD_SUCCESS' && d.url) {
                profilePhotoUrl = d.url;
            }
        });
    } catch (_) {}
}

async function initHtmlUploadProfile() {
    try {
        const creds = await getUploadCreds();
        if (!creds.ok || !creds.baseUrl) return;
        $w('#htmluploadbuttonprofile').postMessage({
            type: 'INIT',
            baseUrl: creds.baseUrl,
            token: creds.token,
            username: creds.username,
            clientId: 'enquiry',
            uploadId: 'profile',
            label: 'Upload company logo / profile photo',
            accept: 'image/*'
        });
    } catch (e) {
        console.error('initHtmlUploadProfile', e);
    }
}

async function initDetailSection() {

    $w('#dropdowncurrency').options = [
        { label: 'MYR', value: 'MYR' },
        { label: 'SGD', value: 'SGD' }
    ];

    $w('#dropdowncurrency').value = selectedCurrency;
    $w('#dropdowncurrency').disable();

    await initDetailBankDropdown();

    bindDetailSaveButton();
}

async function initDetailBankDropdown() {

    try {
        const res = await getBanks();
        const items = (res && res.items) ? res.items : [];
        $w('#dropdownbank').options = items.map(item => ({
            label: item.label || item.bankname || '',
            value: item.value || item.id
        }));
    } catch (e) {
        console.error('[enquiry] getBanks', e);
        $w('#dropdownbank').options = [];
    }
}

function bindDetailSaveButton() {

    $w('#buttonsaveprofile').onClick(async () => {

        const btn = $w('#buttonsaveprofile');
        btn.disable();
        btn.label = 'Saving...';

        try {

            const title = ($w('#input1profile').value || '').trim();
            const email =
                ($w('#inputemail').value || '')
                    .trim()
                    .toLowerCase();

            if (!title || !email) {
                throw new Error('MISSING_REQUIRED_FIELDS');
            }

            const contact = ($w('#input4profile').value || '').trim();
            const accountNumber = ($w('#inputaccountnumber').value || '').trim();
            const bankId = $w('#dropdownbank').value || null;

            const result = await submitEnquiry({
                title,
                email,
                currency: selectedCurrency,
                country: selectedCountry,
                profilePhotoUrl: profilePhotoUrl || undefined,
                contact: contact || undefined,
                accountNumber: accountNumber || undefined,
                bankId: bankId || undefined
            });

            if (result && result.ok) {

                $w('#titleboxproblem').text =
                    `Demo account created successfully.

You may now log in using:
${result.email || email}

This demo account will expire in 7 days.`;

                $w('#boxproblem').show();
            } else {
                throw new Error(result.reason || 'SUBMIT_FAILED');
            }

        } catch (err) {

            console.error('[enquiry] submit', err);

            let message = "Something went wrong.\nPlease try again.";
            if (err && err.message === 'EMAIL_ALREADY_REGISTERED') {
                message = "This email is already registered.\nPlease use another email or log in.";
            } else if (err && err.message === 'MISSING_REQUIRED_FIELDS') {
                message = "Please fill in Company name and Email.";
            }

            $w('#titleboxproblem').text = message;

            $w('#boxproblem').show();

        } finally {

            btn.label = 'Save';
            btn.enable();
        }
    });
}

function bindInputFormatting() {

    $w('#inputemail').onInput(() => {

        let val = $w('#inputemail').value || '';

        val = val
            .toLowerCase()
            .replace(/\s+/g, '');

        $w('#inputemail').value = val;
    });

    $w('#inputaccountnumber').onInput(() => {

        let val = $w('#inputaccountnumber').value || '';

        val = val.replace(/[^\d]/g, '');

        $w('#inputaccountnumber').value = val;
    });

    $w('#input4profile').onInput(() => {

        let val = $w('#input4profile').value || '';

        val = val.replace(/[^\d]/g, '');

        $w('#input4profile').value = val;
    });
}

function bindDemoButton() {

    $w('#buttondemo').onClick(() => {

        if (!selectedCountry) {
            switchSection('country');
            return;
        }

        switchSection('detail');
    });
}

function bindBackButtons() {

    $w('#buttonback1').onClick(() => {
        switchSection('country');
    });

    $w('#buttonback2').onClick(() => {
        switchSection('default');
    });

    $w('#buttonback3').onClick(() => {
        switchSection('pricing');
    });
}
