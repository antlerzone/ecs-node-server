/**
 * Tenant Dashboard 页面 – 迁移版（Wix 前端 + Node 后端 + MySQL）
 * 数据全部通过 backend/saas/tenantdashboard.jsw 请求 ECS Node，不读 Wix CMS。
 *
 * 依赖：backend/saas/tenantdashboard、wix-users、wix-location。
 * TTLock / CNYIoT：仍可从 backend/access/ttlockaccess、backend/integration/cnyiotapi 调用（若 Node 已提供租客维度接口可改为 tenantdashboard 对应方法）。
 * 若 feedback 表尚未建表，需先在 MySQL 建表并确认字段；否则 submitFeedback 会返回 FEEDBACK_TABLE_MISSING。
 */

/* global Stripe */

import wixUsers from "wix-users";
import wixLocation from "wix-location";
import {
    init as tenantDashboardInit,
    getClientsByIds,
    getRoomWithMeter,
    getPropertyWithSmartdoor,
    getBanks,
    updateTenantProfile,
    getAgreementHtml,
    updateAgreementTenantSign,
    getAgreement,
    getRentalList,
    tenantApprove,
    tenantReject,
    syncTenantForClient,
    submitFeedback,
    createTenantPayment,
    getUploadCreds
} from "backend/saas/tenantdashboard";
import { createTenantPasscode, updateTenantPasscode, remoteUnlock } from "backend/access/ttlockaccess.jsw";
import { getUsageSummary, syncMeterByCmsMeterId } from "backend/integration/cnyiotapi";

/* ===============================
   GLOBAL STATE
================================ */
let TENANT = null;
let TENANCIES = [];
let TENANCY_MAP = {};
/** When init returns no tenant, we still have current user email for profile edit. */
let CURRENT_USER_EMAIL = "";
let activeSection = null;
let sectionSwitchBound = false;
let dashboardRepeaterBound = false;
let previousSection = null;
let feedbackUploadUrls = [];
let feedbackUploadBound = false;
let feedbackUploadLock = false;
let whatsappButtonBound = false;
let profileNricFrontUrl = null;
let profileNricBackUrl = null;

const MAIN_SECTIONS = [
    "tenantdashboard",
    "meter",
    "agreement",
    "smartdoor",
    "payment",
    "profile",
    "feedback"
];

/* ===============================
   ON READY
================================ */
$w.onReady(async () => {
    disableMainActions();
    initDefaultSection();
    await startInitAsync();
});

/* ===============================
   INIT FLOW
================================ */
async function startInitAsync() {
    try {
        const user = wixUsers.currentUser;
        const email = (await user.getEmail())?.toLowerCase().trim();

        if (!email) {
            showNotTenant();
            setNoTenantState();
            bindSectionSwitch();
            $w("#textstatusloading").hide();
            return;
        }

        CURRENT_USER_EMAIL = email;
        const res = await tenantDashboardInit();
        if (!res.ok) {
            showNotTenant();
            setNoTenantState();
            bindSectionSwitch();
            $w("#textstatusloading").hide();
            return;
        }

        TENANT = res.tenant;
        TENANCIES = res.tenancies || [];

        if (!TENANT) {
            showNotTenant();
            setNoTenantState();
            bindSectionSwitch();
            $w("#textstatusloading").hide();
            return;
        }

        buildTenancyMap();

        bindSectionSwitch();
        await initTenantDashboardSection();

        $w("#textstatusloading").hide();
        $w("#sectiondefault").collapse();
        switchSection("tenantdashboard");

        enableMainActions();
        await applyTenantProfileGate();
    } catch (err) {
        console.error("INIT ERROR:", err);
        showNotTenant();
        setNoTenantState();
        bindSectionSwitch();
        $w("#textstatusloading").hide();
    }

    $w("#dropdowntopup").options = [
        { label: "RM 10", value: "10" },
        { label: "RM 20", value: "20" },
        { label: "RM 30", value: "30" },
        { label: "RM 40", value: "40" },
        { label: "RM 50", value: "50" },
        { label: "RM 100", value: "100" }
    ];

    $w("#buttontopupmeter").onClick(async () => {
        const btn = $w("#buttontopupmeter");
        try {
            const amountValue = Number($w("#dropdowntopup").value);
            if (!amountValue) return;

            btn.disable();
            btn.label = "Processing...";

            const tenancy = getActiveTenancy();
            if (!tenancy) throw new Error("No active tenancy");

            const room = tenancy.room;
            const meterId =
                typeof room === "object" && room?.meter
                    ? room.meter.meterId
                    : null;

            if (!meterId) throw new Error("Meter not found");

            const referenceNumber = "MT_" + Date.now();

            const payRes = await createTenantPayment({
                tenancyId: tenancy._id,
                type: "meter",
                amount: amountValue,
                referenceNumber,
                metadata: { meterId }
            });

            if (payRes.ok && payRes.type === "redirect" && payRes.url) {
                wixLocation.to(payRes.url);
                return;
            }
        } catch (err) {
            console.error("Meter topup error:", err);
        } finally {
            btn.enable();
            btn.label = "Top-up";
        }
    });
}

/* ===============================
   SECTION CONTROL
================================ */
function bindSectionSwitch() {
    if (sectionSwitchBound) return;
    sectionSwitchBound = true;

    $w("#buttonpaynow").onClick(async () => {
        const btn = $w("#buttonpaynow");
        try {
            const selected = getSelectedPayments();
            if (!selected.length) {
                console.log("No item selected");
                return;
            }
            if (selected.length > 10) {
                return;
            }

            btn.disable();
            btn.label = "Processing...";

            const tenancy = getActiveTenancy();
            if (!tenancy) throw new Error("No active tenancy");

            const total = selected.reduce((sum, i) => sum + Number(i.amount || 0), 0);
            const referenceNumber = "INV_" + Date.now();

            const payRes = await createTenantPayment({
                tenancyId: tenancy._id,
                type: "invoice",
                amount: total,
                referenceNumber,
                metadata: { invoiceIds: selected.map((i) => i._id) }
            });

            if (payRes.ok && payRes.type === "redirect" && payRes.url) {
                wixLocation.to(payRes.url);
                return;
            }
        } catch (err) {
            console.error("Payment error:", err);
        } finally {
            btn.enable();
            btn.label = "Pay Now";
        }
    });

    $w("#buttonmeter").onClick(async () => {
        const btn = $w("#buttonmeter");
        try {
            btn.disable();
            btn.label = "Loading...";
            await openMeterSection();
        } catch (err) {
            console.error("Open Meter Error:", err);
        } finally {
            btn.label = "Meter";
            btn.enable();
        }
    });

    $w("#buttonagreement").onClick(() => {
        initAgreementSection();
        switchSection("agreement");
    });

    $w("#buttonsmartdoor").onClick(async () => {
        await openSmartDoorSection();
    });
    $w("#buttonclosemeter").onClick(() => switchSection("tenantdashboard"));
    $w("#buttonpayment").onClick(async () => await openPaymentSection());
    $w("#buttonprofile").onClick(async () => await openProfileSection());
    $w("#buttonclosesmartdoor").onClick(() => switchSection("tenantdashboard"));
    $w("#buttoncloseprofile").onClick(() => switchSection("tenantdashboard"));
    $w("#buttonclosepayment").onClick(() => switchSection("tenantdashboard"));
    $w("#buttonfeedback").onClick(() => openFeedbackSection());
    $w("#buttonclosefeedback").onClick(() => {
        if (previousSection) switchSection(previousSection);
        else switchSection("tenantdashboard");
    });
}

