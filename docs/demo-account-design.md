# Demo Account 设计：每表插入项与 12am 刷新策略

**当前种子数据**：由 `scripts/seed-demo-account.js` 创建。默认 client 与 admin 均为 **demoaccount@gmail.com**，公司名 **demoaccount**，subdomain **demoaccount**；pricing plan 取库中最贵；两条 tenancy（一条 3 个月前→6 个月后 600，一条 2 周前结束 800 需退押金）；租客 demo1 / demo2（demo1@gmail.com、demoaccount@gmail.com）；业主 demoaccount@gmail.com；可 Connect account，若 demo 断开则每日 reset 时恢复。详见下文与脚本内注释。

本文根据「SaaS demo 给 client 试用」需求整理：**每个 table 需要 insert 怎样的 item** 才能组成一个可用的 demo account，以及 12am 刷新、payment sandbox、tenancy 按日续期等约定。

---

## 一、需求摘要

1. **Demo account 每天 12am 刷新**：避免 trial 用户改过的 setting 影响下一位访客；trial 改了 setting 也不保留。
2. **Demo company**：一个固定 demo client；每个 demo trial 的 **staff 可注册成为 staff，享有 7 天 full access**。
3. **Demo 所有 payment 走 sandbox**：已用 `client_profile.stripe_sandbox = 1` 实现。
4. **Property / Room / Meter / Smart door setting 12am 保持原状**：例如默认 1 property、4 room；若 trial 删了 property、disable 了 property、或加了 2 个新 property，系统 12am 要删掉新增、恢复默认（reset to snapshot）。
5. **Tenancy 跟着日期 renew**：demo 固定有几条 tenancy 供访客测试；若 trial 把 tenancy disable 了，12am 必须 reset 回来（active=1、日期按「当日基准」续一段）。

---

## 二、标识 Demo Client

当前没有「是否 demo」的列，建议二选一：

- **方案 A（推荐）**：在 `client_profile` 增加 `is_demo tinyint(1) NOT NULL DEFAULT 0`，1 = 该 client 为 demo account。  
  - 每日 cron 与 reset 逻辑只处理 `is_demo = 1` 的 client。  
  - 查询方式：`JOIN client_profile cp ON cp.client_id = c.id AND cp.is_demo = 1`。
- **方案 B**：用约定标识，例如 `clientdetail.subdomain = 'demo'` 或 `clientdetail.title = 'Demo Company'`。  
  - 无需 migration，但 subdomain 必须唯一且专留给 demo，且其他逻辑都要按同一约定判断。

下文以 **方案 A** 为准：假设存在 `client_profile.is_demo`，且 demo client 的 `client_id` 固定为一个已知 UUID（如 `DEMO_CLIENT_ID`）。

---

## 三、每张表需要 INSERT 的 item（最小可用的 Demo Account）

以下按依赖顺序列出：先有 client，再有 profile/integration/credit/plan，再有 property → room → meter/lock → tenancy/tenant/staff/agreement 等。

### 1. clientdetail（1 条）

| 列 | 建议值 | 说明 |
|----|--------|------|
| id | 固定 UUID，如 `demo-client-uuid` | 全系统唯一，后续所有 FK 指向此 id |
| wix_id | 可空或任意 | 非从 Wix 导入可留空 |
| title | 如 `Demo Company` | 公司名，前台显示 |
| email | 如 `demo@example.com` | 主邮箱（可不发信） |
| status | 1 | 必须 1，否则 access 会判 CLIENT_INACTIVE |
| subdomain | 如 `demo` | 唯一；若用 subdomain 做 demo 标识则固定此值 |
| expired | 如 `2099-12-31 23:59:59` 或每日 cron 重写为「明天」 | 避免 pricing plan 到期把 client 设为 inactive；demo 可排除在 pricing-plan-expiry cron 之外并每日把 expired 设为明天 |
| pricingplan_id | 指向一个有效的 pricingplan.id | 需先有一条 pricingplan（见下） |
| currency | 如 `MYR` 或 `SGD` | 与 Stripe 平台一致 |
| created_at / updated_at | 默认即可 | |

### 2. client_profile（1 条）

