# 每日定时任务：一步一步设置（cron）

## 功能说明：每天 00:00 (UTC+8) 会做什么

用一个接口 **`POST /api/cron/daily`**，每天跑一次（建议 00:00 马来西亚/新加坡时间），会依次执行下面**九**件事：

---

### 功能一：欠租检查（Tenancy 未付 → 锁门、断电、标记不活跃）

**目的**：自动处理「租金到期却还没付」的租约，避免一直欠租仍能进门、用电。

**「没有还钱」定义**（只鎖「过去到期」未付）：

- **今天之前到期的**（`rentalcollection.date < 今天`）且未付 → 算欠租，要锁门/断电。
- **今天到期、今天还没付** → **不算**欠租（给一整天时间，次日 00:00 再检查）。

**逻辑**：

- 在 DB 里查：有没有「**到期日 < 今天**」（严格早于今天）且 **未付** 的 `rentalcollection`。
- 若有，对该笔租金对应的 **租约（tenancy）** 做：
  1. **门锁（TTLock）**：把该租约的密码 **设为昨天过期**（结束日 = 昨天，即即日起失效），租客无法再开门。若物业大门与房间门各有一套 PIN（`passwordid_property` / `passwordid_room`），**两把锁上对应的密码都会**被设为昨天过期；父锁（childmeter）上同名密码也会同步。
  2. **电表（CNYIoT）**：对该房间的电表 **断电**（relay 关）。
  3. **租约状态**：把该 tenancy 的 `active` 设为 `0`，并写入 `inactive_reason`（例如“欠租”）。
- 之后租客付清欠款并经过你们流程「恢复租约」后，会再开门、供电、`active=1`。

**“今天”的日期**：按 **马来西亚/新加坡 (UTC+8)** 的日历日算，与 datepicker、前台展示一致。

**与「日历到期删密码」的区别**：欠租流程是 **`change` 把密码结束日设为昨天**；下面「功能一点五」对已**超过租约 end 日**且仍存 PIN 的租约会调用 TTLock **`delete` 删除密码**并清空 DB 中的 `password* / passwordid*`（与 Operator **终止租约**时行为一致）。两者不要混用：欠租只管账单未付，不管 `tenancy.end`。

---

### 功能一点五：租约日历已过期（`tenancy.end` &lt; 今天）→ TTLock 删密码 + 清空 DB

**目的**：租约 **按日历已经结束**（`DATE(end) < 今天`，马来西亚日）且 `status = 1`（未走终止接口）、表里仍保存着智能门锁 PIN 时，从 TTLock **删除**对应键盘密码（物业门 + 房门 + 父锁同名），并清空 `tenancy` 的密码相关列，避免旧 PIN 长期留在锁上。

**逻辑**（`runEndedTenancyPasscodeRemoval`，在每日 `POST /api/cron/daily` 里紧接欠租检查之后）：

- 批量查询符合条件的 `tenancy.id`，对每条调用 `removeTenancySmartDoorPasscodes`（与 `terminateTenancy` 内相同）。
- **幂等**：删完后列已 NULL，次日不会再选中。

**代码**：`src/modules/tenancysetting/tenancy-active.service.js`（`runEndedTenancyPasscodeRemoval`），由 `tenancy-cron.routes.js` 的 `daily` 调用。

---

### 功能二：按租约同步房间「可租 / 即将空出」（roomdetail available）

**目的**：根据当前 tenancy 状态，更新每间房的 **可租状态**，供前台「可租单元」、Booking 选房等使用。

**逻辑**：

- 表 **roomdetail** 用三列表示可租状态：
  - **`available`**：1 = 可租，0 = 已被租约占用
  - **`availablesoon`**：1 = 即将空出（例如租约剩 60 天内到期）
  - **`availablefrom`**：datetime，预计可入住日（通常 = 当前租约的 `end`）