function openFeedbackSection() {
    feedbackUploadUrls = [];
    $w("#inputdescriptionfeedback").value = "";
    bindFeedbackUploader();
    bindSubmitFeedbackButton();
    bindWhatsAppButton();
    switchSection("feedback");
    initHtmlUploadFeedback();
}

function bindWhatsAppButton() {
    const btn = $w("#buttonwhatsap");
    if (!btn) return;
    if (whatsappButtonBound) return;
    whatsappButtonBound = true;
    btn.onClick(() => {
        const tenancy = getActiveTenancy();
        if (!tenancy) return;
        const contact = typeof tenancy.client === "object" ? tenancy.client?.contact : null;
        const phone = contact && String(contact).trim() ? String(contact).trim().replace(/\D/g, "") : null;
        if (!phone) {
            if (typeof btn.label !== "undefined") btn.label = "No contact";
            return;
        }
        const tenantName = (typeof tenancy.tenant === "object" ? tenancy.tenant?.fullname : "") || "";
        const roomName = (tenancy.room && (tenancy.room.title_fld || tenancy.room.roomname)) ? (tenancy.room.title_fld || tenancy.room.roomname) : "";
        const message = [tenantName, roomName].filter(Boolean).join(" ");
        const path = message ? `/${encodeURIComponent(message).replace(/%20/g, "%20")}` : "";
        const url = `https://wasap.my/${phone}${path}`;
        wixLocation.to(url);
    });
}

function bindFeedbackUploader() {
    if (feedbackUploadBound) return;
    feedbackUploadBound = true;
    bindHtmlUploadMessages();
}

async function initHtmlUploadFeedback() {
    try {
        const tenancy = getActiveTenancy();
        const clientId = tenancy && tenancy.client ? (typeof tenancy.client === "object" ? tenancy.client._id : tenancy.client) : null;
        if (!clientId) return;
        const creds = await getUploadCreds();
        if (!creds.ok || !creds.baseUrl) return;
        $w("#htmluploadbuttonfeedback").postMessage({
            type: "INIT",
            baseUrl: creds.baseUrl,
            token: creds.token,
            username: creds.username,
            clientId,
            uploadId: "feedback",
            label: "Upload photo / video",
            accept: "image/*,video/*"
        });
    } catch (e) {
        console.error("initHtmlUploadFeedback", e);
    }
}

function bindHtmlUploadMessages() {
    try {
        $w("#htmluploadbuttonfeedback").onMessage((event) => {
            const d = event.data;
            if (d && d.type === "UPLOAD_SUCCESS" && d.url) {
                feedbackUploadUrls = [...feedbackUploadUrls, d.url];
            }
        });
    } catch (_) {}
    try {
        $w("#htmluploadbutton1").onMessage((event) => {
            const d = event.data;
            if (d && d.type === "UPLOAD_SUCCESS" && d.url) {
                profileNricFrontUrl = d.url;
            }
        });
    } catch (_) {}
    try {
        $w("#htmluploadbutton2").onMessage((event) => {
            const d = event.data;
            if (d && d.type === "UPLOAD_SUCCESS" && d.url) {
                profileNricBackUrl = d.url;
            }
        });
    } catch (_) {}
}

function bindSubmitFeedbackButton() {
    $w("#buttonsubmitfeedback").onClick(async () => {
        const btn = $w("#buttonsubmitfeedback");
        try {
            btn.disable();
            btn.label = "Submitting...";

            const description = $w("#inputdescriptionfeedback").value?.trim();
            if (!description) {
                btn.label = "Description required";
                setTimeout(() => {
                    btn.label = "Submit";
                    btn.enable();
                }, 1200);
                return;
            }

            const tenancy = getActiveTenancy();
            if (!tenancy) throw new Error("No active tenancy");

            let photo = [];
            let video = null;
            if (feedbackUploadUrls.length) {
                const videoExt = [".mp4", ".mov", ".avi", ".webm"];
                feedbackUploadUrls.forEach((url) => {
                    const lower = url.toLowerCase();
                    const isVideo = videoExt.some((ext) => lower.includes(ext));
                    if (isVideo) video = url;
                    else photo.push({ src: url, type: "image" });
                });
            }

            const roomId = typeof tenancy.room === "object" ? tenancy.room?._id : tenancy.room;
            const propertyId = typeof tenancy.property === "object" ? tenancy.property?._id : tenancy.property;
            const clientId = typeof tenancy.client === "object" ? tenancy.client?._id : tenancy.client;

            const res = await submitFeedback({
                tenancyId: tenancy._id,
                roomId,
                propertyId,
                clientId,
                description,
                photo: photo.length ? photo : undefined,
                video
            });

            if (!res.ok) {
                console.error("Feedback submit error:", res.reason);
                btn.label = "Submit";
                btn.enable();
                return;
            }

            btn.label = "Submitted";
            setTimeout(() => {
                btn.label = "Submit";
                btn.enable();
                feedbackUploadUrls = [];
                $w("#inputdescriptionfeedback").value = "";
                if (previousSection) switchSection(previousSection);
                else switchSection("tenantdashboard");
            }, 1200);
        } catch (err) {
            console.error("Feedback submit error:", err);
            btn.label = "Submit";
            btn.enable();
        }
    });
}

function switchSection(sectionKey) {
    if (activeSection === sectionKey) return;
    previousSection = activeSection;
    collapseAllSections();
    const sec = $w(`#section${sectionKey}`);
    if (sec) sec.expand();
    activeSection = sectionKey;
}

function collapseAllSections() {
    MAIN_SECTIONS.forEach((k) => {
        const sec = $w(`#section${k}`);
        sec && sec.collapse();
    });
}

function initDefaultSection() {
    collapseAllSections();
    $w("#sectiondefault").expand();
}

/* ===============================
   TENANT DASHBOARD
================================ */
async function initTenantDashboardSection() {
    initPropertyDropdown();
    bindDashboardRepeater();
    renderDashboardRepeater();
    renderValidDate();
    $w("#texttenantname").text = TENANT.fullname || "";
    await applyTenantProfileGate();
}

function initPropertyDropdown() {
    const dropdown = $w("#dropdownproperty");
    const propertyMap = {};
    TENANCIES.forEach((t) => {
        const prop = t.property;
        if (!prop) return;
        const propId = typeof prop === "object" ? prop._id : prop;
        const propName = typeof prop === "object" ? prop.shortname : "Property";
        if (!propertyMap[propId]) {
            propertyMap[propId] = { label: propName || "Unnamed", value: propId };
        }
    });
    let options = Object.values(propertyMap);
    options.sort((a, b) => (a.label || "").localeCompare(b.label || ""));
    if (!options.length) {
        options = [{ label: "Select property", value: "" }];
    }
    dropdown.options = options;
    dropdown.enable();

    if (options.length === 1 && options[0].value) {
        dropdown.value = options[0].value;
    } else {
        const activeTenancy = getActiveTenancy();
        if (activeTenancy?.property) {
            const propId =
                typeof activeTenancy.property === "object"
                    ? activeTenancy.property._id
                    : activeTenancy.property;
            dropdown.value = propId;
        } else {
            dropdown.value = options[0]?.value || "";
        }
    }

    dropdown.onChange(async () => {
        renderDashboardBySelectedProperty();
        renderValidDate();
        await applyTenantProfileGate();
    });
}

