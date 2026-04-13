/**
 * Operator Portal API – all calls go through Next proxy to ECS.
 * Email from session; clientId from current role when staff has multiple clients.
 */

import { portalPost, portalPostBlob, portalPostJsonAllowError } from "./portal-api";
import type { AccessContextResponse } from "./portal-api";
export type { AccessContextResponse };
import { getMember, getCurrentRole } from "./portal-session";

function getEmail(): string | null {
  const member = getMember();
  return member?.email ?? null;
}

function getClientId(): string | null {
  const role = getCurrentRole();
  const member = getMember();
  const staffRoles = (member?.roles || []).filter((r) => r.type === "staff");
  const firstStaff = staffRoles[0] as { clientId?: string } | undefined;
  const id = role?.clientId ?? firstStaff?.clientId ?? null;
  const s = id != null ? String(id).trim() : "";
  return s || null;
}

/** Prefer explicit id (e.g. from OperatorContext after access loads); else session role / first staff company. */
function resolveOperatorClientId(override?: string | null): string | null {
  const o = override != null ? String(override).trim() : "";
  if (o) return o;
  return getClientId();
}

/** Current operator company id (from session role). Use when reading per-client fields like contact `account[]`. */
export function getOperatorClientId(): string | null {
  return getClientId();
}

async function post<T = unknown>(
  path: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const email = getEmail();
  if (!email) throw new Error("Not logged in");
  const clientId = getClientId();
  const payload = { email, ...(clientId ? { clientId } : {}), ...body };
  return portalPost<T>(path, payload);
}

// ─── Terms & Conditions (SaaS–Operator) ───────────────────────────────────────
export async function getTermsSaasOperator() {
  return post<{
    ok: boolean;
    content?: string;
    version?: string;
    contentHash?: string;
    accepted?: boolean;
    acceptedAt?: string;
    signatureHash?: string;
    reason?: string;
  }>("terms/saas-operator", {});
}

export async function signTermsSaasOperator(signature: string) {
  return post<{ ok: boolean; signatureHash?: string; reason?: string }>(
    "terms/saas-operator/sign",
    { signature }
  );
}

// ─── Access & Billing ───────────────────────────────────────────────────────
export async function getAccessContext(clientId?: string | null) {
  const email = getEmail();
  if (!email) return { ok: false, reason: "NO_EMAIL" as const };
  if (clientId) {
    return portalPost<{ ok: boolean; staff?: unknown; client?: unknown; credit?: unknown; reason?: string }>(
      "access/context/with-client",
      { email, clientId }
    );
  }
  return portalPost<{ ok: boolean; staff?: unknown; client?: unknown; credit?: unknown; reason?: string }>(
    "access/context",
    { email }
  );
}

export async function getMyBillingInfo() {
  return post<{
    noPermission?: boolean;
    currency?: string;
    title?: string;
    plan?: unknown;
    credit?: { balance?: number };
    expired?: unknown;
    pricingplandetail?: unknown;
    reason?: string;
  }>("billing/my-info", {});
}

export async function getPlans() {
  return post<{ ok?: boolean; items?: Array<{ id: string; _id?: string; title: string; description?: string; sellingprice?: number; corecredit?: number }>; reason?: string }>(
    "billing/plans",
    {}
  );
}

export async function getAddons() {
  return post<{ ok?: boolean; items?: Array<{ id: string; _id?: string; title: string; description?: string; credit?: string; qty?: number }>; reason?: string }>(
    "billing/addons",
    {}
  );
}

export async function getCreditPlans() {
  return post<{ ok?: boolean; items?: Array<{ id: string; title: string; sellingprice?: number; credit?: number }>; reason?: string }>(
    "billing/credit-plans",
    {}
  );
}

export async function startTopup(params: {
  returnUrl: string;
  creditPlanId?: string;
  /** Custom flex credits (no plan row); server price = credits × smallest-plan unit rate */
  credits?: number;
  amount?: number;
}) {
  return post<{
    success?: boolean;
    provider?: string;
    url?: string;
    referenceNumber?: string;
    /** Same as creditlogs.id; used if client must sync after gateway return */
    creditLogId?: string;
    reason?: string;
  }>("billing/topup/start", params);
}

/** Poll Xendit invoice and finalize top-up if PAID (when callback was missed). */
export async function syncTopupFromXendit(opts: { creditLogId: string }) {
  return post<{
    ok?: boolean;
    paid?: boolean;
    already?: boolean;
    status?: string;
    reason?: string;
    creditlog_id?: string;
  }>("billing/topup/xendit-sync", { creditLogId: opts.creditLogId });
}

/** Poll Billplz bill and finalize top-up if PAID (when callback was missed). MYR SaaS. */
export async function syncTopupFromBillplz(opts: { creditLogId: string }) {
  return post<{
    ok?: boolean;
    paid?: boolean;
    already?: boolean;
    reason?: string;
  }>("billing/topup/billplz-sync", { creditLogId: opts.creditLogId });
}

/** After Stripe Checkout redirect (session_id in URL). Coliving SaaS Malaysia test Stripe. */
export async function syncTopupFromStripe(opts: { creditLogId: string; sessionId: string }) {
  return post<{
    ok?: boolean;
    paid?: boolean;
    already?: boolean;
    reason?: string;
  }>("billing/topup/stripe-sync", { creditLogId: opts.creditLogId, sessionId: opts.sessionId });
}

/** Poll Xendit invoice and finalize pricing plan if PAID (when callback was missed). */
export async function syncPlanFromXendit(opts: { pricingplanlogId: string }) {
  return post<{
    ok?: boolean;
    paid?: boolean;
    already?: boolean;
    status?: string;
    reason?: string;
    pricingplanlogId?: string;
  }>("billing/plan/xendit-sync", { pricingplanlogId: opts.pricingplanlogId });
}

/** Poll Billplz bill and finalize plan if PAID (when callback was missed). MYR SaaS. */
export async function syncPlanFromBillplz(opts: { pricingplanlogId: string }) {
  return post<{
    ok?: boolean;
    paid?: boolean;
    already?: boolean;
    reason?: string;
  }>("billing/plan/billplz-sync", { pricingplanlogId: opts.pricingplanlogId });
}

/** After Stripe Checkout redirect (session_id in URL). */
export async function syncPlanFromStripe(opts: { pricingplanlogId: string; sessionId: string }) {
  return post<{
    ok?: boolean;
    paid?: boolean;
    already?: boolean;
    reason?: string;
    pricingplanlogId?: string;
  }>("billing/plan/stripe-sync", { pricingplanlogId: opts.pricingplanlogId, sessionId: opts.sessionId });
}

export async function submitManualTopupRequest(opts: {
  creditPlanId?: string;
  credits?: number;
  amount?: number;
}) {
  return post<{ ok?: boolean; creditlogId?: string; referenceNumber?: string; credits?: number; amount?: number; reason?: string }>(
    "billing/topup/request-manual",
    opts
  );
}

export async function getStatementItems(opts?: {
  page?: number;
  pageSize?: number;
  sort?: string;
  filterType?: string;
  search?: string;
}) {
  return post<{
    ok?: boolean;
    items?: unknown[];
    total?: number;
    page?: number;
    pageSize?: number;
    /** Sum(client_credit) — same source as header balance */
    walletTotalCredits?: number | null;
    /** Sum(creditlogs.amount) — running-balance endpoint for the statement column */
    creditLogNetTotal?: number | null;
    /** wallet − creditlogs when both present */
    creditsLedgerDelta?: number | null;
  }>("billing/statement-items", opts ?? {});
}

export async function getOperatorTransactions(opts?: {
  provider?: "xendit" | "stripe";
  status?: "all" | "pending" | "settlement";
  search?: string;
  sort?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
  page?: number;
  pageSize?: number;
}) {
  return post<{
    ok: boolean;
    items?: Array<{
      id: string;
      provider: string;
      status: string;
      paymentStatus?: string;
      settlementStatus?: string;
      payoutStatus?: string;
      currency: string;
      grossAmount: number;
      processingFee: number;
      createdAt: string;
      estimatePayoutAt?: string | null;
      estimateReceiveAt?: string | null;
      receivedAt?: string | null;
      payoutAt?: string | null;
      accountingJournalId?: string | null;
      transactionId: string;
      referenceNumber: string;
      payBy: string;
      details?: { tenantName?: string; propertyName?: string; roomName?: string; tenancyId?: string };
      invoice?: { source?: string; recordId?: string; invoiceId?: string };
    }>;
    total?: number;
    page?: number;
    pageSize?: number;
    reason?: string;
  }>("billing/operator/transactions", opts ?? {});
}

/** Get one-time download URL for statement Excel. Same filters as statement-items. */
export async function getStatementExportUrl(opts?: { sort?: string; filterType?: string; search?: string }) {
  return post<{ downloadUrl?: string; reason?: string }>("billing/statement-export", opts ?? {});
}

/** PDF breakdown for one credit ledger deduction (no tax invoice). */
export async function downloadCreditDeductionReportPdf(creditLogId: string): Promise<Blob> {
  const email = getEmail();
  if (!email) throw new Error("Not logged in");
  const clientId = getClientId();
  const id = String(creditLogId || "").trim();
  if (!id) throw new Error("Missing credit log id");
  return portalPostBlob("billing/credit-log-deduction-report", {
    email,
    ...(clientId ? { clientId } : {}),
    creditLogId: id,
  });
}

/** Submit help/topup ticket. mode e.g. 'topup_manual' | 'help'. photo = OSS URL of payment receipt (manual flow). */
export async function submitTicket(payload: {
  mode?: string;
  description: string;
  clientId?: string;
  photo?: string;
}) {
  return post<{ ok?: boolean; ticketId?: string; reason?: string }>("help/ticket", payload);
}

export async function previewPricingPlan(planId: string) {
  return post<{
    scenario?: "NEW" | "RENEW" | "UPGRADE" | "DOWNGRADE";
    fromPlanTitle?: string;
    toPlanTitle?: string;
    totalPayment?: number;
    expiredDate?: string;
    expiredDateText?: string;
    credit?: { current?: number; grantedByPlan?: number; addonRequired?: number; availableAfterRenew?: number };
    creditEnough?: boolean;
    reason?: string;
  }>("billing/checkout/preview", { planId });
}

export async function confirmPricingPlan(planId: string, returnUrl: string) {
  return post<{
    provider?: "stripe" | "xendit" | "billplz" | "payex" | "manual";
    url?: string;
    referenceNumber?: string;
    pricingplanlogId?: string;
    ticketId?: string;
    reason?: string;
  }>("billing/checkout/confirm", { planId, returnUrl });
}

/** Deduct addon credit (staff flow). Uses credit balance; addons = { planId: qty }. */
export async function deductAddonCredit(payload: { amount: number; title: string; addons: Record<string, number> }) {
  return post<{ success?: boolean; deducted?: number; reason?: string }>(
    "billing/deduction/addon",
    payload
  );
}

// ─── Admin Dashboard (Feedback, Refund, Tenancy, Agreement) ─────────────────
export async function getAdminList(opts?: {
  filterType?: string;
  search?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  limit?: number;
}) {
  return post<{ ok: boolean; items?: unknown[]; total?: number; totalPages?: number; currentPage?: number }>(
    "admindashboard/list",
    opts ?? {}
  );
}

export async function updateFeedback(
  id: string,
  payload: {
    done?: boolean;
    /** @deprecated Prefer message_append — replaces entire thread when sent without message_append (legacy). */
    remark?: string;
    /** Append one operator message to feedback.messages_json (does not overwrite prior replies). */
    message_append?: {
      text?: string;
      visibleToTenant?: boolean;
      attachments?: Array<string | { src: string; type?: "image" | "video" }>;
    };
    operator_done_at?: string | null;
    operator_done_photo_append?: Array<string | { src: string; type?: string }>;
    operator_done_photo_replace?: Array<string | { src: string; type?: string }>;
  }
) {
  return post<{ ok: boolean; reason?: string }>("admindashboard/feedback/update", { id, ...payload });
}

export async function removeFeedback(id: string) {
  return post<{ ok: boolean; reason?: string }>("admindashboard/feedback/remove", { id });
}

