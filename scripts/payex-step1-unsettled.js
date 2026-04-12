#!/usr/bin/env node
/**
 * Step 1: Tenant Transaction xlsx vs Payex Settlement.csv — list successful payments
 * whose TransactionId does not appear in the settlement export (not yet settled / export mismatch).
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { parse } = require("csv-parse/sync");

const WIX = path.join(__dirname, "../cleanlemon/next-app/Wix cms");
const OUT_CSV = path.join(WIX, "recon_step1_not_in_settlement.csv");

const TX_FILES = [
  "Transaction (5).xlsx",
  "Transaction (6).xlsx",
  "Transaction (7).xlsx",
];
const PAYEX_SETTLEMENT =
  process.env.PAYEX_SETTLEMENT_CSV || path.join(WIX, "Payex Settlement.csv");

function esc(s) {
  if (s == null) return "";
  const t = String(s);
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function loadSettlementTransactionIds() {
  const raw = fs.readFileSync(PAYEX_SETTLEMENT, "utf8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true, bom: true });
  const set = new Set();
  for (const r of rows) {
    const tid = String(r.TransactionId || "").trim();
    if (tid) set.add(tid);
  }
  return set;
}

function loadPortalTransactions() {
  /** @type {Map<string, Record<string, unknown>>} */
  const byTid = new Map();
  for (const fn of TX_FILES) {
    const fp = path.join(WIX, fn);
    if (!fs.existsSync(fp)) continue;
    const wb = XLSX.readFile(fp, { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
    for (const row of json) {
      const tid = String(row.TransactionId || "").trim();
      if (!tid) continue;
      const status = String(row.Status || "").trim();
      const resp = String(row.Response || "").trim().toUpperCase();
      if (status !== "Sales") continue;
      if (resp !== "SUCCESS" && resp !== "APPROVED") continue;
      if (byTid.has(tid)) continue;
      byTid.set(tid, {
        sourceFile: fn,
        date: row.Date,
        customerName: row.CustomerName,
        email: row.Email,
        baseAmount: row.BaseAmount,
        transactionId: tid,
        settlementId: String(row.SettlementId || "").trim(),
        settlementDate: String(row.SettlementDate || "").trim(),
      });
    }
  }
  return [...byTid.values()];
}

function remark(portalSid, portalSd) {
  let r =
    "TransactionId 未出现在 Payex Settlement.csv，可能尚未批次结算，或结算导出与交易导出日期范围不一致。";
  if (portalSid || portalSd) {
    r +=
      " 门户导出中已有 SettlementId/SettlementDate，但本 CSV 无此 TransactionId；请以结算 CSV 为准或更新导出。";
  }
  return r;
}

function main() {
  const settledTids = loadSettlementTransactionIds();
  const portal = loadPortalTransactions();
  const notSettled = portal.filter((p) => !settledTids.has(p.transactionId));

  const headers = [
    "SourceFile",
    "Date",
    "CustomerName",
    "Email",
    "BaseAmount",
    "TransactionId",
    "SettlementId_portal",
    "SettlementDate_portal",
    "Remark",
  ];
  const lines = [
    headers.join(","),
    ...notSettled.map((p) =>
      [
        esc(p.sourceFile),
        esc(p.date),
        esc(p.customerName),
        esc(p.email),
        esc(p.baseAmount),
        esc(p.transactionId),
        esc(p.settlementId),
        esc(p.settlementDate),
        esc(remark(p.settlementId, p.settlementDate)),
      ].join(",")
    ),
  ];
  fs.writeFileSync(OUT_CSV, lines.join("\n"), "utf8");

  console.log("Settlement CSV:", PAYEX_SETTLEMENT);
  console.log("Unique portal Sales+success txns:", portal.length);
  console.log("TransactionIds in Settlement.csv:", settledTids.size);
  console.log("Not in settlement file:", notSettled.length);
  console.log("Wrote:", OUT_CSV);
}

main();
