"use client"

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'

interface NavItem {
  href: string
  icon: LucideIcon
  label: string
}

interface MobileNavProps {
  items: NavItem[]
  basePath: string
}

export function MobileNav({ items, basePath }: MobileNavProps) {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border md:hidden">
      <div className="flex items-center justify-around py-2 px-4 safe-area-pb">
        {items.map((item) => {
          const isActive = pathname === `${basePath}${item.href}` || 
                          (item.href === '' && pathname === basePath)
          return (
            <Link
              key={item.href}
              href={`${basePath}${item.href}`}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors min-w-[60px]",
                isActive 
                  ? "text-primary bg-accent/50" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
              <span className="text-xs font-medium">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
