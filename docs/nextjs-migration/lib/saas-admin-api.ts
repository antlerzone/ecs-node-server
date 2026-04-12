/**
 * SaaS Admin (Manual Billing) API – calls ECS via Next proxy.
 * Paths: billing/indoor-admin/*, billing/plans. Email from session (getMember).
 */

import { portalPost } from "./portal-api";
import { getMember } from "./portal-session";

function getEmail(): string | null {
  const member = getMember();
  return member?.email ?? null;
}

async function post<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
  const email = getEmail();
  if (!email) throw new Error("Not logged in");
  return portalPost<T>(path, { email, ...body });
}

export interface ManualBillingClient {
  id: string;
  title: string;
  email?: string;
  status?: unknown;
  expired?: unknown;
  expiredStr: string;
  hasPlan: boolean;
  planTitle: string;
  /** Total credit balance from client_credit (sum of amount). */
  balanceCredit?: number;
}

/** POST billing/indoor-admin/clients – list clients for manual billing (dropdown + repeater). */
export async function getClients(): Promise<{ ok: boolean; items?: ManualBillingClient[]; reason?: string }> {
  const data = await post<{ ok?: boolean; items?: ManualBillingClient[]; reason?: string }>(
    "billing/indoor-admin/clients",
    {}
  );
  if (data?.ok === false) throw new Error(data.reason || "Failed to load clients");
  return { ok: true, items: Array.isArray(data?.items) ? data.items : [] };
}

export interface PricingPlan {
  id: string;
  _id: string;
  title: string;
  description?: string;
  sellingprice?: number;
  corecredit?: number;
  currency?: string;
  addon?: string[] | Array<{ title?: string; name?: string }>;
}

/** POST billing/plans – list pricing plans (array response from ECS). */
export async function getPlans(): Promise<PricingPlan[]> {
  const data = await post<unknown>("billing/plans", {});
  return Array.isArray(data) ? (data as PricingPlan[]) : [];
}

export interface PendingTicket {
  _id: string;
  id?: string;
  mode: string;
  description: string;
  ticketid: string;
  _createdDate?: string;
  created_at?: string;
  /** Set after SaaS admin acknowledges; row stays in the list. */
  acknowledgedAt?: string | null;
  /** Set after manual top-up (or billing) is processed for this ticket row. */
  completedAt?: string | null;
  client_id: string;
  clientTitle: string;
}

/** POST billing/indoor-admin/pending-tickets – pending manual billing/topup tickets. */
export async function getPendingTickets(): Promise<{ ok: boolean; items?: PendingTicket[]; reason?: string }> {
  const data = await post<{ ok?: boolean; items?: PendingTicket[]; reason?: string }>(
    "billing/indoor-admin/pending-tickets",
    {}
  );
  if (data?.ok === false) throw new Error(data.reason || "Failed to load pending tickets");
  return { ok: true, items: Array.isArray(data?.items) ? data.items : [] };
}

/** POST billing/indoor-admin/pending-tickets/acknowledge — sets ticket.acknowledged_at; row remains listed. */
export async function acknowledgeManualTicket(ticketRowId: string): Promise<{ ok: boolean; affected?: number }> {
  const data = await post<{ ok?: boolean; affected?: number; reason?: string }>(
    "billing/indoor-admin/pending-tickets/acknowledge",
    { ticketId: ticketRowId }
  );
  if (data?.ok === false) throw new Error(data.reason || "Failed to acknowledge ticket");
  return { ok: true, affected: data?.affected ?? 0 };
}

