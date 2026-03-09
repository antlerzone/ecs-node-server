/* ======================================================
   CNYIoT Malaysia 测试页 – 直连后端（绕过 proxy）
   - #button1: Ping（login），完整 console 显示在 #text1 + backend 日志
   - #button2: 主号 Get Prices，完整 console + 结果显示在 #text1
   - 后端路由: /api/cnyiotmalaysia/ping, /api/cnyiotmalaysia/get-prices
   - 需配置 env: CNYIOT_MALAYSIA_BASE_URL, CNYIOT_LOGIN_NAME, CNYIOT_LOGIN_PSW, CNYIOT_AES_KEY, CNYIOT_API_ID
====================================================== */

import { pingMalaysia, getPricesMalaysia } from 'backend/saas/cnyiotmalaysia';

function formatConsoleLines(lines) {
    if (!Array.isArray(lines) || lines.length === 0) return '(no console lines)';
    return lines.join('\n');
}

$w.onReady(() => {
    const text1 = $w('#text1');
    if (text1) text1.text = '';

    $w('#button1').onClick(async () => {
        const textEl = $w('#text1');
        if (textEl) textEl.text = 'Ping 请求中…';
        try {
            const data = await pingMalaysia();
            const lines = data && Array.isArray(data.console) ? data.console : [];
            const consoleBlock = formatConsoleLines(lines);
            const resultSummary = data && data.pingResult
                ? `\n\n[Ping 结果] result=${data.pingResult.result} ok=${!!data.ok}\n${JSON.stringify(data.pingResult, null, 2)}`
                : `\n\n[Ping] ok=${!!(data && data.ok)} reason=${(data && data.reason) || 'unknown'}`;
            const full = consoleBlock + resultSummary;
            if (textEl) textEl.text = full;
        } catch (e) {
            const msg = (e && e.message) ? String(e.message) : String(e);
            if (textEl) textEl.text = `Ping 异常: ${msg}`;
            console.error('[cnyiotmalaysia] ping error', e);
        }
    });

    $w('#button2').onClick(async () => {
        const textEl = $w('#text1');
        if (textEl) textEl.text = 'Get Prices 请求中…';
        try {
            const data = await getPricesMalaysia();
            const lines = data && Array.isArray(data.console) ? data.console : [];
            const consoleBlock = formatConsoleLines(lines);
            const resultSummary = data && (data.data !== undefined)
                ? `\n\n[Get Prices 结果] result=${data.result} ok=${!!data.ok}\nvalue count=${Array.isArray(data.data) ? data.data.length : 0}\n${JSON.stringify(data.data, null, 2)}`
                : `\n\n[Get Prices] ok=${!!(data && data.ok)} reason=${(data && data.reason) || 'unknown'}`;
            const full = consoleBlock + resultSummary;
            if (textEl) textEl.text = full;
        } catch (e) {
            const msg = (e && e.message) ? String(e.message) : String(e);
            if (textEl) textEl.text = `Get Prices 异常: ${msg}`;
            console.error('[cnyiotmalaysia] getPrices error', e);
        }
    });
});
