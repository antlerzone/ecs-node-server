/**
 * Operator portal: route → permission mapping.
 * admin = master admin (all permissions). Side menu shows only items the user has permission for.
 * If no permission for current path, redirect to /operator/billing (default).
 */

export type StaffPermissionKey =
  | "admin"
  | "profilesetting"
  | "usersetting"
  | "integration"
  | "billing"
  | "finance"
  | "tenantdetail"
  | "propertylisting"
  | "marketing"
  | "booking"

/** Path (pathname) → permission required to see menu & access page. Empty = no permission check (e.g. billing as default). */
export const ROUTE_PERMISSION: Record<string, StaffPermissionKey | ""> = {
  "/operator": "",
  "/operator/billing": "",
  "/operator/company": "profilesetting",
  "/operator/property": "propertylisting",
  "/operator/room": "marketing",
  "/operator/meter": "propertylisting",
  "/operator/smart-door": "propertylisting",
  "/operator/agreement-setting": "propertylisting",
  "/operator/agreements": "propertylisting",
  "/operator/tenancy": "tenantdetail",
  "/operator/booking": "booking",
  "/operator/approval": "tenantdetail",
  "/operator/commission": "finance",
  "/operator/invoice": "finance",
  "/operator/expenses": "finance",
  "/operator/refund": "finance",
  "/operator/accounting": "integration",
  "/operator/report": "finance",
  "/operator/credit": "finance",
  "/operator/contact": "tenantdetail",
  "/operator/profile": "profilesetting",
  "/operator/owner": "propertylisting",
  "/operator/quicksetup": "",
}

export function hasPermissionForPath(
  permission: Record<string, boolean> | null | undefined,
  pathname: string
): boolean {
  const key = ROUTE_PERMISSION[pathname]
  if (key === "" || key === undefined) return true
  if (!permission) return false
  if (permission.admin) return true
  return Boolean(permission[key])
}

export function hasPermission(
  permission: Record<string, boolean> | null | undefined,
  key: StaffPermissionKey
): boolean {
  if (!permission) return false
  if (permission.admin) return true
  return Boolean(permission[key])
}