- 每日 cron 会：
  - 同一房间可有多个 tenancy（如 room A 2025、room A 2026）；只认 **今天落在 [begin, end] 内** 的那条（按日期判断）。
  - 有「当前占用」tenancy 的房间：设 `available=0`；若该 tenancy 的 end ≤ 今天+60 天则 `availablesoon=1`、`availablefrom=tenancy.end`。
  - 无当前占用 tenancy 的房间：设 `available=1`，`availablesoon=0`，`availablefrom=NULL`。

这样「租约剩 60 天」的房间会显示为「即将空出」，前台可用 `available` / `availablesoon` 做筛选与展示。

**其他会改到 roomdetail.available 的地方**（与 tenancy 联动）：新建 booking 时把该房设为 `available=0`；终止租约、取消 booking、换房时会把对应房设为 `available=1` 等。每日 sync 再统一按当前 tenancy 刷一遍，避免漏改或不同步。

---

### 功能三：租约结束未续约 → 写入 refunddeposit（Admin Dashboard 可见）

**目的**：租约 **end 日期已过**且 **没有续约**（同一房间、同一租客没有更晚的 tenancy）时，自动写入一笔 **refunddeposit**（金额 = 该租约的 deposit，done=0），方便管理员在 **Admin Dashboard** 看到并处理（Mark as refund / 删除等）。

**逻辑**：

- 查出所有：`tenancy.end < 今天`、`deposit > 0`、且 **没有续约**（不存在同 room_id + tenant_id 且 begin > 该 tenancy.end 的另一条 tenancy）、且 **尚未有** 以该 tenancy 为来源的 refunddeposit（`refunddeposit.tenancy_id = tenancy.id` 不存在）。
- 对每条符合条件的 tenancy 插入一行 `refunddeposit`（amount=deposit，room_id/tenant_id/client_id/tenancy_id，done=0）。**幂等**：同一条 tenancy 只会产生一笔 refunddeposit。
- 若 staff 在 Tenancy Setting 里 **手动终止** 租约并选择退押金，也会写入 refunddeposit（含 tenancy_id），与 cron 不重复。

**依赖**：需先执行 migration **0076_refunddeposit_tenancy_id.sql**（为 refunddeposit 表增加 tenancy_id 列）。

**代码**：`src/modules/tenancysetting/refund-deposit-cron.service.js`，由 `POST /api/cron/daily` 在房间可租同步之后、pricing plan 到期检查之前调用。

---

### 功能四：Pricing plan 到期 → client 设为 inactive

**目的**：每天检查 client 的 **pricing plan（订阅）** 是否已过 billing cycle 到期日且未续费；若到期未 renew，将该 client 设为 **inactive**（`clientdetail.status = 0`）。Client 可通过 manual 页面或 Billing setting 页面 upgrade/renew 恢复；inactive 后 tenant 仍可支付，但所有 admin 页面将 no function（由 access/permission  elsewhere 控制）。

**逻辑**：

- 查所有 **status = 1** 且 **expired IS NOT NULL** 且 **DATE(expired) < 今天**（马来西亚日期）的 client。
- 对符合条件的 client 执行：`UPDATE clientdetail SET status = 0`。
- **到期日** 来源：`clientdetail.expired`，在客户 renew/upgrade 付款成功时由 `handlePricingPlanPaymentSuccess` 更新为 `newexpireddate`。

**代码**：`src/modules/billing/pricing-plan-expiry-cron.service.js`，由 `POST /api/cron/daily` 在 refund deposit 之后、core credit 到期清空之前调用。

---

### 功能五：Core credit 到期日清空并写 creditlogs

**目的**：Renew 后旧 core 会在其 **到期日当天** 被清空并记一笔流水。例如：原 2月20 到期剩 500 core，2月15 renew 加 1800 core → 2月15 起有 2300；2月20 当天 cron 清空那 500 并写入 creditlogs（type=Expired，amount=-500，title=Core credit expired (YYYY-MM-DD)），之后剩 1800。

**逻辑**：

