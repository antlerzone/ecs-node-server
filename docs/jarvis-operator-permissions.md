# Jarvis（Operator 助手）权限

Jarvis 是 **本 Operator 租户** 下的排程助手。权限分两层：**模型在提示里能看到什么**（由后端查询与 system 文案决定）、**Node 在哪些路径会 UPDATE**（由 `updateOperatorScheduleJob` 等 API 决定）。

维护者可在下方 **「定稿填写」** 更新产品决策；实现以代码与 `cln_saasadmin_ai_md` 平台规则为准。

---

## B1 定稿（Schedule 保留；Jarvis 为快捷后门）

- **Schedule**：排程的**正式接口与页面照常保留**，仍是主渠道。
- **Jarvis**：作为**后门 / 快捷**，用 AI 帮你快想、快问、并在产品规定下**触发已有服务端逻辑**（例如问清楚后走「是否执行自动派队」→「确认执行」写 `team`），**不取代** Schedule。
- **不计划**：再单独加一条「只靠聊天、完全绕过 Schedule」的**新**写 `team` API；改队仍落在现有 Schedule + 自动派队 / 增量 / 重平衡等已上线路径上。

---

## Schedule 页 vs Jarvis 聊天（维护者说明）

| 入口 | 典型用途 |
|------|----------|
| **右下角 Jarvis 聊天** | Operator 用自然语言下指令；在确认流程后由服务端走已有逻辑**直接更新**当日排程（如改 `team`、改状态），是「对话驱动改表」的主路径。**新建一单**：助手在上一句带上 `SCHEDULE_JOB_CREATE_JSON:…`（物业 id、日期=工具栏日、服务类型等），operator 回复 yes/ok/confirm 后，服务端调用与 Schedule **Create Job** 相同的 `createCleaningScheduleJobUnified`（`source: operator_portal`，默认 pending-checkout）。**排程 AI 偏好**（每日自动派队、按物业绑队、cron、buffer、homestay 窗口等）也在聊天里说明；开启 MERGE 时由模型写 `schedule_prefs`（见代码 `mergeExtractedConstraints` / `EXTRACT_JSON`）。**一句里多种写库操作**（例：全部改 pending checkout **且** 全队交 Team 3）须拆成**两步、两次确认**；提示词要求助手**本回合只征求第一件事**的同意，第二件事在系统回执后再开一轮。 |
| **Schedule → Map 页签** | **仅**维护地图分区（`region_groups`）：说明下的 **Edit area groups** 打开弹窗，**Save areas** 保存色区与物业归属；与「用聊天改 AI 偏好」分开。派队若报 `BAD_TEAM`，多为模型未抄写 `Teams[].id`；服务端会尝试把 `Team 2` 等显示名解析成 UUID。 |

---

## B3 定稿（已完成不改队）

- **你们口径：**「锁排」指工单已是 **Complete / 已完成** — 这种单 **不应** 再被 AI 改 `team`。**是**，与现实现一致：终结状态（含 complete、cancel 等）**不会**进入 AI 派发 / 改队逻辑。
- **技术补充：**`ai_assignment_locked` 仍可由 Schedule 保存队时写入（用于其它产品语义），但 **Jarvis / `cln-operator-ai` 派队与聊天触发的写 `team`、写 `status` 不再因该字段跳过**；仅 **终结状态**（已完成、已取消等，`isTerminalScheduleRaw`）不写入。

---

## 当前实现摘要（与代码一致）