| 列 | 建议值 | 说明 |
|----|--------|------|
| id | 新 UUID | |
| client_id | = clientdetail.id（demo client） | |
| subdomain | 与 clientdetail.subdomain 一致，如 `demo` | 全库唯一（UNIQUE），与 client resolver 一致 |
| stripe_sandbox | **1** | **Demo 所有 payment 走 sandbox**（已支持） |
| stripe_platform | 如 `MY` 或 `SG` | 与 currency 一致 |
| is_demo | **1**（需 migration 加列） | 标识 demo account，供 12am 刷新与排除 pricing 到期用 |
| 其他 tin/contact/accountholder/ssm/currency/address/accountnumber/bank_id | 可空或占位 | 若有 Billing/Profile 页可填占位 |

### 3. client_integration（若干条）

至少保证前端/后台不报错；可只开必要 key，用占位或 test 值：

| key | enabled | provider | values_json 说明 |
|-----|---------|----------|------------------|
| Account / addonAccount | 0 或 1 | 若 1 可用 sql/bukku 等，值可占位 | Demo 可不做真实会计同步 |
| meter | 0 | - | 若不做真实电表，可关 |
| smartDoor | 0 | - | 若不做真实门锁，可关 |
| paymentGateway 或 Stripe | 1 | stripe | 已有 stripe_sandbox=1，支付走 sandbox |

每条需要：id, client_id, key, version, slot, enabled, provider, values_json。

### 4. client_credit（至少 1 条）

| 列 | 建议值 |
|----|--------|
| client_id | demo client id |
| type | 如 `flex` 或 `core` |
| amount | 如 9999（足够 trial 用） |

每日 12am 刷新时可将 amount 重设回同一数值，避免 trial 把 credit 用光。

### 5. client_pricingplan_detail（至少 1 条）

| 列 | 建议值 |
|----|--------|
| client_id | demo client id |
| type | `plan` |
| plan_id | pricingplan.id（见下） |
| title | 如 `Demo Plan` |
| expired | 如 `2099-12-31` 或由 cron 每日设为「明天」 |

Demo 可被 **pricing-plan-expiry cron 排除**（WHERE is_demo != 1），这样不会把 demo client 设为 inactive。

### 6. pricingplan（1 条，若库中尚无）

Demo 用的主套餐，需在 `pricingplan` 表有一条记录，`clientdetail.pricingplan_id` / `client_pricingplan_detail.plan_id` 指向它。

| 列 | 建议值 |
|----|--------|
| id | 固定 UUID，如 `demo-plan-uuid` |
| title | 如 `Demo Plan` |
| sellingprice | 0 或任意 |
| corecredit | 如 1000 |

### 7. bankdetail（1 条，若需要）

若 Profile/公司信息需要选银行，可插入一条占位：

| 列 | 建议值 |
|----|--------|
| id | UUID |
| 其他 | 占位名称等 |

client_profile.bank_id 可指向此 id 或 NULL。

### 8. agreementtemplate（至少 1 条）

Property 可能关联 agreementtemplate_id；列表/下拉需要至少一条。

| 列 | 建议值 |
|----|--------|
| id | UUID |
| client_id | demo client id |
| title | 如 `Demo Agreement` |

### 9. supplierdetail（可选，0～2 条）

propertydetail 有 management_id、internettype_id 等 FK 可空。若希望 demo 有「管理/网络」占位，可各插 1 条并指向 client_id。

### 10. propertydetail（默认 1 条，12am 恢复为此）

| 列 | 建议值 |
|----|--------|
| id | 固定 UUID，如 `demo-property-uuid` |
| client_id | demo client id |
| shortname / apartmentname / address | 如 `Demo Property A`、`Demo Address` |
| active | 1 |
| agreementtemplate_id | 上一条 agreementtemplate.id（可空） |
| management_id / internettype_id / owner_id / meter_id / smartdoor_id | 可 NULL 或指向上面占位 |

**12am 策略**：只保留这条「默认 property」；当 is_demo=1 时，删除该 client 下所有「不在默认 snapshot 里的 property」，再确保这一条存在且数据与 snapshot 一致（如 active=1）。

### 11. roomdetail（默认 4 条，12am 恢复为此）

每条 room 属于一个 property（property_id = demo property id）。

| 列 | 建议值 |
|----|--------|
| id | 固定 UUID（如 room1～room4） |
| client_id | demo client id |
| property_id | demo property id |
| title_fld / roomname | 如 `Room 101`～`Room 104` |
| available | 0 或 1（按 tenancy 占用来设，12am 由 tenancy 同步） |
| active | 1 |

