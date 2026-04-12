"use client"

import { useState, useRef, useMemo } from "react"
import { FileText, CheckCircle2, Clock, Download, PenLine, Loader2 } from "lucide-react"
import { useTenantOptional } from "@/contexts/tenant-context"
import { agreementGet, agreementUpdateSign } from "@/lib/tenant-api"
import { portalHttpsAssetUrl, toDrivePreviewUrl } from "@/lib/utils"

/** Row from tenantdashboard init: `url` is draft or final PDF link; only `status === 'completed'` is the final agreement for download. */
type Agreement = {
  _id?: string
  tenantsign?: string
  url?: string
  agreementtemplate_id?: string
  status?: string
  tenant_signed_at?: string | null
  /** Row `updated_at` when `tenant_signed_at` missing (e.g. before migration 0133). */
  agreement_updated_at?: string | null
  columns_locked?: boolean
}
type PendingDraftAgreement = {
  _id?: string
  agreementtemplate_id?: string
  mode?: string
  status?: string
  pdf_generating?: boolean
  _createdDate?: string
}
type Tenancy = {
  id?: string
  _id?: string
  begin?: string
  end?: string
  rental?: number
  room?: { roomname?: string; title_fld?: string }
  property?: { shortname?: string }
  tenant?: { fullname?: string }
  agreements?: Agreement[]
  pendingDraftAgreements?: PendingDraftAgreement[]
  isPortalReadOnly?: boolean
}

function formatDate(d: string | undefined): string {
  if (!d) return "—"
  try {
    return new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })
  } catch {
    return "—"
  }
}

/** Final = both-party flow finished; server sets status completed + final PDF URL. */
function isFinalAgreement(ag: Agreement): boolean {
  return String(ag.status ?? "").toLowerCase() === "completed"
}

/** Tenant signature timestamp from DB (`tenant_signed_at`), set on sign when migration 0133 applied. */
function formatTenantSignedAt(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === "") return "—"
  try {
    const d = new Date(iso)
    return d.toLocaleString("en-MY", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return "—"
  }
}

function formatAmount(n: number | undefined): string {
  if (n == null) return "RM 0.00"
  return `RM ${Number(n).toFixed(2)}`
}

