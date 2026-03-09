/* ======================================================
   Test page: 走 backend/saas/metersetting → Node 后端。
   #button1: 主账号 addMeter（A→B→C→addMeter 主账号 token）
   #button5: 售电员试 addMeter  #button9: 主账号 addMeter → link2User 到 democoliving（表归 democoliving 组）
   #button2: 主账号 getUsers 全部 user detail  #button3: editCnyiotUser  #button4: getUsers → debugInsertMeters
====================================================== */

import wixWindow from 'wix-window';
import {
  debugInsertMetersStep,
  getCnyiotUsers,
  getCnyiotUsersPlatform,
  getCnyiotMeters,
  addCnyiotUser,
  editCnyiotUser
} from 'backend/saas/metersetting';

console.log("CODE FILE LOADED");

$w.onReady(function () {
  console.log("ON READY RUNNING");
  console.log("Device:", wixWindow.formFactor);

  let currentCnyiotUserId = null;
  // 测试用：democoliving 子账号；add meter 由后端用主账号 token 执行（仅主账号可 addMeter）
  const defaultCreds = { loginName: "democoliving", password: "0123456789" };

  function appendText1(msg) {
    const el = $w("#text1");
    if (el) el.text = (el.text || "") + (el.text ? "\n" : "") + msg;
  }

  if (wixWindow.formFactor === "Mobile") {
    console.log("this is mobile version");
    try {
      if ($w("#button1")) { $w("#button1").collapse(); }
      console.log("button1 hidden");
    } catch (e) {
      console.log("button1 not found, skip collapse");
    }
  }

  if ($w("#button1")) {
    $w("#button1").onClick(async () => {
      const records = [
        { meterId: "19104669999", title: "testing2", name: "testing2", mode: "prepaid" }
      ];
      const creds = { ...defaultCreds };
      if ($w("#text1")) $w("#text1").text = "";
      appendText1("本页使用子账号: " + (creds.loginName || "democoliving"));
      appendText1("（addMeter 由主账号调 API，表绑定到该子账号）");
      try {
        // Step A: 主账号 getUsers → user id
        appendText1("\n=== Step A: 主账号 getUsers ===");
        console.log("[button1] Step A: getUsers start");
        const stepA = await debugInsertMetersStep("users", creds);
        if (stepA?.stepLog && stepA.stepLog.length) stepA.stepLog.forEach((s) => appendText1(s));
        if (stepA?.subuserId != null) {
          appendText1("user id (subuserId) = " + stepA.subuserId);
          console.log("[button1] Step A done", "subuserId=" + stepA.subuserId, "usersCount=" + stepA.usersCount);
        } else {
          appendText1("FAIL: 未找到用户 " + (creds.loginName || ""));
          console.warn("[button1] Step A: no subuserId");
          return;
        }

        // Step B: 主账号 getPrices
        appendText1("\n=== Step B: 主账号 getPrices ===");
        console.log("[button1] Step B: getPrices main start");
        const stepB = await debugInsertMetersStep("pricesMain", creds);
        if (stepB?.stepLog && stepB.stepLog.length) stepB.stepLog.forEach((s) => appendText1(s));
        console.log("[button1] Step B done", "priceId=" + stepB?.priceId, "count=" + stepB?.count);

        // Step C: 子账号 getPrices（子账号是否可以）
        appendText1("\n=== Step C: 子账号 getPrices (子账号是否可以) ===");
        console.log("[button1] Step C: getPrices sub start");
        const stepC = await debugInsertMetersStep("pricesSub", creds);
        if (stepC?.stepLog && stepC.stepLog.length) stepC.stepLog.forEach((s) => appendText1(s));
        console.log("[button1] Step C done", "ok=" + stepC?.ok);

        // Step addMeter + link2User（为子账号 democoliving 添加，API 由主账号执行）
        const forSubuser = creds.loginName || "democoliving";
        appendText1("\n=== Step addMeter + link2User（为子账号 " + forSubuser + "） ===");
        appendText1("※ API 必须用主账号调 addMeter，表绑定到子账号 " + forSubuser + " (UserID=" + stepA.subuserId + ")");
        console.log("[button1] Step addMeter start", "forSubuser=" + forSubuser, "subuserId=" + stepA.subuserId);
        const stepD = await debugInsertMetersStep("addMeter", { ...creds, subuserId: stepA.subuserId, records });
        if (stepD?.stepLog && stepD.stepLog.length) stepD.stepLog.forEach((s) => appendText1(s));
        if (stepD?.note) appendText1(stepD.note);
        if (stepD?.body) {
          appendText1("\nBODY（发往平台，loginid 为主账号）: " + JSON.stringify(stepD.body, null, 2));
        }
        if (stepD?.result != null) {
          appendText1("\nRESULT: " + JSON.stringify(stepD.result));
        }
        if (stepD?.link2User && stepD.link2User.length) {
          appendText1("\nlink2User（绑定到 " + forSubuser + "）: " + JSON.stringify(stepD.link2User, null, 2));
        }
        if (stepD?.error) appendText1("\nERROR: " + stepD.error);
        console.log("[button1] Step addMeter done", "forSubuser=" + (stepD?.forSubuser || forSubuser), stepD);
      } catch (e) {
        console.error("[button1] error", e);
        appendText1("\nError: " + (e?.message || e));
      }
    });
  }

  // 售电员试 addMeter：body 一样，仅 login id 换成 democoliving（CNYIOT 手动建的售电员）
  if ($w("#button5")) {
    $w("#button5").onClick(async () => {
      const records = [{ meterId: "19104669998", title: "testing-sales", name: "testing-sales", mode: "prepaid" }];
      const creds = { ...defaultCreds };
      if ($w("#text1")) $w("#text1").text = "";
      appendText1("=== 售电员试 addMeter（democoliving 手动建）===");
      appendText1("body 与主账号一致，仅 login id 换成售电员 token");
      try {
        const stepA = await debugInsertMetersStep("users", creds);
        if (stepA?.stepLog) stepA.stepLog.forEach((s) => appendText1(s));
        if (!stepA?.subuserId) {
          appendText1("FAIL: 未找到 " + creds.loginName);
          return;
        }
        appendText1("user id = " + stepA.subuserId);
        appendText1("\n=== Step B: getPrices ===");
        const stepB = await debugInsertMetersStep("pricesMain", creds);
        if (stepB?.stepLog) stepB.stepLog.forEach((s) => appendText1(s));
        appendText1("\n=== Step C: 子账号 getPrices ===");
        const stepC = await debugInsertMetersStep("pricesSub", creds);
        if (stepC?.stepLog) stepC.stepLog.forEach((s) => appendText1(s));
        appendText1("\n=== addMeter（售电员 login id）===");
        const stepD = await debugInsertMetersStep("addMeter", { ...creds, subuserId: stepA.subuserId, records, useSubaccountForAddMeter: true });
        if (stepD?.stepLog) stepD.stepLog.forEach((s) => appendText1(s));
        if (stepD?.note) appendText1(stepD.note);
        if (stepD?.body) appendText1("\nBODY: " + JSON.stringify(stepD.body, null, 2));
        if (stepD?.result != null) appendText1("\nRESULT: " + JSON.stringify(stepD.result));
        if (stepD?.link2User?.length) appendText1("\nlink2User: " + JSON.stringify(stepD.link2User, null, 2));
        if (stepD?.error) appendText1("\nERROR: " + stepD.error);
        console.log("[button5] 售电员试 addMeter done", stepD);
      } catch (e) {
        console.error("[button5] error", e);
        appendText1("\nError: " + (e?.message || e));
      }
    });
  }

  if ($w("#button9")) {
    $w("#button9").onClick(async () => {
      const creds = { ...defaultCreds };
      const records = [{ meterId: "19104669999", title: "button9-group", name: "button9-group", mode: "prepaid" }];
      if ($w("#text1")) $w("#text1").text = "";
      appendText1("=== #button9: 主账号 addMeter，group/link2User 在 democoliving ===");
      try {
        const stepA = await debugInsertMetersStep("users", creds);
        if (stepA?.stepLog) stepA.stepLog.forEach((s) => appendText1(s));
        if (!stepA?.subuserId) {
          appendText1("FAIL: 未找到 " + creds.loginName);
          return;
        }
        appendText1("democoliving user id = " + stepA.subuserId);
        appendText1("\n--- addMeter(主账号) ---");
        const stepD = await debugInsertMetersStep("addMeter", { ...creds, subuserId: stepA.subuserId, records });
        if (stepD?.stepLog) stepD.stepLog.forEach((s) => appendText1(s));
        if (stepD?.note) appendText1(stepD.note);
        if (stepD?.body) appendText1("\nBODY: " + JSON.stringify(stepD.body, null, 2));
        if (stepD?.result != null) appendText1("\nRESULT: " + JSON.stringify(stepD.result));
        if (stepD?.link2User?.length) appendText1("\nlink2User(绑定到 democoliving): " + JSON.stringify(stepD.link2User, null, 2));
        if (stepD?.error) appendText1("\nERROR: " + stepD.error);
        console.log("[button9] addMeter(主) + link2User(democoliving) done", stepD);
      } catch (e) {
        appendText1("Error: " + (e?.message || e));
        console.error("[button9] error", e);
      }
    });
  }

  if ($w("#button2")) {
    $w("#button2").onClick(async () => {
      if ($w("#text1")) $w("#text1").text = "主账号 getUsers 全部 user...";
      console.log("[button2] getCnyiotUsersPlatform (主账号全部租客)");
      try {
        const data = await getCnyiotUsersPlatform();
        if (data && data.ok === false) {
          if ($w("#text1")) $w("#text1").text = "FAIL: " + (data.reason || "unknown");
          return;
        }
        const users = data?.users || [];
        const lines = [
          "=== 主账号下全部 user (getUsers) ===",
          "count = " + users.length,
          data?.error ? "error: " + data.error : "",
          "",
          "user detail:",
          JSON.stringify(users, null, 2)
        ].filter(Boolean);
        if ($w("#text1")) $w("#text1").text = lines.join("\n");
        console.log("[button2] users count=" + users.length, users);
      } catch (e) {
        console.error("button2 error", e);
        if ($w("#text1")) $w("#text1").text = "Error: " + (e?.message || e);
      }
    });
  }

  if ($w("#button3")) {
    $w("#button3").onClick(async () => {
      if ($w("#text1")) $w("#text1").text = "editCnyiotUser (democoliving)...";
      try {
        const data = await editCnyiotUser(defaultCreds, {
          id: 2448872,
          uN: "democoliving",
          uI: "democoliving",
          tel: "60122113361"
        });
        const lines = [
          "=== editUser (democoliving) ===",
          "result=" + (data?.result ?? "—"),
          "",
          "§13 仅支持 id, uN, uI, tel；UserType 需平台后台改。",
          "",
          JSON.stringify(data, null, 2)
        ];
        if ($w("#text1")) $w("#text1").text = lines.join("\n");
      } catch (e) {
        console.error("editCnyiotUser error", e);
        if ($w("#text1")) $w("#text1").text = "Error: " + (e?.message || e);
      }
    });
  }

  if ($w("#button4")) {
    $w("#button4").onClick(async () => {
      const records = [
        { meterId: "19104669999", title: "testing2", name: "testing2", mode: "prepaid" }
      ];
      if ($w("#text1")) $w("#text1").text = "Step 1: getCnyiotUsers (democoliving)...";
      try {
        appendText1("\n=== getCnyiotUsers 请求 ===");
        const userData = await getCnyiotUsers(defaultCreds);
        if (userData && userData.ok === false) {
          appendText1("\nFAIL: " + (userData.reason || "unknown"));
          return;
        }
        const users = userData?.users || [];
        appendText1("\n=== getUsers 响应 (users.length=" + users.length + ") ===");
        appendText1(JSON.stringify(users.slice(0, 3), null, 2));

        const adminIdLower = (id) => String(id || "").toLowerCase();
        const democoliving = users.find(u => {
          const id = adminIdLower(u.adminID || u.adminid);
          return id === "democoliving" || id === "demodecoliving";
        });
        const stationIndex = democoliving != null ? (democoliving.Station_index ?? democoliving.station_index) : null;
        if (stationIndex == null) {
          appendText1("\n未找到 democoliving，无法继续。");
          return;
        }
        appendText1("\n找到 democoliving Station_index = " + stationIndex);

        appendText1("\n\nStep 2: debugInsertMeters (getPrices→addMeter→link2User)...");
        const data = await debugInsertMeters(records, { ...defaultCreds, subuserId: stationIndex });
        if (data?.stepLog && data.stepLog.length) {
          appendText1("\n=== stepLog ===");
          data.stepLog.forEach((s) => appendText1(s));
        }
        appendText1("\n=== BODY ===");
        appendText1(JSON.stringify(data?.body || {}, null, 2));
        appendText1("\n=== RESULT ===");
        appendText1(JSON.stringify(data?.result != null ? data.result : {}, null, 2));
        if (data?.link2User && data.link2User.length) {
          appendText1("\n=== link2User ===");
          appendText1(JSON.stringify(data.link2User, null, 2));
        }
        if (data?.error) appendText1("\n=== ERROR ===" + data.error);
        if (data?.failedAt) appendText1("\nfailedAt: " + data.failedAt);
      } catch (e) {
        console.error("[button4] flow error", e);
        appendText1("\nError: " + (e?.message || e));
      }
    });
  }
});
