# Tenancy Setting：Extend + Agreement 功能总结（我们做了什么）

本文总结本次开发中与 **延租（extend）**、**续约合约（extend agreement）**、**TTLock**、**房间可用状态** 相关的全部改动。

---

## 〇、重要约定：Tenancy 可以一直 Extend

- **同一笔 tenancy 可以多次延租**（第一次延、第二次延、第三次延…），没有「只能延一次」的限制。
- 每次执行 extend 时：
  - **previous_end** = 当次延租前的 `end`（即「这次续约的起日」）；下次再延时会再被覆盖为「新的当次旧 end」，所以永远表示「当前这次续约的合约到期日」。
  - **TTLock**（含 parent lock）、**roomdetail（available / availablesoon / availablefrom）** 都会按**最新的 end** 更新。
- 每次延租后都可以再建一份 **extend agreement**（日期范围 = 当次的 previous_end → end），所以同一 tenancy 下可以有多份 agreement（首签 + 第 1 次续约 + 第 2 次续约…）。

---

## 0.1、#datepickerextension：可延到任意日，最后一段 prorate

- **不再要求** extend end date 对齐 client billing cycle（例如不必是「每月 1 号 → 上月末」「每月 15 号 → 上月 14 号」）。
- **#datepickerextension** 可以选**任意一天**（仅受 maxExtensionEnd 限制：同房已有下一笔 booking 时最多到前一 day）。
- **Rental 入账**：从 oldEnd 到 newEnd 按 cycle 拆段；**第一段**（oldEnd 到下一个 cycle 日）prorate；**中间**整月按 cycle 日（每月 1 号或每月 15 号等）整月收租；**最后一段**不足整月按 prorate 入 rentalcollection。中间整月为 `Rental Income`，首尾为 `Prorated Rental Income`。
- **Commission**：**extend 合约要跟 commission rules**，且**不写死**：按 **client 的 commission 配置** + **本次 extend 的期数（月数）** 决定用哪条规则——例如 extend 3 个月就跟 3 个月 rules，extend 6 个月就跟 6 个月 rules。每段 rental 对应 commission，首尾 prorate、中间整月；实现时接 client admin 的 commission 配置，按 extend 月数选规则并写入 rentalcollection（owner/tenant commission）；最后一段 commission 同样 prorate。
- getExtendOptions 返回的 **paymentCycle** 仅作参考，不强制；后端 extend 接受任意 newEnd。

### Rental 逻辑举例（Status A = 每月 1 号收租）

- **第一次 extend**（例如延 2 个月 15 天）：会有 **3 笔 rental**——(1) 从 oldEnd 到下一个 1 号：prorate；(2) 中间整月：每月 1 号整月；(3) 最后一个周期：从某月 1 号到 newEnd，prorate。
- **第二次 extend**（例如再延 2 个月 18 天）：(1) 从上次 end 到下一个 1 号：**第一个月到 1 号 prorate**；(2) **每月 1 号收租**（整月）；(3) **最后一个月继续 prorate** 到 newEnd。  
即：每次 extend 都是「首段 prorate → 中间每月 cycle 日整月 → 末段 prorate」，与当前实现一致。

---

## 一、Extend 时：TTLock 与房间可用状态

### 1. TTLock

- **会更新**：当该租约当前为 **active**（未因欠租被冻结）时，extend 后会：
  - 把该租约对应的门锁密码有效期延到新的 **tenancy.end**（主锁：property 或 room 的 smartdoor）。
  - 若该锁有 **parent lock**（在另一把锁的 `childmeter` 里），会一起延 parent 锁上「同名」密码的有效期。
- **不更新**：若租约已是 **inactive**（欠租、已冻结、密码已设为昨天过期），extend 时**不**改 TTLock；等租客还清后，由现有恢复流程用更新后的 tenancy.end 再更新锁。

**涉及**：`tenancy-active.service.js`（getLockAndMeterFromTenancy 带 primaryLockDetailId、getParentLockForLockDetail、setParentLockPasscodeEnd）、`tenancysetting.service.js`（extendTenancy 内根据 active 调用 setTenancyActive）。

### 2. Roomdetail（available / availablesoon / availablefrom）

- **会更新**：extend 后对该租约所在房间调用 **updateRoomAvailableFromTenancy(room_id)**，更新这一间房的：
  - **available**：有 active 租约 = 0，否则 = 1
  - **availablesoon**：tenancy.end 在 60 天内 = 1，否则 = 0
  - **availablefrom**：availablesoon 时为 tenancy.end（预计可入住日），否则 NULL

**涉及**：`tenancy-active.service.js`（updateRoomAvailableFromTenancy）、`tenancysetting.service.js`（extendTenancy 末尾调用）。

