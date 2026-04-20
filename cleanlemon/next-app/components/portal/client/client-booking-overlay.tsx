'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useMediaQuery } from '@/hooks/use-media-query'
import { ClientBookingContent } from '@/components/portal/client/client-booking-content'
import { cn } from '@/lib/utils'

export type ClientBookingNavContextValue = {
  openBooking: () => void
  closeBooking: () => void
  bookingOpen: boolean
}

export const ClientBookingNavContext = createContext<ClientBookingNavContextValue | null>(null)

export function useClientBookingNav() {
  const c = useContext(ClientBookingNavContext)
  if (!c) {
    throw new Error('useClientBookingNav must be used within ClientBookingNavProvider')
  }
  return c
}

function ClientBookingMount({
  open,
  onOpenChange,
  bookingSessionKey,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  bookingSessionKey: number
}) {
  const isDesktop = useMediaQuery('(min-width: 768px)', false)

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton
          className={cn(
            'flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl',
          )}
        >
          <div className="shrink-0 border-b border-border px-6 py-4">
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="text-xl">Book a cleaning</DialogTitle>
              <DialogDescription>
                Total charge is calculated from your operator&apos;s pricing — it cannot be edited here.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2 md:px-6 md:pb-6">
            <ClientBookingContent embedded bookingSessionKey={bookingSessionKey} />
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[min(92dvh,880px)] flex-col gap-0 overflow-hidden rounded-t-2xl border-t p-0"
      >
        <SheetHeader className="shrink-0 space-y-1 border-b border-border px-4 pb-3 pt-2 text-left">
          <SheetTitle>Book a cleaning</SheetTitle>
          <SheetDescription>
            Total charge is calculated from your operator&apos;s pricing — it cannot be edited here.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-2">
          <ClientBookingContent embedded bookingSessionKey={bookingSessionKey} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function ClientBookingNavProvider({ children }: { children: ReactNode }) {
  const [bookingOpen, setBookingOpen] = useState(false)
  const [bookingSessionKey, setBookingSessionKey] = useState(0)
  const openBooking = useCallback(() => {
    setBookingSessionKey((k) => k + 1)
    setBookingOpen(true)
  }, [])
  const closeBooking = useCallback(() => setBookingOpen(false), [])

  const value = useMemo(
    () => ({ openBooking, closeBooking, bookingOpen }),
    [bookingOpen, openBooking, closeBooking],
  )

  return (
    <ClientBookingNavContext.Provider value={value}>
      {children}
      <ClientBookingMount open={bookingOpen} onOpenChange={setBookingOpen} bookingSessionKey={bookingSessionKey} />
    </ClientBookingNavContext.Provider>
  )
}
