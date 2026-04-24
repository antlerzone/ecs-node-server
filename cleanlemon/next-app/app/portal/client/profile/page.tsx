"use client"

import UnifiedProfilePage from '@/components/shared/unified-profile-page'

export default function ClientProfilePage() {
  return <UnifiedProfilePage roleLabel="Client" backendProfile={true} selfVerifyMode={false} />
}