export async function updateRefund(
  id: string,
  payload: { done?: boolean; status?: "pending" | "approved" | "completed" | "rejected"; refundAmount?: number; paymentDate?: string; paymentMethod?: string; skipAccounting?: boolean }
) {
  return post<{ ok: boolean; reason?: string }>("admindashboard/refund/update", { id, ...payload });
}

export async function bulkUpdateRefunds(
  ids: string[],
  payload: { done?: boolean; status?: "pending" | "approved" | "completed" | "rejected"; paymentDate?: string; paymentMethod?: string; skipAccounting?: boolean }
) {
  return post<{ ok: boolean; updated?: number; failed?: Array<{ id: string; reason: string }> }>("admindashboard/refund/bulk-update", { ids, ...payload });
}

export async function removeRefund(id: string) {
  return post<{ ok: boolean; reason?: string }>("admindashboard/refund/remove", { id });
}

/** Update commission release (referral): release_date, release_amount, status (paid|pending), remark, staff_id, payment_method (bank|cash for money out) */
export async function updateCommissionRelease(
  id: string,
  payload: {
    release_date?: string | null;
    release_amount?: number | null;
    status?: "paid" | "pending" | "rejected";
    remark?: string | null;
    reject_reason?: string | null;
    staff_id?: string | null;
    payment_method?: "bank" | "cash";
    skipAccounting?: boolean;
    skipAccountingVoid?: boolean;
  }
) {
  return post<{ ok: boolean; reason?: string }>("admindashboard/commission-release/update", { id, ...payload });
}

/** Revert a paid commission row to pending; voids Bukku money out / Xero SPEND when linked. */
export async function voidCommissionRelease(id: string, void_reason?: string) {
  return post<{ ok: boolean; reason?: string; detail?: string }>("admindashboard/commission-release/void", {
    id,
    void_reason: void_reason ?? "Voided by operator",
  });
}

/** Bukku web URL for linked banking expense (money-out), if subdomain + bukku_expense_id exist. */
export async function getCommissionReleaseReceiptUrl(id: string) {
  return post<{ ok: boolean; url?: string | null; provider?: string; reason?: string }>(
    "admindashboard/commission-release/receipt-url",
    { id }
  );
}

/** One-off: create missing commission_release rows from tenancy (after deploying commission feature). Idempotent. */
export async function backfillCommissionReleases() {
  return post<{ ok: boolean; created?: number; skipped?: number; scanned?: number; reason?: string }>(
    "admindashboard/commission-release/backfill",
    {}
  );
}

/** Dashboard tenancy cache: only rows where current staff is submitby / last_extended_by. Not for company-wide agreement list. */
export async function getTenancyList(opts?: {
  propertyId?: string;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  limit?: number;
}) {
  return post<{ ok?: boolean; items?: unknown[]; total?: number; totalPages?: number }>(
    "admindashboard/tenancy-list",
    opts ?? {}
  );
}

export async function getTenancyFilters() {
  return post<{ properties?: unknown[]; statusOptions?: unknown[] }>("admindashboard/tenancy-filters", {});
}

/** All `owner_operator` (property–owner) agreements for the company — not only pending operator sign. For Operator → Agreements. */
export async function getOwnerOperatorAgreementsList() {
  return post<{ ok?: boolean; items?: unknown[] }>("admindashboard/agreement/owner-operator-list", {});
}

export async function getAgreementForOperator(agreementId: string) {
  return post<{ ok: boolean; item?: unknown }>("admindashboard/agreement/for-operator", { agreementId });
}

export async function signAgreementOperator(agreementId: string, operatorsign: string) {
  return post<{ ok: boolean; reason?: string }>("admindashboard/agreement/operator-sign", {
    agreementId,
    operatorsign,
  });
}

/** When all parties signed but agreement did not reach `completed` / final PDF — operator retry. */
export async function retryAgreementFinalPdf(agreementId: string) {
  return post<{ ok: boolean; pdfUrl?: string; reason?: string; message?: string }>(
    "admindashboard/agreement/retry-final-pdf",
    { agreementId }
  );
}

/** Delete agreement row only when final hash is absent. No credit refund. */
export async function deleteAgreementForOperator(agreementId: string) {
  return post<{ ok: boolean; reason?: string; message?: string }>(
    "admindashboard/agreement/delete",
    { agreementId }
  );
}

// ─── Company Setting ───────────────────────────────────────────────────────
/** Use opts.clientId to force the operator's company (from access context) so staff/profile are for the same client. */
export async function getProfile(opts?: { clientId?: string | null }) {
  return post<{ ok?: boolean; client?: unknown; reason?: string }>("companysetting/profile", opts?.clientId ? { clientId: opts.clientId } : {});
}

/** POST portal-auth/change-password – change logged-in user password (Operator / Staff). */
export async function changePassword(currentPassword: string, newPassword: string) {
  const email = getEmail();
  if (!email) throw new Error("Not logged in");
  return portalPost<{ ok: boolean; reason?: string }>("portal-auth/change-password", { email, currentPassword, newPassword });
}

/** Use opts.clientId to force the operator's company so the user list is for the same client. */
export async function getStaffList(opts?: { clientId?: string | null }) {
  return post<{
    ok?: boolean;
    items?: unknown[];
    maxStaffAllowed?: number;
    userLimit?: { planId?: string | null; planIncluded: number; extraUserAddon: number; maxTotal: number };
    reason?: string;
  }>(
    "companysetting/staff-list",
    opts?.clientId ? { clientId: opts.clientId } : {}
  );
}

export async function updateProfile(payload: Record<string, unknown>) {
  return post<{ ok: boolean; reason?: string }>("companysetting/profile-update", payload);
}

/** Operator personal profile photo only (stored on client_user / staffdetail). Does not change company logo (operatordetail.profilephoto). */
export async function updateOperatorProfilePhoto(profilephoto: string) {
  return post<{ ok: boolean; reason?: string }>("companysetting/operator-profile-photo", { profilephoto });
}

export async function getOnboardStatus(opts?: { clientId?: string }) {
  return post<{
    stripeConnected?: boolean;
    paymentGatewayProvider?: "stripe" | "payex" | "paynow" | "billplz" | string;
    sgPaynowEnabledWithGateway?: boolean;
    payexConfigured?: boolean;
    payexPlatformMode?: boolean;
    payexHasSubAccount?: boolean;
    payexSubAccountEverCreated?: boolean;
    cnyiotConnected?: boolean;
    accountingConnected?: boolean;
    accountingProvider?: string;
    ttlockConnected?: boolean;
    ttlockCreateEverUsed?: boolean;
    accountingEinvoice?: boolean;
    aiProvider?: string | null;
    aiProviderHasApiKey?: boolean;
    bankReconcileConnected?: boolean;
    finverseHasCreds?: boolean;
    googleDriveConnected?: boolean;
    googleDriveEmail?: string;
    /** operatordetail.email for current client (master company account) */
    operatorCompanyEmail?: string;
  }>("companysetting/onboard-status", opts ?? {});
}

/** Start Google OAuth for agreement PDF storage (Docs/Drive as the operator’s Google account). */
export async function getGoogleDriveOAuthUrl(opts?: { clientId?: string | null }) {
  return post<{ ok: boolean; url?: string; reason?: string }>(
    "companysetting/google-drive/oauth-url",
    opts?.clientId ? { clientId: opts.clientId } : {}
  );
}

export async function disconnectGoogleDrive(opts?: { clientId?: string | null }) {
  return post<{ ok: boolean; reason?: string }>(
    "companysetting/google-drive/disconnect",
    opts?.clientId ? { clientId: opts.clientId } : {}
  );
}

/** Use opts.clientId to force the operator's company. */
export async function getAdmin(opts?: { clientId?: string | null }) {
  return post<{ ok?: boolean; admin?: unknown }>("companysetting/admin", opts?.clientId ? { clientId: opts.clientId } : {});
}

export async function saveAdmin(admin: Record<string, unknown>) {
  return post<{ ok: boolean; reason?: string }>("companysetting/admin-save", { admin });
}

export async function createStaff(payload: Record<string, unknown>) {
  // `post()` uses `email` as the logged-in operator scope.
  // For staff creation, the payload's `email` is the NEW staff email, so rename to avoid clobbering operator scope.
  const { email: staffEmail, ...rest } = payload;
  return post<{ ok: boolean; id?: string; reason?: string }>("companysetting/staff-create", {
    ...rest,
    staffEmail: staffEmail ?? (payload as any).staffEmail,
  });
}

/** Create booking/commission staff (staffdetail). Does NOT require client_user quota. */
export async function createStaffContact(payload: { name: string; email: string }) {
  return post<{ ok?: boolean; id?: string; reason?: string }>("contact/staff/create", {
    name: payload.name,
    staffEmail: payload.email,
  });
}

/** Update booking/commission staffdetail fields (name + email). */
export async function updateStaffContact(staffId: string, payload: { name: string; email: string }) {
  // `post()` uses `email` for operator scope; staff email must be `staffEmail`.
  return post<{ ok?: boolean; staffId?: string; reason?: string }>("contact/staff/update", {
    staffId,
    name: payload.name,
    staffEmail: payload.email,
  });
}

/** Remove staffdetail row. Fails with STAFF_IN_USER_MANAGEMENT if email exists in Company → User management (client_user). */
export async function deleteStaffContact(staffId: string, opts?: { clientId?: string | null }) {
  return post<{ ok?: boolean; reason?: string }>("contact/staff/delete", {
    staffId,
    ...(opts?.clientId ? { clientId: opts.clientId } : {}),
  });
}

export async function updateStaff(staffId: string, payload: Record<string, unknown>) {
  // Same clobbering risk as createStaff: rename staff `email` -> `staffEmail`.
  const { email: staffEmail, ...rest } = payload;
  return post<{ ok: boolean; reason?: string }>("companysetting/staff-update", {
    staffId,
    ...rest,
    staffEmail: staffEmail ?? (payload as any).staffEmail,
  });
}

export async function deleteStaff(staffId: string, opts?: { clientId?: string | null }) {
  return post<{ ok: boolean; reason?: string }>("companysetting/staff-delete", {
    staffId,
    ...(opts?.clientId ? { clientId: opts.clientId } : {}),
  });
}

/** Use opts.clientId to force the operator's company when backend supports it. */
export async function getCompanyBanks(opts?: { clientId?: string | null }) {
  return post<{ ok?: boolean; items?: Array<{ label: string; value: string }> }>("companysetting/banks", opts?.clientId ? { clientId: opts.clientId } : {});
}

/** My Profile bank row — same bankdetail ids as Company Settings (MySQL). */
export async function getOperatorBankDetails(opts?: { clientId?: string | null }) {
  return post<{ ok?: boolean; bankId?: string | null; bankaccount?: string; accountholder?: string; reason?: string }>(
    "companysetting/operator-bank",
    opts?.clientId ? { clientId: opts.clientId } : {}
  );
}

export async function saveOperatorBankDetails(
  payload: { bankId?: string | null; bankaccount?: string; accountholder?: string },
  opts?: { clientId?: string | null }
) {
  return post<{ ok: boolean; reason?: string }>("companysetting/operator-bank-save", {
    ...(opts?.clientId ? { clientId: opts.clientId } : {}),
    bankId: payload.bankId ?? null,
    bankaccount: payload.bankaccount ?? "",
    accountholder: payload.accountholder ?? "",
  });
}

// Integration connect/disconnect
export async function getStripeConnectOnboardUrl(opts?: { returnUrl?: string; refreshUrl?: string }) {
  return post<{ ok?: boolean; url?: string; reason?: string }>("companysetting/stripe-connect-onboard", opts ?? {});
}

