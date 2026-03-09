# Wix CMS 集合/字段 → MySQL 表/列 对照表

用于你提供的 JSW（agreementdetail.jsw、bankbulktransfer.jsw 等）里 **query CMS 用到的每个 collection 与 field**，在 MySQL 里是否有对应 table & column，以及依据从哪里来。

## 规则（Wix CMS + 后端 → Node + MySQL）

- **导入**：从 Wix 进 MySQL 时传入 **wix_id / xxx_wixid**（如 `property_wixid`、`billtype_wixid`）。
- **关联**：库里用 **_id (FK)** 做 reference，指向本库表（如 `property_id` → propertydetail，`supplierdetail_id` → supplierdetail）。
- **bills 表**：**不关联 account**。bills 的「类型/供应商」= **supplierdetail**：存 `billtype_wixid`（Wix 导入值，= supplierdetail.wix_id）+ `supplierdetail_id`（FK → supplierdetail.id）。
- **propertydetail 表**：`management_id`、`internettype_id` 为 FK → supplierdetail(id)；`agreementtemplate_id` 为 FK → agreementtemplate(id)。导入用对应 `*_wixid`；可用各表 wix_id 回填 _id（0024 management/internettype，0025 agreementtemplate）。JP Reference（网络类）用 `wifi_id`（0025 加列），无则用 wifidetail。
- **bills 表没有 electric/water/wifi 列**。类型靠 **bills.supplierdetail_id → supplierdetail**：仅当 **supplierdetail.utility_type**（0026）为 `electric`/`water`/`wifi` 时填 JP Reference 1（electric→property.electric，water→property.water，wifi→property.wifi_id 或 wifidetail）；**utility_type 为空**则视为普通 supplier（多为 bank transfer，走 bankdetail_wixid/bankdetail_id），不填 Reference 1。若某笔资料不齐（缺 Biller Code、缺银行、或 utility 缺 Reference），下载 zip 时会包含 **errors.txt** 列出未纳入的 item 及原因。

> **约定**：业务逻辑一律用 `_id`（如 `client_id`、`property_id`、`supplierdetail_id`）；`_wixid` 仅导入/迁移用。  
> 若某 field 在库里没有对应列或对应关系不明确，会标 **⚠ 缺口**，需与维护者确认。

---

## 1) agreementdetail.jsw 用到的 CMS → MySQL

| Wix CMS 集合 | Wix 字段 (fieldkey) | MySQL 表 | MySQL 列 | 依据 |
|--------------|---------------------|---------|----------|------|
| agreementtemplate | _id | agreementtemplate | id | 迁移/通用 |
| agreementtemplate | templateurl | agreementtemplate | templateurl | 0014 / import-agreementtemplate |
| agreementtemplate | folderurl | agreementtemplate | folderurl | 同上 |
| agreementtemplate | html | agreementtemplate | html | 同上 |
| agreementtemplate | title | agreementtemplate | title | 同上 |
| Tenancy | _id | tenancy | id | 迁移/通用 |
| Tenancy | tenant | tenancy | tenant_id | import-staffdetail-tenancy / 0011 |
| Tenancy | room | tenancy | room_id | 同上 |
| Tenancy | begin | tenancy | begin | 同上 |
| Tenancy | end | tenancy | end | 同上 |
| Tenancy | rental | tenancy | rental | 同上 |
| Tenancy | sign | tenancy | sign | 0010_tenancy_columns |
| Tenancy | password / 门锁 | tenancy | password, passwordid | 0010 / 0011；单锁 TTLock 用 |
| TenantDetail | _id | tenantdetail | id | 迁移/通用 |
| TenantDetail | fullname | tenantdetail | fullname | import-tenantdetail |
| TenantDetail | nric | tenantdetail | nric | 同上 |
| TenantDetail | address | tenantdetail | address | 同上 |
| TenantDetail | phone | tenantdetail | phone | 同上 |
| TenantDetail | email | tenantdetail | email | 同上 |
| RoomDetail | _id | roomdetail | id | 迁移/通用 |
| RoomDetail | roomName | roomdetail | roomname | import-ownerpayout-roomdetail (Room Name→roomname) |
| RoomDetail | property | roomdetail | property_id | 0007 / import-roomdetail |
| RoomDetail | meter | roomdetail | meter_id | 同上 |
| PropertyDetail | _id | propertydetail | id | 迁移/通用 |
| PropertyDetail | apartmentName | propertydetail | apartmentname | 0001_init / import-propertydetail |
| PropertyDetail | unitNumber | propertydetail | unitnumber | 同上 |
| PropertyDetail | address | propertydetail | address | 同上 |
| PropertyDetail | percentage | propertydetail | percentage | 同上 |
| PropertyDetail | client | propertydetail | client_id | import-propertydetail |
| PropertyDetail | owner | propertydetail | owner_id | import-propertydetail (ownername→owner_wixid/owner_id) |
| PropertyDetail | management | propertydetail | management_wixid + management_id (FK→supplierdetail) | import-propertydetail；0024 用 wix_id 回填 |
| clientdetail | _id | clientdetail | id | 迁移/通用 |
| clientdetail | title | clientdetail | title | import-clientdetail / db.md |
| clientdetail | email | clientdetail | email | 同上 |
| clientdetail | currency | clientdetail | currency | 同上 |
| clientdetail | profile | clientdetail | profile (TEXT/JSON) | 0002_clientdetail / client_profile 子表也可用 |
| clientdetail.profile[0] | ssm, address, contact, subdomain, accountNumber | client_profile 或 profile JSON | ssm, address, contact, subdomain, accountnumber | db.md / import-clientdetail |
| meterdetail | _id | meterdetail | id | 迁移/通用 |
| meterdetail | meterId | meterdetail | meterid | 0017_meterdetail_columns / import-meterdetail |
| OwnerDetail | _id | ownerdetail | id | 迁移/通用 |
| OwnerDetail | ownerName | ownerdetail | ownername | import-ownerdetail |
| OwnerDetail | nric | ownerdetail | nric | 同上 |
| OwnerDetail | email | ownerdetail | email | 同上 |
| OwnerDetail | mobileNumber | ownerdetail | mobilenumber | 同上 |
| OwnerDetail | signature | ownerdetail | signature | 同上 |
| OwnerDetail | nricFront | ownerdetail | nricfront | 同上 |
| OwnerDetail | nricback | ownerdetail | nricback | 同上 |
| OwnerDetail | profile (address) | ownerdetail | profile (TEXT/JSON) | 0001 ownerdetail.profile |

