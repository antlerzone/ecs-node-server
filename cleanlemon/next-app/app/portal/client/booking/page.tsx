import { redirect } from 'next/navigation'

/** Booking UI lives on Dashboard (desktop) and bottom bar (mobile); keep URL for bookmarks. */
export default function ClientBookingRedirectPage() {
  redirect('/client')
}
