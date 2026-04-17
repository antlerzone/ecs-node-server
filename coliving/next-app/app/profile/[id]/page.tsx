"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { isDemoSite } from "@/lib/portal-api"

/** All dates/times on this public page use Malaysia (UTC+8), not the viewer's browser zone. */
const MY_TZ = "Asia/Kuala_Lumpur"

type TenantReview = {
  id: string
  reviewType?: "tenant" | "owner" | string
  createdAt: string
  paymentScoreSuggested: number
  paymentScoreFinal: number
  unitCareScore: number
  communicationScore: number
  overallScore: number
  latePaymentsCount: number
  outstandingCount: number
  badges: string[]
  comment: string
  evidenceUrls: string[]
  operatorName: string
  operatorSubdomain?: string | null
  tenancy: {
    id: string | null
    property: string | null
    room: string | null
    checkIn: string | null
    checkOut: string | null
  }
}

type TenantProfileResponse = {
  ok: boolean
  tenant?: { id: string; fullname: string; email: string; avatarUrl: string | null }
  summary?: { reviewCount: number; averageOverallScore: number | null }
  reviews?: TenantReview[]
}

type InvoiceHistoryItem = {
  id: string
  apartmentName: string
  invoiceDate: string | null
  paymentDate: string | null
}

function avatarFromName(name: string): string {
  return (name || "U").trim().slice(0, 1).toUpperCase()
}

function shortProfileId(fullId: string): string {
  const s = String(fullId || "").trim()
  if (!s) return ""
  const compact = s.replace(/-/g, "")
  if (compact.length >= 12) return compact.slice(-12)
  return s
}

/** Calendar or DB datetime → display in Malaysia (UTC+8). */
function formatPortalDateMalaysia(v?: string | null): string {
  if (v == null || String(v).trim() === "") return "-"
  const s = String(v).trim()
  let d: Date
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    d = new Date(`${s}T12:00:00+08:00`)
  } else {
    d = new Date(s)
  }
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("en-MY", {
    timeZone: MY_TZ,
    day: "numeric",
    month: "numeric",
    year: "numeric",
  })
}

function fmtDate(v?: string | null): string {
  return formatPortalDateMalaysia(v)
}

function formatPortalDateTimeMalaysia(v?: string | null): string {
  if (v == null || String(v).trim() === "") return "-"
  const d = new Date(String(v).trim())
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleString("en-MY", {
    timeZone: MY_TZ,
    dateStyle: "short",
    timeStyle: "short",
  })
}

function roleTone(reviewType?: string): { badge: string; card: string } {
  if (reviewType === "owner") {
    return {
      badge: "bg-amber-100 text-amber-800 border-amber-200",
      card: "border-amber-200 bg-amber-50/30",
    }
  }
  return {
    badge: "bg-sky-100 text-sky-800 border-sky-200",
    card: "border-sky-200 bg-sky-50/30",
  }
}

function badgeLabel(raw: string): string {
  const key = String(raw || "").trim().toLowerCase()
  if (key === "blacklist" || key === "property_damage") return "Blacklist"
  if (key === "five_star_tenant" || key === "5-star tenant") return "5-star Tenant"
  if (key === "payment_delay" || key === "late_payment" || key === "outstanding_rent") return "Payment Delay"
  return raw
}