export default function AgreementPage() {
  const state = useTenantOptional()
  const tenancies = (state?.tenancies ?? []) as Tenancy[]
  const tenant = state?.tenant as { fullname?: string } | null

  const [signLoading, setSignLoading] = useState(false)
  const [signModalOpen, setSignModalOpen] = useState(false)
  const [signAgreementId, setSignAgreementId] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const pendingDraftRows = useMemo(() => {
    const out: { agreementId: string; tenancy: Tenancy; pdfGenerating: boolean }[] = []
    for (const t of tenancies) {
      const drafts = t.pendingDraftAgreements
      if (!Array.isArray(drafts)) continue
      for (const d of drafts) {
        const aid = d._id
        if (!aid) continue
        out.push({
          agreementId: aid,
          tenancy: t,
          pdfGenerating: !!d.pdf_generating,
        })
      }
    }
    return out
  }, [tenancies])

  const { pendingAgreements, pastAgreements, hasAwaitingFinalAgreement } = useMemo(() => {
    const pendingById = new Map<string, { ag: Agreement; tenancy: Tenancy }>()
    const pastById = new Map<string, { ag: Agreement; tenancy: Tenancy }>()
    for (const t of tenancies) {
      const tid = t.id ?? t._id
      if (!tid) continue
      for (const ag of t.agreements ?? []) {
        const aid = ag._id
        if (!aid) continue
        if (ag.tenantsign) {
          if (!pastById.has(aid)) pastById.set(aid, { ag, tenancy: t })
        } else {
          if (!pendingById.has(aid)) pendingById.set(aid, { ag, tenancy: t })
        }
      }
    }
    const past = [...pastById.values()]
    const pending = [...pendingById.values()]
    const hasAwaitingFinalAgreement = past.some(({ ag }) => !!ag.tenantsign && !isFinalAgreement(ag))
    return { pendingAgreements: pending, pastAgreements: past, hasAwaitingFinalAgreement }
  }, [tenancies])

  const firstPending = pendingAgreements[0]
  const currentTenancy = firstPending?.tenancy
  const currentAg = firstPending?.ag
  const agreementTenancyReadonly = !!currentTenancy?.isPortalReadOnly

  const ecsBase = (process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "")

  /** Resolve agreement file URL (list first, then agreement-get). */
  const resolveAgreementFileUrl = async (ag: Agreement | null | undefined): Promise<string | null> => {
    if (!ag) return null
    const direct = toDrivePreviewUrl(portalHttpsAssetUrl(ag.url, ecsBase))
    if (direct.startsWith("http")) return direct
    if (!ag._id) return null
    try {
      const res = await agreementGet(ag._id)
      const url = (res?.agreement as { url?: string })?.url
      const fixed = toDrivePreviewUrl(portalHttpsAssetUrl(url, ecsBase))
      return fixed.startsWith("http") ? fixed : null
    } catch {
      return null
    }
  }

  /** Download blob (optional) ; if CORS blocks or non-OK, open in new tab. */
  const openOrDownloadAgreementUrl = async (
    url: string,
    filename = "tenancy-agreement.pdf",
    download = true
  ) => {
    try {
      const res = await fetch(url, { mode: "cors" })
      if (res.ok) {
        const blob = await res.blob()
        const objectUrl = URL.createObjectURL(blob)
        if (download) {
          const a = document.createElement("a")
          a.href = objectUrl
          a.download = filename
          document.body.appendChild(a)
          a.click()
          a.remove()
        } else {
          window.open(objectUrl, "_blank", "noopener,noreferrer")
        }
        URL.revokeObjectURL(objectUrl)
        return
      }
    } catch {
      /* OSS / Drive may block CORS — fall back */
    }
    window.open(url, "_blank", "noopener,noreferrer")
  }

  /** Preview / download for the primary pending agreement card. */
  const handlePreview = async () => {
    const url = await resolveAgreementFileUrl(currentAg)
    if (!url) {
      alert("Agreement file is not available yet. Please try again later or contact your operator.")
      return
    }
    // Preview always opens in a new tab; it should never trigger forced download logic.
    window.open(url, "_blank", "noopener,noreferrer")
  }

  /** Open only the final agreement (`status === completed`) in a new tab. */
  const handleOpenPast = async (ag: Agreement) => {
    if (!isFinalAgreement(ag)) {
      alert(
        "The final agreement is not ready yet. Download opens only after all required parties have signed and the system has generated the final PDF."
      )
      return
    }
    const url = await resolveAgreementFileUrl(ag)
    if (!url) {
      alert("Download link is not available yet. Please contact your operator.")
      return
    }
    window.open(url, "_blank", "noopener,noreferrer")
  }

  const handleOpenSign = () => {
    if (agreementTenancyReadonly) return
    if (!currentAg?._id) return
    setSignAgreementId(currentAg._id)
    setSignModalOpen(true)
  }

  const handleSignSubmit = async () => {
    if (agreementTenancyReadonly) return
    if (!signAgreementId || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const dataUrl = canvas.toDataURL("image/png")
    if (!dataUrl || dataUrl.length < 100) {
      alert("Please draw your signature first.")
      return
    }
    setSignLoading(true)
    try {
      const res = await agreementUpdateSign(signAgreementId, dataUrl)
      if (res?.ok) {
        setSignModalOpen(false)
        setSignAgreementId(null)
        state?.refetch?.()
      } else {
        alert((res as { reason?: string })?.reason || "Sign failed.")
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Sign failed.")
    } finally {
      setSignLoading(false)
    }
  }

  const handleClearSign = () => {
    if (!canvasRef.current) return
    const ctx = canvasRef.current.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
  }

  const isDrawing = useRef(false)
  const startDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDrawing.current = true
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    const rect = canvasRef.current!.getBoundingClientRect()
    ctx.beginPath()
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top)
  }
  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    const rect = canvasRef.current!.getBoundingClientRect()
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top)
    ctx.stroke()
  }
  const endDraw = () => { isDrawing.current = false }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-foreground">Tenancy Agreement</h1>
        <p className="text-muted-foreground mt-1">Review and sign your lease documents.</p>
      </div>

      <div className="flex flex-col gap-8 min-w-0">
        <div className="flex flex-col gap-6 min-w-0">
          {pendingDraftRows.length > 0 && (
            <div className="bg-sky-50 border border-sky-200 rounded-2xl p-5 flex flex-col gap-4">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center flex-shrink-0">
                  <Clock size={20} className="text-sky-700" />
                </div>
                <div>
                  <div className="font-bold text-sky-900 mb-0.5">Draft agreement not ready yet</div>
                  <p className="text-sm text-sky-800 leading-relaxed">
                    Your landlord or agent is preparing the agreement PDF. If you were asked to update your profile, do that first — only they can retry
                    generating the draft from <strong>Operator</strong> (Tenancy or Agreements). This page will update when the draft is ready.
                  </p>
                </div>
              </div>
              <ul className="flex flex-col gap-2">
                {pendingDraftRows.map(({ agreementId, tenancy, pdfGenerating }) => (
                  <li
                    key={agreementId}
                    className="rounded-xl border border-sky-200/80 bg-white/80 px-4 py-3"
                  >
                    <div className="text-sm">
                      <span className="font-semibold text-foreground">{tenancy.property?.shortname || "Tenancy"}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {formatDate(tenancy.begin)} – {formatDate(tenancy.end)}
                      </span>
                      <div className="text-xs text-muted-foreground mt-0.5 font-mono">ID {agreementId.slice(0, 8)}…</div>
                      {pdfGenerating ? (
                        <div className="text-xs text-sky-800 mt-2 flex items-center gap-1.5">
                          <Loader2 size={14} className="animate-spin" /> Generating PDF… please wait and refresh later.
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pendingAgreements.length > 0 ? (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <Clock size={20} className="text-amber-600" />
                </div>
                <div>
                  <div className="font-bold text-amber-800 mb-0.5">Signature Required</div>
                  <p className="text-sm text-amber-700 leading-relaxed">
                    Your tenancy agreement for {formatDate(currentTenancy?.begin)} – {formatDate(currentTenancy?.end)} is ready for your digital signature.
                    Please review and sign to confirm your tenancy.
                  </p>
                </div>
              </div>

              <div className="bg-card border border-border rounded-2xl p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--brand-muted)" }}>
                      <FileText size={18} style={{ color: "var(--brand)" }} />
                    </div>
                    <div>
                      <div className="font-bold text-foreground">{currentTenancy?.property?.shortname || "Tenancy"} Agreement</div>
                      <div className="text-xs text-muted-foreground">TA-{currentAg?._id}</div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  <div className="bg-secondary/50 rounded-xl p-3">
                    <div className="text-[10px] tracking-[0.2em] uppercase font-semibold text-muted-foreground mb-1">Tenant</div>
                    <div className="font-bold text-foreground text-sm">{tenant?.fullname || "—"}</div>
                  </div>
                  <div className="bg-secondary/50 rounded-xl p-3">
                    <div className="text-[10px] tracking-[0.2em] uppercase font-semibold text-muted-foreground mb-1">Property</div>
                    <div className="font-bold text-foreground text-sm">{currentTenancy?.property?.shortname || "—"}</div>
                  </div>
                  <div className="bg-secondary/50 rounded-xl p-3">
                    <div className="text-[10px] tracking-[0.2em] uppercase font-semibold text-muted-foreground mb-1">Room</div>
                    <div className="font-bold text-foreground text-sm">{currentTenancy?.room?.roomname || currentTenancy?.room?.title_fld || "—"}</div>
                  </div>
                  <div className="bg-secondary/50 rounded-xl p-3">
                    <div className="text-[10px] tracking-[0.2em] uppercase font-semibold text-muted-foreground mb-1">Tenancy Period</div>
                    <div className="font-bold text-foreground text-sm">{formatDate(currentTenancy?.begin)} – {formatDate(currentTenancy?.end)}</div>
                  </div>
                  <div className="bg-secondary/50 rounded-xl p-3">
                    <div className="text-[10px] tracking-[0.2em] uppercase font-semibold text-muted-foreground mb-1">Monthly Rent</div>
                    <div className="font-bold text-foreground text-sm">{formatAmount(currentTenancy?.rental)}</div>
                  </div>
                </div>

                <div className="mb-6">
                  <button
                    type="button"
                    onClick={handlePreview}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-opacity"
                    style={{ background: "var(--brand)" }}
                  >
                    <Download size={18} />
                    Preview
                  </button>
                  <p className="text-xs text-muted-foreground mt-2">
                    Opens the agreement PDF in a new tab for reading. Use your browser&apos;s Save/Download button if you need a local copy.
                  </p>
                </div>

                <div className="bg-secondary/30 rounded-xl p-4 text-sm text-muted-foreground leading-relaxed mb-6">
                  By signing this agreement, you acknowledge and agree to abide by all house rules, payment terms,
                  and the conditions set forth in the full tenancy agreement document. Please use <strong>Preview</strong> to read the file before signing.
                </div>

                {agreementTenancyReadonly ? (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4">
                    This tenancy has ended. Signing is disabled — you can still use Preview to read the agreement.
                  </p>
                ) : null}

                <button
                  type="button"
                  onClick={handleOpenSign}
                  disabled={agreementTenancyReadonly}
                  className="w-full py-3.5 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: "var(--brand)" }}
                >
                  <PenLine size={16} /> Sign Agreement
                </button>
              </div>
            </>
          ) : pendingDraftRows.length === 0 ? (
            hasAwaitingFinalAgreement ? (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center">
                <Clock size={48} className="text-amber-600 mx-auto mb-4" />
                <p className="font-bold text-foreground">Waiting for final agreement</p>
                <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto leading-relaxed">
                  You have already signed. The downloadable <strong className="text-foreground">final</strong> PDF is only available after every required party has signed
                  and the system finishes processing. See <strong className="text-foreground">Past Agreements</strong> below for each file&apos;s status.
                </p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-2xl p-8 text-center">
                <CheckCircle2 size={48} className="text-emerald-500 mx-auto mb-4" />
                <p className="font-bold text-foreground">No pending agreements</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {pastAgreements.length > 0
                    ? "All your tenancy agreements on file are complete."
                    : "No agreements on file."}
                </p>
              </div>
            )
          ) : null}
        </div>

        <aside className="flex flex-col gap-4 min-w-0 rounded-2xl border border-border/80 bg-muted/20 p-5 sm:p-6">
          <header className="space-y-1.5">
            <h2 className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">Past Agreements</h2>
            <p className="text-[11px] text-muted-foreground leading-relaxed max-w-none">
              Download is only enabled for the <strong className="text-foreground">final</strong> agreement (all parties signed). Your signature date is shown below.
            </p>
          </header>
          {pastAgreements.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No past agreements.</p>
          ) : (
            <ul className="flex flex-col gap-3 list-none p-0 m-0">
              {pastAgreements.map(({ ag, tenancy }) => {
                const finalReady = isFinalAgreement(ag)
                const roomLabel = tenancy.room?.roomname || tenancy.room?.title_fld
                return (
                  <li key={ag._id}>
                    <div className="bg-card border border-border rounded-xl p-4 shadow-sm sm:p-5">
                      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-6">
                        <div className="flex min-w-0 flex-1 gap-3 md:items-center">
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg self-start md:self-center"
                            style={{ background: "var(--brand-muted)" }}
                            aria-hidden
                          >
                            <FileText size={15} style={{ color: "var(--brand)" }} />
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
                              <span className="font-semibold text-sm text-foreground">
                                {tenancy.property?.shortname || "Agreement"}
                              </span>
                              {roomLabel ? (
                                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                                  · {roomLabel}
                                </span>
                              ) : null}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Tenancy · {formatDate(tenancy.begin)} – {formatDate(tenancy.end)}
                            </div>
                            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0 text-xs">
                              <span className="shrink-0 text-muted-foreground">You signed</span>
                              <span className="text-foreground tabular-nums whitespace-nowrap">
                                {formatTenantSignedAt(ag.tenant_signed_at ?? ag.agreement_updated_at)}
                                {!ag.tenant_signed_at && ag.agreement_updated_at ? (
                                  <span className="text-muted-foreground font-normal"> (approx.)</span>
                                ) : null}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-row items-center justify-end gap-2 md:flex-col md:items-end md:justify-center">
                          {finalReady ? (
                            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" aria-label="Final agreement ready" />
                          ) : (
                            <Clock size={18} className="text-amber-600 shrink-0" aria-label="Awaiting final PDF" />
                          )}
                          {finalReady ? (
                            <button
                              type="button"
                              onClick={() => void handleOpenPast(ag)}
                              className="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[11px] font-semibold text-white hover:opacity-90 transition-opacity md:min-w-[8.5rem]"
                              style={{ background: "var(--brand)" }}
                            >
                              <Download size={13} className="shrink-0" />
                              Open final PDF
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="inline-flex h-8 cursor-not-allowed items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-muted px-2.5 text-[11px] font-semibold text-muted-foreground md:min-w-[8.5rem]"
                              title="Available after the final agreement is ready"
                            >
                              <Download size={13} className="shrink-0 opacity-60" />
                              Download
                            </button>
                          )}
                        </div>
                      </div>
                      {!finalReady ? (
                        <p className="mt-3 border-t border-border pt-3 text-[11px] font-medium leading-snug text-amber-900 dark:text-amber-200/90">
                          Final PDF not ready yet. If everyone has signed, your operator can tap <strong>Finalize</strong> on Operator → Agreements to retry generation (e.g. after a Google Drive/API error).
                        </p>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
      </div>

      {/* Sign Modal */}
      {signModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="font-bold text-lg mb-4">Draw your signature</h3>
            <canvas
              ref={canvasRef}
              width={400}
              height={150}
              className="w-full border border-border rounded-xl bg-white cursor-crosshair"
              style={{ touchAction: "none" }}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
            />
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={handleClearSign}
                className="flex-1 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-secondary transition-colors"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handleSignSubmit}
                disabled={signLoading}
                className="flex-1 py-2 rounded-xl font-bold text-white text-sm disabled:opacity-50"
                style={{ background: "var(--brand)" }}
              >
                {signLoading ? <Loader2 size={16} className="animate-spin" /> : "Submit"}
              </button>
              <button
                type="button"
                onClick={() => { setSignModalOpen(false); setSignAgreementId(null); }}
                className="flex-1 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
