'use client'

import { useEffect, useState } from 'react'
import {
  fetchCleanlemonHealth,
  fetchCleanlemonStats,
  getCleanlemonApiBase
} from '@/lib/cleanlemon-api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Copy, Plus, Key, Settings, CheckCircle } from 'lucide-react'

const APIIntegrationPage = () => {
  const [showNewKey, setShowNewKey] = useState(false)
  const [ecsHealth, setEcsHealth] = useState<{ loading: boolean; text: string }>({
    loading: true,
    text: ''
  })

  useEffect(() => {
    const base = getCleanlemonApiBase()
    let cancelled = false
    ;(async () => {
      const [h, s] = await Promise.all([fetchCleanlemonHealth(), fetchCleanlemonStats()])
      if (cancelled) return
      if (h.ok && s.ok) {
        setEcsHealth({
          loading: false,
          text: `Connected to ${base || 'same-origin /api'}. cln_* tables: ${h.clnTables ?? '—'}. Rows — clients: ${s.clients}, properties: ${s.properties}, schedules: ${s.schedules}.`
        })
      } else {
        setEcsHealth({
          loading: false,
          text: `Could not reach API (${h.reason || s.reason || 'unknown'}). Base: ${base}`
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const apiKeys = [
    {
      id: 1,
      operator: 'PT Cleaners Malaysia',
      keyPrefix: 'sk_live_5k4j3h2g1d....',
      environment: 'Production',
      status: 'active',
      created: '2024-01-15',
      lastUsed: '2024-06-25',
      rateLimit: '10000/day',
    },
    {
      id: 2,
      operator: 'Elite Cleaning Services',
      keyPrefix: 'sk_test_7h6g5f4d3s....',
      environment: 'Test',
      status: 'active',
      created: '2024-02-01',
      lastUsed: '2024-06-24',
      rateLimit: '5000/day',
    },
  ]

  const features = [
    { title: 'Tasks', status: 'available', description: 'Create and manage cleaning tasks' },
    { title: 'Scheduling', status: 'available', description: 'Schedule cleaning appointments' },
    { title: 'Reporting', status: 'available', description: 'Generate performance reports' },
    { title: 'Analytics', status: 'available', description: 'Access detailed analytics' },
  ]

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">API Integration</h1>
          <p className="text-muted-foreground">Manage API keys and integrations for operators</p>
        </div>

        <Card className="mb-8 border-primary/20">
          <CardHeader>
            <CardTitle>ECS backend (Cleanlemons module)</CardTitle>
            <CardDescription>
              Live check against <span className="font-mono text-xs">/api/cleanlemon/health</span> and{' '}
              <span className="font-mono text-xs">/api/cleanlemon/stats</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {ecsHealth.loading ? 'Checking…' : ecsHealth.text}
            </p>
          </CardContent>
        </Card>

        {/* API Documentation */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Getting Started with Cleanlemons API</CardTitle>
            <CardDescription>Integrate Cleanlemons with your platform</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold text-foreground mb-2">API Endpoint</h3>
              <div className="bg-muted p-3 rounded-lg font-mono text-sm text-foreground">
                https://api.cleanlemons.com/v1
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-2">Documentation</h3>
              <p className="text-sm text-muted-foreground mb-3">
                Full API documentation available at{' '}
                <a href="#" className="text-primary hover:underline">
                  docs.cleanlemons.com
                </a>
              </p>
              <Button variant="outline">View Documentation</Button>
            </div>
          </CardContent>
        </Card>

        {/* Available Features */}
        <div className="mb-8">
          <h2 className="text-xl font-bold text-foreground mb-4">Available API Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {features.map((feature, index) => (
              <Card key={index}>
                <CardContent className="p-4 flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-foreground">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* API Keys */}
        <Card>
          <CardHeader className="flex items-center justify-between flex-row">
            <div>
              <CardTitle>Active API Keys</CardTitle>
              <CardDescription>Manage integration keys for operators</CardDescription>
            </div>
            <Dialog open={showNewKey} onOpenChange={setShowNewKey}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="w-4 h-4" />
                  Generate New Key
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Generate New API Key</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="operator">Select Operator</Label>
                    <select
                      id="operator"
                      className="w-full px-3 py-2 border border-input rounded-lg bg-background"
                    >
                      <option>PT Cleaners Malaysia</option>
                      <option>Elite Cleaning Services</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="env">Environment</Label>
                    <select id="env" className="w-full px-3 py-2 border border-input rounded-lg bg-background">
                      <option>Production</option>
                      <option>Test</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="rate">Rate Limit (requests/day)</Label>
                    <Input id="rate" type="number" defaultValue="5000" />
                  </div>
                  <Button className="w-full">Generate Key</Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {apiKeys.map((key) => (
                <div key={key.id} className="p-4 border border-border rounded-lg">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-foreground">{key.operator}</h3>
                      <p className="text-sm text-muted-foreground font-mono">{key.keyPrefix}</p>
                    </div>
                    <div className="flex gap-2">
                      <Badge className="bg-blue-100 text-blue-800">{key.environment}</Badge>
                      <Badge className="bg-green-100 text-green-800">{key.status}</Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                    <div>
                      <p className="text-muted-foreground">Created</p>
                      <p className="font-medium text-foreground">{key.created}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Last Used</p>
                      <p className="font-medium text-foreground">{key.lastUsed}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Rate Limit</p>
                      <p className="font-medium text-foreground">{key.rateLimit}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="gap-2">
                      <Copy className="w-4 h-4" />
                      Copy
                    </Button>
                    <Button variant="outline" size="sm">
                      Settings
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default APIIntegrationPage