| 维度 | 行为 |
|------|------|
| 租户隔离 | 排程 JSON 仅 `cln_schedule` 经 `cln_property.operator_id` 过滤；不暴露其他 operator。 |
| 读 | 聊天加载指定马来西亚日历日（及「明天/昨天」等相对日）的工单摘要；**另附**本 operator 的 **`cln_property` 楼盘/单位清单**（与当日是否有单无关），用于核对物业名、单位、新建单前选 `propertyId`。自动派队加载同日上下文含 team、pins、区域。 |
| 写 `team` | 仅服务端自动派队 / incremental / rebalance 等路径；**马来西亚工作日早于「今天」时不写库**（`PAST_WORKING_DAY_READ_ONLY`）。聊天确认「**全部**交给 Team N」时，在模型派队后会再跑一次**确定性全队写队**（摘要里的 Team N），避免模型写入**合法但错误**的其它队 UUID。 |
| 写 `status`（批量 pending-checkout） | 与「确认执行」同一条 consent 下，若上一条助手摘要明确要求**全部**改回 **pending checkout**，服务端将 **ready-to-clean → pending-checkout**（终结或其它非 ready 状态跳过）。 |
| 写 `cln_schedule`（**新建一行**） | 上一条助手含 `SCHEDULE_JOB_CREATE_JSON` + 征求确认，operator 短确认后 `createCleaningScheduleJobUnified`（与 Portal Create Job 一致；**date** 须与工具栏当日一致）。 |
| 写其它 | 对话 MERGE 路径可写 `cln_operator_ai` 的 pinned / schedule_prefs（见代码 `mergeExtractedConstraints`）；Schedule **Map** 页签内 **Edit area groups** 写 `region_groups`。**聊天本身不写 `cln_schedule.team`**，须确认流程。派队跳过行时回复可含 `rejected[].reason` 汇总（如 `BAD_TEAM`、`PINNED_VIOLATION`、`NOT_ELIGIBLE`）。 |
| 平台规则 | SaaS 表 `cln_saasadmin_ai_md` 经 `safePlatformRulesPrefix()` 拼进模型 system（含 `CLN-AI1`…`CLN-AI6`）。 |

---

## 问卷（题目）

### A. 数据范围（本 Operator）

- **A1** `cln_schedule`：是否允许后端为 Jarvis **读取**本 operator 下所有相关排程（含历史、未来）？
- **A2** `cln_property` / `cln_operator_team`：是否允许在对话/派队逻辑中 **读取**（pins、区域、队名）？
- **A3** `cln_clientdetail` / `cln_employeedetail` 等：是否允许将来加入 **摘要级**上下文，还是 **永不**？
- **A4** 发票 / 薪资 / 银行：是否 **明确禁止** Jarvis 触碰？

### B. 排程写权限（经允许的 API，非模型自述）

- **B1** `cln_schedule.team`：Schedule 主流程保留；Jarvis 仅作快捷后门触发**已有**写库路径；是否还 **新增**「纯聊天、绕过 Schedule」的写 `team` API？
- **B2** `cln_schedule` 其它列（`status`、时间、`ai_assignment_locked` 等）：**一律禁止** 还是列明允许字段？
- **B3** 已完成（Complete）或 AI 锁单：是否 **永远不允许** AI 改 `team`？（口语「锁排」若指 complete，定稿为 **是**）

### C. 配置（`cln_operator_ai`）

- **C1** MERGE：`pinnedConstraints` / `schedule_prefs_json` 是否允许对话 **合并写入**？是否需 **二次确认**？
- **C2** `prompt_extra`：是否视为 Operator **授权 Jarvis 长期参考**？

### D. 行为边界

- **D1** 是否禁止在未经服务端确认前说「已保存 / 已改库」？
- **D2** 是否 **绝对禁止** 跨 operator 数据？
- **D3** 日志/聊天是否 **不得** 含完整电话/身份证等敏感信息？

### E. 平台

- **E1** `allowedDataScopes` 除 `cln_schedule` 外是否计划扩展（如 `cln_property`）？

---

## 定稿填写（维护者）

| 编号 | 定稿 |
|------|------|
| A1 | 允许 |
| A2 | 仅只读 |
| A3 | 仅只读（将来摘要级；非「永不」） |
| A4 | 禁止 |
| B1 | Schedule 接口保留；Jarvis 为快捷后门，仅触发已有写 `team` 路径；不新增「纯聊天绕过 Schedule」的写队 API |
| B2 | 禁止 |
| B3 | 是：Complete（已完成）不得被 AI 改队；另 `ai_assignment_locked` 的未完成锁单也不改（见上文 B3） |
| C1 | 第二次确认 |
| C2 | 是的 |
| D1 | 是的 |
| D2 | 是的 |
| D3 | 不影响（不要求日志额外脱敏规则） |
| E1 | 后期扩展；现在只读取 |

---

## 建议落档（与计划一致）

| 用途 | 位置 |
|------|------|
| 全平台模型禁区 / 合规 | SaaS → `cln_saasadmin_ai_md`（`CLN-AI6` 等） |
| 与实现绑定的默认行为 | `src/modules/cleanlemon/cln-operator-ai.service.js` |
| Operator 可见短说明 | Portal：`cleanlemon-operator-ai-messages.ts`、`operator-ai-bot-dock.tsx` |
| 本仓库备忘 | 本文 `docs/jarvis-operator-permissions.md` |
