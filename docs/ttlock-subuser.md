# TTLock 子账号（为 Client 开 Subaccount）

SaaS 平台可为每个 **Client** 开一个 TTLock 子账号，便于按 client 隔离门锁与网关。

---

## 1. 能力说明

- **TTLock 开放平台** 提供 [v3 user/register](https://euopen.ttlock.com/doc/api/v3/user/register)：用 app 的 `clientId` + `clientSecret` 注册新用户（username + 明文密码，接口内会 MD5）。
- **Username 与 password 均由我们 SaaS 设定**（非 TTLock 随机生成）：我们为每个 client 调用一次 register，**username** 使用该 client 的 **subdomain**（小写、全库唯一），**password** 由我们设定（默认如 `0123456789`），并将 `ttlock_username`、`ttlock_password` 写入 `client_integration`（key=smartDoor, provider=ttlock）。
- 之后该 client 的门锁/网关请求都用这份账号换 token，实现「一个 client = 一个 TTLock 子账号」。

---

## 2. 规则

| 项目 | 规则 |
|------|------|
| username | 取自 `client_profile.subdomain`（或 `clientdetail.subdomain`），**小写、trim**；需全库唯一（与 CNYIoT 子账号一致）。 |
| 默认密码 | `0123456789`（可配置）；修改密码后须写回 `client_integration.values_json.ttlock_password`。 |
| 存储 | `client_integration`：key=smartDoor, provider=ttlock；values_json：ttlock_username、ttlock_password。 |
| 无 integration 行 | 若尚无 smartDoor/ttlock 行，会先自动插入一行再调用 register 并写入账号。 |

---

## 3. 使用方式

### HTTP

- **POST /api/ttlock/users/ensure-subuser**  
  - 请求：无 body（client 由 clientresolver 从 host 解析）。  
  - 成功：`{ ok: true, data: { username, created } }`（created 表示本次新注册）。  
  - 错误：400（如 CLIENT_SUBDOMAIN_REQUIRED、TTLOCK_REGISTER_FAILED_*）、403（如 TTLOCK_APP_CREDENTIALS_MISSING）。

### 程序调用

```js
const ttlock = require('./src/modules/ttlock');

// 为 client 确保子账号（无则用 subdomain 注册并写入 client_integration）
const { username, created } = await ttlock.ensureTTLockSubuser(clientId);
```

仅需注册时（不写 client_integration）可单独调用：

```js
const { registerUser } = require('./src/modules/ttlock/lib/ttlockRegister');
const res = await registerUser({ username: 'subdomain', password: '0123456789' });
// res.errcode === 0 表示成功，res.username 为 TTLock 返回的用户名
```

---

## 4. 环境与依赖

- **Env：** `TTLOCK_CLIENT_ID`、`TTLOCK_CLIENT_SECRET`（TTLock Open Platform 应用凭证）。
- **数据：** client 须有 subdomain（client_profile 或 clientdetail），且 subdomain 全库唯一（见迁移 0028_client_profile_subdomain_unique_lowercase）。

---

## 5. 与 CNYIoT 子账号的对比

| 项目 | TTLock | CNYIoT |
|------|--------|--------|
| 接口 | v3 user/register | addUser（登录后调用） |
| 认证 | 仅 app clientId/clientSecret | 主账号登录后带 apiKey |
| username | subdomain（小写） | subdomain（小写） |
| 存储 | client_integration.values_json：ttlock_username、ttlock_password | client_integration.values_json：cnyiot_subuser_login、cnyiot_subuser_password、cnyiot_subuser_id |
| 无 integration 行 | 自动插入 smartDoor/ttlock 再注册 | 需先有 meter/cnyiot 行 |