---

## 2) bankbulktransfer.jsw 用到的 CMS → MySQL

| Wix CMS 集合 | Wix 字段 (fieldkey) | MySQL 表 | MySQL 列 | 依据 |
|--------------|---------------------|---------|----------|------|
| UtilityBills | _id | bills | id | 0012/0013 / import-bills |
| UtilityBills | amount | bills | amount | 同上 |
| UtilityBills | description | bills | description | 同上 |
| UtilityBills | property | bills | property_id | 同上 |
| UtilityBills | billType | bills | billtype_wixid + supplierdetail_id | 同上（billType→supplierdetail，不连 account） |
| UtilityBills.property | (reference) | propertydetail | id (via bills.property_id) | 同上 |
| PropertyDetail | tnb | propertydetail | electric 或 tnb | import-propertydetail: tnb→electric；sync 脚本有 tnb 列 |
| PropertyDetail | saj | propertydetail | water 或 saj | import-propertydetail: saj→water；sync 有 saj |
| PropertyDetail | wifi | propertydetail | wifidetail、wifi_id（0025）、wifi | 0001 有 wifidetail；0025 加 wifi_id（JP Reference）；sync 可能有 wifi 列 ⚠ |
| PropertyDetail | internetType | propertydetail | internettype_wixid + internettype_id (FK→supplierdetail) | import-propertydetail；0024 用 wix_id 回填 |
| PropertyDetail | unitNumber | propertydetail | unitnumber | 0001 |
| BillType（Wix 里 UtilityBills.billType） | _id, title | account | id, title | import-bills: billType→account |
| BillType | billerCode | supplierdetail 或 account_json | billercode / account_json.billerCode | import-supplierdetail 有 billercode；account 无此列，用 supplierdetail 按 title 匹配或 account_json ⚠ |
| BillType | bankName | supplierdetail 或 account_json | bankdetail_id / account_json.bankName | import-supplierdetail: bankName→bankdetail_id；account 无此列 ⚠ |
| BankDetail | _id | bankdetail | id | 0001 |
| BankDetail | swiftcode | bankdetail | swiftcode | 0001 |
| OwnerPayout | _id | ownerpayout | id | 0006/0008 / import-ownerpayout |
| OwnerPayout | netpayout | ownerpayout | netpayout | 同上 |
| OwnerPayout | period | ownerpayout | period | 同上 |
| OwnerPayout | owner | ownerpayout | 无 owner_id | 通过 property_id→propertydetail.owner_id→ownerdetail ⚠ |
| OwnerPayout | property | ownerpayout | property_id | 0006 |
| OwnerDetail（OwnerPayout.owner） | name / ownerName | ownerdetail | ownername | import-ownerdetail |
| OwnerDetail | bankName | ownerdetail | bankname_id | 同上 |
| OwnerDetail | bankAccount, accountholder, email | ownerdetail | bankaccount, accountholder, email | 同上 |
| clientdetail | profile[0].accountNumber | client_profile 或 clientdetail.profile | accountnumber / profile JSON | db.md / import-clientdetail |

