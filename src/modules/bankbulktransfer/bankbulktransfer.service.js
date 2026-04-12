/**
 * Bank bulk transfer – migrated from Wix backend/access/bankbulktransfer.jsw.
 * Data from MySQL: bills, propertydetail, property_supplier_extra, supplierdetail (bill type), bankdetail,
 * ownerpayout, ownerdetail, operatordetail / client_profile. bills 不关联 account；类型用 supplierdetail_id.
 *
 * Expenses 下载 JomPay / Bulk Transfer 与 Property Setting Edit utility 的对应关系：
 * - 户号 (Reference 1 / account no)：优先从 property_supplier_extra(property_id, supplier_id) 取 value
 *   （即 Edit utility 里 Electric/Water/Wifi/Management + Add 填的 ID）；若无则从 propertydetail 的 electric/water/wifidetail 按 utility_type 取。
 * - 若 supplier 有 billercode（JomPay）→ 生成 PayBill Excel：Biller Code + Reference 1（户号）+ Amount。
 * - 若 supplier 无 billercode 但有 bank 资料（bankholder, bankaccount, bankdetail_id）→ 生成 Bulk Transfer Excel：Bene Account No.、Bene Full Name 等。
 * 故在 Contact setting 维护 supplier（JomPay 填 billercode，银行填 bank 资料），在 Property setting Edit utility 填各物业的户号/ID，下载的 CSV/Excel 即含完整资料。
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
 * For free-text fields like "Other Payment Details" we need to keep '-' so dates look like:
 * "date from 2026-01-01 to 2026-01-31".
 */
function sanitizePaymentDetails(str, maxLen = 60) {
  if (!str) return '';
  const clean = String(str).replace(/[^a-zA-Z0-9 \-]/g, '');
  return clean.substring(0, maxLen);
}

function formatMalaysiaYmdRangeFromPeriod(periodValue) {
  // ownerpayout.period is stored as a DB datetime; we treat it as "start" for the month range.
  // Output format: YYYY-MM-DD.
  const d = periodValue ? new Date(periodValue) : null;
  if (!d || Number.isNaN(d.getTime())) return { fromYmd: '', toYmd: '' };
  // Shift to Malaysia time (UTC+8) so Y-M-D matches the intended calendar date.
  const malaysia = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const y = malaysia.getUTCFullYear();
  const m = malaysia.getUTCMonth(); // 0-11
  const from = new Date(Date.UTC(y, m, malaysia.getUTCDate()));
  const to = new Date(Date.UTC(y, m + 1, 0)); // end of month
  return {
    fromYmd: from.toISOString().slice(0, 10),
    toYmd: to.toISOString().slice(0, 10),
  };
}

/**
 * JomPay Excel Column B "Reference 1"（户号）— 优先从 property_supplier_extra 取（Edit utility 填的 supplier + ID）；
 * 若无则从 propertydetail 取：utility_type=electric/water/wifi 对应 electric/water/wifidetail。
 */
function getReferenceFromExtra(propertyId, supplierdetailId, extraMap) {
  if (!propertyId || !supplierdetailId || !extraMap) return '';
  const v = extraMap.get(`${propertyId}|${supplierdetailId}`);
  return v != null && String(v).trim() !== '' ? String(v).trim() : '';
}

/**
 * Fallback: Reference from propertydetail columns (electric/water/wifidetail) by supplier utility_type.
 */
function getReferenceFromPropertyDetail(property, supplierUtilityType) {
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
  if (type === 'refund') {
    payments = await buildRefundPayments(ids, clientId);
  }

  if (!payments.length) {
    return { success: false };
  }

  return buildBankFile(bank, payments, clientId);
}

/**
 * Load property_supplier_extra for (property_id, supplier_id) pairs from bills.
 * Returns Map keyed by "propertyId|supplierId" -> value (reference/account no).
 */
