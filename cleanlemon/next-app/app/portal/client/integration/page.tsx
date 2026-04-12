'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import {
  fetchClientTtlockCredentials,
  fetchClientTtlockOnboardStatus,
  postClientIntegrationApiKeyEnsure,
  postClientIntegrationApiKeyRotate,
  postClientTtlockConnect,
  postClientTtlockDisconnect,
} from '@/lib/cleanlemon-api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { CheckCircle2, Copy, KeyRound, Lock, RefreshCw, XCircle, ExternalLink } from 'lucide-react'

type Step = 'choose' | 'existing'

export default function ClientIntegrationPage() {
  const { user } = useAuth()
  const email = String(user?.email || '').trim().toLowerCase()
  const operatorId = String(user?.operatorId || '').trim()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false)
  const [step, setStep] = useState<Step>('choose')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [integrationApiKey, setIntegrationApiKey] = useState('')
  const [clientIdDisplay, setClientIdDisplay] = useState('')
  const [rotateOpen, setRotateOpen] = useState(false)
  const [rotating, setRotating] = useState(false)

  const load = useCallback(async () => {
    if (!email || !operatorId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [st, keyRes] = await Promise.all([
        fetchClientTtlockOnboardStatus(email, operatorId),
        postClientIntegrationApiKeyEnsure(email, operatorId),
      ])
      if (st.reason === 'CLIENT_PORTAL_ACCESS_DENIED' || keyRes.reason === 'CLIENT_PORTAL_ACCESS_DENIED') {
        toast.error('You do not have access to integrations for this client.')
        setConnected(false)
        setIntegrationApiKey('')
        setClientIdDisplay('')
        return
      }
      setConnected(!!st.ttlockConnected)
      if (st.ttlockConnected) {
        const cr = await fetchClientTtlockCredentials(email, operatorId)
        if (cr?.ok && cr.username) setUsername(String(cr.username))
      }
      if (keyRes?.ok && keyRes.apiKey) {
        setIntegrationApiKey(String(keyRes.apiKey))
        setClientIdDisplay(String(keyRes.clientId || operatorId || '').trim())
        if (keyRes.created) toast.success('Integration API key ready — copy and store it securely.')
      } else {
        setIntegrationApiKey('')
        setClientIdDisplay('')
        if (keyRes && !keyRes.ok && keyRes.reason) {
          toast.error(String(keyRes.reason))
        }
      }
    } catch {
      toast.error('Failed to load integration')
    } finally {
      setLoading(false)
    }
  }, [email, operatorId])

  useEffect(() => {
    void load()
  }, [load])

  const copyIntegrationKey = async () => {
    if (!integrationApiKey) return
    try {
      await navigator.clipboard.writeText(integrationApiKey)
      toast.success('API key copied')
    } catch {
      toast.error('Could not copy — select the key and copy manually')
    }
  }

  const handleRotateKey = async () => {
    setRotating(true)
    try {
      const r = await postClientIntegrationApiKeyRotate(email, operatorId)
      if (r?.ok && r.apiKey) {
        setIntegrationApiKey(String(r.apiKey))
        if (r.clientId) setClientIdDisplay(String(r.clientId).trim())
        toast.success('New API key issued — update all third-party systems.')
        setRotateOpen(false)
      } else {
        toast.error(r?.reason || 'Failed to rotate key')
      }
    } catch {
      toast.error('Failed to rotate key')
    } finally {
      setRotating(false)
    }
  }

  const handleConnect = async () => {
    const u = username.trim()
    const p = password.trim()
    if (!u || !p) {
      toast.error('Enter TTLock username and password')
      return
    }
    setBusy(true)
    try {
      const r = await postClientTtlockConnect(email, operatorId, u, p)
      if (r?.ok) {
        toast.success('TTLock connected')
        setPassword('')
        setStep('choose')
        await load()
      } else {
        toast.error(r?.reason || 'Connection failed')
      }
    } catch {
      toast.error('Connection failed')
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = async () => {
    setBusy(true)
    try {
      const r = await postClientTtlockDisconnect(email, operatorId)
      if (r?.ok) {
        toast.success('TTLock disconnected')
        setUsername('')
        setPassword('')
        await load()
      } else {
        toast.error(r?.reason || 'Disconnect failed')
      }
    } catch {
      toast.error('Disconnect failed')
    } finally {
      setBusy(false)
    }
  }

  const accessDeniedOrMissing = !email || !operatorId

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-foreground tracking-tight">Integration</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Third-party API key</CardTitle>
          </div>
          <CardDescription>
            One key per B2B client (building / account). Share with OTA or other partners; rotate if it leaks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : accessDeniedOrMissing ? (
            <p className="text-sm text-destructive">Sign in to view your API key.</p>
          ) : (
            <>
              <div>
                <Label className="text-xs font-semibold">Client ID (for support and integrations)</Label>
                <Input
                  readOnly
                  value={clientIdDisplay || operatorId}
                  className="mt-1 bg-muted font-mono text-xs"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold">API key</Label>
                <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  <Input
                    readOnly
                    value={integrationApiKey}
                    className="font-mono text-xs sm:flex-1 sm:min-w-0"
                    placeholder="—"
                  />
                  <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full sm:w-auto"
                      disabled={!integrationApiKey}
                      onClick={() => void copyIntegrationKey()}
                    >
                      <Copy className="h-4 w-4 mr-2 shrink-0" />
                      Copy
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full sm:w-auto"
                      onClick={() => setRotateOpen(true)}
                    >
                      <RefreshCw className="h-4 w-4 mr-2 shrink-0" />
                      Rotate key
                    </Button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Exact HTTP headers and endpoints for partners will be documented when integration APIs ship. Treat this
                like a password.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">TTLock</CardTitle>
          </div>
          <CardDescription>
            Smart door locks — verify credentials once; we store the API token for your operator.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : accessDeniedOrMissing ? (
            <p className="text-sm text-destructive">Sign in to manage integrations.</p>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm">
                {connected ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                    <span className="text-green-700 font-medium">Connected</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">Not connected</span>
                  </>
                )}
              </div>

              {connected ? (
                <div className="space-y-3">
                  {username ? (
                    <div>
                      <Label className="text-xs font-semibold">TTLock username</Label>
                      <Input readOnly value={username} className="mt-1 bg-muted font-mono text-sm" />
                    </div>
                  ) : null}
                  <Button variant="destructive" disabled={busy} onClick={() => void handleDisconnect()}>
                    {busy ? 'Disconnecting…' : 'Disconnect'}
                  </Button>
                </div>
              ) : step === 'choose' ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Use your company&apos;s own TTLock account. If you do not have one yet, register on the official TTLock
                    site first, then return here to sign in.
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full shrink-0 justify-center sm:flex-1 sm:min-w-0"
                      onClick={() =>
                        window.open('https://lock2.ttlock.com/', '_blank', 'noopener,noreferrer')
                      }
                    >
                      <ExternalLink className="h-4 w-4 mr-2 shrink-0" />
                      Register new account
                    </Button>
                    <Button
                      type="button"
                      className="w-full shrink-0 justify-center sm:flex-1 sm:min-w-0"
                      onClick={() => setStep('existing')}
                    >
                      Log in existing account
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 max-w-md">
                  <p className="text-sm text-muted-foreground">
                    Enter the TTLock username and password. We verify immediately and save the token for API access.
                  </p>
                  <div>
                    <Label htmlFor="ttlock-user" className="text-xs font-semibold">
                      TTLock username
                    </Label>
                    <Input
                      id="ttlock-user"
                      autoComplete="username"
                      placeholder="TTLock username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="ttlock-pass" className="text-xs font-semibold">
                      TTLock password
                    </Label>
                    <Input
                      id="ttlock-pass"
                      type="password"
                      autoComplete="current-password"
                      placeholder="TTLock password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      className="w-full shrink-0 justify-center sm:w-auto sm:min-w-[8rem]"
                      onClick={() => setStep('choose')}
                    >
                      Back
                    </Button>
                    <Button
                      type="button"
                      disabled={busy || !username.trim() || !password.trim()}
                      className="w-full shrink-0 justify-center sm:flex-1 sm:min-w-0"
                      onClick={() => void handleConnect()}
                    >
                      {busy ? 'Connecting…' : 'Connect TTLock'}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate API key?</AlertDialogTitle>
            <AlertDialogDescription>
              The current key stops working immediately. You must update every third-party system that uses it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rotating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleRotateKey()
              }}
              disabled={rotating}
            >
              {rotating ? 'Issuing…' : 'Rotate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