---

## 3) 缺口与需要确认的点

- **property.tnb / saj / wifi**  
  - 表里有 `water`、`electric`、`wifidetail`（0001）；import 约定 tnb→electric、saj→water。  
  - 若 sync 或后续 migration 加了 `tnb`、`saj`、`wifi` 列，则用列名；否则用 electric/water/wifidetail。
- **BillType 的 billerCode、bankName**  
  - 当前 **bills.billtype_id → account(id)**，account 表无 billerCode、bankdetail_id。  
  - 迁移里用 **supplierdetail**（title + client_id 与 bill type 对应）提供 billercode、bankdetail_id；若无则用 **account.account_json**。  
  - 若你希望「BillType = 某一张表」且该表直接有 billerCode、bank 列，需定是沿用 account+account_json、还是加列、还是改用 supplierdetail 为主。
- **OwnerPayout.owner**  
  - MySQL 的 ownerpayout 表**没有 owner_id**，owner 通过 **propertydetail.owner_id → ownerdetail** 得到。  
  - 若 Wix 的 OwnerPayout 有独立 owner 引用且与 property.owner 可能不同，需确认是否要加 ownerpayout.owner_id。

---

## 4) 租客仪表盘（Tenant Dashboard）迁移

- **TenantDetail** → tenantdetail（id, fullname, email, phone, address, nric, bankname_id, bankaccount, accountholder, nricfront, nricback, approval_request_json, profile, account）。
- **Tenancy** → tenancy（id, tenant_id, room_id, client_id, begin, end, rental, agreement, tenancystatus, passcodes, status）；关联 property/client/room 通过 JOIN；agreements 通过 agreement 表 tenancy_id 查询。
- **clientdetail**（approval 列表）→ clientdetail（id, title）。
- **RoomDetail + meter** → roomdetail JOIN meterdetail。
- **PropertyDetail + smartdoor** → propertydetail.smartdoor_id → lockdetail；roomdetail.smartdoor_id → lockdetail。
- **BankDetail** → bankdetail。
- **agreement**（租客签署）→ agreement（tenantsign, status 等）；模板 agreementtemplate。
- **RentalCollection** → rentalcollection（tenancy_id, amount, date, ispaid, invoiceurl, receipturl, type_id）；排除部分 type_id 见 tenantdashboard.service RENTAL_EXCLUDED_TYPE_IDS。
- **feedback**：表名 **feedback**，迁移见 `0038_create_feedback.sql`；Admin 页用列 done、remark 见 `0044_feedback_done_remark.sql`。列：id, tenancy_id, room_id, property_id, **client_id (FK → clientdetail.id)**, tenant_id, description, photo (JSON), video, done, remark, created_at, updated_at。未建表前 submitFeedback 会返回 FEEDBACK_TABLE_MISSING。

## 5) 其他已迁移 JSW 用到的表（仅列名）

- **billing.jsw**：clientdetail (title, currency, pricingplandetail, credit)、pricingplan、pricingplanaddon、client_credit、**creditlogs**（表见 migration `0030_create_creditlogs.sql`：title, amount, reference_number, payment, client_id, creditplan_id, staff_id, type, sourplan_id, is_paid, txnid, payload, paiddate, remark, pricingplanlog_id, currency；无 redirect_url，Stripe 用 success_url/cancel_url，前端传 returnUrl）。
- **access/manage.jsw**：staffdetail (email, client_id, permission_json)、clientdetail、client_credit、client_pricingplan_detail。
- **companysetting（ECS companysetting.service）**：**StaffDetail** → staffdetail (name, email, salary, bankaccount, bank_name_id→bankdetail.id, permission_json, status, client_id)；**BankDetail** → bankdetail (id, bankname)；**clientdetail.profile[0]** → client_profile (ssm, address, contact, subdomain, tin, accountholder, accountnumber, bank_id)；**clientdetail.integration** → client_integration (key, slot, provider, values_json, enabled)；**clientdetail.admin** → clientdetail.admin (TEXT/JSON)；Stripe Connect → client_profile.stripe_connected_account_id（0029）。

---

## 5) tenantinvoice.jsw / 发票页 用到的 CMS → MySQL

