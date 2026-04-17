'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import {
  fetchClientIntegrationContext,
  fetchClientTtlockCredentials,
  fetchClientTtlockOnboardStatus,
  postClientIntegrationApiKeyEnsure,
  postClientIntegrationApiKeyRotate,
  postClientTtlockConnect,
  postClientTtlockDisconnect,
  type ClientIntegrationColivingInfo,
  type ClientLinkedOperatorRow,
  type ClientTtlockAccountRow,
} from '@/lib/cleanlemon-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Building2, CheckCircle2, Copy, KeyRound, Link2, Lock, Plus, RefreshCw, ExternalLink } from 'lucide-react'

type TtlockDialogMode = 'add' | 'manage'
type TtlockAddIntent = 'register' | 'existing'

export default function ClientIntegrationPage() {
  const { user } = useAuth()
  const email = String(user?.email || '').trim().toLowerCase()
  const operatorId = String(user?.operatorId || '').trim()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [ttlockAccounts, setTtlockAccounts] = useState<ClientTtlockAccountRow[]>([])
  const [integrationApiKey, setIntegrationApiKey] = useState('')
  const [clientIdDisplay, setClientIdDisplay] = useState('')
  const [rotateOpen, setRotateOpen] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [addIntegrationOpen, setAddIntegrationOpen] = useState(false)
  const [ttlockMethodDialogOpen, setTtlockMethodDialogOpen] = useState(false)
  const [ttlockDialogOpen, setTtlockDialogOpen] = useState(false)
  const [ttlockDialogMode, setTtlockDialogMode] = useState<TtlockDialogMode>('add')
  const [ttlockAddIntent, setTtlockAddIntent] = useState<TtlockAddIntent | null>(null)
  const [manageSlot, setManageSlot] = useState<number | null>(null)
  const [ttlockAccountName, setTtlockAccountName] = useState('')
  const [ttlockFormUser, setTtlockFormUser] = useState('')
  const [ttlockFormPass, setTtlockFormPass] = useState('')
  const [ttlockViewCreds, setTtlockViewCreds] = useState<{ username: string; password: string } | null>(null)
  const [linkedOperators, setLinkedOperators] = useState<ClientLinkedOperatorRow[]>([])
  const [colivingInfo, setColivingInfo] = useState<ClientIntegrationColivingInfo | null>(null)

  const load = useCallback(async () => {
    if (!email || !operatorId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [st, keyRes, ctx] = await Promise.all([
        fetchClientTtlockOnboardStatus(email, operatorId),
        postClientIntegrationApiKeyEnsure(email, operatorId),
        fetchClientIntegrationContext(email, operatorId),
      ])
      const stDenied = st.reason === 'CLIENT_PORTAL_ACCESS_DENIED'
      const keyDenied = keyRes.reason === 'CLIENT_PORTAL_ACCESS_DENIED'
      const ctxDenied = ctx.reason === 'CLIENT_PORTAL_ACCESS_DENIED'
      if (stDenied || keyDenied || ctxDenied) {
        toast.error('You do not have access to integrations for this client.')
      }
      if (!stDenied) {
        setTtlockAccounts(Array.isArray(st.accounts) ? st.accounts : [])
      } else {
        setTtlockAccounts([])
      }
      if (!ctxDenied) {
        setLinkedOperators(Array.isArray(ctx.linkedOperators) ? ctx.linkedOperators : [])
        setColivingInfo(ctx.coliving ?? { linked: false })
      } else {
        setLinkedOperators([])
        setColivingInfo(null)
      }
      if (!keyDenied) {
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
      } else {
        setIntegrationApiKey('')
        setClientIdDisplay('')
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

  const submitTtlockConnect = async () => {
    const name = ttlockAccountName.trim()
    const u = ttlockFormUser.trim()
    const p = ttlockFormPass.trim()
    if (!name) {
      toast.error('Enter a name for this TTLock account')
      return
    }
    if (!u || !p) {
      toast.error('Enter TTLock username and password')
      return
    }
    setBusy(true)
    try {
      const r = await postClientTtlockConnect(email, operatorId, u, p, { accountName: name })
      if (r?.ok) {
        toast.success('TTLock connected')
        setTtlockDialogOpen(false)
        setTtlockFormPass('')
        setTtlockAccountName('')
        setTtlockFormUser('')
        await load()
      } else {
        const reason = r?.reason || 'Connection failed'
        toast.error(
          reason === 'TTLOCK_USERNAME_PASSWORD_REQUIRED'
            ? 'Please enter your TTLock username and password.'
            : reason === 'TTLOCK_APP_CREDENTIALS_MISSING'
              ? 'TTLock app credentials are not configured on the server.'
              : reason
        )
      }
    } catch {
      toast.error('Connection failed')
    } finally {
      setBusy(false)
    }
  }

  const disconnectTtlockAtSlot = async (slot: number) => {
    const row = ttlockAccounts.find((a) => a.slot === slot)
    if (row?.source === 'coliving') {
      toast.error('This TTLock account is synced from Coliving and cannot be removed here.')
      return
    }
    setBusy(true)
    try {
      const r = await postClientTtlockDisconnect(email, operatorId, slot)
      if (r?.ok) {
        toast.success('TTLock disconnected')
        setTtlockDialogOpen(false)
        setTtlockViewCreds(null)
        setManageSlot(null)
        await load()
      } else {
        const reason = String(r?.reason || 'Disconnect failed')
        toast.error(
          reason === 'TTLOCK_COLIVING_MANAGED'
            ? 'This TTLock account is synced from Coliving and cannot be removed here.'
            : reason
        )
      }
    } catch {
      toast.error('Disconnect failed')
    } finally {
      setBusy(false)
    }
  }

  const accessDeniedOrMissing = !email || !operatorId

  const resetTtlockAddForm = () => {
    setTtlockAccountName('')
    setTtlockFormUser('')
    setTtlockFormPass('')
    setTtlockViewCreds(null)
  }

  /** Step 1: Register vs add existing — then opens credentials dialog. */
  const openTtlockMethodPicker = () => {
    setTtlockDialogMode('add')
    setManageSlot(null)
    setTtlockAddIntent(null)
    resetTtlockAddForm()
    setTtlockMethodDialogOpen(true)
  }

  const chooseTtlockAddMethod = (intent: TtlockAddIntent) => {
    setTtlockAddIntent(intent)
    setTtlockMethodDialogOpen(false)
    setTtlockDialogOpen(true)
  }

  const openManageDialogForSlot = (slot: number) => {
    setTtlockDialogMode('manage')
    setManageSlot(slot)
    setTtlockViewCreds(null)
    setTtlockDialogOpen(true)
  }

  /** Add integration → TTLock → method picker → credentials. */
  const openTtlockFromAddMenu = () => {
    setAddIntegrationOpen(false)
    window.setTimeout(() => {
      openTtlockMethodPicker()
    }, 0)
  }

  useEffect(() => {
    const ok = ttlockDialogOpen && ttlockDialogMode === 'manage' && manageSlot != null && !!email && !!operatorId
    if (!ok) {
      setTtlockViewCreds(null)
      return
    }
    let cancelled = false
    void fetchClientTtlockCredentials(email, operatorId, manageSlot!).then((res) => {
      if (cancelled) return
      if (res?.ok) {
        setTtlockViewCreds({ username: res.username ?? '', password: res.password ?? '' })
      } else {
        setTtlockViewCreds({ username: '', password: '' })
      }
    })
    return () => {
      cancelled = true
    }
  }, [ttlockDialogOpen, ttlockDialogMode, manageSlot, email, operatorId])

  const manageDialogAccount =
    ttlockDialogMode === 'manage' && manageSlot != null
      ? ttlockAccounts.find((a) => a.slot === manageSlot)
      : undefined

  const connectedRows = ttlockAccounts.filter((a) => a.connected)

  /**
   * TTLock row created by Coliving → Cleanlemons sync (`source === 'coliving'`): company name + TTLock login.
   * Company name from Coliving bridge (`colivingOperatorTitle`).
   */
  const colivingSourcedTtlockTitle = (a: ClientTtlockAccountRow) => {
    const company =
      String(colivingInfo?.colivingOperatorTitle || '').trim() || 'Coliving company'
    const login = String(a.username || '').trim()
    return login ? `${company} (${login})` : company
  }

  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Integration</h1>
        <Button
          type="button"
          className="shrink-0 gap-2 self-end sm:self-auto"
          disabled={accessDeniedOrMissing || loading}
          onClick={() => setAddIntegrationOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Add integration
        </Button>
      </div>

      <div className="w-full divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <div className="w-full p-4 md:p-6">
          <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-start sm:gap-10">
            <div className="flex shrink-0 items-center gap-2 sm:w-48 sm:flex-col sm:items-start">
              <KeyRound className="h-5 w-5 text-primary" />
              <div>
                <p className="font-semibold text-foreground">API key</p>
                <p className="text-xs text-muted-foreground">One key per client account. Rotate if it leaks.</p>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-4">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : accessDeniedOrMissing ? (
                <p className="text-sm text-destructive">Sign in to view your API key.</p>
              ) : (
                <>
                  <div>
                    <Label className="text-xs font-semibold">Client ID</Label>
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
                        className="min-w-0 flex-1 font-mono text-xs"
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
                          <Copy className="mr-2 h-4 w-4 shrink-0" />
                          Copy
                        </Button>
                        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setRotateOpen(true)}>
                          <RefreshCw className="mr-2 h-4 w-4 shrink-0" />
                          Rotate
                        </Button>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-foreground/75">Treat like a password.</p>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="w-full p-4 md:p-6">
          <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-start sm:gap-10">
            <div className="flex shrink-0 items-center gap-2 sm:w-48 sm:flex-col sm:items-start">
              <Building2 className="h-5 w-5 text-primary" />
              <div>
                <p className="font-semibold text-foreground">Operators</p>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-5">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : accessDeniedOrMissing ? (
                <p className="text-sm text-destructive">Sign in to view linked operators.</p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Cleanlemons operators</Label>
                    {linkedOperators.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No operator link found for this profile.</p>
                    ) : (
                      <ul className="space-y-2">
                        {linkedOperators.map((o) => (
                          <li
                            key={o.operatorId}
                            className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
                          >
                            <p className="font-medium text-foreground">{o.operatorName}</p>
                            {o.operatorEmail ? (
                              <p className="text-xs text-muted-foreground">{o.operatorEmail}</p>
                            ) : null}
                            <p className="mt-1 font-mono text-[11px] text-muted-foreground/90">{o.operatorId}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Link2 className="h-4 w-4 text-muted-foreground" />
                      <Label className="text-xs font-semibold">Coliving integration</Label>
                    </div>
                    {colivingInfo?.linked ? (
                      <div className="rounded-lg border border-border px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">
                            {colivingInfo.colivingOperatorTitle || 'Coliving company'}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            Coliving
                          </Badge>
                        </div>
                        {colivingInfo.colivingOperatorEmail ? (
                          <p className="mt-1 text-xs text-muted-foreground">{colivingInfo.colivingOperatorEmail}</p>
                        ) : null}
                        {colivingInfo.colivingOperatordetailId ? (
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                            operatordetail {colivingInfo.colivingOperatordetailId}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Not linked from Coliving yet. When your operator completes Coliving → Cleanlemons linking, the
                        Coliving company name will appear here.
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div id="client-integration-ttlock" className="w-full scroll-mt-20 p-4 md:p-6">
          <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-start sm:gap-10">
            <div className="flex shrink-0 items-center gap-2 sm:w-48 sm:flex-col sm:items-start">
              <Lock className="h-5 w-5 text-primary" />
              <div>
                <p className="font-semibold text-foreground">TTLock</p>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : accessDeniedOrMissing ? (
                <p className="text-sm text-destructive">Sign in to manage integrations.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button type="button" size="sm" onClick={openTtlockMethodPicker}>
                      Connect TTLock
                    </Button>
                  </div>
                  {connectedRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No TTLock accounts connected yet. Use Add integration or Connect TTLock.</p>
                  ) : (
                    <ul className="space-y-2">
                      {connectedRows.map((a) => {
                        const fromColivingIntegration = a.source === 'coliving'
                        const showLoginSubline = !!a.username?.trim() && !fromColivingIntegration
                        return (
                        <li
                          key={`ttlock-${a.slot}`}
                          className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-foreground">
                                {fromColivingIntegration
                                  ? colivingSourcedTtlockTitle(a)
                                  : (a.accountName?.trim() || 'TTLock account')}
                              </span>
                              {fromColivingIntegration ? (
                                <Badge variant="secondary" className="font-mono text-xs">
                                  (coliving)
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs">
                                  Manual
                                </Badge>
                              )}
                              <span className="inline-flex items-center gap-1 text-xs text-green-700">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Connected
                              </span>
                            </div>
                            {showLoginSubline ? (
                              <p className="truncate font-mono text-xs text-muted-foreground">{a.username}</p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            {a.manageable ? (
                              <Button type="button" size="sm" variant="outline" onClick={() => openManageDialogForSlot(a.slot)}>
                                Manage
                              </Button>
                            ) : (
                              <span className="max-w-[14rem] text-right text-xs leading-snug text-muted-foreground sm:self-center">
                                (coliving) — not manageable here
                              </span>
                            )}
                          </div>
                        </li>
                        )
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={addIntegrationOpen} onOpenChange={setAddIntegrationOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add integration</DialogTitle>
            <DialogDescription>Choose a service to connect to this client account.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Button
              type="button"
              variant="outline"
              className="h-auto justify-start gap-3 py-3 text-left"
              disabled={accessDeniedOrMissing || loading}
              onClick={() => void openTtlockFromAddMenu()}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Lock className="h-4 w-4 text-primary" />
              </span>
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="font-medium text-foreground">TTLock</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Register or use an existing account, then enter name and credentials
                </span>
              </span>
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAddIntegrationOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ttlockMethodDialogOpen} onOpenChange={setTtlockMethodDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect TTLock</DialogTitle>
            <DialogDescription>Choose how you want to connect this TTLock login.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Button
              type="button"
              variant="outline"
              className="h-auto justify-start gap-3 py-3 text-left"
              disabled={accessDeniedOrMissing || loading}
              onClick={() => chooseTtlockAddMethod('register')}
            >
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="font-medium text-foreground">Register</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Create a new TTLock account first, then enter the details in the next step
                </span>
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-auto justify-start gap-3 py-3 text-left"
              disabled={accessDeniedOrMissing || loading}
              onClick={() => chooseTtlockAddMethod('existing')}
            >
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="font-medium text-foreground">Add existing account</span>
                <span className="text-xs font-normal text-muted-foreground">
                  You already have a TTLock username and password
                </span>
              </span>
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setTtlockMethodDialogOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={ttlockDialogOpen}
        onOpenChange={(open) => {
          setTtlockDialogOpen(open)
          if (!open) {
            setTtlockFormPass('')
            setTtlockAddIntent(null)
            setTtlockViewCreds(null)
            setManageSlot(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{ttlockDialogMode === 'manage' ? 'TTLock account' : 'Add TTLock account'}</DialogTitle>
            <DialogDescription>
              {ttlockDialogMode === 'manage'
                ? 'Username and password stored for this integration.'
                : ttlockAddIntent === 'register'
                  ? 'Enter a display name and the TTLock credentials for your new account.'
                  : ttlockAddIntent === 'existing'
                    ? 'Enter a display name and your existing TTLock login.'
                    : 'Enter a display name and TTLock credentials.'}
            </DialogDescription>
          </DialogHeader>
          {ttlockDialogMode === 'manage' && manageSlot != null ? (
            <div className="space-y-3">
              {manageDialogAccount?.source === 'coliving' ? (
                <p className="text-sm text-muted-foreground">
                  This login was synced from Coliving. It cannot be disconnected here — change or remove it in Coliving.
                </p>
              ) : null}
              <div>
                <Label className="text-xs font-semibold">TTLock username</Label>
                <Input readOnly className="mt-1 bg-muted font-mono text-sm" value={ttlockViewCreds?.username ?? ''} />
              </div>
              <div>
                <Label className="text-xs font-semibold">TTLock password</Label>
                <Input readOnly type="text" className="mt-1 bg-muted font-mono text-sm" value={ttlockViewCreds?.password ?? ''} />
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setTtlockDialogOpen(false)} disabled={busy}>
                  Close
                </Button>
                {manageDialogAccount?.source !== 'coliving' ? (
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => manageSlot != null && void disconnectTtlockAtSlot(manageSlot)}
                  >
                    {busy ? 'Disconnecting…' : 'Disconnect'}
                  </Button>
                ) : null}
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              {ttlockAddIntent === 'register' ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => window.open('https://lock2.ttlock.com/', '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink className="mr-2 h-4 w-4 shrink-0" />
                  Open TTLock to register
                </Button>
              ) : null}
              <div>
                <Label htmlFor="cln-ttlock-display-name" className="text-xs font-semibold">
                  Name
                </Label>
                <Input
                  id="cln-ttlock-display-name"
                  placeholder="e.g. Building A master"
                  value={ttlockAccountName}
                  onChange={(e) => setTtlockAccountName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="client-portal-ttlock-user" className="text-xs font-semibold">
                  TTLock username
                </Label>
                <Input
                  id="client-portal-ttlock-user"
                  autoComplete="username"
                  placeholder="TTLock username"
                  value={ttlockFormUser}
                  onChange={(e) => setTtlockFormUser(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="client-portal-ttlock-pass" className="text-xs font-semibold">
                  TTLock password
                </Label>
                <Input
                  id="client-portal-ttlock-pass"
                  type="password"
                  autoComplete="current-password"
                  placeholder="TTLock password"
                  value={ttlockFormPass}
                  onChange={(e) => setTtlockFormPass(e.target.value)}
                  className="mt-1"
                />
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" disabled={busy} onClick={() => setTtlockDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={
                    busy || !ttlockAccountName.trim() || !ttlockFormUser.trim() || !ttlockFormPass.trim()
                  }
                  onClick={() => void submitTtlockConnect()}
                >
                  {busy ? 'Connecting…' : 'Connect'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
