"use client"

import UnifiedProfilePage from "@/components/shared/unified-profile-page"

export default function OwnerProfilePage() {
  return (
    <UnifiedProfilePage
      roleLabel="Owner"
      uploadRole="owner"
      localStorageKeyDemo="coliving_unified_profile_owner"
    />
  )
}