- 每天对每个有 credit 的 client：解析 `clientdetail.credit`（JSON），找出 **type=core 且 expired 日期 ≤ 今天** 的项，汇总金额，从 credit 中移除这些项，更新 `clientdetail.credit` 并同步 client_credit 子表。
- 若汇总 > 0：写入 **creditlogs** 一条，type=`Expired`，amount=负值（如 -500），title=`Core credit expired (YYYY-MM-DD)`，**remark 写入到期日与金额**（如 `Expired date: YYYY-MM-DD. Amount: 500 core credit expired.`），payload 含 `source: 'core_expiry_cron'`、`expiredDates`、`totalExpired`。Billing 页 event log 显示 title，即含到期日。

**代码**：`src/modules/billing/core-credit-expiry-cron.service.js`，由 `POST /api/cron/daily` 在 pricing plan 到期检查之后、每月 active room 扣费之前调用。

---

### 功能六：每月 1 号 active room 扣费（10 credit/间）

**目的**：每月 1 号按 Room Setting 里的房间数扣 credit，每间 **10 credit**。**只要在 Room Setting 里有房间就按间数计费**，不管该房间是否启用(active)。

**逻辑**：

- **仅当当天是当月 1 号**（按马来西亚/新加坡日期）时才执行。
- 对每个在 roomdetail 里有至少一间房的 client：
  - 若该 client 当月已扣过（creditlogs 中已有同月「Active room monthly (YYYY-MM)」）→ 跳过（幂等）。
  - 否则统计该 client 的 **roomdetail 总条数**（不筛 active），数量 N，扣 **10 × N** credit（先扣 core 再扣 flex），并写入 creditlogs（title：`Active room monthly (YYYY-MM)`，payload 含 `source: 'active_room_monthly'`、`yearMonth`、`activeRoomCount`）。

**代码**：`src/modules/billing/active-room-monthly-cron.service.js`、`deduction.service.js`（`deductMonthlyActiveRoomCredit`），由 `POST /api/cron/daily` 在 core credit 到期清空之后、Stripe 入账之前调用（仅 1 号执行）。

---

### 功能七：Stripe 出金入账（Stripe Payout → 会计系统 Journal）

**目的**：把已经发生的 **Stripe 出金**（平台/客户从 Stripe 提现到银行）在你们的 **会计系统** 里记一笔账（Journal），方便对账和报表。

**逻辑**：

- 在 DB 里查 `stripepayout` 表中 **尚未入账** 的列（`journal_created_at IS NULL`）。
- 对每一笔：
  - 在你们当前 client 使用的会计系统（**Xero / Bukku / AutoCount / SQL** 之一）里做一笔 **Journal 分录**：  
    **借：银行（Bank） / 贷：Stripe**。
  - 做完后把该笔的 `journal_created_at` 写回 DB，避免重复入账。

**数据来源**：`stripepayout` 目前是「租客付款成功、平台 release 到客户 Stripe Connect 账户」等流程里写入的；若以后有从 Stripe API 拉 payout 再写入的脚本，入账逻辑不变，仍是每天跑本接口即可。

---

### 功能八：门锁电量低于 20% 写入 feedback

**目的**：每天检查所有已接 TTLock 的 client 的门锁电量；若某把锁电量 &lt; 20%，自动写入 **feedback** 表，方便管理员在 Admin Dashboard 看到并安排换电池。

**逻辑**：

- 查出所有已启用 TTLock 的 client（`client_integration`：key=smartDoor、provider=ttlock、enabled=1）。
- 对每个 client 调用 TTLock API 拉取锁列表（`/lock/list`，返回中含 `electricQuantity`）。
- 对每条电量 &lt; 20% 的锁：在 DB 中通过 `lockdetail` 找到对应房间/物业名称（roomdetail.title_fld/roomname、propertydetail.shortname），若无房间则用「no connect」等占位。
- 向 **feedback** 表插入一行：
  - **无 tenancy、无 tenant**：`tenancy_id`、`tenant_id` 为 NULL。
  - **description**：`smart door battery down (房间名 & 物业名 & 日期)`，日期为当日马来西亚日期 YYYY-MM-DD。
  - 保留 `client_id`、`room_id`、`property_id` 便于后台筛选。

