#!/usr/bin/env node
/**
 * Payex / Bukku 五类对账 → recon_payex_bukku.xlsx（5 个 sheet）
 * 数据源：Transaction *.xlsx、Payex Settlement.csv、Bukku Payex 科目总账 CSV
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const { parse } = require("csv-parse/sync");

const WIX = path.join(__dirname, "../cleanlemon/next-app/Wix cms");
const OUT_XLSX = path.join(WIX, "recon_payex_bukku.xlsx");
const OLD_CSV = ["recon_1_payex_settlement_to_bank_vs_bukku.csv", "recon_2_tenant_payex_vs_bukku_gl.csv", "recon_3_payex_bukku_detail_remarks.csv"];

const TX_FILES = ["Transaction (5).xlsx", "Transaction (6).xlsx", "Transaction (7).xlsx"];
const PAYEX_SETTLEMENT = path.join(WIX, "Payex Settlement.csv");
const BUKKU_PAYEX_GL =
  process.env.BUKKU_PAYEX_GL_PATH || path.join(WIX, "payex journal.csv");

const EPS = 0.02;
const REMARK_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };

const rcRe = /Ref:\s*(RC-[a-z0-9]+)/i;

function parseBukkuGl(raw) {
  const rows = parse(raw, { relax_column_count: true, skip_empty_lines: false });
  const hdr = rows.findIndex((r) => r[0] === "Date" && (r[1] || "").trim() === "No.");
  if (hdr < 0) throw new Error("Bukku GL: header not found");
  const lines = [];
  const dateRe = /^\d{2}\/\d{2}\/\d{4}/;
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 7) continue;
    const d = (r[0] || "").trim();
    if (!dateRe.test(d)) continue;
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

/** Payex 交易日期顺序：先当日，再+1，再-1（用于 IV 配对） */
function mtSearchDates(payexTxnDate) {
  if (!payexTxnDate || !/^\d{2}\/\d{2}\/\d{4}$/.test(payexTxnDate)) return [payexTxnDate].filter(Boolean);
  const a = [payexTxnDate, dmyAddDays(payexTxnDate, 1), dmyAddDays(payexTxnDate, -1)];
  return [...new Set(a)];
}

function loadTransactions() {
  const byTid = new Map();
  for (const fn of TX_FILES) {
    const fp = path.join(WIX, fn);
    if (!fs.existsSync(fp)) continue;
    const wb = XLSX.readFile(fp, { cellDates: true });
    const sn = wb.SheetNames[0];
    const ws = wb.Sheets[sn];
    const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
    for (const row of json) {
      const tid = String(row.TransactionId || "").trim();
      if (!tid) continue;
      const status = String(row.Status || "").trim();
      const resp = String(row.Response || "").trim().toUpperCase();
      if (status !== "Sales") continue;
      if (resp !== "SUCCESS" && resp !== "APPROVED") continue;
      const amt = Number(row.Amount);
      if (!Number.isFinite(amt)) continue;
      const ref = String(row.ReferenceNumber || "").trim();
      const entry = {
        sourceFile: fn,
        payexTxnDateTime: row.Date,
        payexTxnDate: txnDateToDMY(row.Date),
        settlementId: String(row.SettlementId || "").trim(),
        settlementDateRaw: String(row.SettlementDate || "").trim(),
        transactionId: tid,
        referenceNumber: ref,
        amount: amt,
        description: String(row.Description || "").trim(),
        customerName: String(row.CustomerName || "").trim(),
        transactionType: String(row.TransactionType || "").trim(),
        matched: false,
      };
      if (!byTid.has(tid)) byTid.set(tid, entry);
    }
  }
  return [...byTid.values()];
}

/**
 * @param {ExcelJS.Workbook} wb
 * @param {string} sheetName
 * @param {Record<string, unknown>[]} rows
 * @param {string | null} yellowHeaderKey
 * @param {(row: Record<string, unknown>) => boolean | null} yellowIf - if provided, only those rows get yellow on that column
 */