function buildTenancyMap() {
    TENANCY_MAP = {};
    TENANCIES.forEach((t) => {
        const propId = typeof t.property === "object" ? t.property._id : t.property;
        if (!propId) return;
        if (!TENANCY_MAP[propId]) TENANCY_MAP[propId] = [];
        TENANCY_MAP[propId].push(t);
    });
}

function bindDashboardRepeater() {
    if (dashboardRepeaterBound) return;
    dashboardRepeaterBound = true;

    $w("#repeatertenantdashboard").onItemReady(($item, item) => {
        const approveBtn = $item("#buttonapprove");
        const rejectBtn = $item("#buttonreject");

        if (item.type === "approval") {
            $item("#texttenanddashboard").text = item.client?.title || "Unknown Operator";
            approveBtn.show();
            rejectBtn.show();
            approveBtn.label = "Approve";
            rejectBtn.label = "Reject";
            /* Enable approve/reject when we have a tenant record (state 2–5); evaluate at render time */
            if (TENANT) {
                approveBtn.enable();
                rejectBtn.enable();
            } else {
                approveBtn.disable();
                rejectBtn.disable();
            }

            approveBtn.onClick(async () => {
                approveBtn.disable();
                rejectBtn.disable();
                approveBtn.label = "Loading...";
                try {
                    const clientId = item.clientid;
                    const appRes = await tenantApprove({ clientId });
                    if (!appRes.ok) throw new Error(appRes.reason);

                    try {
                        await syncTenantForClient({ clientId });
                    } catch (e) {
                        console.warn("Accounting sync failed:", e);
                    }

                    approveBtn.label = "Complete";
                    setTimeout(async () => {
                        const refresh = await tenantDashboardInit();
                        if (refresh.ok && refresh.tenant) {
                            TENANT = refresh.tenant;
                            TENANCIES = refresh.tenancies || [];
                            buildTenancyMap();
                            initPropertyDropdown();
                            renderDashboardRepeater();
                            await applyTenantProfileGate();
                        }
                    }, 1200);
                } catch (err) {
                    console.error("Tenant Approve failed:", err);
                    approveBtn.label = "Approve";
                    approveBtn.enable();
                    rejectBtn.enable();
                }
            });

            rejectBtn.onClick(async () => {
                approveBtn.disable();
                rejectBtn.disable();
                rejectBtn.label = "Loading...";
                try {
                    const clientId = item.clientid;
                    await tenantReject({ clientId });
                    TENANT = (await tenantDashboardInit()).tenant || TENANT;
                    rejectBtn.label = "Complete";
                    setTimeout(() => renderDashboardRepeater(), 1200);
                } catch (err) {
                    console.error("Tenant Reject failed:", err);
                    rejectBtn.label = "Reject";
                    approveBtn.enable();
                    rejectBtn.enable();
                }
            });
            return;
        }

        if (item.type === "agreement") {
            $item("#texttenanddashboard").text =
                `${item.propertyName} | Pending Signing Agreement`;
            approveBtn.hide();
            rejectBtn.label = "Sign Agreement";
            rejectBtn.show();
            rejectBtn.enable();
            rejectBtn.onClick(() => {
                openTenantAgreementBox(item.tenancy);
                switchSection("agreement");
            });
            return;
        }
    });
}

async function renderDashboardRepeater() {
    const rows = [];

    const pendingApproval = (TENANT.approvalRequest || []).filter((r) => r.status === "pending");
    const clientIds = pendingApproval.map((p) => p.clientId);

    if (clientIds.length) {
        const res = await getClientsByIds({ clientIds });
        const clientMap = res.ok && res.items
            ? Object.fromEntries(res.items.map((c) => [c._id, c]))
            : {};
        pendingApproval.forEach((p) => {
            rows.push({
                _id: `approval_${p.clientId}`,
                type: "approval",
                clientid: p.clientId,
                client: clientMap[p.clientId]
            });
        });
    }

    for (const t of TENANCIES) {
        const agreements = Array.isArray(t.agreements) ? t.agreements : [];
        if (!agreements.length) continue;
        const latest = agreements.sort(
            (a, b) =>
                new Date(b._createdDate || 0).getTime() -
                new Date(a._createdDate || 0).getTime()
        )[0];
        if (!latest) continue;
        const validMode =
            latest.mode === "owner_tenant" || latest.mode === "tenant_operator";
        const tenantNotSigned = !latest.tenantsign;
        if (validMode && tenantNotSigned) {
            rows.push({
                _id: `agreement_${t._id}`,
                type: "agreement",
                tenancy: t,
                propertyName: t.property?.shortname || "Property"
            });
        }
    }

    if (!rows.length) {
        $w("#repeatertenantdashboard").collapse();
        return;
    }
    $w("#repeatertenantdashboard").expand();
    $w("#repeatertenantdashboard").data = rows;
}

function renderDashboardBySelectedProperty() {
    const propId = $w("#dropdownproperty").value;
    if (!propId) return;
    const list = TENANCY_MAP[propId] || [];
    list.sort((a, b) => new Date(a.begin).getTime() - new Date(b.begin).getTime());
    $w("#repeatertenantdashboard").data = list;
}

function getActiveTenancy() {
    const now = new Date();
    return TENANCIES.find((t) => {
        const begin = new Date(t.begin);
        const end = new Date(t.end);
        return begin <= now && now <= end;
    });
}

function disableMainActions() {
    ["#buttonmeter", "#buttonagreement", "#buttonsmartdoor", "#buttonpayment", "#buttonprofile"].forEach((id) => {
        const el = $w(id);
        el?.disable?.();
    });
    /* #buttonfeedback always enabled, never disabled */
}

function enableMainActions() {
    ["#buttonmeter", "#buttonagreement", "#buttonsmartdoor", "#buttonpayment", "#buttonprofile", "#buttonfeedback"].forEach((id) => {
        const el = $w(id);
        el?.enable?.();
    });
}

function showNotTenant() {
    collapseAllSections();
    $w("#sectiondefault").expand();
    $w("#textstatusloading").text = "You are not our tenant";
    $w("#textstatusloading").show();
}

/** When no tenancy: disable property/meter/agreement/smartdoor/payment; keep profile (and feedback) enabled so public can edit profile. */
function setNoTenantState() {
    ["#dropdownproperty", "#buttonmeter", "#buttonagreement", "#buttonsmartdoor", "#buttonpayment"].forEach((id) => {
        const el = $w(id);
        if (el) el.disable();
    });
    $w("#buttonprofile").enable();
    try { $w("#buttonfeedback").enable(); } catch (_) {}
}

function renderValidDate() {
    const propId = $w("#dropdownproperty").value;
    if (!propId) return;
    const tenancies = TENANCY_MAP[propId] || [];
    if (!tenancies.length) return;
    const t = tenancies
        .filter((x) => x.end)
        .sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime())[0];
    if (!t?.begin || !t?.end) return;
    const f = new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
    const begin = new Date(t.begin);
    const end = new Date(t.end);
    $w("#textvaliddate").text = `Tenancy Agreement: ${f.format(begin)} to ${f.format(end)}`;
    const diffDays = (end.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    $w("#textvaliddate").style.color = diffDays <= 60 ? "#FF0000" : "#000000";
}

