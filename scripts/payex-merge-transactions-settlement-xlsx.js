#!/usr/bin/env node
/**
 * Merge Transaction (5)(6)(7).xlsx → Sheet1; Payex Settlement.csv → Sheet2; Bukku orphans → Sheet3.
 *
 * Date convention (Malaysia): treat as DD/MM/YYYY everywhere — Bukku `payex journal.csv` col A,
 * Payex `Payex Settlement.csv` col A (SettlementDate), and portal `Transaction *.xlsx` date strings / parts.
 * We normalize with zero-padding (e.g. 6/10/2025 → 06/10/2025) for joins; no US MM/DD reinterpretation.
 *
 * Sheet1: AO = Bukku no; MT_ meter IV uses ±1 calendar day vs Payex txn date + CustomerName≈Contact; if no name match but exactly one Meter IV on those dates with that amount, use it (portal name typo).
 *   RC- can match Agreement Fees IV (±1 day + ±1 month vs Payex date) + name + amount.
 * Sheet2: col AA = JE doc nos from payex journal for SettlementDate (normalized DD/MM/YYYY keys);
 *   yellow if BaseAmount matches merged txn BaseAmount (gross; MDR differs from Bukku Clear AR credit).
 * Sheet3: IV/OR lines with no portal match (多开); columns include BukkuNo (IV-xxx/OR-xxx).
 * OR lines included: Rental Payment, Ref: RC-*, or "Payment to IV-…". IV: Meter Topup + Agreement Fees (RC settlement).
 * OR match: exact Ref: RC-* + Amount; else same-day (±1) + CustomerName: minimal OR subset summing to Amount
 *   — first within each Bukku rcRef (null Ref lines share bucket __null__), then across all that payer’s OR that day (multi-invoice one Payex).
 *   Subset OR match: among all valid same-payer subsets (same RC bucket or Payex-day±1 mixed), prefer smallest max calendar gap vs Payex date — avoids matching February OR when April OR fits.
 *   Then single-line typo RC; then if portal RC never appears on any OR in GL: OR by same name+amount, Bukku date within 120d of Payex (nearest date).
 *   Portal pool sorted by amount desc.
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const { parse } = require("csv-parse/sync");

const WIX = path.join(__dirname, "../cleanlemon/next-app/Wix cms");
const OUT_XLSX = path.join(WIX, "Transaction_merged_and_Settlement.xlsx");

const TX_FILES = [
  "Transaction (5).xlsx",
  "Transaction (6).xlsx",
  "Transaction (7).xlsx",
];
const PAYEX_SETTLEMENT =
  process.env.PAYEX_SETTLEMENT_CSV || path.join(WIX, "Payex Settlement.csv");
const BUKKU_PAYEX_GL =
  process.env.BUKKU_PAYEX_GL_PATH || path.join(WIX, "payex journal.csv");

/** Fixed column order A–AM (39) + AN=_SourceFile + AO=IV_OR_No (41 cols) */
const TX_BODY_KEYS = [
  "Date",
  "Merchant",
  "Collection",
  "CollectionId",
  "Status",
  "CustomerName",
  "Email",
  "ContactNumber",
  "Currency",
  "BaseAmount",
  "Amount",
  "RefundAmount",
  "TransactionType",
  "FpxBuyerBankName",
  "FpxBuyerName",
  "CardHolderName",
  "CardNumber",
  "CardBrand",
  "TransactionId",
  "ReferenceNumber",
  "MandateReferenceNumber",
  "CollectionNumber",
  "CollectionReferenceNumber",
  "PaymentIntent",
  "ExternalTxnId",
  "Response",
  "AuthCode",
  "AuthNumber",
  "SettlementId",
  "SettlementDate",
  "Description",
  "SplitAmount",
  "SplitRule",
  "SplitType",
  "SplitDescription",
  "DeliveryAddress",
  "Postcode",
  "City",
  "State",
];

