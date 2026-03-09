/**
 * Bank bulk transfer – migrated from Wix backend/access/bankbulktransfer.jsw.
 * Data from MySQL: bills, propertydetail, supplierdetail (bill type), bankdetail,
 * ownerpayout, ownerdetail, clientdetail / client_profile. bills 不关联 account；类型用 supplierdetail_id / billtype_wixid.
 */

const pool = require('../../config/db');

const MAX_ITEMS_PER_FILE = 99;

function sanitize(str) {
  return str ? String(str).replace(/[^a-zA-Z0-9 ]/g, '') : '';
}

function sanitizeLimited(str, maxLen = 20) {
  if (!str) return '';
  const clean = String(str).replace(/[^a-zA-Z0-9 ]/g, '');
  return clean.substring(0, maxLen);
}

/**
 * JomPay Excel Column B "Reference 1"（户号）— 一律从 table propertydetail 取：
 * - utility_type=water  → propertydetail.water
 * - utility_type=electric → propertydetail.electric
 * - utility_type=wifi    → propertydetail.wifi_id（无则 wifidetail）
 * 仅当 supplierdetail.utility_type 为 electric/water/wifi 时填值；否则视为普通 supplier，返回 ''。
 */
function getReference(bill, property, supplierTitle, supplierdetailId, propertyInternetTypeId, supplierUtilityType) {
  if (!property) return '';
  const type = (supplierUtilityType || '').toLowerCase();
  if (type !== 'electric' && type !== 'water' && type !== 'wifi') return '';

  if (type === 'electric') {
    const raw = property.electric != null ? property.electric : property.tnb;
    return raw != null ? toDecimal2(raw) : '';
  }
  if (type === 'water') {
    const raw = property.water != null ? property.water : property.saj;
    return raw != null ? toDecimal2(raw) : '';
  }
  if (type === 'wifi') {
    if (property.wifi_id != null && String(property.wifi_id).trim() !== '') return String(property.wifi_id);
    if (property.wifi != null && String(property.wifi).trim() !== '') return String(property.wifi);
    if (property.wifidetail != null && String(property.wifidetail).trim() !== '') return String(property.wifidetail);
    return '';
  }
  return '';
}

/** Format numeric value with 2 decimal places for display (electric/amount). */
function toDecimal2(val) {
  const n = parseFloat(val);
  if (Number.isNaN(n)) return val != null ? String(val) : '';
  return n.toFixed(2);
}

/**
 * Get bank bulk transfer data.
 * @param {Object} params - { clientId, bank?, type?, ids? }
 * @returns {Promise<{ banks } | { success, billerPayments, bulkTransfers, accountNumber } | { success: false }>}
 */
async function getBankBulkTransferData(params = {}) {
  if (!params.bank) {
    return {
      banks: [{ label: 'Public Bank', value: 'publicbank' }]
    };
  }

  const { bank, type, ids = [], clientId } = params;
  if (!ids.length || !type) {
    return { success: false };
  }
  if (ids.length > MAX_ITEMS_PER_FILE) {
    throw new Error(`Maximum ${MAX_ITEMS_PER_FILE} items per file`);
  }

  let payments = [];
  if (type === 'supplier') {
    payments = await buildSupplierPayments(ids, clientId);
  }
  if (type === 'owner') {
    payments = await buildOwnerPayments(ids, clientId);
  }

  if (!payments.length) {
    return { success: false };
  }

  return buildBankFile(bank, payments, clientId);
}

/**
 * Build supplier (utility bill) payments from bills.
 * Bills -> property, supplierdetail (bill type via supplierdetail_id / billtype_wixid). Payee from supplierdetail.
 */
