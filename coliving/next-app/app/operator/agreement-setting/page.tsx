"use client"

import { useState, useEffect, useCallback } from "react"
import { FileText, Plus, Edit, Trash2, Search, Filter, ExternalLink, Link, BookOpen, Eye, FolderOpen, Stamp, Download, ShoppingCart } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  getAgreementList,
  createAgreementTemplate,
  updateAgreementTemplate,
  deleteAgreementTemplate,
  getAgreementVariablesReference,
  getAgreementPreviewPdf,
  getAgreementTemplate,
  getOfficialTemplatesList,
  purchaseOfficialAgreementTemplates,
  downloadOfficialAgreementTemplateDocx,
  type OfficialTemplateRow,
} from "@/lib/operator-api"
import { useOperatorContext } from "@/contexts/operator-context"
import { Checkbox } from "@/components/ui/checkbox"
import { portalHttpsAssetUrl, toDrivePreviewUrl } from "@/lib/utils"

type TemplateItem = {
  id: string
  title?: string
  templateurl?: string
  folderurl?: string
  mode?: string
  created_at?: string
  preview_pdf_oss_url?: string
  preview_pdf_status?: string
  preview_pdf_error?: string
}

const MODE_OPTIONS = [
  { value: "owner_tenant", label: "Owner & Tenant" },
  { value: "owner_operator", label: "Owner & Operator" },
  { value: "tenant_operator", label: "Tenant & Operator" },
]

/** Fallback variable list by role: Owner / Tenant / Operator / General – matches ECS getAgreementVariablesReference() */
const VARIABLES_REFERENCE_FALLBACK: Record<string, { label: string; vars: string[] }> = {
  owner: {
    label: "Owner",
    vars: ["ownername", "ownernric", "owneremail", "ownercontact", "owneraddress", "ownersign", "nricfront", "nricback"],
  },
  tenant: {
    label: "Tenant",
    vars: ["tenantname", "tenantnric", "tenantemail", "tenantphone", "tenantaddress", "sign", "tenantsign", "username", "usernric", "useremail", "userphone"],
  },
  operator: {
    label: "Operator",
    vars: ["client", "clientname", "clientssm", "clientuen", "clientaddress", "clientphone", "clientemail", "clientpicname", "clientchop", "operatorsign", "staffname", "staffnric", "staffcontact", "staffemail", "username", "usernric", "useremail", "userphone"],
  },
  general: {
    label: "General",
    vars: ["date", "begin", "end", "paymentdate", "paymentday", "period", "rental", "deposit", "parkinglot", "currency", "rentalapartmentname", "rentalunitnumber", "rentalroomname", "rentaladdress", "meterid", "percentage", "percentage_display"],
  },
}

const VARIABLES_EXAMPLES: Record<string, string> = {
  ownername: "Jane Smith",
  ownernric: "850303-03-9012",
  owneremail: "jane@example.com",
  ownercontact: "+60 12-111 2233",
  owneraddress: "Kuala Lumpur",
  ownersign: "(owner signature image)",
  nricfront: "(NRIC front image)",
  nricback: "(NRIC back image)",
  tenantname: "John Doe",
  tenantnric: "900101-01-1234",
  tenantemail: "john@example.com",
  tenantphone: "+60 12-345 6789",
  tenantaddress: "123, Jalan Example, Kuala Lumpur",
  sign: "(tenant signature image)",
  tenantsign: "(tenant signature image)",
  client: "ABC Coliving Sdn Bhd",
  clientname: "ABC Coliving Sdn Bhd",
  clientssm: "12345678-X",
  clientuen: "12345678-X",
  clientaddress: "456, Jalan Biz, KL",
  clientphone: "+60 3-1234 5678",
  clientemail: "admin@abccoliving.com",
  clientpicname: "abccoliving",
  clientchop: "(company chop image)",
  operatorsign: "(operator signature image)",
  staffname: "Ali Ahmad",
  staffnric: "880202-02-5678",
  staffcontact: "+60 12-987 6543",
  staffemail: "ali@abccoliving.com",
  username: "Ali Ahmad",
  usernric: "880202-02-5678",
  useremail: "ali@abccoliving.com",
  userphone: "+60 12-987 6543",
  date: "12 March 2025",
  begin: "1 January 2025",
  end: "31 December 2025",
  paymentdate: "5",
  paymentday: "5",
  period: "12 months",
  rental: "MYR/SGD 1,500.00",
  deposit: "MYR/SGD 1,100.00",
  currency: "MYR or SGD",
  rentalapartmentname: "Sunway Residences",
  rentalunitnumber: "B-13-07",
  rentalroomname: "Room A",
  rentaladdress: "Room A, Sunway Residences, Jalan PJ",
  meterid: "METER001",
  percentage: "70",
  percentage_display: "70.00%",
  parkinglot: "A-12",
}

