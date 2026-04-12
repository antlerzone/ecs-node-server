'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { LoginForm } from '@/components/auth/login-form'
import { AuthProvider } from '@/lib/auth-context'

function HomeInner() {
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo')?.trim() || undefined

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <header className="w-full py-4 px-6 bg-primary">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center">
              <span className="text-accent-foreground font-bold text-lg">CL</span>
            </div>
            <span className="text-primary-foreground font-bold text-xl">Cleanlemons</span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">Welcome to Cleanlemons</h1>
            <p className="text-muted-foreground">Your professional cleaning management solution</p>
            {redirectTo ? (
              <p className="text-sm text-muted-foreground mt-3">
                After you sign in, you&apos;ll return to complete linking with Coliving.
              </p>
            ) : null}
          </div>
          <LoginForm redirectTo={redirectTo} />
        </div>
      </div>

      <footer className="w-full py-4 px-6 bg-muted border-t border-border">
        <div className="max-w-7xl mx-auto text-center text-sm text-muted-foreground">
          <p>2024 Cleanlemons. All rights reserved.</p>
        </div>
      </footer>
    </main>
  )
}

export default function HomePage() {
  return (
    <AuthProvider>
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
            Loading…
          </div>
        }
      >
        <HomeInner />
      </Suspense>
    </AuthProvider>
  )
}
