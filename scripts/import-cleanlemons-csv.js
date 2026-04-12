/**
 * Import Wix-export CSVs into cln_* tables (run after 0176_cleanlemons_core.sql).
 *
 *   node scripts/import-cleanlemons-csv.js
 *   CLEANLEMON_CSV_DIR=/path/to/csv node scripts/import-cleanlemons-csv.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const pool = require('../src/config/db');

const DEFAULT_CSV_DIR = path.join(__dirname, '..', 'cleanlemon', 'next-app');
const CSV_DIR = process.env.CLEANLEMON_CSV_DIR
  ? path.resolve(process.env.CLEANLEMON_CSV_DIR)
  : DEFAULT_CSV_DIR;

const FILES = {
  client: 'clientdetail (1).csv', // Wix export filename (imports into cln_operatordetail / cln_operator)
  property: 'Propertydetail (6).csv',
  schedule: 'Schedule (6).csv',
  attendance: 'Attendance (1).csv',
  feedback: 'Feedback.csv',
  damage: 'Damage (2).csv',
  linens: 'linens.csv',
  kpi: 'KPIDeduction (1).csv',
  invoice: 'ClientInvoice.csv',
  payment: 'ClientPayment.csv'
};

function readCsv(name) {
  const fp = path.join(CSV_DIR, name);
  if (!fs.existsSync(fp)) {
    console.warn('[cleanlemon-import] skip missing file:', fp);
    return [];
  }
  const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '');
  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true
  });
}

function emptyToNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function toMysqlDatetime3(iso) {
  const s = emptyToNull(iso);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const x = d.toISOString();
  return `${x.slice(0, 10)} ${x.slice(11, 23)}`;
}

function toDateOnly(iso) {
  const s = emptyToNull(iso);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseBool(v) {
  const s = emptyToNull(v);
  if (s == null) return null;
  const l = s.toLowerCase();
  if (l === 'true' || l === '1' || l === 'yes') return 1;
  if (l === 'false' || l === '0' || l === 'no') return 0;
  return null;
}

function parseIntSafe(v) {
  const s = emptyToNull(v);
  if (s == null) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function parseDecimal(v) {
  const s = emptyToNull(v);
  if (s == null) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

async function resolveClnCompanyTable(conn) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('cln_operatordetail', 'cln_operator', 'cln_client')
     ORDER BY CASE TABLE_NAME WHEN 'cln_operatordetail' THEN 0 WHEN 'cln_operator' THEN 1 WHEN 'cln_client' THEN 2 END
     LIMIT 1`
  );
  const t = rows?.[0]?.t;
  if (t === 'cln_client') return 'cln_client';
  if (t === 'cln_operator') return 'cln_operator';
  return t === 'cln_operatordetail' ? 'cln_operatordetail' : 'cln_operator';
}

async function upsertBatch(table, columnNames, rowObjects, batchSize = 150) {
  if (!rowObjects.length) {
    console.log(`[cleanlemon-import] ${table}: 0 rows`);
    return;
  }
  const valueRows = rowObjects.map((o) => columnNames.map((c) => o[c] ?? null));
  const cols = columnNames.map((c) => `\`${c}\``).join(',');
  const ph = `(${columnNames.map(() => '?').join(',')})`;
  const updateCols = columnNames.filter((c) => c !== 'id');
  const onDup = updateCols.map((c) => `\`${c}\`=VALUES(\`${c}\`)`).join(',');
  for (let i = 0; i < valueRows.length; i += batchSize) {
    const chunk = valueRows.slice(i, i + batchSize);
    const flat = chunk.flat();
    const multi = chunk.map(() => ph).join(',');
    const sql = `INSERT INTO \`${table}\` (${cols}) VALUES ${multi} ON DUPLICATE KEY UPDATE ${onDup}`;
    await pool.query(sql, flat);
  }
  console.log(`[cleanlemon-import] ${table}: ${rowObjects.length} rows`);
}

async function main() {
  console.log('[cleanlemon-import] CSV_DIR=', CSV_DIR);
  const clnCompanyTable = await resolveClnCompanyTable(pool);

  const clientRows = readCsv(FILES.client).map((r) => ({
    id: emptyToNull(r.ID),
    email: emptyToNull(r.email),
    name: emptyToNull(r.name),
    phone: emptyToNull(r.phone),
    address: emptyToNull(r.address),
    bukku_contact_id: emptyToNull(r.bukkuContactId),
    pic: emptyToNull(r.PIC),
    wix_owner_id: emptyToNull(r.Owner),
    created_at: toMysqlDatetime3(r['Created Date']),
    updated_at: toMysqlDatetime3(r['Updated Date'])
  }));
  const clientIds = new Set(clientRows.map((x) => x.id).filter(Boolean));

  await upsertBatch(
    clnCompanyTable,
    ['id', 'email', 'name', 'phone', 'address', 'bukku_contact_id', 'pic', 'wix_owner_id', 'created_at', 'updated_at'],
    clientRows.filter((x) => x.id)
  );

  const propertyFileRows = readCsv(FILES.property);
  const propertyIds = new Set(propertyFileRows.map((r) => emptyToNull(r.ID)).filter(Boolean));

  const propertyRows = propertyFileRows.map((r) => {
    const ref = emptyToNull(r.reference);
    return {
      id: emptyToNull(r.ID),
      client_id: ref && clientIds.has(ref) ? ref : null,
      owner_wix_id: emptyToNull(r.Owner),
      property_name: emptyToNull(r['Property Name']),
      contact: emptyToNull(r.Contact),
      address: emptyToNull(r.Address),
      score: parseIntSafe(r.Score),
      min_value: parseIntSafe(r.min),
      team: emptyToNull(r.Team),
      client_label: emptyToNull(r.Client),
      unit_name: emptyToNull(r.Unitname),
      mailbox_password: emptyToNull(r['Mailbox Password']),
      bed_count: parseIntSafe(r.bedCount),
      room_count: parseIntSafe(r.roomCount),
      bathroom_count: parseIntSafe(r.bathroomCount),
      kitchen: parseIntSafe(r.kitchen),
      living_room: parseIntSafe(r.livingRoom),
      balcony: parseIntSafe(r.balcony),
      staircase: parseIntSafe(r.staircase),
      lift_level: emptyToNull(r.liftLevel),
      special_area_count: parseIntSafe(r.specialAreaCount),
      cleaning_fees: parseDecimal(r['Cleaning fees']),
      source_id: emptyToNull(r.sourceId),
      is_from_a: parseBool(r.Isfroma),
      cc_json: emptyToNull(r.cc),
      warmcleaning: parseDecimal(r.warmcleaning),
      deepcleaning: parseDecimal(r.deepcleaning),
      generalcleaning: parseDecimal(r.generalcleaning),
      renovationcleaning: parseDecimal(r.renovationcleaning),
      coliving_source_id: emptyToNull(r.Colivingsourceid),
      created_at: toMysqlDatetime3(r['Created Date']),
      updated_at: toMysqlDatetime3(r['Updated Date'])
    };
  });

  await upsertBatch(
    'cln_property',
    [
      'id',
      'client_id',
      'owner_wix_id',
      'property_name',
      'contact',
      'address',
      'score',
      'min_value',
      'team',
      'client_label',
      'unit_name',
      'mailbox_password',
      'bed_count',
      'room_count',
      'bathroom_count',
      'kitchen',
      'living_room',
      'balcony',
      'staircase',
      'lift_level',
      'special_area_count',
      'cleaning_fees',
      'source_id',
      'is_from_a',
      'cc_json',
      'warmcleaning',
      'deepcleaning',
      'generalcleaning',
      'renovationcleaning',
      'coliving_source_id',
      'created_at',
      'updated_at'
    ],
    propertyRows.filter((x) => x.id)
  );

  const scheduleRows = readCsv(FILES.schedule).map((r) => {
    const pid = emptyToNull(r.property);
    return {
      id: emptyToNull(r.ID),
      wix_item_url: emptyToNull(r['Schedule (Item)']),
      owner_wix_id: emptyToNull(r.Owner),
      working_day: toMysqlDatetime3(r['Working Day']),
      date_display: emptyToNull(r.Date),
      status: emptyToNull(r.status),
      cleaning_type: emptyToNull(r.cleaningtype),
      submit_by: emptyToNull(r.submitby),
      staff_start_email: emptyToNull(r.staffnamestart),
      start_time: toMysqlDatetime3(r.starttime),
      staff_end_email: emptyToNull(r.staffnameend),
      end_time: toMysqlDatetime3(r.staffendtime),
      finalphoto_json: emptyToNull(r.finalphoto),
      delay: parseIntSafe(r.delay),
      on_change_by: emptyToNull(r.onchangeby),
      property_id: pid && propertyIds.has(pid) ? pid : null,
      team: emptyToNull(r.team),
      point: parseIntSafe(r.Point),
      on_change_time: toMysqlDatetime3(r.onchangeTime),
      price: parseDecimal(r.price),
      btob: parseBool(r.Btob),
      reservation_id: emptyToNull(r.reservationId),
      invoiced: parseBool(r.invoiced),
      invoice_date: toMysqlDatetime3(r.Invoicedate),
      updated_time_wix: toMysqlDatetime3(r.Updatedtime),
      created_at: toMysqlDatetime3(r['Created Date']),
      updated_at: toMysqlDatetime3(r['Updated Date'])
    };
  });

  await upsertBatch(
    'cln_schedule',
    [
      'id',
      'wix_item_url',
      'owner_wix_id',
      'working_day',
      'date_display',
      'status',
      'cleaning_type',
      'submit_by',
      'staff_start_email',
      'start_time',
      'staff_end_email',
      'end_time',
      'finalphoto_json',
      'delay',
      'on_change_by',
      'property_id',
      'team',
      'point',
      'on_change_time',
      'price',
      'btob',
      'reservation_id',
      'invoiced',
      'invoice_date',
      'updated_time_wix',
      'created_at',
      'updated_at'
    ],
    scheduleRows.filter((x) => x.id)
  );

  const attendanceRows = readCsv(FILES.attendance).map((r) => ({
    id: emptyToNull(r.ID),
    created_at_wix: toMysqlDatetime3(r['Created Date']),
    staff_id: emptyToNull(r['staff name']),
    check_out_time: toMysqlDatetime3(r.checkOutTime),
    in_or_out: emptyToNull(r['In or out']),
    overtime: emptyToNull(r.Overtime),
    check_in_selfie: emptyToNull(r.checkInSelfie),
    check_out_selfie: emptyToNull(r.checkOutSelfie),
    check_in_location: emptyToNull(r.checkInLocation),
    check_out_location: emptyToNull(r.checkOutLocation),
    wix_owner_id: emptyToNull(r.Owner),
    updated_at_wix: toMysqlDatetime3(r['Updated Date'])
  }));

  await upsertBatch(
    'cln_attendance',
    [
      'id',
      'created_at_wix',
      'staff_id',
      'check_out_time',
      'in_or_out',
      'overtime',
      'check_in_selfie',
      'check_out_selfie',
      'check_in_location',
      'check_out_location',
      'wix_owner_id',
      'updated_at_wix'
    ],
    attendanceRows.filter((x) => x.id)
  );

  const feedbackRows = readCsv(FILES.feedback).map((r) => ({
    id: emptyToNull(r.ID),
    title: emptyToNull(r.Title),
    wix_item_url: emptyToNull(r['Feedback (Item)']),
    prove_json: emptyToNull(r.Prove),
    submit_by: null,
    wix_owner_id: emptyToNull(r.Owner),
    created_at: toMysqlDatetime3(r['Created Date']),
    updated_at: toMysqlDatetime3(r['Updated Date'])
  }));

  await upsertBatch(
    'cln_feedback',
    ['id', 'title', 'wix_item_url', 'prove_json', 'submit_by', 'wix_owner_id', 'created_at', 'updated_at'],
    feedbackRows.filter((x) => x.id)
  );

  const damageRows = readCsv(FILES.damage).map((r) => {
    const pid = emptyToNull(r.unitName);
    return {
      id: emptyToNull(r.ID),
      wix_item_url: emptyToNull(r['Damage (Item) (Client)']),
      damage_photo_json: emptyToNull(r['Damage Photo']),
      remark: emptyToNull(r.Remark),
      property_id: pid && propertyIds.has(pid) ? pid : null,
      staff_id: emptyToNull(r['Staff Name']),
      wix_owner_id: emptyToNull(r.Owner),
      created_at: toMysqlDatetime3(r['Created Date']),
      updated_at: toMysqlDatetime3(r['Updated Date'])
    };
  });

  await upsertBatch(
    'cln_damage',
    [
      'id',
      'wix_item_url',
      'damage_photo_json',
      'remark',
      'property_id',
      'staff_id',
      'wix_owner_id',
      'created_at',
      'updated_at'
    ],
    damageRows.filter((x) => x.id)
  );

  const linensRows = readCsv(FILES.linens).map((r) => ({
    id: emptyToNull(r.ID),
    wix_owner_id: emptyToNull(r.Owner),
    bedsheet: parseIntSafe(r.Bedsheet),
    check_flag: parseBool(r.Check),
    linen_date: toMysqlDatetime3(r.Date),
    futon: parseIntSafe(r.Futon),
    team: emptyToNull(r.Team),
    towel: parseIntSafe(r.Towel),
    bathmat: parseIntSafe(r.Bathmat),
    user_email: emptyToNull(r.User),
    created_at: toMysqlDatetime3(r['Created Date']),
    updated_at: toMysqlDatetime3(r['Updated Date'])
  }));

  await upsertBatch(
    'cln_linens',
    [
      'id',
      'wix_owner_id',
      'bedsheet',
      'check_flag',
      'linen_date',
      'futon',
      'team',
      'towel',
      'bathmat',
      'user_email',
      'created_at',
      'updated_at'
    ],
    linensRows.filter((x) => x.id)
  );

  const kpiRows = readCsv(FILES.kpi).map((r) => ({
    id: emptyToNull(r.ID),
    wix_owner_id: emptyToNull(r.Owner),
    staff_email: emptyToNull(r.staffEmail),
    event_date: toMysqlDatetime3(r.date),
    point: parseIntSafe(r.point),
    reason: emptyToNull(r.reason),
    added_by: emptyToNull(r.addedBy),
    salary: parseDecimal(r.salary),
    reference_id: emptyToNull(r.Reference),
    team: emptyToNull(r.Team),
    created_at: toMysqlDatetime3(r['Created Date']),
    updated_at: toMysqlDatetime3(r['Updated Date'])
  }));

  await upsertBatch(
    'cln_kpi_deduction',
    [
      'id',
      'wix_owner_id',
      'staff_email',
      'event_date',
      'point',
      'reason',
      'added_by',
      'salary',
      'reference_id',
      'team',
      'created_at',
      'updated_at'
    ],
    kpiRows.filter((x) => x.id)
  );

  const invoiceRows = readCsv(FILES.invoice).map((r) => {
    const cid = emptyToNull(r.clientName);
    return {
      id: emptyToNull(r.ID),
      invoice_number: emptyToNull(r.invoiceNumber),
      client_id: cid && clientIds.has(cid) ? cid : null,
      description: emptyToNull(r.description),
      amount: parseDecimal(r.amount),
      pdf_url: emptyToNull(r.pdf),
      transaction_id: emptyToNull(r.Transactionid),
      payment_received: parseBool(r.Paymentreceived),
      balance_amount: parseDecimal(r.Balanceamount),
      wix_owner_id: emptyToNull(r.Owner),
      created_at: toMysqlDatetime3(r['Created Date']),
      updated_at: toMysqlDatetime3(r['Updated Date'])
    };
  });

  const invoiceIds = new Set(invoiceRows.map((x) => x.id).filter(Boolean));

  await upsertBatch(
    'cln_client_invoice',
    [
      'id',
      'invoice_number',
      'client_id',
      'description',
      'amount',
      'pdf_url',
      'transaction_id',
      'payment_received',
      'balance_amount',
      'wix_owner_id',
      'created_at',
      'updated_at'
    ],
    invoiceRows.filter((x) => x.id)
  );

  const paymentRows = readCsv(FILES.payment).map((r) => {
    const cid = emptyToNull(r.clientName);
    const inv = emptyToNull(r.Invoice);
    return {
      id: emptyToNull(r.ID),
      client_id: cid && clientIds.has(cid) ? cid : null,
      receipt_number: emptyToNull(r.receiptNumber),
      amount: parseDecimal(r.amount),
      payment_date: toDateOnly(r.paymentDate),
      receipt_url: emptyToNull(r.receipturl),
      transaction_id: emptyToNull(r.Transactionid),
      invoice_id: inv && invoiceIds.has(inv) ? inv : null,
      wix_owner_id: emptyToNull(r.Owner),
      created_at: toMysqlDatetime3(r['Created Date']),
      updated_at: toMysqlDatetime3(r['Updated Date'])
    };
  });

  await upsertBatch(
    'cln_client_payment',
    [
      'id',
      'client_id',
      'receipt_number',
      'amount',
      'payment_date',
      'receipt_url',
      'transaction_id',
      'invoice_id',
      'wix_owner_id',
      'created_at',
      'updated_at'
    ],
    paymentRows.filter((x) => x.id)
  );

  console.log('[cleanlemon-import] done');
  await pool.end();
}

main().catch((err) => {
  console.error('[cleanlemon-import] fatal', err);
  process.exit(1);
});
