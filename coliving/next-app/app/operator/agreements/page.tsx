"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FileText, Search, PenLine, Eye, Download, CheckCircle, Clock, XCircle, AlertCircle, ExternalLink, User, Building2, Calendar, Send, Trash2, RefreshCw } from "lucide-react"
import { getTenancySettingList, getOwnerOperatorAgreementsList, signAgreementOperator, getAgreementDraftPdf, retryAgreementFinalPdf, deleteAgreementForOperator } from "@/lib/operator-api"
import { portalHttpsAssetUrl, toDrivePreviewUrl, formatProfileIncompleteAlert } from "@/lib/utils"

type AgreementRow = {
  id: string
  tenant: string
  tenantEmail: string
  owner: string
  room: string
  property: string
  type: string
  status:
    | "pending_tenant"
    | "pending_owner"
    | "pending_operator"
    | "pending_tenant_and_operator"
    | "pending_owner_and_operator"
    | "pending_signatures"
    | "draft_pending"
    | "signed"
    | "expired"
    | "cancelled"
  rent: number
  deposit: number
  checkIn: string
  checkOut: string
  createdAt: string
  signedAt?: string
  docUrl: string
  /** agreement.status from API (raw) — PDF download only when this is `completed` (final). */
  agreementDbStatus?: string
  /** agreement.mode from API — used so we only offer operator Sign when it is the operator's turn. */
  agreementMode?: string
  /** final hash exists => final PDF completed; cannot be deleted from operator UI. */
  hashFinal?: string
  tenantHasSign?: boolean
  operatorHasSign?: boolean
  ownerHasSign?: boolean
}

/**
 * draft_pending: DB still `pending` and no draft PDF URL (e.g. Google Drive quota, template error).
 * Not caused by tenant contact-approval; signing is only offered once draft exists (ready_for_signature / locked).
 */
type SignFlags = { tenant?: boolean; operator?: boolean; owner?: boolean }

/**
 * Map DB agreement row → operator UI status. Uses `mode` + who has signed so
 * tenant_operator never shows "Awaiting Owner".
 */
function mapAgreementStatus(
  dbStatus: string | undefined,
  tenancyEnd: string,
  docUrl?: string,
  mode?: string,
  signs?: SignFlags
): AgreementRow["status"] {
  const endPast = tenancyEnd && new Date(tenancyEnd) < new Date()
  const hasDoc = docUrl != null && String(docUrl).trim() !== "" && docUrl !== "#"
  const m = (mode || "").trim()
  const tn = !!signs?.tenant
  const op = !!signs?.operator
  const ow = !!signs?.owner

  const st = String(dbStatus ?? "").trim().toLowerCase()
  if (st === "completed") return "signed"

  if (st === "locked") {
    if (m === "tenant_operator") {
      // Any sign order; when neither signed yet show both badges.
      if (!tn && !op) return "pending_tenant_and_operator"
      if (!op) return "pending_operator"
      if (!tn) return "pending_tenant"
      return "pending_signatures"
    }
    if (m === "owner_tenant") {
      if (tn && !ow) return "pending_owner"
      if (ow && !tn) return "pending_tenant"
      return "pending_signatures"
    }
    if (m === "owner_operator") {
      if (!ow && !op) return "pending_owner_and_operator"
      if (!op) return "pending_operator"
      if (!ow) return "pending_owner"
      return "pending_signatures"
    }
    return "pending_signatures"
  }

  if (st === "ready_for_signature") {
    if (m === "tenant_operator") {
      if (!tn && !op) return "pending_tenant_and_operator"
      if (!op) return "pending_operator"
      if (!tn) return "pending_tenant"
      return "pending_signatures"
    }
    if (m === "owner_operator") {
      if (!ow && !op) return "pending_owner_and_operator"
      if (!op) return "pending_operator"
      if (!ow) return "pending_owner"
      return "pending_signatures"
    }
    return "pending_tenant"
  }

  if (st === "pending") {
    if (!hasDoc) return "draft_pending"
    return "pending_tenant"
  }
  if (endPast) return "expired"
  // Never treat unknown/missing DB status as "signed" — avoids offering draft PDF download on Signed tab.
  if (!st) return hasDoc ? "pending_signatures" : "draft_pending"
  return hasDoc ? "pending_signatures" : "draft_pending"
}

