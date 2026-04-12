/**
 * Wix Velo — 员工页 #button1：从 Bukku 拉取指定 contact 的发票，缺失的写入 RentalCollection（不调用 Bukku POST 开票）。
 *
 * 前提：
 * - backend/tenantRentalCollectionBackfillFromBukku.jsw 已由 docs 同步并 Publish
 * - TenantDetail.contact_id 与 Bukku 一致（例：Tharvin → 133）
 * - 至少一条 Tenancy 指向该租客（或下方写死 tenancyId）
 *
 * _dup skip_：bukku_invoice_id 或 invoiceid（IV 号）已在 CMS 则跳过。
 */
import { backfillRentalCollectionsFromBukkuInvoices } from 'backend/tenantRentalCollectionBackfillFromBukku.jsw';

/** Bukku 联系人 id（租客账单 party） */
const BUKKU_CONTACT_ID = 133;

/** 可选：指定 Tenancy._id；null 则用该租客最近一条 Tenancy */
const TENANCY_ID = null;

/** 新行默认 type：bukkuid.title（与 tenantbukkuinvoicebooking 一致时用 Rental Income） */
const DEFAULT_TYPE_TITLE = 'Rental Income';

/** true = 只打印将要插入的项，不写 CMS */
const DRY_RUN = false;

$w.onReady(function () {
  $w('#button1').onClick(async () => {
    const textEl = $w('#text1');
    try {
      if (textEl) textEl.text = 'Running backfill from Bukku…';
      const res = await backfillRentalCollectionsFromBukkuInvoices({
        contactId: BUKKU_CONTACT_ID,
        tenancyId: TENANCY_ID || undefined,
        defaultTypeTitle: DEFAULT_TYPE_TITLE,
        dryRun: DRY_RUN
      });

      const lines = [
        `ok=${res.ok}`,
        res.message ? `msg: ${res.message}` : '',
        res.tenant ? `tenant: ${res.tenant.fullname || ''} (${res.tenant._id})` : '',
        res.tenancy_id ? `tenancy: ${res.tenancy_id}` : '',
        `Bukku invoices fetched: ${res.invoiceCount ?? '?'}`,
        `inserted: ${(res.inserted || []).length}`,
        `skipped: ${(res.skipped || []).length}`,
        `errors: ${(res.errors || []).length}`
      ].filter(Boolean);

      const detail =
        `\n\n--- inserted ---\n${JSON.stringify(res.inserted || [], null, 2)}` +
        `\n\n--- skipped ---\n${JSON.stringify(res.skipped || [], null, 2)}` +
        `\n\n--- errors ---\n${JSON.stringify(res.errors || [], null, 2)}`;

      if (textEl) textEl.text = lines.join('\n') + detail;
      console.log('[backfill]', res);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (textEl) textEl.text = `Error: ${msg}`;
      console.error('[backfill]', e);
    }
  });
});
