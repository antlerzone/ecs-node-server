"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { Check, MessageSquare, Receipt, ThumbsUp, ThumbsDown, Banknote, DollarSign, Search, Eye, Upload, X, Download, FileText } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  getAdminList,
  updateFeedback,
  getPaymentVerificationInvoices,
  getPaymentVerificationInvoice,
  approvePaymentVerification,
  rejectPaymentVerification,
  uploadFile,
} from "@/lib/operator-api"
import { useOperatorContext } from "@/contexts/operator-context"

type ApprovalRowType = "Feedback" | "Payment verification" | "Deposit Refund" | "Commission (Referral)"

type ApprovalStatus = "pending" | "complete" | "successful" | "reject"

type ApprovalRow = {
  id: string
  type: ApprovalRowType
  name: string
  room: string
  amount: string
  date: string
  status: ApprovalStatus
  raw: unknown
}

type FeedbackThreadEntry = {
  role: "operator" | "tenant"
  text: string
  at?: string
  attachments?: Array<{ src: string; type: "image" | "video" }>
  /** Operator internal note when false; omitted/true = tenant can see */
  visibleToTenant?: boolean
}

type FeedbackItem = {
  id?: string
  _id?: string
  _type?: string
  description?: string
  remark?: string
  messages?: FeedbackThreadEntry[]
  done?: boolean
  _createdDate?: string
  /** JSON array or legacy single object / string from API */
  photo?: unknown
  operator_done_photo?: unknown
  operator_done_at?: string | null
  video?: string | null
  room?: { title_fld?: string }
  tenant?: { fullname?: string }
}

type PaymentVerificationItem = {
  id: string
  amount?: number
  currency?: string
  reference_number?: string
  status?: string
  created_at?: string
}

function extractReceiptUrl(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null
  const o = detail as Record<string, unknown>
  const direct = o.receipt_url
  if (typeof direct === "string" && direct.trim()) return direct.trim()
  let ocr: unknown = o.ocr_result_json
  if (typeof ocr === "string" && ocr.trim()) {
    try {
      ocr = JSON.parse(ocr) as unknown
    } catch {
      ocr = null
    }
  }
  if (ocr && typeof ocr === "object") {
    const j = ocr as Record<string, unknown>
    const u = j._url ?? j.url
    if (typeof u === "string" && u.trim()) return u.trim()
  }
  return null
}

/** PDF vs image vs unknown (OSS URLs may omit extension). */
function classifyReceiptUrl(url: string): "pdf" | "image" | "unknown" {
  const path = url.split("?")[0].toLowerCase()
  if (/\.pdf(\?|$)/i.test(path)) return "pdf"
  if (/\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)(\?|$)/i.test(path)) return "image"
  return "unknown"
}

function readPvField(detail: unknown, keys: string[]): string {
  if (!detail || typeof detail !== "object") return "—"
  const o = detail as Record<string, unknown>
  for (const k of keys) {
    const v = o[k]
    if (v != null && String(v).trim() !== "") return String(v)
  }
  return "—"
}

/** Refund / commission rows: label by operator company currency (not hardcoded MYR). */
function formatOperatorCurrencyAmount(amount: number, currencyCode: string): string {
  const code = (currencyCode || "MYR").toUpperCase()
  const sym = code === "SGD" ? "S$" : code === "MYR" ? "RM" : `${code} `
  if (Number.isNaN(amount)) return "—"
  return `${sym}${amount.toFixed(2)}`
}

function PvReceiptPreview({ url }: { url: string }) {
  const kind = classifyReceiptUrl(url)
  const [imgFailed, setImgFailed] = useState(false)

  if (kind === "pdf") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-6 border border-border rounded-lg bg-muted/20">
        <FileText className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground text-center max-w-sm">
          Receipt is a PDF. Download to open on your device.
        </p>
        <Button asChild variant="outline" className="gap-2">
          <a href={url} download target="_blank" rel="noreferrer">
            <Download className="h-4 w-4" /> Download PDF
          </a>
        </Button>
      </div>
    )
  }

  if (kind === "image") {
    return (
      <div className="flex justify-center bg-muted/30 rounded-lg border border-border overflow-hidden">
        <a href={url} target="_blank" rel="noreferrer" className="block max-h-[min(56vh,520px)] w-full">
          <img
            src={url}
            alt="Payment receipt"
            className="max-h-[min(56vh,520px)] w-full object-contain"
            referrerPolicy="no-referrer"
          />
        </a>
      </div>
    )
  }

  if (!imgFailed) {
    return (
      <div className="flex justify-center bg-muted/30 rounded-lg border border-border overflow-hidden">
        <a href={url} target="_blank" rel="noreferrer" className="block max-h-[min(56vh,520px)] w-full">
          <img
            src={url}
            alt="Payment receipt"
            className="max-h-[min(56vh,520px)] w-full object-contain"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
          />
        </a>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 border border-border rounded-lg bg-muted/20">
      <p className="text-sm text-muted-foreground text-center max-w-sm">Preview is not available for this file.</p>
      <Button asChild variant="outline" className="gap-2">
        <a href={url} download target="_blank" rel="noreferrer">
          <Download className="h-4 w-4" /> Download receipt
        </a>
      </Button>
    </div>
  )
}

