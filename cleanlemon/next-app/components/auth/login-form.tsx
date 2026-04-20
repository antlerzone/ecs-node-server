"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/lib/auth-context'
import {
  shouldUseMockOAuthClient,
  getCleanlemonApiBase,
} from '@/lib/portal-auth-mock'
import { Spinner } from '@/components/ui/spinner'
import {
  CLEANLEMONS_AFTER_AUTH_REDIRECT_KEY,
  CLEANLEMONS_OAUTH_POPUP_FLAG_KEY,
} from '@/lib/cleanlemon-portal-constants'

interface LoginFormProps {
  initialMode?: 'login' | 'register'
  redirectTo?: string
  /**
   * Google/Facebook open in a centered popup (like Google OAuth). Parent should listen for
   * `CLEANLEMONS_PORTAL_AUTH_SUCCESS_MSG` and call `syncSessionFromStorage()`.
   */
  oauthUsePopup?: boolean
}

function openOAuthPopupWindow(url: string): Window | null {
  const w = 520
  const h = 700
  const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2)
  const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2)
  return window.open(
    url,
    'cleanlemons_oauth',
    `width=${w},height=${h},left=${left},top=${top},scrollbars=yes,resizable=yes`
  )
}

/**
 * OAuth buttons must never depend on a flaky shared helper alone: same env can tree-shake
 * differently. Prefer inlined NEXT_PUBLIC here, then dev default to local Node.
 */
function resolvePortalApiBaseForOAuth(): string {
  const fromNextPublic = (process.env.NEXT_PUBLIC_CLEANLEMON_API_URL || '')
    .trim()
    .replace(/\/$/, '')
  if (fromNextPublic) return fromNextPublic
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:5000'
  }
  try {
    if (typeof window !== 'undefined') {
      const h = (window.location.hostname || '').toLowerCase().replace(/\.$/, '')
      if (h === 'localhost' || h === '127.0.0.1' || h === '::1') {
        return 'http://localhost:5000'
      }
    }
  } catch {
    /* ignore */
  }
  return (getCleanlemonApiBase() || '').trim()
}