async function buildSupplierPayments(ids, clientId) {
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT b.id, b.amount, b.description, b.supplierdetail_id, b.billtype_wixid, b.property_id, b.client_id,
            p.water, p.electric, p.wifidetail, p.wifi_id, p.unitnumber, p.internettype_id,
            s.title AS billtype_title, s.utility_type AS supplier_utility_type, s.billercode, s.bankdetail_id, s.bankholder, s.bankaccount, s.email
       FROM bills b
       LEFT JOIN propertydetail p ON p.id = b.property_id
       LEFT JOIN supplierdetail s ON (s.id = b.supplierdetail_id OR (b.supplierdetail_id IS NULL AND s.wix_id = b.billtype_wixid AND (b.client_id IS NULL OR s.client_id = b.client_id)))
       WHERE b.id IN (${placeholders}) AND (b.client_id = ? OR ? IS NULL)`,
    [...ids, clientId, clientId]
  );

  const payments = [];
  for (const bill of rows) {
    const property = bill.property_id ? {
      water: bill.water,
      electric: bill.electric,
      tnb: bill.electric,
      saj: bill.water,
      wifi: bill.wifidetail,
      wifidetail: bill.wifidetail,
      wifi_id: bill.wifi_id,
      unitnumber: bill.unitnumber,
      internettype_id: bill.internettype_id
    } : null;
    const unitNumber = bill.unitnumber;

    const supplierdetailId = bill.supplierdetail_id || null;
    const billtypeTitle = bill.billtype_title || '';
    let supplier = null;
    if (supplierdetailId || bill.billtype_wixid) {
      supplier = {
        title: billtypeTitle,
        billercode: bill.billercode || null,
        bankdetail_id: bill.bankdetail_id || null,
        bankholder: bill.bankholder || null,
        bankaccount: bill.bankaccount || null,
        email: bill.email || null,
        name: billtypeTitle || 'Supplier'
      };
    }
    if (!supplier) supplier = { title: billtypeTitle, name: billtypeTitle || 'Supplier' };

    const reference = getReference(
      bill,
      property,
      supplier.title,
      supplierdetailId,
      property?.internettype_id,
      bill.supplier_utility_type
    );

    const paymentType = supplier.billercode ? 'JOMPAY' : 'TRANSFER';
    payments.push({
      billId: bill.id,
      paymentType,
      amount: Number(bill.amount || 0),
      reference,
      description: bill.description || '',
      period: bill.period || null,
      unitNumber: unitNumber || '',
      supplierName: supplier.title || supplier.name || 'Supplier',
      utilityType: bill.supplier_utility_type || null,
      property: property ? { unitNumber: unitNumber } : null,
      supplier: {
        billerCode: supplier.billercode || '',
        bankName: supplier.bankdetail_id || null,
        bankHolder: supplier.bankholder || supplier.name || '',
        bankAccount: supplier.bankaccount || '',
        email: supplier.email || '',
        name: supplier.name || supplier.title || ''
      }
    });
  }
  return payments;
}

/**
 * Build owner payout payments. Owner from property.owner_id -> ownerdetail.
 */
async function buildOwnerPayments(ids, clientId) {
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT o.id, o.netpayout, o.period, o.property_id,
            p.unitnumber, p.owner_id,
            ow.ownername, ow.bankname_id, ow.bankaccount, ow.accountholder, ow.email
       FROM ownerpayout o
       LEFT JOIN propertydetail p ON p.id = o.property_id
       LEFT JOIN ownerdetail ow ON ow.id = p.owner_id
       WHERE o.id IN (${placeholders}) AND (o.client_id = ? OR ? IS NULL)`,
    [...ids, clientId, clientId]
  );

  const payments = [];
  for (const p of rows) {
    if (!p.ownername && !p.owner_id) continue;
    payments.push({
      ownerPayoutId: p.id,
      paymentType: 'TRANSFER',
      amount: Number(p.netpayout || 0),
      reference: p.ownername || '',
      description: 'Owner Payout',
      unitNumber: p.unitnumber || '',
      supplierName: p.ownername || '',
      supplier: {
        bankHolder: p.accountholder || p.ownername || '',
        bankAccount: p.bankaccount || '',
        email: p.email || '',
        name: p.ownername || '',
        bankName: p.bankname_id || null
      },
      property: p.property_id ? { unitNumber: p.unitnumber } : null,
      period: p.period
    });
  }
  return payments;
}

async function buildBankFile(bankId, payments, clientId) {
  switch (bankId) {
    case 'publicbank':
      return generatePublicBankFormat(payments, clientId);
    default:
      return generatePublicBankFormat(payments, clientId);
  }
}

