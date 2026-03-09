/**
 * Meter Setting API – list/filters/get/update/delete/insert meters, groups, providers,
 * usage, sync, client topup. All POST with email in body; client from access context.
 */

const express = require('express');
const router = express.Router();
const { getAccessContextByEmail } = require('../access/access.service');
const {
  getMeters,
  getMeterFilters,
  getMeter,
  updateMeter,
  updateMeterStatus,
  deleteMeter,
  insertMeters,
  getAddMeterRequestBody,
  getActiveMeterProvidersByClient,
  getUsageSummary,
  syncMeterByCmsMeterId,
  clientTopup,
  loadGroupList,
  deleteGroup,
  submitGroup,
  previewNewMeters,
  insertMetersFromPreview
} = require('./metersetting.service');
const { requestNewToken, getValidCnyIotTokenForPlatform } = require('../cnyiot/lib/cnyiotToken.service');
const { callCnyIotWithToken } = require('../cnyiot/wrappers/cnyiotRequest');
const { getClientTel } = require('../cnyiot/lib/getClientTel');

function getEmail(req) {
  return req.body?.email ?? req.query?.email ?? null;
}

async function requireClient(req, res, next) {
  const email = getEmail(req);
  if (!email) {
    return res.status(400).json({ ok: false, reason: 'NO_EMAIL' });
  }
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) {
    return res.status(403).json({ ok: false, reason: ctx.reason || 'ACCESS_DENIED' });
  }
  const clientId = ctx.client?.id;
  if (!clientId) {
    return res.status(403).json({ ok: false, reason: 'NO_CLIENT' });
  }
  req.ctx = ctx;
  req.clientId = clientId;
  next();
}

/** POST /api/metersetting/list – body: { email, keyword?, propertyId?, filter?, sort?, page?, pageSize?, limit? } */
router.post('/list', requireClient, async (req, res, next) => {
  const body = { ...req.body };
  if (body.email) body.email = body.email.slice(0, 8) + '***';
  console.log('[metersetting/list] request body=', JSON.stringify(body));
  try {
    const opts = {
      keyword: req.body?.keyword,
      propertyId: req.body?.propertyId,
      filter: req.body?.filter,
      sort: req.body?.sort,
      page: req.body?.page,
      pageSize: req.body?.pageSize,
      limit: req.body?.limit
    };
    const result = await getMeters(req.clientId, opts);
    console.log('[metersetting/list] response itemsCount=', result?.items?.length ?? 0, 'total=', result?.total ?? 0, 'resultKeys=', result ? Object.keys(result) : []);
    if (result?.items?.length <= 3) {
      console.log('[metersetting/list] response body (full)=', JSON.stringify(result));
    } else {
      console.log('[metersetting/list] response body (first 2 items)=', JSON.stringify({ ...result, items: (result.items || []).slice(0, 2) }));
    }
    res.json(result);
  } catch (err) {
    console.log('[metersetting/list] error=', err?.message, 'stack=', err?.stack?.slice(0, 200));
    next(err);
  }
});

