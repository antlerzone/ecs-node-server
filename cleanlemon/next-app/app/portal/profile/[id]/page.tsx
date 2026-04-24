'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'
import { getPublicCleanlemonOperatorProfile } from '@/lib/cleanlemon-api'

const MY_TZ = 'Asia/Kuala_Lumpur'

function formatMyDate(v?: string | null): string {
  if (v == null || String(v).trim() === '') return '—'
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-MY', { timeZone: MY_TZ, dateStyle: 'medium', timeStyle: 'short' })
}

export default function CleanlemonOperatorPublicProfilePage() {
  const params = useParams()
  const id = String(params?.id || '').trim()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Awaited<ReturnType<typeof getPublicCleanlemonOperatorProfile>> | null>(null)

  useEffect(() => {
    let c = false
    ;(async () => {
      setLoading(true)
      try {
        const r = await getPublicCleanlemonOperatorProfile(id)
        if (!c) setData(r)
      } finally {
        if (!c) setLoading(false)
      }
    })()
    return () => {
      c = true
    }
  }, [id])

  if (!id) {
    return <p className="p-6 text-muted-foreground">Missing profile id.</p>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading…
      </div>
    )
  }

  if (!data?.ok || !data.operator) {
    return (
      <div className="p-6">
        <p className="text-destructive">{data?.reason || 'Profile not found.'}</p>
      </div>
    )
  }

  const avg = data.summary?.averageStars
  const cnt = data.summary?.reviewCount ?? 0

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{data.operator.name || 'Operator'}</h1>
        <p className="text-sm text-muted-foreground">Profile ID: {id.slice(0, 8)}… · Malaysia time (UTC+8)</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Average rating</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{avg != null ? `${avg}` : '—'}</p>
            <p className="text-xs text-muted-foreground">From client reviews (1–5 scale)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Total reviews</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{cnt}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Review history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(data.reviews || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No reviews yet.</p>
          ) : (
            (data.reviews || []).map((r) => (
              <div key={r.id} className="border-b border-border pb-4 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{r.stars}★</Badge>
                  <span className="text-xs text-muted-foreground">{formatMyDate(r.createdAt)}</span>
                </div>
                {r.remark ? <p className="mt-2 text-sm whitespace-pre-wrap">{r.remark}</p> : null}
                {r.evidenceUrls?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.evidenceUrls.map((u) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={u} src={u} alt="" className="h-16 w-16 rounded object-cover border" />
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