async function generatePublicBankFormat(payments, clientId) {
  const billerPayments = [];
  const bulkTransfers = [];
  const skippedItems = [];

  const bankIds = [...new Set(
    payments
      .map(p => p.supplier?.bankName)
      .filter(Boolean)
  )];

  let bankMap = {};
  if (bankIds.length) {
    const placeholders = bankIds.map(() => '?').join(',');
    const [bankRows] = await pool.query(
      `SELECT id, swiftcode FROM bankdetail WHERE id IN (${placeholders})`,
      bankIds
    );
    bankRows.forEach(b => {
      bankMap[b.id] = { swiftcode: b.swiftcode || '' };
    });
  }

  for (const p of payments) {
    const supplier = p.supplier;
    if (!supplier) continue;

    const itemLabel = [p.unitNumber || p.billId || p.ownerPayoutId, p.supplierName, p.description].filter(Boolean).join(' / ') || 'Item';

    if (p.paymentType === 'JOMPAY') {
      if (!supplier.billerCode || String(supplier.billerCode).trim() === '') {
        skippedItems.push({ id: p.billId, label: itemLabel, reason: '缺少 Biller Code，无法加入 JomPay' });
        continue;
      }
      const ut = (p.utilityType || '').toLowerCase();
      if ((ut === 'electric' || ut === 'water' || ut === 'wifi') && (!p.reference || String(p.reference).trim() === '')) {
        const col = ut === 'electric' ? 'propertydetail.electric' : ut === 'water' ? 'propertydetail.water' : 'propertydetail.wifi_id';
        skippedItems.push({ id: p.billId, label: itemLabel, reason: `utility_type=${ut} 但 propertydetail 对应栏位为空（请填写 ${col}），未加入 JomPay` });
        continue;
      }
      billerPayments.push({
        billerCode: supplier.billerCode || '',
        reference1: sanitize(p.reference),
        reference2: '',
        amount: Number(parseFloat(p.amount).toFixed(2)),
        paymentDetails: sanitize(p.property?.unitNumber || '')
      });
      continue;
    }

    if (supplier.bankName) {
      const bank = bankMap[supplier.bankName] || {};
      let monthStr = '';
      if (p.period) {
        const malaysiaTime = new Date(new Date(p.period).getTime() + 8 * 60 * 60 * 1000);
        monthStr = malaysiaTime.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      }
      bulkTransfers.push({
        holderName: supplier.bankHolder || supplier.name || '',
        bankAccount: supplier.bankAccount || '',
        swiftCode: bank.swiftcode || '',
        amount: Number(parseFloat(p.amount).toFixed(2)),
        email: supplier.email || '',
        recipientReference: sanitizeLimited(String(p.property?.unitNumber || ''), 20),
        otherPaymentDetails: sanitizeLimited(String(p.description || ''), 20)
      });
    } else {
      skippedItems.push({ id: p.billId || p.ownerPayoutId, label: itemLabel, reason: '缺少银行资料（bankdetail），无法加入 Bulk Transfer' });
    }
  }

  let accountNumber = 'ACCOUNT';
  if (clientId) {
    const [profileRows] = await pool.query(
      'SELECT accountnumber FROM client_profile WHERE client_id = ? LIMIT 1',
      [clientId]
    );
    if (profileRows[0]?.accountnumber) {
      accountNumber = profileRows[0].accountnumber;
    } else {
      const [clientRows] = await pool.query(
        'SELECT profile FROM clientdetail WHERE id = ? LIMIT 1',
        [clientId]
      );
      const profile = clientRows[0]?.profile;
      let arr = null;
      if (typeof profile === 'string') {
        try {
          arr = JSON.parse(profile);
        } catch (_) {}
      } else if (Array.isArray(profile)) {
        arr = profile;
      }
      const first = Array.isArray(arr) && arr.length ? arr[0] : null;
      if (first?.accountNumber) accountNumber = first.accountNumber;
    }
  }

  return {
    success: true,
    billerPayments,
    bulkTransfers,
    accountNumber,
    skippedItems
  };
}

module.exports = {
  getBankBulkTransferData,
  MAX_ITEMS_PER_FILE
};
