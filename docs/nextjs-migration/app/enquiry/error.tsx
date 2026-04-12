"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function EnquiryError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[enquiry] page error:", error)
  }, [error])

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <h2 className="text-xl font-bold text-foreground mb-2">This page had a problem</h2>
        <p className="text-sm text-muted-foreground mb-6">
          The enquiry form could not load. Please try again or contact us directly.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={() => reset()}>Try again</Button>
          <Button variant="outline" asChild>
            <Link href="/enquiry">Back to Enquiry</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/pricing">Pricing</Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-6">
          Email: colivingmanagement@gmail.com · Phone: 60198579627
        </p>
      </div>
    </div>
  )
}