const SHEET1_HEADERS = [...TX_BODY_KEYS, "_SourceFile", "IV_OR_No"];

const YELLOW = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
const EPS = 0.005;
/** When Payex RC never appears on any OR line in GL, match OR by name+amount; pick Bukku date nearest to Payex within this gap (days). */
const MAX_OR_LOOSE_GAP_DAYS = 120;
const rcRe = /Ref:\s*(RC-[a-z0-9]+)/i;

function normalizePersonName(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[^A-Z0-9 ]/g, "")
    .trim();
}

/** Loose match for Payex CustomerName vs Bukku Contact (same payer, different spelling). */
function contactLikelySame(a, b) {
  const A = normalizePersonName(a);
  const B = normalizePersonName(b);
  if (!A || !B) return false;
  if (A === B) return true;
  const ta = A.split(" ").filter((t) => t.length >= 2);
  const tb = B.split(" ").filter((t) => t.length >= 2);
  if (!ta.length || !tb.length) return false;
  let common = 0;
  const sb = new Set(tb);
  for (const x of ta) if (sb.has(x)) common += 1;
  if (common >= 2) return true;
  if (common >= 1 && ta.length <= 2 && tb.length <= 2) return true;
  return false;
}

function num(v) {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

/** Max OR lines per subset search (same payer + day); 2^n brute force. */
const OR_SUBSET_BRUTE_MAX = 18;
/** Within one Bukku RC ref, OR lines may post on different days (e.g. 28/02 + 31/03); still one Payex RC payment. */
const OR_SUBSET_SAME_REF_MAX_GAP_DAYS = 75;

/** Smallest-cardinality subset of items (fixed order) whose debits sum to target; tie-break lower journal indices. */
function findMinimalDebitSubset(items, target, eps) {
  const n = items.length;
  if (n === 0 || n > OR_SUBSET_BRUTE_MAX) return null;
  /** @type {number[] | null} */
  let bestIdx = null;
  let bestLen = Infinity;
  for (let mask = 1; mask < 1 << n; mask++) {
    let s = 0;
    const idx = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        s += items[i].debit;
        idx.push(i);
      }
    }
    if (Math.abs(s - target) >= eps) continue;
    if (idx.length < bestLen || (idx.length === bestLen && bestIdx && lexLess(idx, bestIdx))) {
      bestLen = idx.length;
      bestIdx = idx;
    }
  }
  return bestIdx ? bestIdx.map((i) => items[i]) : null;
}

/** Worst calendar distance from Payex txn date among picked OR lines (subset quality vs payment date). */
function subsetMaxDateGapFromPayex(pick, payexTxnDate) {
  if (!pick || !pick.length || !payexTxnDate) return 9999;
  return Math.max(...pick.map((inv) => dmyDiffDays(inv.date, payexTxnDate)));
}

function subsetPickIsBetter(a, b, payexTxnDate) {
  if (!b) return true;
  if (!a) return false;
  const ga = subsetMaxDateGapFromPayex(a, payexTxnDate);
  const gb = subsetMaxDateGapFromPayex(b, payexTxnDate);
  if (ga !== gb) return ga < gb;
  if (a.length !== b.length) return a.length < b.length;
  const na = [...a.map((x) => x.no)].sort().join(",");
  const nb = [...b.map((x) => x.no)].sort().join(",");
  return na < nb;
}

function lexLess(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return a.length < b.length;
}

/**
 * @param {{ referenceNumber: string, amount: number, payexTxnDate: string, customerName: string }} t
 * @param {Array<{ kind: string, rcRef: string | null, debit: number | null, date: string, contact: string, no: string, used?: boolean }>} invoices
 * @param {{ requireUnused?: boolean }} opt
 */
