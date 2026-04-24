import { redirect } from 'next/navigation'

/** Operator portal no longer uses a personal Profile page — company/settings live under Company & Pricing. */
export default function OperatorProfileRedirectPage() {
  redirect('/operator')
}
