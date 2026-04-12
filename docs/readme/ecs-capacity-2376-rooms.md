# ECS 能否支撑 2376 间房？会卡吗？

基于当前代码与配置的结论与建议（目标：94 client、约 2376 间房、每日 cron + 正常 API 请求）。

---

## 1. 当前架构要点

| 项目 | 当前配置 | 说明 |
|------|----------|------|
| **Node 进程** | 单进程 `node server.js` | 无 cluster，API 与 cron 共用同一进程 |
| **DB 连接池** | `connectionLimit: 10`（`src/config/db.js`） | 所有请求（含 cron）共用 10 条连接 |
| **每日 cron** | 单次 `POST /api/cron/daily` 顺序执行 8 步 | 欠租→房间同步→refund→plan 到期→core 到期→[每月 1 号] active room 扣费→Stripe→门锁电量 |
| **欠租检查** | 每批 500 笔 tenancy，循环直到跑完 | 约 2140 笔 ≈ 5 批；**每笔可能调 TTLock + CNYIoT**（锁门、断电） |
| **门锁电量** | 每个有 TTLock 的 client 调一次 TTLock API | 94 client ≈ 94 次外部请求 |

---

## 2. 会不会卡？主要风险点

### 2.1 每日 cron 运行时间

- 欠租检查：若每笔 tenancy 都调 TTLock + CNYIoT，500 笔/批 × 多批，**外部 API 可能让整段耗时到数分钟甚至更久**。
- 房间可租同步：全量 tenancy 查一次 + 按 room 更新，**纯 DB，2376 间量级没问题**。
- 每月 1 号 active room 扣费：94 client 顺序处理，每 client 一次事务，**耗时主要来自 DB，通常几十秒内**。
- 门锁电量：94 次 TTLock 调用，**网络延迟叠加，约 1–2 分钟**。

**结论**：cron 在「欠租多 + 门锁/电表全开」时，**总时长可能达到约 5–15 分钟**。这段时间内：

- Node 是单进程但 **I/O 异步**，仍可处理其他请求；
- **DB 连接池只有 10**：cron 会占掉多根连接，若同时有较多 API 请求，**可能出现等连接、响应变慢**（感觉「卡」）。

### 2.2 并发与连接池

- 94 个 client、2376 间房，**平时 API 并发不会特别大**（按使用习惯，同一时刻在线人数有限）。
- 若 **cron 在白天或与高峰重叠**：cron 占连接 + 用户操作多 → **更容易出现短暂卡顿或超时**。

### 2.3 ECS 规格未知

- 文档未写 ECS 实例规格（vCPU/内存）。
- 2376 间房、94 client 的 **数据量对内存/CPU 压力不大**；瓶颈更可能在 **DB 连接数** 和 **cron 期间与 API 争资源**，而不是 ECS 算力本身。

---

## 3. 结论与建议

### 结论（直接回答）

- **在「cron 凌晨跑、白天并发一般」的前提下**：当前 ECS **有机会** 支撑 2376 间房不严重卡顿，但 **连接池偏小、cron 与 API 共用进程**，存在一定风险。
- **若 cron 跑很久（尤其欠租检查调大量 TTLock/CNYIoT）且与用户高峰重叠**：可能出现 **暂时变慢、偶发超时**（等 DB 连接或等外部 API）。

### 建议（按优先级）

1. **cron 时间固定到低峰（如 00:00–00:30 UTC+8）**  
   避免与白天用户操作重叠，减少「cron 占满连接时用户感觉卡」的情况。

2. **适当调大 DB 连接池**  
   例如把 `connectionLimit` 从 10 调到 **20**（若 MySQL 与 ECS 内存允许）。这样 cron 占 5–8 根时，API 仍有较多连接可用。  
   - 注意：MySQL 侧 `max_connections` 要大于所有应用实例的 connectionLimit 之和。

3. **观察 cron 实际耗时**  
   在 cron 入口/出口打日志（或加简单计时），看 `POST /api/cron/daily` 总耗时。若经常 **>3–5 分钟**，再考虑：
   - 欠租检查分批、限流（例如每批间隔 1–2 秒），或
   - 把 cron 挪到单独 worker/队列（与 API 分离），避免占同一进程和连接池。

4. **ECS 规格**  
   若当前为 1 vCPU / 2GB：对 2376 间房一般够用；若已观察到 CPU 经常 >80% 或内存吃紧，可升一档（如 2 vCPU / 4GB）。**先看监控再决定**。

---

## 4. 小结表

| 问题 | 回答 |
|------|------|
| ECS 够不够 support 2376 间房？ | **数据量与计算上够**；是否「卡」主要看 **cron 时间** 和 **DB 连接池**。 |
| 会卡吗？ | **有可能**：cron 跑得久且与高峰重叠时，易出现 **短暂变慢**（等连接或等 TTLock/CNYIoT）。 |
| 最值得先做的 | **cron 固定凌晨跑** + **DB 连接池调到 20**（并确认 MySQL `max_connections`）。 |

代码依据：`src/config/db.js`、`server.js`、`src/modules/tenancysetting/tenancy-cron.routes.js`、`tenancy-active.service.js`、`battery-feedback-cron.service.js`。