function findOrMatchSubset(t, invoices, opt = {}) {
  const requireUnused = opt.requireUnused === true;
  if (!t.referenceNumber.startsWith("RC-") || !Number.isFinite(t.amount)) return null;
  const dateSet = new Set(mtSearchDates(t.payexTxnDate));
  const baseOr = (inv) =>
    (!requireUnused || !inv.used) &&
    inv.kind === "OR" &&
    inv.debit != null &&
    contactLikelySame(inv.contact, t.customerName);
  const poolWide = invoices.filter(
    (inv) =>
      baseOr(inv) && dmyDiffDays(inv.date, t.payexTxnDate) <= OR_SUBSET_SAME_REF_MAX_GAP_DAYS
  );
  if (!poolWide.length) return null;

  const byRef = new Map();
  for (const inv of poolWide) {
    const key = inv.rcRef == null || inv.rcRef === "" ? "__null__" : inv.rcRef;
    if (!byRef.has(key)) byRef.set(key, []);
    byRef.get(key).push(inv);
  }
  const refKeys = [...byRef.keys()].sort((a, b) => {
    const pa = a === t.referenceNumber ? 0 : 1;
    const pb = b === t.referenceNumber ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (a === "__null__") return 1;
    if (b === "__null__") return -1;
    return a.localeCompare(b);
  });

  /** @type {ReturnType<typeof findMinimalDebitSubset>} */
  let bestPick = null;
  const tryPick = (pick) => {
    if (pick && pick.length && subsetPickIsBetter(pick, bestPick, t.payexTxnDate)) bestPick = pick;
  };

  const poolNarrow = invoices.filter((inv) => baseOr(inv) && dateSet.has(inv.date));
  if (poolNarrow.length <= OR_SUBSET_BRUTE_MAX) {
    tryPick(findMinimalDebitSubset(poolNarrow, t.amount, EPS));
  }
  for (const k of refKeys) {
    const group = byRef.get(k);
    tryPick(findMinimalDebitSubset(group, t.amount, EPS));
  }
  return bestPick;
}

/** First matching Bukku IV/OR line (journal order); no consumption — duplicate portal rows get same no if criteria match. */
function findBukkuDocNoForDisplay(row, invoices, journalRcSet) {
  const status = String(row.Status || "").trim();
  const resp = String(row.Response || "").trim().toUpperCase();
  if (status !== "Sales" || (resp !== "SUCCESS" && resp !== "APPROVED")) return "";
  const ref = String(row.ReferenceNumber || "").trim();
  const amt = Number(row.Amount);
  if (!Number.isFinite(amt)) return "";
  const payexDate = txnDateToDMY(row.Date);
  if (ref.startsWith("RC-")) {
    for (const inv of invoices) {
      if (inv.kind !== "OR") continue;
      if (inv.rcRef !== ref) continue;
      if (inv.debit == null || Math.abs(inv.debit - amt) >= EPS) continue;
      return inv.no;
    }
    const cust = String(row.CustomerName || "").trim();
    const agIv = findAgreementIvMatch(invoices, {
      payexTxnDate: payexDate,
      amount: amt,
      customerName: cust,
      requireUnused: false,
    });
    if (agIv) return agIv.no;
    const tLike = { referenceNumber: ref, amount: amt, payexTxnDate: payexDate, customerName: cust };
    const subset = findOrMatchSubset(tLike, invoices, { requireUnused: false });
    if (subset && subset.length) return subset.map((i) => i.no).sort().join(", ");
    const dateSet = new Set(mtSearchDates(payexDate));
    for (const inv of invoices) {
      if (inv.kind !== "OR") continue;
      if (inv.debit == null || Math.abs(inv.debit - amt) >= EPS) continue;
      if (!dateSet.has(inv.date)) continue;
      if (!contactLikelySame(inv.contact, cust)) continue;
      if (inv.rcRef === ref) continue;
      return inv.no;
    }
    const loose = findOrLooseByNameAmountNearestDate(
      invoices,
      { referenceNumber: ref, amount: amt, payexTxnDate: payexDate, customerName: cust },
      journalRcSet,
      false
    );
    if (loose) return loose.no;
    return "";
  }
  if (ref.startsWith("MT_")) {
    const cust = String(row.CustomerName || "").trim();
    const dates = new Set(mtSearchDates(payexDate));
    for (const inv of invoices) {
      if (inv.kind !== "IV") continue;
      if (inv.ivFlavor === "agreement") continue;
      if (!dates.has(inv.date)) continue;
      if (inv.debit == null || Math.abs(inv.debit - amt) >= EPS) continue;
      if (!contactLikelySame(inv.contact, cust)) continue;
      return inv.no;
    }
    /** Single Meter IV on ±1 day with same amount (portal payer name wrong). */
    const meterSameAmt = invoices.filter(
      (inv) =>
        inv.kind === "IV" &&
        inv.ivFlavor !== "agreement" &&
        dates.has(inv.date) &&
        inv.debit != null &&
        Math.abs(inv.debit - amt) < EPS
    );
    if (meterSameAmt.length === 1) return meterSameAmt[0].no;
    return "";
  }
  return "";
}

