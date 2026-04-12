"use client"

import { useTenantOptional } from "@/contexts/tenant-context"
import { TenantAvatarCircle } from "@/components/tenant/tenant-avatar-circle"

export function TenantHeader() {
  const state = useTenantOptional()
  const tenant = state?.tenant as {
    fullname?: string
    email?: string
    profile?: { avatar_url?: string }
  } | null
  const tenancies = state?.tenancies ?? []
  const selectedId = state?.selectedTenancyId
  const current = tenancies.find((t) => (t.id ?? t._id) === selectedId) ?? tenancies[0]
  const roomLabel = current?.room?.roomname || current?.room?.title_fld || "—"
  const propertyLabel = current?.property?.shortname || "—"
  const name = tenant?.fullname || tenant?.email || "—"
  const initials = (name as string).slice(0, 2).toUpperCase() || "—"

  return (
    <header className="hidden lg:flex items-center justify-end gap-3 px-6 py-3 border-b border-border bg-card/50">
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">{roomLabel} · {propertyLabel}</span>
        <TenantAvatarCircle
          avatarUrl={tenant?.profile?.avatar_url}
          initials={initials}
          title={name as string}
        />
      </div>
    </header>
  )
}
