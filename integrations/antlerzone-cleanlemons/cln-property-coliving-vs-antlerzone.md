# `cln_property`：Coliving 同步 vs Antlerzone ECS

对照 **代码实际写入**（`coliving-cleanlemons-link.service.js` 的 `upsertSyncedClnProperty` + `mirrorPropertydetailToClnRows`；`cleanlemon-antlerzone-sync.service.js` 的 `mapBodyToRow` + `upsertAntlerzoneProperty`）。未列出的列两端通常**不写**（或由其它功能单独更新）。

| `cln_property` 字段 | Coliving 集成会写入 | Antlerzone ECS (`/api/cleanlemon-sync/antlerzone-property`) 会写入 |
|---------------------|---------------------|------------------------------------------------------------------|
| `id` | 新建时后端生成 UUID | 新建时后端生成 UUID |
| `operator_id` | INSERT 常为 **NULL**；UPDATE 时 `COALESCE(?, operator_id)`，不覆盖已有 | **必填**：来自 `cln_client_operator`（由 API Key 解析） |
| `client_id` | 一般不写（INSERT 里为 NULL） | 仅 **env 旧模式** 可能写入 `ANTLERZONE_CLN_CLIENT_ID` |
| `clientdetail_id` | **是**：来自联动的 `cleanlemons_clientdetail_id` | **是**：来自 API Key 对应的 `cln_client_integration.clientdetail_id` |
| `property_name` | **是**（来自 Coliving 物业/房间展示名） | **是**（`propertyName`） |
| `address` | **是** | **是**（`address`） |
| `unit_name` | **是** | **是**（`unitName`） |
| `waze_url` | **是**（由地址解析/继承） | **否**（当前 Antlerzone 映射未接） |
| `google_maps_url` | **是**（同上） | **否** |
| `latitude` / `longitude` | **否**（本同步不写） | **否** |
| `premises_type` | **是**（仅 `mirrorPropertydetailToClnRows`） | **否** |
| `security_system` | **是**（仅 mirror） | **否** |
| `mailbox_password` | **否** | **是**（有列则写） |
| `contact` | **否** | **是** |
| `bed_count` | **否** | **是** |
| `room_count` | **否** | **是** |
| `bathroom_count` | **否** | **是** |
| `kitchen` / `living_room` / `balcony` / `staircase` | **否** | **是** |
| `lift_level` | **否** | **是** |
| `special_area_count` | **否** | **是** |
| `cleaning_fees` | **否** | **是**（`cleaningfees`） |
| `source_id` | **否** | **是**（Antlerzone `_id` → `sourceId`，且用于 upsert 键） |
| `is_from_a` | **否** | **是**（`isFromA`） |
| `cc_json` | **否**（历史迁移曾从 JSON 补 `clientdetail_id`） | **是**（图库等 JSON） |
| `coliving_propertydetail_id` | **是**（主键关联 Coliving 物业） | **否** |
| `coliving_roomdetail_id` | **是**（房间级可为 NULL） | **否** |
| `client_portal_owned` / `smartdoor_*` 等 | **否**（本同步不写） | **否** |

## 识别「同一行」的方式（不同）

| | Coliving | Antlerzone |
|---|----------|------------|
| **Upsert 查找键** | `coliving_propertydetail_id` + `coliving_roomdetail_id`（可空匹配） | `source_id` + `operator_id` |

## 小结

- **同一张表**，两套**不同的业务键**和**字段集合**：Coliving 强调与 **`propertydetail`/`roomdetail` 的桥接**与导航字段；Antlerzone 强调 **`source_id` + 房型/费用/Media（`cc_json`）**。
- 若要让某一列两边都填，需要在对应服务里**扩展映射**（例如给 Antlerzone 增加 `waze`/`googleMap` → `waze_url`/`google_maps_url`）。
