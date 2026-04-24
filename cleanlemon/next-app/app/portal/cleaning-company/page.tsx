'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, ExternalLink } from 'lucide-react'
import { getPublicCleanlemonOperatorDirectory } from '@/lib/cleanlemon-api'

export default function CleaningCompanyDirectoryPage() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<
    Array<{
      id: string
      name: string
      email: string
      clientToOperatorReviewCount: number
      clientToOperatorAverageStars: number | null
    }>
  >([])

  useEffect(() => {
    let c = false
    ;(async () => {
      setLoading(true)
      try {
        const r = await getPublicCleanlemonOperatorDirectory({ limit: 400 })
        if (!c && r?.ok && Array.isArray(r.items)) setItems(r.items)
      } finally {
        if (!c) setLoading(false)
      }
    })()
    return () => {
      c = true
    }
  }, [])

  const openPrice = (operatorId: string) => {
    const url = `/cleanlemons?operator=${encodeURIComponent(operatorId)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Cleaning companies</h1>
        <p className="text-sm text-muted-foreground">Cleanlemons operators · public directory</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((row) => {
            const avg = row.clientToOperatorAverageStars
            const label =
              avg != null
                ? `${row.name || row.email || row.id} (${avg} review)`
                : `${row.name || row.email || row.id}`
            return (
              <Card key={row.id}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-base font-medium">{label}</CardTitle>
                  <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => openPrice(row.id)}>
                    View price
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  Total client reviews: {row.clientToOperatorReviewCount ?? 0}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
