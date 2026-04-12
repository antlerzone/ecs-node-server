"use client"

import UnifiedProfilePage from "@/components/shared/unified-profile-page"
import { useOperatorContext } from "@/contexts/operator-context"

export default function OperatorProfilePage() {
  const { refresh } = useOperatorContext()
  return (
    <UnifiedProfilePage
      roleLabel="Operator"
      uploadRole="operator"
      localStorageKeyDemo="coliving_unified_profile_operator"
      onBackendSaveSuccess={refresh}
    />
  )
}
