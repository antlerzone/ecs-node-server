import { redirect } from 'next/navigation'

/** Operator staff no longer use a dedicated My Profile page — company data is under Company Settings. */
export default function OperatorProfileRedirectPage() {
  redirect('/operator')
}