**代码**：`src/modules/tenancysetting/battery-feedback-cron.service.js`，由 `POST /api/cron/daily` 在 Stripe 入账之后调用。

---

### 小结

| 功能 | 做什么 | 结果 |
|------|--------|------|
| **欠租检查** | 找出「到期未付」的租金 → 对应租约 | TTLock 密码**结束日改昨天**、断电、tenancy 设为不活跃 |
| **日历到期删密码** | `tenancy.end` &lt; 今天且仍存 PIN、`status=1` | TTLock **delete** 密码 + 清空 tenancy 密码列 |
| **Refund deposit** | 租约 end &lt; 今天、未续约、deposit&gt;0、尚无 refunddeposit | 写入 refunddeposit，Admin Dashboard 可见并处理 |
| **房间可租同步** | 按 tenancy 更新 roomdetail.available / availablesoon / availablefrom | 有租约→available=0；剩 60 天内到期→availablesoon=1 |
| **Pricing plan 到期** | clientdetail.expired &lt; 今天且未 renew | client 设为 inactive（status=0）；tenant 仍可付，admin 页面 no function |
| **Core credit 到期** | core 项 expired ≤ 今天 → 从 credit 移除，汇总金额 | 写 creditlogs type=Expired、amount 负值，Billing 流水可见 |
| **Active room 扣费** | **仅每月 1 号**：按 Room Setting 里房间总数（不筛 active），每间 10 credit | 扣 client credit，写 creditlogs（幂等：同月不重复扣） |
| **Stripe 入账** | 找出未做 journal 的 stripepayout → 按 client 会计系统 | 记一笔 DR Bank / CR Stripe，并标记已入账 |
| **门锁电量 feedback** | 所有 TTLock client 的锁电量 &lt; 20% | 写入 feedback 表（无 tenancy/tenant，description 含房间名、物业名、日期） |

**你只需要设一个定时任务**：每天 00:00 (UTC+8) 调用一次 `POST /api/cron/daily`（带 `X-Cron-Secret`），上面九件事会按顺序执行；其中「Active room 扣费」仅在当天为 1 号时执行。

---

### 涵蓋範圍與當日跑完（queue 分批、不隔夜）

- **所有 SaaS client**：三項任務都是**全庫**掃描，會幫所有客戶做欠租檢查、房間可租同步、Stripe 入賬。
- **當天全部跑完**：欠租檢查用 queue 分批直到沒有待處理項；Stripe 入賬一次撈全部 pending 處理完。
  - **欠租檢查**：每批 **500 筆** tenancy，處理完再查下一批，直到沒有「过去到期未付」的租约。
  - **Stripe 入賬**：每個 client 每個 payout 日一筆，**已寫過 skip**；只有有 stripepayout 記錄（有 settlement）才入賬，沒有就不用。一次撈全部 `journal_created_at IS NULL` 處理完，不隔夜。
  - **房間同步**：全量更新 roomdetail，只做 DB。
- 若 tenancy 量很大，可把 crontab 或雲助手的**超時時間**調大（例如 300～600 秒）。

---

## 第一步：在 .env 里设密钥（必做）

在项目根目录的 `.env` 里加一行（自己换成一串随机字符）：

```env
CRON_SECRET=你的随机密钥
```

例如：

```env
CRON_SECRET=my-daily-cron-secret-2024
```

不设的话，任何人能访问 `/api/cron/daily`，建议一定要设。

Stripe 入賬：每個 client 每個 payout 日一筆，已入賬的會 skip；無需額外 env。

---

## 第二步：确认接口可访问

在**能访问你 ECS 的机器**上（本机或跳板机）执行（把域名和密钥换成你的）。

