/**
 * Wix Velo — #button1：核对 40 条 RentalCollection + 调用 receipt.jsw 开 receipt
 *
 * receipt.jsw / createBukkuPayment（你站上的版本）通常会做：
 * (1) wixData.get RentalCollection → 调 Bukku sales/payments → 用返回的 short_link
 *     再 wixData.update 每条 RC 的 receipturl。paidAt、bukku_invoice_id 等字段若未在
 *     createBukkuPayment 里写入，则仍以你在 CMS / Payex 回调里已写的为准。
 * (2) RentalCollection.paidAt：支付日一般由「标已付 / 回调」写入；Bukku payload 里的 date
 *     多为当天 ISO 日期，未必回写 paidAt（视你是否在 jsw 里追加 update）。
 * (3) bukku_invoice_id：用于 link_items 冲账；缺了可能仍能建 payment，但 link 行为不同。
 * (4) TenantDetail.contact_id：在 getContactIdFromRental 里读的是「租约→租客→contact_id」，
 *     不是 RentalCollection 上的字段；RentalCollection.tenant 仍是 Reference → TenantDetail。
 * (5)–(7) RentalCollection.accountId / productId：你 jsw 里若 `!rc.accountId` 会 continue，
 *     deposit_items 可能为空导致失败；productId 是否参与取决于你的 jsw 实现。
 * (8) account「类型」cf4141b1-…：一般是 **Collection: Account（或 type）** 的 _id，
 *     与 RC 的 type 引用一致才算进线；请你在 CMS 核对每条 RC 的 type。
 *
 * 用法：贴在租客页 Velo（或与现有 import 合并）。须已存在 `backend/receipt.jsw` 且 export
 * `createBukkuPayment`，并在 Permissions 中允许前端页面调用（或仅管理员页调用）。
 *
 * 安全：默认只处理「这 40 条里、tenant 等于当前登录邮箱对应 TenantDetail」的 subset，
 * 避免租客页误操作他人账单。若 40 条属全站混租户批量补单，请把 REQUIRE_SAME_TENANT_AS_VISITOR
 * 改为 false 且仅放在员工后台页。
 *
 * 开 receipt：**每次只传一个 _id**，`await` 完成后再处理下一条（与「一笔大单含 40 行」相反）。
 *
 * **仅改 Bukku 日期、不创建收据**：用 docs/wix/velo-bukku-payment-date-only-button.js（updatePaymentDatesSequential，无 receipt.jsw）。
 *
 * **重要**：若控制台没有 `[button1] isPaid (for date fix if enabled):` 这一行，说明站点上还是旧代码；
 * 请用本仓库 **docs/wix/velo-tenant-page-button1-missing-receipt-debug.js** 整段覆盖页面 Velo 后再 Publish。
 * 已有 receipt、仅改 Bukku 日期时：依赖 `FIX_BUKKU_DATE_FOR_PAID_WITH_RECEIPT`（见下方常量）。
 */
import wixData from 'wix-data';
import wixUsers from 'wix-users';
import { createBukkuPayment } from 'backend/receipt.jsw';
import { updatePaymentDateFromRentalPaidAt } from 'backend/sandbox234.jsw';

