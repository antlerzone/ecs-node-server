---
name: Multi-client property sharing
overview: Group-based sharing — assign group to one operator; bookings and status updates both scoped by selected group; email invites with create/edit/delete; owner can kick members.
todos:
  - id: migration-group-tables
    content: Add cln_property_group (incl. operator_id), group_property link, group_member (email invite + permissions + status)
    status: completed
  - id: svc-group-access
    content: Resolve access by group membership; list properties for owner OR group member
    status: completed
  - id: routes-acl
    content: Enforce create/edit/delete + status updates on property + schedule APIs within group scope (group_id validation)
    status: completed
  - id: api-group-crud
    content: Owner APIs — create group, add properties, invite by email, update perms, kick member
    status: completed
  - id: ui-group-sharing
    content: Client portal — group UI, operator select, email invite, permission toggles, member list with kick
    status: completed
  - id: ui-schedule-group
    content: Schedule page — select group for list + create booking + update status; wire operator_id from group
    status: completed
  - id: optional-per-resource-split
    content: If product later needs separate CRUD for property vs booking, extend permission columns
    status: completed
isProject: false
---

# Group 分享 + Email 邀请 + 权限 + Owner 踢人

## 产品要点（相对前一版）

- **Group 为一等公民**：不再把「仅 per-property share」当作唯一路径；以 **group** 组织一批 property（或先建 group 再往里面加 property）。
- **邀请方式**：输入 **email** 邀请；后端解析/创建 `cln_clientdetail` 或 pending 行，与现有 portal 注册衔接。
- **权限**（每条 membership 上三个开关，建议布尔列或 JSON 内三个键）：
  - **create** — 在 group 范围内新建（如新建 booking、若允许则新建 property 挂到 group）
  - **edit** — 修改（含 **更新预约/工单 status**，与改时间、备注等同属「编辑」类操作，除非日后单独拆 `can_update_status`）
  - **delete** — 删除（含取消预约、移除 property 出 group 等按产品定义）
- **Owner**：group 的拥有者（与 `cln_clientdetail` 对应）可 **kick** 任意成员（删除 membership 或标 `revoked`），被踢用户立刻失去该 group 下所有资源访问。
- **Group ↔ Operator（必选产品行为）**：创建或编辑 group 时，**选择绑定哪一个 Cleanlemons operator**（`cln_operatordetail.id`，与现网 client portal 选运营商一致）。同组内挂的 property 应 **与该 operator 一致**；后端校验「加入 group 的 property.operator_id === group.operator_id」，避免跨运营商混在同一 group。
- **创建预约 / booking**：在 Schedule（预约）流程中 **先选 group**（再选该 group 下的 property / 单位），创建 job 时使用 **该 group 的 `operator_id`** 与现有 `createClientScheduleJob` 链路对齐；必要时在 job 或扩展字段上存 `group_id` 便于列表筛选与审计。
- **更新 status（改状态）**：同样要先 **选 group** — 列表/操作上下文限定在该 group 下的预约；改状态请求带 `**group_id`**，后端校验 job 对应 `property_id` 属于该 group，且成员具备 **edit**（或你们若拆出独立开关则校验该开关）。避免跨 group 误改他人工单。

## 数据模型（建议）

1. `**cln_property_group`**
  - `id`, `owner_clientdetail_id`（创建者 / 主公司客户）, `**operator_id`（NOT NULL，由 UI 选择运营商）**, `name`, `created_at`, `updated_at`
2. `**cln_property_group_property`**（或 `group_id` 回到 `cln_property` 上 — 二选一，多对多用 junction 更灵活）
  - `group_id`, `property_id`, UNIQUE(`group_id`,`property_id`)
  - 说明：property 仍可保留 `clientdetail_id` = **主 owner**（与 Coliving sync 一致）；group 是 **协作边界**。
3. `**cln_property_group_member`**
  - `group_id`, `grantee_clientdetail_id`（接受邀请后填入；邀请前可为 NULL）
  - `invite_email`（规范化小写）、`invite_status`（`pending` | `active` | `revoked`）
  - `**can_create`**, `**can_edit**`, `**can_delete**`（TINYINT(1)）
  - `invited_at`, `accepted_at`, `revoked_at`
  - UNIQUE：可对 (`group_id`, `invite_email`) 与 (`group_id`, `grantee_clientdetail_id`) 分情况建唯一约束（pending 时仅 email）