**12am 策略**：删除该 demo client 下「不在默认 snapshot 里的 room」，保留并恢复这 4 条（available 由 tenancy 同步逻辑重算）。

### 12. meterdetail（可选，0～4 条）

若 demo 要展示 meter setting：可为每个 room 一条，或 1 个 parent + 多个 child。meterdetail 有 client_id, property_id, room_id（可选）, parentmeter_id（child 时指向 parent）。

**12am 策略**：删除 demo client 下「不在默认 snapshot 里的 meter」，恢复 snapshot 中几条（含 parent/child 关系）。

### 13. gatewaydetail / lockdetail（可选）

Smart door 依赖 gateway + lock。若 demo 不做真实门锁，可不插；若要做「列表有数据」可各插 1 条占位，client_id = demo client id。**12am 策略**：同 property/room，只保留 snapshot 内条目。

### 14. ownerdetail（可选，0～1 条）

若 property 需要 owner_id，可插 1 条，client_id、property_id 指向 demo client 与 demo property。**12am 策略**：只保留 snapshot 内 owner。

### 15. tenantdetail（至少 2～4 条，对应几间房有 tenancy）

Demo 的「访客可测的 tenancy」需要 tenant。每条 tenant 属于 client（client_id = demo client id）。

| 列 | 建议值 |
|----|--------|
| id | 固定 UUID |
| client_id | demo client id |
| fullname / email | 如 `Demo Tenant 1`、`demo-tenant1@example.com` |

### 16. staffdetail（Demo 登录用 + 可选「7 天 trial staff」）

- **固定 demo staff（1 条）**：供内部或访客统一登录 demo。
  - client_id = demo client id  
  - email = 如 `demo@yourcompany.com`  
  - permission_json = `["admin"]` 或 `["profilesetting","usersetting","integration","billing","finance","tenantdetail","propertylisting","marketing","booking","admin"]`  
  - status = 1  

- **7 天 full access trial staff**：访客注册的 staff。  
  - 需在 staffdetail 增加列如 `trial_expires_at datetime`（或复用现有某列），或单独表记录「staff_id + expires_at」。  
  - 插入时：permission_json = `["admin"]`，trial_expires_at = 注册时间 + 7 天。  
  - Access 逻辑：若当前时间 &lt; trial_expires_at 则按 admin 权限；否则可降权或视为过期（由产品决定）。

### 17. tenancy（默认 2～4 条，12am 按「日期」renew）

每条 tenancy 对应一间 room、一个 tenant、一个 client；用于「租约列表、租金、门锁」等展示。

| 列 | 建议值 |
|----|--------|
| id | 固定 UUID（便于 snapshot） |
| client_id | demo client id |
| room_id | demo room id |
| tenant_id | demo tenantdetail id |
| begin | 如「今天」或「今天 - 30 天」 |
| end | 如「今天 + 30 天」或「今天 + 60 天」 |
| rental | 如 1000 |
| active | **1** |
| submitby_id | 某条 staffdetail.id（如固定 demo staff） |

**12am 策略**：  
- 对 is_demo=1 的 client，把所有 tenancy 的 active 设回 1，inactive_reason 清空（恢复被 trial disable 的 tenancy）。  
- 「跟着日期 renew」：把 begin/end 按「当日」重算，例如 begin = 今天、end = 今天 + 30 天（或固定偏移），这样每天看到的都是「当前有效」的 demo 租约。

### 18. rentalcollection（可选，与 tenancy 配套）

若希望 demo 显示「已付/未付租金」，可为每条 tenancy 插 1～2 条 rentalcollection（date、amount、ispaid、tenant_id、room_id、tenancy_id 等）。**12am 策略**：删除 demo client 下「非 snapshot 的」rentalcollection，或全部删掉再按当日 tenancy 重新生成占位行（按产品决定是否保留历史）。

### 19. account / account_client（可选）

若 Company Setting / Account 页要正常显示，需 account 表有模板行，且 account_client 有 client_id + account_id 的映射。Demo 可插最少条数或全部用占位。

### 20. 其他表（按需）

- **creditlogs / pricingplanlogs**：demo 可不插或插占位；12am 可清空 demo client 的 creditlogs 或保留。  
- **agreement**：若 demo 要展示「已签合约」可插 1～2 条，client_id、tenancy_id、property_id 指向 demo 数据。  
- **refunddeposit / bills / ownerpayout**：通常 demo 可不插；若 12am 会跑 refund deposit cron，可让 cron 跳过 is_demo=1 的 client。

