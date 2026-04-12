"use client"

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuth, UserRole } from '@/lib/auth-context'
import { LogOut, ChevronLeft, LucideIcon } from 'lucide-react'

interface NavItem {
  href: string
  icon: LucideIcon
  label: string
}

interface AppSidebarProps {
  items: NavItem[]
  basePath: string
  title: string
}

export function AppSidebar({ items, basePath, title }: AppSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()

  const handleLogout = () => {
    logout()
    router.push('/')
  }

  const handleBackToPortal = () => {
    router.push('/portal')
  }

  return (
    <aside className="hidden md:flex w-64 flex-col bg-sidebar border-r border-sidebar-border h-screen sticky top-0">
      {/* Logo */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-sidebar-primary flex items-center justify-center">
            <span className="text-sidebar-primary-foreground font-bold text-lg">CL</span>
          </div>
          <div>
            <span className="text-sidebar-foreground font-bold text-lg block">Cleanlemons</span>
            <span className="text-sidebar-foreground/70 text-xs">{title}</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {items.map((item) => {
          const isActive = pathname === `${basePath}${item.href}` || 
                          (item.href === '' && pathname === basePath)
          return (
            <Link
              key={item.href}
              href={`${basePath}${item.href}`}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-lg transition-colors",
                isActive 
                  ? "bg-sidebar-primary text-sidebar-primary-foreground" 
                  : "text-sidebar-foreground hover:bg-sidebar-accent"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="font-medium">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* User Section */}
      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 mb-4">
          <Avatar className="h-10 w-10">
            <AvatarImage src={user?.avatar} alt={user?.name} />
            <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground">
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sidebar-foreground font-medium truncate">{user?.name}</p>
            <p className="text-sidebar-foreground/70 text-xs truncate">{user?.email}</p>
          </div>
        </div>
        
        <div className="space-y-2">
          <Button 
            variant="ghost" 
            size="sm"
            onClick={handleBackToPortal}
            className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back to Portal
          </Button>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={handleLogout}
            className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </div>
    </aside>
  )
}