function localDateYMD(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export default function ApprovalPage() {
  const { accessCtx, hasAccountingCapability } = useOperatorContext()
  const operatorCurrency = (accessCtx?.client?.currency || "MYR").toString().toUpperCase()

  const [adminItems, setAdminItems] = useState<unknown[]>([])
  const [paymentItems, setPaymentItems] = useState<PaymentVerificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [pvLoading, setPvLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("pending")
  const [searchQuery, setSearchQuery] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [pvDetailId, setPvDetailId] = useState<string | null>(null)
  const [pvDetail, setPvDetail] = useState<unknown | null>(null)
  const [pvDetailOpen, setPvDetailOpen] = useState(false)
  /** Approve PayNow + accounting (bank/cash + date) when hasAccountingCapability */
  const [pvAccountingOpen, setPvAccountingOpen] = useState(false)
  const [pvApproveTargetId, setPvApproveTargetId] = useState<string | null>(null)
  const [pvAccountingMethod, setPvAccountingMethod] = useState<"bank" | "cash">("bank")
  const [pvAccountingDate, setPvAccountingDate] = useState(() => localDateYMD())

  const [fbActiveRow, setFbActiveRow] = useState<ApprovalRow | null>(null)
  const [fbManageOpen, setFbManageOpen] = useState(false)
  /** New reply only (append); existing thread is read-only in the modal. */
  const [newReplyDraft, setNewReplyDraft] = useState("")
  /** Operator reply visibility — default shown to tenant. */
  const [replyVisibleToTenant, setReplyVisibleToTenant] = useState(true)
  type ReplyAttachment = { id: string; name: string; type: "image" | "video"; url: string; previewUrl?: string }
  const [replyAttachments, setReplyAttachments] = useState<ReplyAttachment[]>([])
  const [replyUploading, setReplyUploading] = useState(false)
  const [doneDate, setDoneDate] = useState("")
  const [doneFiles, setDoneFiles] = useState<File[]>([])

  const loadAdminList = async () => {
    setLoading(true)
    try {
      const res = await getAdminList({ filterType: "ALL", limit: 500, sort: "new" })
      setAdminItems(Array.isArray(res.items) ? res.items : [])
    } catch {
      setAdminItems([])
    } finally {
      setLoading(false)
    }
  }

  const loadPaymentVerification = async () => {
    setPvLoading(true)
    try {
      const res = await getPaymentVerificationInvoices({})
      setPaymentItems(Array.isArray(res?.data) ? res.data : [])
    } catch {
      setPaymentItems([])
    } finally {
      setPvLoading(false)
    }
  }

  useEffect(() => {
    loadAdminList()
  }, [])

  useEffect(() => {
    loadPaymentVerification()
  }, [])

  const formatDate = (d?: string) => {
    if (!d) return "—"
    try {
      return new Date(d).toLocaleDateString(undefined, { dateStyle: "short" })
    } catch {
      return d
    }
  }

  const localDateInputValue = (d = new Date()) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
  }

  /** Match backend `parsePhoto`: array, single {src|url}, or bare URL string. */
  const normalizePhotoList = (photo: unknown): Array<{ src: string; type?: string }> => {
    if (photo == null || photo === "") return []
    if (Array.isArray(photo)) {
      return photo
        .map((item) => {
          if (item == null) return null
          if (typeof item === "string") {
            const u = item.trim()
            if (u.startsWith("http://") || u.startsWith("https://")) return { src: u, type: "image" }
            return null
          }
          if (typeof item === "object" && item !== null) {
            const o = item as { src?: string; url?: string; type?: string }
            const src = (o.src || o.url || "").trim()
            if (!src) return null
            return { src, type: o.type || "image" }
          }
          return null
        })
        .filter(Boolean) as Array<{ src: string; type?: string }>
    }
    if (typeof photo === "string") {
      const s = photo.trim()
      if (!s) return []
      if (s.startsWith("http://") || s.startsWith("https://")) return [{ src: s, type: "image" }]
      try {
        const parsed = JSON.parse(s) as unknown
        return normalizePhotoList(parsed)
      } catch {
        return []
      }
    }
    if (typeof photo === "object" && photo !== null) {
      const o = photo as { src?: string; url?: string; type?: string }
      const src = (o.src || o.url || "").trim()
      if (src) return [{ src, type: o.type || "image" }]
    }
    return []
  }

  const isVideoType = (type?: string, src?: string) => {
    if (type && String(type).toLowerCase() === "video") return true
    if (!src) return false
    return /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(src)
  }

  const rows: ApprovalRow[] = useMemo(() => {
    const list: ApprovalRow[] = []
    const rawItems = adminItems as Array<Record<string, unknown>>
    rawItems.forEach((i) => {
      const _type = (i._type as string) || ""
      if (_type === "FEEDBACK") {
        const f = i as unknown as FeedbackItem
        const id = f.id ?? f._id ?? ""
        if (id) {
          const done = !!(f as { done?: boolean }).done
          list.push({
            id: `feedback-${id}`,
            type: "Feedback",
            name: (f.tenant?.fullname as string) ?? "—",
            room: (f.room?.title_fld as string) ?? "—",
            amount: "—",
            date: (f._createdDate as string) ?? "",
            status: done ? "complete" : "pending",
            raw: f,
          })
        }
      } else if (_type === "REFUND") {
        const id = (i._id ?? i.id) as string
        if (id) {
          const tenant = i.tenant as { fullname?: string }
          const room = i.room as { title_fld?: string }
          const amt = Number(i.amount)
          const done = !!(i.done ?? false)
          list.push({
            id: `refund-${id}`,
            type: "Deposit Refund",
            name: tenant?.fullname ?? "—",
            room: room?.title_fld ?? "—",
            amount: Number.isNaN(amt) ? "—" : formatOperatorCurrencyAmount(amt, operatorCurrency),
            date: (i._createdDate as string) ?? "",
            status: done ? "complete" : "pending",
            raw: i,
          })
        }
      } else if (_type === "COMMISSION_RELEASE") {
        const id = (i._id ?? i.id) as string
        if (id) {
          const amt = Number(i.commission_amount)
          const paid = (i.status as string) === "paid"
          list.push({
            id: `commission-${id}`,
            type: "Commission (Referral)",
            name: (i.tenant_name as string) ?? "—",
            room: (i.room_title as string) ?? "—",
            amount: Number.isNaN(amt) ? "—" : formatOperatorCurrencyAmount(amt, operatorCurrency),
            date: (i.due_by_date ?? i._createdDate) as string ?? "",
            status: paid ? "complete" : "pending",
            raw: i,
          })
        }
      }
    })
    paymentItems.forEach((pv) => {
      const pvStatus = (pv.status ?? "").toUpperCase()
      const status: ApprovalStatus =
        pvStatus === "PAID" ? "successful" : pvStatus === "REJECTED" ? "reject" : "pending"
      list.push({
        id: `pv-${pv.id}`,
        type: "Payment verification",
        name: "—",
        room: "—",
        amount: `${pv.currency ?? ""} ${pv.amount != null ? Number(pv.amount).toFixed(2) : "—"}`.trim() || "—",
        date: pv.created_at ?? "",
        status,
        raw: pv,
      })
    })
    list.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0
      const db = b.date ? new Date(b.date).getTime() : 0
      return db - da
    })
    return list
  }, [adminItems, paymentItems, operatorCurrency])

  const filteredRows = useMemo(() => {
    let out = rows
    if (statusFilter !== "all") {
      if (statusFilter === "complete" || statusFilter === "successful") {
        out = out.filter((r) => r.status === "complete" || r.status === "successful")
      } else {
        out = out.filter((r) => r.status === statusFilter)
      }
    }
    if (typeFilter !== "all") out = out.filter((r) => r.type === typeFilter)
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      out = out.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.room.toLowerCase().includes(q) ||
          r.amount.toLowerCase().includes(q) ||
          r.type.toLowerCase().includes(q)
      )
    }
    if (dateFrom) {
      const from = new Date(dateFrom)
      from.setHours(0, 0, 0, 0)
      out = out.filter((r) => {
        if (!r.date) return false
        const d = new Date(r.date)
        d.setHours(0, 0, 0, 0)
        return d >= from
      })
    }
    if (dateTo) {
      const to = new Date(dateTo)
      to.setHours(23, 59, 59, 999)
      out = out.filter((r) => {
        if (!r.date) return false
        const d = new Date(r.date)
        return d <= to
      })
    }
    return out
  }, [rows, typeFilter, statusFilter, searchQuery, dateFrom, dateTo])

  const formatThreadTime = (at?: string) => {
    if (!at) return ""
    try {
      return new Date(at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
    } catch {
      return at
    }
  }

  const openFeedbackManage = (row: ApprovalRow) => {
    setFbActiveRow(row)
    setNewReplyDraft("")
    setReplyVisibleToTenant(true)
    setReplyAttachments([])
    setReplyUploading(false)
    setDoneDate(localDateInputValue(new Date()))
    setDoneFiles([])
    setFbManageOpen(true)
  }

  const closeFeedbackModal = () => {
    setFbManageOpen(false)
    setFbActiveRow(null)
    setNewReplyDraft("")
    setReplyVisibleToTenant(true)
    setReplyAttachments([])
    setReplyUploading(false)
    setDoneDate("")
    setDoneFiles([])
  }

  const removeReplyAttachment = (id: string) => {
    setReplyAttachments((prev) => {
      const a = prev.find((x) => x.id === id)
      if (a?.previewUrl) URL.revokeObjectURL(a.previewUrl)
      return prev.filter((x) => x.id !== id)
    })
  }

  const uploadReplyFiles = async (files: File[]) => {
    if (!files.length) return
    setReplyUploading(true)
    const newAttachments: ReplyAttachment[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const isVideo = file.type.startsWith("video/")
        const isImage = file.type.startsWith("image/")
        if (!isImage && !isVideo) continue
        const previewUrl = URL.createObjectURL(file)
        const up = await uploadFile(file)
        if (up.ok && up.url) {
          newAttachments.push({
            id: `${Date.now()}-${i}`,
            name: file.name,
            type: isVideo ? "video" : "image",
            url: up.url,
            previewUrl,
          })
        }
      }
      setReplyAttachments((prev) => [...prev, ...newAttachments])
    } finally {
      setReplyUploading(false)
    }
  }

  const handleReplyFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    e.target.value = ""
    if (!files.length) return
    try {
      await uploadReplyFiles(files)
    } catch (err) {
      console.error(err)
      alert("Could not upload attachment.")
    }
  }

  const handleReplyPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const cd = e.clipboardData
    if (!cd) return
    const textPlain = (cd.getData("text/plain") || "").trim()
    const files: File[] = []
    const items = Array.from(cd.items || [])
    for (const item of items) {
      if (item.kind !== "file") continue
      const file = item.getAsFile()
      if (!file) continue
      if (file.type.startsWith("image/") || file.type.startsWith("video/")) files.push(file)
    }
    if (!files.length) return
    e.preventDefault()
    if (textPlain) {
      setNewReplyDraft((d) => (d ? `${d}\n${textPlain}` : textPlain))
    }
    await uploadReplyFiles(files)
  }

  const submitFeedbackReply = async () => {
    if (!fbActiveRow) return
    const text = newReplyDraft.trim()
    const attachmentsPayload = replyAttachments.map((a) => ({ src: a.url, type: a.type }))
    const hasText = !!text
    const hasAttachments = attachmentsPayload.length > 0
    if (!hasText && !hasAttachments) {
      alert("Type a message or attach a photo/video.")
      return
    }
    const fid = fbActiveRow.id.replace(/^feedback-/, "")
    setActionLoading(fbActiveRow.id)
    try {
      const res = await updateFeedback(fid, {
        message_append: {
          text,
          visibleToTenant: replyVisibleToTenant,
          attachments: attachmentsPayload.length ? attachmentsPayload : undefined,
        },
      })
      if (!res.ok) {
        if (res.reason === "NEEDS_MIGRATION_0134") {
          throw new Error("Database migration required: run 0134_feedback_messages_json.sql")
        }
        throw new Error(res.reason || "UPDATE_FAILED")
      }
      await loadAdminList()
      const at = new Date().toISOString()
      setFbActiveRow((prev) => {
        if (!prev) return null
        const raw = prev.raw as FeedbackItem
        const prevMsgs = (raw.messages as FeedbackThreadEntry[]) || []
        const entry: FeedbackThreadEntry = attachmentsPayload.length
          ? { role: "operator", text, at, visibleToTenant: replyVisibleToTenant, attachments: attachmentsPayload }
          : { role: "operator", text, at, visibleToTenant: replyVisibleToTenant }
        const merged = [...prevMsgs, entry]
        const previewFromMsg = (m: FeedbackThreadEntry) => {
          const tx = (m.text || "").trim()
          if (tx) return tx
          if (Array.isArray(m.attachments) && m.attachments.length) {
            return m.attachments[0].type === "video" ? "Video attached" : "Photo attached"
          }
          return ""
        }
        let remarkOut = raw.remark ?? ""
        for (let i = merged.length - 1; i >= 0; i--) {
          const m = merged[i]
          if (m.role === "tenant" || (m.role === "operator" && m.visibleToTenant !== false)) {
            remarkOut = previewFromMsg(m)
            break
          }
        }
        return {
          ...prev,
          raw: { ...raw, messages: merged, remark: remarkOut },
        }
      })
      setNewReplyDraft("")
      setReplyAttachments([])
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : "Failed to save reply")
    } finally {
      setActionLoading(null)
    }
  }

  const submitFeedbackDone = async () => {
    if (!fbActiveRow) return
    const fid = fbActiveRow.id.replace(/^feedback-/, "")
    if (!doneDate) {
      alert("Please choose a date.")
      return
    }
    setActionLoading(fbActiveRow.id)
    try {
      const uploaded: string[] = []
      for (const f of doneFiles) {
        const up = await uploadFile(f)
        if (!up.ok || !up.url) {
          throw new Error(up.reason || "UPLOAD_FAILED")
        }
        uploaded.push(up.url)
      }

      const operator_done_at = new Date(`${doneDate}T12:00:00`).toISOString()
      const replyText = newReplyDraft.trim()
      const attachmentsPayload = replyAttachments.map((a) => ({ src: a.url, type: a.type }))
      const hasReply = !!replyText || attachmentsPayload.length > 0
      const operatorDonePhotos = uploaded.map((url) => ({ src: url, type: "image" }))
      const res = await updateFeedback(fid, {
        done: true,
        ...(hasReply
          ? {
              message_append: {
                text: replyText,
                visibleToTenant: replyVisibleToTenant,
                attachments: attachmentsPayload.length ? attachmentsPayload : undefined,
              },
            }
          : {}),
        operator_done_at,
        ...(operatorDonePhotos.length ? { operator_done_photo_append: operatorDonePhotos } : {}),
      })
      if (!res.ok) {
        if (res.reason === "NEEDS_MIGRATION_0132") {
          throw new Error("Database migration required: run 0132_feedback_operator_done_proof.sql")
        }
        if (res.reason === "NEEDS_MIGRATION_0134") {
          throw new Error("Database migration required: run 0134_feedback_messages_json.sql")
        }
        throw new Error(res.reason || "MARK_DONE_FAILED")
      }
      await loadAdminList()
      closeFeedbackModal()
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : "Failed to mark as done")
    } finally {
      setActionLoading(null)
    }
  }

  const requestPvApprove = (id: string) => {
    if (hasAccountingCapability) {
      setPvApproveTargetId(id)
      setPvAccountingMethod("bank")
      setPvAccountingDate(localDateYMD())
      setPvAccountingOpen(true)
      return
    }
    void executePvApprove(id)
  }

  const executePvApprove = async (
    id: string,
    accounting?: { method: "bank" | "cash"; date: string }
  ) => {
    const pvId = id.replace(/^pv-/, "")
    setActionLoading(id)
    try {
      const res = await approvePaymentVerification(
        pvId,
        accounting
          ? { accounting_method: accounting.method, accounting_payment_date: accounting.date }
          : undefined
      )
      if (!res?.ok) {
        alert((res as { reason?: string })?.reason || "Approve failed.")
        return
      }
      setPvDetailId(null)
      setPvDetail(null)
      setPvDetailOpen(false)
      setPvAccountingOpen(false)
      setPvApproveTargetId(null)
      await loadPaymentVerification()
    } finally {
      setActionLoading(null)
    }
  }

  const confirmPvAccountingApprove = () => {
    if (!pvApproveTargetId || !pvAccountingDate.trim()) return
    void executePvApprove(pvApproveTargetId, {
      method: pvAccountingMethod,
      date: pvAccountingDate.trim().slice(0, 10),
    })
  }

  const handlePvReject = async (id: string) => {
    if (!confirm("Reject this payment verification? The invoice will be marked REJECTED.")) return
    const pvId = id.replace(/^pv-/, "")
    setActionLoading(id)
    try {
      await rejectPaymentVerification(pvId)
      setPvDetailId(null)
      setPvDetail(null)
      setPvDetailOpen(false)
      await loadPaymentVerification()
    } finally {
      setActionLoading(null)
    }
  }

  const openPvDetail = async (id: string) => {
    const pvId = id.replace(/^pv-/, "")
    setPvDetailId(pvId)
    setPvDetailOpen(true)
    try {
      const res = await getPaymentVerificationInvoice(pvId)
      setPvDetail(res?.data ?? null)
    } catch {
      setPvDetail(null)
    }
  }

  const closePvDetail = () => {
    setPvDetailOpen(false)
    setPvDetailId(null)
    setPvDetail(null)
  }

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Approval</h1>
        <p className="text-sm text-muted-foreground">Feedback, payment verification, deposit refunds, and commission (referral) in one table.</p>
      </div>

      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-border space-y-3">
          <p className="text-sm font-medium text-foreground">Filters</p>
          <p className="text-xs text-muted-foreground">
            After you mark Feedback as done, it disappears from Pending — set Status to <span className="font-medium">Complete / Successful</span> to
            view resolved items.
          </p>
          <div className="flex flex-wrap items-center gap-4">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="complete">Complete / Successful (incl. resolved Feedback)</SelectItem>
              <SelectItem value="reject">Reject</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="Feedback">Feedback</SelectItem>
              <SelectItem value="Payment verification">Payment verification</SelectItem>
              <SelectItem value="Deposit Refund">Deposit Refund</SelectItem>
              <SelectItem value="Commission (Referral)">Commission (Referral)</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by name, room, amount, type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              placeholder="From"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-[140px] h-9"
            />
            <span className="text-muted-foreground text-sm">to</span>
            <Input
              type="date"
              placeholder="To"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-[140px] h-9"
            />
          </div>
          </div>
        </div>

        {loading || pvLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : filteredRows.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No approval items.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[140px]">Type</TableHead>
                <TableHead className="w-[100px]">Date</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Room</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="min-w-[160px]">Remark</TableHead>
                <TableHead className="w-[140px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row) => {
                const busy = actionLoading === row.id
                const statusLabel = row.status === "successful" ? "Successful" : row.status === "reject" ? "Reject" : row.status === "complete" ? "Complete" : "Pending"
                const pvNeedsAction = row.type === "Payment verification" && row.status === "pending"
                return (
                  <TableRow key={row.id} className="cursor-default">
                    <TableCell className="whitespace-nowrap text-muted-foreground">{statusLabel}</TableCell>
                    <TableCell className="font-medium">
                      {row.type === "Feedback" && <MessageSquare size={14} className="inline mr-1 text-muted-foreground" />}
                      {row.type === "Payment verification" && <Receipt size={14} className="inline mr-1 text-muted-foreground" />}
                      {row.type === "Deposit Refund" && <Banknote size={14} className="inline mr-1 text-muted-foreground" />}
                      {row.type === "Commission (Referral)" && <DollarSign size={14} className="inline mr-1 text-muted-foreground" />}
                      {row.type}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.date)}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>{row.room}</TableCell>
                    <TableCell className="text-right">{row.amount}</TableCell>
                    <TableCell>
                      {row.type === "Feedback" ? (
                        <div className="max-w-[260px] truncate text-sm text-muted-foreground" title={(row.raw as FeedbackItem).remark || ""}>
                          {(row.raw as FeedbackItem).remark?.trim() ? (row.raw as FeedbackItem).remark : "—"}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {row.type === "Feedback" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-xs"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            openFeedbackManage(row)
                          }}
                          disabled={busy}
                        >
                          {(row.raw as FeedbackItem).done ? (
                            <>
                              <Eye size={12} /> View
                            </>
                          ) : (
                            <>
                              <MessageSquare size={12} /> + Reply
                            </>
                          )}
                        </Button>
                      )}
                      {row.type === "Payment verification" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 text-xs"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              openPvDetail(row.id)
                            }}
                            disabled={busy}
                          >
                            <Eye size={12} /> Detail
                          </Button>
                          {pvNeedsAction ? (
                            <>
                              <Button
                                size="sm"
                                className="gap-1 text-xs bg-green-600 hover:bg-green-700"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  requestPvApprove(row.id)
                                }}
                                disabled={busy}
                              >
                                <ThumbsUp size={12} /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 text-xs text-destructive"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  handlePvReject(row.id)
                                }}
                                disabled={busy}
                              >
                                <ThumbsDown size={12} /> Reject
                              </Button>
                            </>
                          ) : null}
                        </>
                      )}
                      {row.type === "Deposit Refund" && (
                        <Link href="/operator/refund" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="outline" className="gap-1 text-xs">
                            Process
                          </Button>
                        </Link>
                      )}
                      {row.type === "Commission (Referral)" && (
                        <Link href="/operator/commission" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="outline" className="gap-1 text-xs">
                            Process
                          </Button>
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog
        open={fbManageOpen}
        onOpenChange={(open) => {
          if (!open) closeFeedbackModal()
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {fbActiveRow && (fbActiveRow.raw as FeedbackItem).done ? "Feedback (resolved)" : "Handle feedback"}
            </DialogTitle>
            <DialogDescription>
              Review the tenant submission, add a reply, and optionally mark complete (date + proof photos). Resolved items no longer appear under
              Pending — use the status filter above.
            </DialogDescription>
          </DialogHeader>
          {fbActiveRow && (
            <div className="space-y-6">
              {(() => {
                const f = fbActiveRow.raw as FeedbackItem
                const tenantItems = normalizePhotoList(f.photo)
                const tenantImages = tenantItems.filter((it) => !isVideoType(it.type, it.src))
                const tenantVideosFromPhoto = tenantItems.filter((it) => isVideoType(it.type, it.src))
                const standaloneVideo = (f.video && String(f.video).trim()) || ""
                const opPhotos = normalizePhotoList(f.operator_done_photo)
                const isDone = !!f.done
                const hasAnyTenantMedia =
                  tenantImages.length > 0 || tenantVideosFromPhoto.length > 0 || !!standaloneVideo
                return (
                  <>
                    <div className="space-y-3 rounded-md border border-border p-3 bg-muted/20">
                      <p className="text-xs font-semibold text-muted-foreground">Tenant submission</p>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Description</p>
                        <p className="text-sm whitespace-pre-wrap">{f.description?.trim() ? f.description : "—"}</p>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Tenant uploads</p>
                        {!hasAnyTenantMedia ? (
                          <p className="text-sm text-muted-foreground">No photos or video attached.</p>
                        ) : null}
                        {tenantImages.length > 0 ? (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {tenantImages.map((p, idx) => (
                              <a key={`ti-${idx}`} href={p.src} target="_blank" rel="noreferrer" className="block">
                                <img src={p.src} alt="Tenant" className="w-full h-28 object-cover rounded-md border border-border" />
                              </a>
                            ))}
                          </div>
                        ) : null}
                        {(tenantVideosFromPhoto.length > 0 || standaloneVideo) && (
                          <div className="flex flex-col gap-1">
                            {standaloneVideo ? (
                              <a href={standaloneVideo} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary underline">
                                Open tenant video
                              </a>
                            ) : null}
                            {tenantVideosFromPhoto.map((v, idx) => (
                              <a
                                key={`tv-${idx}`}
                                href={v.src}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sm font-medium text-primary underline"
                              >
                                Open video {tenantVideosFromPhoto.length > 1 ? `(${idx + 1})` : ""}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label>Conversation</Label>
                      <div className="rounded-md border border-border p-3 bg-muted/20 max-h-[220px] overflow-y-auto space-y-3">
                        {Array.isArray(f.messages) && f.messages.length > 0 ? (
                          f.messages.map((m, idx) => (
                            <div
                              key={`${m.at ?? idx}-${idx}`}
                              className={`text-sm rounded-md p-2 border border-border/60 ${
                                m.role === "operator" ? "bg-background ml-4" : "bg-secondary/40 mr-4"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                                <span className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                    {m.role === "operator" ? "Operator" : "Tenant"}
                                  </span>
                                  {m.role === "operator" && m.visibleToTenant === false ? (
                                    <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border border-amber-500/50 bg-amber-500/15 text-amber-900 dark:text-amber-200">
                                      Internal
                                    </span>
                                  ) : null}
                                </span>
                                {m.at ? (
                                  <span className="text-[10px] text-muted-foreground">{formatThreadTime(m.at)}</span>
                                ) : null}
                              </div>
                              {m.text?.trim() ? <p className="whitespace-pre-wrap text-foreground">{m.text}</p> : null}
                              {Array.isArray(m.attachments) && m.attachments.length ? (
                                <div className="mt-2 space-y-2">
                                  {m.attachments.map((att, aIdx) =>
                                    att.type === "video" ? (
                                      <video
                                        key={aIdx}
                                        src={att.src}
                                        className="w-full max-w-[320px] rounded-md border border-border"
                                        controls
                                      />
                                    ) : (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        key={aIdx}
                                        src={att.src}
                                        alt="attachment"
                                        className="w-full max-w-[320px] rounded-md border border-border object-cover"
                                      />
                                    )
                                  )}
                                </div>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">No messages yet — add a reply below.</p>
                        )}
                      </div>

                      {!isDone ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <Label htmlFor="fb-new-reply">New reply</Label>
                            <input
                              id="fb-reply-attachments"
                              type="file"
                              accept="image/*,video/*"
                              multiple
                              className="hidden"
                              onChange={handleReplyFileUpload}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="p-2"
                              disabled={replyUploading || actionLoading === fbActiveRow?.id}
                              onClick={() => {
                                const el = document.getElementById("fb-reply-attachments") as HTMLInputElement | null
                                el?.click()
                              }}
                              aria-label="Attach photo/video"
                            >
                              <Upload size={14} />
                            </Button>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] text-muted-foreground font-normal">Visibility</Label>
                            <Select
                              value={replyVisibleToTenant ? "tenant" : "internal"}
                              onValueChange={(v) => setReplyVisibleToTenant(v === "tenant")}
                            >
                              <SelectTrigger id="fb-reply-visibility" className="w-full max-w-md h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="tenant">Visible to tenant</SelectItem>
                                <SelectItem value="internal">Not visible to tenant (internal note)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Textarea
                            id="fb-new-reply"
                            value={newReplyDraft}
                            onChange={(e) => setNewReplyDraft(e.target.value)}
                            onPaste={handleReplyPaste}
                            rows={3}
                            placeholder="Type a new message (appends to the thread; does not replace older replies)…"
                            className="min-h-[88px]"
                          />
                          {replyAttachments.length ? (
                            <div className="flex flex-wrap gap-2 pt-1">
                              {replyAttachments.map((att) => (
                                <div key={att.id} className="relative">
                                  {att.type === "video" ? (
                                    <video
                                      src={att.url}
                                      className="w-20 h-14 object-cover rounded-md border border-border"
                                      controls
                                    />
                                  ) : (
                                    <img src={att.previewUrl || att.url} alt={att.name} className="w-20 h-14 object-cover rounded-md border border-border" />
                                  )}
                                  <button
                                    type="button"
                                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-90"
                                    onClick={() => removeReplyAttachment(att.id)}
                                    aria-label="Remove attachment"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            style={{ background: "var(--brand)", color: "var(--primary-foreground)" }}
                            className="gap-1"
                            onClick={submitFeedbackReply}
                            disabled={replyUploading || actionLoading === fbActiveRow?.id}
                          >
                            <MessageSquare size={14} /> Post reply
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-3 rounded-md border border-border p-3">
                      <p className="text-xs font-semibold text-muted-foreground">Mark as done</p>
                      {isDone ? (
                        <>
                          <p className="text-sm text-muted-foreground">
                            Completed on: {f.operator_done_at ? formatDate(f.operator_done_at) : "—"}
                          </p>
                          {opPhotos.length ? (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {opPhotos.map((p, idx) => (
                                <a key={`o-${idx}`} href={p.src} target="_blank" rel="noreferrer" className="block">
                                  <img src={p.src} alt="Operator proof" className="w-full h-28 object-cover rounded-md border border-border" />
                                </a>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">No operator proof photos.</p>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="space-y-2">
                            <Label htmlFor="fb-done-date">Completion date</Label>
                            <Input id="fb-done-date" type="date" value={doneDate} onChange={(e) => setDoneDate(e.target.value)} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="fb-done-photo">Proof photo(s) (optional)</Label>
                            <Input
                              id="fb-done-photo"
                              type="file"
                              accept="image/*"
                              multiple
                              onChange={(e) => setDoneFiles(Array.from(e.target.files ?? []))}
                            />
                            {doneFiles.length > 0 && (
                              <p className="text-xs text-muted-foreground">{doneFiles.length} file(s) selected</p>
                            )}
                          </div>
                          <Button
                            type="button"
                            style={{ background: "var(--brand)" }}
                            className="gap-1"
                            onClick={submitFeedbackDone}
                            disabled={actionLoading === fbActiveRow.id}
                          >
                            <Check size={14} /> Mark as done (includes new reply above, if any)
                          </Button>
                        </>
                      )}
                    </div>
                  </>
                )
              })()}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeFeedbackModal} disabled={fbActiveRow != null && actionLoading === fbActiveRow.id}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pvDetailOpen}
        onOpenChange={(open) => {
          if (!open) closePvDetail()
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Payment verification detail</DialogTitle>
            <DialogDescription>
              {(() => {
                const st = pvDetail && typeof pvDetail === "object" ? String((pvDetail as { status?: string }).status || "").trim().toUpperCase() : ""
                if (st === "PAID") return "This payment is verified (PAID). Tenant rent lines are marked paid when applicable."
                if (st === "REJECTED") return "This verification was rejected."
                return "Review the uploaded receipt and key fields. Approve or reject when ready."
              })()}
            </DialogDescription>
          </DialogHeader>
          {!pvDetail ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Amount</p>
                  <p className="font-medium tabular-nums">
                    {readPvField(pvDetail, ["currency"]) !== "—" ? `${readPvField(pvDetail, ["currency"])} ` : ""}
                    {readPvField(pvDetail, ["amount"])}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="font-medium">{readPvField(pvDetail, ["status"])}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Reference</p>
                  <p className="font-medium break-all">{readPvField(pvDetail, ["reference_number", "referenceNumber"])}</p>
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <p className="text-xs text-muted-foreground">Submitted</p>
                  <p className="font-medium">{readPvField(pvDetail, ["created_at", "createdAt"])}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Receipt</p>
                {(() => {
                  const receiptUrl = extractReceiptUrl(pvDetail)
                  if (!receiptUrl) {
                    return <p className="text-sm text-muted-foreground">No receipt file on record.</p>
                  }
                  return <PvReceiptPreview url={receiptUrl} />
                })()}
              </div>
              {(() => {
                const cands = (pvDetail as { candidate_transactions?: unknown[] }).candidate_transactions
                if (!Array.isArray(cands) || cands.length === 0) return null
                return (
                  <p className="text-xs text-muted-foreground">
                    {cands.length} candidate bank transaction(s) in range — compare with the receipt before approving.
                  </p>
                )
              })()}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={closePvDetail}>
              Close
            </Button>
            {pvDetailId && pvDetail && typeof pvDetail === "object" ? (() => {
              const st = String((pvDetail as { status?: string }).status || "").trim().toUpperCase()
              const canAct = st !== "PAID" && st !== "REJECTED"
              if (!canAct) return null
              return (
                <>
                  <Button className="bg-green-600 hover:bg-green-700" onClick={() => requestPvApprove(`pv-${pvDetailId}`)} disabled={!!actionLoading}>
                    Approve
                  </Button>
                  <Button variant="outline" className="text-destructive" onClick={() => handlePvReject(`pv-${pvDetailId}`)} disabled={!!actionLoading}>
                    Reject
                  </Button>
                </>
              )
            })() : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pvAccountingOpen} onOpenChange={(open) => !open && setPvAccountingOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record payment in accounting</DialogTitle>
            <DialogDescription>
              Choose bank or cash and the payment date for Bukku / Xero receipt posting. Required when your company uses accounting.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Method</Label>
              <Select value={pvAccountingMethod} onValueChange={(v) => setPvAccountingMethod(v === "cash" ? "cash" : "bank")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">Bank</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pv-accounting-date">Payment date</Label>
              <Input
                id="pv-accounting-date"
                type="date"
                value={pvAccountingDate}
                onChange={(e) => setPvAccountingDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPvAccountingOpen(false)}>
              Cancel
            </Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={confirmPvAccountingApprove} disabled={!!actionLoading || !pvAccountingDate}>
              Approve &amp; post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </main>
  )
}