async function loadPropertySupplierExtraMap(rows) {
  const pairs = [];
  const seen = new Set();
  for (const r of rows) {
    if (!r.property_id || !r.supplierdetail_id) continue;
    const key = `${r.property_id}|${r.supplierdetail_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push([r.property_id, r.supplierdetail_id]);
  }
  if (pairs.length === 0) return new Map();
  const placeholders = pairs.map(() => '(?,?)').join(',');
  const flat = pairs.flat();
  const [extraRows] = await pool.query(
    `SELECT property_id, supplier_id, value FROM property_supplier_extra WHERE (property_id, supplier_id) IN (${placeholders})`,
    flat
  );
  const map = new Map();
  for (const row of extraRows || []) {
    const k = `${row.property_id}|${row.supplier_id}`;
    const v = row.value != null ? String(row.value).trim() : '';
    if (v !== '') map.set(k, v);
  }
  return map;
}

/**
 * Build supplier (utility bill) payments from bills.
 * Reference 1: prefer property_supplier_extra (Edit utility); fallback propertydetail (electric/water/wifi).
 */
async function buildSupplierPayments(ids, clientId) {
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT b.id, b.amount, b.description, b.supplierdetail_id, b.property_id, b.client_id, b.period,
            p.water, p.electric, p.wifidetail, p.wifi_id, p.unitnumber, p.internettype_id,
            s.title AS billtype_title, s.utility_type AS supplier_utility_type, s.billercode, s.bankdetail_id, s.bankholder, s.bankaccount, s.email
       FROM bills b
       LEFT JOIN propertydetail p ON p.id = b.property_id
       LEFT JOIN supplierdetail s ON s.id = b.supplierdetail_id
       WHERE b.id IN (${placeholders}) AND (b.client_id = ? OR ? IS NULL)`,
    [...ids, clientId, clientId]
  );

  const extraMap = await loadPropertySupplierExtraMap(rows);

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
    if (supplierdetailId) {
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

    const referenceFromExtra = getReferenceFromExtra(bill.property_id, supplierdetailId, extraMap);
    const referenceFromProperty = getReferenceFromPropertyDetail(property, bill.supplier_utility_type);
    const reference = referenceFromExtra || referenceFromProperty;

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
 * Build refund deposit payments (tenant bank details from refunddeposit + tenantdetail + bankdetail).
 */
async function buildRefundPayments(ids, clientId) {
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT rd.id, rd.amount, rd.roomtitle, rd.tenantname,
            tn.fullname AS tenant_fullname, tn.bankaccount AS tenant_bankaccount, tn.accountholder AS tenant_accountholder, tn.bankname_id,
            b.bankname AS tenant_bankname
     FROM refunddeposit rd
     LEFT JOIN tenantdetail tn ON tn.id = rd.tenant_id
     LEFT JOIN bankdetail b ON b.id = tn.bankname_id
     WHERE rd.id IN (${placeholders}) AND rd.client_id = ?`,
    [...ids, clientId]
  );
  const payments = [];
  for (const r of rows) {
    payments.push({
      ownerPayoutId: r.id,
      paymentType: 'TRANSFER',
      amount: Number(r.amount || 0),
      reference: r.tenant_fullname || r.tenantname || '',
      description: 'Refund deposit',
      unitNumber: r.roomtitle || '',
      supplierName: r.tenant_fullname || r.tenantname || '',
      supplier: {
        bankHolder: r.tenant_accountholder || r.tenant_fullname || r.tenantname || '',
        bankAccount: r.tenant_bankaccount || '',
        email: '',
        name: r.tenant_fullname || r.tenantname || '',
        bankName: r.bankname_id || null
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
        skippedItems.push({ id: p.billId, label: itemLabel, reason: 'Missing Biller Code; cannot include in JomPay' });
        continue;
      }
      if (!p.reference || String(p.reference).trim() === '') {
        skippedItems.push({
          id: p.billId,
          label: itemLabel,
          reason: "Please fill this Property's account number/ID for the supplier in Edit utility; skipped from JomPay",
        });
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
        // For owner payout bulk transfer: Recipient Reference must be "OwnerPayout"
        recipientReference: p.ownerPayoutId ? 'OwnerPayout' : sanitizeLimited(String(p.property?.unitNumber || ''), 20),
        otherPaymentDetails: (() => {
          // For owner payout bulk transfer: Other Payment Details must be a date range.
          if (p.ownerPayoutId) {
            const { fromYmd, toYmd } = formatMalaysiaYmdRangeFromPeriod(p.period);
            return sanitizePaymentDetails(`date from ${fromYmd} to ${toYmd}`, 80);
          }
          return sanitizeLimited(String(p.description || ''), 20);
        })()
      });
    } else {
      skippedItems.push({
        id: p.billId || p.ownerPayoutId,
        label: itemLabel,
        reason: 'Missing bank details (bankdetail); cannot include in Bulk Transfer',
      });
    }
  }

  // NOTE:
  // - For owner payout downloads, the file name prefix should come from the OWNER bank account,
  //   not the operator/company profile account.
  // - For supplier/utility downloads, keep existing behavior using client_profile.accountnumber.
  let accountNumber = 'ACCOUNT';
  const ownerPayment = payments.find(p => p.ownerPayoutId || String(p.description || '').trim().toLowerCase() === 'owner payout');
  const ownerBankAccount = ownerPayment?.supplier?.bankAccount;
  if (ownerBankAccount && String(ownerBankAccount).trim() !== '') {
    accountNumber = String(ownerBankAccount).trim();
  } else if (clientId) {
    const [profileRows] = await pool.query(
      'SELECT accountnumber FROM client_profile WHERE client_id = ? LIMIT 1',
      [clientId]
    );
    if (profileRows[0]?.accountnumber) {
      accountNumber = profileRows[0].accountnumber;
    } else {
      const [clientRows] = await pool.query(
        'SELECT profile FROM operatordetail WHERE id = ? LIMIT 1',
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
