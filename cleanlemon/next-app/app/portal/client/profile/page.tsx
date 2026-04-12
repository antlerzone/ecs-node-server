"use client"

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import UnifiedProfilePage from '@/components/shared/unified-profile-page'

function ClientProfileContent() {
  const searchParams = useSearchParams()
  const gated = searchParams.get('gate') === 'required'

  return (
    <>
      {gated ? (
        <div className="mx-auto mt-4 max-w-4xl rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Please complete required profile details first: entity type, legal name, ID type, ID number, phone number, and address.
        </div>
      ) : null}
      <UnifiedProfilePage roleLabel="Client" backendProfile />
    </>
  )
}

export default function ClientProfilePage() {
  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground">Loading…</div>}>
      <ClientProfileContent />
    </Suspense>
  )
}
