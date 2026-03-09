/* ======================================================
   Help Page Frontend
   数据通过 backend/saas/help.jsw 请求 ECS；不读 Wix CMS。
   FAQ 列表：getFaqPage(page)。工单提交：submitTicket(payload)。
   getAccessContext 来自 backend/access/manage（可选，用于 clientId）。
====================================================== */

import wixWindow from 'wix-window';
import wixUsers from 'wix-users';
import { getAccessContext } from 'backend/access/manage';
import { getFaqPage, getUploadCreds, submitTicket } from 'backend/saas/help';

let accessCtx = null;
let ticketPhotoUrl = null;
let ticketVideoUrl = null;
let helpUploadMessageBound = false;
let currentHelpMode = 'help';
let currentPage = 1;
const PAGE_SIZE = 10;

$w.onReady(async function () {
    $w('#sectionhelp').collapse();
    $w('#sectionfaq').expand();

    accessCtx = await getAccessContext();
    if (!accessCtx?.ok) {
        const msg = accessCtx.reason === 'NO_PERMISSION' ? "You don't have permission" : "You don't have account yet";
        try { $w('#textstatusloading').text = msg; $w('#textstatusloading').show(); } catch (_) {}
        try { $w('#texttitlehelp').text = msg; } catch (_) {}
        return;
    }
    bindCloseButtons();
    bindMenu();
    bindHelpButtons();
    bindHelpUploadMessage();
    bindTicketActions();
    await loadFaqPage(1);
});

/* ===============================
   SECTION SWITCH
================================= */

function switchSection(key) {
    $w('#sectionfaq').collapse();
    $w('#sectionhelp').collapse();
    if (key === 'faq') $w('#sectionfaq').expand();
    if (key === 'help') $w('#sectionhelp').expand();
}

/* ===============================
   FAQ SECTION
================================= */

async function loadFaqPage(page) {
    currentPage = page;
    const res = await getFaqPage(page, PAGE_SIZE);
    if (!res.ok || !res.items) {
        $w('#repeaterfaq').data = [];
        $w('#paginationhelp').totalPages = 1;
        $w('#paginationhelp').currentPage = 1;
        return;
    }
    $w('#repeaterfaq').data = res.items;
    $w('#paginationhelp').totalPages = Math.max(1, Math.ceil((res.totalCount || 0) / PAGE_SIZE));
    $w('#paginationhelp').currentPage = page;
}

$w('#repeaterfaq').onItemReady(($item, item) => {
    $item('#texthelptitle').text = item.title || '';
    $item('#buttonhelpdetail').onClick(() => {
        if (item.docs) {
            wixWindow.openLightbox('PDFViewer', { url: item.docs });
        }
    });
});

$w('#paginationhelp').onChange(async (event) => {
    await loadFaqPage(event.target.currentPage);
});

/* ===============================
   MENU (Hover)
================================= */

function bindMenu() {
    const isDesktop = wixWindow.formFactor === 'Desktop';
    $w('#boxmenu').hide();

    if (isDesktop) {
        $w('#buttonmenu').onMouseIn(() => {
            $w('#boxmenu').show();
            $w('#boxmenu').expand();
        });
        $w('#boxmenu').onMouseOut(() => {
            $w('#boxmenu').hide();
            $w('#boxmenu').collapse();
        });
    } else {
        $w('#buttonmenu').onClick(() => {
            if ($w('#boxmenu').isVisible) {
                $w('#boxmenu').hide();
                $w('#boxmenu').collapse();
            } else {
                $w('#boxmenu').show();
                $w('#boxmenu').expand();
            }
        });
    }
}

/* ===============================
   HELP MODE SWITCH
================================= */

function bindHelpButtons() {
    $w('#buttonrequest').onClick(() => openHelpMode('request'));
    $w('#buttonfeedback').onClick(() => openHelpMode('feedback'));
    $w('#buttonhelp').onClick(() => openHelpMode('help'));
}

function openHelpMode(mode) {
    currentHelpMode = mode;
    let title = 'Help';
    if (mode === 'request') title = 'Request';
    if (mode === 'feedback') title = 'Feedback';

    $w('#texttitlehelp').text = title;
    $w('#inputdescription').value = '';
    ticketPhotoUrl = null;
    ticketVideoUrl = null;
    $w('#boxticket').hide();
    switchSection('help');
    initHtmlUploadTicket();
}

function bindHelpUploadMessage() {
    if (helpUploadMessageBound) return;
    helpUploadMessageBound = true;
    try {
        $w('#helpuploadbutton').onMessage((event) => {
            const d = event.data;
            if (d && d.type === 'UPLOAD_SUCCESS' && d.url) {
                if (d.mediaType === 'video') {
                    ticketVideoUrl = d.url;
                    ticketPhotoUrl = null;
                } else {
                    ticketPhotoUrl = d.url;
                    ticketVideoUrl = null;
                }
            }
        });
    } catch (_) {}
}

async function initHtmlUploadTicket() {
    try {
        const clientId = accessCtx?.client?.id || null;
        if (!clientId) return;
        const creds = await getUploadCreds();
        if (!creds.ok || !creds.baseUrl) return;
        $w('#helpuploadbutton').postMessage({
            type: 'INIT',
            baseUrl: creds.baseUrl,
            token: creds.token,
            username: creds.username,
            clientId,
            uploadId: 'ticket',
            label: 'Upload photo or video',
            accept: 'image/*,video/*'
        });
    } catch (e) {
        console.error('initHtmlUploadTicket', e);
    }
}

/* ===============================
   TICKET SUBMIT
================================= */

function bindTicketActions() {
    $w('#buttonsubmit').onClick(async () => {
        const description = ($w('#inputdescription').value || '').trim();
        if (!description) return;

        const btn = $w('#buttonsubmit');
        btn.disable();

        try {
            const res = await submitTicket({
                mode: currentHelpMode,
                description,
                video: ticketVideoUrl || undefined,
                photo: ticketPhotoUrl || undefined,
                clientId: accessCtx?.client?.id || undefined
            });

            if (res.ok && res.ticketId) {
                $w('#textticket').text = `Your Ticket ID: ${res.ticketId}`;
                $w('#boxticket').show();
                ticketPhotoUrl = null;
                ticketVideoUrl = null;
            }
        } catch (err) {
            console.error(err);
        }

        btn.enable();
    });
}

/* ===============================
   CLOSE BUTTONS
================================= */

function bindCloseButtons() {
    $w('#buttonclosefeedback').onClick(() => {
        switchSection('faq');
    });

    $w('#buttoncloseticket').onClick(() => {
        $w('#boxticket').hide();
        switchSection('faq');
    });
}
