'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import {
  fetchEmployeeProfileByEmail,
  postColivingCleanlemonsOauthComplete,
} from '@/lib/cleanlemon-api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LoginForm } from '@/components/auth/login-form'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  CLEANLEMONS_PORTAL_AUTH_SUCCESS_MSG,
  COLIVING_CLEANLEMONS_LINK_VERIFY_DONE,
} from '@/lib/cleanlemon-portal-constants'

function ColivingLinkInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, isLoading: authLoading, syncSessionFromStorage, logout } = useAuth()
  const state = searchParams.get('state') || ''
  const email = String(user?.email || '').trim().toLowerCase()
  const operatorId = String(user?.operatorId || '').trim()
  const [clientdetailId, setClientdetailId] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [loginDismissed, setLoginDismissed] = useState(false)

  const returnPathWithState = useMemo(() => {
    if (!state) return '/portal/client/coliving-link'
    return `/portal/client/coliving-link?state=${encodeURIComponent(state)}`
  }, [state])

  const showLoginModal =
    !!state && !authLoading && !String(user?.email || '').trim() && !loginDismissed

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return
      if (ev.data?.type !== CLEANLEMONS_PORTAL_AUTH_SUCCESS_MSG) return
      syncSessionFromStorage()
      toast.success('Signed in. Review access below.')
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [syncSessionFromStorage])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!email) return
      const res = await fetchEmployeeProfileByEmail(email, operatorId)
      if (cancelled) return
      const cid = String(res?.profile?.clientId || res?.profile?.id || '').trim()
      setClientdetailId(cid)
    })()
    return () => {
      cancelled = true
    }
  }, [email, operatorId])

  const handleAllow = useCallback(async () => {
    if (!state) {
      toast.error('Missing link state. Start again from Coliving → Company → Cleanlemons.')
      return
    }
    if (!email || !operatorId) {
      toast.error('Sign in to continue.')
      return
    }
    const cd = clientdetailId.trim()
    if (!cd) {
      toast.error('Could not resolve your client id. Complete your profile or contact support.')
      return
    }
    setBusy(true)
    try {
      const r = await postColivingCleanlemonsOauthComplete({
        state,
        cleanlemonsClientdetailId: cd,
        cleanlemonsOperatorId: operatorId,
      })
      if (!r?.ok) {
        toast.error(r?.reason || 'Link failed')
        return
      }
      setDone(true)
      toast.success('Access allowed. Closing window…')
      const target = r.redirectUrl || ''
      if (typeof window !== 'undefined' && window.opener && target) {
        let colivingOrigin = ''
        try {
          colivingOrigin = new URL(target).origin
        } catch {
          /* ignore */
        }
        if (colivingOrigin) {
          try {
            window.opener.postMessage({ type: COLIVING_CLEANLEMONS_LINK_VERIFY_DONE }, colivingOrigin)
          } catch {
            /* ignore */
          }
          window.close()
          return
        }
      }
      if (target && typeof window !== 'undefined') {
        window.setTimeout(() => {
          window.location.href = target
        }, 600)
      }
    } catch {
      toast.error('Request failed')
    } finally {
      setBusy(false)
    }
  }, [state, email, operatorId, clientdetailId])

  const closeOrLeave = useCallback(() => {
    if (typeof window !== 'undefined' && window.opener) {
      window.close()
      return
    }
    router.push('/client/integration')
  }, [router])

  const handleSwitchAccount = useCallback(() => {
    logout()
    setClientdetailId('')
    setLoginDismissed(false)
    toast.message('Sign in with a different account.')
  }, [logout])

  if (!state) {
    return (
      <div className="p-4 md:p-8 max-w-lg mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Coliving link</CardTitle>
            <CardDescription>Invalid or missing session. Start from Coliving Operator → Company Settings → Cleanlemons.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/client/integration">Back to Integration</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-lg mx-auto space-y-4">
      <Dialog
        open={showLoginModal}
        onOpenChange={(open) => {
          if (!open) setLoginDismissed(true)
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto border-0 bg-transparent p-0 shadow-none sm:max-w-md">
          <div className="relative rounded-xl border border-border bg-card p-0 shadow-xl">
            <DialogHeader className="space-y-1 border-b border-border px-5 py-4 pr-12 text-left">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Coliving Management</p>
              <DialogTitle className="text-xl font-semibold">Sign in</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                Like Google OAuth: use <strong>Google</strong> or <strong>Facebook</strong> in the popup to choose your account, or sign in with email below.
                After this step you&apos;ll confirm <strong>Allow access</strong> on this page.
              </DialogDescription>
            </DialogHeader>
            <div className="px-3 pb-4 pt-2">
              <LoginForm redirectTo={returnPathWithState} oauthUsePopup />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {loginDismissed && !email ? (
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
          <CardContent className="py-4 text-sm">
            <p className="text-foreground mb-3">Sign-in is required to link Coliving.</p>
            <Button type="button" size="sm" onClick={() => setLoginDismissed(false)}>
              Open sign-in
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-border/80 shadow-md">
        <CardHeader className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Coliving Management</p>
          <CardTitle className="text-xl">Link with Cleanlemons</CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            {!email
              ? 'Complete sign-in in the window above (or reopen it). Then you can allow Coliving to link this client account.'
              : 'Step 2 — confirm that Coliving may link this signed-in account.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!email ? (
            <p className="text-sm text-muted-foreground">
              Waiting for sign-in… If you closed the dialog, use <strong>Open sign-in</strong> above.
            </p>
          ) : done ? (
            <p className="text-sm text-green-600 dark:text-green-400">Allowed. Redirecting to Coliving…</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
                <p className="font-semibold text-foreground">Allow Coliving to link this account?</p>
                <p className="text-muted-foreground">
                  Coliving will link this Cleanlemons account to your company. You&apos;ll choose property export and TTLock on Coliving next.
                </p>
                <p className="text-xs text-muted-foreground">
                  Signed in as <span className="font-medium text-foreground">{email}</span>
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-full justify-center py-2 text-sm text-muted-foreground hover:text-foreground"
                onClick={handleSwitchAccount}
              >
                Switch account
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={closeOrLeave}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="w-full bg-slate-900 text-white hover:bg-slate-800 sm:w-auto dark:bg-primary dark:text-primary-foreground"
                  onClick={() => void handleAllow()}
                  disabled={busy || !operatorId}
                >
                  {busy ? 'Working…' : 'Allow'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function ColivingLinkPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>}>
      <ColivingLinkInner />
    </Suspense>
  )
}