function appendSheet(wb, sheetName, rows, yellowHeaderKey, yellowIf) {
  const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  if (!rows.length) {
    ws.addRow(["说明", "无数据（本项未发现差异）"]);
    return;
  }
  const keys = Object.keys(rows[0]);
  ws.addRow(keys);
  ws.getRow(1).font = { bold: true };
  rows.forEach((r) => ws.addRow(keys.map((k) => r[k] ?? "")));
  keys.forEach((k, i) => {
    ws.getColumn(i + 1).width = Math.min(48, Math.max(12, String(k).length + 2));
  });
  if (yellowHeaderKey) {
    const colIdx = keys.indexOf(yellowHeaderKey) + 1;
    if (colIdx > 0) {
      for (let ri = 0; ri < rows.length; ri++) {
        const r = rows[ri];
        const doYellow = yellowIf ? yellowIf(r) : true;
        if (doYellow) ws.getCell(ri + 2, colIdx).fill = REMARK_FILL;
      }
    }
  }
}

async function main() {
  const bukkuRaw = fs.readFileSync(BUKKU_PAYEX_GL, "utf8");
  const bukku = parseBukkuGl(bukkuRaw);

  /** @type {{ id: number, kind: 'IV'|'OR', date: string, no: string, contact: string, desc: string, debit: number, rcRef: string | null, used: boolean }[]} */
  const invoices = [];
  let invId = 0;
  for (const ln of bukku) {
    const noU = ln.no.toUpperCase();
    if (noU.startsWith("OR-") && ln.debit != null && ln.debit > EPS) {
      const rental = /rental\s*payment/i.test(ln.desc);
      const m = ln.desc.match(rcRe);
      if (rental || m) {
        invoices.push({
          id: invId++,
          kind: "OR",
          date: ln.date,
          no: ln.no,
          contact: ln.contact,
          desc: ln.desc,
          debit: ln.debit,
          rcRef: m ? m[1] : null,
          used: false,
        });
      }
    }
    if (noU.startsWith("IV-") && /meter\s*topup/i.test(ln.desc) && ln.debit != null && ln.debit > EPS) {
      invoices.push({
        id: invId++,
        kind: "IV",
        date: ln.date,
        no: ln.no,
        contact: ln.contact,
        desc: ln.desc,
        debit: ln.debit,
        rcRef: null,
        used: false,
      });
    }
  }

  const jeLines = [];
  const jeByDate = new Map();
  for (const ln of bukku) {
    if (!ln.no.toUpperCase().startsWith("JE-")) continue;
    if (!/clear accounts receivable \(payex\)/i.test(ln.desc)) continue;
    if (ln.credit == null || ln.credit <= EPS) continue;
    jeLines.push({ date: ln.date, no: ln.no, credit: ln.credit, desc: ln.desc });
    jeByDate.set(ln.date, (jeByDate.get(ln.date) || 0) + ln.credit);
  }

  const settlementRows = parse(fs.readFileSync(PAYEX_SETTLEMENT, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });

  const settlementByTid = new Map();
  const sidAgg = new Map();
  const grossBySd = new Map();

  for (const r of settlementRows) {
    const tid = String(r.TransactionId || "").trim();
    const sid = String(r.SettlementId || "").trim();
    const sd = String(r.SettlementDate || "").trim();
    const gross = Number(String(r.Gross || "0").replace(/,/g, "")) || 0;
    const net = Number(String(r.Net || "0").replace(/,/g, "")) || 0;
    if (tid) settlementByTid.set(tid, { settlementId: sid, settlementDate: sd, gross, net });
    if (!sidAgg.has(sid)) {
      sidAgg.set(sid, { settlementId: sid, settlementDate: sd, grossSum: 0, netSum: 0, count: 0 });
    }
    const a = sidAgg.get(sid);
    a.grossSum += gross;
    a.netSum += net;
    a.count += 1;
    if (a.settlementDate !== sd && sd) a.settlementDate = sd;
    grossBySd.set(sd, (grossBySd.get(sd) || 0) + gross);
  }

  const payexSdSet = new Set(grossBySd.keys());
  const txns = loadTransactions();

  /** @type {Record<string, unknown>[]} */
  const sheet5DateOnly = [];

  // --- Phase A: RC-* Payex ↔ OR with same RC ref + amount ---
  for (const t of txns) {
    if (!t.referenceNumber.startsWith("RC-")) continue;
    const candidates = invoices.filter(
      (inv) =>
        !inv.used &&
        inv.kind === "OR" &&
        inv.rcRef === t.referenceNumber &&
        Math.abs(inv.debit - t.amount) < EPS
    );
    if (candidates.length === 0) continue;
    const inv = candidates[0];
    inv.used = true;
    t.matched = true;
    let note = "";
    if (candidates.length > 1) {
      note = `Bukku 存在 ${candidates.length} 笔同 RC+同金额 OR，已配对第一笔；请人工复核是否重复。`;
    }
    if (inv.date !== t.payexTxnDate) {
      sheet5DateOnly.push({
        类型: "RC租金_OR日期与Payex交易日不一致",
        Payex交易日期: t.payexTxnDate,
        Bukku凭证日期: inv.date,
        TransactionId: t.transactionId,
        ReferenceNumber: t.referenceNumber,
        金额MYR: t.amount,
        Bukku单据号: inv.no,
        客户: inv.contact,
        中文说明: `金额与 RC 一致；Payex 交易日 ${t.payexTxnDate}，Bukku OR 日期 ${inv.date}。${note}`,
        Remark_EN: `Amount and RC ref match; Payex txn date ${t.payexTxnDate} vs Bukku OR date ${inv.date}. ${note}`,
      });
    } else if (note) {
      sheet5DateOnly.push({
        类型: "RC租金_同RC同额多笔OR",
        Payex交易日期: t.payexTxnDate,
        Bukku凭证日期: inv.date,
        TransactionId: t.transactionId,
        ReferenceNumber: t.referenceNumber,
        金额MYR: t.amount,
        Bukku单据号: inv.no,
        客户: inv.contact,
        中文说明: note,
        Remark_EN: note,
      });
    }
  }

  // --- Phase B: MT_* Payex ↔ IV Meter (amount + date window) ---
  for (const t of txns) {
    if (t.matched || !t.referenceNumber.startsWith("MT_")) continue;
    let picked = null;
    let candCount = 0;
    for (const d of mtSearchDates(t.payexTxnDate)) {
      const candidates = invoices.filter(
        (inv) => !inv.used && inv.kind === "IV" && inv.date === d && Math.abs(inv.debit - t.amount) < EPS
      );
      if (candidates.length === 0) continue;
      picked = candidates[0];
      candCount = candidates.length;
      break;
    }
    if (picked) {
      picked.used = true;
      t.matched = true;
      const parts = [];
      let typ = "Meter_IV已配对无备注";
      if (picked.date !== t.payexTxnDate) {
        typ = candCount > 1 ? "Meter_日期差且同额多笔" : "Meter_IV日期与Payex交易日不一致";
        parts.push(`金额一致；Payex 交易日 ${t.payexTxnDate}，Bukku IV 日期 ${picked.date}（±1 日内配对）。`);
      } else if (candCount > 1) {
        typ = "Meter_同额多笔IV";
        parts.push(`Bukku 同日同金额 IV-Meter 共 ${candCount} 笔，已取第一笔配对；同额可能误配。`);
      }
      if (parts.length) {
        sheet5DateOnly.push({
          类型: typ,
          Payex交易日期: t.payexTxnDate,
          Bukku凭证日期: picked.date,
          TransactionId: t.transactionId,
          ReferenceNumber: t.referenceNumber,
          金额MYR: t.amount,
          Bukku单据号: picked.no,
          客户: picked.contact,
          中文说明: parts.join(" "),
          Remark_EN: parts.join(" "),
        });
      }
    }
  }

  // --- Sheet 1: Bukku 多开（IV/OR 无对应 Payex 交易）---
  const sheet1 = invoices
    .filter((inv) => !inv.used)
    .map((inv) => ({
      Bukku日期: inv.date,
      单据类型: inv.kind,
      单据号: inv.no,
      借方MYR: inv.debit,
      客户: inv.contact,
      RC参考号: inv.rcRef || "",
      摘要节选: inv.desc.replace(/\s+/g, " ").slice(0, 200),
      中文说明:
        inv.kind === "OR" && !inv.rcRef
          ? "OR 租金行但摘要无 Ref: RC-…，无法用 Payex ReferenceNumber 勾对；或门户交易导出未覆盖。"
          : inv.kind === "OR"
            ? "有 RC 但无匹配 Payex 成功交易（或导出范围/金额不一致）。"
            : "IV Meter 无匹配 Payex MT_ 交易（日期±1与金额）；或导出未覆盖、同额误配。",
    }));

  // --- Sheet 2: Payex 有钱无 Bukku IV/OR ---
  const sheet2 = txns
    .filter((t) => !t.matched)
    .map((t) => ({
      Payex交易日期: t.payexTxnDate,
      Payex交易时间: String(t.payexTxnDateTime),
      TransactionId: t.transactionId,
      ReferenceNumber: t.referenceNumber,
      金额MYR: t.amount,
      客户: t.customerName,
      描述: t.description,
      支付方式: t.transactionType,
      SettlementId: t.settlementId || settlementByTid.get(t.transactionId)?.settlementId || "",
      结算日: t.settlementDateRaw || settlementByTid.get(t.transactionId)?.settlementDate || "",
      来源文件: t.sourceFile,
      中文说明:
        t.referenceNumber.startsWith("RC-")
          ? "Payex 有 RC 收款，但 Bukku 无同 RC+同额 OR（或 OR 无 Ref）。"
          : t.referenceNumber.startsWith("MT_")
            ? "Payex 有 MT_ 收款，但 Bukku 在交易日前后±1日无同额 IV-Meter。"
            : "ReferenceNumber 非 RC-/MT_，未参与自动配对。",
    }));

  // --- Sheet 3: Payex Settlement 日有 Gross 但 Bukku 无 JE 或金额不平 ---
  const sheet3 = [];
  const sdKeysPayex = [...payexSdSet].sort();
  const badSd = new Set();
  for (const sd of sdKeysPayex) {
    const payexGross = grossBySd.get(sd) || 0;
    const je = jeByDate.get(sd) || 0;
    if (payexGross <= EPS) continue;
    const ok = je > EPS && Math.abs(payexGross - je) < EPS;
    if (ok) continue;
    badSd.add(sd);
    sheet3.push({
      类型: "结算日Gross对JE",
      结算日_SettlementDate: sd,
      SettlementId: "(当日汇总)",
      Payex当日Gross合计: payexGross.toFixed(2),
      Bukku同日JE贷方合计: je ? je.toFixed(2) : "0",
      差额: (payexGross - je).toFixed(2),
      中文说明:
        je <= EPS
          ? "Payex 该结算日有 Gross，但 Bukku 同日无 JE Clear AR(Payex) 贷方。"
          : "Payex 当日 Gross 合计与 Bukku JE 贷方合计不一致（请用 Gross 对账，非 Net）。",
    });
  }
  for (const [, a] of [...sidAgg.entries()].sort((x, y) => x[1].settlementDate.localeCompare(y[1].settlementDate))) {
    if (!badSd.has(a.settlementDate)) continue;
    sheet3.push({
      类型: "SettlementId批次",
      结算日_SettlementDate: a.settlementDate,
      SettlementId: a.settlementId,
      Payex当日Gross合计: a.grossSum.toFixed(2),
      PayexNet本批次: a.netSum.toFixed(2),
      笔数: a.count,
      Bukku同日JE贷方合计: (jeByDate.get(a.settlementDate) || 0).toFixed(2),
      中文说明: "所属结算日汇总未平时的批次明细；JE 按日汇总。",
    });
  }

  // --- Sheet 4: Bukku 有 JE 清算，Payex Settlement.csv 无该结算日 ---
  const sheet4 = [];
  for (const jl of jeLines) {
    if (payexSdSet.has(jl.date)) continue;
    sheet4.push({
      Bukku凭证日期: jl.date,
      JE单号: jl.no,
      JE贷方MYR: jl.credit,
      中文说明:
        "Bukku 该日有 JE Clear AR(Payex)，但所附 Payex Settlement.csv 无此 SettlementDate；请换覆盖更全的结算导出。",
    });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "payex-bukku-reconcile";
  appendSheet(wb, "1_Bukku多开", sheet1, null);
  appendSheet(wb, "2_Payex无票", sheet2, null);
  appendSheet(wb, "3_结算无JE", sheet3, null);
  appendSheet(wb, "4_无结算有JE", sheet4, null);
  appendSheet(wb, "5_仅日期差", sheet5DateOnly, "中文说明", (row) =>
    /日期/.test(String(row.类型 || ""))
  );

  await wb.xlsx.writeFile(OUT_XLSX);

  for (const fn of OLD_CSV) {
    const p = path.join(WIX, fn);
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (_) {
      /* ignore */
    }
  }

  console.log("Wrote:", OUT_XLSX, "| GL:", BUKKU_PAYEX_GL);
  console.log(
    "Sheet counts: 1多开",
    sheet1.length,
    "2无票",
    sheet2.length,
    "3结算无JE",
    sheet3.length,
    "4无结算有JE",
    sheet4.length,
    "5日期差",
    sheet5DateOnly.length
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
