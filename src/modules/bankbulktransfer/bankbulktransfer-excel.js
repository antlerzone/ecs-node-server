/**
 * Generate bank bulk transfer Excel files (same structure as htmlbank iframe).
 * PayBill = JOMPAY format; Bulk Transfer = PBB/IBG format.
 */

const XLSX = require('xlsx');
const archiver = require('archiver');
const { Writable } = require('stream');

function sanitizeExcelText(str, maxLen = 20) {
  if (!str) return '';
  // Keep spaces and '-' so fields like "date from 2026-01-01 to 2026-01-31" remain readable.
  const s = String(str).replace(/[^a-zA-Z0-9 \-]/g, '').trim();
  return s.substring(0, maxLen);
}

/**
 * @param {Array} rows - { billerCode, reference1, reference2, amount, paymentDetails }
 * @returns {Buffer}
 */
function generatePayBillExcel(rows) {
  const wb = XLSX.utils.book_new();
  const wsData = [];
  wsData.push([]);
  wsData.push(['Biller Code', 'Reference 1', 'Reference 2', 'Amount', 'Payment Details']);
  wsData.push([
    '(M) - Char: 8 - N',
    '(M) - Char: 20 - AN',
    '(O) - Char: 30 - AN',
    '(M) - Char: 18 - N',
    '(O) - Char: 140 - AN'
  ]);
  let totalAmount = 0;
  rows.forEach(row => {
    const amount = Number(parseFloat(row.amount || 0).toFixed(2));
    totalAmount += amount;
    wsData.push([
      row.billerCode || '',
      row.reference1 || '',
      '',
      amount,
      row.paymentDetails || ''
    ]);
  });
  wsData.push(['TOTAL:', '', '', Number(totalAmount.toFixed(2)), '']);
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, 'PayBill');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  return Buffer.from(wbout);
}

/**
 * @param {Array} rows - { swiftCode, bankAccount, holderName, amount, email, recipientReference?, otherPaymentDetails? }
 * @returns {Buffer}
 */
function generateBulkTransferExcel(rows) {
  const today = new Date();
  const dateStr =
    String(today.getDate()).padStart(2, '0') + '/' +
    String(today.getMonth() + 1).padStart(2, '0') + '/' +
    today.getFullYear();

  const wb = XLSX.utils.book_new();
  const wsData = [];
  wsData.push(['PAYMENT DATE :', "'" + dateStr, '']);
  wsData.push([
    'Payment Type/ Mode : PBB/IBG/REN',
    'Bene Account No.',
    'BIC',
    'Bene Full Name',
    'ID Type:\n\nFor Intrabank & IBG\nNI, OI, BR, PL, ML, PP\n\nFor Rentas\nNI, OI, BR, OT',
    'Bene Identification No / Passport',
    'Payment Amount (with 2 decimal points)',
    'Recipient Reference',
    'Other Payment Details',
    'Bene Email 1',
    'Bene Email 2',
    'Bene Mobile No. 1',
    'Bene Mobile No. 2',
    'Joint Bene Name',
    'Joint Beneficiary Identification No.',
    'Joint ID Type:\n\nFor Intrabank & IBG\nNI, OI, BR, PL, ML, PP\n\nFor Rentas\nNI, OI, BR, OT',
    'E-mail Content Line 1',
    'E-mail Content Line 2',
    'E-mail Content Line 3',
    'E-mail Content Line 4',
    'E-mail Content Line 5'
  ]);
  wsData.push([
    '(M) - Char: 3 - A',
    '(M) - Char: 20 - N',
    '(M) - Char: 11 - AN',
    '(M) - Char: 120 - AN',
    '(O) - Char: 2 - A',
    '(O) - Char: 29 - AN',
    '(M) - Char: 18 - N',
    '(M) - Char: 20 - AN',
    '(O) - Char: 20 - AN',
    '(O) - Char: 70 - AN',
    '(O) - Char: 70 - AN',
    '(O) - Char: 15 - N',
    '(O) - Char: 15 - N',
    '(O) - Char: 120 - A',
    '(O) - Char: 29 - AN',
    '(O) - Char: 2 - A',
    '(O) - Char: 40 - AN',
    '(O) - Char: 40 - AN',
    '(O) - Char: 40 - AN',
    '(O) - Char: 40 - AN',
    '(O) - Char: 40 - AN'
  ]);
  let totalAmount = 0;
  rows.forEach(row => {
    const amount = Number(parseFloat(row.amount || 0).toFixed(2));
    totalAmount += amount;
    wsData.push([
      row.swiftCode && String(row.swiftCode).toLowerCase() === 'pbbemykl' ? 'PBB' : 'IBG',
      String(row.bankAccount || ''),
      row.swiftCode || '',
      row.holderName || '',
      '',
      '',
      amount,
      sanitizeExcelText(row.recipientReference, 20),
      sanitizeExcelText(row.otherPaymentDetails, 20),
      row.email || '',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ]);
  });
  wsData.push([
    'TOTAL:', '', '', '', '', '', Number(totalAmount.toFixed(2)),
    '', '', '', '', '', '', '', '', '', '', '', '', '', ''
  ]);
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['B1'] = { t: 's', v: dateStr };
  ws['C1'] = {
    f: 'AND(ISNUMBER(DATE(MID(B1,7,4)*1,MID(B1,4,2)*1,MID(B1,1,2)*1)),DATE(MID(B1,7,4)*1,MID(B1,4,2)*1,MID(B1,1,2)*1)>=TODAY(),DATE(MID(B1,7,4)*1,MID(B1,4,2)*1,MID(B1,1,2)*1)<=TODAY()+59,MID(B1,3,1)="/",MID(B1,6,1)="/")'
  };
  XLSX.utils.book_append_sheet(wb, ws, 'Bulk Transfer');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  return Buffer.from(wbout);
}

