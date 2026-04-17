/**
 * Portal API client – calls ECS via Next proxy (/api/portal/proxy/*) so API token stays server-side.
 * On demo.colivingjb.com we skip real API calls (return mock or empty).
 */

import { PORTAL_KEYS } from "./portal-session";

export type MemberRoleType = "staff" | "tenant" | "owner" | "saas_admin";

export interface MemberRole {
  type: MemberRoleType;
  staffId?: string;
  clientId?: string;
  clientTitle?: string;
  tenantId?: string;
  ownerId?: string;
}

export interface MemberRolesResponse {
  ok: boolean;
  email?: string;
  roles?: MemberRole[];
  /** true when email exists in staffdetail/tenantdetail/ownerdetail/operatordetail */
  registered?: boolean;
  reason?: string;
  message?: string;
}

export interface AccessContextResponse {
  ok: boolean;
  reason?: string;
  staff?: {
    id: string;
    email: string;
    name?: string | null;
    /** Operator personal avatar URL (not company logo). */
    profilephoto?: string | null;
    permission: Record<string, boolean>;
  };
  client?: { id: string; title: string; currency?: string };
  plan?: { mainPlan?: unknown; addons?: unknown[] };
  capability?: Record<string, unknown>;
  credit?: { ok: boolean; balance: number };
  expired?: { isExpired: boolean; expiredAt?: string };
}

export function isDemoSite(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "demo.colivingjb.com";
}

function canUseBackendOnDemoPath(pathname: string): boolean {
  const p = String(pathname || "/");
  return (
    p === "/saas-admin" ||
    p.startsWith("/saas-admin/") ||
    p === "/docs" ||
    p.startsWith("/docs/") ||
    p === "/demoprofile" ||
    p.startsWith("/demoprofile/")
  );
}

export function shouldUseDemoMock(): boolean {
  if (typeof window === "undefined") return false;
  if (!isDemoSite()) return false;
  return !canUseBackendOnDemoPath(window.location.pathname || "/");
}

/** Helper: dates relative to "today" so demo data stays up-to-date (screenshots, tenancy end, due dates). */
function getDemoDates() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const todayYMD = `${y}-${m}-${day}`;
  const thisMonth = `${y}-${m}`;
  const addMonths = (ymd: string, delta: number) => {
    const [yy, mm, dd] = ymd.split("-").map(Number);
    const x = new Date(yy, mm - 1, dd);
    x.setMonth(x.getMonth() + delta);
    const y1 = x.getFullYear();
    const m1 = String(x.getMonth() + 1).padStart(2, "0");
    const d1 = String(x.getDate()).padStart(2, "0");
    return `${y1}-${m1}-${d1}`;
  };
  const nextMonth = new Date(y, d.getMonth() + 1, 1);
  const nextMonthStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;
  const due5thThis = `${y}-${m}-05`;
  const due5thNext = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-05`;
  const monthAgo3 = addMonths(todayYMD, -3);
  const monthLater6 = addMonths(todayYMD, 6);
  const monthAgo12 = addMonths(todayYMD, -12);
  const twoWeeksAgo = new Date(d);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const endTwoWeeksAgo = `${twoWeeksAgo.getFullYear()}-${String(twoWeeksAgo.getMonth() + 1).padStart(2, "0")}-${String(twoWeeksAgo.getDate()).padStart(2, "0")}`;
  const monthLabel = (ym: string) => {
    const [yy, mm] = ym.split("-").map(Number);
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${names[mm - 1]} ${yy}`;
  };
  return {
    todayYMD,
    thisMonth,
    nextMonthStr,
    due5thThis,
    due5thNext,
    monthAgo3,
    monthLater6,
    monthAgo12,
    endTwoWeeksAgo,
    monthLabel,
  };
}

