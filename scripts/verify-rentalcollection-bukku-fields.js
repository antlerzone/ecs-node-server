/**
 * 抽样核对 MySQL rentalcollection：bukku_invoice_id、bukku_payment_id、paidat、ispaid、receipturl。
 * 用于「仅 Bukku PUT 改日期」前置条件：至少要有 invoice id + paidat（payment id 可从发票反查）。
 *
 * 用法：
 *   node scripts/verify-rentalcollection-bukku-fields.js
 *   node scripts/verify-rentalcollection-bukku-fields.js id1 id2 ...
 *
 * 默认核对 docs/wix/velo-tenant-page-button1-missing-receipt-debug.js 中的 40 条 id（保持与之同步）。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const DEFAULT_RC_IDS = [
  'c90aec56-ddba-4de2-97ae-c7f273af8bb4',
  '5c635c7b-b26c-4f11-a2c7-b00b3d92af85',
  '01293e58-0953-47f5-81a8-89113c327423',
  '90636e32-51b1-4ae0-a6d5-9b7f74ba6885',
  '031204fe-bc01-4b4c-905a-26461a582730',
  'c4d4543a-afc0-40e5-9069-bb09143edd03',
  'c1e6c02f-7bde-41a4-89db-a3e75000759a',
  'ac2f3277-2552-4c1b-9ba5-2f14fa8c6952',
  '6a07ad5a-175f-49b5-a392-aa41721612bb',
  '34678f92-c9a4-420a-947d-14ed8720bb8d',
  'f07954ac-e9de-4133-b16f-1befb176b596',
  '4e60c88a-d43a-4a15-8b6b-e657064a5f79',
  'a5e88b51-a437-487d-a6c2-66ac21466178',
  '83933fbf-c65c-451e-bf74-a60421fdda9a',
  'a6aa7f15-d808-4e49-8215-cbac0f4bad5b',
  'e17618b2-efbd-4a54-ab89-57bc71106ad2',
  '2423f1b5-b588-44c6-b32a-08179d32bee8',
  'd588bc8a-6f20-4a6f-9f06-76658346f0fb',
  '69d3e070-3ed2-4ca1-a93d-a70887724dd3',
  'b0fc8898-a9a9-4e98-8b55-1cae899e13b1',
  '3735cc48-6204-4fb2-a43e-237fd5456401',
  'e550dd38-6ba9-4d37-a9b8-01600943a2d4',
  '1af01eb0-3937-41b8-82dd-4a73dc4fbd38',
  '9cbc82f5-8b5c-4fb2-b857-6dc82d26a72a',
  '0a20c213-61a9-4315-baa9-fbd166ee46c7',
  '7c39d303-6a46-4ee9-a2b0-d3c1ff760f5e',
  '92477902-1b6f-4bc9-90e3-dfa046114530',
  '7b5ebfca-8dc0-4a0e-a60d-40314ec05527',
  'ca046630-0c11-40b5-ad86-98cf9c2cc19f',
  '4a4c434a-9e0a-4459-a167-c5fd6dd034f1',
  'f90e2f15-a62c-48fe-a837-ae79a1d220f4',
  '7507b810-c366-4379-b820-f3bbffc59a7d',
  '9c813256-5954-40a1-880f-b062aa321b9e',
  'd7fcad1f-0b49-4b97-bb9f-68dcd70095ea',
  'bfcf3f1e-8de3-406d-aead-fafda8a6b59c',
  'e18f290a-8367-4ee3-9888-dc7202b6fb6b',
  '2ec96b77-ad4f-4f90-ad63-1a4e75f33e3b',
  'a095846e-3cbd-457d-a891-1418f11817f9',
  'b8601637-03c5-41da-9c30-27a91ce99a00',
  'af3d3668-c4f8-4264-85d1-16f2b951bf1e'
];

function emptyish(v) {
  return v == null || String(v).trim() === '';
}

async function main() {
  const ids = process.argv.slice(2).filter(Boolean);
  const idList = ids.length ? ids : DEFAULT_RC_IDS;

  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
    console.error('Missing DB_HOST / DB_USER / DB_NAME in .env — skip DB verify or set credentials.');
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  });

  try {
    const placeholders = idList.map(() => '?').join(',');
    const [rows] = await conn.query(
      `SELECT id,
              bukku_invoice_id,
              bukku_payment_id,
              paidat,
              ispaid,
              receipturl,
              amount
         FROM rentalcollection
        WHERE id IN (${placeholders})`,
      idList
    );

    const byId = new Map(rows.map((r) => [r.id, r]));
    let missingInvoice = 0;
    let missingPaidAt = 0;
    let missingRows = 0;

    console.log(`Checked ${idList.length} id(s), DB returned ${rows.length} row(s).\n`);

    for (const id of idList) {
      const r = byId.get(id);
      if (!r) {
        missingRows++;
        console.log(`MISS row   ${id}`);
        continue;
      }
      const invOk = !emptyish(r.bukku_invoice_id);
      const payOk = !emptyish(r.bukku_payment_id);
      const paidOk = !emptyish(r.paidat);
      if (!invOk) missingInvoice++;
      if (!paidOk) missingPaidAt++;

      const flags = [
        invOk ? 'inv' : 'NO_INV',
        payOk ? 'pay' : 'no_pay',
        paidOk ? 'paidat' : 'NO_PAIDAT',
        r.ispaid ? 'ispaid' : 'not_paid'
      ].join(' ');
      console.log(`${id}  ${flags}  bukku_inv=${r.bukku_invoice_id || '—'}  amt=${r.amount}`);
    }

    console.log('\n---');
    console.log(
      `Summary: missing row=${missingRows}, missing bukku_invoice_id=${missingInvoice}, missing paidat=${missingPaidAt}`
    );
    console.log(
      'Wix Velo updatePaymentDateFromRentalPaidAt needs bukku_invoice_id (or bukku_payment_id) + paidAt on CMS row; MySQL mirrors same fields if you sync from Wix.'
    );

    if (missingRows || missingInvoice || missingPaidAt) {
      process.exitCode = 2;
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
