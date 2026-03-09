# CNYIoT 对外接口文档及接入手册

以下为平台提供的《对外接口文档及接入手册》全文，供开发与排查参考。本机 wrapper 与 Method 对照见 [cnyiot-api-doc-mapping.md](./cnyiot-api-doc-mapping.md)。

---

## 目录

1. login
2. 修改密码 (editPsw)
3. 重置密码 (rstPsw)
4. 修改收款账户 (editPay)
5. 修改登入信息 (editLogin)
6. 获取价格 (getPrices)
7. 删除价格 (deletePrice)
8. 增加价格 (addPrice)
9. 修改价格 (editPrice)
10. 获取用户列表 (getUsers)
11. 删除租客 (deleteUser)
12. 新增租客 (addUser)
13. 修改租客 (editUser)
14. 获取设备列表 (getMetList_Simple)
15. getMetStatusByMetId
16. 新增设备 (addMeter)
17. 删除设备 (deleteMeter)
18. 编辑设备 (editMeter)
19. 电量清零 (clearKwh)
20. 清除窃电 (clearSteal)
21. 设备绑定租客 (link2User)
22. 获取租客已经绑定的设备 (link2MetersList)
23. 绑定/解绑设备 (link2Meter)
24. 房东充值 (sellKwh)
25. 用户充值待付款 (sellByApi)
26. 用户充值确认 (sellByApiOk)
27. 设置功率门限 (setPowerGate)
28. 设置变比 (setRatio)
29. 控制通断 (setRelay)
30. 获取任务状态 (getTkSta)
31. 获取充值记录 (getHist)
32. 获取操作记录 (getHists)
33. 获取设备数量统计 (getSumm)
34. getPublicHisList
35. getPublicHisMes
36. getPublicLink
37. setPublicLink
38. getPublicHisOut
39. getRecord_Simple
40. 获取月账单 (getMonthBill)

文末：错误代码、设备类型。

**注意事项：**

1. 所有请求参数都是 JSON 格式。
2. 正确应答格式：`{"result": "错误代码", "value": "额外数据"}`。
3. 错误代码请特别注意文档中红色/重点部分。
4. url 中的 `api=1212` 向平台索取（本机用 env `CNYIOT_API_ID`，如 coliman）。

---

## 1. login

- **Url:** `/api.ashx?Method=login&api=1212`
- **登入，第一步。**

**请求参数：**

```json
{
  "nam": "yda",
  "psw": "123456"
}
```

**正确应答示例：**

```json
{
  "result": "200",
  "value": {
    "ID": 1,
    "LoginID": "yda",
    "Name": "8",
    "Tel": "13121285",
    "OwnerID": 1,
    "AccType": 1,
    "OwnerLoginID": "yda",
    "OwnerName": "8",
    "AlipayAccount": "1122156111",
    "AlipayRealName": "eea165111",
    "AlipayType": 1,
    "AlipayStatus": 0,
    "Remarks": null,
    "apiKey": "z9bXjSfYC5uO57nNSTjlpjOQSWdU/nhNUz1s3b6jHggLEHOF93rO4klg3c3gy/xO",
    "NoticeText": "系统维护中",
    "NoticeLevel": 501
  }
}
```

- `NoticeLevel` 大于 500 表示维护中，禁止登入。
- **apikey 用法：** 后续接口 Url 为 `/api.ashx?Method=方法名&api=1212&apikey=加密值`。apikey 由登入返回的 apiKey 经 **AES 加密** 后再 **URL 编码**；加密密钥需向平台索取（本机 env `CNYIOT_AES_KEY`）。每个登入账号对应一个 apikey，**有效期 24 小时**，跨月后立即失效，需提早更新。

---

## 2. 修改密码 (editPsw)

- **Method:** editPsw
- **请求参数：** login id, opsw（旧密码）, npsw（新密码）, npsw2（确认密码）
- **正确应答：** `{"result": "200", "value": null}`

---

## 3. 重置密码 (rstPsw)

- **Method:** rstPsw（房东才有权限）
- **请求参数：** login id, uI（房客 id）
- **正确应答：** `{"result": "200", "value": null}`

---

## 4. 修改收款账户 (editPay)

- **Method:** editPay（房东才有权限）
- **请求参数：** login id, pI（支付宝账户）, pN（支付宝实名）, pT（支付宝类型 0 无 1 企业 2 个人）, ps（登入密码）

---

## 5. 修改登入信息 (editLogin)

- **请求参数：** login id, na（昵称）, te（电话）, ps（登入密码）

---

## 6. 获取价格 (getPrices)

