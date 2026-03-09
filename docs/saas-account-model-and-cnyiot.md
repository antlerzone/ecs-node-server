# SaaS 户口层级与 CNYIoT 对应关系

本文说明：**总户口 / 子户口 / 租客** 在本平台与 CNYIoT 的对应关系，以及「创建户口」在 docs 与实现中的位置。

---

## 1. 层级关系（谁是谁）

| 概念 | 在我们平台 | 在 CNYIoT | 说明 |
|------|-------------|-----------|------|
| **总户口** | 我们（平台方） | 不直接对应 | 平台可看所有 client 的数据；API 按 client 隔离（clientresolver 按 host/subdomain 解析出 client）。 |
| **子户口** | **Client**（clientdetail） | **一个登入账号** = 房东 | 每个 client = 一个物业/管理方，有自己的一套登入（含 CNYIoT 的 cnyiot_username/cnyiot_password）。Client 可登入、管理多电表、多租客。 |
| **租客** | **Tenant**（tenantdetail） | **租客**（可建在房东下） | 租客是 **client 的租客**（end user），不是我们平台的 tenant。我们平台只有「客户 = client」与「客户的租客 = tenant」。 |

结论：

- **Client 不是我们的 tenant**。Client 是我们的**客户**（买 SaaS 的物业/管理方）。
- **我们的 tenant**（tenantdetail）= **client 的租客**（住客）。一个 client 下可有多个 tenant、多电表；租客支付成功后，由我们代 client 对电表充值。

---

## 2. 总户口能看到什么、子户口能做什么

- **总户口（我们）**：可查所有 client、所有 tenant、所有电表与充值记录（需后台/管理 API 按 client_id 查）。
- **子户口（client）**：  
  - 通过 **clientresolver** 按 host（如 subdomain）识别出当前 client，只能操作**本 client** 的数据。  
  - 在 **CNYIoT** 里，每个 client 对应一个房东账号（client_integration 里 key=meter, provider=cnyiot 的那组账号），可：  
    - 管理多台电表（getMeters, addMeter, editMeter, …）  
    - 充值（sellByApi + sellByApiOk）  
    - 若在 CNYIoT 侧建了「租客」并绑定电表，则可在平台侧做「租客支付成功 → 给该租客绑定的表充值」。

---

## 3. Docs 里有没有「创建户口」？

### 3.1 创建 / 导入 **Client**（子户口）

- **有**：Client 主数据与子表（含 integration）的导入与同步。  
  - [docs/db/import-clientdetail.md](./db/import-clientdetail.md)：clientdetail CSV 导入、清空、子表同步。  
  - [docs/db/db.md](./db/db.md)：clientdetail、client_integration 结构；integration 里可配 meter/cnyiot（cnyiot_username、cnyiot_password），即该 client 的 CNYIoT 登入。  
- **没有**：单独的「在管理后台点一下创建新 client」的 step-by-step；目前是通过 **导入 clientdetail + 配置 client_integration** 得到新 client（子户口）。

### 3.2 创建 / 导入 **租客**（Tenant）

- **有**：租客资料的导入。  
  - [docs/db/import-tenantdetail.md](./db/import-tenantdetail.md)：TenantDetail CSV → tenantdetail 表（按 client 等关联）。  
  - tenantdetail 表结构：[docs/db/db.md](./db/db.md) 的 tenantdetail 小节。  
- **没有**：  
  - 在**我们系统**里「在页面上新建一个租客」的 step-by-step（若以后有会补）。  
  - 在 **CNYIoT** 里「创建租客（addUser）、绑定电表（link2User / link2Meter）」的文档与 wrapper：目前 CNYIoT wrapper 未实现 getUsers、addUser、editUser、link2User、link2MetersList、link2Meter，所以还没有「在 CNYIoT 创建租客户口」的 step-by-step。

---

## 4. 租客支付成功 → 充值的流程（当前可做）

1. 租客在我们或 client 的流程里完成支付。  
2. 后端用 **client_id**（当前子户口）和该租客对应的 **meterId**（我们 meterdetail 或业务逻辑里约定）调用：  
   - `cnyiot.meter.createPendingTopup(clientId, meterId, amount)`  
   - 再用返回的 `idx` 调用 `cnyiot.meter.confirmTopup(clientId, meterId, idx)`。  
3. 充值即完成；client 在 CNYIoT 侧看到的也是该房东账号下的操作。

