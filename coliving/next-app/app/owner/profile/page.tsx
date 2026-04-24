"use client"

import UnifiedProfilePage from "@/components/shared/unified-profile-page"
import { useOwnerOptional } from "@/contexts/owner-context"

export default function OwnerProfilePage() {
  const ownerState = useOwnerOptional()
  const o = ownerState?.owner
  const publicProfileOwnerId = String(o?.id ?? o?._id ?? "").trim() || null

  return (
    <UnifiedProfilePage
      roleLabel="Owner"
      uploadRole="owner"
      localStorageKeyDemo="coliving_unified_profile_owner"
      onBackendSaveSuccess={() => void ownerState?.refetch?.()}
      showViewMyProfileButton
      publicProfileTenantId={publicProfileOwnerId}
      selfVerifyMode
    />
  )
}
