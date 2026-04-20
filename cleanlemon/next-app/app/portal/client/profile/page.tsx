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
          Complete your profile and tap &quot;Confirm profile and continue&quot; before using other pages (entity type, legal name, ID, phone, address).
        </div>
      ) : null}
      <UnifiedProfilePage roleLabel="Client" backendProfile={true} selfVerifyMode={true} />
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
