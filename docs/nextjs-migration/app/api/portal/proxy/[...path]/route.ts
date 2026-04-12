/**
 * Portal API Proxy – forwards POST requests to ECS backend.
 * Only portal.colivingjb.com should connect to backend; demo.colivingjb.com never forwards.
 * When ECS returns 404 for agreementsetting/variables-reference* we serve fallback so download still works.
 *
 * POST /api/portal/proxy/tenantdashboard/init → https://api.colivingjb.com/api/tenantdashboard/init
 * etc.
 */

import { NextRequest, NextResponse } from "next/server";

// Portal & Node on same ECS: Node (server.js) listens on 5000. Set FORCE_LOCAL_BACKEND=1 in .env.local to always use 127.0.0.1:5000.
const ECS_BASE_RAW =
  process.env.ECS_BASE_URL ||
  process.env.NEXT_PUBLIC_ECS_BASE_URL ||
  "http://127.0.0.1:5000";
const ECS_BASE =
  process.env.FORCE_LOCAL_BACKEND === "1" || process.env.FORCE_LOCAL_BACKEND === "true"
    ? "http://127.0.0.1:5000"
    : ECS_BASE_RAW;
const ECS_TOKEN = process.env.ECS_API_TOKEN || "";
const ECS_USERNAME = process.env.ECS_API_USERNAME || "";

function isDemoHost(request: NextRequest): boolean {
  const host = request.headers.get("host") || request.headers.get("x-forwarded-host") || "";
  return host.includes("demo.colivingjb.com");
}

/** Demo site mocks JSON APIs; multipart uploads must still hit ECS so OSS + pm2 logs work. */
const DEMO_BYPASS_PATHS = new Set([
  "upload",
  "upload/chop",
  "tenantdashboard/upload",
  "ownerportal/upload",
]);

/** Fallback variable list by role: Owner / Tenant / Operator / General – matches ECS getAgreementVariablesReference() */
function fallbackVariablesReference(): Record<string, { label: string; vars: string[] }> {
  return {
    owner: {
      label: "Owner",
      vars: ["ownername", "ownernric", "owneremail", "ownercontact", "owneraddress", "ownersign", "nricfront", "nricback"],
    },
    tenant: {
      label: "Tenant",
      vars: ["tenantname", "tenantnric", "tenantemail", "tenantphone", "tenantaddress", "sign", "tenantsign"],
    },
    operator: {
      label: "Operator",
      vars: ["client", "clientname", "clientssm", "clientuen", "clientaddress", "clientphone", "clientemail", "clientpicname", "clientchop", "operatorsign", "staffname", "staffnric", "staffcontact", "staffemail"],
    },
    general: {
      label: "General",
      vars: ["date", "begin", "end", "paymentdate", "paymentday", "period", "rental", "deposit", "parkinglot", "currency", "rentalapartmentname", "rentalunitnumber", "rentalroomname", "rentaladdress", "meterid", "percentage", "percentage_display"],
    },
  };
}

