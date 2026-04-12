'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ClientFeedbackPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/client/profile')
  }, [router])
  return <div className="p-6 text-muted-foreground">Redirecting…</div>
}
