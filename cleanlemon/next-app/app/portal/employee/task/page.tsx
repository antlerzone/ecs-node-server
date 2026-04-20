import { redirect } from 'next/navigation'

/** Legacy URL: schedule jobs now live on the employee dashboard (`/employee?tab=schedule`). */
export default function EmployeeTaskRedirectPage() {
  redirect('/employee?tab=schedule')
}
