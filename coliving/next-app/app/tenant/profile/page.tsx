"use client"

import UnifiedProfilePage from "@/components/shared/unified-profile-page"
import { useTenantOptional } from "@/contexts/tenant-context"

export default function TenantProfilePage() {
  const tenantState = useTenantOptional()
  const t = tenantState?.tenant
  const publicProfileTenantId = (t?.id ?? t?._id ?? "").trim() || null

  return (
    <UnifiedProfilePage
      roleLabel="Tenant"
      uploadRole="tenant"
      localStorageKeyDemo="coliving_unified_profile_tenant"
      onBackendSaveSuccess={() => tenantState?.refetch?.()}
      showViewMyProfileButton
      publicProfileTenantId={publicProfileTenantId}
      selfVerifyMode
    />
  )
}