/** POST billing/indoor-admin/manual-topup – manual credit top-up. paidDate YYYY-MM-DD. topupMode: free_credit = no Bukku invoice, manual_credit = create Bukku invoice. */
export async function manualTopup(opts: {
  clientId: string;
  amount: number;
  paidDate: string;
  topupMode?: "free_credit" | "manual_credit";
  /** ticket.id when top-up is done from the manual-ticket dialog — marks ticket completed in DB. */
  ticketRowId?: string;
}): Promise<{ ok: boolean; creditlogId?: string; bukkuInvoiceId?: number; reason?: string }> {
  const data = await post<{ ok?: boolean; reason?: string; creditlogId?: string; bukkuInvoiceId?: number }>(
    "billing/indoor-admin/manual-topup",
    {
      clientId: opts.clientId,
      amount: opts.amount,
      paidDate: opts.paidDate,
      topupMode: opts.topupMode ?? "manual_credit",
      ...(opts.ticketRowId ? { ticketRowId: opts.ticketRowId } : {}),
    }
  );
  if (data?.ok === false) throw new Error(data.reason || "Manual top-up failed");
  return { ok: true, creditlogId: data?.creditlogId, bukkuInvoiceId: data?.bukkuInvoiceId };
}

/** POST billing/indoor-admin/manual-renew – manual plan create/renew. paidDate YYYY-MM-DD. remark: new_customer | renew | upgrade. */
export async function manualRenew(opts: {
  clientId: string;
  planId: string;
  paidDate: string;
  remark?: "new_customer" | "renew" | "upgrade";
}): Promise<{ ok: boolean; pricingplanlogId?: string; bukkuInvoiceId?: number; reason?: string }> {
  const data = await post<{
    ok?: boolean;
    reason?: string;
    pricingplanlogId?: string;
    bukkuInvoiceId?: number;
  }>("billing/indoor-admin/manual-renew", {
    clientId: opts.clientId,
    planId: opts.planId,
    paidDate: opts.paidDate,
    remark: opts.remark ?? undefined,
  });
  if (data?.ok === false) throw new Error(data.reason || "Manual renew failed");
  return {
    ok: true,
    pricingplanlogId: data?.pricingplanlogId,
    bukkuInvoiceId: data?.bukkuInvoiceId,
  };
}

/** SAAS Enquiry (operator enquiry from portal/enquiry page) – operatordetail status=0 + client_profile. */
export interface SaasEnquiry {
  id: string;
  title: string;
  email: string;
  contact: string;
  currency: string;
  accountNumber: string;
  bankId: string;
  profilePhoto: string;
  createdAt?: string;
  remark?: string;
  numberOfUnits?: string;
  planOfInterest?: string;
  /** Set when admin clicks Acknowledge (migration 0114). Tab count = unacknowledged only. */
  acknowledgedAt?: string | null;
}

/** POST billing/indoor-admin/enquiries – list SAAS enquiries for Enquiry tab. */
export async function getSaasEnquiries(): Promise<{ ok: boolean; items?: SaasEnquiry[]; reason?: string }> {
  const data = await post<{ ok?: boolean; items?: SaasEnquiry[]; reason?: string }>(
    "billing/indoor-admin/enquiries",
    {}
  );
  if (data?.ok === false) throw new Error(data.reason || "Failed to load enquiries");
  return { ok: true, items: Array.isArray(data?.items) ? data.items : [] };
}

/** Management Enquiry (owner enquiry from portal/ownerenquiry page) – owner_enquiry table. */
export interface OwnerEnquiry {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  units: string;
  message: string;
  country: string;
  currency: string;
  createdAt?: string;
  acknowledgedAt?: string | null;
}

/** POST billing/indoor-admin/owner-enquiries – list Management enquiries for Enquiry tab. */
export async function getOwnerEnquiries(): Promise<{ ok: boolean; items?: OwnerEnquiry[]; reason?: string }> {
  const data = await post<{ ok?: boolean; items?: OwnerEnquiry[]; reason?: string }>(
    "billing/indoor-admin/owner-enquiries",
    {}
  );
  if (data?.ok === false) throw new Error(data.reason || "Failed to load owner enquiries");
  return { ok: true, items: Array.isArray(data?.items) ? data.items : [] };
}