/** Mock responses for demo.colivingjb.com – no backend connection; any user can "log in". */
function getDemoMock(path: string, body: object): unknown {
  const b = body as Record<string, unknown>;
  const email = (b.email as string) || "demo@demo.com";
  const clientId = (b.clientId as string) || "demo-client";
  const dates = getDemoDates();
  if (path === "access/member-roles") {
    return {
      ok: true,
      email: email.trim(),
      roles: [
        { type: "staff", staffId: "demo-staff", clientId: "demo-client", clientTitle: "Demo Client" },
        { type: "tenant", tenantId: "demo-tenant", clientId: "demo-client" },
        { type: "owner", ownerId: "demo-owner", clientId: "demo-client" },
      ],
      registered: true,
    };
  }
  if (path === "access/context" || path === "access/context/with-client") {
    return {
      ok: true,
      staff: {
        id: "demo-staff",
        email: email.trim(),
        permission: {
          admin: true,
          profilesetting: true,
          usersetting: true,
          integration: true,
          billing: true,
          finance: true,
          tenantdetail: true,
          propertylisting: true,
          marketing: true,
          booking: true,
        },
      },
      client: { id: clientId, title: "Demo Client", currency: "MYR" },
      plan: {
        mainPlan: { id: "enterprise-plus", title: "Enterprise Plus" },
        addons: [{ id: "accounting", title: "Accounting" }, { id: "api_docs", title: "API Docs" }],
      },
      capability: {
        accounting: true,
        thirdPartyIntegration: true,
        cleanlemonsPartner: true,
        apiDocs: true,
      },
      credit: { ok: true, balance: 99999 },
    };
  }
  if (path === "billing/my-info") {
    return { noPermission: false, credit: [{ type: "flex", amount: 99999 }], currency: "MYR", title: "Demo Client" };
  }
  if (path === "companysetting/onboard-status") {
    return {
      ok: true,
      accountingConnected: true,
      accountingProvider: "bukku",
      cnyiotConnected: true,
      stripeConnected: true,
      payexConfigured: true,
      ttlockConnected: true,
    };
  }
  if (path === "account/list") {
    return {
      ok: true,
      items: [
        { _id: "acc-1", id: "acc-1", title: "Rental Income", type: "income", _myAccount: { accountid: "4000", system: "bukku" } },
        { _id: "acc-2", id: "acc-2", title: "Security Deposit", type: "liability", _myAccount: { accountid: "2000", system: "bukku" } },
        { _id: "acc-3", id: "acc-3", title: "Utilities Expense", type: "expenses", _myAccount: { accountid: "5001", system: "bukku" } },
        { _id: "acc-4", id: "acc-4", title: "Maintenance Expense", type: "expenses", _myAccount: { accountid: "5002", system: "bukku" } },
        { _id: "acc-5", id: "acc-5", title: "Bank Account", type: "asset", _myAccount: { accountid: "1000", system: "bukku" } },
      ],
    };
  }
  if (path === "account/save") {
    return { ok: true };
  }
  if (path === "account/sync") {
    return { ok: true, createdAccounts: 2, linkedAccounts: 5 };
  }
  if (path === "companysetting/profile") {
    return { ok: true, client: { title: "Demo Client", currency: "MYR" }, profile: { title: "Demo Client" } };
  }
  // ─── Demo default items: 5–10 items per list (property, room, meter, smartdoor, agreement, tenancy, invoice, expenses, refund) ───
  const demoPropertyNames = ["Demo Property", "Sunrise Tower", "Green Residence", "Lake View", "City Central", "Park Avenue", "Riverside", "Hilltop"];
  const demoPropertyList = {
    ok: true,
    items: demoPropertyNames.map((name, i) => {
      const id = i === 0 ? "p1" : i === 1 ? "p2" : `p${i + 1}`;
      return { _id: id, id, shortname: name, unitNumber: "", apartmentName: name, address: `${100 + i} Demo Street`, active: true };
    }),
    total: 8,
    totalPages: 1,
    currentPage: 1,
  };
  const demoRoomList = {
    ok: true,
    items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
      const id = `r${n}`;
      const propId = n <= 5 ? "p1" : "p2";
      const propName = n <= 5 ? "Demo Property" : "Sunrise Tower";
      return {
        _id: id, id, roomName: `Room ${100 + n}`, title_fld: `Room ${100 + n}`,
        propertyId: propId, property: { shortname: propName, _id: propId },
        active: true, available: n > 7, meter: n <= 6 ? `m${n}` : null, smartdoor: n <= 5 ? `lock${n}` : null, hasActiveTenancy: n <= 7,
      };
    }),
    total: 10,
    totalPages: 1,
    currentPage: 1,
  };
  const demoMeterList = {
    ok: true,
    items: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
      _id: `m${n}`, id: `m${n}`, meterId: `1234567890${n}`, title: `Meter ${100 + n}`, meterType: "parent",
      room: `r${n}`, roomTitle: `Room ${100 + n}`, property: "p1", propertyShortname: "Demo Property", status: true,
    })),
    total: 8,
    totalPages: 1,
    currentPage: 1,
  };
  const demoSmartDoorList = {
    ok: true,
    items: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
      _id: `lock${n}`, __type: "lock", lockId: 1000 + n, lockAlias: `Room ${100 + n} Lock`, electricQuantity: 85 - n * 2, isOnline: n <= 6, active: true,
    })),
    total: 8,
    totalPages: 1,
    currentPage: 1,
  };
  const demoAgreementTemplates = ["Standard Tenancy", "Short-term Lease", "Room Share", "Studio Agreement", "Deposit Terms", "Renewal Addendum", "Termination"];
  const demoAgreementTemplateList = {
    ok: true,
    items: demoAgreementTemplates.map((title, i) => ({ _id: `t${i + 1}`, id: `t${i + 1}`, title, mode: "tenancy" })),
    total: 7,
    totalPages: 1,
    currentPage: 1,
  };
  const demoTenantNames = ["Alex Tan", "Sarah Lee", "Wei Chen", "Priya Kumar", "James Lim", "Nurul Hassan", "Emily Wong", "Raj Patel", "Siti Aminah", "David Ng"];
  const demoContactList = demoTenantNames.map((name, i) => ({
    _id: `demo-tenant-${i + 1}`, fullname: name, email: `${name.toLowerCase().replace(/\s/g, "")}@demo.com`, phone: `012345678${i}`, type: "tenant",
  }));
  // Agreement status for operator Agreements page: completed → signed; pending/ready_for_signature → pending_tenant; locked → pending_owner
  const demoTenancyList = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
    const agStatus = n <= 2 ? "completed" : n <= 4 ? "ready_for_signature" : n <= 6 ? "pending" : "locked";
    return {
      _id: `demo-tenancy-${n}`,
      id: `demo-tenancy-${n}`,
      title: "Tenancy",
      begin: dates.monthAgo3,
      end: dates.monthLater6,
      rental: 1100 + n * 50,
      deposit: 1100,
      room: { _id: `r${n}`, roomname: `Room ${100 + n}`, title_fld: `Room ${100 + n}` },
      property: { _id: "p1", shortname: "Demo Property" },
      tenant: {
        _id: `demo-tenant-${n}`,
        id: `demo-tenant-${n}`,
        fullname: demoTenantNames[n - 1],
        email: `${demoTenantNames[n - 1].toLowerCase().replace(/\s/g, "")}@demo.com`,
        phone: `+65 9000 ${1000 + n}`,
        bankName: n % 2 === 0 ? "DBS" : "OCBC",
        bankAccount: `****${1000 + n}`,
        accountHolder: demoTenantNames[n - 1],
      },
      status: n <= 6 ? "active" : "ended",
      agreements: [
        { _id: `demo-agr-${n}`, status: agStatus, url: "#", _createdDate: dates.todayYMD, mode: "tenancy" },
        ...(n <= 4 ? [{ _id: `demo-agr-${n}-2`, status: n <= 2 ? "completed" : "locked", url: "#", _createdDate: dates.todayYMD, mode: "renewal" }] : []),
      ],
    };
  });
  const demoInvoiceList = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
    _id: `inv-${n}`,
    title: n <= 3 ? `Rent ${dates.monthLabel(dates.thisMonth)}` : n <= 6 ? `Utilities ${dates.monthLabel(dates.thisMonth)}` : "Deposit",
    dueDate: dates.due5thThis, amount: n <= 3 ? 1200 : n <= 6 ? 80 + n * 5 : 1200, isPaid: n % 2 === 1,
    property: { shortname: n <= 5 ? "Demo Property" : "Sunrise Tower" },
  }));
  const demoExpensesList = [1, 2, 3, 4, 5, 6, 7, 8].map((n, i) => ({
    _id: `e${n}`, amount: [450, 80, 120, 200, 65, 90, 310, 55][i], description: ["Electricity", "Water", "Internet", "Management", "Sewage", "Cleaning", "Repair", "Misc"][i] + ` ${dates.monthLabel(dates.thisMonth)}`,
    period: dates.thisMonth, property: { shortname: "Demo Property" }, ispaid: i % 2 === 0,
  }));

  if (path === "propertysetting/list") return demoPropertyList;
  if (path === "propertysetting/filters") {
    return { ok: true, properties: demoPropertyNames.map((label, i) => ({ value: i === 0 ? "p1" : i === 1 ? "p2" : `p${i + 1}`, label })), services: [{ label: "All", value: "ALL" }, { label: "Active only", value: "ACTIVE_ONLY" }, { label: "Inactive only", value: "INACTIVE_ONLY" }] };
  }
  if (path === "propertysetting/get") {
    const id = (b.propertyId as string) || "p1";
    const idx = id === "p1" ? 0 : id === "p2" ? 1 : parseInt(id.replace("p", ""), 10) - 1;
    return { ok: true, property: { _id: id, id, shortname: demoPropertyNames[idx] ?? id, address: `${100 + (idx >= 0 ? idx : 0)} Demo Street`, active: true } };
  }
  if (path === "roomsetting/list") return demoRoomList;
  if (path === "roomsetting/filters") {
    return { ok: true, properties: demoPropertyNames.slice(0, 2).map((label, i) => ({ value: i === 0 ? "p1" : "p2", label })), services: [{ label: "All", value: "ALL" }, { label: "Active only", value: "ACTIVE_ONLY" }] };
  }
  if (path === "roomsetting/get") {
    const id = (b.roomId as string) || "r1";
    const num = parseInt(id.replace("r", ""), 10) || 1;
    return { ok: true, room: { _id: id, id, roomName: `Room ${100 + num}`, title_fld: `Room ${100 + num}`, propertyId: num <= 5 ? "p1" : "p2", property: { shortname: num <= 5 ? "Demo Property" : "Sunrise Tower", _id: num <= 5 ? "p1" : "p2" }, active: true } };
  }
  if (path === "roomsetting/active-room-count") return { ok: true, activeRoomCount: 10 };
  if (path === "roomsetting/meter-options") return { ok: true, options: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ label: `Meter ${100 + n}`, value: `m${n}` })) };
  if (path === "roomsetting/smartdoor-options") return { ok: true, options: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ label: `Room ${100 + n} Lock`, value: `lock${n}` })) };
  if (path === "metersetting/list") return demoMeterList;
  if (path === "metersetting/filters") {
    return { ok: true, properties: [{ value: "p1", label: "Demo Property" }, { value: "p2", label: "Sunrise Tower" }], services: [] };
  }
  if (path === "smartdoorsetting/list") return demoSmartDoorList;
  if (path === "smartdoorsetting/sync-status-from-ttlock" || path === "smartdoorsetting/sync-locks-from-ttlock") {
    return { ok: true, lockCount: 8, gatewayCount: 2 };
  }
  if (path === "smartdoorsetting/sync-single-lock-from-ttlock") {
    return { ok: true, lock: { _id: (b as { id?: string }).id, electricQuantity: 88 } };
  }
  if (path === "smartdoorsetting/sync-single-gateway-from-ttlock") {
    return { ok: true, gateway: { _id: (b as { id?: string }).id, isOnline: true } };
  }
  if (path === "smartdoorsetting/filters") {
    return { ok: true, properties: [{ value: "p1", label: "Demo Property" }, { value: "p2", label: "Sunrise Tower" }] };
  }
  if (path === "agreementsetting/list") return demoAgreementTemplateList;
  if (path === "tenantinvoice/properties") return { ok: true, items: demoPropertyList.items.slice(0, 8) };
  if (path === "tenantinvoice/tenancy-list") {
    return { ok: true, items: demoTenancyList.map((t) => ({ ...t, room: { roomname: t.room.roomname }, property: { shortname: t.property.shortname }, tenant: { fullname: t.tenant.fullname } })) };
  }
  if (path === "tenantinvoice/types") return { ok: true, items: [{ value: "rent", label: "Rent" }, { value: "utility", label: "Utility" }, { value: "deposit", label: "Deposit" }] };
  if (path === "admindashboard/tenancy-list") {
    return { ok: true, items: demoTenancyList.map((t) => ({ ...t, room: { ...t.room, _id: t.room._id }, tenant: { ...t.tenant, _id: t.tenant._id } })), total: 8 };
  }
  if (path === "tenancysetting/agreement-templates") {
    return demoAgreementTemplates.map((title, i) => ({ id: `t${i + 1}`, _id: `t${i + 1}`, title, mode: (b.mode as string) || "tenancy" }));
  }
  if (path === "contact/list") {
    const typeFilter = (b.type as string) || "";
    if (typeFilter.toLowerCase() === "staff") {
      return { ok: true, items: [], total: 0 };
    }
    return { ok: true, items: demoContactList, total: 10 };
  }
  if (path === "booking/available-rooms") {
    return { ok: true, items: demoRoomList.items.map((r) => ({ _id: r.id, title_fld: r.roomName, value: r.id, label: r.roomName })) };
  }
  if (path === "booking/search-tenants") {
    return {
      ok: true,
      items: demoContactList.map((c, i) => ({
        ...c,
        value: c._id,
        profileScore: i < 8 ? Number((8.2 + (i % 4) * 0.2).toFixed(1)) : null,
        isNew: i >= 8,
      })),
    };
  }
  if (path === "booking/tenant") {
    const tenantId = String((b.tenantId as string) || "demo-tenant-1");
    const idx = Math.max(0, demoContactList.findIndex((x) => x._id === tenantId));
    const c = demoContactList[idx] || demoContactList[0];
    return {
      ok: true,
      tenant: {
        _id: c._id,
        fullname: c.fullname,
        email: c.email,
        phone: c.phone,
        profileScore: idx < 8 ? Number((8.2 + (idx % 4) * 0.2).toFixed(1)) : null,
        isNew: idx >= 8,
      },
    };
  }
  if (path === "booking/lookup-tenant") {
    const te = String((b.tenantEmail as string) || "").trim().toLowerCase();
    if (!te.includes("@")) return { ok: true, hasValidEmail: false };
    const idx = demoContactList.findIndex((x) => String(x.email || "").toLowerCase() === te);
    if (idx < 0) {
      return {
        ok: true,
        hasValidEmail: true,
        hasRecord: false,
        tenantId: null,
        fullname: null,
        approvedForClient: false,
        hasActiveTenancy: false,
        hasPastTenancy: false,
        reviewCount: 0,
        averageOverallScore: null,
        latestReview: null,
      };
    }
    const c = demoContactList[idx];
    const score = Number((8.2 + (idx % 4) * 0.2).toFixed(1));
    return {
      ok: true,
      hasValidEmail: true,
      hasRecord: true,
      tenantId: c._id,
      fullname: c.fullname,
      email: c.email,
      phone: c.phone,
      approvedForClient: true,
      hasActiveTenancy: idx === 0,
      hasPastTenancy: idx > 2,
      reviewCount: 2,
      averageOverallScore: score,
      latestReview: {
        overallScore: score,
        paymentScoreFinal: 8,
        unitCareScore: 8,
        communicationScore: 8,
        createdAt: new Date().toISOString(),
      },
    };
  }
  if (path === "generatereport/properties") return { ok: true, items: demoPropertyList.items };
  if (path === "agreementsetting/get") {
    const id = (b.id as string) || "t1";
    const idx = parseInt(id.replace("t", ""), 10) || 1;
    const title = demoAgreementTemplates[idx - 1] ?? "Standard Tenancy Agreement";
    return { ok: true, template: { _id: id, id, title, mode: "tenancy" } };
  }
  if (path === "tenancysetting/rooms-for-change") return { ok: true, items: demoRoomList.items.slice(1, 10) };
  if (path === "tenantinvoice/meter-groups") return { ok: true, items: [] };
  if (path === "booking/room") {
    const roomId = (b.roomId as string) || "r1";
    return { ok: true, room: { _id: roomId, price: 1200, rental: 1200, property_id: "p1", property: { _id: "p1" } } };
  }
  // Owner portal: owner (by email) – approvalpending 5–10 items so Approval has pending requests
  if (path === "ownerportal/owner") {
    const approvalPending = [
      { propertyId: "p1", clientId: "demo-client", clientName: "Demo Client", propertyShortname: "Demo Property", title: "Operator request to add you to property" },
      { propertyId: "p2", clientId: "demo-client", clientName: "Demo Client", propertyShortname: "Sunrise Tower", title: "Request to link Sunrise Tower" },
      { propertyId: "p3", clientId: "demo-client", clientName: "Demo Client", propertyShortname: "Green Residence", title: "Request to link Green Residence" },
      { propertyId: "p4", clientId: "demo-client", clientName: "Demo Client", propertyShortname: "Lake View", title: "Request to link Lake View" },
      { propertyId: "p5", clientId: "demo-client", clientName: "Demo Client", propertyShortname: "City Central", title: "Request to link City Central" },
    ];
    return {
      ok: true,
      owner: {
        _id: "demo-owner",
        ownerName: "Demo Owner",
        property: ["p1", "p2"],
        email: email.trim(),
        approvalpending: approvalPending,
      },
    };
  }
  // Owner portal: load-cms-data – 5–10 properties, rooms, tenancies
  if (path === "ownerportal/load-cms-data") {
    const ownerTenancies = demoTenancyList.map((t) => ({
      _id: t.id, room: t.room._id, begin: t.begin, end: t.end, rental: t.rental, tenant: { fullname: t.tenant.fullname }, property: { _id: t.property._id, shortname: t.property.shortname },
    }));
    return {
      ok: true,
      owner: { _id: "demo-owner", ownerName: "Demo Owner", property: ["p1", "p2"] },
      properties: demoPropertyList.items.slice(0, 8),
      rooms: demoRoomList.items.map((r) => ({ _id: r.id, property: r.propertyId, roomname: r.roomName })),
      tenancies: ownerTenancies,
    };
  }
  // Owner portal: agreement-list – 5–10 items
  if (path === "ownerportal/agreement-list") {
    const agreementItems = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
      _id: `demo-agr-${n}`, agreementid: `demo-agr-${n}`, tenancyid: `demo-tenancy-${n}`, propertyid: "p1",
      status: n <= 5 ? "completed" : "pending", property: { shortname: "Demo Property" },
      agreement: { _id: `demo-agr-${n}`, pdfurl: "#", agreementtemplate: "t1" },
    }));
    return { ok: true, items: agreementItems };
  }
  // Owner portal: owner-payout-list – 5–10 months
  if (path === "ownerportal/owner-payout-list") {
    const months = [dates.thisMonth, dates.nextMonthStr, dates.monthLabel(dates.monthAgo3), dates.monthLabel(dates.monthAgo12)].map((period, i) => ({
      period, totalrental: 2400 - i * 100, totalutility: 170 - i * 10, totalcollection: 2400 - i * 200, expenses: 200 - i * 20, netpayout: 2030 - i * 150, monthlyreport: period,
    }));
    return { ok: true, items: months };
  }
  // Owner portal: cost-list – 5–10 expense rows
  if (path === "ownerportal/cost-list") {
    return { ok: true, items: demoExpensesList, totalCount: 8 };
  }
  // Owner portal: clients (operator dropdown)
  if (path === "ownerportal/clients") {
    return { ok: true, items: [{ _id: "demo-client", title: "Demo Client" }] };
  }
  // Property setting: suppliers (Contact setting suppliers) – so Edit utility dropdown has options on demo
  if (path === "propertysetting/suppliers") {
    return {
      options: [
        { value: "demo-tnb", label: "TNB" },
        { value: "demo-saj", label: "SAJ" },
        { value: "demo-wifi", label: "TIME" },
        { value: "demo-mgmt", label: "Management" },
      ],
    };
  }
  // Tenant portal: init – mock tenant so demo tenant pages don’t redirect to profile
  if (path === "tenantdashboard/init") {
    const em = (b.email as string) || "demo@demo.com";
    const demoTenancies = [
      {
        _id: "demo-tenancy-1",
        id: "demo-tenancy-1",
        begin: dates.monthAgo3,
        end: dates.monthLater6,
        rental: 1200,
        client: { _id: "demo-client", title: "Demo Client", currency: "MYR" },
        room: {
          _id: "demo-room-1",
          id: "demo-room-1",
          roomname: "Room 101",
          title_fld: "Room 101",
          hasMeter: true,
          hasSmartDoor: true,
        },
        property: {
          _id: "demo-property-1",
          shortname: "Demo Property",
          hasSmartDoor: true,
        },
        tenant: { fullname: "Demo User" },
        agreements: [{ _id: "demo-agr-1", tenantsign: "", url: "#", agreementtemplate_id: "t1" }],
        handoverScheduleWindow: { start: "10:00", end: "19:00", source: "handoverWorkingHour" },
        hasCleaningOrder: true,
        cleaningTenantPriceMyr: 80,
      },
    ];
    return {
      ok: true,
      tenant: {
        _id: "demo-tenant",
        fullname: "Demo User",
        email: em.trim(),
        phone: "0123456789",
        address: "Demo Address",
        nric: "",
        profile: {
          payment_method_linked: true,
          rent_auto_debit_enabled: true,
        },
        approvalRequest: [
          { clientId: "demo-client", status: "pending" },
          { clientId: "demo-client-2", status: "pending" },
        ],
      },
      tenancies: demoTenancies,
      hasOverduePayment: false,
      requiresPaymentMethodLink: false,
    };
  }
  if (path === "tenantdashboard/cleaning-order") {
    return { ok: true, rentalcollectionId: "demo-rc-cleaning-" + Date.now() };
  }
  if (path === "tenantdashboard/cleaning-order-latest") {
    return { ok: true, item: null };
  }
  if (path === "tenantdashboard/clients-by-ids") {
    const ids = (b.clientIds as string[]) || [];
    const items = ids.map((id: string) => ({ _id: id, id, title: id === "demo-client" ? "Demo Client" : id === "demo-client-2" ? "Demo Company B" : "Operator" }));
    return { ok: true, items };
  }
  if (path === "tenantdashboard/rental-list") {
    return {
      ok: true,
      items: demoInvoiceList,
      tenantPaymentMethodPolicy: "flexible" as const,
      tenantRentAutoDebitOffered: true,
    };
  }
  if (path === "tenantdashboard/update-profile") {
    const profile = (b as { profile?: Record<string, unknown> }).profile;
    return {
      ok: true,
      tenant: {
        _id: "demo-tenant",
        profile: { payment_method_linked: true, rent_auto_debit_enabled: true, ...profile },
      },
    };
  }
  if (path === "tenantdashboard/create-payment-method-setup") {
    const bindType = (b as { bindType?: string }).bindType;
    const base = typeof window !== "undefined" ? window.location.origin : "";
    return {
      ok: true,
      type: "redirect" as const,
      url: `${base}/tenant/payment?xendit_setup=1${bindType === "bank_dd" ? "&bind=bank" : ""}`,
      provider: "payex",
    };
  }
  if (path === "tenantdashboard/handover-schedule") {
    return { ok: true };
  }
  if (path === "tenancysetting/list") {
    return { ok: true, items: demoTenancyList, total: 8, totalPages: 1, currentPage: 1 };
  }
  if (path === "tenancysetting/handover-schedule-log") {
    return { ok: true, items: [] };
  }
  if (path === "tenantinvoice/rental-list") {
    return { ok: true, items: demoInvoiceList, total: 9 };
  }
  if (path === "expenses/list") {
    return { ok: true, items: demoExpensesList, total: 8 };
  }
  // Operator Approval page: FEEDBACK (Feedback tab) + REFUND + PENDING_OPERATOR_AGREEMENT (approval pending)
  if (path === "admindashboard/list") {
    const feedbackItems = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
      _id: `fb${n}`,
      id: `fb${n}`,
      _type: "FEEDBACK",
      type: "feedback",
      description: ["Air-con not cold", "Window latch loose", "Water pressure low", "Light bulb replacement", "Door lock battery", "WiFi slow", "Ceiling leak", "Heater not working"][n - 1],
      room: { title_fld: `Room ${100 + n}` },
      tenant: { fullname: demoTenantNames[n - 1] },
      done: n > 5,
      remark: n > 5 ? "Resolved" : "",
    }));
    const refundItems = [1, 2, 3].map((n) => ({
      _id: `rf${n}`,
      _type: "REFUND",
      type: "refund",
      amount: 1200 - n * 50,
      room: `Room ${101 + n}`,
      tenant: demoTenantNames[n],
      done: false,
    }));
    const approvalPendingItems = [1, 2, 3, 4, 5].map((n) => ({
      _id: `ag-pending-${n}`,
      _type: "PENDING_OPERATOR_AGREEMENT",
      type: "PENDING_OPERATOR_AGREEMENT",
      room: `Room ${100 + n}`,
      tenant: demoTenantNames[n - 1],
      agreementId: `demo-agr-${n}`,
    }));
    return { ok: true, items: [...feedbackItems, ...refundItems, ...approvalPendingItems], total: 16 };
  }
  if (path === "billing/saas-stripe-fee-preview") {
    const subtotalMajor = Number((b as { subtotalMajor?: number }).subtotalMajor) || 0;
    const currency = String((b as { currency?: string }).currency || "MYR")
      .trim()
      .toUpperCase();
    const feePct = currency === "SGD" ? 10 : 0;
    const baseCents = Math.round(subtotalMajor * 100);
    const transactionFeeCents = Math.round((baseCents * feePct) / 100);
    const totalCents = baseCents + transactionFeeCents;
    return {
      ok: true,
      currency: currency === "SGD" ? "SGD" : "MYR",
      baseMajor: baseCents / 100,
      transactionFeeMajor: transactionFeeCents / 100,
      totalMajor: totalCents / 100,
      transactionFeePercent: feePct,
    };
  }
  if (path === "billing/statement-items") {
    const statementItems = [
      ...([1, 2, 3].map((n) => ({ _id: `s-topup-${n}`, type: "Topup", amount: 500 * n, created_at: dates.todayYMD, title: "Credit top-up" }))),
      ...([1, 2, 3, 4, 5, 6].map((n) => ({ _id: `s-spend-${n}`, type: "Spending", amount: -10 - n * 2, created_at: dates.todayYMD, title: "Active room fee" }))),
    ];
    return { ok: true, items: statementItems, total: 9, page: 1, pageSize: 10 };
  }
  // Terms & Conditions (SaaS–Operator): demo returns not accepted so user can try signing
  if (path === "terms/saas-operator") {
    return {
      ok: true,
      content: "# SaaS Platform – Operator Terms and Conditions\n\n**Version:** 1.0 (Demo)\n\nBy signing you agree to the platform terms. This is demo content.",
      version: "1.0",
      contentHash: "demo-content-hash",
      accepted: false,
      acceptedAt: null,
      signatureHash: null,
    };
  }
  if (path === "terms/saas-operator/sign") {
    return { ok: true, signatureHash: "demo-signature-hash-" + Date.now() };
  }
  if (path === "billing/api-docs-my-access") {
    return { ok: true, hasAccess: true, user: { username: "demo-apiuser", token: "demo-api-token-" + Date.now() } };
  }
  if (path === "billing/indoor-admin/api-docs-users") {
    return { ok: true, items: [] };
  }
  if (path === "tenancysetting/change-room-preview") {
    const move = String(b.changeDate || dates.todayYMD).slice(0, 10);
    const end = String(b.newEnd || dates.todayYMD).slice(0, 10);
    const ag = Number(b.agreementFees) || 0;
    const oneTimeRows =
      ag > 0
        ? [{ key: "demo-ag", label: "Agreement fees", sub: `Change room · invoice date ${move}`, amount: ag }]
        : [];
    const oneTimeSubtotal = oneTimeRows.reduce((s, r) => s + r.amount, 0);
    const recurringSubtotal = 1600;
    return {
      ok: true,
      moveFirstDayYmd: move,
      newEndYmd: end,
      rentalInvoiceRule: { type: "first", value: 1 },
      oneTimeRows,
      recurringRows: [
        {
          key: "demo-prior",
          label: "Prorated Rental Income — prior room",
          sub: `Invoice date ${move} · prorated · old rate (prior room)`,
          amount: 400,
          formula: "Calc: 400 ÷ 30 × 7 (demo) = 400.00",
        },
        {
          key: "demo-new",
          label: "Rental Income",
          sub: `Invoice date ${move} · new rate`,
          amount: 1200,
          formula: "Calc: 1200 ÷ 30 × 23 (demo) = 1200.00",
        },
      ],
      oneTimeSubtotal,
      recurringSubtotal,
      total: oneTimeSubtotal + recurringSubtotal,
    };
  }
  // Tenant portal: meter & smart door – demo shows full UI + sample data (no real IoT bind required)
  if (path === "tenantdashboard/room") {
    return {
      ok: true,
      room: {
        _id: String((b as { roomId?: string }).roomId || "demo-room-1"),
        meter: {
          balance: 48.52,
          rate: 0.65,
          mode: "prepaid",
          canTopup: true,
        },
      },
    };
  }
  if (path === "tenantdashboard/usage-summary") {
    const startStr = String((b as { start?: string }).start || dates.todayYMD).slice(0, 10);
    const endStr = String((b as { end?: string }).end || dates.todayYMD).slice(0, 10);
    const startMs = new Date(`${startStr}T12:00:00+08:00`).getTime();
    const endMs = new Date(`${endStr}T12:00:00+08:00`).getTime();
    const records: { date: string; consumption: number }[] = [];
    for (let t = startMs; t <= endMs; t += 24 * 60 * 60 * 1000) {
      const d = new Date(t);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const ymd = `${y}-${m}-${day}`;
      const seed = y + d.getMonth() + d.getDate();
      records.push({ date: ymd, consumption: Math.round((1.8 + (seed % 7) * 0.32) * 100) / 100 });
    }
    const total = records.reduce((s, r) => s + r.consumption, 0);
    return { ok: true, total, records };
  }
  if (path === "tenantdashboard/passcode") {
    return {
      ok: true,
      smartDoorScope: ((b as { smartDoorScope?: string }).smartDoorScope as "all" | "property" | "room") || "all",
      hasPropertyLock: true,
      hasRoomLock: true,
      passwordProperty: "880088",
      passwordRoom: "880088",
      passwordMismatch: false,
      password: "880088",
    };
  }
  if (path === "tenantdashboard/remote-unlock") {
    return { ok: true, partial: false, unlockedCount: 2 };
  }
  if (path === "tenantdashboard/passcode-save") {
    return { ok: true, partial: false };
  }
  if (path === "tenantdashboard/create-payment") {
    const returnUrl = String((b as { returnUrl?: string }).returnUrl || "").trim();
    const payType = String((b as { type?: string }).type || "");
    if (payType === "meter" && returnUrl) {
      return { ok: true, type: "redirect" as const, url: returnUrl };
    }
    return { ok: true, type: "redirect" as const, url: returnUrl || "/" };
  }
  if (path === "tenantdashboard/confirm-payment") {
    return { ok: true, result: { demo: true } };
  }
  if (path === "access/aliyun-idv/start") {
    return {
      ok: true,
      transactionId: "demo-aliyun-txn",
      transactionUrl: "about:blank",
    };
  }
  if (path === "access/aliyun-idv/result") {
    return { ok: true, passed: false, subCode: "DEMO" };
  }
  if (path === "access/gov-id-status") {
    return { ok: true, singpass: false, mydigital: false, identityLocked: false };
  }
  return { ok: true, items: [] };
}