export async function getPaymentGatewayDirectStatus(opts?: { clientId?: string | null }) {
  return post<{
    ok: boolean;
    stripe?: {
      provider: "stripe";
      mode?: string;
      connectionStatus?: string;
      connected?: boolean;
      oauthConnected?: boolean;
      accountId?: string | null;
      hasWebhookSecret?: boolean;
      webhookSecretLast4?: string | null;
      webhookUrl?: string | null;
      lastWebhookAt?: string | null;
      lastWebhookType?: string | null;
      lastTestRequestedAt?: string | null;
      lastTestVerifiedAt?: string | null;
    };
    payex?: {
      provider: "payex";
      mode?: string;
      connectionStatus?: string;
      connected?: boolean;
      hasSecretKey?: boolean;
      hasWebhookToken?: boolean;
      secretKeyLast4?: string | null;
      webhookTokenLast4?: string | null;
      webhookUrl?: string | null;
      lastWebhookAt?: string | null;
      lastWebhookType?: string | null;
    };
    billplz?: {
      provider: "billplz";
      mode?: string;
      connectionStatus?: string;
      connected?: boolean;
      hasApiKey?: boolean;
      hasCollectionId?: boolean;
      hasXSignatureKey?: boolean;
      apiKeyLast4?: string | null;
      xSignatureKeyLast4?: string | null;
      collectionId?: string | null;
      paymentGatewayCode?: string | null;
      webhookUrl?: string | null;
      paymentOrderCallbackUrl?: string | null;
      lastWebhookAt?: string | null;
      lastWebhookType?: string | null;
    };
  }>("companysetting/payment-gateway/direct-status", opts ?? {});
}

export async function saveStripeWebhookConfig(opts?: {
  stripe_webhook_secret?: string;
  stripe_webhook_url?: string;
  allow_paynow_with_gateway?: boolean;
}) {
  return post<{ ok: boolean; provider?: "stripe"; connectionStatus?: string; reason?: string }>(
    "companysetting/stripe-direct-connect",
    opts ?? {}
  );
}

export async function stripeDisconnect() {
  return post<{ ok: boolean; reason?: string }>("companysetting/stripe-disconnect", {});
}

export async function triggerStripeWebhookTest() {
  return post<{
    ok: boolean;
    provider?: "stripe";
    accountId?: string | null;
    eventType?: string;
    mode?: string;
    reason?: string;
  }>("companysetting/stripe-test-webhook", {});
}

export async function cnyiotConnect(opts?: Record<string, unknown>) {
  return post<{ ok: boolean; reason?: string }>("companysetting/cnyiot-connect", opts ?? {});
}

export async function cnyiotDisconnect() {
  return post<{ ok: boolean; reason?: string }>("companysetting/cnyiot-disconnect", {});
}

export async function ttlockConnect(opts?: Record<string, unknown>) {
  return post<{ ok: boolean; reason?: string }>("companysetting/ttlock-connect", opts ?? {});
}

export async function ttlockDisconnect() {
  return post<{ ok: boolean; reason?: string }>("companysetting/ttlock-disconnect", {});
}

export async function getTtlockCredentials() {
  return post<{ ok?: boolean; username?: string; password?: string; reason?: string }>("companysetting/ttlock-credentials", {});
}

export async function startCleanlemonsLink(opts?: { clientId?: string | null }) {
  return post<{ ok: boolean; oauthUrl?: string; state?: string; reason?: string }>(
    "companysetting/cleanlemons-link/start",
    opts?.clientId ? { clientId: opts.clientId } : {}
  );
}

export async function getCleanlemonsLinkStatus(opts?: { clientId?: string | null }) {
  return post<{
    ok: boolean;
    linked?: boolean;
    oauthVerified?: boolean;
    confirmed?: boolean;
    exportPropertyEnabled?: boolean;
    integrateTtlockEnabled?: boolean;
    cleanlemonsClientdetailId?: string | null;
    cleanlemonsOperatorId?: string | null;
    hasBridgeApiKey?: boolean;
    reason?: string;
  }>("companysetting/cleanlemons-link/status", opts?.clientId ? { clientId: opts.clientId } : {});
}

export async function confirmCleanlemonsLink(body: {
  exportPropertyToCleanlemons: boolean;
  integrateTtlock: boolean;
  /** After user confirms in UI: disconnect Cleanlemons TTLock then apply Coliving credentials */
  replaceTtlockFromColiving?: boolean;
  clientId?: string | null;
}) {
  const { clientId, ...rest } = body;
  return post<{
    ok: boolean;
    confirmedAt?: string;
    alreadyConfirmed?: boolean;
    integrateTtlockApplied?: boolean;
    reason?: string;
    needsTtlockReplaceConfirm?: boolean;
  }>("companysetting/cleanlemons-link/confirm", {
    ...rest,
    ...(clientId ? { clientId } : {}),
  });
}

export async function disconnectCleanlemonsLink(opts?: { clientId?: string | null }) {
  return post<{ ok: boolean; alreadyDisconnected?: boolean; reason?: string }>(
    "companysetting/cleanlemons-link/disconnect",
    opts?.clientId ? { clientId: opts.clientId } : {}
  );
}

export async function getCleanlemonsCleaningPricing(opts: { propertyId: string; roomId?: string | null }) {
  return post<{
    ok: boolean;
    reason?: string;
    cleanlemonsLinked?: boolean;
    clnPropertyId?: string | null;
    refGeneralCleaning?: number | null;
    refWarmcleaning?: number | null;
    showRefGeneralCleaning?: boolean;
    showRefWarmcleaning?: boolean;
    cleanlemonsOperatorId?: string | null;
  }>("propertysetting/cleanlemons-cleaning/pricing", {
    propertyId: opts.propertyId,
    ...(opts.roomId ? { roomId: opts.roomId } : {}),
  });
}

export async function scheduleCleanlemonsCleaningJob(opts: {
  propertyId: string;
  roomId?: string | null;
  date: string;
  time: string;
  serviceProvider: "general-cleaning" | "room-rental-cleaning";
}) {
  return post<{ ok: boolean; id?: string; clnPropertyId?: string; reason?: string }>(
    "propertysetting/cleanlemons-cleaning/schedule",
    {
      propertyId: opts.propertyId,
      date: opts.date,
      time: opts.time,
      serviceProvider: opts.serviceProvider,
      ...(opts.roomId ? { roomId: opts.roomId } : {}),
    }
  );
}

export async function bukkuConnect(opts?: Record<string, unknown>) {
  return post<{ ok: boolean; reason?: string }>("companysetting/bukku-connect", opts ?? {});
}

export async function bukkuDisconnect() {
  return post<{ ok: boolean; reason?: string }>("companysetting/bukku-disconnect", {});
}

export async function xeroConnect(opts?: Record<string, unknown>) {
  return post<{ ok: boolean; reason?: string }>("companysetting/xero-connect", opts ?? {});
}

export async function getXeroAuthUrl(opts?: { returnUrl?: string; redirectUri?: string; state?: string }) {
  const returnUrl = opts?.returnUrl;
  const redirectUri = opts?.redirectUri ?? returnUrl;
  return post<{ ok?: boolean; url?: string; reason?: string }>("companysetting/xero-auth-url", {
    ...(opts ?? {}),
    ...(redirectUri ? { redirectUri } : {}),
  });
}

export async function xeroDisconnect() {
  return post<{ ok: boolean; reason?: string }>("companysetting/xero-disconnect", {});
}

export async function autocountConnect(opts?: Record<string, unknown>) {
  return post<{ ok: boolean; reason?: string }>("companysetting/autocount-connect", opts ?? {});
}

export async function autocountDisconnect() {
  return post<{ ok: boolean; reason?: string }>("companysetting/autocount-disconnect", {});
}

export async function sqlConnect(opts?: Record<string, unknown>) {
  return post<{ ok: boolean; reason?: string }>("companysetting/sql-connect", opts ?? {});
}

export async function sqlDisconnect() {
  return post<{ ok: boolean; reason?: string }>("companysetting/sql-disconnect", {});
}

export async function payexConnect(opts?: {
  xendit_sub_account_id?: string;
  xendit_test_secret_key?: string;
  xendit_live_secret_key?: string;
  xendit_use_test?: boolean;
}) {
  return post<{ ok: boolean; reason?: string }>("companysetting/payex-connect", opts ?? {});
}

export async function savePayexDirectConnect(opts?: {
  xendit_secret_key?: string;
  xendit_webhook_token?: string;
  xendit_webhook_url?: string;
  xendit_use_test?: boolean;
}) {
  return post<{ ok: boolean; provider?: "payex"; connectionStatus?: string; reason?: string }>(
    "companysetting/payex-direct-connect",
    opts ?? {}
  );
}

export async function xenditCreateSubAccount() {
  return post<{ ok: boolean; subAccountId?: string; reason?: string }>("companysetting/xendit-create-sub-account", {});
}

export async function payexDisconnect() {
  return post<{ ok: boolean; reason?: string }>("companysetting/payex-disconnect", {});
}

export async function saveBillplzDirectConnect(opts?: {
  billplz_api_key?: string;
  billplz_collection_id?: string;
  billplz_x_signature_key?: string;
  billplz_webhook_url?: string;
  billplz_payment_order_callback_url?: string;
  billplz_payment_gateway_code?: string;
  billplz_use_sandbox?: boolean;
}) {
  return post<{ ok: boolean; provider?: "billplz"; connectionStatus?: string; reason?: string }>(
    "companysetting/billplz-direct-connect",
    opts ?? {}
  );
}

export async function billplzDisconnect() {
  return post<{ ok: boolean; reason?: string }>("companysetting/billplz-disconnect", {});
}

export async function savePaymentGatewayMode(mode: "paynow_only" | "paynow_plus_stripe" | "stripe_only" | "paynow_plus_xendit") {
  return post<{ ok: boolean; provider?: "paynow" | "stripe" | "payex"; reason?: string }>("companysetting/payment-gateway-mode-save", { mode });
}

export async function getPayexCredentials() {
  return post<{ ok: boolean; configured?: boolean; reason?: string }>("companysetting/payex-credentials", {});
}

export async function updateAccountingEinvoice(opts: { provider: string; einvoice: boolean }) {
  return post<{ ok: boolean; reason?: string }>("companysetting/einvoice-update", opts);
}

export async function getAiProviderConfig() {
  return post<{ ok: boolean; provider?: string | null; hasApiKey?: boolean; model?: string | null; apiKeyLast4?: string | null; apiKeyHash?: string | null }>("companysetting/ai-provider", {});
}

export async function saveAiProviderConfig(opts: { provider: string; api_key?: string; model?: string }) {
  return post<{ ok: boolean; provider?: string; reason?: string }>("companysetting/ai-provider", opts);
}

export async function getPaymentVerificationInvoices(opts?: { status?: string }) {
  return post<{ ok: boolean; data?: unknown[] }>("companysetting/payment-verification-invoices", opts ?? {});
}

export async function getPaymentVerificationInvoice(invoiceId: string) {
  return post<{ ok: boolean; data?: unknown }>("companysetting/payment-verification-invoice-get", { id: invoiceId });
}

export async function approvePaymentVerification(
  invoiceId: string,
  opts?: {
    bank_transaction_id?: string;
    /** Required when client has accounting and PayNow lists rental invoice ids: `bank` | `cash` */
    accounting_method?: string;
    /** Malaysia calendar date YYYY-MM-DD for accounting receipt / paidat */
    accounting_payment_date?: string;
  }
) {
  return post<{ ok: boolean; data?: { status: string }; reason?: string }>("companysetting/payment-verification-approve", {
    id: invoiceId,
    ...opts,
  });
}

export async function rejectPaymentVerification(invoiceId: string) {
  return post<{ ok: boolean; data?: { status: string } }>("companysetting/payment-verification-reject", { id: invoiceId });
}

export async function getFinverseLinkUrl(): Promise<{ ok: boolean; link_url?: string; reason?: string }> {
  return post("companysetting/finverse-link-url", {});
}

export type PaynowQrLogItem = { id: string; uploadedAt: string; uploadedByEmail: string; url: string | null; action: string };
export async function getPaynowQrLog(): Promise<{ ok: boolean; items?: PaynowQrLogItem[] }> {
  return post("companysetting/paynow-qr-log", {});
}

// ─── Property Setting ──────────────────────────────────────────────────────
export async function getPropertyList(opts?: { keyword?: string; propertyId?: string; filter?: string; sort?: string; page?: number; pageSize?: number; limit?: number }) {
  return post<{ ok?: boolean; items?: unknown[]; total?: number }>("propertysetting/list", opts ?? {});
}

export async function getPropertyFilters() {
  return post<{ ok?: boolean; filters?: unknown }>("propertysetting/filters", {});
}

export async function getProperty(propertyId: string) {
  return post<{ ok?: boolean; property?: unknown }>("propertysetting/get", { propertyId });
}