/**
 * Build filenames and buffers for bank files.
 * @param {Object} data - { billerPayments, bulkTransfers, accountNumber, skippedItems? }
 * @param {number} fileIndex
 * @returns {Array<{ filename: string, buffer: Buffer }>}
 */
function buildBankFiles(data, fileIndex = 1) {
  const acc = data.accountNumber || '3240130500';
  const today = new Date();
  const dateStr =
    String(today.getDate()).padStart(2, '0') +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getFullYear()).slice(-2);
  const suffix = String(fileIndex).padStart(2, '0');
  const out = [];
  if (data.billerPayments && data.billerPayments.length) {
    out.push({
      filename: `${acc}JP${dateStr}${suffix}.xlsx`,
      buffer: generatePayBillExcel(data.billerPayments)
    });
  }
  if (data.bulkTransfers && data.bulkTransfers.length) {
    out.push({
      filename: `${acc}PM${dateStr}${suffix}.xlsx`,
      buffer: generateBulkTransferExcel(data.bulkTransfers)
    });
  }
  if (data.skippedItems && data.skippedItems.length > 0) {
    const lines = [
      'The following items were skipped from JomPay / Bulk Transfer due to incomplete supplier or property data. Please complete supplier or property details and retry.',
      '',
      'ID\t项目\t原因',
      ...data.skippedItems.map(s => `${s.id || ''}\t${(s.label || '').replace(/\t/g, ' ')}\t${s.reason || ''}`)
    ];
    out.push({
      filename: 'errors.txt',
      buffer: Buffer.from(lines.join('\n'), 'utf8')
    });
  }
  return out;
}

/**
 * Zip multiple { filename, buffer } into one buffer.
 * @param {Array<{ filename: string, buffer: Buffer }>} files
 * @returns {Promise<Buffer>}
 */
function zipBuffers(files) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const writable = new Writable({
      write(chunk, encoding, cb) {
        chunks.push(chunk);
        process.nextTick(cb);
      }
    });
    writable.on('finish', () => resolve(Buffer.concat(chunks)));
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    archive.pipe(writable);
    for (const f of files) {
      archive.append(f.buffer, { name: f.filename });
    }
    archive.finalize();
  });
}

/**
 * Generate refund bank file as CSV (Public Bank MY style: Beneficiary Name, Account No, BIC, Amount, Reference).
 * @param {Array} rows - { holderName, bankAccount, swiftCode, amount, recipientReference? }
 * @returns {Buffer}
 */
function generateRefundCsv(rows) {
  const header = 'Beneficiary Name,Account No,BIC,Amount,Reference';
  const escape = (v) => {
    const s = v != null ? String(v) : '';
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [header];
  for (const r of rows) {
    lines.push([
      escape(r.holderName),
      escape(r.bankAccount),
      escape(r.swiftCode),
      Number(parseFloat(r.amount || 0).toFixed(2)),
      escape(r.recipientReference || r.otherPaymentDetails || '')
    ].join(','));
  }
  return Buffer.from(lines.join('\n'), 'utf8');
}

module.exports = { generatePayBillExcel, generateBulkTransferExcel, buildBankFiles, zipBuffers, generateRefundCsv };
