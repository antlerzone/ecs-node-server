"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/** Redirect to unified tutorial at /tutorial (portal.colivingjb.com/tutorial). */
export default function OwnertutorialRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/tutorial")
  }, [router])
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <p className="text-sm text-muted-foreground">Redirecting to tutorial…</p>
    </div>
  )
}