export async function updateProperty(propertyId: string, payload: Record<string, unknown>) {
  return post<{ ok: boolean; reason?: string }>("propertysetting/update", { propertyId, ...payload });
}

export async function insertProperty(
  items: Array<{
    unitNumber?: string;
    apartmentName?: string;
    shortname?: string;
    address?: string;
    country?: string;
    /** WGS84; optional, same semantics as `cln_property` / `propertydetail` migration 0242 */
    latitude?: string | number | null;
    longitude?: string | number | null;
    /** percentage-type: gross/net/rental_income_only; fixed-type: management_fees_fixed */
    ownerSettlementModel?: "management_percent_gross" | "management_percent_net" | "management_percent_rental_income_only" | "management_fees_fixed" | "rental_unit" | "guarantee_return_fixed_plus_share";
    percentage?: number;
    fixedRentToOwner?: number;
    premisesType?: "landed" | "apartment" | "other" | "office" | "commercial";
    securitySystem?: string;
    /** Key collection (propertydetail 0252); null clears stored password */
    mailboxPassword?: string | null;
    smartdoorPassword?: string | null;
    smartdoorTokenEnabled?: boolean;
  }>
) {
  return post<{ ok?: boolean; ids?: string[]; inserted?: unknown[]; reason?: string }>("propertysetting/insert", { items });
}

export async function setPropertyActive(propertyId: string, active: boolean) {
  return post<{ ok: boolean; reason?: string }>("propertysetting/set-active", { propertyId, active });
}

export async function setPropertyArchived(propertyId: string, archived: boolean) {
  return post<{ ok: boolean; reason?: string }>("propertysetting/set-archived", { propertyId, archived });
}

export async function getParkingLots(propertyId: string) {
  return post<{ items?: unknown[] }>("propertysetting/parkinglots", { propertyId });
}

export async function saveParkingLots(propertyId: string, items: Array<{ parkinglot?: string }>) {
  return post<{ ok: boolean; reason?: string }>("propertysetting/parkinglots-save", { propertyId, items });
}

export async function getPropertyOwners() {
  return post<{ ok?: boolean; options?: Array<{ label: string; value: string }> }>("propertysetting/owners", {});
}

export async function getPropertyAgreementTemplates() {
  return post<{ ok?: boolean; options?: Array<{ label: string; value: string }> }>("propertysetting/agreement-templates", {});
}

export async function savePropertyOwnerAgreement(propertyId: string, payload: { ownerId: string; type?: string; templateId?: string; url?: string }) {
  return post<{ ok: boolean; reason?: string }>("propertysetting/owner-save", { propertyId, ...payload });
}

export async function isPropertyFullyOccupied(propertyId: string) {
  return post<{ fullyOccupied?: boolean }>("propertysetting/occupancy", { propertyId });
}

/** Building names from all operators, normalized + country (MY/SG). Display as "Name | MY". */
export async function getApartmentNames(country?: "MY" | "SG") {
  return post<{ items?: Array<{ apartmentName: string; country: string }> }>(
    "propertysetting/apartment-names",
    country ? { country } : {}
  );
}

/** OpenStreetMap Nominatim address search (server proxy; default Malaysia `countrycodes=my`, use `sg` for Singapore). */
export async function fetchAddressSearch(params: {
  q: string;
  limit?: number;
  /** Nominatim `countrycodes` e.g. `my` | `sg`. Empty string = no country filter. */
  countrycodes?: string;
  /** If OSM has no hit for `q`, server retries with this (e.g. building name). */
  propertyName?: string;
}): Promise<{
  ok: boolean;
  items?: Array<{ displayName: string; lat: string; lon: string; placeId: string }>;
  reason?: string;
}> {
  return post("propertysetting/address-search", {
    q: String(params.q || "").trim(),
    ...(params.limit != null ? { limit: params.limit } : {}),
    ...(params.countrycodes !== undefined ? { countrycodes: params.countrycodes } : {}),
    ...(params.propertyName != null && String(params.propertyName).trim() !== ""
      ? { propertyName: String(params.propertyName).trim() }
      : {}),
  });
}

export async function getPropertySuppliers() {
  return post<{ options?: Array<{ label: string; value: string }> }>("propertysetting/suppliers", {});
}

export async function getPropertySupplierExtra(propertyId: string) {
  return post<{ items?: Array<{ id: string; supplier_id: string; value: string; slot?: string }> }>("propertysetting/supplier-extra", { propertyId });
}

export async function savePropertySupplierExtra(propertyId: string, items: Array<{ supplier_id: string; value: string }>) {
  return post<{ ok: boolean; reason?: string }>("propertysetting/supplier-extra-save", { propertyId, items });
}

// ─── Room Setting ──────────────────────────────────────────────────────────
export async function getRoomList(opts?: {
  propertyId?: string;
  keyword?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  limit?: number;
  /** AVAILABLE | AVAILABLE_SOON | NON_AVAILABLE — server-side filter */
  availability?: string;
  /** ACTIVE | INACTIVE — roomdetail.active (listing); omit for all */
  activeFilter?: string;
  /** ROOM | ENTIRE_UNIT — listing kind (roomdetail.listing_scope) */
  listingScope?: string;
}) {
  return post<{
    ok?: boolean;
    items?: unknown[];
    total?: number;
    totalPages?: number;
    currentPage?: number;
  }>("roomsetting/list", opts ?? {});
}

export async function getRoomFilters() {
  return post<{ ok?: boolean; filters?: unknown }>("roomsetting/filters", {});
}

export async function getActiveRoomCount() {
  return post<{ ok?: boolean; activeRoomCount?: number }>("roomsetting/active-room-count", {});
}

export async function getRoom(roomId: string) {
  return post<{ ok?: boolean; room?: unknown }>("roomsetting/get", { roomId });
}

export async function updateRoom(roomId: string, payload: Record<string, unknown>) {
  return post<{ ok: boolean; reason?: string }>("roomsetting/update", { roomId, ...payload });
}

/** Undo partial DB writes when Quick Setup "Confirm & complete" fails after property/rooms/meters were created. */
export async function rollbackQuickSetupOnboarding(payload: {
  propertyId?: string;
  roomIds?: string[];
  meterIds?: string[];
}) {
  return post<{
    ok?: boolean;
    reason?: string;
    meterErrors?: Array<{ id: string; message: string }>;
  }>("propertysetting/rollback-quicksetup-onboarding", payload);
}

export async function insertRoom(
  records: Array<{ roomName?: string; property?: string; listingScope?: "room" | "entire_unit" }>
) {
  return post<{ ok: boolean; ids?: string[]; reason?: string }>("roomsetting/insert", { records });
}

export async function setRoomActive(roomId: string, active: boolean) {
  return post<{ ok: boolean; reason?: string }>("roomsetting/set-active", { roomId, active });
}

export async function deleteRoom(roomId: string) {
  return post<{ ok: boolean; reason?: string }>("roomsetting/delete", { roomId });
}

/** Recompute room available / available soon from tenancy rows (same logic as daily cron, single room). */
export async function syncRoomAvailability(roomId: string) {
  return post<{ ok: boolean; room?: unknown; reason?: string }>("roomsetting/sync-availability", { roomId });
}

export async function getRoomMeterOptions(roomId?: string, propertyId?: string) {
  return post<{ options?: Array<{ label: string; value: string }> }>("roomsetting/meter-options", { roomId, propertyId });
}

export async function getRoomSmartDoorOptions(roomId?: string, propertyId?: string) {
  return post<{ options?: Array<{ label: string; value: string }> }>("roomsetting/smartdoor-options", { roomId, propertyId });
}

export async function updateRoomMeter(roomId: string, meterId: string | null) {
  return post<{ ok: boolean; reason?: string }>("roomsetting/update-meter", { roomId, meterId });
}

export async function updateRoomSmartDoor(roomId: string, smartDoorId: string | null) {
  return post<{ ok: boolean; reason?: string }>("roomsetting/update-smartdoor", { roomId, smartDoorId });
}

/** Active tenancy for room (for View detail: tenant name, phone, rental, dates). */
export async function getTenancyForRoom(roomId: string) {
  return post<{ ok?: boolean; tenant?: { fullname?: string; phone?: string }; rental?: number; begin?: string; end?: string } | null>("roomsetting/tenancy", { roomId });
}

/** Upload file to OSS. Returns { ok, url }. Requires clientId from current role. */
/**
 * Used by room photo pickers. Windows often reports JPG as application/octet-stream — do not reject
 * non-empty non-image MIME before checking the file extension. Unicode names (e.g. 封面.jpg) are fine; we match /\.jpg$/i on the name.
 */
export function isLikelyImageFile(file: File): boolean {
  const t = (file.type || "").trim().toLowerCase();
  if (t.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(file.name || "");
}

/**
 * ECS `POST /api/upload` is behind apiAuth (Bearer + X-API-Username). Browser cannot send those;
 * Next `/api/portal/proxy/*` adds them server-side. Always use the proxy from the browser.
 */
function operatorMultipartApiBase(): string {
  if (typeof window === "undefined") {
    return (process.env.NEXT_PUBLIC_ECS_BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "") + "/api";
  }
  return "/api/portal/proxy";
}

export async function uploadFile(
  file: File,
  opts?: { clientId?: string | null }
): Promise<{ ok: boolean; url?: string; reason?: string }> {
  // Demo hostname: do not mock upload — proxy forwards multipart to ECS (see DEMO_BYPASS_PATHS).
  const clientId = resolveOperatorClientId(opts?.clientId);
  if (!clientId) {
    if (typeof window !== "undefined") {
      console.warn("[uploadFile] NO_CLIENT_ID (no fetch)");
    }
    return { ok: false, reason: "NO_CLIENT_ID" };
  }
  const formData = new FormData();
  formData.append("file", file);
  formData.append("clientId", clientId);
  const url = `${operatorMultipartApiBase()}/upload`;
  if (typeof window !== "undefined") {
    console.log("[uploadFile] fetch", {
      url,
      fileName: file.name,
      size: file.size,
      clientId: `${clientId.slice(0, 8)}…`,
    });
  }
  const controller = new AbortController();
  const timeoutMs = 45000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: formData, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: `Upload timeout after ${Math.round(timeoutMs / 1000)}s` };
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
  if (typeof window !== "undefined") {
    console.log("[uploadFile] response", { status: res.status, ok: res.ok });
  }
  const data = (await res.json().catch(() => ({}))) as { url?: string; reason?: string; message?: string; ok?: boolean };
  if (!res.ok) {
    const msg = data.reason || data.message || `Upload failed (${res.status})`;
    if (typeof window !== "undefined") {
      console.warn("[uploadFile] failed", { status: res.status, msg, body: data });
    }
    return { ok: false, reason: msg };
  }
  const outUrl = data.url;
  if (!outUrl) return { ok: false, reason: "NO_URL_IN_RESPONSE" };
  return { ok: true, url: outUrl };
}

/** Upload company chop image to OSS (makeBackgroundWhite by default). Returns { ok, url }. */
export async function uploadChopFile(
  file: File,
  opts?: { clientId?: string | null }
): Promise<{ ok: boolean; url?: string; reason?: string }> {
  const clientId = resolveOperatorClientId(opts?.clientId);
  if (!clientId) return { ok: false, reason: "NO_CLIENT_ID" };
  const formData = new FormData();
  formData.append("file", file);
  formData.append("clientId", clientId);
  formData.append("makeBackgroundWhite", "true");
  const url = `${operatorMultipartApiBase()}/upload/chop`;
  const controller = new AbortController();
  const timeoutMs = 45000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: formData, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: `Upload timeout after ${Math.round(timeoutMs / 1000)}s` };
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
  const data = (await res.json().catch(() => ({}))) as { url?: string; reason?: string; message?: string };
  if (!res.ok) {
    const msg = data.reason || data.message || `Upload failed (${res.status})`;
    return { ok: false, reason: msg };
  }
  if (!data.url) return { ok: false, reason: "NO_URL_IN_RESPONSE" };
  return { ok: true, url: data.url };
}