/** POST billing/indoor-admin/enquiries/acknowledge – mark SAAS enquiry as acknowledged. Tab count decreases. */
export async function acknowledgeSaasEnquiry(clientId: string): Promise<{ ok: boolean; affected?: number; reason?: string }> {
  const data = await post<{ ok?: boolean; affected?: number; reason?: string }>(
    "billing/indoor-admin/enquiries/acknowledge",
    { clientId }
  );
  if (data?.ok === false) throw new Error(data.reason || "Failed to acknowledge");
  return { ok: true, affected: data?.affected };
}

/** POST billing/indoor-admin/owner-enquiries/acknowledge – mark Management enquiry as acknowledged. */
export async function acknowledgeOwnerEnquiry(id: string): Promise<{ ok: boolean; affected?: number; reason?: string }> {
  const data = await post<{ ok?: boolean; affected?: number; reason?: string }>(
    "billing/indoor-admin/owner-enquiries/acknowledge",
    { id }
  );
  if (data?.ok === false) throw new Error(data.reason || "Failed to acknowledge");
  return { ok: true, affected: data?.affected };
}

/** POST billing/indoor-admin/owner-enquiries/delete – permanently delete one Management enquiry row. */
export async function deleteOwnerEnquiry(id: string): Promise<{ ok: boolean; affected?: number }> {
  const data = await post<{ ok?: boolean; affected?: number; reason?: string }>(
    "billing/indoor-admin/owner-enquiries/delete",
    { id }
  );
  if (data?.ok === false) throw new Error(data.reason || "Failed to delete");
  return { ok: true, affected: data?.affected };
}

/** POST billing/indoor-admin/credit-used-stats – this month total + by month (last 12) for dashboard graph. */
export async function getCreditUsedStats(): Promise<{
  thisMonth: number;
  byMonth: Array<{ month: string; total: number }>;
}> {
  const data = await post<{ ok?: boolean; thisMonth?: number; byMonth?: Array<{ month: string; total: number }>; reason?: string }>(
    "billing/indoor-admin/credit-used-stats",
    {}
  );
  if (data?.ok === false) throw new Error(data.reason || "Failed to load stats");
  return {
    thisMonth: Number(data?.thisMonth ?? 0) || 0,
    byMonth: Array.isArray(data?.byMonth) ? data.byMonth : [],
  };
}

