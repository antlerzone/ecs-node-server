#!/usr/bin/env node
/**
 * Find DB columns that are never referenced in application code (src/ + scripts/, excluding migrations).
 * Usage: node scripts/find-unused-db-columns.js
 * Output: table.column list where column has 0 occurrences in src/ and scripts/ .js files
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const SCRIPTS = path.join(ROOT, 'scripts');

// Full schema: table -> [columns]. Built from 0001_init.sql + all ADD COLUMN in migrations.
const SCHEMA = {
  operatordetail: ['id','wix_id','title','email','status','profilephoto','subdomain','expired','pricingplan_wixid','pricingplan_id','currency','admin','created_at','updated_at','integration','profile','pricingplandetail','credit'],
  tenantdetail: ['id','wix_id','fullname','nric','address','phone','email','bankname_wixid','bankname_id','bankaccount','accountholder','nricfront','nricback','client_wixid','client_id','account','created_at','updated_at','approval_request_json'],
  client_integration: ['id','client_id','client_wixid','wix_id','key','version','slot','enabled','provider','values_json','einvoice','created_at','updated_at'],
  client_profile: ['id','client_id','client_wixid','wix_id','tin','contact','subdomain','accountholder','ssm','currency','address','accountnumber','bank_id','created_at','updated_at','stripe_connected_account_id','stripe_connect_pending_id','stripe_sandbox','stripe_platform'],
  client_pricingplan_detail: ['id','client_id','client_wixid','wix_id','type','plan_id','title','expired','qty','created_at','updated_at'],
  client_credit: ['id','client_id','client_wixid','wix_id','type','amount','created_at','updated_at'],
  agreementtemplate: ['id','wix_id','client_id','client_wixid','folderurl','title','html','templateurl','created_at','updated_at','mode'],
  account: ['id','wix_id','title','accountid','account_json','created_at','updated_at','type','is_product','uses_platform_collection_gl','client_wixid','client_id','productid','provider'],
  bankdetail: ['id','wix_id','owner_id','swiftcode','bankname','created_at','updated_at'],
  gatewaydetail: ['id','wix_id','owner_id','client_id','client_wixid','locknum','isonline','gatewayid','gatewayname','networkname','type','created_at','updated_at'],
  lockdetail: ['id','wix_id','owner_id','client_id','client_wixid','lockid','lockname','lockalias','gateway_id','gateway_wixid','hasgateway','electricquantity','type','brand','isonline','active','childmeter','created_at','updated_at'],
  doorsync: ['id','wix_id','owner_id','lock_id','passwordid','password','requested_at','response','tenancy_wix_id','tenancy_id','status','action','created_at','updated_at'],
  ownerdetail: ['id','wix_id','ownername','bankname_wixid','bankname_id','bankaccount','email','nric','signature','nricfront','nricback','accountholder','mobilenumber','status','approvalpending','client_wixid','client_id','property_wixid','property_id','profile','account','created_at','updated_at'],
  meterdetail: ['id','wix_id','meter_type','parentmeter_id','client_id','client_wixid','rate','isonline','meterid','childmeter_json','balance','metersharing_json','status','productname','mode','title','lastsyncat','created_at','updated_at','room_wixid','room_id','property_wixid','property_id','customname','cnyiotmeterid','parentmeter_wixid'],
  propertydetail: ['id','wix_id','percentage','unitnumber','shortname','meter_wixid','meter_id','water','signature','tenancyenddate','agreementtemplate_wixid','agreementtemplate_id','remark','apartmentname','client_wixid','client_id','management_wixid','management_id','address','internettype_wixid','internettype_id','electric','owner_wixid','owner_id','smartdoor_wixid','smartdoor_id','parkinglot','signagreement','agreementstatus','checkbox','wifidetail','active','created_at','updated_at','wifi_id','folder'],
  roomdetail: ['id','wix_id','client_id','client_wixid','property_id','property_wixid','media_gallery_json','meter_id','meter_wixid','description_fld','price','availablesoon','mainphoto','availablefrom','remark','title_fld','available','roomname','active','created_at','updated_at','smartdoor_wixid','smartdoor_id','parkinglot','smartmeter','appointment','availabledate','msg','status'],
  ownerpayout: ['id','wix_id','client_id','client_wixid','property_id','property_wixid','totalcollection','netpayout','monthlyreport','totalutility','bukkubills','totalrental','title','period','expenses','created_at','updated_at','bukkuinvoice','paid','management_fee','accounting_status','payment_date','payment_method','status','generated_at'],
  rentalcollection: ['id','wix_id','client_id','client_wixid','property_id','room_id','tenant_id','tenancy_wix_id','invoiceid','paidat','referenceid','accountid','bukku_invoice_id','amount','ispaid','date','receipturl','productid','invoiceurl','title','type_id','created_at','updated_at','tenancy_id','description','property_wixid','room_wixid','tenant_wixid','type_wixid'],
  staffdetail: ['id','wix_id','name','bank_name_id','bankname_wixid','bankaccount','email','permission_json','salary','status','client_id','client_wixid','created_at','updated_at','account'],
  supplierdetail: ['id','wix_id','status','msg','title','contact_id','created_at','updated_at','bankdetail_wixid','bankdetail_id','bankaccount','email','billercode','client_wixid','client_id','bankholder','account','utility_type','productid'],
  tenancy: ['id','wix_id','tenant_id','tenant_wixid','room_id','room_wixid','begin','end','rental','signagreement','agreement','checkbox','submitby_id','submitby_wixid','sign','status','billsurl','billsid','title','created_at','updated_at','password','passwordid','availabledate','remark','payment','client_wixid','client_id','deposit','parkinglot_json','addons_json','billing_json','commission_snapshot_json','billing_generated','tenancy_status_json','remark_json'],
  bills: ['id','wix_id','description','billtype_id','property_id','period','created_at','updated_at','property_wixid','billtype_wixid','billurl','billname','client_wixid','client_id','paid','paidat','paymentmethod','supplierdetail_id'],
  metertransaction: ['id','wix_id','tenant_id','tenancy_id','property_id','meter','meteridx','invoiceid','referenceid','bukku_invoice_id','amount','ispaid','failreason','status','invoiceurl','receipturl','created_at','updated_at'],
  agreement: ['id','wix_id','client_id','client_wixid','created_at','updated_at','mode','property_id','tenancy_id','url','status','pdf_generating','sign1','sign2','tenantsign','operatorsign','owner_id','agreementtemplate_id','ownersign','owner_signed_at','pdfurl','hash_draft','hash_final','version','columns_locked','operator_signed_ip','tenant_signed_ip','owner_signed_ip'],
  creditplan: ['id','wix_id','credit','sellingprice','title','created_at','updated_at','client_wixid','client_id'],
  cnyiottokens: ['id','wix_id','client_id','client_wixid','apikey','loginid','created_at','updated_at'],
  parkinglot: ['id','wix_id','client_id','client_wixid','property_id','parkinglot','created_at','updated_at','available'],
  pricingplan: ['id','wix_id','description','features_json','corecredit','sellingprice','addon_json','title','created_at','updated_at'],
  pricingplanaddon: ['id','wix_id','description_json','credit_json','qty','title','created_at','updated_at'],
  pricingplanlogs: ['id','wix_id','client_id','client_wixid','staff_id','staff_wixid','plan_id','plan_wixid','scenario','redirecturl','txid','paidat','payload_json','newexpireddate','payexreference','amount','addondeductamount','amountcents','status','title','addons_json','referencenumber','created_at','updated_at'],
  refunddeposit: ['id','wix_id','fallback','amount','roomtitle','tenantname','created_at','updated_at','done','room_id','tenant_id','client_id'],
  ttlocktoken: ['id','wix_id','client_id','client_wixid','expiresin','refreshtoken','accesstoken','created_at','updated_at'],
  syncstatus: ['id','wix_id','fail','updatedat','success','skip','total','status','createdat','done','message','type','created_at','updated_at'],
  stripepayout: ['id','client_id','stripe_payout_id','amount','currency','status','created_at','updated_at','estimated_fund_receive_date'],
  creditlogs: ['id','title','amount','reference_number','payment','client_id','creditplan_id','staff_id','type','sourplan_id','is_paid','txnid','payload','paiddate','remark','pricingplanlog_id','currency','created_at','updated_at','stripe_fee_amount','stripe_fee_percent','platform_markup_amount','tenant_name','charge_type'],
  faq: ['id','title','docs','created_at','updated_at'],
  ticket: ['id','mode','description','video','photo','client_id','email','ticketid','created_at','updated_at','source','page','action_clicked','function_name','api_path','api_method'],
  feedback: ['id','tenancy_id','room_id','property_id','client_id','tenant_id','description','photo','video','created_at','updated_at','done','remark'],
  owner_client: ['id','owner_id','client_id','created_at','updated_at'],
  tenant_client: ['id','tenant_id','client_id','created_at','updated_at'],
  owner_property: ['id','owner_id','property_id','created_at','updated_at'],
  account_client: ['id','account_id','client_id','created_at','updated_at'],
};

// Columns that are too generic (appear as common words). We skip reporting them as "unused" even if 0 hits.
const SKIP_COLUMNS = new Set(['id', 'key', 'type', 'mode', 'status', 'title', 'sign', 'end', 'message', 'description', 'payment', 'date', 'slot', 'values_json', 'addon_json', 'remark', 'profile', 'account', 'credit']);

function grepCount(columnName, dir) {
  if (!fs.existsSync(dir)) return 0;
  try {
    const pattern = columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const out = execSync(
      `grep -rlw "${pattern}" "${dir}" --include="*.js" 2>/dev/null | grep -v find-unused-db-columns || true`,
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
    );
    const lines = out.trim().split('\n').filter(Boolean);
    return lines.length;
  } catch (e) {
    return 0;
  }
}

function main() {
  const unused = [];
  const tables = Object.keys(SCHEMA).sort();
  for (const table of tables) {
    const columns = [...new Set(SCHEMA[table])];
    for (const col of columns) {
      if (SKIP_COLUMNS.has(col)) continue;
      const inSrc = grepCount(col, SRC);
      const inScripts = grepCount(col, SCRIPTS);
      if (inSrc === 0 && inScripts === 0) {
        unused.push({ table, column: col });
      }
    }
  }
  console.log('# Unused DB columns (no reference in src/**/*.js or scripts/**/*.js)\n');
  console.log('table\tcolumn');
  for (const { table, column } of unused) {
    console.log(`${table}\t${column}`);
  }
  console.log(`\n# Total: ${unused.length} columns`);
}

main();