/** Base URL for API. When demo, returns empty so we skip fetch and use mock.
 * 1) NEXT_PUBLIC_USE_SAME_ORIGIN_API=true → /api (portal's /api, Nginx must route to Node 3000)
 * 2) NEXT_PUBLIC_USE_PROXY=true → /api/portal/proxy (Next proxy, Nginx must route portal to Next 3001)
 * 3) Default → api.colivingjb.com directly (CORS required) */
function getProxyBase(): string {
  if (shouldUseDemoMock()) return "";
  if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_USE_SAME_ORIGIN_API === "true") {
    return "/api";
  }
  const useProxy = typeof window !== "undefined" && process.env.NEXT_PUBLIC_USE_PROXY === "true";
  const base = process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com";
  return useProxy ? "/api/portal/proxy" : `${base.replace(/\/$/, "")}/api`;
}

/** Password / OAuth login stores JWT — ECS /api/access/* requires Authorization. */
function jsonHeadersWithPortalJwt(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof window === "undefined") return headers;
  try {
    const jwt = localStorage.getItem(PORTAL_KEYS.PORTAL_JWT);
    if (jwt) {
      headers.Authorization = `Bearer ${jwt}`;
    }
  } catch {
    /* ignore */
  }
  return headers;
}

async function post<T = unknown>(path: string, body: object): Promise<T> {
  const base = getProxyBase();
  if (!base) {
    return getDemoMock(path, body) as T;
  }
  const url = `${base}/${path}`;
  if (typeof window !== "undefined") console.log("[portal-api] fetch url=", url);
  const RETRY_STATUSES = new Set([502, 503, 504]);
  const MAX_ATTEMPTS = 3;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: jsonHeadersWithPortalJwt(),
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data: unknown = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        const preview = text.slice(0, 150);
        console.warn("[portal-api] non-JSON url=", url, "status=", res.status, "preview=", preview, "attempt=", attempt);
        if (res.status >= 400) {
          if (RETRY_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
            await sleep(attempt * 400);
            continue;
          }
          throw new Error(`API ${res.status}: Server returned non-JSON. URL: ${url} preview=${preview}`);
        }
      }
      if (!res.ok) {
        if (RETRY_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
          await sleep(attempt * 400);
          continue;
        }
        const d = data as { message?: string; reason?: string };
        throw new Error(d.message ?? d.reason ?? `API ${res.status}`);
      }
      return data as T;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const maybeGateway =
        /API 50[234]/.test(lastErr.message) ||
        /Bad Gateway/i.test(lastErr.message) ||
        /fetch failed/i.test(lastErr.message) ||
        /network/i.test(lastErr.message);
      if (!maybeGateway || attempt >= MAX_ATTEMPTS) break;
      await sleep(attempt * 400);
    }
  }
  throw lastErr || new Error("API request failed");
}

