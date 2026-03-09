# ECS 数据库：外键（FK）与 Junction 表一览

以下为从 `src/db/migrations` 汇总的 **FK 列** 与 **Junction 表** 清单。

---

## 一、Junction 表（多对多关联表）

| 表名 | 说明 | FK 列 | 引用 |
|------|------|--------|------|
| **account_client** | account ↔ client 多对多（按 client 查 account 用） | account_id | → account(id) |
| | | client_id | → clientdetail(id) |
| **owner_client** | owner ↔ client 多对多（Profile Contact 列表） | owner_id | → ownerdetail(id) |
| | | client_id | → clientdetail(id) |
| **owner_property** | owner ↔ property 多对多（一业主多物业） | owner_id | → ownerdetail(id) |
| | | property_id | → propertydetail(id) |
| **tenant_client** | tenant ↔ client 多对多（多 client 批准同一租客） | tenant_id | → tenantdetail(id) |
| | | client_id | → clientdetail(id) |

---

## 二、按表列出的 FK 列（非 Junction 表）

### clientdetail  
- （主表，无 FK）

### tenantdetail  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |
| bankname_id | → bankdetail(id) |

### client_integration  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |

### client_profile  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |

### client_pricingplan_detail  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |

### client_credit  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |

### agreementtemplate  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |

### account  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |

### bankdetail  
- （无 FK）

### gatewaydetail  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |

### lockdetail  
| 列名 | 引用 |
|------|------|
| gateway_id | → gatewaydetail(id) |
| client_id | → clientdetail(id) |

### doorsync  
- （无 FK）

### ownerdetail  
| 列名 | 引用 |
|------|------|
| bankname_id | → bankdetail(id) |
| client_id | → clientdetail(id) |
| property_id | → propertydetail(id) |

### meterdetail  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |
| parentmeter_id | → meterdetail(id) |
| room_id | → roomdetail(id) |
| property_id | → propertydetail(id) |

### propertydetail  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |
| meter_id | → meterdetail(id) |
| agreementtemplate_id | → agreementtemplate(id) |
| management_id | → supplierdetail(id) |
| internettype_id | → supplierdetail(id) |
| owner_id | → ownerdetail(id) |
| smartdoor_id | → lockdetail(id) |

### roomdetail  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |
| property_id | → propertydetail(id) |
| meter_id | → meterdetail(id) |
| smartdoor_id | → lockdetail(id) |

### ownerpayout  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |
| property_id | → propertydetail(id) |

### rentalcollection  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |
| property_id | → propertydetail(id) |
| room_id | → roomdetail(id) |
| tenant_id | → tenantdetail(id) |
| type_id | → account(id) |
| tenancy_id | → tenancy(id) |

### staffdetail  
| 列名 | 引用 |
|------|------|
| bank_name_id | → bankdetail(id) |
| client_id | → clientdetail(id) |

### supplierdetail  
| 列名 | 引用 |
|------|------|
| bankdetail_id | → bankdetail(id) |
| client_id | → clientdetail(id) |

### tenancy  
| 列名 | 引用 |
|------|------|
| tenant_id | → tenantdetail(id) |
| room_id | → roomdetail(id) |
| submitby_id | → staffdetail(id) |
| client_id | → clientdetail(id) |

### bills  
| 列名 | 引用 |
|------|------|
| billtype_id | → account(id)（历史；当前多用 supplierdetail_id） |
| property_id | → propertydetail(id) |
| client_id | → clientdetail(id) |
| supplierdetail_id | → supplierdetail(id) |

### metertransaction  
| 列名 | 引用 |
|------|------|
| tenant_id | → tenantdetail(id) |
| tenancy_id | → tenancy(id) |
| property_id | → propertydetail(id) |

### agreement  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |
| property_id | → propertydetail(id) |
| tenancy_id | → tenancy(id) |

### creditplan  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |

### cnyiottokens  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |

### parkinglot  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |
| property_id | → propertydetail(id) |

### pricingplan / pricingplanaddon  
- （无 FK）

### pricingplanlogs  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |
| staff_id | → staffdetail(id) |
| plan_id | → pricingplan(id) |

### refunddeposit  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |
| room_id | → roomdetail(id) |
| tenant_id | → tenantdetail(id) |

### ttlocktoken  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |

### syncstatus  
- （无 FK）

### stripepayout  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |

### creditlogs  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |
| staff_id | → staffdetail(id) |
| creditplan_id | → creditplan(id) |
| sourplan_id | → pricingplan(id) |
| pricingplanlog_id | → pricingplanlogs(id) |

### faq  
- （无 FK）

### ticket  
| 列名 | 引用 |
|------|------|
| client_id | → clientdetail(id) |

### feedback  
| 列名 | 引用 |
|------|------|
| tenancy_id | → tenancy(id) |
| client_id | → clientdetail(id) |
| tenant_id | → tenantdetail(id) |

### api_user  
- （无 FK）

---

## 三、汇总：含 FK 的表

- **Junction 表（4 张）**：account_client、owner_client、owner_property、tenant_client  
- **含 FK 的普通表（约 30 张）**：见上各表；主被引用表包括 clientdetail、bankdetail、propertydetail、roomdetail、tenantdetail、tenancy、account、supplierdetail、staffdetail、meterdetail、lockdetail、gatewaydetail、agreementtemplate、creditplan、pricingplan、pricingplanlogs 等。

约定：业务与 Node 一律用 `_id` 做关联，不用 `_wixid`。见 `.cursor/rules/mysql-fk-use-id-only.mdc`。