function buildInvoiceRecords(bukkuLines) {
  /** @type {{ kind: string, date: string, no: string, contact: string, desc: string, debit: number | null, credit: number | null, rcRef: string | null }[]} */
  const invoices = [];
  for (const ln of bukkuLines) {
    const noU = ln.no.toUpperCase();
    if (noU.startsWith("OR-") && ln.debit != null && ln.debit > EPS) {
      const rental = /rental\s*payment/i.test(ln.desc);
      const paymentToIv = /payment\s+to\s+IV-/i.test(ln.desc);
      const m = ln.desc.match(rcRe);
      if (rental || paymentToIv || m) {
        invoices.push({
          kind: "OR",
          date: ln.date,
          no: ln.no,
          contact: ln.contact,
          desc: ln.desc,
          debit: ln.debit,
          credit: ln.credit,
          rcRef: m ? m[1] : null,
        });
      }
    }
    if (noU.startsWith("IV-") && ln.debit != null && ln.debit > EPS) {
      const meter = /meter\s*topup/i.test(ln.desc);
      const agreement = /agreement\s*fees/i.test(ln.desc);
      if (meter || agreement) {
        invoices.push({
          kind: "IV",
          date: ln.date,
          no: ln.no,
          contact: ln.contact,
          desc: ln.desc,
          debit: ln.debit,
          credit: ln.credit,
          rcRef: null,
          ivFlavor: agreement ? "agreement" : "meter",
        });
      }
    }
  }
  return invoices;
}

function parseBukkuGl(raw) {
  const rows = parse(raw, { relax_column_count: true, skip_empty_lines: false });
  const hdr = rows.findIndex((r) => r[0] === "Date" && (r[1] || "").trim() === "No.");
  if (hdr < 0) throw new Error("Bukku GL: header not found");
  const lines = [];
  const dateRe = /^\d{1,2}\/\d{1,2}\/\d{4}/;
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 7) continue;
    const dRaw = (r[0] || "").trim();
    if (!dateRe.test(dRaw)) continue;
    const d = normalizeDmyKey(dRaw);
    const no = (r[1] || "").trim();
    const desc = r[3] || "";
    const debit = parseRm(r[4]);
    const credit = parseRm(r[5]);
    lines.push({ date: d, no, contact: (r[2] || "").trim(), desc, debit, credit });
  }
  return lines;
}