/** 40 条待核对的 RentalCollection._id（与你的清单一致） */
const RC_RECEIPT_BACKFILL_IDS = [
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

/**
 * true：只处理「RentalCollection.tenant === 当前登录邮箱对应的 TenantDetail._id」。
 * false：处理清单里所有能读到的行（给 sandbox2 / 员工补收据用；勿挂到租客自助页）。
 * 若日志里 Loaded=40 但 After tenant filter=0，就是当前账号不是这 40 条的租客 → 改 false 或换租客邮箱登录。
 */
const REQUIRE_SAME_TENANT_AS_VISITOR = false;

/** 某一 _id 调 Bukku 失败后是否停止后续 id（true = 全停；false = 记错继续） */
const BUKKU_STOP_ON_FIRST_ERROR = false;

/**
 * createBukkuPayment 成功后，用 sandbox234 PUT 把 Bukku payment 的 date 对齐 RentalCollection.paidAt（MY 日历日）。
 * 若只修正**已有**收据日期、不创建新 payment，可直接在后台调 `updatePaymentDatesSequential(id 列表)`。
 */
const FIX_BUKKU_PAYMENT_DATE_FROM_PAIDAT_AFTER_CREATE = true;

/**
 * 已付且 **已有** receipturl（不再 create）时仍跑 sandbox234：**只 PUT** Bukku payment `date` ← paidAt。
 * 典型：十一月已收款、链接已有，仅收据日期错误。
 */
const FIX_BUKKU_DATE_FOR_PAID_WITH_RECEIPT = true;

/** 期望的账单 type（Account）_id；仅用于报告告警，不阻止调用 createBukkuPayment */
const ACCOUNT_TYPE_EXPECTED = 'cf4141b1-c24e-4fc1-930e-cfea4329b178';

function isReceiptMissing(r) {
  const u = r.receipturl;
  return u == null || String(u).trim() === '';
}

/** CMS 可能写 isPaid 或 ispaid；统一认「已付」避免 paidForDateFix 为空 */
function isRowMarkedPaid(r) {
  if (r == null) return false;
  const a = r.isPaid;
  const b = r.ispaid;
  if (a === true || b === true) return true;
  if (Number(a) === 1 || Number(b) === 1) return true;
  const sa = a != null ? String(a).trim().toLowerCase() : '';
  const sb = b != null ? String(b).trim().toLowerCase() : '';
  if (sa === 'true' || sb === 'true' || sa === 'yes' || sb === 'yes') return true;
  return false;
}

function tenantIdOfRow(r) {
  const t = r.tenant;
  if (t == null) return null;
  if (Array.isArray(t)) {
    const first = t[0];
    if (first == null) return null;
    return typeof first === 'object' && first._id != null ? String(first._id) : String(first);
  }
  return typeof t === 'object' && t._id != null ? String(t._id) : String(t);
}

function formatPaidAtForDisplay(r) {
  /** @type {Intl.DateTimeFormatOptions} */
  const opts = {
    timeZone: 'Asia/Kuala_Lumpur',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  const raw = r.paidAt != null ? r.paidAt : r.paidat;
  if (raw) {
    try {
      return new Date(raw).toLocaleString('en-GB', opts);
    } catch (e) {
      return String(raw);
    }
  }
  const fb = r._updatedDate != null ? r._updatedDate : r.date;
  if (!fb) return '(no paidAt)';
  try {
    return `${new Date(fb).toLocaleString('en-GB', opts)} (fallback)`;
  } catch (e) {
    return String(fb);
  }
}

function typeIdOf(r) {
  const ty = r.type;
  if (ty == null) return null;
  return typeof ty === 'object' && ty._id ? String(ty._id) : String(ty);
}

function _idShort(id) {
  const s = String(id || '');
  if (s.length <= 13) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

$w.onReady(function () {
  $w('#button1').onClick(async () => {
    try {
      const email = (await wixUsers.currentUser.getEmail()).toLowerCase().trim();
      const tenantDoc = await wixData
        .query('TenantDetail')
        .eq('email', email)
        .find()
        .then((r) => r.items[0]);

      if (!tenantDoc) {
        $w('#text1').text = 'Not a tenant (no TenantDetail for this email).';
        console.warn('[button1] No TenantDetail for', email);
        return;
      }

      const fetched = await wixData
        .query('RentalCollection')
        .hasSome('_id', RC_RECEIPT_BACKFILL_IDS)
        .include('tenant', 'room', 'type', 'tenancy')
        .limit(1000)
        .find();

      const byId = new Map(fetched.items.map((it) => [it._id, it]));

      /** 清单里有、但库里查不到的 id */
      const missingInDb = RC_RECEIPT_BACKFILL_IDS.filter((id) => !byId.has(id));

      let items = fetched.items.slice();
      if (REQUIRE_SAME_TENANT_AS_VISITOR) {
        const tid = String(tenantDoc._id);
        items = items.filter((r) => tenantIdOfRow(r) === tid);
        if (fetched.items.length > 0 && items.length === 0) {
          const sample = fetched.items.slice(0, 3).map((r) => ({
            _id: r._id,
            rowTenantId: tenantIdOfRow(r),
            visitorTenantId: tid
          }));
          console.warn(
            '[button1] Tenant filter removed all rows. Visitor email → TenantDetail._id:',
            tid,
            'Sample row tenant ids:',
            sample
          );
        }
      }

      /** 与 RC_RECEIPT_BACKFILL_IDS 清单顺序一致，便于对照「第几条」 */
      const listOrder = new Map(RC_RECEIPT_BACKFILL_IDS.map((id, idx) => [id, idx]));
      function sortByListOrder(rows) {
        return rows.sort(
          (a, b) => (listOrder.get(a._id) ?? 9999) - (listOrder.get(b._id) ?? 9999)
        );
      }

      let needReceipt = items.filter((r) => isRowMarkedPaid(r) && isReceiptMissing(r));
      sortByListOrder(needReceipt);

      /** 已付（含已有 receipturl）— 仅改 Bukku 日期时用 */
      let paidForDateFix = items.filter((r) => isRowMarkedPaid(r));
      sortByListOrder(paidForDateFix);

      const wrongType = needReceipt.filter((r) => {
        const tid = typeIdOf(r);
        return tid != null && tid !== ACCOUNT_TYPE_EXPECTED;
      });

      const payload = needReceipt.map((r) => {
        const tenantName =
          (r.tenant && r.tenant.fullname) ||
          (tenantDoc && tenantDoc.fullname) ||
          '(unknown)';
        const amt = Number(r.amount);
        return {
          _id: r._id,
          tenantName,
          paidAt: formatPaidAtForDisplay(r),
          amountDisplay: Number.isFinite(amt) ? `RM ${amt.toFixed(2)}` : String(r.amount),
          invoiceid:
            r.invoiceid != null && String(r.invoiceid).trim() !== ''
              ? String(r.invoiceid)
              : 'N/A',
          typeId: typeIdOf(r),
          hasAccountId: !!(r.accountId != null && String(r.accountId).trim() !== '')
        };
      });

      console.log('[button1] List size (expected):', RC_RECEIPT_BACKFILL_IDS.length);
      console.log('[button1] Loaded from DB:', fetched.items.length);
      console.log('[button1] Missing in DB:', missingInDb);
      console.log('[button1] After tenant filter:', items.length);
      console.log('[button1] isPaid + no receipturl:', needReceipt.length);
      console.log('[button1] isPaid (for date fix if enabled):', paidForDateFix.length);
      console.log('[button1] type !== expected (still need receipt):', wrongType.length, wrongType.map((x) => x._id));
      if (typeof console.table === 'function') console.table(payload);
      else console.log(payload);

      let report = '';
      report += `List: ${RC_RECEIPT_BACKFILL_IDS.length} ids | DB hit: ${fetched.items.length}`;
      if (missingInDb.length) report += `\nNot in DB: ${missingInDb.length} → ${missingInDb.join(', ')}`;
      report += `\nSame tenant: ${items.length} | Paid & no receipt: ${needReceipt.length}`;
      if (wrongType.length) {
        report += `\nWARN type≠${ACCOUNT_TYPE_EXPECTED}: ${wrongType.length} ids → ${wrongType.map((x) => x._id).join(', ')}`;
      }

      const perItemLines = [];

      if (needReceipt.length === 0) {
        report += '\n\nNo rows to send to createBukkuPayment.';
        if (REQUIRE_SAME_TENANT_AS_VISITOR && fetched.items.length > 0 && items.length === 0) {
          report +=
            '\n\n→ All loaded rows were excluded: logged-in tenant ≠ RC.tenant. Use staff page with REQUIRE_SAME_TENANT_AS_VISITOR = false, or log in as the tenant on those bills.';
        } else if (items.length > 0) {
          report +=
            '\n\n→ Rows exist but none are isPaid=true with empty receipturl (already have receipt or not paid).';
        }

        if (FIX_BUKKU_DATE_FOR_PAID_WITH_RECEIPT && paidForDateFix.length === 0 && items.length > 0) {
          report +=
            '\n\n→ Date-fix skipped: no rows recognized as paid (check RentalCollection isPaid / ispaid in CMS).';
        }

        if (
          FIX_BUKKU_DATE_FOR_PAID_WITH_RECEIPT &&
          paidForDateFix.length > 0
        ) {
          report += `\n\nFix Bukku payment date only (PUT paidAt→MY): ${paidForDateFix.length} paid row(s)…`;
          $w('#text1').text = report;
          for (let i = 0; i < paidForDateFix.length; i++) {
            const r = paidForDateFix[i];
            const n = i + 1;
            const total = paidForDateFix.length;
            const progress = `[date ${n}/${total}] ${_idShort(r._id)}`;
            $w('#text1').text = `${report}\n\nRunning… ${progress}`;
            console.log('[button1] updatePaymentDateFromRentalPaidAt', progress, r._id);
            try {
              const fix = await updatePaymentDateFromRentalPaidAt(r._id);
              if (fix.ok) {
                const src = fix.paymentIdSource ? ` src=${fix.paymentIdSource}` : '';
                perItemLines.push(
                  `OK ${progress}\n_id: ${r._id}\nBukku date: ${fix.date} txn=${fix.transactionId}${src}`
                );
              } else {
                perItemLines.push(`FAIL ${progress}\n_id: ${r._id}\nerror: ${fix.error}`);
              }
            } catch (e) {
              const msg = e && e.message ? e.message : String(e);
              perItemLines.push(`FAIL ${progress}\n_id: ${r._id}\nerror: ${msg}`);
              if (BUKKU_STOP_ON_FIRST_ERROR) {
                perItemLines.push('Stopped (BUKKU_STOP_ON_FIRST_ERROR).');
                break;
              }
            }
          }
          const okD = perItemLines.filter((l) => l.startsWith('OK ')).length;
          const failD = perItemLines.filter((l) => l.startsWith('FAIL ')).length;
          report += `\nDate fix finished: ${okD} ok, ${failD} fail.`;
        }

        $w('#text1').text =
          perItemLines.length > 0
            ? `${report}\n\n--- Per item ---\n${perItemLines.join('\n\n')}`
            : report;
        return;
      }

      report += `\n\nSequential createBukkuPayment (1 id each), ${needReceipt.length} row(s)…`;

      for (let i = 0; i < needReceipt.length; i++) {
        const r = needReceipt[i];
        const n = i + 1;
        const total = needReceipt.length;
        const progress = `[${n}/${total}] ${_idShort(r._id)}`;
        $w('#text1').text = `${report}\n\nRunning… ${progress}`;
        console.log('[button1] createBukkuPayment start', progress, r._id);

        try {
          const shortLink = await createBukkuPayment({ rcIds: [r._id] });
          const linkStr = shortLink != null ? String(shortLink) : '(ok, see CMS receipturl)';
          let line = `OK ${progress}\n_id: ${r._id}\nlink: ${linkStr}`;
          if (FIX_BUKKU_PAYMENT_DATE_FROM_PAIDAT_AFTER_CREATE) {
            const fix = await updatePaymentDateFromRentalPaidAt(r._id);
            if (fix.ok) {
              line += `\nBukku date (PUT paidAt→MY): ${fix.date} txn=${fix.transactionId}`;
            } else {
              line += `\nWARN Bukku date PUT: ${fix.error}`;
            }
          }
          perItemLines.push(line);
          console.log('[button1] createBukkuPayment OK', r._id, shortLink);
        } catch (bErr) {
          const msg = bErr && bErr.message ? bErr.message : String(bErr);
          perItemLines.push(`FAIL ${progress}\n_id: ${r._id}\nerror: ${msg}`);
          console.error('[button1] createBukkuPayment FAIL', r._id, bErr);
          if (BUKKU_STOP_ON_FIRST_ERROR) {
            perItemLines.push('Stopped (BUKKU_STOP_ON_FIRST_ERROR).');
            break;
          }
        }
      }

      const okCount = perItemLines.filter((l) => l.startsWith('OK ')).length;
      const failCount = perItemLines.filter((l) => l.startsWith('FAIL ')).length;
      report += `\nFinished: ${okCount} ok, ${failCount} fail (this run).`;

      const lines = needReceipt.map((r) => {
        const amt = Number(r.amount);
        const ad = Number.isFinite(amt) ? `RM ${amt.toFixed(2)}` : String(r.amount);
        return `Tenant: ${(r.tenant && r.tenant.fullname) || tenantDoc.fullname}\nPayment: ${formatPaidAtForDisplay(r)}\nAmount: ${ad}\nInvoice: ${r.invoiceid || 'N/A'}\n_id: ${r._id}`;
      });
      $w('#text1').text = `${report}\n\n--- Per item ---\n${perItemLines.join('\n\n')}\n\n--- Snapshot ---\n${lines.join('\n\n')}`;
    } catch (err) {
      console.error('[button1] Failed:', err);
      $w('#text1').text = `Error: ${err && err.message ? err.message : String(err)}`;
    }
  });
});