/* ===============================
   METER
================================ */
async function openMeterSection() {
    const propId = $w("#dropdownproperty").value;
    if (!propId) return;
    const tenancies = TENANCY_MAP[propId] || [];
    if (!tenancies.length) return;
    const tenancy = tenancies[0];
    if (!tenancy.room) return;

    const roomId = typeof tenancy.room === "object" ? tenancy.room._id : tenancy.room;
    const roomRes = await getRoomWithMeter({ roomId });
    if (!roomRes.ok || !roomRes.room) {
        switchSection("meter");
        return;
    }

    const room = roomRes.room;
    if (room.meter) {
        try {
            await syncMeterByCmsMeterId(room.meter.client, room.meter.meterId);
        } catch (err) {
            console.error("Meter Sync Error:", err);
        }
        const freshRes = await getRoomWithMeter({ roomId });
        const freshRoom = (freshRes.ok && freshRes.room) ? freshRes.room : room;
        await loadMeterUI(freshRoom, tenancy);
        await initTenantMeterReport(freshRoom, tenancy);
    }

    switchSection("meter");
}

async function loadMeterUI(room, tenancy) {
    const meter = room.meter;
    const balance = meter?.balance ?? 0;
    const rate = meter?.rate ?? 0;
    const currency = tenancy?.client?.currency?.toUpperCase() || "MYR";
    const currencyLabel = currency === "SGD" ? "SGD" : "RM";
    $w("#texttitlemeterbalance").text = "Balanced";
    $w("#textmeterbalance").text = `${balance} kWhz`;
    $w("#textmeterrate").text = `${currencyLabel} ${Number(rate).toFixed(2)}/kWhz`;
    $w("#textmeterbalance").style.color = balance < 50 ? "#FF0000" : "#000000";

    // Postpaid 模式：禁用充值和按钮，按钮文案改为 "Postpaid Mode"
    if (meter && meter.canTopup === false) {
        $w("#dropdowntopup").disable();
        $w("#buttontopupmeter").disable();
        $w("#buttontopupmeter").label = "Postpaid Mode";
    } else {
        $w("#dropdowntopup").enable();
        $w("#buttontopupmeter").enable();
        $w("#buttontopupmeter").label = "Top-up";
    }
}

let tenantMeterReportDateBound = false;

async function initTenantMeterReport(room, tenancy) {
    if (!room?.meter) return;
    const meter = room.meter;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    $w("#datepicker1").value = start;
    $w("#datepicker2").value = end;
    await refreshTenantMeterReport({ meter, start, end });
    bindTenantMeterReportDateChange(meter);
}

async function refreshTenantMeterReport({ meter, start, end }) {
    $w("#datepicker1").disable();
    $w("#datepicker2").disable();
    try {
        const usageSummary = await getUsageSummary({
            clientId: meter.client,
            meterIds: [meter.meterId],
            start,
            end
        });
        renderTenantMeterReportText({ meter, start, end, usageSummary });
        $w("#htmlmeterreport").postMessage({
            type: "drawChart",
            payload: JSON.stringify(usageSummary?.records || [])
        });
    } catch (err) {
        console.error("Tenant Meter Report Error:", err);
        $w("#htmlmeterreport").postMessage({ type: "drawChart", payload: JSON.stringify([]) });
    } finally {
        $w("#datepicker1").enable();
        $w("#datepicker2").enable();
    }
}

function bindTenantMeterReportDateChange(meter) {
    if (tenantMeterReportDateBound) return;
    tenantMeterReportDateBound = true;
    const handler = async () => {
        const start = $w("#datepicker1").value;
        const end = $w("#datepicker2").value;
        if (!start || !end) return;
        await refreshTenantMeterReport({ meter, start, end });
    };
    $w("#datepicker1").onChange(handler);
    $w("#datepicker2").onChange(handler);
}

function renderTenantMeterReportText({ meter, start, end, usageSummary }) {
    const f = (d) =>
        d.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric"
        });
    const usage =
        typeof usageSummary?.total === "number"
            ? `${usageSummary.total.toFixed(2)} kWhz`
            : "--";
    const text = `
Date from: ${f(start)}
Date to: ${f(end)}

Meter ID: ${meter?.meterId ?? "-"}
Balance: ${meter?.balance ?? "-"} kWhz
Rate: ${meter?.rate ?? "-"}
Usage (${f(start)} → ${f(end)}): ${usage}
`;
    $w("#textmeterreportdetail").text = text.trim();
}

/* ===============================
   SMART DOOR
================================ */
async function openSmartDoorSection() {
    try {
        const propId = $w("#dropdownproperty").value;
        if (!propId) return;
        const tenancies = TENANCY_MAP[propId] || [];
        if (!tenancies.length) return;
        const tenancy = tenancies[0];
        const roomId = typeof tenancy.room === "object" ? tenancy.room._id : tenancy.room;

        const dataRes = await getPropertyWithSmartdoor({
            propertyId: tenancy.property?._id || tenancy.property,
            roomId
        });
        if (!dataRes.ok) {
            $w("#textdescriptionsmartdoor").text = "Smart door not configured";
            switchSection("smartdoor");
            return;
        }

        const property = dataRes.property;
        const roomSmartdoor = dataRes.roomSmartdoor;
        const lockIds = [];
        if (property?.smartdoor?.lockId) lockIds.push(property.smartdoor.lockId);
        if (roomSmartdoor?.lockId) lockIds.push(roomSmartdoor.lockId);

        if (!lockIds.length) {
            $w("#textdescriptionsmartdoor").text = "Smart door not configured";
            switchSection("smartdoor");
            return;
        }

        $w("#textdescriptionsmartdoor").text = `${property?.shortname || "Property"} - ${TENANT.fullname}`;
        const firstPasscode =
            Array.isArray(tenancy.passcodes) && tenancy.passcodes.length
                ? tenancy.passcodes[0].password
                : "";
        $w("#inputdoorpin").value = firstPasscode;
        bindBluetoothButton(lockIds, tenancy._id);
        bindSaveDoorPassword(tenancy._id, lockIds);
        switchSection("smartdoor");
    } catch (err) {
        console.error("Open Smart Door Error:", err);
        $w("#textdescriptionsmartdoor").text = `Smart Door Error: ${err.message || "Unknown error"}`;
        switchSection("smartdoor");
    }
}

function bindBluetoothButton(lockIds, tenancyId) {
    $w("#buttonbluetooth").onClick(async () => {
        try {
            $w("#buttonbluetooth").disable();
            $w("#buttonbluetooth").label = "Opening...";
            for (const lockId of lockIds) {
                await remoteUnlock({
                    tenancyId,
                    tenantId: TENANT._id,
                    lockId
                });
            }
            $w("#buttonbluetooth").label = "Door Open";
        } catch (err) {
            console.error(err);
            $w("#buttonbluetooth").label = "Error";
        } finally {
            setTimeout(() => {
                $w("#buttonbluetooth").label = "Bluetooth Open";
                $w("#buttonbluetooth").enable();
            }, 3000);
        }
    });
}

