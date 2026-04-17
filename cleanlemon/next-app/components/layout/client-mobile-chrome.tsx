"use client"

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { NavItem } from '@/components/layout/mobile-nav'

export type { NavItem as ClientNavItem }

interface ClientMobileHeaderProps {
  onOpenMenu: () => void
}

export function ClientMobileHeader({ onOpenMenu }: ClientMobileHeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0"
        onClick={onOpenMenu}
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </Button>
      <span className="text-sm font-semibold text-foreground">Client Portal</span>
    </header>
  )
}

interface ClientMobileDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: NavItem[]
  basePath: string
}

export function ClientMobileDrawer({ open, onOpenChange, items, basePath }: ClientMobileDrawerProps) {
  const pathname = usePathname()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[min(100vw-2.5rem,20rem)] gap-0 p-0 [&>button]:top-3">
        <SheetHeader className="border-b border-border px-4 py-4 text-left">
          <SheetTitle className="text-base">More</SheetTitle>
        </SheetHeader>
        <nav className="flex max-h-[calc(100dvh-5rem)] flex-col gap-0.5 overflow-y-auto p-2">
          {items.map((item) => {
            const full = `${basePath}${item.href}`
            const match = item.activeMatch ?? 'exact'
            const isActive =
              item.href === ''
                ? pathname === basePath || pathname === `${basePath}/`
                : match === 'prefix'
                  ? pathname === full || pathname.startsWith(`${full}/`)
                  : pathname === full
            return (
              <Link
                key={`drawer:${basePath}:${item.href || 'root'}`}
                href={`${basePath}${item.href}`}
                onClick={() => onOpenChange(false)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors',
                  isActive ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted'
                )}
              >
                <item.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
