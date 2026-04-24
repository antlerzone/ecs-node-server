/**
 * One-off: why client portal invoice gate? clientdetail id + portal-like status.
 * Usage: node scripts/probe-cln-client-invoice-gate.js <cln_clientdetail.id>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const CID = String(process.argv[2] || '').trim();
if (!CID) {
  console.error('Usage: node scripts/probe-cln-client-invoice-gate.js <cln_clientdetail_id>');
  process.exit(1);
}

function getPolicy(settings) {
  const raw = settings && typeof settings === 'object' ? settings.invoicePaymentDuePolicy : undefined;
  if (raw == null || typeof raw !== 'object') return { mode: 'days', days: 14 };
  const mode = String(raw.mode || '').toLowerCase() === 'none' ? 'none' : 'days';
  let days = Math.floor(Number(raw.days));
  if (!Number.isFinite(days) || days < 1) days = 14;
  if (days > 365) days = 365;
  return mode === 'none' ? { mode: 'none', days: 14 } : { mode: 'days', days };
}

function utcYmdAddDays(issueYmd, days) {
  const s = String(issueYmd || '').slice(0, 10);
  const [y, mo, d] = s.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return s;
  const t = Date.UTC(y, mo - 1, d) + Number(days) * 864e5;
  return new Date(t).toISOString().slice(0, 10);
}

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const today = new Date().toISOString().slice(0, 10);

  const [[cd]] = await c.query('SELECT id, email, fullname FROM cln_clientdetail WHERE id = ? LIMIT 1', [CID]);
  console.log('clientdetail:', cd || 'NOT FOUND');

  const [[colOp]] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'cln_client_invoice' AND column_name = 'operator_id'`
  );
  const hasOperatorIdCol = Number(colOp?.n || 0) > 0;
  console.log('cln_client_invoice has operator_id column:', hasOperatorIdCol);

  const opSel = hasOperatorIdCol ? 'i.operator_id' : "CAST(NULL AS CHAR(36)) AS operator_id";
  const [invs2] = await c.query(
    `SELECT i.id, i.invoice_number, i.client_id, ${opSel},
     DATE_FORMAT(COALESCE(i.issue_date, DATE(i.created_at)), '%Y-%m-%d') AS issueYmd,
     DATE_FORMAT(i.due_date, '%Y-%m-%d') AS dueFromDb,
     COALESCE(i.payment_received,0) AS pr
     FROM cln_client_invoice i
     WHERE i.client_id = ?
     ORDER BY i.created_at DESC
     LIMIT 80`,
    [CID]
  );

  const [linkedOps] = await c.query(
    'SELECT operator_id AS id FROM cln_client_operator WHERE clientdetail_id = ?',
    [CID]
  );
  console.log('cln_client_operator links:', (linkedOps || []).length);

  console.log('invoice count (WHERE client_id = viewer):', invs2.length);
  const opSet = new Set();
  for (const row of invs2) {
    const oid = String(row.operator_id || '').trim();
    opSet.add(oid || '(EMPTY)');
  }
  console.log('operator_id distinct:', [...opSet]);

  const settingsMap = new Map();
  for (const oid of [...opSet].filter((x) => x && x !== '(EMPTY)')) {
    const [st] = await c.query('SELECT settings_json FROM cln_operator_settings WHERE operator_id = ? LIMIT 1', [
      oid,
    ]);
    let parsed = {};
    try {
      parsed = JSON.parse(st[0]?.settings_json || '{}') || {};
    } catch {
      parsed = {};
    }
    settingsMap.set(oid, parsed);
    console.log('operator', oid, 'invoicePaymentDuePolicy:', JSON.stringify(parsed.invoicePaymentDuePolicy));
  }

  let anyOverdue = false;
  for (const row of invs2) {
    const oid = String(row.operator_id || '').trim();
    const settings = oid && settingsMap.has(oid) ? settingsMap.get(oid) : {};
    const policy = getPolicy(settings);
    const storedDue = /^\d{4}-\d{2}-\d{2}$/.test(String(row.dueFromDb || '')) ? String(row.dueFromDb).slice(0, 10) : '';
    let dueYmd = null;
    if (storedDue) dueYmd = storedDue;
    else if (policy.mode === 'days' && row.issueYmd) dueYmd = utcYmdAddDays(row.issueYmd, policy.days);
    let status;
    if (Number(row.pr) === 1) status = 'paid';
    else if (policy.mode === 'none') status = 'pending';
    else status = dueYmd && dueYmd < today ? 'overdue' : 'pending';
    if (status === 'overdue') anyOverdue = true;
    if (status === 'overdue' || !oid) {
      console.log(
        'ROW',
        row.id,
        'op',
        oid || '(empty)',
        'policy',
        policy,
        'issue',
        row.issueYmd,
        'storedDue',
        storedDue || '-',
        'computedDue',
        dueYmd,
        '=>',
        status
      );
    }
  }
  console.log('today_utc_ymd:', today);
  console.log('anyOverdue (same rules as enrichInvoiceRowStatusAndDue, direct client_id only):', anyOverdue);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
