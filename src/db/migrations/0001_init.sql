-- initial schema for tenantdetail / clientdetail and related tables
-- all identifiers are lowercase

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ClientDetail: 主表只存扁平字段；array 拆到子表 client_integration / client_profile / client_pricingplan_detail / client_credit
CREATE TABLE IF NOT EXISTS clientdetail (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  title varchar(255) DEFAULT NULL,
  email varchar(255) DEFAULT NULL,
  status tinyint(1) DEFAULT NULL,
  profilephoto text DEFAULT NULL,
  subdomain varchar(255) DEFAULT NULL,
  expired datetime DEFAULT NULL,
  pricingplan_wixid varchar(255) DEFAULT NULL,
  pricingplan_id varchar(36) DEFAULT NULL,
  currency varchar(20) DEFAULT NULL,
  admin text DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_clientdetail_wix_id (wix_id),
  KEY idx_clientdetail_email (email),
  KEY idx_clientdetail_subdomain (subdomain),
  KEY idx_clientdetail_pricingplan_wixid (pricingplan_wixid),
  KEY idx_clientdetail_pricingplan_id (pricingplan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- TenantDetail: reference = xxx_wixid + xxx_id；array 存 text
CREATE TABLE IF NOT EXISTS tenantdetail (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  fullname varchar(255) DEFAULT NULL,
  nric varchar(50) DEFAULT NULL,
  address text,
  phone varchar(100) DEFAULT NULL,
  email varchar(255) DEFAULT NULL,
  bankname_wixid varchar(255) DEFAULT NULL,
  bankname_id varchar(36) DEFAULT NULL,
  bankaccount varchar(100) DEFAULT NULL,
  accountholder varchar(255) DEFAULT NULL,
  nricfront text,
  nricback text,
  client_wixid varchar(255) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  account text DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tenantdetail_wix_id (wix_id),
  KEY idx_tenantdetail_client_wixid (client_wixid),
  KEY idx_tenantdetail_client_id (client_id),
  KEY idx_tenantdetail_bankname_wixid (bankname_wixid),
  KEY idx_tenantdetail_bankname_id (bankname_id),
  KEY idx_tenantdetail_email (email),
  CONSTRAINT fk_tenantdetail_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_tenantdetail_bankname
    FOREIGN KEY (bankname_id) REFERENCES bankdetail (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS client_integration (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  wix_id varchar(36) DEFAULT NULL,
  `key` varchar(50) NOT NULL,
  version int DEFAULT NULL,
  slot int DEFAULT NULL,
  enabled tinyint(1) NOT NULL DEFAULT 1,
  provider varchar(50) DEFAULT NULL,
  values_json json DEFAULT NULL,
  einvoice tinyint(1) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_client_integration_client_id (client_id),
  KEY idx_client_integration_client_wixid (client_wixid),
  KEY idx_client_integration_key ( `key` ),
  CONSTRAINT fk_client_integration_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS client_profile (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  wix_id varchar(36) DEFAULT NULL,
  tin varchar(50) DEFAULT NULL,
  contact varchar(50) DEFAULT NULL,
  subdomain varchar(100) DEFAULT NULL,
  accountholder varchar(255) DEFAULT NULL,
  ssm varchar(50) DEFAULT NULL,
  currency varchar(10) DEFAULT NULL,
  address text,
  accountnumber varchar(100) DEFAULT NULL,
  bank_id varchar(36) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_client_profile_client_id (client_id),
  KEY idx_client_profile_client_wixid (client_wixid),
  CONSTRAINT fk_client_profile_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS client_pricingplan_detail (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  wix_id varchar(36) DEFAULT NULL,
  type varchar(20) NOT NULL,
  plan_id varchar(36) NOT NULL,
  title varchar(255) DEFAULT NULL,
  expired datetime DEFAULT NULL,
  qty int DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_client_pricingplan_detail_client_id (client_id),
  KEY idx_client_pricingplan_detail_client_wixid (client_wixid),
  KEY idx_client_pricingplan_detail_plan_id (plan_id),
  CONSTRAINT fk_client_pricingplan_detail_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS client_credit (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  type varchar(50) NOT NULL,
  amount decimal(18,2) NOT NULL DEFAULT 0,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_client_credit_client_id (client_id),
  KEY idx_client_credit_client_wixid (client_wixid),
  CONSTRAINT fk_client_credit_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS agreementtemplate (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  folderurl varchar(255) DEFAULT NULL,
  title varchar(255) DEFAULT NULL,
  html text,
  templateurl varchar(255) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agreementtemplate_wix_id (wix_id),
  KEY idx_agreementtemplate_client_id (client_id),
  KEY idx_agreementtemplate_client_wixid (client_wixid),
  CONSTRAINT fk_agreementtemplate_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS account (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  bukkuaccounttype varchar(100) DEFAULT NULL,
  title varchar(255) DEFAULT NULL,
  accountid int DEFAULT NULL,
  account_json json DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_account_wix_id (wix_id),
  KEY idx_account_accountid (accountid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bankdetail (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  owner_id varchar(36) DEFAULT NULL,
  swiftcode varchar(50) DEFAULT NULL,
  bankname varchar(255) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bankdetail_wix_id (wix_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS gatewaydetail (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  owner_id varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  locknum int DEFAULT NULL,
  isonline tinyint(1) NOT NULL DEFAULT 0,
  gatewayid int DEFAULT NULL,
  gatewayname varchar(255) DEFAULT NULL,
  networkname varchar(255) DEFAULT NULL,
  type varchar(50) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gatewaydetail_wix_id (wix_id),
  KEY idx_gatewaydetail_client_id (client_id),
  KEY idx_gatewaydetail_client_wixid (client_wixid),
  KEY idx_gatewaydetail_gatewayid (gatewayid),
  CONSTRAINT fk_gatewaydetail_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS lockdetail (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  owner_id varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  lockid int DEFAULT NULL,
  lockname varchar(255) DEFAULT NULL,
  lockalias varchar(255) DEFAULT NULL,
  gateway_id varchar(36) DEFAULT NULL,
  hasgateway tinyint(1) NOT NULL DEFAULT 0,
  electricquantity int DEFAULT NULL,
  type varchar(50) DEFAULT NULL,
  brand varchar(50) DEFAULT NULL,
  isonline tinyint(1) NOT NULL DEFAULT 0,
  active tinyint(1) NOT NULL DEFAULT 1,
  childmeter json DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lockdetail_wix_id (wix_id),
  KEY idx_lockdetail_lockid (lockid),
  KEY idx_lockdetail_gateway_id (gateway_id),
  KEY idx_lockdetail_client_id (client_id),
  KEY idx_lockdetail_client_wixid (client_wixid),
  CONSTRAINT fk_lockdetail_gateway
    FOREIGN KEY (gateway_id) REFERENCES gatewaydetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_lockdetail_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS doorsync (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  owner_id varchar(36) DEFAULT NULL,
  lock_id int DEFAULT NULL,
  passwordid int DEFAULT NULL,
  password varchar(255) DEFAULT NULL,
  requested_at datetime DEFAULT NULL,
  response text,
  tenancy_wix_id varchar(36) DEFAULT NULL,
  tenancy_id varchar(36) DEFAULT NULL,
  status varchar(50) DEFAULT NULL,
  action varchar(50) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_doorsync_wix_id (wix_id),
  KEY idx_doorsync_lock_id (lock_id),
  KEY idx_doorsync_tenancy_wix_id (tenancy_wix_id),
  KEY idx_doorsync_tenancy_id (tenancy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- OwnerDetail: reference = xxx_wixid + xxx_id；array 存 text 方便 CSV 上传，后续 services 可解析
CREATE TABLE IF NOT EXISTS ownerdetail (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  ownername varchar(255) DEFAULT NULL,
  bankname_wixid varchar(255) DEFAULT NULL,
  bankname_id varchar(36) DEFAULT NULL,
  bankaccount varchar(100) DEFAULT NULL,
  email varchar(255) DEFAULT NULL,
  nric varchar(50) DEFAULT NULL,
  signature text,
  nricfront text,
  nricback text,
  accountholder varchar(255) DEFAULT NULL,
  mobilenumber varchar(100) DEFAULT NULL,
  status varchar(50) DEFAULT NULL,
  approvalpending text DEFAULT NULL,
  client_wixid varchar(255) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  property_wixid varchar(255) DEFAULT NULL,
  property_id varchar(36) DEFAULT NULL,
  profile text DEFAULT NULL,
  account text DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ownerdetail_wix_id (wix_id),
  KEY idx_ownerdetail_email (email),
  KEY idx_ownerdetail_client_wixid (client_wixid),
  KEY idx_ownerdetail_client_id (client_id),
  KEY idx_ownerdetail_property_wixid (property_wixid),
  KEY idx_ownerdetail_property_id (property_id),
  KEY idx_ownerdetail_bankname_wixid (bankname_wixid),
  KEY idx_ownerdetail_bankname_id (bankname_id),
  CONSTRAINT fk_ownerdetail_bankname
    FOREIGN KEY (bankname_id) REFERENCES bankdetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_ownerdetail_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_ownerdetail_property
    FOREIGN KEY (property_id) REFERENCES propertydetail (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- meter_type: parent = 整户总表 (e.g. 一间屋子一个总表), child = 房间分表 (e.g. 5个房间各一个表). parent 用量 = sum(children 用量).
CREATE TABLE IF NOT EXISTS meterdetail (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  meter_type varchar(20) NOT NULL DEFAULT 'parent',
  parentmeter_id varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  rate decimal(18,4) DEFAULT NULL,
  isonline tinyint(1) NOT NULL DEFAULT 0,
  meterid varchar(100) DEFAULT NULL,
  childmeter_json json DEFAULT NULL,
  balance decimal(18,4) DEFAULT NULL,
  metersharing_json json DEFAULT NULL,
  status tinyint(1) NOT NULL DEFAULT 1,
  productname varchar(100) DEFAULT NULL,
  mode varchar(50) DEFAULT NULL,
  title varchar(255) DEFAULT NULL,
  lastsyncat datetime DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_meterdetail_wix_id (wix_id),
  KEY idx_meterdetail_client_id (client_id),
  KEY idx_meterdetail_client_wixid (client_wixid),
  KEY idx_meterdetail_meterid (meterid),
  KEY idx_meterdetail_parentmeter_id (parentmeter_id),
  CONSTRAINT fk_meterdetail_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_meterdetail_parent
    FOREIGN KEY (parentmeter_id) REFERENCES meterdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- PropertyDetail: 所有 reference 一律 xxx_wixid（上传用）+ xxx_id（FK）
CREATE TABLE IF NOT EXISTS propertydetail (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  percentage decimal(5,2) DEFAULT NULL,
  unitnumber varchar(500) DEFAULT NULL,
  shortname varchar(255) DEFAULT NULL,
  meter_wixid varchar(36) DEFAULT NULL,
  meter_id varchar(36) DEFAULT NULL,
  water varchar(255) DEFAULT NULL,
  signature text,
  tenancyenddate datetime DEFAULT NULL,
  agreementtemplate_wixid varchar(36) DEFAULT NULL,
  agreementtemplate_id varchar(36) DEFAULT NULL,
  remark text,
  apartmentname varchar(255) DEFAULT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  management_wixid varchar(36) DEFAULT NULL,
  management_id varchar(36) DEFAULT NULL,
  address text,
  internettype_wixid varchar(36) DEFAULT NULL,
  internettype_id varchar(36) DEFAULT NULL,
  electric decimal(18,2) DEFAULT NULL,
  owner_wixid varchar(36) DEFAULT NULL,
  owner_id varchar(36) DEFAULT NULL,
  smartdoor_wixid varchar(36) DEFAULT NULL,
  smartdoor_id varchar(36) DEFAULT NULL,
  parkinglot text,
  signagreement varchar(500) DEFAULT NULL,
  agreementstatus text DEFAULT NULL,
  checkbox tinyint(1) DEFAULT NULL,
  wifidetail text,
  active tinyint(1) NOT NULL DEFAULT 1,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_propertydetail_wix_id (wix_id),
  KEY idx_propertydetail_client_wixid (client_wixid),
  KEY idx_propertydetail_client_id (client_id),
  KEY idx_propertydetail_meter_wixid (meter_wixid),
  KEY idx_propertydetail_meter_id (meter_id),
  KEY idx_propertydetail_agreementtemplate_wixid (agreementtemplate_wixid),
  KEY idx_propertydetail_agreementtemplate_id (agreementtemplate_id),
  KEY idx_propertydetail_management_wixid (management_wixid),
  KEY idx_propertydetail_management_id (management_id),
  KEY idx_propertydetail_internettype_wixid (internettype_wixid),
  KEY idx_propertydetail_internettype_id (internettype_id),
  KEY idx_propertydetail_owner_wixid (owner_wixid),
  KEY idx_propertydetail_owner_id (owner_id),
  KEY idx_propertydetail_smartdoor_wixid (smartdoor_wixid),
  KEY idx_propertydetail_smartdoor_id (smartdoor_id),
  KEY idx_propertydetail_unitnumber (unitnumber),
  CONSTRAINT fk_propertydetail_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_propertydetail_meter
    FOREIGN KEY (meter_id) REFERENCES meterdetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_propertydetail_agreementtemplate
    FOREIGN KEY (agreementtemplate_id) REFERENCES agreementtemplate (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_propertydetail_management
    FOREIGN KEY (management_id) REFERENCES supplierdetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_propertydetail_internettype
    FOREIGN KEY (internettype_id) REFERENCES supplierdetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_propertydetail_owner
    FOREIGN KEY (owner_id) REFERENCES ownerdetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_propertydetail_smartdoor
    FOREIGN KEY (smartdoor_id) REFERENCES lockdetail (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS roomdetail (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  property_id varchar(36) DEFAULT NULL,
  media_gallery_json json DEFAULT NULL,
  meter_id varchar(36) DEFAULT NULL,
  description_fld text,
  price decimal(18,2) DEFAULT NULL,
  availablesoon tinyint(1) NOT NULL DEFAULT 0,
  mainphoto text,
  availablefrom datetime DEFAULT NULL,
  remark text,
  title_fld varchar(255) DEFAULT NULL,
  link_room_detail_title_fld varchar(255) DEFAULT NULL,
  available tinyint(1) NOT NULL DEFAULT 0,
  roomname varchar(255) DEFAULT NULL,
  active tinyint(1) NOT NULL DEFAULT 1,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_roomdetail_wix_id (wix_id),
  KEY idx_roomdetail_client_id (client_id),
  KEY idx_roomdetail_client_wixid (client_wixid),
  KEY idx_roomdetail_property_id (property_id),
  KEY idx_roomdetail_meter_id (meter_id),
  CONSTRAINT fk_roomdetail_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_roomdetail_property
    FOREIGN KEY (property_id) REFERENCES propertydetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_roomdetail_meter
    FOREIGN KEY (meter_id) REFERENCES meterdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS ownerpayout (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  property_id varchar(36) DEFAULT NULL,
  totalcollection decimal(18,2) DEFAULT NULL,
  netpayout decimal(18,2) DEFAULT NULL,
  monthlyreport text,
  totalutility decimal(18,2) DEFAULT NULL,
  bukkubills varchar(255) DEFAULT NULL,
  totalrental decimal(18,2) DEFAULT NULL,
  title varchar(255) DEFAULT NULL,
  period datetime DEFAULT NULL,
  expenses decimal(18,2) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ownerpayout_wix_id (wix_id),
  KEY idx_ownerpayout_client_id (client_id),
  KEY idx_ownerpayout_client_wixid (client_wixid),
  KEY idx_ownerpayout_property_id (property_id),
  CONSTRAINT fk_ownerpayout_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_ownerpayout_property
    FOREIGN KEY (property_id) REFERENCES propertydetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS rentalcollection (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  property_id varchar(36) DEFAULT NULL,
  room_id varchar(36) DEFAULT NULL,
  tenant_id varchar(36) DEFAULT NULL,
  tenancy_wix_id varchar(36) DEFAULT NULL,
  invoiceid varchar(100) DEFAULT NULL,
  paidat datetime DEFAULT NULL,
  referenceid varchar(100) DEFAULT NULL,
  accountid int DEFAULT NULL,
  bukku_invoice_id int DEFAULT NULL,
  amount decimal(18,2) DEFAULT NULL,
  ispaid tinyint(1) NOT NULL DEFAULT 0,
  date datetime DEFAULT NULL,
  receipturl varchar(255) DEFAULT NULL,
  productid int DEFAULT NULL,
  invoiceurl varchar(255) DEFAULT NULL,
  title varchar(255) DEFAULT NULL,
  type_id varchar(36) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rentalcollection_wix_id (wix_id),
  KEY idx_rentalcollection_client_id (client_id),
  KEY idx_rentalcollection_client_wixid (client_wixid),
  KEY idx_rentalcollection_property_id (property_id),
  KEY idx_rentalcollection_room_id (room_id),
  KEY idx_rentalcollection_tenant_id (tenant_id),
  KEY idx_rentalcollection_type_id (type_id),
  CONSTRAINT fk_rentalcollection_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_rentalcollection_property
    FOREIGN KEY (property_id) REFERENCES propertydetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_rentalcollection_room
    FOREIGN KEY (room_id) REFERENCES roomdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_rentalcollection_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenantdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_rentalcollection_type
    FOREIGN KEY (type_id) REFERENCES account (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS staffdetail (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  name varchar(255) DEFAULT NULL,
  bank_name_id varchar(36) DEFAULT NULL,
  bankaccount varchar(100) DEFAULT NULL,
  email varchar(255) DEFAULT NULL,
  permission_json json DEFAULT NULL,
  salary decimal(18,2) DEFAULT NULL,
  status tinyint(1) NOT NULL DEFAULT 1,
  client_id varchar(36) DEFAULT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_staffdetail_wix_id (wix_id),
  KEY idx_staffdetail_email (email),
  KEY idx_staffdetail_client_id (client_id),
  KEY idx_staffdetail_client_wixid (client_wixid),
  CONSTRAINT fk_staffdetail_bank
    FOREIGN KEY (bank_name_id) REFERENCES bankdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_staffdetail_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS supplierdetail (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  status tinyint(1) NOT NULL DEFAULT 1,
  msg text,
  title varchar(255) DEFAULT NULL,
  contact_id int DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_supplierdetail_wix_id (wix_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS tenancy (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  tenant_id varchar(36) DEFAULT NULL,
  room_id varchar(36) DEFAULT NULL,
  begin datetime DEFAULT NULL,
  `end` datetime DEFAULT NULL,
  rental decimal(18,2) DEFAULT NULL,
  signagreement tinyint(1) NOT NULL DEFAULT 0,
  agreement text,
  checkbox tinyint(1) NOT NULL DEFAULT 0,
  submitby_id varchar(36) DEFAULT NULL,
  sign text,
  status tinyint(1) NOT NULL DEFAULT 1,
  billsurl varchar(255) DEFAULT NULL,
  billsid varchar(100) DEFAULT NULL,
  title varchar(255) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tenancy_wix_id (wix_id),
  KEY idx_tenancy_tenant_id (tenant_id),
  KEY idx_tenancy_room_id (room_id),
  KEY idx_tenancy_submitby_id (submitby_id),
  CONSTRAINT fk_tenancy_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenantdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_tenancy_room
    FOREIGN KEY (room_id) REFERENCES roomdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_tenancy_submitby
    FOREIGN KEY (submitby_id) REFERENCES staffdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS bills (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  description text,
  billtype_id varchar(36) DEFAULT NULL,
  amount decimal(18,2) DEFAULT NULL,
  listingtitle varchar(255) DEFAULT NULL,
  property_id varchar(36) DEFAULT NULL,
  period datetime DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bills_wix_id (wix_id),
  KEY idx_bills_property_id (property_id),
  CONSTRAINT fk_bills_billtype
    FOREIGN KEY (billtype_id) REFERENCES account (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_bills_property
    FOREIGN KEY (property_id) REFERENCES propertydetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS metertransaction (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  tenant_id varchar(36) DEFAULT NULL,
  tenancy_id varchar(36) DEFAULT NULL,
  property_id varchar(36) DEFAULT NULL,
  meter varchar(100) DEFAULT NULL,
  meteridx bigint DEFAULT NULL,
  invoiceid varchar(100) DEFAULT NULL,
  referenceid varchar(100) DEFAULT NULL,
  bukku_invoice_id int DEFAULT NULL,
  amount decimal(18,2) DEFAULT NULL,
  ispaid tinyint(1) NOT NULL DEFAULT 0,
  failreason text,
  status varchar(50) DEFAULT NULL,
  invoiceurl varchar(255) DEFAULT NULL,
  receipturl varchar(255) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_metertransaction_wix_id (wix_id),
  KEY idx_metertransaction_tenant_id (tenant_id),
  KEY idx_metertransaction_tenancy_id (tenancy_id),
  KEY idx_metertransaction_property_id (property_id),
  KEY idx_metertransaction_meter (meter),
  CONSTRAINT fk_metertransaction_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenantdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_metertransaction_tenancy
    FOREIGN KEY (tenancy_id) REFERENCES tenancy (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_metertransaction_property
    FOREIGN KEY (property_id) REFERENCES propertydetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- agreement: 新 cms，后期按 services 再加 column；目前仅基础结构
CREATE TABLE IF NOT EXISTS agreement (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agreement_wix_id (wix_id),
  KEY idx_agreement_client_id (client_id),
  KEY idx_agreement_client_wixid (client_wixid),
  CONSTRAINT fk_agreement_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS creditplan (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  credit decimal(18,2) DEFAULT NULL,
  sellingprice decimal(18,2) DEFAULT NULL,
  title varchar(255) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_creditplan_wix_id (wix_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS cnyiottokens (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  client_id varchar(36) NOT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  apikey text,
  loginid varchar(100) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cnyiottokens_wix_id (wix_id),
  KEY idx_cnyiottokens_client_id (client_id),
  KEY idx_cnyiottokens_client_wixid (client_wixid),
  CONSTRAINT fk_cnyiottokens_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS parkinglot (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  property_id varchar(36) DEFAULT NULL,
  parkinglot varchar(255) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_parkinglot_wix_id (wix_id),
  KEY idx_parkinglot_client_id (client_id),
  KEY idx_parkinglot_client_wixid (client_wixid),
  KEY idx_parkinglot_property_id (property_id),
  CONSTRAINT fk_parkinglot_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_parkinglot_property
    FOREIGN KEY (property_id) REFERENCES propertydetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- subscription plan (main plan); addon 用 pricingplanaddon，renew 时一起续
CREATE TABLE IF NOT EXISTS pricingplan (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  description text,
  features_json json DEFAULT NULL,
  corecredit decimal(18,2) DEFAULT NULL,
  sellingprice decimal(18,2) DEFAULT NULL,
  addon_json json DEFAULT NULL,
  title varchar(255) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pricingplan_wix_id (wix_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS pricingplanaddon (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  description_json json DEFAULT NULL,
  credit_json json DEFAULT NULL,
  qty int DEFAULT NULL,
  title varchar(255) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pricingplanaddon_wix_id (wix_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS pricingplanlogs (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  staff_id varchar(36) DEFAULT NULL,
  plan_id varchar(36) DEFAULT NULL,
  scenario varchar(50) DEFAULT NULL,
  redirecturl varchar(255) DEFAULT NULL,
  txid varchar(100) DEFAULT NULL,
  paidat datetime DEFAULT NULL,
  payload_json json DEFAULT NULL,
  newexpireddate datetime DEFAULT NULL,
  payexreference varchar(255) DEFAULT NULL,
  amount decimal(18,2) DEFAULT NULL,
  addondeductamount decimal(18,2) DEFAULT NULL,
  amountcents int DEFAULT NULL,
  status varchar(50) DEFAULT NULL,
  title varchar(255) DEFAULT NULL,
  addons_json json DEFAULT NULL,
  referencenumber varchar(100) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pricingplanlogs_wix_id (wix_id),
  KEY idx_pricingplanlogs_client_id (client_id),
  KEY idx_pricingplanlogs_client_wixid (client_wixid),
  KEY idx_pricingplanlogs_plan_id (plan_id),
  CONSTRAINT fk_pricingplanlogs_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_pricingplanlogs_staff
    FOREIGN KEY (staff_id) REFERENCES staffdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_pricingplanlogs_plan
    FOREIGN KEY (plan_id) REFERENCES pricingplan (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS refunddeposit (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  fallback varchar(255) DEFAULT NULL,
  amount decimal(18,2) DEFAULT NULL,
  roomtitle varchar(255) DEFAULT NULL,
  tenantname varchar(255) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_refunddeposit_wix_id (wix_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS ttlocktoken (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  expiresin int DEFAULT NULL,
  refreshtoken text,
  accesstoken text,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ttlocktoken_wix_id (wix_id),
  KEY idx_ttlocktoken_client_id (client_id),
  KEY idx_ttlocktoken_client_wixid (client_wixid),
  CONSTRAINT fk_ttlocktoken_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 历史同步状态表，后续同步统一由 console 处理，仅保留作迁移/历史
CREATE TABLE IF NOT EXISTS syncstatus (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  fail int DEFAULT NULL,
  updatedat datetime DEFAULT NULL,
  success int DEFAULT NULL,
  skip int DEFAULT NULL,
  total int DEFAULT NULL,
  status varchar(50) DEFAULT NULL,
  createdat datetime DEFAULT NULL,
  done int DEFAULT NULL,
  message text,
  type varchar(50) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_syncstatus_wix_id (wix_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