---

## 四、12am 刷新逻辑要点（Cron 顺序建议）

在现有 `POST /api/cron/daily` 中，对 **is_demo=1** 的 client 增加一步「demo reset」（建议放在 tenancy 欠租检查之后、房间可租同步之前或之后，视你希望「先恢复数据再算 available」还是「先算 available 再覆盖」而定）：

1. **排除 demo 的 cron**  
   - **Pricing plan 到期**：`runPricingPlanExpiryCheck` 中排除 `client_profile.is_demo = 1`，不把 demo client 设为 inactive。  
   - **Refund deposit**：可选排除 demo client，避免为 demo tenancy 生成 refunddeposit。

2. **Demo 专用 reset（新步骤）**  
   - 查出所有 `client_profile.is_demo = 1` 的 client_id。  
   - 对每个 demo client：  
     - **clientdetail.expired**：设为「明天」或 2099，避免被当过期。  
     - **client_credit**：把 amount 恢复为固定值（如 9999）。  
     - **propertydetail**：删除该 client 下 id 不在「默认 snapshot 列表」的 property；对 snapshot 中的 property 做 UPDATE 恢复 active=1 等字段。  
     - **roomdetail**：同上，只保留 snapshot 中的 room，并恢复 active/available 等。  
     - **meterdetail**：只保留 snapshot 中的 meter；删除其余。  
     - **gatewaydetail / lockdetail**：只保留 snapshot 中条目。  
     - **tenancy**：全部设 active=1、清空 inactive_reason；begin/end 按「当日」renew（如 begin=今天，end=今天+30 天）。  
     - **rentalcollection**：按产品决定是删非 snapshot 或按新 tenancy 重生成。  
     - **staffdetail**：trial 过期的 staff 可设为 status=0 或从 permission 降权（若实现 7 天 trial）。

3. **Snapshot 的存储方式**  
   - **方式 1**：配置表或 JSON 存「默认的 id 列表」+ 关键字段（如 property/room 的 id、tenancy 的 id），12am 时「删多余、按 id 恢复字段」。  
   - **方式 2**：单独表如 `demo_snapshot` 存 (client_id, entity_type, entity_id, payload_json)，12am 时按 payload 覆盖回各表。  
   - 最小实现：在代码里写死 demo client 的「默认 property id、room id 列表、tenancy id 列表」，12am 删除不在列表中的行，并对列表中的行做 UPDATE 恢复。

---

## 五、小结表：每表 insert 数量与 12am 是否恢复

| 表 | 最少 insert 数量 | 12am 是否恢复 / 说明 |
|----|------------------|------------------------|
| clientdetail | 1 | 只更新 expired（或不动） |
| client_profile | 1 | 不动；stripe_sandbox=1、is_demo=1 |
| client_integration | 1～4 | 可选恢复或不动 |
| client_credit | 1 | 恢复 amount |
| client_pricingplan_detail | 1 | 可选恢复 expired |
| pricingplan | 1（若无） | 不动 |
| bankdetail | 0 或 1 | 不动 |
| agreementtemplate | 1 | 不动或只保留 snapshot |
| supplierdetail | 0～2 | 只保留 snapshot |
| propertydetail | 1 | **只保留 1 条并恢复字段** |
| roomdetail | 4 | **只保留 4 条并恢复字段** |
| meterdetail | 0～4 | 只保留 snapshot |
| gatewaydetail / lockdetail | 0 或 1 | 只保留 snapshot |
| ownerdetail | 0～1 | 只保留 snapshot |
| tenantdetail | 2～4 | 不动（或只保留 snapshot 条数） |
| staffdetail | 1（固定）+ N（trial） | trial 过期可 status=0 或降权 |
| tenancy | 2～4 | **active=1，begin/end 按日 renew** |
| rentalcollection | 0～若干 | 删多余或按 tenancy 重生成 |
| account / account_client | 按需 | 可不恢复 |

以上即为「每个 table insert 怎样的 item」以及 12am 如何保持 demo 原状的完整指引；实现时先做最小集合（1 client + 1 property + 4 room + 2 tenancy + 1 staff + payment sandbox），再按需加 meter/lock/agreement 等。