function demoMock(pathStr: string, body: unknown): unknown {
  const b = (body || {}) as Record<string, unknown>;
  const email = (b.email as string) || "demo@demo.com";
  const clientId = (b.clientId as string) || "demo-client";
  if (pathStr === "access/member-roles") {
    return { ok: true, email: (b.email as string) || email, roles: [{ type: "staff", staffId: "demo-staff", clientId: "demo-client", clientTitle: "Demo Client" }], registered: true };
  }
  if (pathStr === "access/context" || pathStr === "access/context/with-client") {
    return { ok: true, staff: { id: "demo-staff", email, permission: {} }, client: { id: clientId, title: "Demo Client", currency: "MYR" }, credit: { ok: true, balance: 0 } };
  }
  if (pathStr === "billing/my-info") {
    return { noPermission: false, credit: [], currency: "MYR", title: "Demo Client" };
  }
  if (pathStr === "agreementsetting/variables-reference") {
    return fallbackVariablesReference();
  }
  if (pathStr === "agreementsetting/official-templates/list") {
    return { ok: true, items: [] };
  }
  if (pathStr === "companysetting/operator-profile-photo") {
    return { ok: true };
  }
  if (pathStr === "companysetting/operator-bank") {
    return { ok: true, bankId: null, bankaccount: "", accountholder: "" };
  }
  if (pathStr === "companysetting/operator-bank-save") {
    return { ok: true };
  }
  return { ok: true, items: [] };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const pathStr = Array.isArray(path) ? path.join("/") : path || "";
  if (!pathStr) {
    return NextResponse.json({ ok: false, reason: "MISSING_PATH" }, { status: 400 });
  }

  if (isDemoHost(request) && !DEMO_BYPASS_PATHS.has(pathStr)) {
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const data = demoMock(pathStr, body);
    return NextResponse.json(data, { status: 200 });
  }

  const url = `${ECS_BASE.replace(/\/$/, "")}/api/${pathStr}`;
  const isPreviewPdfDownload = pathStr === "agreementsetting/preview-pdf-download";
  const isOfficialTemplateDownload = pathStr === "agreementsetting/official-template-download";
  const isLongBinaryDownload = isPreviewPdfDownload || isOfficialTemplateDownload;
  if (isPreviewPdfDownload) {
    console.log(`[preview] ${new Date().toISOString()} PROXY_PREVIEW_REQUEST_RECEIVED path=${pathStr} url=${url}`);
  } else {
    console.log("[portal proxy] IN path=", pathStr, "url=", url);
    if (pathStr === "upload" || pathStr === "upload/chop") {
      console.log("[portal proxy] UPLOAD multipart will forward to ECS");
    }
  }

  const contentType = request.headers.get("content-type") || "";
  const isMultipart = contentType.includes("multipart/form-data");

  let fetchBody: string | FormData;
  const headers: Record<string, string> = {
    ...ecsHeadersForPath(pathStr, request),
  };

  if (isMultipart && (pathStr === "tenantdashboard/upload" || pathStr === "ownerportal/upload" || pathStr === "upload" || pathStr === "upload/chop")) {
    const formData = await request.formData();
    fetchBody = formData;
  } else {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    headers["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(body);
  }

  const PREVIEW_LONG_TIMEOUT_MS = 120000;
  const controller = isLongBinaryDownload ? new AbortController() : null;
  const timeoutId = isLongBinaryDownload
    ? setTimeout(() => controller?.abort(), PREVIEW_LONG_TIMEOUT_MS)
    : null;

  try {
    if (isLongBinaryDownload) {
      console.log(
        `[preview] ${new Date().toISOString()} PROXY_BINARY_FETCH_START path=${pathStr} timeoutMs=${PREVIEW_LONG_TIMEOUT_MS}`
      );
    }
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: fetchBody,
      signal: controller?.signal,
    });
    if (timeoutId) clearTimeout(timeoutId);
    const contentType = res.headers.get("content-type") || "";
    if (isLongBinaryDownload) {
      console.log(`[preview] ${new Date().toISOString()} PROXY_BINARY_FETCH_DONE status=${res.status} contentType=${contentType.slice(0, 50)}`);
    } else {
      console.log("[portal proxy] ECS response path=", pathStr, "status=", res.status, "contentType=", contentType.slice(0, 50));
    }

    if (pathStr === "agreementsetting/variables-reference" && res.status === 404) {
      return NextResponse.json(fallbackVariablesReference(), { status: 200 });
    }

    if (pathStr === "agreementsetting/preview-pdf-download") {
      if (res.ok && contentType.includes("application/pdf")) {
        const buffer = await res.arrayBuffer();
        const disposition = res.headers.get("content-disposition") || 'attachment; filename="agreement-preview.pdf"';
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Disposition": disposition,
          },
        });
      }
      // Backend returned error (500/504/etc.) – forward as JSON so frontend can show message
      const resTextPreview = await res.text();
      let payload: { ok: boolean; reason?: string; message?: string } = { ok: false, reason: "PREVIEW_FAILED" };
      try {
        const parsed = resTextPreview ? JSON.parse(resTextPreview) : {};
        if (parsed.reason) payload.reason = parsed.reason;
        if (parsed.message) payload.message = parsed.message;
      } catch {
        payload.message = res.status === 504 ? "Preview timed out." : "Preview failed.";
      }
      const status = res.status >= 400 ? res.status : 502;
      return NextResponse.json(payload, { status });
    }

    if (pathStr === "agreementsetting/official-template-download") {
      const docxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      if (res.ok && (contentType.includes(docxType) || contentType.includes("application/octet-stream"))) {
        const buffer = await res.arrayBuffer();
        const disposition =
          res.headers.get("content-disposition") || 'attachment; filename="template.docx"';
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            "Content-Type": contentType.includes(docxType) ? docxType : contentType,
            "Content-Disposition": disposition,
          },
        });
      }
      const resTextPreview = await res.text();
      let payload: { ok: boolean; reason?: string; message?: string } = { ok: false, reason: "DOWNLOAD_FAILED" };
      try {
        const parsed = resTextPreview ? JSON.parse(resTextPreview) : {};
        if (parsed.reason) payload.reason = parsed.reason;
        if (parsed.message) payload.message = parsed.message;
      } catch {
        payload.message = "Download failed.";
      }
      const status = res.status >= 400 ? res.status : 502;
      return NextResponse.json(payload, { status });
    }

    const resText = await res.text();
    let data: unknown = {};
    try {
      data = resText ? JSON.parse(resText) : {};
    } catch (parseErr) {
      console.warn("[portal proxy] ECS returned non-JSON path=", pathStr, "status=", res.status, "ECS_BASE=", ECS_BASE, "preview=", resText.slice(0, 200));
      // Often 502 from nginx when ECS_BASE_URL goes through nginx; return JSON so frontend doesn't throw "non-JSON"
      if (res.status === 502 || res.status === 503 || res.status >= 500) {
        const hint = ECS_BASE.includes("127.0.0.1") || ECS_BASE.includes("localhost")
          ? "Node may be down or slow; ensure server.js is running on port 5000."
          : "Set ECS_BASE_URL=http://127.0.0.1:5000 or FORCE_LOCAL_BACKEND=1 so Next talks to Node on this machine (avoids nginx 502).";
        return NextResponse.json(
          { ok: false, reason: "PROXY_502", message: `Backend unreachable. ${hint}` },
          { status: 502 }
        );
      }
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    const errObj = err instanceof Error ? err : new Error(String(err));
    const cause = (errObj as Error & { cause?: { code?: string; address?: string; port?: number } }).cause;
    const isAbort = (err as Error & { name?: string }).name === "AbortError";
    if (pathStr === "agreementsetting/preview-pdf-download") {
      console.error(
        `[preview] ${new Date().toISOString()} PROXY_PREVIEW_FETCH_THREW name=${(err as Error & { name?: string }).name} message=${errObj.message} isAbort=${isAbort}`,
        cause ? ` cause=${cause.code ?? "unknown"} ${cause.address ?? ""}:${cause.port ?? ""}` : ""
      );
    } else {
      console.error(
        "[portal proxy] fetch failed path=",
        pathStr,
        "url=",
        url,
        "message=",
        errObj.message,
        isAbort ? " (timeout)" : "",
        cause ? `cause=${cause.code ?? "unknown"} ${cause.address ?? ""}:${cause.port ?? ""}` : ""
      );
    }
    if (pathStr === "agreementsetting/variables-reference") {
      return NextResponse.json(fallbackVariablesReference(), { status: 200 });
    }
    if (pathStr === "agreementsetting/preview-pdf-download" || pathStr === "agreementsetting/official-template-download") {
      const status = isAbort ? 504 : 502;
      const reason = isAbort ? "PREVIEW_TIMEOUT" : "PROXY_ERROR";
      const message = isAbort
        ? "Preview timed out (120s). Try a shorter template or retry later."
        : "Backend unreachable or connection error. Ensure Node (server.js) is running and ECS_BASE_URL is correct.";
      return NextResponse.json({ ok: false, reason, message }, { status });
    }
    return NextResponse.json(
      { ok: false, reason: "PROXY_ERROR", message: err instanceof Error ? err.message : "Request failed" },
      { status: 502 }
    );
  }
}