function parseRm(s) {
  if (s == null || !String(s).trim()) return null;
  const t = String(s)
    .trim()
    .replace(/RM/gi, "")
    .replace(/,/g, "")
    .replace(/"/g, "")
    .trim();
  if (!t || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Payex CSV may use 6/10/2025; Bukku GL uses 06/10/2025 — one key for Map lookups and IV date match. */
function normalizeDmyKey(dateStr) {
  const s = String(dateStr || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return s;
  return `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`;
}

/** Portal xlsx: Date cell as string → DD/MM/YYYY from leading token; as Date → local calendar (expect MY export). */
function txnDateToDMY(dateVal) {
  if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
    const d = dateVal.getDate();
    const m = dateVal.getMonth() + 1;
    const y = dateVal.getFullYear();
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  }
  const s = String(dateVal || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`;
  }
  return "";
}

function dmyAddDays(dmy, deltaDays) {
  const [dd, mm, yy] = dmy.split("/").map((x) => parseInt(x, 10));
  if (!yy) return dmy;
  const dt = new Date(yy, mm - 1, dd);
  dt.setDate(dt.getDate() + deltaDays);
  const d = String(dt.getDate()).padStart(2, "0");
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const y = dt.getFullYear();
  return `${d}/${m}/${y}`;
}

function mtSearchDates(payexTxnDate) {
  if (!payexTxnDate || !/^\d{2}\/\d{2}\/\d{4}$/.test(payexTxnDate)) return [payexTxnDate].filter(Boolean);
  return [...new Set([payexTxnDate, dmyAddDays(payexTxnDate, 1), dmyAddDays(payexTxnDate, -1)])];
}

function dmyAddMonths(dmy, deltaM) {
  const [dd, mm, yy] = dmy.split("/").map((x) => parseInt(x, 10));
  if (!yy || Number.isNaN(mm) || Number.isNaN(dd)) return dmy;
  const dt = new Date(yy, mm - 1 + deltaM, dd);
  const d = String(dt.getDate()).padStart(2, "0");
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const y = dt.getFullYear();
  return `${d}/${m}/${y}`;
}

/** Payex RC vs Bukku Agreement IV: ±1 day + same calendar day ±1 month (e.g. 28/11 pay → 28/12 GL). */
function agreementSearchDates(payexTxnDate) {
  if (!payexTxnDate) return new Set();
  const s = new Set(mtSearchDates(payexTxnDate));
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(payexTxnDate)) {
    s.add(normalizeDmyKey(dmyAddMonths(payexTxnDate, 1)));
    s.add(normalizeDmyKey(dmyAddMonths(payexTxnDate, -1)));
  }
  return s;
}

function dmyDiffDays(a, b) {
  const pa = String(a || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const pb = String(b || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!pa || !pb) return 9999;
  const ta = Date.UTC(parseInt(pa[3], 10), parseInt(pa[2], 10) - 1, parseInt(pa[1], 10));
  const tb = Date.UTC(parseInt(pb[3], 10), parseInt(pb[2], 10) - 1, parseInt(pb[1], 10));
  return Math.abs(Math.round((ta - tb) / 86400000));
}

function buildJournalOrRcRefSet(records) {
  const s = new Set();
  for (const inv of records) {
    if (inv.kind === "OR" && inv.rcRef) s.add(inv.rcRef);
  }
  return s;
}

/**
 * Payex paid on one date, Bukku OR posted weeks later; RC often missing from GL line.
 * Only if no OR in journal carries this portal RC (Ref: in description).
 */
function findOrLooseByNameAmountNearestDate(invoices, ctx, journalRcSet, requireUnused) {
  const ref = String(ctx.referenceNumber || "").trim();
  if (!ref.startsWith("RC-") || !Number.isFinite(ctx.amount)) return null;
  if (journalRcSet.has(ref)) return null;
  const payex = ctx.payexTxnDate;
  if (!payex) return null;
  const cust = String(ctx.customerName || "").trim();
  const pool = invoices.filter(
    (inv) =>
      (!requireUnused || !inv.used) &&
      inv.kind === "OR" &&
      inv.debit != null &&
      Math.abs(inv.debit - ctx.amount) < EPS &&
      contactLikelySame(inv.contact, cust) &&
      dmyDiffDays(inv.date, payex) <= MAX_OR_LOOSE_GAP_DAYS
  );
  if (!pool.length) return null;
  pool.sort((a, b) => {
    const da = dmyDiffDays(a.date, payex);
    const db = dmyDiffDays(b.date, payex);
    if (da !== db) return da - db;
    return a.no.localeCompare(b.no, undefined, { numeric: true, sensitivity: "base" });
  });
  return pool[0];
}

/**
 * @param {Array<{ kind: string, ivFlavor?: string, debit: number | null, date: string, contact: string, no: string, used?: boolean }>} invoices
 */
function findAgreementIvMatch(invoices, { payexTxnDate, amount, customerName, requireUnused }) {
  const pool = invoices.filter(
    (inv) =>
      (!requireUnused || !inv.used) &&
      inv.kind === "IV" &&
      inv.ivFlavor === "agreement" &&
      inv.debit != null &&
      Math.abs(inv.debit - amount) < EPS &&
      contactLikelySame(inv.contact, customerName)
  );
  if (!pool.length) return null;
  const dateSet = agreementSearchDates(payexTxnDate);
  const inWin = pool.filter((inv) => dateSet.has(inv.date));
  if (inWin.length === 1) return inWin[0];
  if (inWin.length > 1) {
    return [...inWin].sort((a, b) => dmyDiffDays(a.date, payexTxnDate) - dmyDiffDays(b.date, payexTxnDate))[0];
  }
  const sorted = [...pool].sort((a, b) => dmyDiffDays(a.date, payexTxnDate) - dmyDiffDays(b.date, payexTxnDate));
  if (sorted.length && dmyDiffDays(sorted[0].date, payexTxnDate) <= 50) return sorted[0];
  return null;
}

function loadJeBySettlementDate(bukkuLines) {
  const acc = new Map();
  for (const ln of bukkuLines) {
    if (!ln.no.toUpperCase().startsWith("JE-")) continue;
    if (!/clear accounts receivable \(payex\)/i.test(ln.desc)) continue;
    if (ln.credit == null) continue;
    const d = normalizeDmyKey(ln.date);
    if (!acc.has(d)) acc.set(d, new Set());
    acc.get(d).add(ln.no);
  }
  const out = new Map();
  for (const [d, nos] of acc) {
    out.set(d, [...nos].sort().join(", "));
  }
  return out;
}

function loadMergedTransactionRows() {
  /** @type {Record<string, unknown>[]} */
  const all = [];
  for (const fn of TX_FILES) {
    const fp = path.join(WIX, fn);
    if (!fs.existsSync(fp)) continue;
    const wb = XLSX.readFile(fp, { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    for (const row of rows) {
      all.push({ ...row, _SourceFile: fn });
    }
  }
  return all;
}

/** Deduped portal txns for matching (Sales + success) */
function loadPortalMatchPool() {
  const byTid = new Map();
  for (const fn of TX_FILES) {
    const fp = path.join(WIX, fn);
    if (!fs.existsSync(fp)) continue;
    const wb = XLSX.readFile(fp, { cellDates: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    for (const row of rows) {
      const tid = String(row.TransactionId || "").trim();
      if (!tid || byTid.has(tid)) continue;
      const status = String(row.Status || "").trim();
      const resp = String(row.Response || "").trim().toUpperCase();
      if (status !== "Sales") continue;
      if (resp !== "SUCCESS" && resp !== "APPROVED") continue;
      byTid.set(tid, {
        transactionId: tid,
        payexTxnDate: txnDateToDMY(row.Date),
        referenceNumber: String(row.ReferenceNumber || "").trim(),
        amount: Number(row.Amount),
        customerName: String(row.CustomerName || "").trim(),
      });
    }
  }
  return [...byTid.values()];
}

function buildBukkuOrphansSheet(invoiceRecords, portalTxns, journalRcSet) {
  const invoices = invoiceRecords.map((inv) => ({ ...inv, used: false }));

  const portalSorted = [...portalTxns].sort((a, b) => {
    const da = Number.isFinite(a.amount) ? a.amount : 0;
    const db = Number.isFinite(b.amount) ? b.amount : 0;
    if (db !== da) return db - da;
    return String(a.transactionId || "").localeCompare(String(b.transactionId || ""));
  });

  for (const t of portalSorted) {
    if (!Number.isFinite(t.amount)) continue;
    if (t.referenceNumber.startsWith("RC-")) {
      const exact = invoices.filter(
        (inv) =>
          !inv.used &&
          inv.kind === "OR" &&
          inv.rcRef === t.referenceNumber &&
          inv.debit != null &&
          Math.abs(inv.debit - t.amount) < EPS
      );
      if (exact.length) {
        exact[0].used = true;
        continue;
      }
      const agIv = findAgreementIvMatch(invoices, {
        payexTxnDate: t.payexTxnDate,
        amount: t.amount,
        customerName: t.customerName,
        requireUnused: true,
      });
      if (agIv) {
        agIv.used = true;
        continue;
      }
      const subsetPick = findOrMatchSubset(t, invoices, { requireUnused: true });
      if (subsetPick && subsetPick.length) {
        for (const inv of subsetPick) inv.used = true;
        continue;
      }
      const dateSet = new Set(mtSearchDates(t.payexTxnDate));
      const fallback = invoices.filter(
        (inv) =>
          !inv.used &&
          inv.kind === "OR" &&
          inv.debit != null &&
          Math.abs(inv.debit - t.amount) < EPS &&
          dateSet.has(inv.date) &&
          contactLikelySame(inv.contact, t.customerName) &&
          inv.rcRef !== t.referenceNumber
      );
      if (fallback.length) {
        fallback[0].used = true;
        continue;
      }
      const looseOr = findOrLooseByNameAmountNearestDate(invoices, t, journalRcSet, true);
      if (looseOr) {
        looseOr.used = true;
        continue;
      }
    } else if (t.referenceNumber.startsWith("MT_")) {
      let picked = null;
      for (const d of mtSearchDates(t.payexTxnDate)) {
        const candidates = invoices.filter(
          (inv) =>
            !inv.used &&
            inv.kind === "IV" &&
            inv.ivFlavor !== "agreement" &&
            inv.date === d &&
            Math.abs((inv.debit || 0) - t.amount) < EPS &&
            contactLikelySame(inv.contact, t.customerName)
        );
        if (candidates.length) {
          picked = candidates[0];
          break;
        }
      }
      if (!picked) {
        const dates = mtSearchDates(t.payexTxnDate);
        const meterUnique = invoices.filter(
          (inv) =>
            !inv.used &&
            inv.kind === "IV" &&
            inv.ivFlavor !== "agreement" &&
            dates.includes(inv.date) &&
            inv.debit != null &&
            Math.abs(inv.debit - t.amount) < EPS
        );
        if (meterUnique.length === 1) picked = meterUnique[0];
      }
      if (picked) picked.used = true;
    }
  }

  return invoices
    .filter((inv) => !inv.used)
    .map((inv) => ({
      Date: inv.date,
      BukkuNo: inv.no,
      Kind: inv.kind,
      Contact: inv.contact,
      Description: inv.desc.replace(/\r?\n/g, " ").slice(0, 500),
      "Amount Debit": inv.debit ?? "",
      "Amount Credit": inv.credit ?? "",
    }));
}

function loadSettlementRows() {
  const raw = fs.readFileSync(PAYEX_SETTLEMENT, "utf8");
  return parse(raw, { columns: true, skip_empty_lines: true, bom: true });
}

function amountTallyWithMerged(mergedRows, tid, settlementBase) {
  const s = num(settlementBase);
  if (!tid || !Number.isFinite(s)) return false;
  for (const r of mergedRows) {
    if (String(r.TransactionId || "").trim() !== tid) continue;
    const b = num(r.BaseAmount);
    if (Number.isFinite(b) && Math.abs(b - s) < EPS) return true;
  }
  return false;
}

async function main() {
  const merged = loadMergedTransactionRows();
  const settlementRows = loadSettlementRows();
  const bukkuRaw = fs.readFileSync(BUKKU_PAYEX_GL, "utf8");
  const bukkuLines = parseBukkuGl(bukkuRaw);
  const jeByDate = loadJeBySettlementDate(bukkuLines);
  const portalPool = loadPortalMatchPool();
  const invoiceRecords = buildInvoiceRecords(bukkuLines);
  const journalOrRcSet = buildJournalOrRcRefSet(invoiceRecords);
  const sheet3Rows = buildBukkuOrphansSheet(invoiceRecords, portalPool, journalOrRcSet);

  const settledTids = new Set();
  for (const r of settlementRows) {
    const tid = String(r.TransactionId || "").trim();
    if (tid) settledTids.add(tid);
  }

  const setCols =
    settlementRows.length > 0 ? Object.keys(settlementRows[0]) : ["(empty)"];

  const wb = new ExcelJS.Workbook();
  wb.creator = "payex-merge-transactions-settlement-xlsx";

  // --- Sheet 1: Transactions (41 cols: … AN=_SourceFile, AO=IV_OR_No) ---
  const ws1 = wb.addWorksheet("Transactions", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws1.addRow(SHEET1_HEADERS);
  ws1.getRow(1).font = { bold: true };
  merged.forEach((r) => {
    const vals = TX_BODY_KEYS.map((k) => r[k] ?? "");
    vals.push(r._SourceFile ?? "");
    vals.push(findBukkuDocNoForDisplay(r, invoiceRecords, journalOrRcSet));
    ws1.addRow(vals);
  });
  for (let c = 1; c <= 41; c++) {
    ws1.getColumn(c).width = c === 41 ? 14 : 14;
  }
  for (let ri = 0; ri < merged.length; ri++) {
    const tid = String(merged[ri].TransactionId || "").trim();
    if (tid && settledTids.has(tid)) {
      const excelRow = ws1.getRow(ri + 2);
      excelRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = YELLOW;
      });
    }
  }

  // --- Sheet 2: Settlement (A–Z + AA=JE) ---
  const ws2 = wb.addWorksheet("Settlement", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const header2 = [...setCols, "JE"];
  ws2.addRow(header2);
  ws2.getRow(1).font = { bold: true };
  settlementRows.forEach((r) => {
    const sd = normalizeDmyKey(String(r.SettlementDate || "").trim());
    const je = jeByDate.get(sd) || "";
    ws2.addRow([...setCols.map((c) => r[c] ?? ""), je]);
  });
  for (let c = 1; c <= header2.length; c++) {
    ws2.getColumn(c).width = 14;
  }
  for (let ri = 0; ri < settlementRows.length; ri++) {
    const r = settlementRows[ri];
    const tid = String(r.TransactionId || "").trim();
    if (amountTallyWithMerged(merged, tid, r.BaseAmount)) {
      const excelRow = ws2.getRow(ri + 2);
      excelRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = YELLOW;
      });
    }
  }

  // --- Sheet 3: Bukku 多开（无 Payex 门户配对）---
  const ws3 = wb.addWorksheet("Bukku多开无Payex", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const s3h = ["Date", "BukkuNo", "Kind", "Contact", "Description", "Amount Debit", "Amount Credit"];
  ws3.addRow(s3h);
  ws3.getRow(1).font = { bold: true };
  sheet3Rows.forEach((r) => {
    ws3.addRow([
      r.Date,
      r.BukkuNo,
      r.Kind,
      r.Contact,
      r.Description,
      r["Amount Debit"],
      r["Amount Credit"],
    ]);
  });
  s3h.forEach((_, i) => {
    ws3.getColumn(i + 1).width = i === 4 ? 40 : i === 1 ? 14 : 16;
  });

  await wb.xlsx.writeFile(OUT_XLSX);
  console.log("Wrote:", OUT_XLSX);
  console.log("Bukku GL:", BUKKU_PAYEX_GL);
  console.log(
    "Transactions rows:",
    merged.length,
    "| Settlement rows:",
    settlementRows.length,
    "| Sheet3 orphans:",
    sheet3Rows.length
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