**单行（推荐，直接复制粘贴）：**
```bash
curl -X POST "https://你的域名/api/cron/daily" -H "Content-Type: application/json" -H "X-Cron-Secret: 你的CRON_SECRET"
```

多行写法时，**最后一行不要加反斜杠**，写完后按回车执行：
```bash
curl -X POST "https://你的域名/api/cron/daily" \
  -H "Content-Type: application/json" \
  -H "X-Cron-Secret: 你的CRON_SECRET"
```

成功会返回 JSON，里面有 `ok: true`、`tenancy`、`roomAvailable`（房间可租同步结果）、`settlement`。若返回 403，检查 `X-Cron-Secret` 是否和 `.env` 里一致。

---

## 第三步：选一种方式设“每天 00:00 跑一次”

### 方式 A：在 ECS 服务器上用 crontab

#### 3.1 登录到 ECS 服务器

用你平时的方式 SSH 登录到跑 Node 的那台 ECS。

### 3.2 编辑 crontab

在终端执行：

```bash
crontab -e
```

如果是第一次，可能会让你选编辑器（选 1 用 nano 即可）。

### 3.3 加一行：每天 00:00（马来西亚时间）调用一次

在文件**最后**加一行（注意三处要改成你的）：

- `你的CRON_SECRET` → 和 `.env` 里一样  
- `https://你的域名` → **必须用 API 域名**（见 `.env` 里 `PUBLIC_APP_URL`，例如 `https://api.colivingjb.com`）。不要用 Wix 前台（www）；若 Node 不在本机跑，也不要用 `http://127.0.0.1:5000`。

（整行一条，不要换行；把 `你的域名`、`你的CRON_SECRET` 换成实际值。）

```cron
0 0 * * * curl -s -X POST "https://你的域名/api/cron/daily" -H "Content-Type: application/json" -H "X-Cron-Secret: 你的CRON_SECRET"
```

- `0 0 * * *` 表示：每天 0 点 0 分执行（**服务器本地时间**）。
- 若你 ECS 时区是 **Asia/Kuala_Lumpur (UTC+8)**，`0 0 * * *` 就是每天马来西亚 00:00。
- 若 ECS 是 UTC，要改成 `0 16 * * *`（UTC 16:00 = 马来西亚 00:00）。

保存并退出（nano：`Ctrl+O` 回车，再 `Ctrl+X`）。

### 3.4 确认已写入

执行：

```bash
crontab -l
```

应该能看到刚加的那一行。

---

## 方式 B：在阿里云 ECS 控制台设置（云助手定时任务）

不想 SSH 进 ECS 时，可以在阿里云控制台用**云助手**创建一条定时执行的命令，让 ECS 每天自动发一次请求。

### 前置条件

