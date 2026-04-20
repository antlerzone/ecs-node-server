import type { CleanlemonsJwtContext } from './auth-context'

/** Staff portal vs Driver vs Dobi — gate nav by `cln_employee_operator.staff_role`. */
export type CleanlemonsPortalKind = 'staff' | 'driver' | 'dobi'

const STAFF_ROLES = new Set(['cleaner', 'staff', 'employee', 'supervisor'])

export function staffRoleMatchesPortal(staffRole: string | undefined, kind: CleanlemonsPortalKind): boolean {
  const sr = String(staffRole || '').trim().toLowerCase()
  if (kind === 'driver') return sr === 'driver'
  if (kind === 'dobi') return sr === 'dobi'
  return STAFF_ROLES.has(sr)
}

export function hasOperatorBindingsForPortal(
  cleanlemons: CleanlemonsJwtContext | null | undefined,
  kind: CleanlemonsPortalKind
): boolean {
  const ops = Array.isArray(cleanlemons?.employeeOperators) ? cleanlemons.employeeOperators : []
  return ops.some((o) => staffRoleMatchesPortal(o.staffRole, kind))
}

export function filterOperatorsForPortal(
  cleanlemons: CleanlemonsJwtContext | null | undefined,
  kind: CleanlemonsPortalKind
): Array<{ id: string; name: string }> {
  const ops = Array.isArray(cleanlemons?.employeeOperators) ? cleanlemons.employeeOperators : []
  const map = new Map<string, string>()
  for (const o of ops) {
    if (!staffRoleMatchesPortal(o.staffRole, kind)) continue
    const id = String(o.operatorId || '').trim()
    if (!id) continue
    if (!map.has(id)) map.set(id, String(o.operatorName || id))
  }
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
}

/**
 * Employee portal company dropdown: backend merges **all** linked operators into `operatorChoices`
 * (supervisor + employee junctions + company master email). Do not rely only on `filterOperatorsForPortal(…, 'staff')`
 * — that drops operators when JWT rows are only driver/dobi or role filters exclude them.
 */
export function listOperatorChoicesForEmployeeDropdown(
  cleanlemons: CleanlemonsJwtContext | null | undefined
): Array<{ id: string; name: string }> {
  const choices = cleanlemons?.operatorChoices
  if (Array.isArray(choices) && choices.length > 0) {
    const map = new Map<string, string>()
    for (const c of choices) {
      const id = String(c.operatorId || '').trim()
      if (!id) continue
      const name = String(c.operatorName || id).trim() || id
      if (!map.has(id)) map.set(id, name)
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }
  return filterOperatorsForPortal(cleanlemons, 'staff')
}