/**
 * POST but do not throw on non-2xx; returns parsed JSON payload and status.
 * Use for endpoints where backend returns rich error payload (e.g. docx templateErrors).
 */
export async function portalPostJsonAllowError<T = unknown>(
  path: string,
  body: object
): Promise<{ status: number; ok: boolean; data: T }> {
  const base = getProxyBase();
  if (!base) {
    const data = getDemoMock(path, body) as T;
    return { status: 200, ok: true, data };
  }
  const url = `${base}/${path}`;
  if (typeof window !== "undefined") console.log("[portal-api] fetch url=", url);
  const res = await fetch(url, {
    method: "POST",
    headers: jsonHeadersWithPortalJwt(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const preview = text.slice(0, 150);
    console.warn("[portal-api] non-JSON url=", url, "status=", res.status, "preview=", preview);
    data = { ok: false, reason: `API_${res.status}`, message: "Server returned non-JSON response." };
  }
  return { status: res.status, ok: res.ok, data: data as T };
}

/** Get all roles for a member (one email). Use after login. */
export async function getMemberRoles(email: string): Promise<MemberRolesResponse> {
  if (!email?.trim()) return { ok: false, reason: "NO_EMAIL", roles: [] };
  try {
    const data = await post<MemberRolesResponse>("access/member-roles", { email: email.trim() });
    if (data?.ok === false) return { ...data, roles: data.roles ?? [], registered: false };
    const d = data as MemberRolesResponse;
    return { ok: true, email: d.email, roles: d.roles ?? [], registered: d.registered ?? (d.roles?.length ?? 0) > 0 };
  } catch (err) {
    return {
      ok: false,
      reason: "NETWORK_ERROR",
      message: err instanceof Error ? err.message : "Request failed",
      roles: [],
    };
  }
}

/** Get staff access context (first client when multiple). For Operator Portal. */
export async function getAccessContext(email: string): Promise<AccessContextResponse> {
  if (!email?.trim()) return { ok: false, reason: "NO_EMAIL" };
  try {
    return await post<AccessContextResponse>("access/context", { email: email.trim() });
  } catch (err) {
    return {
      ok: false,
      reason: "NETWORK_ERROR",
      message: err instanceof Error ? err.message : "Request failed",
    };
  }
}

/** Get staff access context for a specific client. Use when member chose "staff @ Company A". */
export async function getAccessContextWithClient(
  email: string,
  clientId: string
): Promise<AccessContextResponse> {
  if (!email?.trim() || !clientId?.trim()) return { ok: false, reason: "NO_EMAIL_OR_CLIENT" };
  try {
    return await post<AccessContextResponse>("access/context/with-client", {
      email: email.trim(),
      clientId: clientId.trim(),
    });
  } catch (err) {
    return {
      ok: false,
      reason: "NETWORK_ERROR",
      message: err instanceof Error ? err.message : "Request failed",
    };
  }
}

/** Tenant dashboard / other APIs: POST to ECS via proxy. Call with path e.g. tenantdashboard/init, body { email, ... }. */
export async function portalPost<T = unknown>(path: string, body: object): Promise<T> {
  return post<T>(path, body);
}

/** Public fee breakdown for Coliving SaaS Stripe Checkout (no login body required; proxy uses ECS token). */
export interface SaasStripeFeePreviewResponse {
  ok?: boolean;
  reason?: string;
  currency?: string;
  baseMajor?: number;
  transactionFeeMajor?: number;
  totalMajor?: number;
  transactionFeePercent?: number;
}

export async function fetchSaasStripeFeePreview(
  subtotalMajor: number,
  currency: "MYR" | "SGD"
): Promise<SaasStripeFeePreviewResponse> {
  return post<SaasStripeFeePreviewResponse>("billing/saas-stripe-fee-preview", { subtotalMajor, currency });
}

/** Whether current member's client has API docs access (for /portal card and /docs page). */
export interface ApiDocsMyAccessResponse {
  ok: boolean;
  hasAccess: boolean;
  user?: { username: string; token: string };
}

export async function getApiDocsMyAccess(email: string): Promise<ApiDocsMyAccessResponse> {
  if (!email?.trim()) return { ok: true, hasAccess: false };
  try {
    const data = await post<ApiDocsMyAccessResponse>("billing/api-docs-my-access", { email: email.trim() });
    return { ok: true, hasAccess: !!data?.hasAccess, user: data?.user };
  } catch {
    return { ok: true, hasAccess: false };
  }
}

/** POST and return response as Blob (for binary downloads e.g. .docx). */
export async function portalPostBlob(path: string, body: object): Promise<Blob> {
  const isCreditDeductionPdf = path.includes("credit-log-deduction-report");
  if (shouldUseDemoMock() && !isCreditDeductionPdf) {
    return new Blob([], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }
  const base = getProxyBase();
  if (!base) return new Blob([]);
  const url = `${base}/${path}`;
  const isPreviewPdf = path.includes("preview-pdf-download");
  if (isPreviewPdf && typeof window !== "undefined") {
    console.log(`[preview] ${new Date().toISOString()} FRONTEND_FETCH_START path=${path}`);
  }
  const res = await fetch(url, {
    method: "POST",
    headers: jsonHeadersWithPortalJwt(),
    body: JSON.stringify(body),
  });
  if (isPreviewPdf && typeof window !== "undefined") {
    console.log(`[preview] ${new Date().toISOString()} FRONTEND_FETCH_RESPONSE status=${res.status} ok=${res.ok}`);
  }
  if (!res.ok) {
    let reason = `API ${res.status}`;
    try {
      const text = await res.text();
      const d = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      const details = Array.isArray(d.details) ? (d.details as string[]) : [];
      if (isPreviewPdf && (d.reason === "DOCX_TEMPLATE_ERROR" || details.length)) {
        const parts = [typeof d.message === "string" ? d.message : "", ...details].filter(Boolean);
        reason = parts.length ? parts.join("\n\n") : String(d.reason ?? reason);
      } else {
        reason =
          (typeof d.reason === "string" ? d.reason : null) ??
          (typeof d.message === "string" ? d.message : null) ??
          reason;
      }
    } catch {
      // keep default reason
    }
    throw new Error(reason);
  }
  return res.blob();
}