**已实现：** 每个 client 可在 CNYIoT 下拥有一个「子账号」租客（addUser，uI=subdomain），用作该 client 的电表分组；电表新增时自动归属该子账号（addMeters 带 UserID + link2User）。规则：subdomain 取自 client_profile（或 clientdetail），**统一小写、全库唯一**；默认密码 0123456789；子账号登入名/密码/id 存 **client_integration**（values_json：cnyiot_subuser_login、cnyiot_subuser_password、cnyiot_subuser_id）；修改密码后也须写回 client_integration。详见下文 §6。

---

## 5. 小结

| 需求 | Docs / 实现 |
|------|-------------|
| 总户口看到所有、子户口只看自己 | 已通过 client_id 隔离与 clientresolver 实现。 |
| Client 有自己户口、可登入、多电表 | 已支持：一个 client = 一个 CNYIoT 房东账号，多电表。 |
| Client 是不是我们的 tenant | **不是**；client 是客户，tenant 是 client 的租客。 |
| 创建 client（子户口） | 有：import-clientdetail + client_integration 配置；无：单独「创建新 client」界面步骤。 |
| 创建租客（我们系统） | 有：import-tenantdetail；无：界面「新建租客」步骤。 |
| 在 CNYIoT 创建租客并绑定电表 | 已实现：getUsers、addUser、link2User 等；ensure-subuser 为 client 建子账号。 |
| 租客支付后充值 | 已有：createPendingTopup + confirmTopup，按 client_id + meterId 调用即可。 |
| **TTLock 为 client 开子账号** | 已实现：v3 user/register，username=subdomain，存 client_integration（smartDoor/ttlock）；`POST /api/ttlock/users/ensure-subuser`、`ttlock.ensureTTLockSubuser(clientId)`。详见 [docs/ttlock-subuser.md](./ttlock-subuser.md)。 |

---

## 6. CNYIoT 子账号与 subdomain 规则

- **addUser 在我们场景**：为「当前 client」在 CNYIoT 下创建一个**租客**（子账号），用作该 client 的**分组**；登入名 uI = **subdomain**（group 名），不与其他 client 重复。
- **subdomain 规则**：  
  - 取自 **client_profile.subdomain**（若无则用 clientdetail.subdomain）。  
  - **统一小写**：写入时 `LOWER(TRIM(subdomain))`（client-subtables 同步时已做）。  
  - **全库唯一**：`client_profile.subdomain` 建了 UNIQUE 约束（迁移 0028）；不得与其它 client 重复。
- **默认密码**：0123456789；存 **client_integration** 同条记录（key=meter, provider=cnyiot）的 values_json：`cnyiot_subuser_login`、`cnyiot_subuser_password`、`cnyiot_subuser_id`（Station_index）。修改密码后需 **save 回 client_integration**（如调用 `PUT /api/cnyiot/users/subuser-password` 或内部 `saveSubuserPassword`）。
- **电表自动进组**：client 新增电表时（addMeters），若该 client 已有子账号（cnyiot_subuser_id），则请求里带 UserID=该 id，并在成功后对每个新表号做 link2User，保证表都进该 client 的 group。
- **API 限制**：getUsers 不返回群组 id，故通过 API addMeter 只能 link2User 绑定到**租客**（Station_index）；**无法把表归到售电员户口/群组**（没有分组 id）。售电员在平台手动建、表归组需平台后台或后续接口支持。
- **接口**：  
  - `POST /api/cnyiot/users/ensure-subuser`：为当前 client 确保存在一个子账号（无则 addUser + 写 client_integration）。  
  - `PUT /api/cnyiot/users/subuser-password`：body `{ "password": "新密码" }`，仅更新 client_integration；若需同步 CNYIoT 可再调 rstPsw。  
  - `GET /api/cnyiot/users`：租客列表（getUsers）。

---

## 7. TTLock 子账号（为 Client 开 Subaccount）

- 平台可为每个 client 开一个 **TTLock 子账号**（开放平台 v3 user/register），实现「一个 client = 一个 TTLock 账号」。
- **username**：client 的 subdomain（小写、唯一）；**默认密码** 0123456789；存 **client_integration**（key=smartDoor, provider=ttlock）的 ttlock_username、ttlock_password。
- 若无 smartDoor/ttlock 行会先自动插入再注册。**接口**：`POST /api/ttlock/users/ensure-subuser`；程序：`ttlock.ensureTTLockSubuser(clientId)`。
- 详见 [docs/ttlock-subuser.md](./ttlock-subuser.md)。
