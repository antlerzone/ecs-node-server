# CNYIoT 对外接口文档与本机 wrapper 对照

依据《对外接口文档及接入手册》整理。**完整接口手册**（40 个 Method、错误代码、设备类型）见 [cnyiot-api-interface-manual.md](./cnyiot-api-interface-manual.md)。请求均为 **POST**，**JSON body**；应答格式 `{"result": "错误代码", "value": 额外数据}`。

## URL 与 apikey

- **Base URL**：官方为 `/api.ashx?Method=方法名&api=1212&apikey=加密值`。`api=1212` 为示例，实际 api 值需向平台索取（本机用 env `CNYIOT_API_ID`，默认 coliman）。
- **apikey**：登入返回的 apiKey 经 **AES 加密** 后 **URL 编码** 再放入 url；加密密钥需向平台索取（本机 env `CNYIOT_AES_KEY`）。apikey 有效期 24 小时，跨月立即失效。

本机默认直连官方：`https://www.openapi.cnyiot.com/api.ashx`。可覆盖 `CNYIOT_BASE_URL`。

**测试充值**：在项目根目录执行  
`node scripts/test-cnyiot-topup-with-find-client.js [meterId] [amount]`  
会自动查找已配置 CNYIoT 的 client，默认对表 19101920205 充值 10 kWh。  
或指定 client：`node scripts/test-cnyiot-topup.js <clientId> 19101920205 10`。  
需 .env 配置 `CNYIOT_AES_KEY`、`CNYIOT_API_ID`（如 coliman），且至少一个 client 在 `client_integration` 中 key=meter、provider=cnyiot、values_json 含 cnyiot_username/cnyiot_password。

---

## 本机 Method ↔ 文档章节

| 本机 wrapper 方法 / 路由 | 官方 Method | 文档章节 | 说明 |
|--------------------------|-------------|----------|------|
| login（token 层）        | login       | §1       | 登入，返回 apiKey、LoginID |
| getPrices                | getPrices   | §6       | ptype: -1 全部，1 电价，2 水价，3 其他 |
| addPrice                 | addPrice    | §8       | PriceName, Price, Pnote, priceType |
| deletePrice              | deletePrice | §7       | body.id 为价格序号数组 |
| editPrice                | editPrice   | §9       | PriceID, PriceName, Price, Pnote, priceType |
| getMeters                | getMetList_Simple | §14 | mt: 0 水表 1 电表 |
| getMeterStatus           | getMetStatusByMetId | §15 | body.metid 表号 |
| addMeters                | addMeter    | §16      | body.mts 数组，MeterID 11 位，index 必填且唯一 |
| deleteMeters             | deleteMeter | §17     | body.MetID 或 MeterID 表号数组 |
| editMeterSafe            | editMeter   | §18      | MeterID, MeterName, PriceID, Tel, warmKwh, Remarks, UserID, sellMin |
| setRelay                 | setRelay    | §29      | Val: 1 断开 2 闭合，MetID, iswifi |
| setPowerGate             | setPowerGate | §27    | Val 功率门限，MetID, iswifi |
| setRatio                 | setRatio    | §28      | ratio 变比，MetID, iswifi，仅三相 381 表 |
| createPendingTopup       | sellByApi   | §25      | metid, sellKwh, sellMoney, simple |
| confirmTopup             | sellByApiOk | §26     | metid, idx（sellByApi 返回） |
| getUsageRecords          | getRecord_Simple | §39 | metID, st, et, mYMD：1 按天 2 按月 3 按年 |
| getMonthBill             | getMonthBill | §40    | metID 逗号隔开，st, et, mYMD |
| getOperationHistory      | getHist     | §31      | st, et |
| getUsers                 | getUsers       | §10     | 租客列表 |
| addUser                 | addUser        | §12     | 新增租客（uI=subdomain 作 client 分组） |
| editUser                | editUser       | §13     | 编辑租客 |
| link2User                | link2User      | §21     | 电表绑定租客（UserID=0 解绑） |
| link2MetersList          | link2MetersList | §22    | 某租客已绑/未绑设备 |
| link2Meter               | link2Meter     | §23     | 租客绑定/解绑电表 |
| editPsw / rstPsw        | editPsw / rstPsw | §2 / §3 | 改密 / 房东重置租客密码 |

未在 wrapper 中实现的官方接口（可按需加）：editPay(§4)、editLogin(§5)、deleteUser(§11)、clearKwh(§19)、clearSteal(§20)、sellKwh 房东充值(§24)、getTkSta(§30)、getHists(§32)、getSumm(§33)、公摊相关(§34–§38)。

---

## 错误代码（文档摘录）

| 代码 | 含义 |
|------|------|
| 200  | 操作成功 |
| 202  | 操作失败（批量时可能带 value 解析每项） |
| 5000 | 接口方法名错误或非 POST |
| 5001 | 无效请求（json 错误或 apikey 解密错误） |
| **5002** | **密钥失效，需重新登入**（本机自动清 token 并重试一次） |
| 5003 | 处理异常（数据格式/类型不对） |
| 5004 | 该密钥无权操作 |
| 4002 | 登入密码错误 |
| 4003 | 账号或密码错误 |
| 4004 | 账号不存在 |
| 4005 | 账号已锁定 |
| 4219 | 多个表正在使用无法删除（如 4219#11 表示 11 个表） |
| 4127 | 多个表绑定了此用户无法删除（如 4127#2） |

---

## 设备类型（文档摘录）

- 在线三相：380 NB直接式、381 NB互感式、382 WiFi直接式、383 WiFi互感式等
- 在线单相：18 单相表、19 单相导轨表
- 智能水表：50