- **Method:** getPrices
- **请求参数：** login id, ckv（模糊查询，可忽略）, ptype（-1 全部 1 电价 2 水价 3 其他）, offset, limit（可忽略）
- **正确应答：** result 200，value 为价格列表，每项含 PriceID, PriceName, Price, CreateTime, ChangeTime, PriceInfo, Pnote, priceType（0 其他 1 电价 2 水价）

---

## 7. 删除价格 (deletePrice)

- **请求参数：** login id, id（价格序号数组，如 [15334,250,130]）
- **正确应答：** 带 value，每项为 priceId 与 value（200 成功或如 4219#5 表示无法删除、5 个表正在使用）

---

## 8. 增加价格 (addPrice)

- **请求参数：** login id, PriceName, Price, Pnote, priceType（0 其他 1 电价 2 水价）

---

## 9. 修改价格 (editPrice)

- **请求参数：** login id, PriceID, PriceName, Price, Pnote, priceType

---

## 10. 获取用户列表 (getUsers)

- **Method:** getUsers
- **请求参数：** login id, ckv, offset, limit（可忽略）
- **正确应答：** value 为租客列表，每项含 Station_index（用户序号）, adminID, UserType（6 普通用户）, Name, Tel, CreateTime, LastTime, OwnerID, AlipayAccount, AlipayRealName, AlipayStatus 等
- **限制：** 接口**不返回群组 id**（拿不到用户在哪个群组）。因此通过 API addMeter 时：可用 link2User + UserID(Station_index) **绑定到租客户口**；**无法把表归到售电员户口/群组**，因为没有分组 id。即 API 只能绑定租客，分组不到售电员。

---

## 11. 删除租客 (deleteUser)

- **请求参数：** login id, id（用户序号数组）
- **正确应答：** 带 value，如 userId 对应 value 200 或 4127#2（多个表绑定了此用户无法删除）

---

## 12. 新增租客 (addUser)

- **请求参数：** login id, uN（昵称）, uI（新建用户的登入名，本机用作 subdomain）, tel（电话）
- **正确应答：** 文档未写明 value 内容。若平台在 value 中返回默认密码（如 password/psw/pwd/defaultPassword/initialPassword），本机会解析并写入 client_integration.cnyiot_subuser_password；否则使用本机默认密码并尝试 editLogin（可能 5003）。
- **错误 4127：** 文档中 addUser 段为「请输入用户名和电话」；deleteUser 段 4127 为「多个表绑定了此用户无法删除」。实际接口 4127 常表示 **该登入名已被使用 / 子账号名冲突**，本机映射为 `CNYIOT_ADD_USER_FAILED_4127`。

---

## 13. 修改租客 (editUser)

- **请求参数：** login id, id（租客序号）, uN, uI, tel
- **注意：** 文档未提供 UserType 参数，无法通过本接口修改用户类型（如 6→3）；需在平台后台操作。

---

## 14. 获取设备列表 (getMetList_Simple)

- **请求参数：** login id, ckv, offset, limit, mt（0 水表 1 电表）
- **正确应答：** value 为设备列表，含 i（表号）, n（表名称）, w（告警电量）, m（工作模式 0 预付费 1 后付费）, g, c（价格序号）, e/em/tm, t, p（温度）, x（信号）, s（状态 1 离线表 2 离线 3 在线通电 4 在线断电 5 等待生成 6 等待下发 7 操作异常）, l, pim 等

---

## 15. getMetStatusByMetId

- **请求参数：** login id, metid（表号）
- **正确应答：** value 含 MeterID, PriceID, Name, Tel, Note, 以及 s_enablekwh, s_datetime, s_totalkwh, userName, userLogid, result, type, T_Status 等

---

## 16. 新增设备 (addMeter)

- **请求参数：** login id, mts（数组），每项含 MeterID（11 位）, Name, PriceID, Tel, Note, UserID（0 不绑定）, index（开发者自定义且不能重复）, warmkwh, sellmin, isAdd（1 用户新增）, meterModel（0 预付费 1 后付费）等
- **错误应答：** result 非 200 时可能带 value，键为请求中的 index，值为错误代码（如 4115）

---

## 17. 删除设备 (deleteMeter)

- **请求参数：** login id, MeterID（表号数组，11 位字符串数组）

---

## 18. 编辑设备 (editMeter)

- **请求参数：** login id, MeterID, Tel, warmKwh, MeterName, PriceID, Remarks, UserID（0 不绑定）, sellMin 等（部分仅房东可改）

---

## 19. 电量清零 (clearKwh)

- **请求参数：** login id, MetID, iswifi（固定 1）

---

## 20. 清除窃电 (clearSteal)