function isVariablesRefValid(ref: unknown): ref is Record<string, { label: string; vars: string[] }> {
  if (!ref || typeof ref !== "object") return false
  const r = ref as Record<string, unknown>
  return (
    Array.isArray(r.owner?.vars) &&
    Array.isArray(r.tenant?.vars) &&
    Array.isArray(r.operator?.vars)
  )
}

export default function AgreementSettingPage() {
  const ecsBase = (process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "")
  const { permission, refresh: refreshOperatorCtx, creditBalance } = useOperatorContext()
  const canPurchaseOfficial = !!(permission.finance || permission.billing || permission.admin)

  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterMode, setFilterMode] = useState("ALL")
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [editOpen, setEditOpen] = useState(false)
  const [currentTemplate, setCurrentTemplate] = useState<TemplateItem | null>(null)
  const [editForm, setEditForm] = useState({
    title: "",
    templateurl: "",
    folderurl: "",
    mode: "owner_tenant",
  })
  const [saving, setSaving] = useState(false)
  const [showVariablesRef, setShowVariablesRef] = useState(false)
  const [variablesRef, setVariablesRef] = useState<Record<string, { label: string; vars: string[] }> | null>(null)
  const [variablesRefLoading, setVariablesRefLoading] = useState(false)
  const [previewGeneratingId, setPreviewGeneratingId] = useState<string | null>(null)
  /** After save with Doc+folder: poll until cached preview PDF on OSS is ready/failed (background job). Preview download can still use live Google API. */
  const [pollingPreviewId, setPollingPreviewId] = useState<string | null>(null)

  const [officialModalOpen, setOfficialModalOpen] = useState(false)
  const [officialItems, setOfficialItems] = useState<OfficialTemplateRow[]>([])
  const [officialLoading, setOfficialLoading] = useState(false)
  const [officialSelected, setOfficialSelected] = useState<Set<string>>(new Set())
  const [officialPurchasing, setOfficialPurchasing] = useState(false)
  const [officialDownloadingId, setOfficialDownloadingId] = useState<string | null>(null)

  const loadOfficialTemplates = useCallback(async () => {
    try {
      const r = await getOfficialTemplatesList()
      setOfficialItems(Array.isArray(r.items) ? r.items : [])
    } catch {
      setOfficialItems([])
    }
  }, [])

  useEffect(() => {
    void loadOfficialTemplates()
  }, [loadOfficialTemplates])

  useEffect(() => {
    if (!officialModalOpen) return
    setOfficialLoading(true)
    void loadOfficialTemplates().finally(() => setOfficialLoading(false))
  }, [officialModalOpen, loadOfficialTemplates])

  const ownedOfficialTemplates = officialItems.filter((i) => i.owned)

  const toggleOfficialSelect = (id: string) => {
    setOfficialSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const selectedToPurchase = officialItems.filter((i) => officialSelected.has(i.id) && !i.owned)
  const purchaseTotalCredits = selectedToPurchase.reduce((s, i) => s + (Number(i.credit) || 0), 0)
  const insufficientCreditsForPurchase =
    selectedToPurchase.length > 0 && purchaseTotalCredits > 0 && creditBalance < purchaseTotalCredits

  const handleOfficialPurchase = async () => {
    if (!selectedToPurchase.length) return
    if (
      !confirm(
        `Purchase ${selectedToPurchase.length} template(s) for ${purchaseTotalCredits} credits? This cannot be undone.`
      )
    ) {
      return
    }
    setOfficialPurchasing(true)
    try {
      const r = await purchaseOfficialAgreementTemplates(selectedToPurchase.map((i) => i.id))
      if (!r.ok) {
        alert((r as { message?: string }).message || (r as { reason?: string }).reason || "Purchase failed")
        return
      }
      setOfficialSelected(new Set())
      await loadOfficialTemplates()
      await refreshOperatorCtx()
    } finally {
      setOfficialPurchasing(false)
    }
  }

  const handleOfficialDownload = async (row: OfficialTemplateRow) => {
    setOfficialDownloadingId(row.id)
    try {
      await downloadOfficialAgreementTemplateDocx(row.id, row.agreementname || "template")
    } catch (e) {
      alert(e instanceof Error ? e.message : "Download failed")
    } finally {
      setOfficialDownloadingId(null)
    }
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const r = await getAgreementList({ search: search || undefined, mode: filterMode !== "ALL" ? filterMode : undefined, limit: 100 })
      setTemplates((r?.items || []) as TemplateItem[])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [search, filterMode])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (!pollingPreviewId) return
    let cancelled = false
    let ticks = 0
    const maxTicks = 100
    const tick = async () => {
      if (cancelled) return
      ticks++
      try {
        const row = (await getAgreementTemplate(pollingPreviewId)) as TemplateItem
        const st = row?.preview_pdf_status
        if (st === "ready" || st === "failed" || ticks >= maxTicks) {
          setPollingPreviewId(null)
          await loadData()
          return
        }
      } catch {
        /* ignore */
      }
    }
    void tick()
    const iv = setInterval(() => void tick(), 5000)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [pollingPreviewId, loadData])

  const filteredTemplates = templates

  const openEdit = (template: TemplateItem | null) => {
    setCurrentTemplate(template)
    setEditForm({
      title: template?.title || "",
      templateurl: template?.templateurl || "",
      folderurl: template?.folderurl || "",
      mode: template?.mode || "owner_tenant",
    })
    setEditOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)
    const hasDocFolder =
      editForm.templateurl.trim().length > 0 && editForm.folderurl.trim().length > 0
    try {
      if (currentTemplate?.id) {
        const r = await updateAgreementTemplate(currentTemplate.id, {
          title: editForm.title.trim(),
          templateurl: editForm.templateurl.trim() || undefined,
          folderurl: editForm.folderurl.trim() || undefined,
          mode: editForm.mode,
        })
        if (r?.ok !== false) {
          setEditOpen(false)
          await loadData()
          if (hasDocFolder) setPollingPreviewId(currentTemplate.id)
        }
      } else {
        const r = await createAgreementTemplate({
          title: editForm.title.trim(),
          templateurl: editForm.templateurl.trim() || undefined,
          folderurl: editForm.folderurl.trim() || undefined,
          mode: editForm.mode,
        })
        if (r?.ok !== false) {
          setEditOpen(false)
          await loadData()
          const newId = (r as { id?: string })?.id
          if (hasDocFolder && newId) setPollingPreviewId(newId)
        }
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this template?")) return
    try {
      const r = await deleteAgreementTemplate(id)
      if (r?.ok !== false) await loadData()
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    if (!showVariablesRef) return
    setVariablesRef(VARIABLES_REFERENCE_FALLBACK)
    let cancelled = false
    setVariablesRefLoading(true)
    getAgreementVariablesReference()
      .then((ref) => {
        if (!cancelled && isVariablesRefValid(ref)) setVariablesRef(ref)
      })
      .catch(() => { /* keep fallback */ })
      .finally(() => { if (!cancelled) setVariablesRefLoading(false) })
    return () => { cancelled = true }
  }, [showVariablesRef])

  /** Download preview PDF: uses OSS cache when present; otherwise ECS generates via Google Docs/Drive API (same auth as agreement PDF). */
  const handlePreviewTemplate = async (template: TemplateItem) => {
    if (!(template.templateurl || "").trim() || !(template.folderurl || "").trim()) return
    const t0 = Date.now()
    setPreviewGeneratingId(template.id)
    try {
      const r = await getAgreementPreviewPdf(template.id)
      if (r?.ok && r.pdfUrl) {
        const normalized = toDrivePreviewUrl(portalHttpsAssetUrl(r.pdfUrl, ecsBase))
        if (normalized.startsWith("http")) {
          window.open(normalized, "_blank", "noopener,noreferrer")
        } else {
          alert("Preview failed")
        }
      } else {
        alert((r as { reason?: string })?.reason || "Preview failed")
      }
      console.log(`[preview] FRONTEND_PREVIEW_DONE ms=${Date.now() - t0}`)
    } catch (e) {
      console.error(`[preview] FRONTEND_PREVIEW_ERROR`, e)
      alert(e instanceof Error ? e.message : "Preview failed")
    } finally {
      setPreviewGeneratingId(null)
    }
  }

  const downloadVariablesReferenceDocx = async () => {
    const ref = variablesRef || VARIABLES_REFERENCE_FALLBACK
    const { Document, Packer, Paragraph, TextRun } = await import("docx")

    const heading = (text: string) =>
      new Paragraph({
        children: [new TextRun({ text, bold: true, size: 28 })],
        spacing: { after: 180 },
      })

    const subheading = (text: string) =>
      new Paragraph({
        children: [new TextRun({ text, bold: true, size: 24 })],
        spacing: { before: 180, after: 120 },
      })

    const line = (left: string, right: string) =>
      new Paragraph({
        children: [
          new TextRun({ text: left, font: "Consolas" }),
          new TextRun({ text: "  " }),
          new TextRun({ text: `e.g. ${right}` }),
        ],
        spacing: { after: 60 },
      })

    const children: Paragraph[] = []
    children.push(heading("Agreement template variables reference"))
    children.push(
      new Paragraph({
        children: [new TextRun("Use these placeholders in your Google Docs template. Format: {{varname}}")],
        spacing: { after: 200 },
      })
    )

    for (const { label, vars } of Object.values(ref)) {
      children.push(subheading(label))
      for (const v of vars) {
        const ex = VARIABLES_EXAMPLES[v] || ""
        children.push(line(`{{${v}}}`, ex))
      }
    }

    const doc = new Document({ sections: [{ children }] })
    const blob = await Packer.toBlob(doc)
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "agreement-template-variables-reference.docx"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="p-3 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Agreement Setting</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Manage agreement templates for tenants and owners</p>
        </div>
        <div className="flex flex-wrap gap-2 self-start sm:self-auto">
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setShowVariablesRef(true)}>
            <BookOpen size={16} /> Template variables
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            disabled={!canPurchaseOfficial}
            title={
              canPurchaseOfficial
                ? undefined
                : "Only Finance or Billing permission can open the official template catalog and purchase."
            }
            onClick={() => {
              setOfficialSelected(new Set())
              setOfficialModalOpen(true)
            }}
          >
            <Stamp size={16} /> Official Template
          </Button>
          <Button size="sm" className="gap-2 flex-shrink-0" style={{ background: "var(--brand)" }} onClick={() => openEdit(null)}>
            <Plus size={16} /> New Template
          </Button>
        </div>
      </div>

      {ownedOfficialTemplates.length > 0 ? (
        <Card className="mb-4 border-primary/20">
          <CardHeader className="p-3 sm:p-4 pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Stamp size={18} /> Official templates (your organization)
            </CardTitle>
            <p className="text-xs text-muted-foreground font-normal">
              Purchased with credits. Download as Word (.docx) — file saves directly, does not open Google Docs.
            </p>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 pt-0">
            <div className="rounded-md border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left p-2 font-medium">Name</th>
                    <th className="text-right p-2 font-medium w-32">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {ownedOfficialTemplates.map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="p-2">{row.agreementname}</td>
                      <td className="p-2 text-right">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="gap-1"
                          disabled={officialDownloadingId === row.id}
                          onClick={() => void handleOfficialDownload(row)}
                        >
                          <Download size={14} />
                          {officialDownloadingId === row.id ? "…" : ".docx"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Filters */}
      <Card className="mb-4 sm:mb-6">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <Input
                placeholder="Search templates..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>
            <Select value={filterMode} onValueChange={setFilterMode}>
              <SelectTrigger className="w-full sm:w-40">
                <Filter size={14} className="mr-2 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                {MODE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Templates List */}
      <Card>
        <CardHeader className="p-3 sm:p-4">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <FileText size={18} /> Agreement Templates
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 pt-0">
          <div className="space-y-2 sm:space-y-3">
            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
            ) : filteredTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No templates found</p>
            ) : (
              filteredTemplates.map((template) => (
                <div key={template.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-3 sm:p-4 border border-border rounded-lg">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-sm sm:text-base text-foreground truncate">{template.title}</h3>
                      <Badge variant="secondary" className="text-xs capitalize">{template.mode?.replace("_", " ") || "—"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Created: {template.created_at ? new Date(template.created_at).toLocaleDateString("en-GB") : "—"}
                    </p>
                    {(template.templateurl || template.folderurl) ? (
                      <div className="text-xs mt-1 space-y-0.5">
                        {template.templateurl && template.folderurl ? (
                          <>
                            <p className="text-muted-foreground flex items-center gap-1">
                              <FileText size={11} /> Google Docs template + Drive folder
                            </p>
                            <a href={template.templateurl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline" style={{ color: "var(--brand)" }}>
                              <Link size={11} /> Open Doc <ExternalLink size={10} />
                            </a>
                            <a href={template.folderurl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline text-muted-foreground">
                              <FolderOpen size={11} /> Open folder <ExternalLink size={10} />
                            </a>
                          </>
                        ) : template.templateurl ? (
                          <a href={template.templateurl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline" style={{ color: "var(--brand)" }}>
                            <Link size={11} /> Google Doc — add folder URL for preview PDF <ExternalLink size={10} />
                          </a>
                        ) : (
                          <p className="text-muted-foreground text-[11px]">Add Google Doc link and Drive folder for preview.</p>
                        )}
                        {(template.preview_pdf_status === "pending" || pollingPreviewId === template.id) ? (
                          <p className="text-amber-600">
                            Caching preview PDF to OSS… this page will update automatically (usually under 1–2 minutes). You can still use <strong>Preview</strong> for an on-demand PDF via Google API.
                          </p>
                        ) : null}
                        {template.preview_pdf_status === "failed" && template.preview_pdf_error ? (
                          <p className="text-red-600 text-[11px] break-words">{template.preview_pdf_error}</p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground/60 mt-1 italic">No template</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(template.templateurl || "").trim() && (template.folderurl || "").trim() ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        disabled={previewGeneratingId === template.id}
                        onClick={() => handlePreviewTemplate(template)}
                      >
                        <Eye size={14} />
                        Preview
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => openEdit(template)}>
                      <Edit size={14} />
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => handleDelete(template.id)}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Official templates (purchase — Finance / Billing only opens modal) */}
      <Dialog open={officialModalOpen} onOpenChange={setOfficialModalOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Stamp size={20} /> Official templates
            </DialogTitle>
            <DialogDescription>
              Select templates you do not own yet, then Purchase to deduct credits. Owned templates show a download button
              (.docx via server — share each Google Doc with your platform service account as Viewer).
            </DialogDescription>
          </DialogHeader>
          {officialLoading ? (
            <p className="text-sm text-muted-foreground py-6">Loading…</p>
          ) : officialItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">
              No official templates in catalog yet. Add rows to <code className="text-xs bg-muted px-1">official_agreement_template</code>{" "}
              (run migration 0124).
            </p>
          ) : (
            <>
              <div className="rounded-md border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="w-10 p-2" />
                      <th className="text-left p-2 font-medium">Agreement name</th>
                      <th className="text-right p-2 font-medium w-24">Credit</th>
                      <th className="text-center p-2 font-medium w-28">Status</th>
                      <th className="text-right p-2 font-medium w-36">Download</th>
                    </tr>
                  </thead>
                  <tbody>
                    {officialItems.map((row) => (
                      <tr key={row.id} className="border-b border-border last:border-0">
                        <td className="p-2 align-middle">
                          {row.owned ? (
                            <span className="text-muted-foreground text-xs">—</span>
                          ) : (
                            <Checkbox
                              checked={officialSelected.has(row.id)}
                              onCheckedChange={() => toggleOfficialSelect(row.id)}
                              aria-label={`Select ${row.agreementname}`}
                            />
                          )}
                        </td>
                        <td className="p-2 align-middle">{row.agreementname}</td>
                        <td className="p-2 text-right align-middle">{row.credit}</td>
                        <td className="p-2 text-center align-middle">
                          {row.owned ? (
                            <Badge variant="secondary" className="text-xs">
                              Owned
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="p-2 text-right align-middle">
                          {row.owned ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              disabled={officialDownloadingId === row.id}
                              onClick={() => void handleOfficialDownload(row)}
                            >
                              <Download size={14} />
                              {officialDownloadingId === row.id ? "…" : "Word"}
                            </Button>
                          ) : (
                            <span className="text-muted-foreground text-xs">After purchase</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between sm:items-center">
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>
                    Selected: {selectedToPurchase.length} item(s) · Total{" "}
                    <strong>{purchaseTotalCredits}</strong> credits · Your balance{" "}
                    <strong>{creditBalance}</strong>
                  </p>
                  {insufficientCreditsForPurchase ? (
                    <p className="text-destructive font-medium">
                      Not enough credits — top up on the Credit page or reduce your selection.
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setOfficialModalOpen(false)}>
                    Close
                  </Button>
                  <Button
                    style={{ background: "var(--brand)" }}
                    disabled={
                      !selectedToPurchase.length || officialPurchasing || insufficientCreditsForPurchase
                    }
                    className="gap-2"
                    onClick={() => void handleOfficialPurchase()}
                  >
                    <ShoppingCart size={16} />
                    {officialPurchasing ? "Processing…" : "Purchase"}
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Template variables reference dialog */}
      <Dialog open={showVariablesRef} onOpenChange={setShowVariablesRef}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen size={20} /> Template variables reference
            </DialogTitle>
            <DialogDescription>
              Use these placeholders in your Google Docs template. They will be replaced when the system generates an agreement. Format: <code className="rounded bg-muted px-1">{"{{varname}}"}</code>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-2">
            {variablesRefLoading ? (
              <p className="text-sm text-muted-foreground">Loading variables...</p>
            ) : (
              Object.entries(variablesRef || VARIABLES_REFERENCE_FALLBACK).map(([mode, { label, vars }]) => (
                <div key={mode}>
                  <h3 className="text-sm font-semibold text-foreground mb-2">{label}</h3>
                  <div className="flex flex-wrap gap-2">
                    {vars.map((v) => (
                      <code key={v} className="text-xs rounded bg-muted px-2 py-1 font-mono">
                        {"{{" + v + "}}"}
                      </code>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={variablesRefLoading}
              onClick={() => void downloadVariablesReferenceDocx()}
            >
              <Download size={16} /> Word
            </Button>
            <Button variant="outline" onClick={() => setShowVariablesRef(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit/Create Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{currentTemplate ? "Edit Template" : "Create New Template"}</DialogTitle>
            <DialogDescription>
              Put your agreement as a <strong>Google Doc</strong> in Drive. Paste the <strong>Doc link</strong> and the <strong>folder link</strong> where agreements (and the preview copy) should live. Save → backend uses <strong>Google Docs/Drive</strong> (operator OAuth or service account, same as agreement PDF) to build preview and uploads a cached copy to OSS.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Template name</Label>
              <Input value={editForm.title} onChange={(e) => setEditForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Tenancy Agreement" />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={editForm.mode} onValueChange={(v) => setEditForm(f => ({ ...f, mode: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODE_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Google Docs template URL <span className="text-destructive">*</span></Label>
              <Input
                value={editForm.templateurl}
                onChange={(e) => setEditForm((f) => ({ ...f, templateurl: e.target.value }))}
                placeholder="https://docs.google.com/document/d/.../edit"
              />
              <p className="text-xs text-muted-foreground">The Google Doc that is your agreement template (placeholders like {"{{tenantname}}"}).</p>
            </div>
            <div className="space-y-2">
              <Label>Google Drive folder URL <span className="text-destructive">*</span></Label>
              <Input
                value={editForm.folderurl}
                onChange={(e) => setEditForm((f) => ({ ...f, folderurl: e.target.value }))}
                placeholder="https://drive.google.com/drive/folders/..."
              />
              <p className="text-xs text-muted-foreground">
                A preview copy is created in this folder (Google API). After save we also cache a PDF on <strong>Aliyun OSS</strong> for faster repeat downloads; <strong>Preview</strong> can still generate on demand via Google if needed. Connect Google in <strong>Company Settings</strong> if preview fails.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleSave} disabled={saving}>{currentTemplate ? (saving ? "Updating..." : "Update") : (saving ? "Creating..." : "Create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