/** POST billing/indoor-admin/save-cnyiot-sales-user – save CNYIOT sales user id for client. */
export async function saveCnyiotSalesUser(opts: {
  clientId: string;
  cnyiotUserId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const data = await post<{ ok?: boolean; reason?: string }>(
    "billing/indoor-admin/save-cnyiot-sales-user",
    { clientId: opts.clientId, cnyiotUserId: opts.cnyiotUserId }
  );
  if (data?.ok === false) throw new Error(data.reason || "Save failed");
  return { ok: true };
}

/** API Docs access – users who can log in to /docs (username + password). */

export interface ApiDocsUser {
  id: string;
  username: string;
  token?: string;
  status?: number;
  can_access_docs?: number | boolean;
  client_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** POST billing/indoor-admin/api-docs-users – list API users (for docs access management). */
export async function getApiDocsUsers(): Promise<{ ok: boolean; items?: ApiDocsUser[]; reason?: string }> {
  const data = await post<{ ok?: boolean; items?: ApiDocsUser[]; reason?: string }>(
    "billing/indoor-admin/api-docs-users",
    {}
  );
  if (data?.ok === false) throw new Error(data.reason || "Failed to load API docs users");
  return { ok: true, items: Array.isArray(data?.items) ? data.items : [] };
}

/** POST billing/indoor-admin/api-docs-users/create – create API docs user for client (auto-generated username & password). Returns plainPassword once. */
export async function createApiDocsUserForClient(clientId: string): Promise<{
  ok: boolean;
  user?: ApiDocsUser & { plainPassword?: string };
  plainPassword?: string;
  reason?: string;
}> {
  const data = await post<{ ok?: boolean; user?: ApiDocsUser; plainPassword?: string; reason?: string }>(
    "billing/indoor-admin/api-docs-users/create",
    { clientId }
  );
  if (data?.ok === false) throw new Error(data.reason || "Create failed");
  return { ok: true, user: data?.user, plainPassword: data?.plainPassword };
}

/** POST billing/indoor-admin/api-docs-users/:id/can-access-docs – set can_access_docs. */
export async function setApiDocsUserCanAccess(id: string, canAccessDocs: boolean): Promise<{ ok: boolean; user?: ApiDocsUser; reason?: string }> {
  const data = await post<{ ok?: boolean; user?: ApiDocsUser; reason?: string }>(
    `billing/indoor-admin/api-docs-users/${id}/can-access-docs`,
    { can_access_docs: canAccessDocs }
  );
  if (data?.ok === false) throw new Error(data.reason || "Update failed");
  return { ok: true, user: data?.user };
}

export interface ProcessingFeeTransaction {
  id: string;
  clientId: string;
  clientTitle: string;
  type: "topup" | "invoice";
  serviceProvider: "stripe" | "xendit" | "billplz";
  /** settlement = operator bank payout recorded (Billplz/Xendit) or Stripe tenant payment + SaaS fee logged; pending = payout not yet paid; failed = payout failed */
  status: "settlement" | "pending" | "failed";
  processingFee: number;
  deductedCredits?: number;
  paymentAmount?: number;
  currency?: string;
  createdAt?: string;
  referenceNumber?: string;
  /** When payout_status became paid (operator bank), if known */
  payoutAt?: string | null;
  details?: {
    tenantName?: string;
    propertyName?: string;
    roomName?: string;
    tenancyId?: string;
    paymentId?: string;
  };
}

export type ProcessingFeeTransactionsSummary = {
  settlementTotal: number;
  pendingTotal: number;
  allTotal: number;
};

export async function getProcessingFeeTransactions(opts: {
  dateFrom: string;
  dateTo: string;
  search?: string;
  currency?: "all" | "MYR" | "SGD";
  sort?: "date_desc" | "date_asc" | "fee_desc" | "fee_asc" | "client_asc" | "client_desc";
  page?: number;
  pageSize?: 10 | 20 | 50 | 100 | 200;
}): Promise<{
  ok: boolean;
  items?: ProcessingFeeTransaction[];
  total?: number;
  page?: number;
  pageSize?: number;
  summary?: ProcessingFeeTransactionsSummary;
  reason?: string;
}> {
  const data = await post<{
    ok?: boolean;
    items?: ProcessingFeeTransaction[];
    total?: number;
    page?: number;
    pageSize?: number;
    summary?: ProcessingFeeTransactionsSummary;
    reason?: string;
  }>("billing/indoor-admin/processing-fees", {
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    search: opts.search || "",
    currency: opts.currency || "all",
    sort: opts.sort || "date_desc",
    page: opts.page ?? 1,
    pageSize: opts.pageSize ?? 20,
  });
  if (data?.ok === false) throw new Error(data.reason || "Failed to load processing fee transactions");
  return {
    ok: true,
    items: Array.isArray(data?.items) ? data.items : [],
    total: typeof data?.total === "number" ? data.total : 0,
    page: typeof data?.page === "number" ? data.page : 1,
    pageSize: typeof data?.pageSize === "number" ? data.pageSize : 20,
    summary: data?.summary,
  };
}

export interface SaasAdminMeter {
  id: string;
  meterId: string;
  title: string;
  mode: string;
  rate: number;
  balance: number;
  status: boolean;
  isOnline: boolean;
  operatorId: string;
  operatorTitle: string;
  propertyId?: string | null;
  propertyTitle?: string;
  roomId?: string | null;
  roomTitle?: string;
  updatedAt?: string | null;
}

export async function getSaasAdminMeters(opts: {
  search?: string;
  operatorId?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  ok: boolean;
  items?: SaasAdminMeter[];
  total?: number;
  page?: number;
  pageSize?: number;
  reason?: string;
}> {
  const data = await post<{
    ok?: boolean;
    items?: SaasAdminMeter[];
    total?: number;
    page?: number;
    pageSize?: number;
    reason?: string;
  }>('billing/indoor-admin/meters', {
    search: opts.search || '',
    operatorId: opts.operatorId || '',
    page: opts.page ?? 1,
    pageSize: opts.pageSize ?? 50
  });
  if (data?.ok === false) throw new Error(data.reason || 'Failed to load meters');
  return {
    ok: true,
    items: Array.isArray(data?.items) ? data.items : [],
    total: typeof data?.total === 'number' ? data.total : 0,
    page: typeof data?.page === 'number' ? data.page : 1,
    pageSize: typeof data?.pageSize === 'number' ? data.pageSize : 50
  };
}

export async function moveMeterToOperator(opts: {
  meterId: string;
  toOperatorId: string;
}): Promise<{
  ok: boolean;
  meter?: {
    id: string;
    meterId: string;
    title: string;
    fromOperatorId: string;
    toOperatorId: string;
    toOperatorTitle: string;
  };
  reason?: string;
}> {
  const data = await post<{
    ok?: boolean;
    meter?: {
      id: string;
      meterId: string;
      title: string;
      fromOperatorId: string;
      toOperatorId: string;
      toOperatorTitle: string;
    };
    reason?: string;
  }>('billing/indoor-admin/meters/move', {
    meterId: opts.meterId,
    toOperatorId: opts.toOperatorId
  });
  if (data?.ok === false) throw new Error(data.reason || 'Failed to move meter');
  return { ok: true, meter: data?.meter };
}

export interface SaasAdminProperty {
  id: string;
  shortname: string;
  apartmentname: string;
  address: string;
  operatorId: string;
  operatorTitle: string;
  roomCount: number;
  meterId: string | null;
  updatedAt?: string | null;
}

export async function getSaasAdminProperties(opts: {
  search?: string;
  operatorId?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  ok: boolean;
  items?: SaasAdminProperty[];
  total?: number;
  page?: number;
  pageSize?: number;
  reason?: string;
}> {
  const data = await post<{
    ok?: boolean;
    items?: SaasAdminProperty[];
    total?: number;
    page?: number;
    pageSize?: number;
    reason?: string;
  }>('billing/indoor-admin/properties', {
    search: opts.search || '',
    operatorId: opts.operatorId || '',
    page: opts.page ?? 1,
    pageSize: opts.pageSize ?? 50
  });
  if (data?.ok === false) throw new Error(data.reason || 'Failed to load properties');
  return {
    ok: true,
    items: Array.isArray(data?.items) ? data.items : [],
    total: typeof data?.total === 'number' ? data.total : 0,
    page: typeof data?.page === 'number' ? data.page : 1,
    pageSize: typeof data?.pageSize === 'number' ? data.pageSize : 50
  };
}

export async function movePropertyToOperator(opts: {
  propertyId: string;
  toOperatorId: string;
}): Promise<{
  ok: boolean;
  property?: {
    id: string;
    shortname: string;
    fromOperatorId: string;
    toOperatorId: string;
    toOperatorTitle: string;
    roomCount: number;
  };
  reason?: string;
}> {
  const data = await post<{
    ok?: boolean;
    property?: {
      id: string;
      shortname: string;
      fromOperatorId: string;
      toOperatorId: string;
      toOperatorTitle: string;
      roomCount: number;
    };
    reason?: string;
  }>('billing/indoor-admin/properties/move', {
    propertyId: opts.propertyId,
    toOperatorId: opts.toOperatorId
  });
  if (data?.ok === false) throw new Error(data.reason || 'Failed to move property');
  return { ok: true, property: data?.property };
}