export function LoginForm({ initialMode = 'login', redirectTo, oauthUsePopup }: LoginFormProps = {}) {
  const [isLogin, setIsLogin] = useState(initialMode === 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  
  const { login, register, loginWithGoogle, loginWithFacebook } = useAuth()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      let success: boolean
      if (isLogin) {
        success = await login(email, password)
      } else {
        if (!name.trim()) {
          setError('Please enter your name')
          setIsSubmitting(false)
          return
        }
        success = await register(email, password, name)
      }

      if (success) {
        router.push(redirectTo || '/portal')
      } else {
        setError('Authentication failed. Please try again.')
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleGoogleLogin = async () => {
    setError('')
    setIsSubmitting(true)
    try {
      const apiBase = resolvePortalApiBaseForOAuth()
      if (!apiBase) {
        setError('Google sign-in is not available. Please contact support.')
        setIsSubmitting(false)
        return
      }
      if (shouldUseMockOAuthClient()) {
        sessionStorage.setItem('cleanlemons_after_auth_redirect', redirectTo || '/portal')
        const success = await loginWithGoogle()
        if (success) {
          router.push(redirectTo || '/portal')
        }
        return
      }
      const target = redirectTo || '/portal'
      if (oauthUsePopup) {
        try {
          localStorage.setItem(CLEANLEMONS_OAUTH_POPUP_FLAG_KEY, '1')
          localStorage.setItem(CLEANLEMONS_AFTER_AUTH_REDIRECT_KEY, target)
        } catch {
          /* ignore */
        }
        const frontend = window.location.origin
        const url = `${apiBase}/api/portal-auth/google?frontend=${encodeURIComponent(frontend)}`
        const win = openOAuthPopupWindow(url)
        if (!win) {
          try {
            localStorage.removeItem(CLEANLEMONS_OAUTH_POPUP_FLAG_KEY)
            localStorage.removeItem(CLEANLEMONS_AFTER_AUTH_REDIRECT_KEY)
          } catch {
            /* ignore */
          }
          setError('Popup was blocked. Allow popups for this site, or sign in with email below.')
          setIsSubmitting(false)
          return
        }
        setIsSubmitting(false)
        return
      }
      sessionStorage.setItem('cleanlemons_after_auth_redirect', target)
      const frontend = window.location.origin
      const url = `${apiBase}/api/portal-auth/google?frontend=${encodeURIComponent(frontend)}`
      window.location.href = url
      return
    } catch {
      setError('Google sign-in failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleFacebookLogin = async () => {
    setError('')
    setIsSubmitting(true)
    try {
      const apiBase = resolvePortalApiBaseForOAuth()
      if (!apiBase) {
        setError('Facebook sign-in is not available. Please contact support.')
        setIsSubmitting(false)
        return
      }
      if (shouldUseMockOAuthClient()) {
        sessionStorage.setItem('cleanlemons_after_auth_redirect', redirectTo || '/portal')
        const success = await loginWithFacebook()
        if (success) {
          router.push(redirectTo || '/portal')
        }
        return
      }
      const target = redirectTo || '/portal'
      if (oauthUsePopup) {
        try {
          localStorage.setItem(CLEANLEMONS_OAUTH_POPUP_FLAG_KEY, '1')
          localStorage.setItem(CLEANLEMONS_AFTER_AUTH_REDIRECT_KEY, target)
        } catch {
          /* ignore */
        }
        const frontend = window.location.origin
        const url = `${apiBase}/api/portal-auth/facebook?frontend=${encodeURIComponent(frontend)}`
        const win = openOAuthPopupWindow(url)
        if (!win) {
          try {
            localStorage.removeItem(CLEANLEMONS_OAUTH_POPUP_FLAG_KEY)
            localStorage.removeItem(CLEANLEMONS_AFTER_AUTH_REDIRECT_KEY)
          } catch {
            /* ignore */
          }
          setError('Popup was blocked. Allow popups for this site, or sign in with email below.')
          setIsSubmitting(false)
          return
        }
        setIsSubmitting(false)
        return
      }
      sessionStorage.setItem('cleanlemons_after_auth_redirect', target)
      const frontend = window.location.origin
      window.location.href = `${apiBase}/api/portal-auth/facebook?frontend=${encodeURIComponent(frontend)}`
    } catch {
      setError('Facebook sign-in failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="w-full max-w-md border-0 shadow-xl bg-card">
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-2xl font-bold text-foreground">
          {isLogin ? 'Welcome Back' : 'Create Account'}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {isLogin 
            ? 'Sign in to access your portal' 
            : 'Register to get started with Cleanlemons'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Social Login Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <Button 
            variant="outline" 
            className="w-full border-border hover:bg-muted"
            onClick={handleGoogleLogin}
            disabled={isSubmitting}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Google
          </Button>
          <Button 
            variant="outline" 
            className="w-full border-border hover:bg-muted"
            onClick={handleFacebookLogin}
            disabled={isSubmitting}
          >
            <svg className="mr-2 h-4 w-4" fill="#1877F2" viewBox="0 0 24 24">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
            Facebook
          </Button>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <Separator className="w-full" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
          </div>
        </div>

        {/* Email Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div className="space-y-2">
              <Label htmlFor="name" className="text-foreground">Full Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="Enter your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-background border-input"
                disabled={isSubmitting}
              />
            </div>
          )}
          
          <div className="space-y-2">
            <Label htmlFor="email" className="text-foreground">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-background border-input"
              required
              disabled={isSubmitting}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="password" className="text-foreground">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-background border-input"
              required
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          <Button
            type="submit"
            className="w-full bg-slate-900 text-white hover:bg-slate-800 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Spinner className="mr-2 h-4 w-4" />
            ) : null}
            {isLogin ? 'Sign In' : 'Create Account'}
          </Button>
        </form>

        <div className="text-center text-sm">
          <span className="text-muted-foreground">
            {isLogin ? "Don't have an account? " : "Already have an account? "}
          </span>
          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin)
              setError('')
            }}
            className="text-primary font-medium hover:underline"
            disabled={isSubmitting}
          >
            {isLogin ? 'Register' : 'Sign In'}
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
