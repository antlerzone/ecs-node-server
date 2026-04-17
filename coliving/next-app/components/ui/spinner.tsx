import { Loader2Icon } from 'lucide-react'

import { cn } from '@/lib/utils'

const sizeMap = { sm: 16, md: 24, lg: 32 } as const

function Spinner({ className, size, ...props }: React.ComponentProps<'svg'> & { size?: 'sm' | 'md' | 'lg' }) {
  const px = size ? sizeMap[size] : 16
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      width={px}
      height={px}
      className={cn('animate-spin', !size && 'size-4', className)}
      {...props}
    />
  )
}

export { Spinner }
