"use client"

import { useTenantOptional } from "@/contexts/tenant-context"

/** Red scrolling notice when the selected tenancy is expired or terminated (view-only). */
export function TenantReadonlyMarquee() {
  const state = useTenantOptional()
  const tenancies = state?.tenancies ?? []
  const selectedId = state?.selectedTenancyId
  const current = tenancies.find((t) => (t.id ?? t._id) === selectedId) ?? tenancies[0]
  const life = (current as { portalLifecycle?: string } | undefined)?.portalLifecycle
  if (life !== "expired" && life !== "terminated") return null

  const text =
    life === "terminated"
      ? "This tenancy has been terminated. This portal is view only — you cannot top up, pay invoices, use smart door actions, or submit feedback for this tenancy."
      : "This tenancy has expired. This portal is view only — you cannot top up, pay invoices, use smart door actions, or submit feedback for this tenancy."

  const repeat = `${text}   ·   `
  const track = repeat.repeat(3)

  return (
    <>
      <style>{`
        @keyframes tenant-portal-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .tenant-portal-marquee-outer {
          overflow: hidden;
          width: 100%;
          flex-shrink: 0;
          background: rgb(220 38 38);
          color: white;
          border-bottom: 1px solid rgb(153 27 27);
        }
        .tenant-portal-marquee-track {
          display: flex;
          width: max-content;
          animation: tenant-portal-marquee 60s linear infinite;
        }
        .tenant-portal-marquee-track span {
          flex-shrink: 0;
          padding: 0.5rem 2rem;
          font-size: 0.8125rem;
          font-weight: 600;
          white-space: nowrap;
        }
      `}</style>
      <div className="tenant-portal-marquee-outer" role="status">
        <div className="tenant-portal-marquee-track">
          <span>{track}</span>
          <span>{track}</span>
        </div>
      </div>
    </>
  )
}
