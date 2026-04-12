'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { LoginForm } from '@/components/auth/login-form'
import { AuthProvider } from '@/lib/auth-context'

/** Same sign-in as `/`; stable URL for bookmarks and product copy (portal.cleanlemons.com/login). */
function LoginInner() {
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo')?.trim() || undefined

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <header className="w-full py-4 px-6 bg-primary">
        <div className="max-w-7xl mx-auto flex items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center">
            <span className="text-accent-foreground font-bold text-lg">CL</span>
          </div>
          <span className="text-primary-foreground font-bold text-xl">Cleanlemons</span>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-bold text-foreground text-center mb-2">Sign in</h1>
          <p className="text-sm text-muted-foreground text-center mb-6">
            Use the account you use for the client portal.
          </p>
          <LoginForm initialMode="login" redirectTo={redirectTo || '/portal'} />
        </div>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <AuthProvider>
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
            Loading…
          </div>
        }
      >
        <LoginInner />
      </Suspense>
    </AuthProvider>
  )
}
