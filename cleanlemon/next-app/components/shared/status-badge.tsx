"use client"

import { Badge } from '@/components/ui/badge'
import type { TaskStatus } from '@/lib/types'

const statusConfig: Record<TaskStatus, { label: string; className: string }> = {
  'pending-checkout': {
    label: 'Pending check out',
    className: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  'ready-to-clean': {
    label: 'Ready to Clean',
    className: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  'in-progress': {
    label: 'In Progress',
    className: 'bg-purple-100 text-purple-800 border-purple-200',
  },
  completed: {
    label: 'Completed',
    className: 'bg-green-100 text-green-800 border-green-200',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-gray-100 text-gray-800 border-gray-200',
  },
}

interface StatusBadgeProps {
  status: TaskStatus
  size?: 'sm' | 'default'
}

export function StatusBadge({ status, size = 'default' }: StatusBadgeProps) {
  const config = statusConfig[status]
  
  return (
    <Badge
      variant="outline"
      className={`${config.className} ${size === 'sm' ? 'text-xs px-2 py-0.5' : ''}`}
    >
      {config.label}
    </Badge>
  )
}

// Generic status badge for other statuses
interface GenericStatusBadgeProps {
  status: string
  variant?: 'success' | 'warning' | 'error' | 'info' | 'default'
}

const variantStyles = {
  success: 'bg-green-100 text-green-800 border-green-200',
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
  error: 'bg-red-100 text-red-800 border-red-200',
  info: 'bg-blue-100 text-blue-800 border-blue-200',
  default: 'bg-gray-100 text-gray-800 border-gray-200',
}

export function GenericBadge({ status, variant = 'default' }: GenericStatusBadgeProps) {
  return (
    <Badge variant="outline" className={variantStyles[variant]}>
      {status}
    </Badge>
  )
}
