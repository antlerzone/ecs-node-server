/** Aligns with operator Pricing page service keys. */
export const CLEANLEMON_OPERATOR_SERVICES = [
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
] as const

export type CleanlemonOperatorServiceKey = (typeof CLEANLEMON_OPERATOR_SERVICES)[number]["key"]

export function labelForOperatorService(key: string): string {
  return CLEANLEMON_OPERATOR_SERVICES.find((s) => s.key === key)?.label || key
}