// ─── Owner Setting ─────────────────────────────────────────────────────────
export async function getOwnerList(opts?: { search?: string; keyword?: string; page?: number; pageSize?: number; limit?: number }) {
  const searchVal = opts?.search ?? opts?.keyword
  return post<{ ok?: boolean; items?: unknown[]; total?: number }>("ownersetting/list", {
    search: searchVal,
    page: opts?.page,
    pageSize: opts?.pageSize,
    limit: opts?.limit,
  });
}

export async function getOwnerFilters() {
  return post<{ ok?: boolean; filters?: unknown }>("ownersetting/filters", {});
}

export async function searchOwnerByEmail(keyword: string) {
  return post<{ ok?: boolean; items?: unknown[] }>("ownersetting/search-owner", { keyword });
}

export async function saveOwnerInvitation(payload: { ownerId?: string; email?: string; propertyId?: string; agreementId?: string; editingPendingContext?: unknown }) {
  const { email: ownerEmail, ...rest } = payload;
  /** Do not put invitee in `email` — post() merges body after session email and would overwrite operator login email */
  return post<{ ok: boolean; reason?: string }>("ownersetting/save-invitation", {
    ...rest,
    ownerEmail: ownerEmail?.trim(),
  });
}

export async function deleteOwnerFromProperty(propertyId: string) {
  return post<{ ok: boolean; reason?: string }>("ownersetting/delete-owner", { propertyId });
}

export async function removeOwnerMapping(ownerId: string) {
  return post<{ ok: boolean; reason?: string }>("ownersetting/remove-owner-mapping", { ownerId });
}

// ─── Agreement Setting ──────────────────────────────────────────────────────
export async function getAgreementList(opts?: { search?: string; mode?: string; sort?: string; page?: number; pageSize?: number; limit?: number }) {
  return post<{ ok?: boolean; items?: unknown[]; total?: number }>("agreementsetting/list", opts ?? {});
}

export async function getAgreementTemplate(id: string) {
  return post<{ ok?: boolean; template?: unknown }>("agreementsetting/get", { id });
}

export async function createAgreementTemplate(payload: Record<string, unknown>) {
  return post<{ ok: boolean; id?: string; reason?: string }>("agreementsetting/create", payload);
}

export async function updateAgreementTemplate(id: string, payload: Record<string, unknown>) {
  return post<{ ok: boolean; reason?: string }>("agreementsetting/update", { id, ...payload });
}

export async function deleteAgreementTemplate(id: string) {
  return post<{ ok: boolean; reason?: string }>("agreementsetting/delete", { id });
}

/** Template variables per mode (from agreement.service – single source of truth). */
export async function getAgreementVariablesReference() {
  return post<Record<string, { label: string; vars: string[] }>>("agreementsetting/variables-reference", {});
}

/** Preview template PDF: sample variables, replaced text in red. Returns URL to open/download. May fail with Drive quota. */
export async function getAgreementPreviewPdf(templateId: string) {
  return post<{ ok: boolean; pdfUrl?: string; reason?: string }>("agreementsetting/preview-pdf", { id: templateId });
}