function bindSaveDoorPassword(tenancyId, lockIds) {
    $w("#buttonsavepassword").onClick(async () => {
        try {
            const newPwd = $w("#inputdoorpin").value;
            if (!newPwd) return;
            $w("#buttonsavepassword").disable();
            $w("#buttonbluetooth").disable();
            $w("#inputdoorpin").disable();
            $w("#buttonsavepassword").label = "Saving...";

            const tenancy = TENANCIES.find((t) => t._id === tenancyId);
            const passcodes = Array.isArray(tenancy?.passcodes) ? tenancy.passcodes : [];

            for (const lockId of lockIds) {
                const existing = passcodes.find((p) => p.lockId === lockId);
                if (existing) {
                    await updateTenantPasscode({
                        tenancyId,
                        tenantId: TENANT._id,
                        lockId,
                        newPassword: newPwd
                    });
                } else {
                    await createTenantPasscode({
                        tenancyId,
                        tenantId: TENANT._id,
                        lockId,
                        password: newPwd
                    });
                }
            }

            $w("#buttonsavepassword").label = "Saved";
            setTimeout(async () => {
                $w("#buttonsavepassword").label = "Save Password";
                $w("#buttonsavepassword").enable();
                $w("#buttonbluetooth").enable();
                $w("#inputdoorpin").enable();
                const refresh = await tenantDashboardInit();
                if (refresh.ok) {
                    TENANT = refresh.tenant;
                    TENANCIES = refresh.tenancies || [];
                    buildTenancyMap();
                }
                switchSection("tenantdashboard");
            }, 1500);
        } catch (err) {
            console.error("Door password save error:", err);
            $w("#buttonsavepassword").label = "Save Password";
            $w("#buttonsavepassword").enable();
            $w("#buttonbluetooth").enable();
            $w("#inputdoorpin").enable();
        }
    });
}

/* ===============================
   PROFILE
================================ */
async function openProfileSection() {
    $w("#imagenricfront").collapse();
    $w("#imagenricback").collapse();
    await loadBankDropdownProfile();

    if (!TENANT) {
        $w("#inputfullnametenant").value = "";
        $w("#inputemailtenant").value = CURRENT_USER_EMAIL || "";
        $w("#inputemailtenant").disable();
        $w("#inputcontacttenant").value = "";
        $w("#inputaddresstenant").value = "";
        $w("#inputnrictenant").value = "";
        $w("#dropdownbankname").value = "";
        $w("#inputbankaccountno").value = "";
        $w("#inputbankaccountholder").value = "";
        profileNricFrontUrl = null;
        profileNricBackUrl = null;
        initHtmlUploadProfile();
        initTenantRegNoTypeDropdownForGuest();
        initTenantEntityTypeDropdownForGuest();
        $w("#buttonsaveprofile").label = "Register";
        bindProfileSaveButton();
        switchSection("profile");
        return;
    }

    TENANT = (await tenantDashboardInit()).tenant || TENANT;

    $w("#inputfullnametenant").value = TENANT.fullname || "";
    $w("#inputemailtenant").value = TENANT.email || "";
    $w("#inputemailtenant").disable();
    $w("#inputcontacttenant").value = TENANT.phone || "";
    $w("#inputaddresstenant").value = TENANT.address || "";
    $w("#inputnrictenant").value = TENANT.nric || "";
    $w("#dropdownbankname").value = TENANT.bankName || "";
    $w("#inputbankaccountno").value = TENANT.bankAccount || "";
    $w("#inputbankaccountholder").value = TENANT.accountholder || "";

    if (TENANT.nricFront) {
        $w("#imagenricfront").src = TENANT.nricFront;
        $w("#imagenricfront").expand();
        /* keep #htmluploadbutton1 visible and enabled so guest can replace NRIC front */
    }
    if (TENANT.nricback) {
        $w("#imagenricback").src = TENANT.nricback;
        $w("#imagenricback").expand();
        /* keep #htmluploadbutton2 visible and enabled so guest can replace NRIC back */
    }

    profileNricFrontUrl = null;
    profileNricBackUrl = null;
    initHtmlUploadProfile();

    initTenantRegNoTypeDropdown();
    initTenantEntityTypeDropdown();
    $w("#buttonsaveprofile").label = "Update";
    bindProfileSaveButton();
    switchSection("profile");
}

function initTenantRegNoTypeDropdown() {
    $w("#dropdownregnotype").options = [
        { label: "Select", value: "" },
        { label: "NRIC", value: "NRIC" },
        { label: "BRN", value: "BRN" },
        { label: "PASSPORT", value: "PASSPORT" }
    ];
    $w("#dropdownregnotype").value = TENANT.profile?.reg_no_type || "";
}

function initTenantRegNoTypeDropdownForGuest() {
    $w("#dropdownregnotype").options = [
        { label: "Select", value: "" },
        { label: "NRIC", value: "NRIC" },
        { label: "BRN", value: "BRN" },
        { label: "PASSPORT", value: "PASSPORT" }
    ];
    $w("#dropdownregnotype").value = "";
}

function initTenantEntityTypeDropdownForGuest() {
    $w("#dropdownentitytype").options = [
        { label: "Select", value: "SELECT" },
        { label: "MALAYSIAN_COMPANY", value: "MALAYSIAN_COMPANY" },
        { label: "MALAYSIAN_INDIVIDUAL", value: "MALAYSIAN_INDIVIDUAL" },
        { label: "FOREIGN_COMPANY", value: "FOREIGN_COMPANY" },
        { label: "FOREIGN_INDIVIDUAL", value: "FOREIGN_INDIVIDUAL" },
        { label: "EXEMPTED_PERSON", value: "EXEMPTED_PERSON" }
    ];
    $w("#dropdownentitytype").value = "SELECT";
    applyTenantEntityTypeLogic("SELECT");
    $w("#dropdownentitytype").onChange(() => {
        applyTenantEntityTypeLogic($w("#dropdownentitytype").value);
    });
}

function initTenantEntityTypeDropdown() {
    $w("#dropdownentitytype").options = [
        { label: "Select", value: "SELECT" },
        { label: "MALAYSIAN_COMPANY", value: "MALAYSIAN_COMPANY" },
        { label: "MALAYSIAN_INDIVIDUAL", value: "MALAYSIAN_INDIVIDUAL" },
        { label: "FOREIGN_COMPANY", value: "FOREIGN_COMPANY" },
        { label: "FOREIGN_INDIVIDUAL", value: "FOREIGN_INDIVIDUAL" },
        { label: "EXEMPTED_PERSON", value: "EXEMPTED_PERSON" }
    ];
    const value = TENANT.profile?.entity_type || "SELECT";
    $w("#dropdownentitytype").value = value;
    applyTenantEntityTypeLogic(value);
    $w("#dropdownentitytype").onChange(() => {
        applyTenantEntityTypeLogic($w("#dropdownentitytype").value);
    });
}

function applyTenantEntityTypeLogic(type) {
    $w("#dropdownregnotype").enable();
    $w("#inputnrictenant").enable();
    $w("#inputtaxidno").enable();
    $w("#inputnrictenant").placeholder = "";
    $w("#inputtaxidno").placeholder = "";
    switch (type) {
        case "MALAYSIAN_COMPANY":
            $w("#dropdownregnotype").value = "BRN";
            $w("#inputnrictenant").placeholder = "SSM No";
            $w("#inputtaxidno").placeholder = "TIN No";
            break;
        case "MALAYSIAN_INDIVIDUAL":
            $w("#dropdownregnotype").value = "NRIC";
            $w("#inputnrictenant").placeholder = "NRIC No";
            $w("#inputtaxidno").placeholder = "Tax ID";
            break;
        case "FOREIGN_INDIVIDUAL":
            $w("#dropdownregnotype").value = "PASSPORT";
            $w("#inputnrictenant").placeholder = "Passport No";
            $w("#inputtaxidno").placeholder = "Tax ID";
            break;
        case "FOREIGN_COMPANY":
            $w("#dropdownregnotype").value = "PASSPORT";
            $w("#inputnrictenant").placeholder = "Registration No";
            $w("#inputtaxidno").placeholder = "Tax ID";
            break;
        case "EXEMPTED_PERSON":
            $w("#dropdownregnotype").value = "";
            $w("#inputnrictenant").value = "";
            $w("#inputtaxidno").value = "";
            $w("#dropdownregnotype").disable();
            $w("#inputnrictenant").disable();
            $w("#inputtaxidno").disable();
            break;
        default:
            break;
    }
}