4. **访问判定**：当前登录用户解析到 `clientdetail_id` 后，对某 `property_id` 有权限当且仅当：
  - `cln_property.clientdetail_id === me`（property 主 owner），或
  - 存在某 `group` 包含该 property，且 `group_member` 中该用户为 `active` 且对应 **create/edit/delete** 满足本次操作。

## 后端

- **统一入口**：`assertGroupPropertyAction({ clientdetailId, propertyId, action: 'create'|'edit'|'delete' })`（内部映射到 booking vs property 路由）；若请求带 `group_id`，先校验用户对该 group 的成员身份与权限。
- **List properties**：返回 user 作为 **owner** 的 property ∪ 其所在 **group** 内所有 property（可去重）；可按 `operator_id` / `group_id` 过滤。
- **Group list API**：供预约页下拉用 — 返回当前用户可访问的 groups（owner 或 active member），含 `operator_id`、名称、内含 property 数量摘要。
- **Create booking**：接受 `group_id` + `property_id`（及现有 schedule 字段）；校验 property 属于该 group 且 `property.operator_id === group.operator_id`；用 group 的 operator 调现有排程创建逻辑。
- **List / update schedule jobs（含 status）**：`GET` 列表可按 `**group_id`** 过滤（仅返回该 group 下 property 的 jobs）；`PUT` 改状态或整单编辑时 **要求 `group_id`**（或与现有 `id` 联合校验：解析 job → property → 必须在用户有权的 group 内）。无 `can_edit` 则拒绝 status 更新。
- **Owner-only**：创建/重命名 group、**设置/更改绑定的 operator**（若改 operator，需处理组内 property 是否仍合法或要求先清空）、把 property 加入/移出 group、**发邮件邀请**、改成员权限、**kick**（DELETE member 或 `revoked` + 清权限）。

## 前端（`/client/properties` 与后续导航）

- Group 管理：创建/编辑时 **Operator 下拉**（与现有 client 选运营商数据源一致），保存为 group 的 `operator_id`；仅展示与 `cln_client_operator` 已关联的运营商（与现网规则一致则沿用）。
- Group 管理页或 Properties 内嵌：**输入 email** → 选 create/edit/delete → 发送邀请。
- 成员列表：**踢人** 按钮（仅 owner 可见）。
- `**/client/schedule`（预约）**：
  - **顶部或第一步：选择 group**（决定当前上下文运营商与可见 property / jobs）。
  - **新建预约**：选 group → 选 property → 填表；无 `can_create` 则禁用提交。
  - **列表与改状态**：在已选 group 下展示 jobs；**更新 status**（及编辑预约）仅在同一 group 上下文中提交，无 `can_edit` 则隐藏或禁用状态控件。
- UI 根据 API 返回的权限禁用无权的创建/编辑/删除操作。

## 与「仅 per-property share」关系

- 若产品 **只要 group**：可不做单独的 `cln_property_portal_share` 表，避免两套逻辑并行。
- 若将来需要「单套房源临时分享给某人」：可在 group 里建 **仅含 1 个 property 的 group**，或后续加 per-property share 表。

## 风险备注

- **同 email 多 `cln_clientdetail`**：现有 `CLIENT_PORTAL_AMBIGUOUS_CLIENTDETAIL` 仍存在；邀请 flow 应优先匹配 `portal_account` / 唯一 email。
- **delete** 语义需产品确认：是否包含「删除 property 实体」还是仅「从 group 移除」；建议在实现时 **kick = 仅成员关系**，**delete property = 仅 owner 或显式 grant delete**。

## 实施顺序

1. 迁移：三张（或两张）表 + 索引。
2. Service：membership 解析 + list/detail + ACL。
3. Routes：group CRUD + invite + kick；property/schedule 全部走 ACL。
4. Portal UI：group 选 operator、email 邀请、三权限、成员与 kick。
5. Schedule UI：**选 group** 作为全局上下文 → 列表 / 创建 booking / **更新 status** 均带同一 `group_id`（与后端校验一致）。