发票页（租金列表、创建发票、电表分摊、Topup）已迁移为 **Wix 前端 + Node 后端 + MySQL**，数据通过 **backend/saas/tenantinvoice.jsw** 请求 `/api/tenantinvoice/*`，不读 Wix CMS。

| Wix CMS 集合 | Wix 字段 (fieldkey) | MySQL 表 | MySQL 列 | 依据 |
|--------------|---------------------|---------|----------|------|
| RentalCollection | _id | rentalcollection | id | 0001_init |
| RentalCollection | client | rentalcollection | client_id | 0021 backfill |
| RentalCollection | property | rentalcollection | property_id | 同上 |
| RentalCollection | room | rentalcollection | room_id | 同上 |
| RentalCollection | tenant | rentalcollection | tenant_id | 同上 |
| RentalCollection | type | rentalcollection | type_id (FK→account) | 同上 |
| RentalCollection | date, amount, title, isPaid, invoiceid, paidat, referenceid, invoiceurl, receipturl | rentalcollection | date, amount, title, ispaid, invoiceid, paidat, referenceid, invoiceurl, receipturl | 0001_init |
| RentalCollection | description | rentalcollection | description（与 referenceid 独立列，0039_rentalcollection_description.sql） | 0039 |
| PropertyDetail | _id, shortname | propertydetail | id, shortname | 0001_init |
| PropertyDetail | owner (reference) | propertydetail | owner_id → ownerdetail.id；ownerdetail.ownername | 0001 / 0034 |
| bukkuid (invoice type) | _id, title | account | id, title | 0001_init / 0015_account_columns |
| bukkuid (accounting 设置页) | _id, title, type, bukkuaccounttype | account | id, title, type, bukkuaccounttype | 0001 / 0015；列表/详情/保存/Sync 走 /api/account/* |
| bukkuid.account[] | clientId, system, accountid, productId | account | account_json (JSON 数组) | 同上；每 client 一条 mapping |
| Tenancy | _id, status | tenancy | id, status | 0010 / 0011 |
| Tenancy | room, tenant | tenancy | room_id, tenant_id | 同上 |
| RoomDetail | title_fld | roomdetail | title_fld | 0008 |
| TenantDetail | fullname | tenantdetail | fullname | import-tenantdetail |
| creditplan | _id, title, sellingprice, credit | creditplan | id, title, sellingprice, credit | 0001 / 0016；列表走 /api/billing/credit-plans |
| meterdetail | _id, meterId, title, mode, rate, metersharing | meterdetail | id, meterid, title, mode, rate, metersharing_json | 0001 / 0017；分组由 Node 解析 metersharing_json 返回 |

- **外键一律用 _id**：查询、写入只用 `client_id`、`property_id`、`type_id`（→ account）等，不用 _wixid。
- **电表用量**：Node 调 CNYIoT `getUsageSummary`，计算逻辑在 `src/modules/tenantinvoice/tenantinvoice.service.js`（usage + calculation 两阶段）。

---

## 6) admindashboard（Admin 页）CMS → MySQL

Admin 页（feedback + refunddeposit 列表、标记完成、删除）已迁移为 **Wix 前端 + Node 后端 + MySQL**，数据通过 **backend/saas/admindashboard.jsw** 请求 `/api/admindashboard/*`，不读 Wix CMS。

| Wix CMS 集合 | Wix 字段 (fieldkey) | MySQL 表 | MySQL 列 | 依据 |
|--------------|---------------------|---------|----------|------|
| feedback | _id, description, photo, video, done, remark | feedback | id, description, photo, video, done, remark | 0038 / 0044_feedback_done_remark |
| feedback | room (reference) | feedback + roomdetail | room_id → roomdetail.id；roomdetail.title_fld | 0038 |
| feedback | tenant (reference) | feedback + tenantdetail | tenant_id → tenantdetail.id；fullname, bankname_id→bankdetail.bankname, bankaccount, accountholder | 0001 tenantdetail / bankdetail |
| feedback | property (reference) | feedback + propertydetail | property_id → propertydetail.id；shortname | 0038 |
| feedback | client (reference) | feedback + clientdetail | client_id → clientdetail.id；currency | 0038 |
| refunddeposit | _id, amount, done | refunddeposit | id, amount, done | 0001_init / 0045_refunddeposit_done_fk |
| refunddeposit | room (reference) | refunddeposit + roomdetail | room_id → roomdetail.id；roomtitle 兼容 | 0045 |
| refunddeposit | tenant (reference) | refunddeposit + tenantdetail | tenant_id → tenantdetail.id；tenantname 兼容 | 0045 |
| refunddeposit | client (reference) | refunddeposit + clientdetail | client_id → clientdetail.id；currency | 0045 |

- 列表、更新、删除均由 Node `admindashboard.service` 按 `client_id` 鉴权；外键一律用 `_id`。

---

## 7) Profile / Contact 页（backend/saas/contact.jsw）

Profile 页（Topup + Contact 列表、Owner/Tenant/Supplier 增删改、审批、Supplier 创建与 Bukku 同步）已迁移为 **Wix 前端 + Node 后端 + MySQL**。数据通过 **backend/saas/contact.jsw** 请求 `/api/contact/*`，不读 Wix CMS。Topup 仍用 **backend/billing**（credit-plans、topup/start）。

| Wix CMS 集合 | Wix 字段 (fieldkey) | MySQL 表/结构 | MySQL 列/说明 | 依据 |
|--------------|---------------------|--------------|--------------|------|
| creditplan | _id, title, sellingprice, credit | creditplan | id, title, sellingprice, credit | 列表走 /api/billing/credit-plans |
| OwnerDetail | _id, ownerName, email | ownerdetail | id, ownername, email | 0001_init / import-ownerdetail |
| OwnerDetail | client (multi) | owner_client | owner_id, client_id | 0037 关联表；已批准 = 在 owner_client |
| OwnerDetail | approvalRequest | ownerdetail | approvalpending (text JSON) | 0001；格式 [{ clientId, status, createdAt }] |
| OwnerDetail | account | ownerdetail | account (text JSON) | 0001；[{ clientId, provider, id }] Bukku 等 |
| TenantDetail | _id, fullname, email | tenantdetail | id, fullname, email | 0001 / import-tenantdetail |
| TenantDetail | client (multi) | tenant_client | tenant_id, client_id | 0032；已批准 = 在 tenant_client |
| TenantDetail | approvalRequest | tenantdetail | approval_request_json | 0032；格式同上 |
| TenantDetail | account | tenantdetail | account (text JSON) | 0001 |
| SupplierDetail | _id, title, email, billerCode, bankName, bankAccount, bankHolder | supplierdetail | id, title, email, billercode, bankdetail_id, bankaccount, bankholder | 0001 / 0003 / 0004 |
| SupplierDetail | client (multi) | supplierdetail | client_id | 0003；一 row 一 client，多 client 则多 row |
| SupplierDetail | account | supplierdetail | account (text JSON) | 0044_supplierdetail_account；[{ clientId, provider, id }] |

- 外键一律用 `_id`（client_id 等）。Owner/Tenant 列表 = owner_client/tenant_client（已批准）+ approvalpending/approval_request_json（待批准）。Supplier 创建/更新时 Node 调 Bukku contact API（upsertContactTransit），再写 supplierdetail。
- **前端元素与数据：** `#dropdownbank` 选项来自 **bankdetail** 表（`POST /api/contact/banks` → id/bankname，value=id 写入 supplierdetail.bankdetail_id）。**account system：** 访客 client 的 account system（sql/autocount/bukku/xero）由 `POST /api/contact/account-system` 返回，决定 account[] 的 provider 键；**无 account system 或未 setup 时 #inputbukkuid 一律 disable**。`#inputbukkuid` 读写 **ownerdetail / tenantdetail / supplierdetail 的 account 列**（TEXT JSON：`[{ clientId, provider, id }]`，按 clientId + provider 读写）。保存时 Owner/Tenant 调 updateOwnerAccount/updateTenantAccount( id, contactId )；Supplier 调 updateSupplier，payload 含 bankName（bankdetail_id）、contactId（按当前 provider 合并进 account）。**#buttondeletecontact** 第一次点击 label 为「Confirm Delete」，第二次点击才执行删除/取消。Section 切换（#buttontopup、#buttoncontact）及 **#buttoneditcontact** 点击时先 disable、label「Loading」，await 完成后再切换/展开。

---

## 8) accountaccess.jsw → Node /api/account/resolve

原 **backend/access/accountaccess.jsw**（resolveAccountSystem：定价方案校验、Account/addonAccount 集成、凭证提取）已迁入 Node **account.service**，由 **backend/saas/account.jsw** 请求 **POST /api/account/resolve**（body: `{ email }`）。返回形状：`{ ok, reason?, provider?, credential?: { token, subdomain } }`。定价方案取自 **client_pricingplan_detail**（type=plan，plan_id ∈ ACCOUNTING_PLAN_IDS）；凭证取自 **client_integration**（key 为 Account 或 addonAccount，provider 为 bukku/xero）。
