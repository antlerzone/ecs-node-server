"use client"

import UnifiedProfilePage from "@/components/shared/unified-profile-page"
import { useOwnerOptional } from "@/contexts/owner-context"

export default function OwnerProfilePage() {
  const ownerState = useOwnerOptional()
  return (
    <UnifiedProfilePage
      roleLabel="Owner"
      uploadRole="owner"
      localStorageKeyDemo="coliving_unified_profile_owner"
      onBackendSaveSuccess={() => void ownerState?.refetch?.()}
      selfVerifyMode
    />
  )
}