async function loadBankDropdownProfile() {
    const res = await getBanks();
    const items = res.ok && res.items ? res.items : [];
    $w("#dropdownbankname").options = [
        { label: "Select Bank", value: "" },
        ...items.map((b) => ({ label: b.bankname, value: b._id }))
    ];
}

function bindProfileSaveButton() {
    $w("#buttonsaveprofile").onClick(async () => {
        try {
            $w("#buttonsaveprofile").disable();
            $w("#buttonsaveprofile").label = "Saving...";

            const nricFrontUpload = profileNricFrontUrl != null ? profileNricFrontUrl : (TENANT && TENANT.nricFront) || null;
            const nricBackUpload = profileNricBackUrl != null ? profileNricBackUrl : (TENANT && TENANT.nricback) || null;

            const emailForPayload = (TENANT && TENANT.email) || $w("#inputemailtenant").value || CURRENT_USER_EMAIL;
            const payload = {
                fullname: $w("#inputfullnametenant").value,
                email: emailForPayload,
                phone: $w("#inputcontacttenant").value,
                address: $w("#inputaddresstenant").value,
                nric: $w("#inputnrictenant").value,
                bankName: $w("#dropdownbankname").value,
                bankAccount: $w("#inputbankaccountno").value,
                accountholder: $w("#inputbankaccountholder").value,
                profile: {
                    ...(TENANT && TENANT.profile ? TENANT.profile : {}),
                    entity_type: $w("#dropdownentitytype").value,
                    reg_no_type: $w("#dropdownregnotype").value,
                    tax_id_no: $w("#inputtaxidno").value
                },
                nricFront: nricFrontUpload || (TENANT && TENANT.nricFront) || null,
                nricback: nricBackUpload || (TENANT && TENANT.nricback) || null
            };

            await updateTenantProfile(payload);
            const refresh = await tenantDashboardInit();
            if (refresh.ok && refresh.tenant) {
                TENANT = refresh.tenant;
                TENANCIES = refresh.tenancies || [];
                buildTenancyMap();
                /* Ensure dashboard section is ready when returning after register (e.g. first time had no tenant) */
                await initTenantDashboardSection();
            }

            if (TENANT && Array.isArray(TENANT.account) && TENANT.account.length) {
                for (const acc of TENANT.account) {
                    try {
                        await syncTenantForClient({ clientId: acc.clientId });
                    } catch (e) {
                        console.warn("Profile accounting sync failed:", e);
                    }
                }
            }
            await applyTenantProfileGate();

            if (TENANT.nricFront) {
                $w("#imagenricfront").src = TENANT.nricFront;
                $w("#imagenricfront").expand();
                /* keep #htmluploadbutton1 visible so guest can replace */
            }
            if (TENANT.nricback) {
                $w("#imagenricback").src = TENANT.nricback;
                $w("#imagenricback").expand();
                /* keep #htmluploadbutton2 visible so guest can replace */
            }
            profileNricFrontUrl = null;
            profileNricBackUrl = null;

            $w("#buttonsaveprofile").label = "Saved";
            setTimeout(() => {
                $w("#buttonsaveprofile").label = "Update";
                $w("#buttonsaveprofile").enable();
                switchSection("tenantdashboard");
            }, 1200);
        } catch (err) {
            console.error("Profile save error:", err);
            $w("#buttonsaveprofile").label = TENANT ? "Update" : "Register";
            $w("#buttonsaveprofile").enable();
        }
    });
}

async function initHtmlUploadProfile() {
    try {
        const clientId = (TENANCIES && TENANCIES[0] && TENANCIES[0].client) ? (typeof TENANCIES[0].client === "object" ? TENANCIES[0].client._id : TENANCIES[0].client) : null;
        if (!clientId) return;
        const creds = await getUploadCreds();
        if (!creds.ok || !creds.baseUrl) return;
        const initPayload = {
            type: "INIT",
            baseUrl: creds.baseUrl,
            token: creds.token,
            username: creds.username,
            clientId
        };
        $w("#htmluploadbutton1").postMessage({ ...initPayload, uploadId: "nric1", label: "Upload NRIC Front / Passport", accept: "image/*" });
        $w("#htmluploadbutton2").postMessage({ ...initPayload, uploadId: "nric2", label: "Upload NRIC Back", accept: "image/*" });
    } catch (e) {
        console.error("initHtmlUploadProfile", e);
    }
}

/* ===============================
   AGREEMENT
================================ */
let tenantAgreementContext = null;
let tenantAgreementSubmitting = false;
let tenantAgreementRepeaterBound = false;

function initAgreementSection() {
    console.log("▶️ initTenantAgreementSection");
    $w("#boxagreement").hide();
    $w("#signatureinputagreement").clear();
    $w("#buttonagree").disable();
    tenantAgreementContext = null;
    tenantAgreementSubmitting = false;
    loadTenantAgreementList();
    bindTenantAgreementRepeater();
    bindTenantAgreementAgreeButton();
}

function loadTenantAgreementList() {
    const propId = $w("#dropdownproperty").value;
    if (!propId) return;
    const tenancies = TENANCY_MAP[propId] || [];
    if (!tenancies.length) {
        $w("#repeateragreement").data = [];
        return;
    }
    const rows = tenancies.map((t) => {
        const agreements = Array.isArray(t.agreements) ? t.agreements : [];
        const latest = agreements.length
            ? agreements.sort(
                (a, b) =>
                    new Date(b._createdDate || 0).getTime() -
                    new Date(a._createdDate || 0).getTime()
            )[0]
            : null;
        return {
            _id: t._id,
            tenancy: t,
            roomname: t.room?.title_fld || "",
            agreement: latest
        };
    });
    $w("#repeateragreement").data = rows;
}