/** Download preview PDF (OSS cache if ready, else on-the-fly via Google Docs/Drive API + operator OAuth/SA). Triggers browser save. */
export async function downloadAgreementPreviewPdf(templateId: string) {
  const email = getEmail();
  if (!email) throw new Error("Not logged in");
  const clientId = getClientId();
  const payload = { email, ...(clientId ? { clientId } : {}), id: templateId };
  const blob = await portalPostBlob("agreementsetting/preview-pdf-download", payload);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `agreement-preview-${templateId.slice(0, 8)}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export type OfficialTemplateRow = {
  id: string;
  agreementname: string;
  url: string;
  credit: number;
  owned: boolean;
  purchased_at?: string | null;
};

export async function getOfficialTemplatesList() {
  return post<{ ok: boolean; items?: OfficialTemplateRow[]; reason?: string }>(
    "agreementsetting/official-templates/list",
    {}
  );
}

export async function purchaseOfficialAgreementTemplates(templateIds: string[]) {
  return post<{
    ok: boolean;
    purchased?: { id: string; agreementname: string }[];
    deducted?: number;
    reason?: string;
    message?: string;
  }>("agreementsetting/official-templates/purchase", { templateIds });
}

/** Streams .docx via backend Drive export (not opening Google Docs in browser). */
export async function downloadOfficialAgreementTemplateDocx(templateId: string, filenameBase: string) {
  const email = getEmail();
  if (!email) throw new Error("Not logged in");
  const clientId = getClientId();
  const payload = { email, ...(clientId ? { clientId } : {}), templateId };
  const blob = await portalPostBlob("agreementsetting/official-template-download", payload);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = filenameBase.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 100) || "template";
  a.download = `${safe}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Get draft PDF URL for an agreement (real variables). Calls prepare-for-signature; returns existing or newly generated pdfUrl. */
export async function getAgreementDraftPdf(agreementId: string) {
  return post<{
    ok: boolean;
    pdfUrl?: string;
    agreementId?: string;
    reason?: string;
    message?: string;
    missingFields?: string[];
  }>("agreement/prepare-for-signature", { agreementId });
}

// ─── Meter Setting ─────────────────────────────────────────────────────────
export async function getMeterList(opts?: { propertyId?: string; keyword?: string; search?: string; filter?: string; sort?: string; page?: number; pageSize?: number; limit?: number }) {
  const body = { ...opts } as Record<string, unknown>;
  if (body.search != null && body.keyword == null) { body.keyword = body.search; delete body.search; }
  return post<{
    ok?: boolean;
    items?: unknown[];
    total?: number;
    totalPages?: number;
    currentPage?: number;
  }>("metersetting/list", body);
}

export async function getMeterFilters() {
  return post<{ ok?: boolean; filters?: unknown }>("metersetting/filters", {});
}

export async function syncMeter(meterId: string) {
  return post<{ ok?: boolean; after?: unknown; reason?: string }>("metersetting/sync", { meterId });
}

/** Sync all meters for this operator (CNYIoT → DB). */
export async function syncAllMeters() {
  return post<{
    ok?: boolean;
    total?: number;
    succeeded?: number;
    failed?: number;
    partial?: boolean;
    errors?: Array<{ meterId: string; reason?: string }>;
    message?: string;
    reason?: string;
  }>("metersetting/sync-all", {});
}

/** meterCmsId = meterdetail row UUID (required for correct row + UI). platformMeterId = 11-digit CNYIOT id. */
export async function meterClientTopup(meterCmsId: string, platformMeterId: string, amount: number) {
  return post<{
    ok?: boolean;
    balance?: number;
    status?: boolean;
    synced?: boolean;
    reason?: string;
  }>("metersetting/client-topup", { meterCmsId, meterId: platformMeterId, amount });
}

/** Prepaid only. meterId = meterdetail row id (UUID). Calls CNYIOT clearKwh. */
export async function clearMeterKwhBalance(meterCmsId: string) {
  return post<{
    ok?: boolean;
    balance?: number;
    status?: boolean;
    synced?: boolean;
    clearedKwh?: boolean;
    warn?: string;
    reason?: string;
    message?: string;
  }>("metersetting/clear-kwh", {
    meterId: meterCmsId,
  });
}

export async function updateMeter(meterId: string, payload: { title?: string; rate?: number; mode?: string; status?: boolean }) {
  return post<{ ok: boolean; reason?: string }>("metersetting/update", { meterId, ...payload });
}

/** Active 开关：断电/合闸 setRelay；返回 hint 供提示余额与用电说明 */
export async function updateMeterStatus(meterId: string, status: boolean) {
  return post<{
    ok: boolean;
    relayOk?: boolean;
    hint?: string;
    balance?: number;
    mode?: string;
    reason?: string;
  }>("metersetting/update-status", { meterId, status });
}

export async function deleteMeter(meterId: string) {
  return post<{ ok: boolean; reason?: string }>("metersetting/delete", { meterId });
}

/** Insert meters (from preview / CNYIoT). records: [{ meterId, title?, mode? }]. Returns { inserted, ids }. */
export async function insertMetersFromPreview(records: Array<{ meterId: string; title?: string; mode?: string }>) {
  return post<{ ok?: boolean; inserted?: number; ids?: string[]; reason?: string }>("metersetting/insert-from-preview", { records });
}

/** Bind meter (meterdetail id) to property only — whole unit / no room */
export async function bindMeterToProperty(meterId: string, propertyId: string) {
  return post<{ ok?: boolean; reason?: string }>("metersetting/bind-to-property", { meterId, propertyId });
}

/** Usage summary for date range. meterIds = 11-digit meter id strings; start/end = Date or ISO string. */
export async function getMeterUsageSummary(payload: { meterIds: string[]; start: string | Date; end: string | Date }) {
  const startStr = typeof payload.start === "string" ? payload.start : payload.start.toISOString().slice(0, 10);
  const endStr = typeof payload.end === "string" ? payload.end : payload.end.toISOString().slice(0, 10);
  return post<{ ok?: boolean; total?: number; records?: Array<{ date?: string; consumption?: number }>; children?: Record<string, unknown> }>("metersetting/usage-summary", { meterIds: payload.meterIds, start: startStr, end: endStr });
}

// ─── Smart Door Setting ────────────────────────────────────────────────────
export async function getSmartDoorList(opts?: { propertyId?: string; keyword?: string; search?: string; filter?: string; sort?: string; page?: number; pageSize?: number; limit?: number }) {
  const body = { ...opts } as Record<string, unknown>;
  if (body.search != null && body.keyword == null) { body.keyword = body.search; delete body.search; }
  return post<{ ok?: boolean; items?: unknown[]; total?: number; totalPages?: number; currentPage?: number }>("smartdoorsetting/list", body);
}

export async function getSmartDoorFilters() {
  return post<{ ok?: boolean; filters?: unknown }>("smartdoorsetting/filters", {});
}

export async function getSmartDoorLock(id: string) {
  return post<{ _id?: string; lockId?: string; lockAlias?: string; childmeter?: string[]; [k: string]: unknown } | { ok?: boolean; reason?: string }>("smartdoorsetting/get-lock", { id });
}

export async function getSmartDoorGateway(id: string) {
  return post<{ _id?: string; gatewayId?: string; gatewayName?: string; [k: string]: unknown } | { ok?: boolean; reason?: string }>("smartdoorsetting/get-gateway", { id });
}

export async function getChildLockOptions(excludeLockId: string | null) {
  return post<{ options?: Array<{ label: string; value: string }> }>("smartdoorsetting/child-lock-options", { excludeLockId: excludeLockId || undefined });
}

export async function updateSmartDoorLock(id: string, payload: { lockAlias?: string; active?: boolean; childmeter?: string[] }) {
  return post<{ ok: boolean; reason?: string }>("smartdoorsetting/update-lock", { id, ...payload });
}

export async function updateSmartDoorGateway(id: string, payload: { gatewayName?: string }) {
  return post<{ ok: boolean; reason?: string }>("smartdoorsetting/update-gateway", { id, ...payload });
}

export async function unlockSmartDoor(lockDetailId: string) {
  return post<{ ok: boolean; reason?: string }>("smartdoorsetting/unlock", { id: lockDetailId });
}

export async function previewSmartDoorSelection() {
  return post<{
    ok?: boolean;
    total?: number;
    list?: Array<{
      _id?: string;
      type?: string;
      externalId?: number;
      lockId?: number;
      gatewayId?: number;
      lockAlias?: string;
      gatewayName?: string;
      networkName?: string;
      lockNum?: number;
      electricQuantity?: number;
      hasGateway?: boolean;
      active?: boolean;
      isOnline?: boolean;
      provider?: string;
      mergeAction?: "insert" | "update";
      bindingLabels?: string[];
      bindingHint?: string | null;
    }>;
  }>("smartdoorsetting/preview-selection", {});
}

export async function insertSmartDoors(payload: { gateways?: Array<{ gatewayId: number; gatewayName: string; networkName?: string; lockNum?: number; isOnline?: boolean; type?: string }>; locks?: Array<{ lockId: number; lockAlias?: string; lockName?: string; electricQuantity?: number; type?: string; hasGateway?: boolean; brand?: string; active?: boolean; gatewayId?: string | null; __tmpGatewayExternalId?: number | null }> }) {
  return post<{ ok: boolean; reason?: string }>("smartdoorsetting/insert-smartdoors", payload);
}

export async function syncTTLockName(payload: { type: string; externalId: string; name: string }) {
  return post<{ ok: boolean; reason?: string }>("smartdoorsetting/sync-name", payload);
}

export async function deleteSmartDoorLock(id: string) {
  return post<{ ok: boolean; reason?: string }>("smartdoorsetting/delete-lock", { id });
}

export async function deleteSmartDoorGateway(id: string) {
  return post<{ ok: boolean; reason?: string }>("smartdoorsetting/delete-gateway", { id });
}

/** Merge TTLock lock list into existing lockdetail (gateway link, alias, battery). */
export async function syncSmartDoorLocksFromTtlock() {
  return post<{ ok: boolean; lockCount?: number; gatewayCount?: number; reason?: string }>(
    "smartdoorsetting/sync-locks-from-ttlock",
    {},
  );
}

/** One lockdetail row: TTLock → battery, alias, gateway link (does not full-sync all gateways). */
export async function syncSingleSmartDoorLockFromTtlock(lockDetailId: string) {
  return post<{
    ok: boolean;
    reason?: string;
    lock?: Record<string, unknown>;
  }>("smartdoorsetting/sync-single-lock-from-ttlock", { id: lockDetailId });
}

/** One gatewaydetail row: TTLock → name, online, lock count, network. */
export async function syncSingleSmartDoorGatewayFromTtlock(gatewayDetailId: string) {
  return post<{
    ok: boolean;
    reason?: string;
    gateway?: Record<string, unknown>;
  }>("smartdoorsetting/sync-single-gateway-from-ttlock", { id: gatewayDetailId });
}

// ─── Tenancy Setting ───────────────────────────────────────────────────────
/** All tenancies for the operator's company (same as Tenancy Setting). Use on Agreements page — not staff-scoped. */
export async function getTenancySettingList(opts?: {
  propertyId?: string;
  status?: string;
  search?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  limit?: number;
}) {
  return post<{ ok?: boolean; items?: unknown[]; total?: number }>("tenancysetting/list", opts ?? {});
}

export async function getRoomsForChange(currentRoomId?: string) {
  return post<{ ok?: boolean; items?: unknown[] }>("tenancysetting/rooms-for-change", { currentRoomId });
}

export async function extendTenancy(payload: {
  tenancyId: string;
  newEnd: string;
  newRental?: number;
  newDeposit?: number;
  agreementFees?: number;
  /** Monthly parking total for extension period (same proration as rent); only for tenancies that had parking fees at booking. */
  newParkingMonthly?: number;
}) {
  return post<{ ok: boolean; reason?: string }>("tenancysetting/extend", payload);
}

/** Server-built preview of rentalcollection rows extend would create (matches booking Summary idea). */
export async function previewExtendTenancy(payload: {
  tenancyId: string;
  newEnd: string;
  newRental?: number;
  newDeposit?: number;
  agreementFees?: number;
  newParkingMonthly?: number;
}) {
  return post<{
    ok?: boolean;
    message?: string;
    tenancyTitle?: string;
    previousEndYmd?: string | null;
    newEndYmd?: string;
    rentalInvoiceRule?: { type: string; value: number };
    oneTimeRows?: Array<{ key: string; label: string; sub?: string; amount: number }>;
    recurringRows?: Array<{ key: string; label: string; sub?: string; amount: number; formula?: string }>;
    oneTimeSubtotal?: number;
    recurringSubtotal?: number;
    total?: number;
    maxExtensionEnd?: string | null;
    rateSummary?: {
      rent: { from: number; to: number };
      parkingMonthlyTotal: { from: number; to: number } | null;
      deposit: { from: number; to: number };
    };
  }>("tenancysetting/extend-preview", payload);
}

/** Server-built preview of rental rows change-room would create (matches Extend Summary layout). */
export async function previewChangeRoomTenancy(payload: {
  tenancyId: string;
  newRoomId: string;
  newEnd: string;
  changeDate?: string;
  newRental?: number;
  newDeposit?: number;
  agreementFees?: number;
  newParkingMonthly?: number;
}) {
  return post<{
    ok?: boolean;
    message?: string;
    tenancyTitle?: string;
    moveFirstDayYmd?: string;
    newEndYmd?: string;
    rentalInvoiceRule?: { type: string; value: number };
    oneTimeRows?: Array<{ key: string; label: string; sub?: string; amount: number }>;
    recurringRows?: Array<{ key: string; label: string; sub?: string; amount: number; formula?: string }>;
    oneTimeSubtotal?: number;
    recurringSubtotal?: number;
    total?: number;
    skippedPaidInvoiceYmds?: string[];
    lastNightOnOldRateYmd?: string;
    billingInvoiceDateHint?: string;
    rateSummary?: {
      rent: { from: number; to: number };
      parkingMonthlyTotal: { from: number; to: number } | null;
      deposit: { from: number; to: number };
    };
    /** When move month had paid rent — preview uses gross − paid for that month. */
    changeRoomRentNetting?: { gross: number; paidCredit: number; net: number; monthLabel: string; applied: boolean };
    changeRoomParkingNetting?: { gross: number; paidCredit: number; net: number; monthLabel: string; applied: boolean };
  }>("tenancysetting/change-room-preview", payload);
}

export async function changeRoomTenancy(payload: {
  tenancyId: string;
  newRoomId: string;
  newEnd?: string;
  changeDate?: string;
  newRental?: number;
  newDeposit?: number;
  agreementFees?: number;
  newParkingMonthly?: number;
  handoverOut?: unknown;
  handoverIn?: unknown;
}) {
  return post<{ ok: boolean; reason?: string }>("tenancysetting/change", payload);
}

export async function terminateTenancy(payload: { tenancyId: string; forfeitAmount?: number; handoverCheckout?: unknown }) {
  return post<{ ok: boolean; reason?: string }>("tenancysetting/terminate", payload);
}

export async function getTerminateTenancyContext(payload: { tenancyId: string }) {
  return post<{
    ok?: boolean;
    reason?: string;
    tenancyId?: string;
    deposit?: number;
    depositFromTenancy?: number;
    paidDeposit?: number;
    /** true=合同与 RC 已付一致；false=不一致；null=租约表无押金列可比（如仅导入 RC） */
    depositInSync?: boolean | null;
    refundableDeposit?: number;
    skipDepositRefund?: boolean;
    status?: unknown;
  }>("tenancysetting/terminate-context", payload);
}

export async function saveCheckoutHandover(payload: { tenancyId: string; handoverCheckout: unknown }) {
  return post<{ success?: boolean; message?: string; reason?: string }>("tenancysetting/checkout-handover", payload);
}

/** On-site check-in handover (photos + signature) after booking — Tenancy action menu. */
export async function saveCheckinHandover(payload: { tenancyId: string; handoverCheckin: unknown }) {
  return post<{ success?: boolean; message?: string; reason?: string }>("tenancysetting/checkin-handover", payload);
}

/** Audit log: who changed handover appointment time (tenant portal or operator Edit Tenancy). */
export async function getHandoverScheduleLog(payload: { tenancyId: string; limit?: number }) {
  return post<{
    ok?: boolean
    items?: Array<{
      id: number
      fieldName: string
      oldValue: string | null
      newValue: string | null
      actorEmail: string | null
      actorType: string
      createdAt: string
    }>
  }>("tenancysetting/handover-schedule-log", payload);
}

export async function getTenancySettingFilters() {
  return post<{ ok?: boolean; filters?: unknown }>("tenancysetting/filters", {});
}

export async function cancelBooking(tenancyId: string) {
  return post<{ success?: boolean; message?: string }>("tenancysetting/cancel-booking", { tenancyId });
}

export async function previewChangeRoomProrate(opts: { oldRental: number; newRental: number; changeDate: string }) {
  return post<{ prorate?: number; cycleStart?: string; cycleEnd?: string }>("tenancysetting/change-preview", opts);
}

export async function getExtendOptions(tenancyId: string) {
  return post<{
    paymentCycle?: { type: string; value: number };
    maxExtensionEnd?: string | null;
    /** Display / prefill: tenancy column if &gt; 0 else paid RC sum */
    deposit?: number;
    depositFromTenancy?: number;
    paidDepositFromRentalCollection?: number;
    depositInSync?: boolean | null;
  }>("tenancysetting/extend-options", { tenancyId });
}

export async function getTenancyAgreementTemplates(mode: string) {
  return post<Array<{ id: string; _id: string; title?: string; mode?: string }>>("tenancysetting/agreement-templates", { mode });
}

export async function insertTenancyAgreement(payload: {
  tenancyId: string;
  propertyId?: string;
  ownerName?: string | null;
  mode: string;
  type: "manual" | "system";
  url?: string;
  templateId?: string;
  status?: string;
  createdBy?: string | null;
  extendBegin?: string;
  extendEnd?: string;
  remark?: string | null;
  /** Required for template (system) flow: server deducts platform credits after confirm. */
  confirmCreditDeduction?: boolean;
}) {
  return post<{ id?: string; _id?: string; pdfUrl?: string; creditDeducted?: number }>("tenancysetting/agreement-insert", payload);
}

/** Retry draft PDF for pending agreement only; does not deduct credits. */
export async function retryTenancyAgreementDraft(agreementId: string) {
  return post<{
    ok: boolean;
    reason?: string;
    message?: string;
    pdfUrl?: string;
    agreementId?: string;
    missingFields?: string[];
  }>("tenancysetting/agreement-retry-draft", { agreementId });
}

export async function updateTenancy(payload: { tenancyId: string; rental?: number; deposit?: number; end?: string; handoverCheckinAt?: string; handoverCheckoutAt?: string }) {
  return post<{ success?: boolean; message?: string }>("tenancysetting/update", payload);
}

export async function submitTenantReview(payload: {
  reviewId?: string;
  tenantId: string;
  tenancyId?: string;
  paymentScoreSuggested: number;
  paymentScoreFinal: number;
  unitCareScore: number;
  communicationScore?: number;
  latePaymentsCount?: number;
  outstandingCount?: number;
  badges?: string[];
  comment?: string;
  evidenceUrls?: string[];
}) {
  return post<{ ok: boolean; id?: string; overallScore?: number; reason?: string }>("tenancysetting/review-submit", payload);
}

export async function getLatestTenantReview(payload: { tenantId: string; tenancyId?: string }) {
  return post<{
    ok: boolean;
    item?: {
      id: string;
      paymentScoreSuggested: number;
      paymentScoreFinal: number;
      unitCareScore: number;
      communicationScore: number;
      overallScore: number;
      latePaymentsCount: number;
      outstandingCount: number;
      badges: string[];
      comment: string;
      evidenceUrls: string[];
      createdAt: string;
    } | null;
    reason?: string;
  }>("tenancysetting/review-latest", payload);
}

export async function submitOwnerReview(payload: {
  reviewId?: string;
  ownerId: string;
  communicationScore: number;
  responsibilityScore: number;
  cooperationScore: number;
  comment?: string;
  evidenceUrls?: string[];
}) {
  return post<{ ok: boolean; id?: string; overallScore?: number; reason?: string }>("tenancysetting/owner-review-submit", payload);
}

export async function getLatestOwnerReview(payload: { ownerId: string }) {
  return post<{
    ok: boolean;
    item?: {
      id: string;
      communicationScore: number;
      responsibilityScore: number;
      cooperationScore: number;
      overallScore: number;
      comment: string;
      evidenceUrls: string[];
      createdAt: string;
    } | null;
    reason?: string;
  }>("tenancysetting/owner-review-latest", payload);
}

// ─── Booking (available rooms + room details for new tenancy) ─────────────────
export async function getAdminRules() {
  return post<{ ok?: boolean; admin?: Record<string, unknown> }>("booking/admin-rules", {});
}

export async function getBookingStaff() {
  return post<{
    ok?: boolean;
    items?: Array<{ id: string; name?: string; email?: string; active?: boolean }>;
    currentStaffId?: string | null;
  }>("booking/staff", {});
}

export async function getAvailableRooms(keyword?: string) {
  return post<{
    ok?: boolean;
    items?: Array<{
      _id: string;
      title_fld?: string;
      value?: string;
      label?: string;
      /** System: room is vacant now */
      available?: boolean;
      /** System: will be free from availableFrom */
      availablesoon?: boolean;
      /** YYYY-MM-DD from roomdetail.availablefrom */
      availableFrom?: string | null;
    }>;
    message?: string;
  }>("booking/available-rooms", { keyword: keyword ?? "" });
}

export async function getBookingRoom(roomId: string) {
  return post<{ ok?: boolean; room?: { price?: number; rental?: number; property_id?: string; property?: { _id?: string } } }>(
    "booking/room",
    { roomId }
  );
}

export async function searchTenants(keyword: string) {
  return post<{ ok?: boolean; items?: Array<{ _id: string; value?: string; fullname?: string; email?: string; phone?: string }>; message?: string }>(
    "booking/search-tenants",
    { keyword: keyword ?? "" }
  );
}

export async function getTenant(tenantId: string) {
  return post<{ ok?: boolean; tenant?: { _id: string; fullname?: string; email?: string; phone?: string } }>("booking/tenant", { tenantId });
}

/** Resolve tenant by email for booking: reviews, tenancy flags (active / past). */
export async function lookupTenantForBooking(tenantEmail: string) {
  return post<{
    ok?: boolean;
    hasValidEmail?: boolean;
    hasRecord?: boolean;
    tenantId?: string | null;
    fullname?: string | null;
    email?: string | null;
    phone?: string | null;
    approvedForClient?: boolean;
    hasActiveTenancy?: boolean;
    hasPastTenancy?: boolean;
    reviewCount?: number;
    averageOverallScore?: number | null;
    latestReview?: {
      overallScore?: number;
      paymentScoreFinal?: number;
      unitCareScore?: number;
      communicationScore?: number;
      createdAt?: string;
    } | null;
  }>("booking/lookup-tenant", { tenantEmail: tenantEmail.trim() });
}

export async function getParkingLotsByProperty(propertyId: string) {
  return post<{ ok?: boolean; items?: Array<{ _id: string; value?: string; label?: string; parkinglot?: string }> }>(
    "booking/parking-by-property",
    { propertyId }
  );
}

export async function createBooking(payload: {
  tenantIdSelected?: string | null;
  emailInput?: string | null;
  /** Operator confirmation: new | returning_scored | former */
  tenantBookingKind?: string | null;
  roomId: string;
  beginDate: string;
  endDate: string;
  rental: number;
  deposit: number;
  agreementFees: number;
  parkingFees: number;
  selectedParkingLots?: string[];
  addOns?: Array<{ name: string; amount: number }>;
  billingBlueprint?: unknown[];
  commissionSnapshot?: unknown[];
  adminRules?: Record<string, unknown> | null;
  submitbyStaffId?: string | null;
  remark?: string;
  handoverCheckin?: unknown;
}) {
  return post<{ ok: boolean; tenancyId?: string; alreadyApproved?: boolean; status?: "active" | "pending_approval"; reason?: string }>(
    "booking/create",
    payload
  );
}

// ─── Contact ───────────────────────────────────────────────────────────────
export async function getContactList(opts?: {
  type?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  limit?: number;
  /** Override session company (must match operator access). */
  clientId?: string | null;
}) {
  return post<{
    ok?: boolean;
    items?: unknown[];
    total?: number;
    totalPages?: number;
    currentPage?: number;
  }>("contact/list", opts ?? {});
}

export async function getBanks() {
  return post<{ ok?: boolean; items?: Array<{ id: string; label: string; value: string }> }>("contact/banks", {});
}

/** Current client account system (sql|autocount|bukku|xero) for Account ID label. */
export async function getAccountSystem() {
  return post<{ ok?: boolean; provider?: string }>("contact/account-system", {});
}

/** Sync all contacts between local Contact and accounting provider. */
export async function syncAllContacts(direction: "to-accounting" | "from-accounting") {
  return post<{
    ok?: boolean;
    reason?: string;
    direction?: string;
    provider?: string;
    scanned?: number;
    synced?: number;
    linked?: number;
    created?: number;
    failed?: number;
  }>("contact/sync-all", { direction });
}

/** Get owner detail (ownerdetail) including account[] for Edit Account ID. */
export async function getOwnerDetail(ownerId: string) {
  return post<{
    ok?: boolean;
    ownerName?: string;
    email?: string;
    bankName?: string;
    bankAccount?: string;
    bankHolder?: string;
    account?: Array<{ provider?: string; clientId?: string; id?: string }>;
    reason?: string;
  }>("contact/owner", { ownerId });
}

/** Owner bank (bankName = bankdetail id). */
export async function updateOwnerBank(
  ownerId: string,
  fields: { bankName?: string; bankAccount?: string; bankHolder?: string }
) {
  return post<{ ok?: boolean; reason?: string }>("contact/owner/update-bank", { ownerId, ...fields });
}

/** Get tenant detail (tenantdetail) including account[] for Edit Account ID. */
export async function getTenantDetail(tenantId: string) {
  return post<{ ok?: boolean; fullname?: string; email?: string; account?: Array<{ provider?: string; clientId?: string; id?: string }>; reason?: string }>("contact/tenant", { tenantId });
}

/** Get supplier detail (supplierdetail) including account[] for Edit Account ID. */
export async function getSupplierDetail(supplierId: string) {
  return post<{
    ok?: boolean;
    title?: string;
    email?: string;
    productid?: string | null;
    productId?: string | null;
    account?: Array<{ provider?: string; clientId?: string; id?: string }>;
    reason?: string;
  }>("contact/supplier", { supplierId });
}

/** Update owner's accounting system contact id (Bukku/MySQL/Autocount/Xero). */
export async function updateOwnerAccount(ownerId: string, contactId: string) {
  return post<{ ok?: boolean; reason?: string }>("contact/owner/update-account", { ownerId, contactId });
}

/** Update tenant's accounting system contact id. */
export async function updateTenantAccount(tenantId: string, contactId: string) {
  return post<{ ok?: boolean; reason?: string }>("contact/tenant/update-account", { tenantId, contactId });
}

/** Update staff's accounting system contact id (for Contact Setting). */
export async function updateStaffAccount(staffId: string, contactId: string) {
  return post<{ ok?: boolean; reason?: string }>("contact/staff/update-account", { staffId, contactId });
}

/** Update portal_account.phone for a contact email (must belong to this operator client). */
export async function updateContactPortalPhone(fields: { contactEmail: string; phone?: string }) {
  return post<{ ok?: boolean; reason?: string }>("contact/portal-phone", {
    contactEmail: fields.contactEmail,
    phone: fields.phone ?? "",
  });
}

/** NRIC + ID type — same persistence as Portal profile (tenantdetail/ownerdetail + portal_account). */
export async function syncContactIdentity(fields: { contactEmail: string; idType?: string; idNumber?: string }) {
  return post<{ ok?: boolean; reason?: string }>("contact/sync-identity", {
    contactEmail: fields.contactEmail,
    idType: fields.idType,
    idNumber: fields.idNumber,
  });
}

/** Update supplier's accounting system contact id (partial update). */
export async function updateSupplierAccount(supplierId: string, contactId: string) {
  return post<{ ok?: boolean; reason?: string }>("contact/supplier/update", { supplierId, contactId });
}

/** Delete owner or cancel pending approval (unmap). */
export async function deleteOwnerOrCancel(ownerId: string, isPending: boolean) {
  return post<{ ok?: boolean; reason?: string }>("contact/owner/delete", { ownerId, isPending });
}

/** Delete tenant or cancel pending approval (unmap). */
export async function deleteTenantOrCancel(tenantId: string, isPending: boolean) {
  return post<{ ok?: boolean; reason?: string }>("contact/tenant/delete", { tenantId, isPending });
}

/** Delete supplier. */
export async function deleteSupplierAccount(supplierId: string) {
  return post<{ ok?: boolean; reason?: string }>("contact/supplier/delete", { supplierId });
}

/** Create supplier (Bukku/account sync + insert supplierdetail). bankName = bankdetail id. */
export async function createSupplier(payload: {
  name: string;
  email?: string;
  billerCode?: string;
  bankName?: string;
  bankAccount?: string;
  bankHolder?: string;
  productid?: string;
}) {
  // Avoid clobbering the operator/member email used by `post()` for access scoping.
  // Always send supplierEmail (even ""); route uses supplierEmail ?? body.email and body.email is the operator.
  const { email, ...rest } = payload;
  return post<{ ok?: boolean; reason?: string }>("contact/supplier/create", {
    ...rest,
    supplierEmail: email ?? "",
  });
}

/** Update supplier (full payload). bankName = bankdetail id. contactId = accounting contact id. */
export async function updateSupplier(
  supplierId: string,
  payload: {
    name?: string;
    email?: string;
    billerCode?: string;
    bankName?: string;
    bankAccount?: string;
    bankHolder?: string;
    contactId?: string;
    productid?: string;
  }
) {
  // Avoid clobbering the operator/member email used by `post()` for access scoping.
  const { email: supplierEmail, ...rest } = payload;
  return post<{ ok?: boolean; reason?: string }>("contact/supplier/update", { supplierId, ...rest, supplierEmail });
}

/** Submit owner approval request (by email). When directMap is true, owner is linked to client immediately (no portal approval). */
export async function submitOwnerApproval(ownerEmail: string, opts?: { directMap?: boolean; propertyId?: string }) {
  return post<{ ok?: boolean; reason?: string }>("contact/submit-owner-approval", {
    ownerEmail: ownerEmail || undefined,
    directMap: opts?.directMap === true,
    propertyId: opts?.propertyId || undefined,
  });
}

/** Submit tenant approval request (by email). When directMap is true, tenant is linked to client immediately (no portal approval). */
export async function submitTenantApproval(tenantEmail: string, opts?: { directMap?: boolean }) {
  return post<{ ok?: boolean; reason?: string }>("contact/submit-tenant-approval", {
    tenantEmail: tenantEmail || undefined,
    directMap: opts?.directMap === true,
  });
}

// ─── Expenses ──────────────────────────────────────────────────────────────
export async function getExpensesList(opts?: {
  property?: string;
  type?: string;
  from?: string;
  to?: string;
  search?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  limit?: number;
  paid?: boolean;
}) {
  return post<{ ok?: boolean; items?: unknown[]; total?: number; totalPages?: number; currentPage?: number }>(
    "expenses/list",
    opts ?? {}
  );
}

export async function getExpensesFilters() {
  return post<{ ok?: boolean; filters?: unknown }>("expenses/filters", {});
}

export async function insertExpense(payload: Record<string, unknown>) {
  return post<{ ok: boolean; id?: string; reason?: string }>("expenses/insert", payload);
}

export async function updateExpense(id: string, payload: Record<string, unknown>) {
  return post<{ ok: boolean; reason?: string }>("expenses/update", { id, ...payload });
}

export async function deleteExpense(id: string) {
  return post<{ ok: boolean; reason?: string }>("expenses/delete", { ids: [id] });
}

export async function bulkDeleteExpenses(ids: string[]) {
  return post<{ ok: boolean; reason?: string }>("expenses/delete", { ids });
}

export async function bulkMarkPaid(ids: string[], payload: { paidAt?: string; paymentMethod?: string }) {
  return post<{ ok: boolean; reason?: string }>("expenses/bulk-mark-paid", { ids, ...payload });
}

/** Get bulk expenses template file (base64). Returns { filename, data }. */
export async function getBulkTemplateFile() {
  return post<{ filename?: string; data?: string }>("expenses/bulk-template-file", {});
}

/** Get bulk expenses template download URL. Returns { downloadUrl }. */
export async function getBulkTemplateDownloadUrl() {
  return post<{ downloadUrl?: string }>("expenses/download-template-url", {});
}

// ─── Bank Bulk Transfer ────────────────────────────────────────────────────
/** Get available bank formats (e.g. Public Bank). No auth required for bank list. */
export async function getBankBulkTransferBanks() {
  return post<{ banks?: Array<{ label: string; value: string }> }>("bank-bulk-transfer", {});
}

/** Get download URL(s) for bank bulk transfer Excel/zip. Returns { urls: [{ filename, url }] }. */
// ─── Accounting (Account Mapping) ────────────────────────────────────────────
export async function getAccountList() {
  return post<{
    ok?: boolean;
    items?: Array<{
      _id?: string;
      id?: string;
      title?: string;
      type?: string;
      is_product?: boolean;
      uses_platform_collection_gl?: boolean;
      _myAccount?: {
        accountid?: string;
        productId?: string;
        system?: string;
        _accountFromPlatformCollection?: boolean;
      };
      _protected?: boolean;
    }>;
    reason?: string;
  }>("account/list", {});
}

export async function getAccountById(accountId: string) {
  return post<{ ok?: boolean; item?: Record<string, unknown>; reason?: string }>("account/get", { id: accountId });
}

export async function saveAccount(params: { item: { _id: string }; clientId?: string; system?: string; accountId?: string; productId?: string }) {
  return post<{ ok?: boolean; reason?: string }>("account/save", params);
}

export async function syncAccounts() {
  return post<{
    ok?: boolean;
    reason?: string;
    provider?: string;
    /** New accounts created in the remote system */
    createdAccounts?: number;
    /** Existing remote accounts matched by name (and type for Bukku) — IDs reused, no create */
    linkedAccounts?: number;
    createdProducts?: number;
    linkedProducts?: number;
    /** Rows where save to account_client failed (e.g. SYSTEM_MISMATCH) */
    saveMappingFailed?: number;
    /** Human-readable issues (create/save failures); check server logs for full detail */
    warnings?: string[];
  }>("account/sync", {});
}

export async function getBankBulkTransferDownloadUrl(params: {
  bank: string;
  type: "supplier" | "owner" | "refund";
  ids: string[];
}) {
  return post<{ urls?: Array<{ filename: string; url: string }>; ok?: boolean; reason?: string }>(
    "bank-bulk-transfer/download-url",
    params
  );
}

// ─── Tenant Invoice ────────────────────────────────────────────────────────
export async function getInvoiceProperties() {
  return post<{ ok?: boolean; items?: unknown[] }>("tenantinvoice/properties", {});
}

export async function getInvoiceTypes() {
  return post<{ ok?: boolean; items?: unknown[] }>("tenantinvoice/types", {});
}

export async function getRentalList(opts?: {
  property?: string;
  type?: string;
  from?: string;
  to?: string;
}) {
  return post<{
    ok?: boolean
    items?: unknown[]
    /** Bukku company subdomain — use with invoiceid to build View invoice link if invoiceurl missing */
    bukkuSubdomain?: string | null
    /** Client currency from operatordetail (e.g. MYR, SGD). */
    currency?: string
  }>("tenantinvoice/rental-list", opts ?? {});
}

export async function getTenancyListForInvoice(opts?: { propertyId?: string }) {
  return post<{ ok?: boolean; items?: unknown[] }>("tenantinvoice/tenancy-list", opts ?? {});
}

/** Suggested MYR from property/room tenant cleaning price (operator portal Create Invoice). */
export async function getTenancyCleaningPriceForInvoice(opts: { tenancyId: string }) {
  return post<{ ok: boolean; price?: number | null; reason?: string }>(
    "tenantinvoice/tenancy-cleaning-price",
    opts
  );
}

export async function getMeterGroups(opts?: { propertyId?: string }) {
  return post<{ ok?: boolean; items?: unknown[] }>("tenantinvoice/meter-groups", opts ?? {});
}

export async function insertRental(records: unknown[]) {
  return post<{
    ok: boolean
    inserted?: number
    ids?: string[]
    invoicesCreated?: number
    invoiceErrors?: string[]
    reason?: string
    insertedRows?: Array<{ id: string; invoiceid: string | null; invoiceurl: string | null }>
  }>("tenantinvoice/rental-insert", { records });
}

export async function updateRental(id: string, payload: Record<string, unknown>) {
  return post<{
    ok: boolean;
    reason?: string;
    updated?: number;
    receiptErrors?: string[];
    /** Bukku (etc.): rows written by createReceiptForPaidRentalCollection — paymentDateMalaysia = MY calendar date for receipt */
    receipts?: Array<{
      rentalcollectionId: string;
      provider: string;
      paymentDateMalaysia: string;
      receipturl?: string | null;
      bukku_payment_id?: string | null;
      accounting_receipt_document_number?: string | null;
    }>;
  }>("tenantinvoice/rental-update", { id, payload: payload });
}

export async function deleteRental(ids: string[]) {
  return post<{
    ok: boolean;
    reason?: string;
    deleted?: number;
    voidErrors?: string[];
  }>("tenantinvoice/rental-delete", { ids });
}

export async function voidRentalPayment(ids: string[]) {
  return post<{
    ok: boolean;
    reason?: string;
    voided?: number;
    voidErrors?: string[];
  }>("tenantinvoice/rental-void-payment", { ids });
}

// ─── Generate Report ───────────────────────────────────────────────────────
export async function getReportProperties() {
  return post<{ ok?: boolean; items?: unknown[] }>("generatereport/properties", {});
}

export async function getOwnerReports(opts?: { property?: string; from?: string; to?: string; search?: string; sort?: string; type?: string; page?: number; pageSize?: number; limit?: number }) {
  return post<{ ok?: boolean; items?: unknown[]; totalCount?: number; totalPages?: number; currentPage?: number }>("generatereport/owner-reports", opts ?? {});
}

export async function getOwnerReportsTotal(ids: string[]) {
  return post<{ total?: number; count?: number }>("generatereport/owner-reports-total", { ids });
}

export type OwnerReportAccountingResult = {
  ok?: boolean
  skipped?: boolean
  skipReason?: string
  provider?: string | null
  invoiceCreated?: boolean | number
  billCreated?: boolean | number
  skippedCount?: number
  errors?: string[]
}

export async function updateOwnerReport(id: string, payload: { paid?: boolean; paymentDate?: string; paymentMethod?: string; accountingStatus?: string; carryNegativeToNextMonth?: boolean }) {
  return post<{ success?: boolean; record?: unknown; accounting?: OwnerReportAccountingResult }>(
    "generatereport/owner-report-update",
    { id, ...payload }
  );
}

export async function bulkUpdateOwnerReport(ids: string[], payload: { paid?: boolean; paymentDate?: string; paymentMethod?: string; accountingStatus?: string; carryNegativeToNextMonth?: boolean }) {
  return post<{ success?: boolean; updatedCount?: number; accounting?: OwnerReportAccountingResult }>(
    "generatereport/bulk-update",
    { ids, ...payload }
  );
}

export async function deleteOwnerReport(id: string) {
  return post<{ ok?: boolean }>("generatereport/owner-report-delete", { id });
}

export async function voidOwnerReportPayment(id: string, opts?: { skipAccountingVoid?: boolean }) {
  return post<{ ok?: boolean; result?: { ok?: boolean; errors?: string[] } }>(
    "generatereport/owner-report-void-payment",
    { id, ...(opts?.skipAccountingVoid ? { skipAccountingVoid: true } : {}) }
  );
}

/** Read-only Bukku: match existing invoice/bill by owner contact + amounts; UPDATE ownerpayout URLs. Does not create Bukku docs. */
export async function linkOwnerReportBukkuUrls(id: string, opts?: { dryRun?: boolean; force?: boolean }) {
  const email = getEmail();
  if (!email) throw new Error("Not logged in");
  const clientId = getClientId();
  const payload: Record<string, unknown> = { email, id, ...(clientId ? { clientId } : {}), ...opts };
  return portalPostJsonAllowError<{
    ok?: boolean;
    reason?: string;
    dryRun?: boolean;
    /** Commit path: ownerpayout.paid set to 1 when URLs are written */
    paid?: boolean;
    /** Dry-run: would set paid on commit */
    wouldMarkPaid?: boolean;
    bukkuinvoice?: string | null;
    bukkubills?: string | null;
    invoice?: { id?: string; amount?: number };
    bill?: { id?: string; amount?: number };
    candidates?: { id: string; amount: number; snippet: string }[];
    notes?: string[];
    range?: { date_from: string; date_to: string };
    contactId?: number;
    hint?: string;
  }>("generatereport/owner-report-bukku-link-back", payload);
}

export async function generateOwnerPayout(propertyId: string, propertyName: string, startDate: string, endDate: string) {
  return post<{ rows?: unknown[]; totalrental?: number; totalutility?: number; totalcollection?: number; expenses?: number; managementfee?: number; netpayout?: number }>(
    "generatereport/generate-payout",
    { propertyId, propertyName, startDate, endDate }
  );
}

export async function insertOwnerReport(data: Record<string, unknown>) {
  return post<{ success?: boolean; record?: { _id?: string } }>("generatereport/owner-report", data);
}

export async function getOwnerReportsPdfDownloadUrl(ids: string[]) {
  return post<{ downloadUrl?: string }>("generatereport/owner-report-pdf-download", { ids });
}

/** Generate PDF and return download URL only (no DB write). Use for Download button. */
export async function getOwnerReportPdfDownloadUrlInline(propertyId: string, propertyName: string, startDate: string, endDate: string) {
  return post<{ downloadUrl?: string }>("generatereport/owner-report-pdf-download-inline", {
    propertyId,
    propertyName,
    startDate,
    endDate,
  });
}

export async function generateAndUploadOwnerReportPdf(
  payoutId: string,
  opts?: { startDate?: string; endDate?: string }
) {
  return post<{ ok?: boolean; id?: string; url?: string; skipped?: boolean; reason?: string; task?: string }>(
    "generatereport/generate-and-upload-owner-report-pdf",
    {
      payoutId,
      ...(opts?.startDate ? { startDate: opts.startDate } : {}),
      ...(opts?.endDate ? { endDate: opts.endDate } : {}),
    }
  );
}

export async function getOwnerReportSettings() {
  return post<{
    ok?: boolean;
    settings?: {
      defaultCarryNegativeForward?: boolean;
      automationEnabled?: boolean;
      automationDay?: number;
      reportClassificationMode?: "standard" | "customize";
      reportIncomeKeys?: string[];
      reportExpenseKeys?: string[];
    };
  }>("generatereport/report-settings", {});
}

export async function saveOwnerReportSettings(payload: {
  defaultCarryNegativeForward: boolean;
  automationEnabled: boolean;
  automationDay: number;
  reportClassificationMode?: "standard" | "customize";
  reportIncomeKeys?: string[];
  reportExpenseKeys?: string[];
}) {
  return post<{
    ok?: boolean;
    settings?: {
      defaultCarryNegativeForward?: boolean;
      automationEnabled?: boolean;
      automationDay?: number;
      reportClassificationMode?: "standard" | "customize";
      reportIncomeKeys?: string[];
      reportExpenseKeys?: string[];
    };
  }>("generatereport/report-settings-save", payload);
}

export async function getOwnerReportDriveStatus(id: string) {
  return post<{ ok?: boolean; exists?: boolean; reason?: string; url?: string }>(
    "generatereport/owner-report-drive-status",
    { id }
  );
}

// ─── Agreement (for operator signing context) ─────────────────────────────────
export async function getAgreementContext(opts: {
  mode?: "tenant_operator" | "owner_tenant" | "owner_operator";
  tenancyId?: string;
  agreementId?: string;
  ownerId?: string;
  propertyId?: string;
  clientId?: string;
  staffVars?: Record<string, string>;
}) {
  const email = getEmail();
  if (!email) throw new Error("Not logged in");
  const base = "agreement";
  const staffVars = opts.staffVars ?? {};

  if (opts.mode === "tenant_operator") {
    return portalPost<{ ok: boolean; variables?: Record<string, string>; reason?: string }>(
      `${base}/tenant-context`,
      { email, tenancyId: opts.tenancyId, agreementTemplateId: opts.agreementId, staffVars }
    );
  }
  if (opts.mode === "owner_tenant") {
    return portalPost<{ ok: boolean; variables?: Record<string, string>; reason?: string }>(
      `${base}/owner-tenant-context`,
      { email, tenancyId: opts.tenancyId, agreementTemplateId: opts.agreementId, staffVars }
    );
  }
  return portalPost<{ ok: boolean; variables?: Record<string, string>; reason?: string }>(
    `${base}/owner-context`,
    {
      email,
      ownerId: opts.ownerId,
      propertyId: opts.propertyId,
      clientId: opts.clientId,
      agreementTemplateId: opts.agreementId,
      staffVars,
    }
  );
}

export { getEmail as getOperatorEmail };