export default function PublicTenantProfilePage() {
  const params = useParams<{ id: string }>()
  const tenantId = String(params?.id || "")
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<TenantProfileResponse | null>(null)
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false)
  const [invoiceItems, setInvoiceItems] = useState<InvoiceHistoryItem[]>([])
  const [invoiceLoading, setInvoiceLoading] = useState(false)
  const [activeInvoiceTenancy, setActiveInvoiceTenancy] = useState<string | null>(null)
  const [activeReview, setActiveReview] = useState<TenantReview | null>(null)
  const reviews = profile?.reviews || []
  const latest = reviews[0]
  const shortId = useMemo(() => shortProfileId(tenantId), [tenantId])

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      try {
        if (typeof window !== "undefined" && isDemoSite()) {
          if (active) {
            setProfile({
              ok: true,
              tenant: { id: tenantId, fullname: "Demo Tenant", email: "demo@demo.com", avatarUrl: null },
              summary: { reviewCount: 2, averageOverallScore: 8.5 },
              reviews: [
                {
                  id: "demo-rv-1",
                  reviewType: "tenant",
                  createdAt: "2026-02-10T09:30:00.000Z",
                  paymentScoreSuggested: 9,
                  paymentScoreFinal: 9,
                  unitCareScore: 8,
                  communicationScore: 9,
                  overallScore: 8.7,
                  latePaymentsCount: 0,
                  outstandingCount: 0,
                  badges: ["On-time", "Responsive"],
                  comment: "Consistently on-time payment and good communication.",
                  evidenceUrls: [],
                  operatorName: "Atlas Living",
                  operatorSubdomain: "atlas",
                  tenancy: {
                    id: "demo-tenancy-1",
                    property: "Demo Property",
                    room: "Room 101",
                    checkIn: "2025-08-01",
                    checkOut: "2026-01-31",
                  },
                },
                {
                  id: "demo-rv-2",
                  reviewType: "tenant",
                  createdAt: "2025-07-20T11:10:00.000Z",
                  paymentScoreSuggested: 8,
                  paymentScoreFinal: 8,
                  unitCareScore: 8,
                  communicationScore: 8,
                  overallScore: 8.0,
                  latePaymentsCount: 1,
                  outstandingCount: 0,
                  badges: ["Clean unit"],
                  comment: "Overall cooperative tenancy with one delayed payment.",
                  evidenceUrls: [],
                  operatorName: "Atlas Living",
                  operatorSubdomain: "atlas",
                  tenancy: {
                    id: "demo-tenancy-2",
                    property: "Sunrise Tower",
                    room: "Room 206",
                    checkIn: "2025-01-01",
                    checkOut: "2025-06-30",
                  },
                },
              ],
            })
          }
          return
        }
        const base = (process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "")
        const res = await fetch(`${base}/api/public/tenant-profile/${encodeURIComponent(tenantId)}`)
        const data = (await res.json().catch(() => ({}))) as TenantProfileResponse
        if (active) setProfile(data)
      } finally {
        if (active) setLoading(false)
      }
    }
    if (tenantId) load()
    return () => { active = false }
  }, [tenantId])

  const avgScore = useMemo(() => profile?.summary?.averageOverallScore ?? null, [profile])

  const paymentBadge = (invoiceDate: string | null, paymentDate: string | null, cutoffDate?: string | null) => {
    const inv = invoiceDate ? new Date(invoiceDate) : null
    const cutoff = cutoffDate ? new Date(cutoffDate) : null
    const hasValidInv = !!inv && !Number.isNaN(inv.getTime())
    const hasValidCutoff = !!cutoff && !Number.isNaN(cutoff.getTime())

    // After tenancy/termination date, unpaid invoice should not be counted as "No pay".
    if (!paymentDate) {
      if (hasValidInv && hasValidCutoff && inv.getTime() > cutoff.getTime()) {
        return <span className="text-muted-foreground font-medium">Not counted</span>
      }
      return <span className="text-red-600 font-semibold">No pay</span>
    }
    if (!invoiceDate)
      return (
        <span className="text-green-600 font-semibold">{formatPortalDateMalaysia(paymentDate)}</span>
      )
    const invPaid = new Date(invoiceDate)
    const pay = new Date(paymentDate)
    if (Number.isNaN(invPaid.getTime()) || Number.isNaN(pay.getTime())) {
      return (
        <span className="text-green-600 font-semibold">{formatPortalDateMalaysia(paymentDate)}</span>
      )
    }
    if (pay.getTime() <= invPaid.getTime()) {
      return (
        <span className="text-green-600 font-semibold">
          {formatPortalDateMalaysia(paymentDate)} (Advance)
        </span>
      )
    }
    return (
      <span className="text-orange-600 font-semibold">
        {formatPortalDateMalaysia(paymentDate)} (Late)
      </span>
    )
  }

  const openInvoiceHistory = async (review: TenantReview) => {
    setShowInvoiceDialog(true)
    setActiveReview(review)
    const tenancyId = review?.tenancy?.id || null
    setActiveInvoiceTenancy(tenancyId || null)
    setInvoiceLoading(true)
    try {
      if (typeof window !== "undefined" && isDemoSite()) {
        setInvoiceItems([
          { id: "demo-inv-1", apartmentName: review.tenancy?.property || "Demo Property", invoiceDate: "2026-01-01", paymentDate: "2026-01-01" },
          { id: "demo-inv-2", apartmentName: review.tenancy?.property || "Demo Property", invoiceDate: "2025-12-01", paymentDate: "2025-12-02" },
          { id: "demo-inv-3", apartmentName: review.tenancy?.property || "Demo Property", invoiceDate: "2025-11-01", paymentDate: "2025-11-01" },
        ])
        return
      }
      const base = (process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "")
      const q = tenancyId ? `?tenancyId=${encodeURIComponent(tenancyId)}` : ""
      const res = await fetch(`${base}/api/public/tenant-profile/${encodeURIComponent(tenantId)}/invoice-history${q}`)
      const data = await res.json().catch(() => ({ ok: false }))
      setInvoiceItems(Array.isArray(data?.items) ? data.items : [])
    } finally {
      setInvoiceLoading(false)
    }
  }

  const isVideo = (url: string): boolean => {
    const s = String(url || "").toLowerCase()
    return s.includes(".mp4") || s.includes(".webm") || s.includes(".mov") || s.includes(".m4v")
  }

  return (
    <main className="max-w-4xl mx-auto p-4 sm:p-8 space-y-4">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading profile...</div>
      ) : null}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            {profile?.tenant?.avatarUrl ? (
              <img src={profile.tenant.avatarUrl} alt="avatar" className="w-14 h-14 rounded-full object-cover border" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-muted border flex items-center justify-center text-lg font-semibold">
                {avatarFromName(profile?.tenant?.fullname || tenantId)}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold">{profile?.tenant?.fullname || "Tenant"}</h1>
              <p className="text-sm text-muted-foreground">Profile ID: {shortId || "N/A"}</p>
              <p className="text-xs text-muted-foreground mt-1">Dates and times: Malaysia (UTC+8)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader><CardTitle className="text-sm">Average Score</CardTitle></CardHeader>
          <CardContent>
            {avgScore == null ? (
              <p className="text-2xl font-bold">This is new!</p>
            ) : (
              <p className="text-2xl font-bold">{avgScore} / 10</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Total Reviews</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{profile?.summary?.reviewCount || 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Overdue History</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{reviews.reduce((a, r) => a + Number(r.latePaymentsCount || 0), 0)}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Review History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {reviews.length === 0 ? <p className="text-sm text-muted-foreground">This is new!</p> : null}
          {reviews.map((r) => (
            <div key={r.createdAt + r.tenancy.id} className={`border rounded-lg p-3 space-y-2 ${roleTone(r.reviewType).card}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={roleTone(r.reviewType).badge}>{r.reviewType === "owner" ? "Owner" : "Tenant"}</Badge>
                <Badge variant="secondary">{r.operatorSubdomain || "operator"}</Badge>
                <span className="text-xs text-muted-foreground">{formatPortalDateTimeMalaysia(r.createdAt)}</span>
              </div>
                <Button type="button" variant="outline" size="sm" onClick={() => openInvoiceHistory(r)}>
                  View Detail
                </Button>
              </div>
              {Array.isArray(r.badges) && r.badges.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {r.badges.map((b, i) => (
                    <Badge key={`${r.createdAt}-${b}-${i}`} variant="outline">{badgeLabel(b)}</Badge>
                  ))}
                </div>
              ) : null}
              <p className="text-sm font-semibold">Average Score: {Number(r.overallScore || 0)} / 10</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Detail</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {activeReview?.evidenceUrls?.length ? (
              <div>
                <p className="text-sm font-semibold mb-2">Gallery</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {activeReview.evidenceUrls.map((u, i) => (
                    <div key={`${u}-${i}`} className="rounded-md border overflow-hidden bg-muted/30">
                      {isVideo(u) ? (
                        <video src={u} controls className="w-full h-28 object-cover" />
                      ) : (
                        <img src={u} alt={`evidence-${i + 1}`} className="w-full h-28 object-cover" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <p className="text-base font-semibold mb-1">Review Score</p>
              {activeReview ? (
                <div className="space-y-3">
                  <p className="text-base font-medium">
                    Room name: {activeReview.reviewType === "owner" ? (activeReview.tenancy?.property || "-") : (activeReview.tenancy?.room || "-")}
                  </p>

                  <div className="grid md:grid-cols-[1fr_auto] gap-4 items-start">
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Date: From {fmtDate(activeReview.tenancy?.checkIn)} to {activeReview.reviewType === "owner" ? "Today" : fmtDate(activeReview.tenancy?.checkOut)}
                      </p>
                      <p className="text-[15px]">
                        {activeReview.reviewType === "owner" ? "Responsible & reliable" : "Pay rent on time"}: <span className="font-semibold">{Number(activeReview.paymentScoreFinal || 0)}/10</span>
                      </p>
                      <p className="text-[15px]">
                        {activeReview.reviewType === "owner" ? "Cooperative in operations" : "Keep the unit clean and well care"}: <span className="font-semibold">{Number(activeReview.unitCareScore || 0)}/10</span>
                      </p>
                      <p className="text-[15px]">
                        {activeReview.reviewType === "owner" ? "Easy communication" : "Friendly and easy to communication"}: <span className="font-semibold">{Number(activeReview.communicationScore || 0)}/10</span>
                      </p>
                      {Array.isArray(activeReview.badges) && activeReview.badges.length > 0 ? (
                        <div className="pt-1">
                          <p className="text-sm font-semibold mb-1">Badges</p>
                          <div className="flex flex-wrap gap-1.5">
                            {activeReview.badges.map((b, i) => (
                              <Badge key={`${activeReview.id}-${b}-${i}`} variant="outline">{badgeLabel(b)}</Badge>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="w-28 h-28 rounded-md border bg-muted/30 flex flex-col items-center justify-center shrink-0">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Average</p>
                      <p className="text-3xl font-bold leading-none">{Number(activeReview.overallScore || 0)}</p>
                      <p className="text-sm font-medium text-muted-foreground">/10</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {activeReview?.reviewType !== "owner" ? (
              <>
                <div>
                  <p className="text-sm font-semibold mb-1">Comment</p>
                  <p className="text-sm text-muted-foreground">{activeReview?.comment || "No comment."}</p>
                </div>

                <div>
                  <p className="text-sm font-semibold mb-2">Payment History</p>
                  <p className="text-xs text-muted-foreground mb-2">Invoice and payment dates: Malaysia (UTC+8)</p>
                  {invoiceLoading ? (
                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      Loading...
                    </div>
                  ) : (
                    <div className="max-h-[420px] overflow-auto border rounded-md">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 border-b">
                            <th className="text-left px-3 py-2">Apartment name</th>
                            <th className="text-left px-3 py-2">Invoice date</th>
                            <th className="text-left px-3 py-2">Payment date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoiceItems.length === 0 ? (
                            <tr>
                              <td className="px-3 py-3 text-muted-foreground" colSpan={3}>No records.</td>
                            </tr>
                          ) : (
                            invoiceItems.map((it) => (
                              <tr key={it.id} className="border-b">
                                <td className="px-3 py-2">{it.apartmentName || "-"}</td>
                                <td className="px-3 py-2">
                                  {it.invoiceDate ? formatPortalDateMalaysia(it.invoiceDate) : "-"}
                                </td>
                                <td className="px-3 py-2">{paymentBadge(it.invoiceDate, it.paymentDate, activeReview?.tenancy?.checkOut || null)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}