- **请求参数：** login id, MetID, iswifi（电表暂无本功能）

---

## 21. 设备绑定租客 (link2User)

- **请求参数：** login id, MeterID, UserID（租客序号，0 表示不绑定）

---

## 22. 获取租客已绑定设备 (link2MetersList)

- **请求参数：** login id, userid（租客序号）
- **正确应答：** value.us 为未绑定任何租客的设备，value.s 为已绑定该 userid 的设备，每项 mI（表号）, mN（表号+名称）

---

## 23. 绑定/解绑设备 (link2Meter)

- **请求参数：** login id, uI（租客序号）, s（要绑定到该租客的电表号数组）, us（要解绑的电表号数组）
- **错误应答：** result 4147 时 value 可能含 bind（如 4148）、unbind（如 4151#1）

---

## 24. 房东充值 (sellKwh)

- **请求参数：** login id, sellKwh, sellMoney, metid, simple（0 两都传 1 只传 sellKwh 2 只传 sellMoney）, iswifi（1 在线表）

---

## 25. 用户充值待付款 (sellByApi)

- 只生成待付款订单，再调 sellByApiOk 才下发电量。
- **请求参数：** login id, sellKwh, sellMoney, simple, metid
- **正确应答：** value.idx 为订单序号，供 sellByApiOk 使用

---

## 26. 用户充值确认 (sellByApiOk)

- **请求参数：** login id, idx（sellByApi 返回的序号）, metid
- **正确应答：** value.idx 与请求一致

---

## 27. 设置功率门限 (setPowerGate)

- **请求参数：** login id, Val（功率门限）, MetID, iswifi

---

## 28. 设置变比 (setRatio)

- 只适用于三相 381 打头表。
- **请求参数：** login id, ratio（变比值，如 5, 100, 150… 50 的倍数… 6000）, MetID, iswifi

---

## 29. 控制通断 (setRelay)

- **请求参数：** login id, Val（1 断开 2 闭合）, MetID, iswifi

---

## 30. 获取任务状态 (getTkSta)

- **请求参数：** login id, ind（任务 id 字符串数组）
- **正确应答：** value 为任务列表，含 T_index, T_MNo, T_Status（2 完成 9 等待付款）, T_type, T_Data, T_Money, T_price, T_Start, finish_time, result（0 等待 2 完成 -1 异常）等

---

## 31. 获取充值记录 (getHist)

- **请求参数：** login id, st, et（时间范围）
- **正确应答：** value 为记录列表，T_type 1 充值 3 清电量，含 T_MNo, T_Data, T_price, T_Money, T_End, T_Status, result, userName, ownerName 等

---

## 32. 获取操作记录 (getHists)

- **请求参数：** login id, st, et, mid（表号）
- 按表号获取所有生成记录（含设置功率门限等）

---

## 33. 获取设备数量统计 (getSumm)

- **请求参数：** loginid, metid
- **返回：** MetCnt, WatCnt, UsersCnt_e, UsersCnt_w, useKwh, sellMoney_e, sellMoney_w, usem3 等

---

## 34–38. 公摊相关

- getPublicHisList：后付费表扣费记录（按天）。
- getPublicHisMes：getPublicHisList 返回的 idx 对应记录的详细信息。
- getPublicLink：获取当前电表绑定的公摊百分比。
- setPublicLink：当前后付费表关联的预付费表（mts, public）。
- getPublicHisOut：总表模式下分表排除的金额。

---

## 39. getRecord_Simple

- **请求参数：** login id, st, et, metID（多个表逗号隔开）, mYMD（3 按年 2 按月 1 按天）
- **返回：** value 为使用电量等记录，含 i（表号）, n, u, k, t, e, p, r, x, d, a, v, w 等

---

## 40. 获取月账单 (getMonthBill)

- **请求参数：** login id, st, et, metID（多个表逗号隔开）, mYMD（3 按年 2 按月 1 按天）
- **正确应答：** value 为账单列表，含 mid, nam, dK, dF, dT, pT, uk, p, m 等

---

## 错误代码（文档摘录）

