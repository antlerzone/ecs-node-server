/**
 * Single source of truth for operator pricing "Services Provider" options.
 * Used by Pricing UI and Accounting product lines (cln_account rows with is_product=1).
 */
export type ServiceKey =
  | "general"
  | "warm"
  | "deep"
  | "renovation"
  | "homestay"
  | "room-rental"
  | "commercial"
  | "office"
  | "dobi"
  | "other"

export const PRICING_SERVICES: Array<{ key: ServiceKey; label: string }> = [
  { key: "general", label: "General Cleaning" },
  { key: "warm", label: "Warm Cleaning" },
  { key: "deep", label: "Deep Cleaning" },
  { key: "renovation", label: "Renovation Cleaning" },
  { key: "homestay", label: "Homestay Cleaning" },
  { key: "room-rental", label: "Room Rental Cleaning" },
  { key: "commercial", label: "Commercial Cleaning" },
  { key: "office", label: "Office Cleaning" },
  { key: "dobi", label: "Dobi Services" },
  { key: "other", label: "Other" },
]

/** Maps pricing `ServiceKey` to `serviceProvider` strings accepted by schedule/job APIs (`createCleaningScheduleJobUnified`). */
export function serviceKeyToScheduleServiceProvider(key: ServiceKey): string {
  const map: Record<ServiceKey, string> = {
    general: "general-cleaning",
    warm: "warm-cleaning",
    deep: "deep-cleaning",
    renovation: "renovation-cleaning",
    homestay: "homestay-cleaning",
    "room-rental": "room-rental-cleaning",
    commercial: "commercial-cleaning",
    office: "office-cleaning",
    dobi: "dobi",
    other: "other",
  }
  return map[key] || "general-cleaning"
}
