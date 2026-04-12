"use client"

import { useState, useEffect, useMemo } from "react"
import { MessageSquare, CheckCircle2, Clock, Send, Upload, X, Image, Video, Plus } from "lucide-react"
import { useTenantOptional } from "@/contexts/tenant-context"
import { feedback, feedbackAppendMessage, feedbackList, uploadFile } from "@/lib/tenant-api"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

const categories = ["General", "Maintenance", "Billing", "Noise Complaint", "Other"]

interface Attachment {
  id: string
  name: string
  type: "image" | "video"
  url: string
  previewUrl?: string
}

export default function FeedbackPage() {
  const state = useTenantOptional()
  const tenancies = (state?.tenancies ?? []) as { id?: string; _id?: string; room?: { _id?: string }; property?: { _id?: string }; client?: { _id?: string } }[]
  const selectedTenancyId = state?.selectedTenancyId ?? null
  const setSelectedTenancyId = state?.setSelectedTenancyId
  const currentTenancyForFeedback =
    tenancies.find((t) => (t.id ?? t._id) === selectedTenancyId) ?? tenancies[0]
  const tenancyReadOnly = !!(currentTenancyForFeedback as { isPortalReadOnly?: boolean } | undefined)?.isPortalReadOnly
  const [category, setCategory] = useState("General")
  const [title, setTitle] = useState("")
  const [message, setMessage] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  type ThreadAttachment = { src: string; type: "image" | "video" }
  type ThreadMsg = { role: "operator" | "tenant"; text: string; at?: string; attachments?: ThreadAttachment[] }

  const [previousFeedback, setPreviousFeedback] = useState<{
    id: string
    tenancyId?: string | null
    category: string
    title: string
    details?: string
    date: string
    status: string
    /** Operator marked feedback done — no further tenant comments (server-enforced). */
    done: boolean
    reply: string | null
    messages: ThreadMsg[]
    attachments: string[]
    videoUrl: string | null
  }[]>([])

  const [activeCase, setActiveCase] = useState<(typeof previousFeedback)[number] | null>(null)
  const [caseDialogOpen, setCaseDialogOpen] = useState(false)
  const [commentDraft, setCommentDraft] = useState("")
  const [commentSending, setCommentSending] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const [commentAttachments, setCommentAttachments] = useState<Attachment[]>([])
  const [commentUploading, setCommentUploading] = useState(false)

  const feedbackCaseReadOnly = useMemo(() => {
    if (!activeCase) return tenancyReadOnly
    const tid = activeCase.tenancyId
    if (tid == null || tid === "") return tenancyReadOnly
    const meta = tenancies.find((t) => (t.id ?? t._id) === tid)
    return !!(meta as { isPortalReadOnly?: boolean } | undefined)?.isPortalReadOnly
  }, [activeCase, tenancies, tenancyReadOnly])

  useEffect(() => {
    feedbackList()
      .then((res) => {
        const items = (res?.items ?? []) as Array<{
          _id?: string
          id?: string
          category?: string
          title?: string
          description?: string
          done?: boolean
          remark?: string
          messages?: ThreadMsg[]
          _createdDate?: string
          photo?: unknown[]
          video?: string | null
        }>
        setPreviousFeedback(
          items.map((fb) => {
            const rawMsgs = Array.isArray(fb.messages) ? fb.messages : []
            const messages: ThreadMsg[] = rawMsgs
              .filter((m) => {
                if (!m || (m.role !== "operator" && m.role !== "tenant")) return false
                const textTrim = String(m.text || "").trim()
                const hasAttachments = Array.isArray((m as any).attachments) && (m as any).attachments.length > 0
                return !!textTrim || hasAttachments
              })
              .map((m) => {
                const atts = Array.isArray((m as any).attachments)
                  ? (m as any).attachments
                      .map((a: any) => {
                        if (!a) return null
                        if (typeof a === "string") {
                          const src = a.trim()
                          if (!src) return null
                          const type: "image" | "video" = /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(src) ? "video" : "image"
                          return { src, type }
                        }
                        const src = (a.src || a.url || "").toString().trim()
                        if (!src) return null
                        const type: "image" | "video" = a.type ? (String(a.type) as any) : /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(src) ? "video" : "image"
                        return { src, type }
                      })
                      .filter(Boolean)
                  : undefined

                return {
                  role: m.role as "operator" | "tenant",
                  text: String(m.text || "").trim(),
                  at: m.at,
                  ...(atts && atts.length ? { attachments: atts as ThreadAttachment[] } : {}),
                }
              })
              .sort((a, b) => (Date.parse(a.at || "") || 0) - (Date.parse(b.at || "") || 0))
            const done = !!(fb as { done?: boolean }).done
            return {
              id: fb._id ?? fb.id ?? "",
              tenancyId: (fb as { tenancyId?: string | null }).tenancyId ?? null,
              category: fb.category ?? "General",
              title: fb.title ?? (fb.description ? String(fb.description).split("\n")[1] : "") ?? "—",
              details:
                (fb as unknown as { details?: string }).details ??
                (fb.description ? String(fb.description).split("\n").slice(2).join("\n") : "") ??
                "",
              date: fb._createdDate
                ? new Date(fb._createdDate).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })
                : "—",
              status: done ? "resolved" : "pending",
              done,
              reply: fb.remark ?? null,
              messages,
              attachments: Array.isArray(fb.photo)
                ? fb.photo.map((p: { src?: string; url?: string }) => p?.src ?? p?.url ?? "").filter(Boolean)
                : [],
              videoUrl: (fb as unknown as { video?: string | null }).video ?? null,
            }
          })
        )
      })
      .catch(() => setPreviousFeedback([]))
  }, [submitted])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    setUploading(true)
    const newAttachments: Attachment[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const isVideo = file.type.startsWith("video/")
      const isImage = file.type.startsWith("image/")
      if (!isImage && !isVideo) continue
      const previewUrl = URL.createObjectURL(file)
      const result = await uploadFile(file)
      if (result.ok && result.url) {
        newAttachments.push({
          id: `${Date.now()}-${i}`,
          name: file.name,
          type: isVideo ? "video" : "image",
          url: result.url,
          previewUrl,
        })
      }
    }
    setAttachments((prev) => [...prev, ...newAttachments])
    e.target.value = ""
    setUploading(false)
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const a = prev.find((x) => x.id === id)
      if (a?.previewUrl) URL.revokeObjectURL(a.previewUrl)
      return prev.filter((x) => x.id !== id)
    })
  }

  const removeCommentAttachment = (id: string) => {
    setCommentAttachments((prev) => {
      const a = prev.find((x) => x.id === id)
      if (a?.previewUrl) URL.revokeObjectURL(a.previewUrl)
      return prev.filter((x) => x.id !== id)
    })
  }

  const uploadCommentFiles = async (files: File[]) => {
    if (!files.length) return
    setCommentUploading(true)
    const newAttachments: Attachment[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const isVideo = file.type.startsWith("video/")
        const isImage = file.type.startsWith("image/")
        if (!isImage && !isVideo) continue
        const previewUrl = URL.createObjectURL(file)
        const result = await uploadFile(file)
        if (result.ok && result.url) {
          newAttachments.push({
            id: `${Date.now()}-${i}`,
            name: file.name,
            type: isVideo ? "video" : "image",
            url: result.url,
            previewUrl,
          })
        }
      }
      setCommentAttachments((prev) => [...prev, ...newAttachments])
    } finally {
      setCommentUploading(false)
    }
  }

  const handleCommentFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    // allow picking the same file again
    e.target.value = ""
    if (!files.length) return
    try {
      setCommentError(null)
      await uploadCommentFiles(files)
    } catch {
      setCommentError("Could not upload attachment.")
    }
  }

  const handleCommentPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
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
    // Prevent the browser from inserting image data into the textarea.
    e.preventDefault()
    if (textPlain) {
      setCommentDraft((d) => (d ? `${d}\n${textPlain}` : textPlain))
    }
    setCommentError(null)
    await uploadCommentFiles(files)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (tenancyReadOnly) return
    const tenancyId = selectedTenancyId ?? tenancies[0]?.id ?? tenancies[0]?._id
    if (!tenancyId) {
      setSubmitError("Please select a tenancy.")
      return
    }
    const description = [category, title, message].filter(Boolean).join("\n")
    if (!description.trim()) {
      setSubmitError("Please enter subject or details.")
      return
    }
    setSubmitError(null)
    setSubmitLoading(true)
    try {
      const photo = attachments.filter((a) => a.type === "image").map((a) => ({ src: a.url, type: "image" as const }))
      const video = attachments.find((a) => a.type === "video")?.url
      const tenancy = tenancies.find((t) => (t.id ?? t._id) === tenancyId)
      const res = await feedback({
        tenancyId,
        roomId: tenancy?.room?._id ?? tenancy?.room ?? undefined,
        propertyId: tenancy?.property?._id ?? tenancy?.property ?? undefined,
        clientId: tenancy?.client?._id ?? tenancy?.client ?? undefined,
        description,
        photo: photo.length ? photo : undefined,
        video: video || undefined,
      })
      if (res?.ok) {
        setSubmitted(true)
        setTitle("")
        setMessage("")
        setAttachments([])
        setTimeout(() => setSubmitted(false), 3000)
      } else {
        setSubmitError((res as { reason?: string }).reason || "Submit failed.")
      }
    } catch {
      setSubmitError("Submit failed.")
    } finally {
      setSubmitLoading(false)
    }
  }

  return (
    <>
      <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-foreground">Feedback & Support</h1>
        <p className="text-muted-foreground mt-1">Submit maintenance requests or general feedback.</p>
      </div>

      {tenancies.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {tenancies.map((t) => {
            const id = t.id ?? t._id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSelectedTenancyId?.(id ?? null)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium",
                  selectedTenancyId === id ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-secondary/80"
                )}
              >
                {id}
              </button>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Submit Form */}
        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "var(--brand-muted)" }}>
              <Send size={15} style={{ color: "var(--brand)" }} />
            </div>
            <h2 className="font-bold text-foreground">New Request</h2>
          </div>

          {submitted ? (
            <div className="flex flex-col items-center gap-4 py-10">
              <CheckCircle2 size={48} className="text-emerald-500" />
              <div className="text-center">
                <div className="font-bold text-foreground mb-1">Request Submitted!</div>
                <div className="text-sm text-muted-foreground">Our team will respond within 24 hours.</div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {tenancyReadOnly ? (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  This tenancy is ended. You can read past requests, but new submissions and comments are disabled.
                </p>
              ) : null}
              {/* Category */}
              <div>
                <label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Category
                </label>
                <div className="flex flex-wrap gap-2">
                  {categories.map((c) => (
                    <button
                      type="button"
                      key={c}
                      disabled={tenancyReadOnly}
                      onClick={() => setCategory(c)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
                        category === c
                          ? "text-white border-transparent"
                          : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                      )}
                      style={category === c ? { background: "var(--brand)", borderColor: "var(--brand)" } : undefined}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Subject
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Brief description of your issue"
                  required
                  disabled={tenancyReadOnly}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
                />
              </div>

              {/* Message */}
              <div>
                <label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Details
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Provide more details about your request..."
                  required
                  rows={4}
                  disabled={tenancyReadOnly}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background text-foreground focus:outline-none resize-none disabled:opacity-50"
                />
              </div>

              {/* Photo/Video Upload */}
              <div>
                <label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Attachments (Optional)
                </label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {attachments.map((att) => (
                    <div key={att.id} className="relative group">
                      {att.type === "image" ? (
                        <img src={att.previewUrl || att.url} alt={att.name} className="w-20 h-20 object-cover rounded-lg border border-border" />
                      ) : (
                        <video src={att.previewUrl || att.url} className="w-20 h-20 object-cover rounded-lg border border-border" />
                      )}
                      <button
                        type="button"
                        onClick={() => removeAttachment(att.id)}
                        disabled={tenancyReadOnly}
                        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30"
                      >
                        <X size={12} />
                      </button>
                      <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-foreground/80 text-white text-[8px] font-bold uppercase">
                        {att.type === "image" ? <Image size={10} /> : <Video size={10} />}
                      </div>
                    </div>
                  ))}
                </div>
                <label
                  className={cn(
                    "flex items-center justify-center w-full h-24 border-2 border-dashed border-border rounded-xl transition-colors bg-secondary/30",
                    tenancyReadOnly ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-primary"
                  )}
                >
                  <div className="flex flex-col items-center">
                    <Upload size={20} className="text-muted-foreground mb-1" />
                    <span className="text-xs text-muted-foreground">Upload photos or videos</span>
                    <span className="text-[10px] text-muted-foreground/70 mt-0.5">JPG, PNG, MP4 (max 10MB)</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    disabled={tenancyReadOnly}
                    onChange={handleFileUpload}
                  />
                </label>
              </div>

              {submitError && <p className="text-sm text-destructive">{submitError}</p>}
              <button
                type="submit"
                disabled={submitLoading || tenancyReadOnly}
                className="w-full py-3 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ background: "var(--brand)" }}
              >
                <Send size={15} /> {submitLoading ? "Submitting…" : "Submit Request"}
              </button>
            </form>
          )}
        </div>

        {/* Previous Feedback */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <MessageSquare size={15} style={{ color: "var(--brand)" }} />
            <h2 className="font-bold text-foreground">Previous Requests</h2>
          </div>
          {previousFeedback.map((fb) => (
            <div key={fb.id} className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-white mr-2"
                    style={{ background: "var(--brand)" }}
                  >
                    {fb.category}
                  </span>
                  <div className="font-bold text-foreground mt-2">{fb.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{fb.date} · #{fb.id}</div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {fb.status === "resolved" ? (
                    <CheckCircle2 size={16} className="text-emerald-500" />
                  ) : (
                    <Clock size={16} className="text-amber-500" />
                  )}
                  <span
                    className={cn(
                      "text-xs font-bold uppercase tracking-wider",
                      fb.status === "resolved" ? "text-emerald-600" : "text-amber-600"
                    )}
                  >
                    {fb.status}
                  </span>
                </div>
              </div>
              {fb.attachments.length > 0 && (
                <div className="flex gap-2 mb-3">
                  {fb.attachments.slice(0, 6).map((att, i) => (
                    <a key={i} href={att} target="_blank" rel="noreferrer" className="w-16 h-16 rounded-lg bg-secondary overflow-hidden border border-border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={att} alt="attachment" className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              )}

              <div className="mt-1 flex items-center justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    setActiveCase(fb)
                    setCaseDialogOpen(true)
                  }}
                >
                  {fb.done ? <MessageSquare size={14} /> : <Plus size={14} />}
                  {fb.done ? "View thread" : "Comment"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>

    <Dialog
      open={caseDialogOpen}
      onOpenChange={(open) => {
        setCaseDialogOpen(open)
        if (!open) {
          setActiveCase(null)
          setCommentDraft("")
          setCommentError(null)
          setCommentAttachments([])
          setCommentUploading(false)
        }
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{activeCase ? activeCase.title : "Case"}</DialogTitle>
          <DialogDescription>
            {activeCase ? (
              <>
                {activeCase.category} · {activeCase.date}
                {activeCase.done ? (
                  <span className="block mt-1 text-emerald-600 font-semibold">Resolved — comments are closed.</span>
                ) : null}
              </>
            ) : (
              ""
            )}
          </DialogDescription>
        </DialogHeader>

        {activeCase ? (
          <div className="space-y-4">
            {activeCase.details ? (
              <div className="rounded-md border border-border p-3 bg-muted/20">
                <p className="text-xs font-semibold text-muted-foreground">Details</p>
                <p className="text-sm whitespace-pre-wrap mt-1">{activeCase.details}</p>
              </div>
            ) : null}

            {activeCase.attachments.length ? (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">Attachments</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {activeCase.attachments.map((url, idx) => (
                    <a key={idx} href={url} target="_blank" rel="noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="attachment" className="w-full h-28 object-cover rounded-md border border-border" />
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            {activeCase.videoUrl ? (
              <div className="rounded-md border border-border p-3 bg-muted/20">
                <p className="text-xs font-semibold text-muted-foreground">Video</p>
                <a href={activeCase.videoUrl} target="_blank" rel="noreferrer" className="text-sm underline">
                  Open video
                </a>
              </div>
            ) : null}

            <div className="rounded-md border border-border p-3 bg-secondary/50 space-y-3">
              <p className="text-xs font-semibold text-foreground">Messages</p>
              {activeCase.messages.length > 0 ? (
                <div className="space-y-2 max-h-[240px] overflow-y-auto">
                  {activeCase.messages.map((m, idx) => (
                    <div
                      key={`${m.at ?? idx}-${idx}`}
                      className={`rounded-md p-2 border border-border/70 text-sm ${
                        m.role === "operator" ? "bg-muted/30 ml-3" : "bg-background mr-3"
                      }`}
                    >
                      <div className="text-[10px] font-bold uppercase text-muted-foreground mb-0.5">
                        {m.role === "operator" ? "Operator" : "You"}
                        {m.at ? (
                          <span className="font-normal ml-2">
                            {new Date(m.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                          </span>
                        ) : null}
                      </div>
                      {m.text?.trim() ? <p className="whitespace-pre-wrap text-foreground">{m.text}</p> : null}
                      {Array.isArray(m.attachments) && m.attachments.length ? (
                        <div className="mt-2 space-y-2">
                          {m.attachments.map((att, aIdx) =>
                            att.type === "video" ? (
                              <video key={aIdx} src={att.src} className="w-full max-w-[320px] rounded-md border border-border" controls />
                            ) : (
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
                  ))}
                </div>
              ) : activeCase.reply ? (
                <p className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed">{activeCase.reply}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No messages yet.</p>
              )}

              {!activeCase.done && !feedbackCaseReadOnly ? (
                <div className="space-y-2 pt-2 border-t border-border">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="tenant-fb-comment" className="text-xs">
                      Add a comment
                    </Label>
                    <input
                      id="tenant-comment-attachments"
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      className="hidden"
                      onChange={handleCommentFileUpload}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="p-2"
                      disabled={commentSending || commentUploading}
                      onClick={() => {
                        const el = document.getElementById("tenant-comment-attachments") as HTMLInputElement | null
                        el?.click()
                      }}
                      aria-label="Attach photo/video"
                    >
                      <Upload size={14} />
                    </Button>
                  </div>
                  <Textarea
                    id="tenant-fb-comment"
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    onPaste={handleCommentPaste}
                    placeholder="Write a follow-up message…"
                    rows={3}
                    className="resize-none min-h-[80px]"
                  />
                  {commentAttachments.length ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {commentAttachments.map((att) => (
                        <div key={att.id} className="relative">
                          {att.type === "video" ? (
                            <video
                              src={att.url}
                              className="w-20 h-14 object-cover rounded-md border border-border"
                              controls
                              preload="metadata"
                            />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={att.previewUrl || att.url} alt={att.name} className="w-20 h-14 object-cover rounded-md border border-border" />
                          )}
                          <button
                            type="button"
                            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-90"
                            onClick={() => removeCommentAttachment(att.id)}
                            aria-label="Remove attachment"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {commentError ? <p className="text-sm text-destructive">{commentError}</p> : null}
                  <Button
                    type="button"
                    size="sm"
                    disabled={commentSending || commentUploading}
                    style={{ background: "var(--brand)" }}
                    className="text-primary-foreground"
                    onClick={async () => {
                      if (!activeCase) return
                      const t = commentDraft.trim()
                      const attsPayload = commentAttachments.map((a) => ({ src: a.url, type: a.type }))
                      if (!t && attsPayload.length === 0) {
                        setCommentError("Please type a message or attach photo/video.")
                        return
                      }
                      setCommentError(null)
                      setCommentSending(true)
                      try {
                        const res = await feedbackAppendMessage(activeCase.id, t, attsPayload)
                        if (!res?.ok) {
                          if (res?.reason === "NEEDS_MIGRATION_0134") {
                            setCommentError("Server needs database update (feedback messages). Please contact support.")
                          } else if (res?.reason === "FEEDBACK_CLOSED") {
                            setCommentError("This request is resolved; comments are closed.")
                          } else {
                            setCommentError(res?.reason || "Could not send comment.")
                          }
                          return
                        }
                        const at = new Date().toISOString()
                        const entry: ThreadMsg = attsPayload.length ? { role: "tenant", text: t, at, attachments: attsPayload } : { role: "tenant", text: t, at }
                        const mergeSorted = (prev: ThreadMsg[]) =>
                          [...prev, entry].sort((a, b) => (Date.parse(a.at || "") || 0) - (Date.parse(b.at || "") || 0))
                        setPreviousFeedback((prev) =>
                          prev.map((x) => (x.id === activeCase.id ? { ...x, messages: mergeSorted(x.messages), reply: t } : x))
                        )
                        setActiveCase((ac) =>
                          ac && ac.id === activeCase.id ? { ...ac, messages: mergeSorted(ac.messages), reply: t } : ac
                        )
                        setCommentDraft("")
                        setCommentAttachments([])
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err)
                        if (msg.includes("404") || msg.includes("non-JSON")) {
                          setCommentError(
                            "The comment API is missing on the server. Deploy the latest Node app and restart PM2 (route: tenantdashboard/feedback/append)."
                          )
                        } else {
                          setCommentError("Could not send comment.")
                        }
                      } finally {
                        setCommentSending(false)
                      }
                    }}
                  >
                    {commentSending ? "Sending…" : "Send comment"}
                  </Button>
                </div>
              ) : !activeCase.done && feedbackCaseReadOnly ? (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                  Comments are disabled for ended tenancies (expired or terminated).
                </p>
              ) : (
                <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                  Comments are disabled because this request has been marked resolved by the operator.
                </p>
              )}
            </div>
          </div>
        ) : null}

        <div className="flex justify-end pt-2">
          <Button type="button" variant="outline" onClick={() => setCaseDialogOpen(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
      </Dialog>
    </>
  )
}