- 目标 ECS 实例状态为**运行中**
- 已安装并启用**云助手 Agent**（一般阿里云公共镜像默认有）。若需确认或安装，见 [安装云助手 Agent](https://help.aliyun.com/zh/ecs/user-guide/install-the-cloud-assistant-agent)
- 用于定时任务时，建议 Agent 版本：Linux 2.2.3.282+（可在实例内或控制台查看）

### 控制台步骤

1. **打开云助手页面**
   - 登录 [阿里云 ECS 控制台](https://ecs.console.aliyun.com)
   - 左侧或顶部选择**地域**（你 ECS 所在地域）
   - 在左侧菜单找到 **运维与监控** → **云助手**（或直接访问 [云助手控制台](https://ecs.console.aliyun.com/cloud-assistant/region)）

2. **创建并执行命令**
   - 在云助手页面右上角点击 **创建/执行命令**

3. **填写命令信息**
   - **命令类型**：选 **Shell**
   - **命令内容**：写下面这段（把 `你的域名`、`你的CRON_SECRET` 换成实际值；整段可复制粘贴）：
     ```bash
     #!/bin/bash
     curl -s -X POST "https://你的域名/api/cron/daily" \
       -H "Content-Type: application/json" \
       -H "X-Cron-Secret: 你的CRON_SECRET"
     ```
     - 域名必须用 **API 域名**（如 `https://api.colivingjb.com`），不要用 Wix 前台（www）
   - **执行计划**：选 **定时执行**
     - 再选 **基于时钟定时执行**
     - **Cron 表达式**：每天 00:00 执行（按你选的时区）
       - 若选 **Asia/Shanghai**（与马来西亚同属 UTC+8）：填 `0 0 0 * * ?`
       - 阿里云 Cron 格式为：`秒 分 时 日 月 周`；`?` 表示“不指定”（日或周其一用 `?`）
     - **时区**：选 **Asia/Shanghai** 即相当于马来西亚 00:00
   - **执行用户**：默认 `root` 即可（或你希望的用户）
   - **超时时间**：建议 60～120 秒

4. **选择实例**
   - 在 **选择实例** 区域勾选要执行这条命令的 ECS 实例（跑 Node 的那台，或任意一台能访问 `https://你的域名` 的机器）

5. **保存并执行**
   - 点击 **执行并保存**：会立即执行一次，并把命令按 Cron 定时保存，之后每天 00:00 自动执行
   - 若只想先测试，可先点 **执行**（不保存），看执行结果里的输出是否有 `ok: true` 等

### 查看是否执行成功

- 在云助手页面进入 **执行结果**（或「执行记录」），找到对应执行记录，查看 **输出** 是否包含接口返回的 JSON（如 `tenancy`、`settlement`、`ok: true`）
- 若输出为空或报错，检查：实例能否访问 `https://你的域名`、`X-Cron-Secret` 是否与 `.env` 中 `CRON_SECRET` 一致、Node 服务是否已部署并挂载了 `/api/cron/daily`

### 修改或关闭定时

- 在云助手 **我的命令** 里找到该命令，可编辑 Cron 表达式或**取消定时**（改为“仅预检”或删除定时配置）
- 删除命令则不再执行

---

## 第四步：（可选）看是否真的在跑

- 等第二天 00:00 过后，到 ECS 上查应用日志，看有没有请求进 `/api/cron/daily`。
- 或临时把时间改成“每 5 分钟一次”做测试：
  ```cron
  */5 * * * * curl -s -X POST "https://你的域名/api/cron/daily" -H "Content-Type: application/json" -H "X-Cron-Secret: 你的CRON_SECRET"
  ```
  确认有返回且无报错后，再改回 `0 0 * * *`。

---

## 若 ECS 上不能直接访问自己（例如只允许外网访问）

那就用**另一台能访问你 ECS 的机器**（例如本机或一台小机）装 cron，用同样的 `curl` 命令，只是 URL 改成你 ECS 对外的 `https://你的域名/api/cron/daily`。

---

## 部分子任务说明（摘录）

| 任务 | 说明 |
|------|------|
| **1) 欠租检查** | 查所有 `rentalcollection` 里「到期日 &lt; 今天」且未付的；对应租约做：TTLock 密码**结束日改昨天**（双锁都改）、房间电表断电、tenancy `active=0`、`inactive_reason` 写入。 |
| **1.5) 日历到期删密码** | `tenancy.end` &lt; 今天、`status=1` 且仍存 PIN：TTLock **delete** + 清空 tenancy 密码列（与 Operator 终止租约一致）。 |
| **2) Stripe settlement 入账** | 查 `stripepayout` 里 `journal_created_at IS NULL` 的列，对每笔在会计系统（Xero/Bukku/AutoCount/SQL）做一笔 journal（DR Bank, CR Stripe），并写回 `journal_created_at`。 |

`stripepayout` 的数据来源：目前是你们在「租客付款成功并 release 到客户 Connect 账户」时写入的；若以后有“从 Stripe API 拉取 payout 再写入”的脚本，也可以，入账逻辑不变，仍是每天跑 `/api/cron/daily` 即可。