/** POST /api/metersetting/filters – body: { email } → { properties, services } */
router.post('/filters', requireClient, async (req, res, next) => {
  try {
    const result = await getMeterFilters(req.clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/metersetting/get – body: { email, meterId } */
router.post('/get', requireClient, async (req, res, next) => {
  try {
    const meterId = req.body?.meterId;
    if (!meterId) {
      return res.status(400).json({ ok: false, reason: 'NO_METER_ID' });
    }
    const meter = await getMeter(req.clientId, meterId);
    if (!meter) {
      return res.status(404).json({ ok: false, reason: 'METER_NOT_FOUND' });
    }
    res.json(meter);
  } catch (err) {
    next(err);
  }
});

/** POST /api/metersetting/update – body: { email, meterId, title?, rate?, mode?, status? } */
router.post('/update', requireClient, async (req, res, next) => {
  try {
    const meterId = req.body?.meterId;
    if (!meterId) {
      return res.status(400).json({ ok: false, reason: 'NO_METER_ID' });
    }
    const data = {
      title: req.body?.title,
      rate: req.body?.rate,
      mode: req.body?.mode,
      status: req.body?.status
    };
    const result = await updateMeter(req.clientId, meterId, data);
    res.json(result);
  } catch (err) {
    if (err.message === 'METER_NOT_FOUND') return res.status(404).json({ ok: false, reason: err.message });
    if (err.message === 'INVALID_RATE') return res.status(400).json({ ok: false, reason: err.message });
    if (err.message === 'RATE_NOT_IN_PRICE_LIST') return res.status(400).json({ ok: false, reason: err.message });
    if (err.message === 'RATE_CREATE_FAILED') return res.status(400).json({ ok: false, reason: err.message });
    next(err);
  }
});

/** POST /api/metersetting/update-status – body: { email, meterId, status } */
router.post('/update-status', requireClient, async (req, res, next) => {
  try {
    const meterId = req.body?.meterId;
    const status = req.body?.status !== false;
    if (!meterId) {
      return res.status(400).json({ ok: false, reason: 'NO_METER_ID' });
    }
    await updateMeterStatus(req.clientId, meterId, status);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'METER_NOT_FOUND') return res.status(404).json({ ok: false, reason: err.message });
    next(err);
  }
});

/** POST /api/metersetting/delete – body: { email, meterId } */
router.post('/delete', requireClient, async (req, res, next) => {
  try {
    const meterId = req.body?.meterId;
    if (!meterId) {
      return res.status(400).json({ ok: false, reason: 'NO_METER_ID' });
    }
    await deleteMeter(req.clientId, meterId);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'METER_NOT_FOUND') return res.status(404).json({ ok: false, reason: err.message });
    next(err);
  }
});

/** POST /api/metersetting/insert – body: { email, records: [{ meterId, title, name?, mode? }] } */
router.post('/insert', requireClient, async (req, res, next) => {
  try {
    const records = req.body?.records;
    console.log('[metersetting-add] API insert clientId=', req.clientId, 'records=', JSON.stringify(records));
    if (!Array.isArray(records)) {
      console.log('[metersetting-add] API reject NO_RECORDS');
      return res.status(400).json({ ok: false, reason: 'NO_RECORDS' });
    }
    const result = await insertMeters(req.clientId, records);
    console.log('[metersetting-add] API success result=', JSON.stringify(result));
    res.json(result);
  } catch (err) {
    console.log('[metersetting-add] API ERROR:', err.message, err.stack);
    if (err.message === 'CLIENT_MUST_HAVE_CNYIOT_SUBUSER') {
      return res.status(400).json({ ok: false, reason: 'CLIENT_MUST_HAVE_CNYIOT_SUBUSER' });
    }
    if (err.message && err.message.startsWith('CNYIOT_ADD_FAILED_')) {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    if (err.message && (err.message.startsWith('CNYIOT_LOGIN_FAILED') || err.message === 'CNYIOT_NOT_CONFIGURED' || err.message === 'CNYIOT_ACCOUNT_INVALID')) {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/metersetting/debug-insert – body: { email, records } → { body, result, error? } for display in #text1 */
router.post('/debug-insert', requireClient, async (req, res, next) => {
  try {
    const records = req.body?.records;
    if (!Array.isArray(records)) {
      return res.status(400).json({ ok: false, reason: 'NO_RECORDS', body: null });
    }
    const loginName = req.body?.loginName;
    const password = req.body?.password;
    const subuserIdFromBody = req.body?.subuserId != null ? String(req.body.subuserId) : null;
    if (loginName && password) {
      const stepLog = [];
      let failedAt = null;
      let subuserId = subuserIdFromBody;
      try {
        const token = await getValidCnyIotTokenForPlatform();
        stepLog.push('0) token: 使用主账号 (platform)');
        console.log('[debug-insert] 0) platform token OK');

        // --- Step A: 主账号 getUsers，拿子账号 loginName 对应的 user id (Station_index) ---
        stepLog.push('A) 主账号 getUsers: start');
        let usersRes;
        try {
          usersRes = await callCnyIotWithToken({
            rawApiKey: token.apiKey,
            loginID: token.loginID,
            method: 'getUsers',
            body: {}
          });
        } catch (e) {
          stepLog.push(`A) getUsers: FAIL - ${e.message || String(e)}`);
          console.error('[debug-insert] Step A getUsers threw', e);
          return res.json({ body: null, result: null, error: `A) getUsers 失败: ${e.message}`, stepLog, failedAt: 'getUsers' });
        }
        const userList = Array.isArray(usersRes?.value) ? usersRes.value : [];
        console.log('[debug-insert] A) getUsers OK', { result: usersRes?.result, count: userList.length, value: userList });
        const loginLower = String(loginName).trim().toLowerCase();
        let foundUser = userList.find(u => String(u.adminID || u.adminid || '').trim().toLowerCase() === loginLower);
        if (!foundUser) {
          foundUser = userList.find(u => {
            const aid = String(u.adminID || u.adminid || '').trim().toLowerCase();
            return aid.endsWith('_' + loginLower) || aid === loginLower;
          });
        }
        if (!foundUser && subuserId == null) {
          stepLog.push(`A) getUsers: 未找到 loginName=${loginName}，无法得到 user id`);
          console.warn('[debug-insert] A) user not found for loginName', loginName, 'list count=', userList.length);
          return res.json({ body: null, result: null, error: `未找到用户 ${loginName}，请先建子账号或传 subuserId`, stepLog, failedAt: 'getUsers', usersCount: userList.length });
        }
        if (foundUser) {
          subuserId = String(foundUser.Station_index ?? foundUser.station_index ?? subuserId ?? '');
          stepLog.push(`A) getUsers: OK, user id (Station_index)=${subuserId} loginName=${loginName}`);
          console.log('[debug-insert] A) user id (Station_index)', subuserId, 'for', loginName);
        }
        if (!subuserId) {
          return res.json({ body: null, result: null, error: '缺少 subuserId（getUsers 未找到或未传）', stepLog, failedAt: 'getUsers' });
        }

        // --- Step B: 主账号 getPrices ---
        stepLog.push('B) 主账号 getPrices: start');
        let pricesRes;
        try {
          pricesRes = await callCnyIotWithToken({
            rawApiKey: token.apiKey,
            loginID: token.loginID,
            method: 'getPrices',
            body: { ptype: -1, offset: -1, limit: -1 }
          });
        } catch (e) {
          stepLog.push(`B) getPrices(主): FAIL - ${e.message || String(e)}`);
          console.error('[debug-insert] Step B getPrices threw', e);
          return res.json({ body: null, result: null, error: `B) getPrices 失败: ${e.message}`, stepLog, failedAt: 'getPrices' });
        }
        const priceList = Array.isArray(pricesRes?.value) ? pricesRes.value : [];
        const priceId = (priceList[0] && (priceList[0].PriceID ?? priceList[0].priceId)) != null
          ? String(priceList[0].PriceID ?? priceList[0].priceId)
          : '301024';
        stepLog.push(`B) 主账号 getPrices: OK, count=${priceList.length}, priceId=${priceId}`);
        console.log('[debug-insert] B) 主账号 getPrices OK', { result: pricesRes?.result, count: priceList.length, priceId });

        // --- Step C: 子账号 getPrices，看子账号是否可以 ---
        stepLog.push('C) 子账号 getPrices: start (子账号是否可以)');
        let subPricesRes = null;
        try {
          const subToken = await requestNewToken({ username: loginName, password });
          subPricesRes = await callCnyIotWithToken({
            rawApiKey: subToken.apiKey,
            loginID: subToken.loginID,
            method: 'getPrices',
            body: { ptype: -1, offset: -1, limit: -1 }
          });
          const subOk = subPricesRes?.result === 200 || subPricesRes?.result === 0;
          stepLog.push(`C) 子账号 getPrices: ${subOk ? 'OK' : 'FAIL result=' + (subPricesRes?.result ?? '')} (子账号${subOk ? '可以' : '不可以'})`);
          console.log('[debug-insert] C) 子账号 getPrices', subOk ? 'OK' : 'FAIL', subPricesRes?.result, subPricesRes?.value);
        } catch (e) {
          stepLog.push(`C) 子账号 getPrices: FAIL - ${e.message || String(e)} (子账号不可以)`);
          console.log('[debug-insert] C) 子账号 getPrices threw', e.message);
        }

        const tel = await getClientTel(req.clientId).catch(() => '0');

        // --- Step 1: getMetList_Simple (主账号) ---
        stepLog.push('1) getMetList_Simple: start');
        const listRes = await callCnyIotWithToken({
          rawApiKey: token.apiKey,
          loginID: token.loginID,
          method: 'getMetList_Simple',
          body: { mt: 1 }
        });
        const meterList = Array.isArray(listRes?.value) ? listRes.value : (Array.isArray(listRes?.value?.d) ? listRes.value.d : []);
        stepLog.push(`1) getMetList_Simple: OK, count=${Array.isArray(meterList) ? meterList.length : 0}`);
        console.log('[debug-insert] 1) getMetList_Simple OK', { result: listRes?.result, count: Array.isArray(meterList) ? meterList.length : 0 });
        // 与 cnyiotoperation 一致：mts 里 UserID=租客 id，表直接归到该组
        const indexBase = Date.now() % 100000000;
        const userIdInMts = String(subuserId ?? '0');
        const buildMts = (priceIdVal) => {
          const prepaid = (r) => (r.mode || 'prepaid') === 'prepaid';
          return records
            .filter((r) => (r.meterId || r.meterID || '').toString().trim() && (r.title || r.name || '').toString().trim())
            .map((r, idx) => ({
              MeterID: String(r.meterId || r.meterID || '').trim(),
              MeterModel: prepaid(r) ? 0 : 1,
              Name: String(r.title || r.name || '').trim() || `电表_${idx + 1}`,
              PriceID: String(priceIdVal),
              Tel: tel || '0',
              Note: '',
              UserID: userIdInMts,
              index: String(indexBase + idx)
            }));
        };
        const mts = buildMts(priceId);
        if (mts.length === 0) {
          return res.json({ body: null, result: null, error: 'NO_VALID_RECORDS' });
        }
        const bodySent = { mts, loginid: token.loginID, LoginID: token.loginID };

        // --- Step 2: add meter (主账号) ---
        stepLog.push('2) addMeter(主账号): start');
        console.log('[debug-insert] Step 2 addMeter request', { mtsCount: mts.length, body: bodySent });
        let cnyRes;
        try {
          cnyRes = await callCnyIotWithToken({
            rawApiKey: token.apiKey,
            loginID: token.loginID,
            method: 'addMeter',
            body: { mts }
          });
        } catch (e) {
          stepLog.push(`2) addMeter: FAIL - ${e.message || String(e)}`);
          console.error('[debug-insert] Step 2 addMeter threw', e);
          return res.json({ body: bodySent, result: null, error: `2) addMeter 失败: ${e.message}`, stepLog, failedAt: 'addMeter' });
        }
        console.log('[debug-insert] Step 2 addMeter result', { result: cnyRes?.result, value: cnyRes?.value });
        let errMsg = null;
        let retryWithPriceId1 = null;
        if (cnyRes?.result !== 0 && cnyRes?.result !== 200) {
          errMsg = `CNYIOT result=${cnyRes?.result}`;
          stepLog.push(`2) addMeter: FAIL result=${cnyRes?.result}`);
          failedAt = 'addMeter';
        } else if (Array.isArray(cnyRes?.value)) {
          const codes = [...new Set(cnyRes.value.map((v) => v.val).filter((v) => v != null && v !== 0 && v !== 200))];
          if (codes.length) {
            stepLog.push(`2) addMeter: FAIL value codes=${codes.join(',')}`);
            failedAt = 'addMeter';
            const meterIds = mts.map((m) => m.MeterID).join(', ');
            if (codes.includes(5006)) {
              errMsg = `CNYIOT 5006 子账号无权操作：请在 CNYIOT 平台确认 (1) 子账号是否有添加电表权限 (2) 表号 [${meterIds}] 是否已被其他账号绑定`;
            } else if (codes.includes(4132)) {
              errMsg = `CNYIOT 4132：表号 [${meterIds}]。平台返回 4132 可能表示：(1) 表号已存在 (2) 若确认平台无此表号，请换一个未用过的 11 位表号重试，或向 CNYIOT 确认 addMeter 时 4132 的含义。`;
            } else if (codes.includes(4142)) {
              errMsg = `CNYIOT 4142 此表已存在：表号 [${meterIds}] 已在平台中，请换表号或到平台查看。`;
            } else if (codes.includes(4018)) {
              errMsg = `CNYIOT 4018 数据输入错误：已用 getPrices 首个电价、唯一 index、meterModel。`;
              stepLog.push('2) addMeter: 4018, retry with PriceID 1');
              console.log('[debug-insert] Step 2 addMeter 4018, retrying with PriceID 1');
              if (priceId !== '1') {
                const mts1 = buildMts('1');
                const cnyRes1 = await callCnyIotWithToken({
                  rawApiKey: token.apiKey,
                  loginID: token.loginID,
                  method: 'addMeter',
                  body: { mts: mts1 }
                });
                retryWithPriceId1 = { body: { mts: mts1 }, result: cnyRes1 };
                console.log('[debug-insert] Step 2 addMeter retry result', { result: cnyRes1?.result, value: cnyRes1?.value });
                if (cnyRes1?.result === 200 && Array.isArray(cnyRes1?.value) && cnyRes1.value.every((v) => v.val === 200 || v.val === 0)) {
                  stepLog.push('2) addMeter: retry with PriceID 1 OK');
                  failedAt = null;
                } else {
                  stepLog.push(`2) addMeter: retry still FAIL result=${cnyRes1?.result}`);
                }
              }
            } else {
              errMsg = `CNYIOT 单条失败: ${codes.join(', ')}`;
            }
          } else {
            stepLog.push('2) addMeter: OK');
          }
        } else {
          stepLog.push('2) addMeter: OK');
        }
        const link2UserResults = [];
        const retrySucceeded = retryWithPriceId1?.result?.result === 200 &&
          Array.isArray(retryWithPriceId1?.result?.value) &&
          retryWithPriceId1.result.value.every((v) => v.val === 200 || v.val === 0);
        if (retrySucceeded) {
          errMsg = null;
        }
        const mtsToLink = retrySucceeded ? (retryWithPriceId1.body?.mts || mts) : mts;

        // --- Step 3: link2User ---
        stepLog.push('3) link2User: start');
        if ((!errMsg && cnyRes?.result === 200) || retrySucceeded) {
          for (const m of mtsToLink) {
            console.log('[debug-insert] Step 3 link2User', { MeterID: m.MeterID, UserID: subuserId });
            try {
              const linkRes = await callCnyIotWithToken({
                rawApiKey: token.apiKey,
                loginID: token.loginID,
                method: 'link2User',
                body: { MeterID: m.MeterID, UserID: subuserId }
              });
              link2UserResults.push({ MeterID: m.MeterID, result: linkRes?.result, value: linkRes?.value });
              if (linkRes?.result !== 200 && linkRes?.result !== 0) {
                stepLog.push(`3) link2User: MeterID=${m.MeterID} FAIL result=${linkRes?.result}`);
                console.warn('[debug-insert] Step 3 link2User fail', { MeterID: m.MeterID, result: linkRes?.result, value: linkRes?.value });
                failedAt = 'link2User';
              } else {
                stepLog.push(`3) link2User: MeterID=${m.MeterID} OK`);
                console.log('[debug-insert] Step 3 link2User OK', { MeterID: m.MeterID, result: linkRes?.result });
              }
            } catch (linkErr) {
              stepLog.push(`3) link2User: MeterID=${m.MeterID} FAIL - ${linkErr?.message || String(linkErr)}`);
              console.error('[debug-insert] Step 3 link2User threw', { MeterID: m.MeterID }, linkErr);
              link2UserResults.push({ MeterID: m.MeterID, error: linkErr?.message || String(linkErr) });
              failedAt = 'link2User';
            }
          }
          if (failedAt !== 'link2User') {
            stepLog.push('3) link2User: all OK');
          }
        } else {
          stepLog.push('3) link2User: skip (addMeter not OK)');
        }

        return res.json({
          body: bodySent,
          result: cnyRes,
          error: errMsg,
          retryWithPriceId1: retryWithPriceId1 || undefined,
          link2User: link2UserResults.length ? link2UserResults : undefined,
          stepLog,
          failedAt: failedAt || undefined,
          subuserId,
          usersCount: userList?.length,
          mainGetPricesCount: priceList?.length,
          subGetPricesOk: subPricesRes?.result === 200 || subPricesRes?.result === 0
        });
      } catch (err) {
        const loginRequestPayload = { nam: loginName, psw: '***' };
        console.error('[debug-insert] login or early step failed', err);
        const payload = {
          body: null,
          result: null,
          error: err.message || String(err),
          loginRequestPayload,
          stepLog: ['login or early error', String(err.message || err)],
          failedAt: 'login'
        };
        return res.json(payload);
      }
    }
    let bodyInfo = { body: null, payload: null, loginid: null, LoginID: null };
    try {
      bodyInfo = await getAddMeterRequestBody(req.clientId, records);
    } catch (err) {
      return res.json({ body: null, payload: null, result: null, error: err.message || String(err) });
    }
    let result = null;
    let error = null;
    try {
      result = await insertMeters(req.clientId, records);
    } catch (err) {
      error = err.message || String(err);
    }
    res.json({
      body: bodyInfo.body,
      payload: bodyInfo.payload,
      loginid: bodyInfo.loginid,
      result,
      error
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/metersetting/debug-insert-step – 单步执行，每步返回 stepLog 等，前端可每步后写入 text1。
 *  body: { step: 'users'|'pricesMain'|'pricesSub'|'addMeter', loginName, password, subuserId?, records?, useSubaccountForAddMeter? }
 *  useSubaccountForAddMeter: true 时，addMeter 步用 loginName/password 的 token（售电员试），body 只改 login id
 */
router.post('/debug-insert-step', requireClient, async (req, res, next) => {
  try {
    const step = req.body?.step;
    const loginName = req.body?.loginName;
    const password = req.body?.password;
    const subuserIdIn = req.body?.subuserId != null ? String(req.body.subuserId) : null;
    const records = req.body?.records;
    const useSubaccountForAddMeter = !!req.body?.useSubaccountForAddMeter;
    if (!step || !loginName || !password) {
      return res.status(400).json({ ok: false, reason: 'STEP_LOGIN_PASSWORD_REQUIRED', stepLog: [] });
    }
    const stepLog = [];
    const token = await getValidCnyIotTokenForPlatform();

    if (step === 'users') {
      stepLog.push('A) 主账号 getUsers: start');
      const usersRes = await callCnyIotWithToken({
        rawApiKey: token.apiKey,
        loginID: token.loginID,
        method: 'getUsers',
        body: {}
      });
      const userList = Array.isArray(usersRes?.value) ? usersRes.value : [];
      const loginLower = String(loginName).trim().toLowerCase();
      let foundUser = userList.find(u => String(u.adminID || u.adminid || '').trim().toLowerCase() === loginLower);
      if (!foundUser) {
        foundUser = userList.find(u => {
          const aid = String(u.adminID || u.adminid || '').trim().toLowerCase();
          return aid.endsWith('_' + loginLower) || aid === loginLower;
        });
      }
      const subuserId = foundUser ? String(foundUser.Station_index ?? foundUser.station_index ?? '') : null;
      stepLog.push(`A) getUsers: OK, count=${userList.length}, user id (Station_index)=${subuserId ?? '—'}`);
      return res.json({ stepLog, subuserId, usersCount: userList.length, ok: !!subuserId });
    }

    if (step === 'pricesMain') {
      stepLog.push('B) 主账号 getPrices: start');
      const pricesRes = await callCnyIotWithToken({
        rawApiKey: token.apiKey,
        loginID: token.loginID,
        method: 'getPrices',
        body: { ptype: -1, offset: -1, limit: -1 }
      });
      const priceList = Array.isArray(pricesRes?.value) ? pricesRes.value : [];
      const priceId = (priceList[0] && (priceList[0].PriceID ?? priceList[0].priceId)) != null
        ? String(priceList[0].PriceID ?? priceList[0].priceId)
        : '301024';
      stepLog.push(`B) 主账号 getPrices: OK, count=${priceList.length}, priceId=${priceId}`);
      return res.json({ stepLog, priceId, count: priceList.length, ok: true });
    }

    if (step === 'pricesSub') {
      stepLog.push('C) 子账号 getPrices: start (子账号是否可以)');
      try {
        const subToken = await requestNewToken({ username: loginName, password });
        const subPricesRes = await callCnyIotWithToken({
          rawApiKey: subToken.apiKey,
          loginID: subToken.loginID,
          method: 'getPrices',
          body: { ptype: -1, offset: -1, limit: -1 }
        });
        const subOk = subPricesRes?.result === 200 || subPricesRes?.result === 0;
        stepLog.push(`C) 子账号 getPrices: ${subOk ? 'OK' : 'FAIL result=' + (subPricesRes?.result ?? '')} (子账号${subOk ? '可以' : '不可以'})`);
        return res.json({ stepLog, ok: subOk });
      } catch (e) {
        stepLog.push(`C) 子账号 getPrices: FAIL - ${e.message || String(e)} (子账号不可以)`);
        return res.json({ stepLog, ok: false, error: e.message });
      }
    }

    if (step === 'addMeter') {
      if (!subuserIdIn || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ ok: false, reason: 'SUBUSER_ID_AND_RECORDS_REQUIRED', stepLog: [] });
      }
      // 测试售电员：useSubaccountForAddMeter 时用 loginName/password 的 token，body 只改 login id
      const addMeterToken = useSubaccountForAddMeter
        ? await requestNewToken({ username: loginName, password })
        : token;
      if (useSubaccountForAddMeter) {
        stepLog.push('【售电员试】addMeter 用 loginName=' + loginName + ' 的 token，body 仅 login id 不同');
      }
      const tel = await getClientTel(req.clientId).catch(() => '0');
      const pricesRes = await callCnyIotWithToken({
        rawApiKey: addMeterToken.apiKey,
        loginID: addMeterToken.loginID,
        method: 'getPrices',
        body: { ptype: -1, offset: -1, limit: -1 }
      });
      const priceList = Array.isArray(pricesRes?.value) ? pricesRes.value : [];
      const priceId = (priceList[0] && (priceList[0].PriceID ?? priceList[0].priceId)) != null
        ? String(priceList[0].PriceID ?? priceList[0].priceId)
        : '301024';
      stepLog.push('1) getMetList_Simple: start');
      const listRes = await callCnyIotWithToken({
        rawApiKey: addMeterToken.apiKey,
        loginID: addMeterToken.loginID,
        method: 'getMetList_Simple',
        body: { mt: 1 }
      });
      const meterList = Array.isArray(listRes?.value) ? listRes.value : (Array.isArray(listRes?.value?.d) ? listRes.value.d : []);
      stepLog.push(`1) getMetList_Simple: OK, count=${Array.isArray(meterList) ? meterList.length : 0}, priceId=${priceId}`);
      const indexBase = Date.now() % 100000000;
      const userIdInMts = String(subuserIdIn ?? '0');
      stepLog.push('mts UserID=' + userIdInMts + ' (group 到该租客)');
      const buildMts = (priceIdVal) => {
        const prepaid = (r) => (r.mode || 'prepaid') === 'prepaid';
        return records
          .filter((r) => (r.meterId || r.meterID || '').toString().trim() && (r.title || r.name || '').toString().trim())
          .map((r, idx) => ({
            MeterID: String(r.meterId || r.meterID || '').trim(),
            MeterModel: prepaid(r) ? 0 : 1,
            Name: String(r.title || r.name || '').trim() || `电表_${idx + 1}`,
            PriceID: String(priceIdVal),
            Tel: tel || '0',
            Note: '',
            UserID: userIdInMts,
            index: String(indexBase + idx)
          }));
      };
      const mts = buildMts(priceId);
      if (mts.length === 0) return res.json({ stepLog, error: 'NO_VALID_RECORDS' });
      const bodySent = { mts, loginid: addMeterToken.loginID, LoginID: addMeterToken.loginID };

      stepLog.push(useSubaccountForAddMeter ? '2) addMeter(售电员 ' + loginName + '): start' : '2) addMeter(主账号): start');
      const cnyRes = await callCnyIotWithToken({
        rawApiKey: addMeterToken.apiKey,
        loginID: addMeterToken.loginID,
        method: 'addMeter',
        body: { mts }
      });
      const codes = Array.isArray(cnyRes?.value) ? cnyRes.value.map((v) => v.val) : [];
      const failed = cnyRes?.result !== 200 && cnyRes?.result !== 0;
      if (failed) stepLog.push(`2) addMeter: FAIL result=${cnyRes?.result}`);
      else if (codes.some((v) => v != null && v !== 0 && v !== 200)) stepLog.push(`2) addMeter: FAIL value codes`);
      else stepLog.push('2) addMeter: OK');

      const link2UserResults = [];
      if (!failed && codes.every((v) => v == null || v === 0 || v === 200)) {
        stepLog.push('3) link2User: start');
        for (const m of mts) {
          try {
            const linkRes = await callCnyIotWithToken({
              rawApiKey: addMeterToken.apiKey,
              loginID: addMeterToken.loginID,
              method: 'link2User',
              body: { MeterID: m.MeterID, UserID: subuserIdIn }
            });
            link2UserResults.push({ MeterID: m.MeterID, result: linkRes?.result, value: linkRes?.value });
            stepLog.push(`3) link2User: MeterID=${m.MeterID} ${(linkRes?.result === 200 || linkRes?.result === 0) ? 'OK' : 'FAIL'}`);
          } catch (e) {
            link2UserResults.push({ MeterID: m.MeterID, error: e.message });
            stepLog.push(`3) link2User: MeterID=${m.MeterID} FAIL - ${e.message}`);
          }
        }
        stepLog.push('3) link2User: done');
      }
      return res.json({
        stepLog,
        body: bodySent,
        result: cnyRes,
        link2User: link2UserResults,
        error: failed ? `CNYIOT result=${cnyRes?.result}` : undefined,
        forSubuser: loginName,
        useSubaccountForAddMeter,
        note: useSubaccountForAddMeter
          ? `售电员试：addMeter 用 login id=${addMeterToken.loginID}（${loginName}），表绑定 UserID=${subuserIdIn}`
          : `addMeter/link2User 必须用主账号调 API，表绑定到子账号 ${loginName} (UserID=${subuserIdIn})`
      });
    }

    return res.status(400).json({ ok: false, reason: 'INVALID_STEP', step, stepLog: [] });
  } catch (err) {
    next(err);
  }
});

/** POST /api/metersetting/preview-new-meters – 用 client 的 CNYIOT 拉表，返回尚未 sync 进 meterdetail 的列表 { list, total } */
router.post('/preview-new-meters', requireClient, async (req, res, next) => {
  try {
    const result = await previewNewMeters(req.clientId);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.json({ ok: false, list: [], total: 0, reason: err.message || String(err) });
  }
});

/** POST /api/metersetting/insert-from-preview – 仅写入 meterdetail，不调用 addMeter（电表已在 CNYIOT 存在）。Body: { records } */
router.post('/insert-from-preview', requireClient, async (req, res, next) => {
  try {
    const records = req.body?.records || [];
    const result = await insertMetersFromPreview(req.clientId, records);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(400).json({ ok: false, reason: err.message || String(err) });
  }
});

/** POST /api/metersetting/get-cnyiot-meters – 主账号 getMetList_Simple，返回 { meters, result, nextIndex?, error? } */
router.post('/get-cnyiot-meters', requireClient, async (req, res, next) => {
  try {
    const loginName = req.body?.loginName;
    const password = req.body?.password;
    const mt = req.body?.mt != null ? Number(req.body.mt) : 1;
    if (!loginName || !password) {
      return res.status(400).json({ ok: false, reason: 'LOGIN_NAME_PASSWORD_REQUIRED' });
    }
    const token = await requestNewToken({ username: loginName, password });
    const cnyRes = await callCnyIotWithToken({
      rawApiKey: token.apiKey,
      loginID: token.loginID,
      method: 'getMetList_Simple',
      body: { mt }
    });
    const list = Array.isArray(cnyRes?.value) ? cnyRes.value : (Array.isArray(cnyRes?.value?.d) ? cnyRes.value.d : []);
    const nextIndex = list.length + 1;
    const errMsg = (cnyRes?.result !== 0 && cnyRes?.result !== 200) ? `CNYIOT result=${cnyRes?.result}` : null;
    return res.json({ meters: list, result: cnyRes?.result, nextIndex, error: errMsg });
  } catch (err) {
    return res.json({ meters: [], result: null, nextIndex: 1, error: err.message || String(err) });
  }
});

/** POST /api/metersetting/get-cnyiot-users-platform – 用主账号 token 调 getUsers，返回主账号下全部租客 { users, result, error? } */
router.post('/get-cnyiot-users-platform', requireClient, async (req, res, next) => {
  try {
    const token = await getValidCnyIotTokenForPlatform();
    const cnyRes = await callCnyIotWithToken({
      rawApiKey: token.apiKey,
      loginID: token.loginID,
      method: 'getUsers',
      body: {}
    });
    const users = Array.isArray(cnyRes?.value) ? cnyRes.value : [];
    const errMsg = (cnyRes?.result !== 0 && cnyRes?.result !== 200) ? `CNYIOT result=${cnyRes?.result}` : null;
    return res.json({ users, result: cnyRes?.result, error: errMsg });
  } catch (err) {
    return res.json({ users: [], result: null, error: err.message || String(err) });
  }
});

/** POST /api/metersetting/get-cnyiot-users – body: { email, loginName, password } → 用前端账号调 getUsers，返回 { users, result, error? } */
router.post('/get-cnyiot-users', requireClient, async (req, res, next) => {
  try {
    const loginName = req.body?.loginName;
    const password = req.body?.password;
    if (!loginName || !password) {
      return res.status(400).json({ ok: false, reason: 'LOGIN_NAME_AND_PASSWORD_REQUIRED' });
    }
    const token = await requestNewToken({ username: loginName, password });
    const cnyRes = await callCnyIotWithToken({
      rawApiKey: token.apiKey,
      loginID: token.loginID,
      method: 'getUsers',
      body: {}
    });
    const users = Array.isArray(cnyRes?.value) ? cnyRes.value : [];
    const errMsg = (cnyRes?.result !== 0 && cnyRes?.result !== 200) ? `CNYIOT result=${cnyRes?.result}` : null;
    return res.json({ users, result: cnyRes?.result, error: errMsg });
  } catch (err) {
    return res.json({ users: [], result: null, error: err.message || String(err) });
  }
});

/** POST /api/metersetting/add-cnyiot-user – 主账号 addUser 为 client 开租客（拿分组号）。body: loginName, password（主账号）, uN, uI, tel, psw */
router.post('/add-cnyiot-user', requireClient, async (req, res, next) => {
  try {
    const loginName = req.body?.loginName;
    const password = req.body?.password;
    const uN = req.body?.uN ?? '';
    const uI = req.body?.uI ?? '';
    const tel = req.body?.tel ?? '';
    const psw = req.body?.psw ?? '';
    if (!loginName || !password) {
      return res.status(400).json({ ok: false, reason: 'LOGIN_NAME_PASSWORD_REQUIRED' });
    }
    const token = await requestNewToken({ username: loginName, password });
    const body = { uN, uI, tel };
    if (psw) body.psw = psw;
    const cnyRes = await callCnyIotWithToken({
      rawApiKey: token.apiKey,
      loginID: token.loginID,
      method: 'addUser',
      body
    });
    const errMsg = (cnyRes?.result !== 0 && cnyRes?.result !== 200) ? `CNYIOT result=${cnyRes?.result}` : null;
    return res.json({ result: cnyRes?.result, value: cnyRes?.value, error: errMsg });
  } catch (err) {
    return res.json({ result: null, error: err.message || String(err) });
  }
});

/** POST /api/metersetting/edit-cnyiot-user – 主账号调 editUser。文档 §13 仅支持 id, uN, uI, tel，无 UserType。 */
router.post('/edit-cnyiot-user', requireClient, async (req, res, next) => {
  try {
    const loginName = req.body?.loginName;
    const password = req.body?.password;
    const id = req.body?.id != null ? String(req.body.id) : null;
    if (!loginName || !password || id == null) {
      return res.status(400).json({ ok: false, reason: 'LOGIN_NAME_PASSWORD_AND_ID_REQUIRED' });
    }
    const token = await requestNewToken({ username: loginName, password });
    const body = {
      id,
      uN: req.body?.uN ?? '',
      uI: req.body?.uI ?? '',
      tel: req.body?.tel ?? ''
    };
    const cnyRes = await callCnyIotWithToken({
      rawApiKey: token.apiKey,
      loginID: token.loginID,
      method: 'editUser',
      body
    });
    const errMsg = (cnyRes?.result !== 0 && cnyRes?.result !== 200) ? `CNYIOT result=${cnyRes?.result}` : null;
    return res.json({ result: cnyRes?.result, value: cnyRes?.value, error: errMsg });
  } catch (err) {
    return res.json({ result: null, error: err.message || String(err) });
  }
});

/** POST /api/metersetting/providers – body: { email } → { providers } */
router.post('/providers', requireClient, async (req, res, next) => {
  try {
    const providers = await getActiveMeterProvidersByClient(req.clientId);
    res.json({ providers });
  } catch (err) {
    next(err);
  }
});

/** POST /api/metersetting/usage-summary – body: { email, meterIds, start, end } */
router.post('/usage-summary', requireClient, async (req, res, next) => {
  try {
    const meterIds = req.body?.meterIds;
    const start = req.body?.start;
    const end = req.body?.end;
    if (!Array.isArray(meterIds) || !start || !end) {
      return res.status(400).json({ ok: false, reason: 'METER_IDS_AND_DATE_RANGE_REQUIRED' });
    }
    const result = await getUsageSummary(req.clientId, { meterIds, start, end });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/metersetting/sync – body: { email, meterId } (meterId = 11-digit CMS meterid) */
router.post('/sync', requireClient, async (req, res, next) => {
  const body = { email: req.body?.email ? req.body.email.slice(0, 8) + '***' : undefined, meterId: req.body?.meterId };
  console.log('[metersetting/sync] request body=', JSON.stringify(body));
  try {
    const meterId = req.body?.meterId;
    if (!meterId) {
      return res.status(400).json({ ok: false, reason: 'NO_METER_ID' });
    }
    const result = await syncMeterByCmsMeterId(req.clientId, meterId);
    console.log('[metersetting/sync] response ok=', result?.ok, 'meterId=', result?.meterId, 'after balance=', result?.after?.balance, 'after status=', result?.after?.status, 'after isonline=', result?.after?.isonline);
    console.log('[metersetting/sync] response body (full)=', JSON.stringify(result));
    res.json(result);
  } catch (err) {
    console.log('[metersetting/sync] error=', err?.message, 'stack=', err?.stack?.slice(0, 200));
    const msg = err?.message || '';
    if (msg === 'CLIENT_ID_REQUIRED' || msg === 'METER_ID_REQUIRED' || msg === 'METER_ID_NOT_FOUND' || msg === 'METER_NOT_FOUND' || msg === 'CNYIOT_METER_ID_NOT_FOUND') {
      return res.status(400).json({ ok: false, reason: msg });
    }
    if (msg === 'CNYIOT_NOT_CONFIGURED') {
      return res.status(400).json({ ok: false, reason: 'CNYIOT_NOT_CONFIGURED' });
    }
    next(err);
  }
});

/** POST /api/metersetting/client-topup – body: { email, meterId, amount } */
router.post('/client-topup', requireClient, async (req, res, next) => {
  try {
    const meterId = req.body?.meterId;
    const amount = Number(req.body?.amount);
    if (!meterId || Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, reason: 'INVALID_METER_OR_AMOUNT' });
    }
    await clientTopup(req.clientId, meterId, amount);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'TOPUP_PENDING_NO_IDX') {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

/** POST /api/metersetting/groups – body: { email } → list of groups */
router.post('/groups', requireClient, async (req, res, next) => {
  try {
    const list = await loadGroupList(req.clientId);
    res.json({ groups: list });
  } catch (err) {
    next(err);
  }
});

/** POST /api/metersetting/group-delete – body: { email, groupId } */
router.post('/group-delete', requireClient, async (req, res, next) => {
  try {
    const groupId = req.body?.groupId;
    if (!groupId) {
      return res.status(400).json({ ok: false, reason: 'NO_GROUP_ID' });
    }
    await deleteGroup(req.clientId, groupId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** POST /api/metersetting/group-submit – body: { email, groupId?, mode, groupName, sharingType, parentId?, childIds[], childActive? } */
router.post('/group-submit', requireClient, async (req, res, next) => {
  try {
    const payload = {
      groupId: req.body?.groupId,
      mode: req.body?.mode,
      groupName: req.body?.groupName,
      sharingType: req.body?.sharingType,
      parentId: req.body?.parentId,
      childIds: req.body?.childIds,
      childActive: req.body?.childActive
    };
    const result = await submitGroup(req.clientId, payload);
    res.json(result);
  } catch (err) {
    if (['GROUP_NAME_REQUIRED', 'PARENT_METER_REQUIRED', 'BROTHER_REQUIRES_AT_LEAST_TWO', 'AT_LEAST_ONE_CHILD', 'PARENT_NOT_FOUND'].includes(err.message)) {
      return res.status(400).json({ ok: false, reason: err.message });
    }
    next(err);
  }
});

module.exports = router;
