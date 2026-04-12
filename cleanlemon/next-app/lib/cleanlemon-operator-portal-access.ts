import type { CleanlemonsJwtContext } from './auth-context'

/**
 * Operator portal (`/portal/operator/*`) is for company accounts whose email matches
 * `cln_operatordetail.email` — exposed in JWT as `operatorChoices[].sources` containing `'master'`.
 * Supervisors (employeedetail + employee_operator supervisor only) must use `/portal/supervisor`.
 */
export function canAccessOperatorPortalFromCleanlemons(
  cln: CleanlemonsJwtContext | null | undefined
): boolean {
  const choices = cln?.operatorChoices ?? []
  return choices.some((c) => Array.isArray(c.sources) && c.sources.includes('master'))
}

/** When access is denied, pick a sensible default portal. */
export function operatorPortalDenyHref(cln: CleanlemonsJwtContext | null | undefined): string {
  const choices = cln?.operatorChoices ?? []
  if (choices.some((c) => c.sources?.includes('master'))) return '/portal'

  if (choices.some((c) => c.sources?.includes('supervisor'))) {
    return '/portal/supervisor'
  }
  if (choices.some((c) => c.sources?.includes('employee'))) {
    return '/portal/employee'
  }
  return '/portal'
}
