"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, Share2 } from "lucide-react"
import { isDemoSite } from "@/lib/portal-api"

type OwnerReview = {
  id: string
  createdAt: string
  communicationScore: number
  responsibilityScore: number
  cooperationScore: number
  overallScore: number
  comment: string
  operatorName: string
}

type OwnerProfileResponse = {
  ok: boolean
  owner?: { id: string; fullname: string; email: string; avatarUrl: string | null }
  summary?: { reviewCount: number; averageOverallScore: number | null }
  reviews?: OwnerReview[]
}

export default function PublicOwnerProfilePage() {
  const params = useParams<{ id: string }>()
  const ownerId = String(params?.id || "")
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<OwnerProfileResponse | null>(null)
  const reviews = profile?.reviews || []
  const avgScore = useMemo(() => profile?.summary?.averageOverallScore ?? null, [profile])

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      try {
        if (typeof window !== "undefined" && isDemoSite()) {
          if (active) {
            setProfile({
              ok: true,
              owner: { id: ownerId, fullname: "Demo Owner", email: "owner@demo.com", avatarUrl: null },
              summary: { reviewCount: 2, averageOverallScore: 8.8 },
              reviews: [
                {
                  id: "owner-rv-1",
                  createdAt: "2026-02-18T10:00:00.000Z",
                  communicationScore: 9,
                  responsibilityScore: 9,
                  cooperationScore: 8,
                  overallScore: 8.7,
                  comment: "Fast in approvals and cooperative on tenancy renewals.",
                  operatorName: "Atlas Living",
                },
                {
                  id: "owner-rv-2",
                  createdAt: "2025-11-05T14:20:00.000Z",
                  communicationScore: 8,
                  responsibilityScore: 9,
                  cooperationScore: 9,
                  overallScore: 8.7,
                  comment: "Clear communication and timely payout confirmation.",
                  operatorName: "Atlas Living",
                },
              ],
            })
          }
          return
        }
        const base = (process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "")
        const res = await fetch(`${base}/api/public/owner-profile/${encodeURIComponent(ownerId)}`)
        const data = (await res.json().catch(() => ({}))) as OwnerProfileResponse
        if (active) setProfile(data)
      } finally {
        if (active) setLoading(false)
      }
    }
    if (ownerId) load()
    return () => { active = false }
  }, [ownerId])

  const onShare = async () => {
    const url = typeof window !== "undefined" ? window.location.href : ""
    try {
      if (navigator.share) {
        await navigator.share({ title: `${profile?.owner?.fullname || "Owner"} profile`, url })
        return
      }
    } catch {}
    try {
      await navigator.clipboard.writeText(url)
      window.alert("Profile link copied.")
    } catch {
      window.prompt("Copy profile link:", url)
    }
  }

  return (
    <main className="max-w-4xl mx-auto p-4 sm:p-8 space-y-4">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading profile...</div>
      ) : null}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            {profile?.owner?.avatarUrl ? (
              <img src={profile.owner.avatarUrl} alt="avatar" className="w-14 h-14 rounded-full object-cover border" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-muted border flex items-center justify-center text-lg font-semibold">
                {(profile?.owner?.fullname || "O").trim().slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold">{profile?.owner?.fullname || "Owner"}</h1>
              <p className="text-sm text-muted-foreground">Profile ID: {ownerId}</p>
            </div>
            <div className="ml-auto">
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={onShare}>
                <Share2 size={14} />
                Share
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid sm:grid-cols-2 gap-3">
        <Card>
          <CardHeader><CardTitle className="text-sm">Average Score</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{avgScore == null ? "This is new!" : `${avgScore} / 10`}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Total Reviews</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{profile?.summary?.reviewCount || 0}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Review History</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {reviews.length === 0 ? <p className="text-sm text-muted-foreground">This is new!</p> : null}
          {reviews.map((r) => (
            <div key={r.id} className="border rounded-lg p-3 space-y-2">
              <p className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()} by {r.operatorName}</p>
              <p className="text-sm">Score: {r.overallScore} (communication {r.communicationScore}, responsibility {r.responsibilityScore}, cooperation {r.cooperationScore})</p>
              <p className="text-sm">{r.comment || "No comment."}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  )
}

