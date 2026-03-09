/**
 * #button1 点击后调用 create user：democoliving / 0123456789，tel=60122113361，发去的 payload 与 CNYIOT 返回的 body 显示在 #text1。
 * 若报 createCnyiotUser is not a function：请在 Wix 后台 backend/saas/companysetting 中加入并导出 createCnyiotUser（见 docs/wix/jsw/velo-backend-saas-companysetting.jsw.snippet.js）。
 * 页面需有 Button #button1、Text #text1。
 */
import { createCnyiotUser } from 'backend/saas/companysetting';

$w.onReady(function () {
    $w('#button1').onClick(async function () {
        const textEl = $w('#text1');
        if (textEl) textEl.text = 'Loading...';
        try {
            const res = await createCnyiotUser({ loginName: 'democoliving', password: '0123456789', tel: '60122113361' });
            if (res && res.ok === false) {
                const reason = res.reason || 'Unknown';
                let show = 'Error: ' + reason;
                if (reason === 'BACKEND_ERROR') {
                    show = '无法连接后端（请检查 Wix Secrets：ecs_base_url、ecs_token、ecs_username 是否已配置，或 ECS 是否可访问）';
                } else if (reason === 'CNYIOT_NOT_CONFIGURED') {
                    show = '当前户口尚未连接 Meter（CNYIOT），请先在 System Integration 连接 Meter。';
                } else if (reason === 'ACCESS_DENIED' || reason === 'NO_CLIENT_ID') {
                    show = '无权限或未识别到户口，请确认已登录且有 Integration 权限。';
                }
                if (textEl) textEl.text = show;
                return;
            }
            const reqPayload = res.requestPayload;
            const resPayload = res.responsePayload;
            let show = '';
            if (reqPayload != null) {
                show += '--- 发去 CNYIOT 的 payload ---\n' + JSON.stringify(reqPayload, null, 2) + '\n\n';
            }
            if (resPayload != null) {
                show += '--- CNYIOT 返回的 body ---\n' + JSON.stringify(resPayload, null, 2);
            }
            if (textEl) textEl.text = show || 'OK (no payloads)';
        } catch (e) {
            console.error('[cnyiot-users]', e);
            if (textEl) textEl.text = 'Error: ' + (e && e.message ? e.message : 'Request failed');
        }
    });
});
