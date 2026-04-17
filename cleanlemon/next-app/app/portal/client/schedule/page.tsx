import { redirect } from 'next/navigation'

/** Schedule list lives on the dashboard; keep URL for bookmarks. */
export default function ClientScheduleRedirectPage() {
  redirect('/client?tab=schedule')
}