---

## 二、续约合约（Extend Agreement）与日期范围

### 约定

- **New tenancy 合约**：日期范围 = **begin → end**（租约起迄）。
- **Extend 合约**：日期范围 = **原合约到期日（previous_end）→ 新到期日（end）**，**不用 begin**。

### 数据库

| 迁移 | 表 | 列 | 说明 |
|------|----|----|------|
| **0074_agreement_extend_dates_remark.sql** | agreement | extend_begin_date, extend_end_date, remark | 续约合约的期限与备注（对应 datepickeragreement1/2） |
| **0075_tenancy_previous_end.sql** | tenancy | previous_end | 当次延租前的「合约到期日」；每次 extend 时写入当时的 end（支持一直 extend，每次覆盖为当次的旧 end），供 extend agreement 日期范围用 |

### 后端

- **extendTenancy**：UPDATE tenancy 时同时设 **previous_end = oldEnd**（当次延租前的 end；支持多次延租，每次都会更新）。
- **getTenancyList**：SELECT 与返回中带上 **previous_end**，前端可区分 extend 并用作日期范围起点。
- **insertAgreement**：接受 **extendBegin、extendEnd、remark**，写入 agreement 的 extend_begin_date、extend_end_date、remark。
- **insertAgreement（模板创建）**：插入后若为模板单（非手动上传），自动调用 **tryPrepareDraftForAgreement(agreementId)**，生成 draft PDF 与 hash_draft，status 变为 ready_for_signature，无需前端再调 try-prepare-draft。

### 前端（Wix #sectionagreement）

- **#datepickeragreement1 / #datepickeragreement2**：  
  - New：默认 begin / end。  
  - Extend：默认 **previous_end / end**（合约到期 → 新到期）。
- **#textnotify**（无 #inputagreementremark）：  
  - 有内容时显示（当前租约日期、是否选在范围外、是否在续约期内），无内容时 hide。  
  - New 合约不显示「extended to」；已有已签合约时显示「extended to」。
- **校验**：日期必须在「有效范围」内——extend 时为 previous_end～end，new 时为 begin～end。
- **提交**：传 extendBegin、extendEnd（不传 remark，因无 inputagreementremark）。

---

## 三、Dropdown 与流程统一

- **Dropdown**：与 client 的 agreement 选项一致（mode → agreementtemplate，由 getAgreementTemplates 按 client 取）。
- **New tenancy 与 extend tenancy**：流程相同，仅日期不同（new 用 begin→end，extend 用 previous_end→end）。

---

## 四、一租约多合约与闭环

- **agreement 表**：同一 tenancy_id 可有多行（首签 + 续约），每行独立 id、status、hash_draft、hash_final。
- **Tenancy Setting**：列表按 tenancy_id 查 agreement，返回该租约下全部合约。
- **Tenant / Admin / Owner**：列表与签名都按 agreementId 单行处理；全签后 afterSignUpdate → generateFinalPdfAndComplete，写 hash_final、更新 tenancy.agreement 快照。
- **文档**：`docs/db/agreement-tenancy-extend-closed-loop.md` 描述从创建到 final 的完整闭环。

---

## 五、涉及文件一览

| 类型 | 文件 |
|------|------|
| 迁移 | `src/db/migrations/0074_agreement_extend_dates_remark.sql`、`0075_tenancy_previous_end.sql` |
| 后端 | `src/modules/tenancysetting/tenancysetting.service.js`、`tenancysetting.routes.js` |
| 后端 | `src/modules/tenancysetting/tenancy-active.service.js`（parent lock、updateRoomAvailableFromTenancy） |
| 前端 | `docs/wix/frontend/tenancysetting-page-full.js`（datepicker、textnotify、getAgreementDateRange、openAgreementSection、updateAgreementNotify） |
| JSW | `docs/wix/jsw/velo-backend-saas-tenancysetting.jsw.snippet.js`（insertAgreement 传 extendBegin、extendEnd、remark） |
| 文档 | `docs/db/agreement-tenancy-extend-closed-loop.md`、`docs/tenancysetting-extend-agreement-summary.md`（本文件） |

---

## 六、部署前需执行

```bash
node scripts/run-migration.js src/db/migrations/0074_agreement_extend_dates_remark.sql
node scripts/run-migration.js src/db/migrations/0075_tenancy_previous_end.sql
```

Wix 端需同步：`docs/wix/frontend/tenancysetting-page-full.js` 中 #sectionagreement 相关逻辑，以及 JSW 中的 insertAgreement 参数；页面上需有 #datepickeragreement1、#datepickeragreement2、#textnotify（无 #inputagreementremark）。
