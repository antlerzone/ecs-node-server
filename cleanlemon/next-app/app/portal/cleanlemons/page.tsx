'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import { fetchCleanlemonPricingConfig, getPublicCleanlemonOperatorProfile } from '@/lib/cleanlemon-api'
import type { CleanlemonPricingConfig } from '@/lib/cleanlemon-api'

export default function CleanlemonsPublicPricingPage() {
  const [operatorId, setOperatorId] = useState('')
  const [loading, setLoading] = useState(true)
  const [companyName, setCompanyName] = useState('')
  const [config, setConfig] = useState<CleanlemonPricingConfig | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const q = new URLSearchParams(window.location.search)
    setOperatorId(String(q.get('operator') || '').trim())
  }, [])

  useEffect(() => {
    if (!operatorId) {
      setLoading(false)
      setConfig(null)
      setCompanyName('')
      return
    }
    let c = false
    ;(async () => {
      setLoading(true)
      try {
        const [prof, pr] = await Promise.all([
          getPublicCleanlemonOperatorProfile(operatorId),
          fetchCleanlemonPricingConfig(operatorId),
        ])
        if (c) return
        if (prof?.ok && prof.operator) setCompanyName(String(prof.operator.name || prof.operator.email || ''))
        if (pr?.ok && pr.config) setConfig(pr.config)
        else setConfig(null)
      } finally {
        if (!c) setLoading(false)
      }
    })()
    return () => {
      c = true
    }
  }, [operatorId])

  if (!operatorId) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-muted-foreground">Add <code className="text-xs">?operator=</code> with a company id to view public pricing.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Cleaning prices</h1>
        <p className="text-sm text-muted-foreground">{companyName || 'Operator'} · read-only</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading…
        </div>
      ) : !config ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">No public pricing configuration for this operator.</CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pricing summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <pre className="max-h-[70vh] overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words">
              {JSON.stringify(config, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