/**
 * portal-auth/*、enquiry/*：优先转发浏览器 Authorization（portal JWT）。
 * 其它路径用 ECS API token；enquiry 无 JWT 时回退 ECS_TOKEN（如公开 submit）。
 */
function ecsHeadersForPath(pathStr: string, request: NextRequest): Record<string, string> {
  const authFromClient = request.headers.get("authorization") || "";
  const headers: Record<string, string> = {};
  if (pathStr.startsWith("portal-auth/")) {
    if (authFromClient) headers.Authorization = authFromClient;
  } else if (pathStr.startsWith("enquiry/")) {
    if (authFromClient) headers.Authorization = authFromClient;
    else if (ECS_TOKEN) headers.Authorization = `Bearer ${ECS_TOKEN}`;
  } else if (ECS_TOKEN) {
    headers.Authorization = `Bearer ${ECS_TOKEN}`;
  }
  if (ECS_USERNAME) headers["X-API-Username"] = ECS_USERNAME;
  return headers;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const pathStr = Array.isArray(path) ? path.join("/") : path || "";
  if (!pathStr) {
    return NextResponse.json({ ok: false, reason: "MISSING_PATH" }, { status: 400 });
  }

  if (isDemoHost(request)) {
    if (pathStr === "portal-auth/password-status") {
      return NextResponse.json({ ok: true, hasPassword: false }, { status: 200 });
    }
    if (pathStr === "portal-auth/profile") {
      return NextResponse.json({ ok: true, profile: null }, { status: 200 });
    }
    return NextResponse.json({ ok: false, reason: "DEMO_GET_NOT_SUPPORTED" }, { status: 404 });
  }

  const url = `${ECS_BASE.replace(/\/$/, "")}/api/${pathStr}`;
  const headers = ecsHeadersForPath(pathStr, request);
  try {
    const res = await fetch(url, { method: "GET", headers });
    const resText = await res.text();
    let data: unknown = {};
    try {
      data = resText ? JSON.parse(resText) : {};
    } catch {
      return NextResponse.json(
        { ok: false, reason: "BAD_GATEWAY", message: resText.slice(0, 200) },
        { status: res.status >= 400 ? res.status : 502 }
      );
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: "PROXY_ERROR", message: err instanceof Error ? err.message : "Request failed" },
      { status: 502 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const pathStr = Array.isArray(path) ? path.join("/") : path || "";
  if (!pathStr) {
    return NextResponse.json({ ok: false, reason: "MISSING_PATH" }, { status: 400 });
  }

  if (isDemoHost(request)) {
    if (pathStr === "portal-auth/profile") {
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    return NextResponse.json({ ok: false, reason: "DEMO_PUT_NOT_SUPPORTED" }, { status: 404 });
  }

  const url = `${ECS_BASE.replace(/\/$/, "")}/api/${pathStr}`;
  const headers: Record<string, string> = {
    ...ecsHeadersForPath(pathStr, request),
    "Content-Type": "application/json",
  };
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
    const resText = await res.text();
    let data: unknown = {};
    try {
      data = resText ? JSON.parse(resText) : {};
    } catch {
      return NextResponse.json(
        { ok: false, reason: "BAD_GATEWAY", message: resText.slice(0, 200) },
        { status: res.status >= 400 ? res.status : 502 }
      );
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: "PROXY_ERROR", message: err instanceof Error ? err.message : "Request failed" },
      { status: 502 }
    );
  }
}
