"use client"

import { Suspense, useContext, useMemo } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'
import { ClientBookingNavContext } from '@/components/portal/client/client-booking-overlay'

export interface NavItem {
  href: string
  icon: LucideIcon
  label: string
  activeMatch?: 'exact' | 'prefix'
  prominent?: boolean
  /** Opens client booking overlay (Cleanlemons client portal) instead of navigating. */
  clientBookingOpener?: boolean
  clientTab?: "home" | "schedule"
}

interface MobileNavProps {
  items: NavItem[]
  basePath: string
}

function itemIsActive(
  pathname: string,
  basePath: string,
  tab: string | null,
  item: NavItem
): boolean {
  const onClientHome = pathname === basePath || pathname === `${basePath}/`
  if (item.clientTab === "home") {
    return onClientHome && tab !== "schedule"
  }
  if (item.clientTab === "schedule") {
    return onClientHome && tab === "schedule"
  }

  const href = item.href
  const fullHref = `${basePath}${href}`
  const match = item.activeMatch ?? "exact"

  if (href === "") {
    return onClientHome && tab !== "schedule"
  }

  if (match === "prefix") {
    return pathname === fullHref || pathname.startsWith(`${fullHref}/`)
  }
  return pathname === fullHref
}

function MobileNavInner({ items, basePath, tab }: MobileNavProps & { tab: string | null }) {
  const pathname = usePathname()
  const clientBookingCtx = useContext(ClientBookingNavContext)

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card md:hidden">
      <div className="flex items-end justify-between gap-1 px-2 pb-1 pt-2 safe-area-pb">
        {items.map((item) => {
          const isActive = item.clientBookingOpener
            ? !!clientBookingCtx?.bookingOpen
            : itemIsActive(pathname, basePath, tab, item)
          const linkHref = `${basePath}${item.href}`

          if (item.prominent) {
            if (item.clientBookingOpener && clientBookingCtx) {
              return (
                <div key={`${basePath}:booking-opener`} className="flex flex-1 flex-col items-center">
                  <button
                    type="button"
                    onClick={() => clientBookingCtx.openBooking()}
                    className={cn(
                      'relative z-10 -mt-4 flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full shadow-lg ring-4 ring-card transition-transform active:scale-95',
                      isActive
                        ? 'bg-primary text-primary-foreground ring-primary/25'
                        : 'bg-primary text-primary-foreground hover:brightness-110',
                    )}
                    aria-pressed={isActive}
                  >
                    <item.icon className="h-6 w-6" strokeWidth={2} />
                  </button>
                  <span
                    className={cn(
                      'mt-1 max-w-[4.5rem] truncate text-center text-[10px] font-semibold leading-tight',
                      isActive ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    {item.label}
                  </span>
                </div>
              )
            }
            return (
              <div key={`${basePath}:${item.href || "prominent"}`} className="flex flex-1 flex-col items-center">
                <Link
                  href={linkHref}
                  scroll={false}
                  className={cn(
                    "relative z-10 -mt-4 flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full shadow-lg ring-4 ring-card transition-transform active:scale-95",
                    isActive
                      ? "bg-primary text-primary-foreground ring-primary/25"
                      : "bg-primary text-primary-foreground hover:brightness-110"
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  <item.icon className="h-6 w-6" strokeWidth={2} />
                </Link>
                <span
                  className={cn(
                    "mt-1 max-w-[4.5rem] truncate text-center text-[10px] font-semibold leading-tight",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {item.label}
                </span>
              </div>
            )
          }

          return (
            <Link
              key={`${basePath}:${item.href || "root"}`}
              href={linkHref}
              scroll={false}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 transition-colors",
                isActive ? "bg-accent/50 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon className={cn("h-5 w-5 shrink-0", isActive && "text-primary")} />
              <span className="max-w-full truncate text-center text-[10px] font-medium leading-tight">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

function MobileNavWithSearchParams(props: MobileNavProps) {
  const tab = useSearchParams().get("tab")
  return <MobileNavInner {...props} tab={tab} />
}

export function MobileNav(props: MobileNavProps) {
  const needsTab = useMemo(
    () => props.items.some((i) => i.clientTab != null || i.href.startsWith("?")),
    [props.items]
  )

  if (needsTab) {
    return (
      <Suspense
        fallback={
          <nav className="fixed bottom-0 left-0 right-0 z-50 h-[calc(3.25rem+env(safe-area-inset-bottom,0px))] border-t border-border bg-card md:hidden" />
        }
      >
        <MobileNavWithSearchParams {...props} />
      </Suspense>
    )
  }

  return <MobileNavInner {...props} tab={null} />
}