/** Operator Sign when staff has not signed yet (any order vs tenant/owner). */
function showOperatorSignButton(row: AgreementRow): boolean {
  if (row.operatorHasSign === true) return false
  const m = (row.agreementMode || "").trim()
  if (m === "tenant_operator" || m === "owner_operator") {
    return (
      row.status === "pending_operator" ||
      row.status === "pending_tenant_and_operator" ||
      row.status === "pending_owner_and_operator"
    )
  }
  // Unknown mode rows: do not offer Sign to avoid wrong-party signing loops.
  return false
}

/** Retry final PDF only when DB is still in sign stage (not completed/expired synthetic state). */
function canShowFinalizeButton(row: AgreementRow): boolean {
  if (row.id.startsWith("tenancy-")) return false
  if (row.status !== "pending_signatures") return false
  const st = String(row.agreementDbStatus || "").trim().toLowerCase()
  if (st !== "locked" && st !== "ready_for_signature") return false
  const m = String(row.agreementMode || "").trim()
  if (m === "tenant_operator") return !!row.tenantHasSign && !!row.operatorHasSign
  if (m === "owner_operator") return !!row.ownerHasSign && !!row.operatorHasSign
  if (m === "owner_tenant") return !!row.ownerHasSign && !!row.tenantHasSign
  return false
}

function canShowDeleteButton(row: AgreementRow): boolean {
  if (row.id.startsWith("tenancy-")) return false
  const finalHash = String(row.hashFinal || "").trim()
  return finalHash === ""
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; icon: typeof CheckCircle }> = {
  pending_tenant: { label: "Awaiting Tenant", bg: "#fff7ed", color: "#f97316", icon: Clock },
  pending_operator: { label: "Awaiting Operator", bg: "#fef3c7", color: "#d97706", icon: Clock },
  pending_owner: { label: "Awaiting Owner", bg: "#fef9c3", color: "#ca8a04", icon: Clock },
  pending_signatures: { label: "Signatures pending", bg: "#f1f5f9", color: "#64748b", icon: Clock },
  draft_pending: { label: "PDF not ready", bg: "#e0e7ff", color: "#4338ca", icon: AlertCircle },
  signed: { label: "Signed", bg: "#dcfce7", color: "#16a34a", icon: CheckCircle },
  expired: { label: "Expired", bg: "#f3f4f6", color: "#6b7280", icon: XCircle },
  cancelled: { label: "Cancelled", bg: "#fee2e2", color: "#dc2626", icon: XCircle },
}

/** Two pills when both parties still need to sign (operator portal). */
function AgreementStatusBadges({
  status,
  title,
}: {
  status: AgreementRow["status"]
  title?: string
}) {
  const pill = (key: string, cfg: (typeof STATUS_CONFIG)["pending_tenant"]) => {
    const Icon = cfg.icon
    return (
      <span
        key={key}
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full"
        style={{ background: cfg.bg, color: cfg.color }}
      >
        <Icon size={10} />
        {cfg.label}
      </span>
    )
  }
  if (status === "pending_tenant_and_operator") {
    return (
      <div className="flex flex-wrap gap-1 items-center" title={title}>
        {pill("tn", STATUS_CONFIG.pending_tenant)}
        {pill("op", STATUS_CONFIG.pending_operator)}
      </div>
    )
  }
  if (status === "pending_owner_and_operator") {
    return (
      <div className="flex flex-wrap gap-1 items-center" title={title}>
        {pill("ow", STATUS_CONFIG.pending_owner)}
        {pill("op", STATUS_CONFIG.pending_operator)}
      </div>
    )
  }
  const c = STATUS_CONFIG[status] ?? STATUS_CONFIG.signed
  const StatusIcon = c.icon
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full"
      style={{ background: c.bg, color: c.color }}
      title={title}
    >
      <StatusIcon size={10} />
      {c.label}
    </span>
  )
}