function bindTenantAgreementRepeater() {
    if (tenantAgreementRepeaterBound) return;
    tenantAgreementRepeaterBound = true;

    $w("#repeateragreement").onItemReady(($item, item) => {
        const btn = $item("#buttonviewagreement");
        btn.enable();
        btn.label = "";
        btn.onClick(() => {});

        const agreement = item.agreement;
        if (!agreement) {
            $item("#textproperty").text = `${item.roomname} | No Agreement`;
            btn.label = "No Agreement";
            btn.disable();
            return;
        }

        const mode = agreement.mode;
        const tenantSigned = !!agreement.tenantsign;
        const ownerSigned = !!agreement.ownersign;
        const operatorSigned = !!agreement.operatorsign;
        const otherSigned = mode === "owner_tenant" ? ownerSigned : operatorSigned;

        if (tenantSigned && otherSigned) {
            $item("#textproperty").text = `${item.roomname} | Complete`;
            btn.label = "View Agreement";
            btn.onClick(async () => {
                btn.disable();
                btn.label = "Loading...";
                if (agreement.url) wixLocation.to(agreement.url);
                else btn.label = "No File";
                setTimeout(() => {
                    btn.label = "View Agreement";
                    btn.enable();
                }, 1500);
            });
            return;
        }

        if (tenantSigned && !otherSigned) {
            $item("#textproperty").text = `${item.roomname} | Pending Other Party`;
            btn.disable();
            btn.label = mode === "owner_tenant" ? "Pending Owner" : "Pending Operator";
            return;
        }

        if (!tenantSigned) {
            $item("#textproperty").text = `${item.roomname} | Pending Signing`;
            btn.label = "Sign Agreement";
            btn.onClick(async () => {
                btn.disable();
                btn.label = "Opening...";
                await openTenantAgreementBox(item.tenancy);
                switchSection("agreement");
                btn.label = "Sign Agreement";
                btn.enable();
            });
            return;
        }
    });
}

async function openTenantAgreementBox(tenancy) {
    tenantAgreementContext = tenancy;
    $w("#boxagreement").hide();
    $w("#signatureinputagreement").clear();
    $w("#buttonagree").disable();

    const latestAgreement = tenancy.agreements?.length
        ? tenancy.agreements.sort(
            (a, b) =>
                new Date(b._createdDate || 0).getTime() -
                new Date(a._createdDate || 0).getTime()
        )[0]
        : null;
    const agreementTemplateId = latestAgreement?.agreementtemplate_id || null;

    const ctxRes = await getAgreementHtml({
        tenancyId: tenancy._id,
        agreementTemplateId,
        staffVars: {}
    });

    if (!ctxRes.ok || !ctxRes.html) return;

    $w("#htmlagreement").postMessage({ type: "render", html: ctxRes.html });
    setTimeout(() => $w("#boxagreement").expand(), 200);
    $w("#signatureinputagreement").onChange(() => {
        $w("#signatureinputagreement").value?.length
            ? $w("#buttonagree").enable()
            : $w("#buttonagree").disable();
    });
}

function bindTenantAgreementAgreeButton() {
    $w("#buttonagree").onClick(async () => {
        if (tenantAgreementSubmitting || !tenantAgreementContext) return;
        tenantAgreementSubmitting = true;
        const btn = $w("#buttonagree");
        btn.disable();
        btn.label = "Submitting...";

        try {
            const signatureValue = $w("#signatureinputagreement").value || "";
            if (!signatureValue) throw new Error("Signature required");

            const agreements = Array.isArray(tenantAgreementContext.agreements)
                ? tenantAgreementContext.agreements
                : [];
            const latest = agreements.sort(
                (a, b) =>
                    new Date(b._createdDate || 0).getTime() -
                    new Date(a._createdDate || 0).getTime()
            )[0];
            const agreementId = latest?._id;
            if (!agreementId) throw new Error("Agreement not found");

            const freshRes = await getAgreement({ agreementId });
            if (!freshRes.ok || !freshRes.agreement) throw new Error("Agreement not found");
            const freshAgreement = freshRes.agreement;
            const mode = freshAgreement.mode;
            const fullyCompleted =
                mode === "owner_tenant"
                    ? freshAgreement.ownersign && signatureValue
                    : freshAgreement.operatorsign && signatureValue;
            const status = fullyCompleted ? "completed" : "pending";

            await updateAgreementTenantSign({
                agreementId,
                tenantsign: signatureValue,
                status
            });

            btn.label = "Signed";
            setTimeout(async () => {
                const refresh = await tenantDashboardInit();
                if (refresh.ok) {
                    TENANT = refresh.tenant;
                    TENANCIES = refresh.tenancies || [];
                    buildTenancyMap();
                }
                renderDashboardRepeater();
                loadTenantAgreementList();
                await applyTenantProfileGate();
                $w("#boxagreement").collapse();
                $w("#signatureinputagreement").clear();
                btn.label = "Agree";
                btn.disable();
                tenantAgreementSubmitting = false;
                tenantAgreementContext = null;
                switchSection("tenantdashboard");
            }, 1000);
        } catch (err) {
            console.error("Tenant agreement failed:", err);
            btn.label = "Agree";
            btn.enable();
            tenantAgreementSubmitting = false;
        }
    });
}

async function refreshTenancies() {
    const res = await tenantDashboardInit();
    if (res.ok && res.tenant) {
        TENANT = res.tenant;
        TENANCIES = res.tenancies || [];
        buildTenancyMap();
    }
}

/* ===============================
   PAYMENT
================================ */
async function openPaymentSection() {
    const propId = $w("#dropdownproperty").value;
    if (!propId) return;
    const tenancies = TENANCY_MAP[propId] || [];
    if (!tenancies.length) return;
    const tenancy = tenancies[0];

    const res = await getRentalList({ tenancyId: tenancy._id });
    const items = res.ok && res.items ? res.items : [];

    if (!items.length) {
        $w("#repeaterpayment").data = [];
        switchSection("payment");
        return;
    }

    const currency = tenancy?.client?.currency?.toUpperCase() || "RM";
    const now = new Date();
    const rows = items.map((i) => {
        const due = i.dueDate ? new Date(i.dueDate) : null;
        const isPaid = !!i.isPaid;
        const isOverdue = !isPaid && due && due < now;
        return {
            ...i,
            _id: i._id,
            currency,
            isPaid,
            isOverdue,
            formattedDate: formatPaymentDate(i.dueDate),
            formattedAmount: `${currency} ${Number(i.amount || 0).toFixed(2)}`
        };
    });

    rows.sort((a, b) => {
        if (a.isPaid && !b.isPaid) return 1;
        if (!a.isPaid && b.isPaid) return -1;
        if (!a.isPaid && !b.isPaid) {
            if (a.isOverdue && !b.isOverdue) return -1;
            if (!a.isOverdue && b.isOverdue) return 1;
            const da = a.dueDate ? new Date(a.dueDate).getTime() : 0;
            const db = b.dueDate ? new Date(b.dueDate).getTime() : 0;
            return da - db;
        }
        return 0;
    });

    $w("#repeaterpayment").data = rows;
    bindPaymentRepeater();
    updateTotalPayment();
    switchSection("payment");
}

function bindPaymentRepeater() {
    $w("#repeaterpayment").onItemReady(($item, item) => {
        const propertyText = $item("#textpropertypayment");
        const descText = $item("#textdescriptionpayment");
        const dateText = $item("#textdatepayment");
        const invoiceBtn = $item("#buttoninvoicepayment");
        const receiptBtn = $item("#buttonreceiptpayment");
        const checkbox = $item("#checkboxpayment");

        propertyText.text = item.property?.shortname || "";
        descText.text = item.title || "";
        dateText.text = item.formattedDate || "";
        $item("#textamountpayment").text = item.formattedAmount || "";

        if (item.isOverdue) {
            propertyText.style.color = "#FF0000";
            descText.style.color = "#FF0000";
            dateText.style.color = "#FF0000";
        } else {
            propertyText.style.color = "#000000";
            descText.style.color = "#000000";
            dateText.style.color = "#000000";
        }

        if (item.invoiceurl) {
            invoiceBtn.show();
            invoiceBtn.onClick(() => wixLocation.to(item.invoiceurl));
            invoiceBtn.style.backgroundColor = item.isPaid
                ? "#00C2A8"
                : item.isOverdue
                    ? "#FF0000"
                    : "#000000";
        } else {
            invoiceBtn.hide();
        }

        if (item.receipturl) {
            receiptBtn.show();
            receiptBtn.onClick(() => wixLocation.to(item.receipturl));
        } else {
            receiptBtn.hide();
        }

        if (item.isPaid) {
            checkbox.hide();
        } else {
            checkbox.show();
            checkbox.checked = false;
            checkbox.onChange(() => {
                const selected = getSelectedPayments();
                if (selected.length > 10) {
                    checkbox.checked = false;
                }
                updateTotalPayment();
            });
        }
    });
}