| 代码 | 含义 |
|------|------|
| 200 | 操作成功 |
| 202 | 操作失败（批量时可能带 value） |
| 5010 | 请勿频繁点击 |
| 5000 | 接口错误（方法名不对或非 POST） |
| 5001 | 无效请求（json 错误或解密 apikey 错误） |
| **5002** | **密钥失效（apikey 过期，需重新获取）** — 本机自动清 token 并重试一次 |
| 5003 | 处理异常（数据格式或类型不对） |
| 5004 | 该密钥无权操作 |
| 5005 | 不能包含特殊字符 |
| 5006 | 无权操作 |
| 5050 | 后台服务程序异常 |
| 4000 | 登陆异常 |
| 4002 | 登入密码错误 |
| 4003 | 账号或密码错误 |
| 4004 | 账号不存在 |
| 4005 | 账号已锁定 |
| 4006 | 密码错误（editPsw） |
| 4106 | 密码修改失败 |
| 4107 | 无权操作或重置失败（rstPsw） |
| 4108 | 账户不能包含特殊字符 |
| 4109 | 支付宝账户输入错误 |
| 4110 | 支付宝实名输入错误 |
| 4111 | 账户错误请重新登入 |
| 4112 | 支付绑定失败请重试 |
| 4113 | 登入名错误 |
| 4114 | 昵称输入错误 |
| 4115 | 电话请输入数字 |
| 4116 | 账户修改失败或已被注册 |
| 4117 | 没有相关电价或无权限 |
| 4118 | 删除失败 |
| 4119 | 可能删除失败请手动确认 |
| 4219 | 多个表正在使用无法删除（如 4219#11） |
| 4120 | 请输入电价名和单价 |
| 4121 | 添加失败电价名请输入常规字符允许中文 |
| 4122 | 电价不能为零 |
| 4123 | 输入单价有误 |
| 4124 | 可能电价名重复 |
| 4125 | 更新失败或权限不足 |
| 4126 | 没有找到相关用户记录 |
| **4127** | **多个表绑定了此用户无法删除**（如 4127#11）；addUser 段文档亦写「请输入用户名和电话」— 实际常表示 **用户名/登入名已被使用**，本机映射 CNYIOT_ADD_USER_FAILED_4127 |
| 4128 | 添加失败 |
| 4129 | 该用户名已被使用 |
| 4130 | 登入名为空 |
| 4131 | 修改失败 |
| 4132 | 该登入名已被注册（editUser）；addMeter 时平台也可能返回 4132 表示表号已存在/已添加 |
| 4133 | 该登入名正在使用 |
| 4134 | 更新租客失败 |
| 4135 | 已更改为新租客 |
| 4136 | 表号输入错误 |
| 4137 | 失败且用户创建成功 |
| 4138 | 创建用户失败 |
| 4139 | 手机号错误或非法 |
| 4140 | 电价名错误或非法 |
| 4141 | 此表已在其他账户下 |
| 4142 | 此表已存在 |
| 4143 | 无法识别的账户信息 |
| 4144 | 备注错误或非法 |
| 4145 | 电表名错误或非法 |
| 4146 | 表号错误 |
| 4147 | 关联失败 |
| 4148 | 绑定电表失败 |
| 4149 | 多个电表绑定失败 |
| 4150 | 解绑电表失败 |
| 4151 | 多个电表解绑失败 |
| 4152 | 后台服务器不在线 |
| 4153 | 未知任务 |
| 4154 | 超时已停止刷新请去查询任务 |
| 4155 | 任务类型错误 |
| 4007 | 电表离线时间过长 |
| 4008 | 获取上次发送结果失败 |
| 4009 | 上次操作未发送结束 |
| 4010 | 未知异常 |
| 4011 | 请先将电表充值为非负 |
| 4012 | 上次操作未完成 |
| 4013 | 获取上次操作失败 |
| 4014 | 提交异常 |
| 4015 | 提交失败 |
| 4016 | 本表无此功能 |
| 4017 | 数据超范围 |
| 4018 | 数据输入错误 |
| 4160 | 删除成功 |
| 4161 | 存在未完成任务 |
| 4162 | 无权请求此表或电表不存在 |
| 4163 | readInstant |
| 4164 | 登录已失效 |
| 4165 | 表号错误或非法 |
| 4166 | 请求数据超范围 |
| 4167 | 非在线表_不支持此操作 |
| 1402 | 通讯超时 |
| 4038 | 等待下发数已超过5 个 |
| 4020 | 支付账户审核中_请联系房东 |
| 4040 | 充值金额需大于最小限额 |
| 4400 | 更新用户失败 |
| 4401 | 已更改为新用户 |
| 4402 | 本表版本不支持此功能 |
| 4403 | 此预付费表绑定了公用表（如 4403#19000000018） |

---

## 设备类型（文档摘录）

- **在线三相：** 380 NB直接式、381 NB互感式、382 WiFi直接式、383 WiFi互感式、384 2G直接式、385 2G互感式、386 4G直接式、387 4G互感式
- **在线单相：** 18 单相表、19 单相导轨表
- **智能水表：** 50

---

*完整原始手册以平台提供为准；本页为归档与开发参考。*