export default function AgreementsPage() {
  const ecsBase = (process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "")
  const toPreviewUrl = useCallback(
    (url: string | null | undefined) => toDrivePreviewUrl(portalHttpsAssetUrl(url, ecsBase)),
    [ecsBase]
  )

  const [search, setSearch] = useState("")
  const [filterStatus, setFilterStatus] = useState("all")
  const [filterProperty, setFilterProperty] = useState("all")
  const [filterOwner, setFilterOwner] = useState("all")
  const [filterTenant, setFilterTenant] = useState("all")
  const [filterDateFrom, setFilterDateFrom] = useState("")
  const [filterDateTo, setFilterDateTo] = useState("")
  const [activeTab, setActiveTab] = useState("pending")
  const [selectedAgreement, setSelectedAgreement] = useState<AgreementRow | null>(null)
  const [showSignDialog, setShowSignDialog] = useState(false)
  const [showViewDialog, setShowViewDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AgreementRow | null>(null)
  const [agreements, setAgreements] = useState<AgreementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [propertyOptions, setPropertyOptions] = useState<string[]>([])
  const [signatureData, setSignatureData] = useState<string>("")
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState<string>("")
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null)
  const [finalizeLoadingId, setFinalizeLoadingId] = useState<string | null>(null)
  const [deletingAgreementId, setDeletingAgreementId] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)

  const ownerOptions = useMemo(() => {
    const set = new Set<string>()
    for (const a of agreements) {
      const v = (a.owner || "").trim()
      if (v && v !== "—") set.add(v)
    }
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))]
  }, [agreements])

  const tenantOptions = useMemo(() => {
    const set = new Set<string>()
    for (const a of agreements) {
      const v = (a.tenant || "").trim()
      if (v && v !== "—") set.add(v)
    }
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))]
  }, [agreements])

  const loadAgreements = useCallback(async () => {
    setLoading(true)
    try {
      // Tenancy-based agreements.
      const [res, ownerOperatorRes] = await Promise.all([
        getTenancySettingList({ limit: 500, sort: "new" }),
        getOwnerOperatorAgreementsList().catch(() => ({ items: [] })),
      ])
      const items = (res?.items || []) as Array<{
        id?: string
        _id?: string
        begin?: string
        end?: string
        rental?: number
        deposit?: number
        title?: string
        room?: { title_fld?: string }
        tenant?: { fullname?: string; phone?: string }
        property?: { shortname?: string }
        agreements?: Array<{
          _id?: string
          _createdDate?: string
          mode?: string
          status?: string
          url?: string
          pdfurl?: string
          hash_final?: string
          tenant_has_sign?: boolean
          operator_has_sign?: boolean
          owner_has_sign?: boolean
        }>
      }>
      const rows: AgreementRow[] = []
      const props = new Set<string>()
      const seenAgreementIds = new Set<string>()
      for (const t of items) {
        const propName = t.property?.shortname || "—"
        if (propName !== "—") props.add(propName)
        const agreements = t.agreements || []
        // Only list real `agreement` rows (created from Tenancy Setting, etc.). Do not synthesize a
        // "pending PDF" row for tenancies with zero agreements — booking only creates `tenancy`, not agreement shells.
        if (agreements.length > 0) {
          for (const ag of agreements) {
            const docUrl = toPreviewUrl(String(ag.url || ag.pdfurl || "").trim())
            const dbSt = ag.status != null ? String(ag.status) : ""
            const agreementId = ag._id || `ag-${t.id}-${ag._id}`
            seenAgreementIds.add(agreementId)
            rows.push({
              id: agreementId,
              tenant: t.tenant?.fullname || "—",
              tenantEmail: "",
              owner: "—",
              room: t.room?.title_fld || "—",
              property: propName,
              type: (t.title as string) || "Tenancy",
              agreementDbStatus: dbSt,
              agreementMode: (ag.mode != null ? String(ag.mode) : "").trim(),
              hashFinal: String(ag.hash_final || ""),
              tenantHasSign: ag.tenant_has_sign === true,
              operatorHasSign: ag.operator_has_sign === true,
              ownerHasSign: ag.owner_has_sign === true,
              status: mapAgreementStatus(ag.status, t.end || "", docUrl, ag.mode, {
                tenant: ag.tenant_has_sign,
                operator: ag.operator_has_sign,
                owner: ag.owner_has_sign,
              }),
              rent: Number(t.rental) || 0,
              deposit: Number(t.deposit) || 0,
              checkIn: t.begin || "",
              checkOut: t.end || "",
              createdAt: ag._createdDate || "",
              docUrl,
            })
          }
        }
      }

      // Owner–operator (property) agreements: not on tenancy rows; must list separately (all statuses, not only pending operator sign).
      const adminItems = ((ownerOperatorRes as { items?: Array<Record<string, unknown>> })?.items || []) as Array<Record<string, unknown>>
      for (const item of adminItems) {
        const agreement = (item.agreement || {}) as Record<string, unknown>
        const agreementId = String(agreement._id || item.id || item._id || "")
        const mode = String(agreement.mode || "")
        if (!agreementId || seenAgreementIds.has(agreementId) || mode !== "owner_operator") continue
        const docUrl = toPreviewUrl(String(agreement.url || agreement.pdfurl || ""))
        const ownerHasSign =
          agreement.owner_has_sign === true ||
          String(agreement.ownersign || "").trim() !== ""
        const operatorHasSign =
          agreement.operator_has_sign === true ||
          String(agreement.operatorsign || "").trim() !== ""
        const propertyName = String((item.property as { shortname?: string } | null)?.shortname || "—")
        const ownerName = String(
          (agreement.ownername as string | undefined) ||
          (agreement.owner_name as string | undefined) ||
          ""
        ).trim()
        if (propertyName !== "—") props.add(propertyName)
        rows.push({
          id: agreementId,
          tenant: "—",
          tenantEmail: "",
          owner: ownerName || "—",
          room: String((item.room as { title_fld?: string } | null)?.title_fld || "—"),
          property: propertyName,
          type: "Owner agreement",
          status: mapAgreementStatus(
            String(agreement.status || "locked"),
            new Date().toISOString(),
            docUrl,
            mode,
            {
              owner: ownerHasSign,
              operator: operatorHasSign,
            }
          ),
          agreementDbStatus: String(agreement.status || "locked"),
          agreementMode: mode,
          hashFinal: String(agreement.hash_final || ""),
          tenantHasSign: false,
          operatorHasSign: operatorHasSign,
          ownerHasSign: ownerHasSign,
          rent: 0,
          deposit: 0,
          checkIn: new Date().toISOString(),
          checkOut: new Date().toISOString(),
          createdAt: String(item._createdDate || ""),
          docUrl,
        })
      }
      setAgreements(rows)
      setPropertyOptions(["All Properties", ...Array.from(props).sort()])
    } catch (e) {
      console.error("[agreements] load", e)
      setAgreements([])
    } finally {
      setLoading(false)
    }
  }, [toPreviewUrl])

  useEffect(() => {
    loadAgreements()
  }, [loadAgreements])

  const dateFromMs = filterDateFrom ? new Date(`${filterDateFrom}T00:00:00`).getTime() : null
  const dateToMs = filterDateTo ? new Date(`${filterDateTo}T23:59:59.999`).getTime() : null

  const filtered = agreements.filter((a) => {
    const matchSearch =
      a.tenant.toLowerCase().includes(search.toLowerCase()) ||
      a.owner.toLowerCase().includes(search.toLowerCase()) ||
      a.id.toLowerCase().includes(search.toLowerCase()) ||
      a.room.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === "all" || a.status === filterStatus
    const matchProperty = filterProperty === "all" || a.property === filterProperty
    const matchOwner = filterOwner === "all" || a.owner === filterOwner
    const matchTenant = filterTenant === "all" || a.tenant === filterTenant

    const created = a.createdAt ? new Date(a.createdAt) : null
    const createdMs = created && !Number.isNaN(created.getTime()) ? created.getTime() : null
    const matchDateFrom = dateFromMs == null || (createdMs != null && createdMs >= dateFromMs)
    const matchDateTo = dateToMs == null || (createdMs != null && createdMs <= dateToMs)
    const matchDate = matchDateFrom && matchDateTo

    if (activeTab === "pending") {
      return (
        matchSearch &&
        matchProperty &&
        matchOwner &&
        matchTenant &&
        matchDate &&
        (a.status === "pending_tenant" ||
          a.status === "pending_owner" ||
          a.status === "pending_operator" ||
          a.status === "pending_tenant_and_operator" ||
          a.status === "pending_owner_and_operator" ||
          a.status === "pending_signatures" ||
          a.status === "draft_pending")
      )
    } else if (activeTab === "signed") {
      return matchSearch && matchStatus && matchProperty && matchOwner && matchTenant && matchDate && a.status === "signed"
    } else if (activeTab === "expired") {
      return matchSearch && matchProperty && matchOwner && matchTenant && matchDate && (a.status === "expired" || a.status === "cancelled")
    }
    return matchSearch && matchStatus && matchProperty && matchOwner && matchTenant && matchDate
  })

  const pendingCount = agreements.filter(
    (a) =>
      a.status === "pending_tenant" ||
      a.status === "pending_owner" ||
      a.status === "pending_operator" ||
      a.status === "pending_tenant_and_operator" ||
      a.status === "pending_owner_and_operator" ||
      a.status === "pending_signatures" ||
      a.status === "draft_pending"
  ).length
  const signedCount = agreements.filter(a => a.status === "signed").length
  const expiredCount = agreements.filter(a => a.status === "expired" || a.status === "cancelled").length

  const handleSign = (agreement: AgreementRow) => {
    setSelectedAgreement(agreement)
    setSignatureData("")
    setSignError("")
    setShowSignDialog(true)
  }

  const getCanvasPoint = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const clientX = "touches" in e ? e.touches[0]?.clientX : e.clientX
    const clientY = "touches" in e ? e.touches[0]?.clientY : e.clientY
    if (clientX == null || clientY == null) return null
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }
  }

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const p = getCanvasPoint(e)
    if (!p || !canvasRef.current) return
    const ctx = canvasRef.current.getContext("2d")
    if (!ctx) return
    drawingRef.current = true
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  const moveDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!drawingRef.current) return
    const p = getCanvasPoint(e)
    if (!p || !canvasRef.current) return
    const ctx = canvasRef.current.getContext("2d")
    if (!ctx) return
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  const endDraw = () => {
    if (!drawingRef.current || !canvasRef.current) return
    drawingRef.current = false
    try {
      const data = canvasRef.current.toDataURL("image/png")
      setSignatureData(data)
    } catch (_) {}
  }

  const clearSignature = () => {
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }
    setSignatureData("")
  }

  useEffect(() => {
    if (!showSignDialog || !selectedAgreement) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = "#000"
    ctx.lineWidth = 2
    ctx.lineCap = "round"
  }, [showSignDialog, selectedAgreement])

  const handleSubmitSignature = async () => {
    if (!selectedAgreement || !signatureData) return
    setSigning(true)
    setSignError("")
    try {
      const res = await signAgreementOperator(selectedAgreement.id, signatureData)
      if (res?.ok !== false) {
        setShowSignDialog(false)
        await loadAgreements()
      } else {
        const reason = String((res as { reason?: string }).reason || "").trim().toUpperCase()
        if (reason === "AGREEMENT_COMPLETED" || reason === "NOT_FOUND") {
          setShowSignDialog(false)
          await loadAgreements()
          return
        }
        setSignError((res as { reason?: string }).reason || "Sign failed")
      }
    } catch (e) {
      setSignError(e instanceof Error ? e.message : "Sign failed")
    } finally {
      setSigning(false)
    }
  }

  const handleView = (agreement: AgreementRow) => {
    setSelectedAgreement(agreement)
    setShowViewDialog(true)
  }

  /** Generate draft PDF if missing (prepare-for-signature), then open; always refresh list so Sign appears. */
  const handleRetryFinalPdf = async (agreement: AgreementRow) => {
    if (agreement.id.startsWith("tenancy-")) return
    setFinalizeLoadingId(agreement.id)
    try {
      const res = await retryAgreementFinalPdf(agreement.id)
      if (res?.ok) {
        await loadAgreements()
        return
      }
      const reason = String((res as { reason?: string })?.reason || "").trim().toUpperCase()
      if (reason === "ALREADY_COMPLETED") {
        // Not an error: backend says final PDF already completed. Just refresh list/UI state.
        await loadAgreements()
        return
      }
      const msg =
        (res as { message?: string })?.message ||
        (res as { reason?: string })?.reason ||
        "Final PDF failed"
      window.alert(msg)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Request failed")
    } finally {
      setFinalizeLoadingId(null)
    }
  }

  const handleDeleteAgreement = async () => {
    if (!deleteTarget) return
    setDeletingAgreementId(deleteTarget.id)
    try {
      const res = await deleteAgreementForOperator(deleteTarget.id)
      if (res?.ok) {
        setShowDeleteDialog(false)
        setDeleteTarget(null)
        await loadAgreements()
        return
      }
      const msg =
        (res as { message?: string })?.message ||
        (res as { reason?: string })?.reason ||
        "Delete failed"
      window.alert(msg)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setDeletingAgreementId(null)
    }
  }

  const handlePreviewDraft = async (agreement: AgreementRow) => {
    if (agreement.docUrl && agreement.docUrl !== "#") {
      window.open(agreement.docUrl, "_blank", "noopener,noreferrer")
      return
    }
    setPreviewLoadingId(agreement.id)
    try {
      const res = await getAgreementDraftPdf(agreement.id)
      if (res?.ok && res.pdfUrl) {
        window.open(toPreviewUrl(res.pdfUrl), "_blank", "noopener,noreferrer")
      } else if (res && res.ok === false) {
        const reason = String((res as { reason?: string }).reason || "").trim()
        const missing = (res as { missingFields?: string[] }).missingFields
        const hasMissingList = Array.isArray(missing) && missing.length > 0
        const msg =
          hasMissingList || reason === "profile_incomplete"
            ? formatProfileIncompleteAlert(hasMissingList ? missing : undefined)
            : (res as { message?: string }).message ||
              reason ||
              "Prepare PDF failed"
        alert(msg)
      }
    } catch (e) {
      console.error(e)
      alert("Prepare PDF failed")
    } finally {
      setPreviewLoadingId(null)
      try {
        await loadAgreements()
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <main className="p-3 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Agreements</h1>
        <p className="text-muted-foreground mt-1">Manage tenancy agreements, renewals, and signatures.</p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="pending" className="gap-2">
            Pending <Badge variant="secondary" className="ml-1">{pendingCount}</Badge>
          </TabsTrigger>
          <TabsTrigger value="signed" className="gap-2">
            Signed <Badge variant="secondary" className="ml-1">{signedCount}</Badge>
          </TabsTrigger>
          <TabsTrigger value="expired" className="gap-2">
            Expired / Cancelled <Badge variant="secondary" className="ml-1">{expiredCount}</Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Search & Filter */}
      <Card className="mb-4">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col gap-3">
            {/* Row 1: search only */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
              <Input
                placeholder="Search by tenant, room, or internal ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Row 2: filters */}
            <div className="flex flex-wrap gap-3 items-end">
              <Select value={filterProperty} onValueChange={setFilterProperty}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Property" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Properties</SelectItem>
                  {propertyOptions.filter((p) => p !== "All Properties").map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterOwner} onValueChange={setFilterOwner}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Owner" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Owners</SelectItem>
                  {ownerOptions.filter((o) => o !== "all").map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterTenant} onValueChange={setFilterTenant}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Tenant" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tenants</SelectItem>
                  {tenantOptions.filter((t) => t !== "all").map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex gap-2 items-end">
                <div>
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results count */}
      <p className="text-xs text-muted-foreground mb-3 px-1">
        Showing {filtered.length} agreement(s)
      </p>

      {/* Agreements Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground">Agreement</th>
                  <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground hidden sm:table-cell">Tenant</th>
                  <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground hidden md:table-cell">Property / Room</th>
                  <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground hidden lg:table-cell">Period</th>
                  <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground">Status</th>
                  <th className="text-center py-3 px-4 font-semibold text-xs text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-muted-foreground text-sm">
                      Loading agreements...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-muted-foreground text-sm">
                      No agreements found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((agreement) => {
                    const partyName = agreement.type === "Owner agreement" ? agreement.owner : agreement.tenant
                    return (
                      <tr key={agreement.id} className="border-b border-border hover:bg-secondary/30 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-foreground">
                            {agreement.id.startsWith("tenancy-")
                              ? "No agreement document"
                              : (agreement.type?.trim() || "Tenancy agreement")}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {partyName} · {agreement.room}
                          </div>
                        </td>
                        <td className="py-3 px-4 hidden sm:table-cell">
                          <div className="text-foreground">{agreement.tenant}</div>
                          <div className="text-xs text-muted-foreground">{agreement.tenantEmail}</div>
                        </td>
                        <td className="py-3 px-4 hidden md:table-cell text-muted-foreground">
                          {agreement.property} · {agreement.room}
                        </td>
                        <td className="py-3 px-4 hidden lg:table-cell text-xs text-muted-foreground">
                          {new Date(agreement.checkIn).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                          <br />
                          <span className="text-muted-foreground/60">to {new Date(agreement.checkOut).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
                        </td>
                        <td className="py-3 px-4">
                          <AgreementStatusBadges
                            status={agreement.status}
                          />
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => handleView(agreement)}>
                              <Eye size={14} />
                            </Button>
                            {!agreement.id.startsWith("tenancy-") && agreement.status !== "signed" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1"
                                disabled={previewLoadingId === agreement.id}
                                onClick={() => handlePreviewDraft(agreement)}
                              >
                                {previewLoadingId === agreement.id ? (
                                  "…"
                                ) : (
                                  <>
                                    <FileText size={14} />{" "}
                                    {agreement.status === "draft_pending" ? "Prepare PDF" : "Preview"}
                                  </>
                                )}
                              </Button>
                            )}
                            {showOperatorSignButton(agreement) && (
                              <Button
                                size="sm"
                                className="gap-1 text-xs"
                                style={{ background: "var(--brand)" }}
                                onClick={() => handleSign(agreement)}
                              >
                                <PenLine size={12} /> Sign
                              </Button>
                            )}
                            {canShowFinalizeButton(agreement) && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1 text-xs"
                                disabled={finalizeLoadingId === agreement.id}
                                title="Both parties signed but final PDF did not complete (e.g. Google API error). Retries generateFinalPdfAndComplete."
                                onClick={() => void handleRetryFinalPdf(agreement)}
                              >
                                {finalizeLoadingId === agreement.id ? (
                                  "…"
                                ) : (
                                  <>
                                    <RefreshCw size={12} /> Finalize
                                  </>
                                )}
                              </Button>
                            )}
                            {canShowDeleteButton(agreement) && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                                disabled={deletingAgreementId === agreement.id}
                                title="Delete agreement (credits are not refunded)"
                                onClick={() => {
                                  setDeleteTarget(agreement)
                                  setShowDeleteDialog(true)
                                }}
                              >
                                {deletingAgreementId === agreement.id ? "…" : <><Trash2 size={12} /> Delete</>}
                              </Button>
                            )}
                            {agreement.status === "signed" &&
                              String(agreement.agreementDbStatus ?? "").trim().toLowerCase() === "completed" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1 text-xs"
                                disabled={!agreement.docUrl || agreement.docUrl === "#"}
                                title="Open final agreement PDF only (not draft)"
                                onClick={() => {
                                  if (agreement.docUrl && agreement.docUrl !== "#") {
                                    window.open(agreement.docUrl, "_blank", "noopener,noreferrer")
                                  }
                                }}
                              >
                                <Download size={12} /> Final PDF
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* View Agreement Dialog */}
      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText size={18} style={{ color: "var(--brand)" }} />
              Agreement Details
            </DialogTitle>
            <DialogDescription>
              {selectedAgreement?.tenant} · {selectedAgreement?.property} · {selectedAgreement?.room}
            </DialogDescription>
          </DialogHeader>
          {selectedAgreement && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Tenant</Label>
                  <p className="font-medium flex items-center gap-1.5 mt-0.5">
                    <User size={13} /> {selectedAgreement.tenant}
                  </p>
                  <p className="text-xs text-muted-foreground">{selectedAgreement.tenantEmail}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Owner</Label>
                  <p className="font-medium mt-0.5">{selectedAgreement.owner}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Property / Room</Label>
                  <p className="font-medium flex items-center gap-1.5 mt-0.5">
                    <Building2 size={13} /> {selectedAgreement.property} · {selectedAgreement.room}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <p className="mt-0.5">
                    <AgreementStatusBadges status={selectedAgreement.status} />
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Check-in</Label>
                  <p className="font-medium flex items-center gap-1.5 mt-0.5">
                    <Calendar size={13} /> {new Date(selectedAgreement.checkIn).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Check-out</Label>
                  <p className="font-medium flex items-center gap-1.5 mt-0.5">
                    <Calendar size={13} /> {new Date(selectedAgreement.checkOut).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Monthly Rent</Label>
                  <p className="font-bold text-lg mt-0.5">RM {selectedAgreement.rent.toLocaleString()}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Deposit</Label>
                  <p className="font-bold text-lg mt-0.5">RM {selectedAgreement.deposit.toLocaleString()}</p>
                </div>
              </div>
              {String(selectedAgreement.agreementDbStatus ?? "").trim().toLowerCase() === "completed" &&
                selectedAgreement.docUrl && (
                  <a
                    href={selectedAgreement.docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm font-medium hover:underline"
                    style={{ color: "var(--brand)" }}
                  >
                    <ExternalLink size={14} /> Preview
                  </a>
                )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowViewDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sign Agreement Dialog — width ≈ 2/3 of Company Settings “Set Fees” dialog (95/90/85vw → 63/60/57vw) */}
      <Dialog open={showSignDialog} onOpenChange={setShowSignDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-[min(calc(100vw-2rem),63vw)] sm:max-w-[min(calc(100vw-2rem),60vw)] md:max-w-[min(calc(100vw-2rem),57vw)] border-2 border-border shadow-xl rounded-xl p-6 sm:p-8">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine size={18} style={{ color: "var(--brand)" }} />
              Sign Agreement (Operator)
            </DialogTitle>
            <DialogDescription>
              {selectedAgreement?.tenant} · {selectedAgreement?.property} · {selectedAgreement?.room}
            </DialogDescription>
          </DialogHeader>
          {selectedAgreement && (
            <div className="space-y-4 py-2">
              <div className="p-4 rounded-xl bg-muted/50 border border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Property</span>
                  <span className="font-medium">{selectedAgreement.property} · {selectedAgreement.room}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Monthly Rent</span>
                  <span className="font-bold">RM {selectedAgreement.rent.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Period</span>
                  <span className="text-sm">
                    {new Date(selectedAgreement.checkIn).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} - {new Date(selectedAgreement.checkOut).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                </div>
              </div>

              {/* Drive / PDF URLs cannot be embedded (X-Frame-Options); preview only via new tab. */}
              <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-4">
                <Label className="text-xs font-semibold text-muted-foreground">Agreement document</Label>
                {selectedAgreement.docUrl && selectedAgreement.docUrl !== "#" ? (
                  <>
                    <a
                      href={selectedAgreement.docUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
                      style={{ color: "var(--brand)" }}
                    >
                      <ExternalLink size={14} /> Preview
                    </a>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Document not ready yet.</p>
                )}
              </div>

              {/* Signature input */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground">Your signature (draw below)</Label>
                <div
                  className="rounded-lg border-2 border-dashed border-border bg-white w-full overflow-hidden"
                  style={{ height: 250 }}
                  onMouseDown={startDraw}
                  onMouseMove={moveDraw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={startDraw}
                  onTouchMove={moveDraw}
                  onTouchEnd={endDraw}
                >
                  <canvas
                    ref={canvasRef}
                    className="block w-full h-full touch-none cursor-crosshair"
                    style={{ width: "100%", height: "100%" }}
                    width={400}
                    height={250}
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" className="gap-1" onClick={clearSignature}>
                    <Trash2 size={14} /> Clear
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1"
                    style={{ background: "var(--brand)" }}
                    disabled={!signatureData || signing}
                    onClick={handleSubmitSignature}
                  >
                    {signing ? "Signing…" : "Submit signature"}
                  </Button>
                </div>
                {signError && <p className="text-sm text-destructive">{signError}</p>}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowSignDialog(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showDeleteDialog}
        onOpenChange={(v) => {
          setShowDeleteDialog(v)
          if (!v) setDeleteTarget(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm delete?</DialogTitle>
            <DialogDescription>
              Delete this agreement record permanently? Credit is not refunded.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            {deleteTarget ? `${deleteTarget.property} · ${deleteTarget.room}` : ""}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDeleteDialog(false); setDeleteTarget(null); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!deleteTarget || deletingAgreementId === deleteTarget?.id}
              onClick={() => void handleDeleteAgreement()}
            >
              {deletingAgreementId ? "Deleting…" : "Confirm delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