function formatPaymentDate(d) {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
}

function getSelectedPayments() {
    const selected = [];
    $w("#repeaterpayment").forEachItem(($item, itemData) => {
        if ($item("#checkboxpayment").checked) selected.push(itemData);
    });
    return selected;
}

function updateTotalPayment() {
    let total = 0;
    let count = 0;
    $w("#repeaterpayment").forEachItem(($item, itemData) => {
        if ($item("#checkboxpayment").checked) {
            total += Number(itemData.amount || 0);
            count += 1;
        }
    });
    const currency = $w("#repeaterpayment").data[0]?.currency || "RM";
    if (total > 0) {
        const maxHint = count >= 10 ? " (max 10 selected)" : "";
        $w("#texttotalpayment").text = `Total: ${currency} ${total.toFixed(2)}${maxHint}`;
        $w("#texttotalpayment").show();
    } else {
        $w("#texttotalpayment").hide();
    }
}

function isTenantProfileComplete() {
    if (!TENANT) return false;
    const profile = TENANT.profile || {};
    const requiredBasic = TENANT.fullname && TENANT.phone && TENANT.nric;
    const requiredProfile =
        profile.entity_type &&
        profile.entity_type !== "SELECT" &&
        profile.reg_no_type;
    const needTax = profile.entity_type !== "EXEMPTED_PERSON";
    const taxOk = !needTax || profile.tax_id_no;
    return !!(requiredBasic && requiredProfile && taxOk);
}

/** True if any tenancy has an agreement that tenant has not signed. */
function hasAnyUnsignedAgreement() {
    if (!Array.isArray(TENANCIES)) return false;
    for (const t of TENANCIES) {
        const agreements = Array.isArray(t.agreements) ? t.agreements : [];
        if (!agreements.length) continue;
        const latest = agreements.sort(
            (a, b) =>
                new Date(b._createdDate || 0).getTime() -
                new Date(a._createdDate || 0).getTime()
        )[0];
        if (!latest) continue;
        const validMode =
            latest.mode === "owner_tenant" || latest.mode === "tenant_operator";
        if (validMode && !latest.tenantsign) return true;
    }
    return false;
}

/** True if the currently selected property's tenancy has an agreement that tenant has not signed. No agreement or signed → false. */
function currentTenancyHasUnsignedAgreement() {
    const propId = $w("#dropdownproperty").value;
    if (!propId) return false;
    const tenancies = TENANCY_MAP[propId] || [];
    const tenancy = tenancies[0];
    if (!tenancy) return false;
    const agreements = Array.isArray(tenancy.agreements) ? tenancy.agreements : [];
    if (!agreements.length) return false;
    const latest = agreements.sort(
        (a, b) =>
            new Date(b._createdDate || 0).getTime() -
            new Date(a._createdDate || 0).getTime()
    )[0];
    if (!latest) return false;
    const validMode =
        latest.mode === "owner_tenant" || latest.mode === "tenant_operator";
    return !!(validMode && !latest.tenantsign);
}

/**
 * Apply gate by tenant-dashboard state. Per selected property: not every tenancy has an agreement.
 * 1) No tenantdetail: #buttonprofile, #buttonfeedback
 * 2) Has profile, no tenancy: #buttonprofile, #buttonfeedback, #dropdownproperty, #buttonapprove, #buttonreject
 * 3) Current tenancy has unsigned agreement: + #buttonagreement only (no #buttonpayment)
 * 4) Current tenancy has no agreement / signed: + #buttonagreement, #buttonpayment
 * 5) Paid (for current property): + #buttonmeter, #buttonsmartdoor
 */
async function applyTenantProfileGate() {
    const complete = isTenantProfileComplete();
    const hasTenancy = TENANCIES && TENANCIES.length > 0;
    const navIds = ["#buttonmeter", "#buttonagreement", "#buttonsmartdoor", "#buttonpayment", "#buttonfeedback", "#dropdownproperty"];

    /* State 1: profile not complete → only profile + feedback */
    if (!complete) {
        navIds.filter((id) => id !== "#buttonfeedback").forEach((id) => {
            const el = $w(id);
            if (el) el.disable();
        });
        $w("#buttonprofile").enable();
        try { $w("#buttonfeedback").enable(); } catch (_) {}
        return;
    }

    $w("#buttonprofile").enable();
    try { $w("#buttonfeedback").enable(); } catch (_) {}

    /* State 2: profile complete but no tenancy → dropdown + approve/reject (repeater); no agreement/payment/meter/smartdoor */
    if (!hasTenancy) {
        $w("#dropdownproperty").enable();
        ["#buttonmeter", "#buttonagreement", "#buttonsmartdoor", "#buttonpayment"].forEach((id) => {
            const el = $w(id);
            if (el) el.disable();
        });
        return;
    }

    /* State 3–5: has tenancy — gate by current selected property only (not every tenancy has an agreement) */
    $w("#dropdownproperty").enable();
    const currentUnsigned = currentTenancyHasUnsignedAgreement();
    if (currentUnsigned) {
        $w("#buttonagreement").enable();
        ["#buttonmeter", "#buttonsmartdoor", "#buttonpayment"].forEach((id) => {
            const el = $w(id);
            if (el) el.disable();
        });
        try { $w("#buttonfeedback").enable(); } catch (_) {}
        return;
    }

    /* Current tenancy: no agreement or already signed → enable agreement + payment, then rent gate for meter/smartdoor */
    navIds.forEach((id) => {
        const el = $w(id);
        if (el) el.enable();
    });
    await applyRentGateForCurrentProperty();
}

/**
 * For the currently selected property, if that tenancy has any unpaid rental, disable #buttonmeter and #buttonsmartdoor.
 * Call after dropdownproperty change and when profile gate allows all actions.
 */
async function applyRentGateForCurrentProperty() {
    const propId = $w("#dropdownproperty").value;
    if (!propId) return;
    const tenancies = TENANCY_MAP[propId] || [];
    const tenancy = tenancies[0];
    if (!tenancy || !tenancy._id) {
        $w("#buttonmeter").enable();
        $w("#buttonsmartdoor").enable();
        return;
    }
    try {
        const res = await getRentalList({ tenancyId: tenancy._id });
        const items = res.ok && res.items ? res.items : [];
        const hasUnpaid = items.some((i) => !i.isPaid);
        if (hasUnpaid) {
            $w("#buttonmeter").disable();
            $w("#buttonsmartdoor").disable();
        } else {
            $w("#buttonmeter").enable();
            $w("#buttonsmartdoor").enable();
        }
    } catch (_) {
        $w("#buttonmeter").enable();
        $w("#buttonsmartdoor").enable();
    }
}
