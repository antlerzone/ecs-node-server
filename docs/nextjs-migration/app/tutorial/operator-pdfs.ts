/**
 * Operator tutorial PDFs (stored on OSS under portal/tutorial/operator/).
 *
 * URL resolution:
 * 1. NEXT_PUBLIC_OPERATOR_TUTORIAL_OSS_BASE — direct OSS HTTPS URL prefix (works if bucket/policy allows anonymous GET on that prefix).
 * 2. Else NEXT_PUBLIC_ECS_BASE_URL + /api/public/operator-tutorial-pdf?file= — ECS streams the file from OSS (iframe-friendly; avoids OSS headers that block embedding).
 * 3. Else same-origin /tutorial/operator/… fallback (local public copies).
 */
export const OPERATOR_PDF_TUTORIALS = [
  { id: "connect-bukku", label: "Connect Bukku", file: "connect-bukku.pdf" },
  { id: "connect-xero", label: "Connect Xero", file: "connect-xero.pdf" },
  { id: "create-booking", label: "Create Booking", file: "create-booking.pdf" },
  { id: "setup-agreement", label: "Setup Agreement", file: "setup-agreement.pdf" },
  { id: "setup-meter", label: "Setup Meter", file: "setup-meter.pdf" },
  { id: "setup-property", label: "Setup Property", file: "setup-property.pdf" },
  { id: "setup-room", label: "Setup Room", file: "setup-room.pdf" },
  { id: "setup-smart-door", label: "Setup Smart Door", file: "setup-smart-door.pdf" },
  { id: "tenancy-setting", label: "Tenancy Setting", file: "tenancy-setting.pdf" },
] as const

export type OperatorPdfId = (typeof OPERATOR_PDF_TUTORIALS)[number]["id"]

export function getOperatorPdfUrl(file: string): string {
  const ossBase = typeof process.env.NEXT_PUBLIC_OPERATOR_TUTORIAL_OSS_BASE === "string"
    ? process.env.NEXT_PUBLIC_OPERATOR_TUTORIAL_OSS_BASE.trim().replace(/\/$/, "")
    : ""
  if (ossBase) return `${ossBase}/${file}`

  const ecs = typeof process.env.NEXT_PUBLIC_ECS_BASE_URL === "string"
    ? process.env.NEXT_PUBLIC_ECS_BASE_URL.trim().replace(/\/$/, "")
    : ""
  if (ecs) {
    const q = new URLSearchParams({ file })
    return `${ecs}/api/public/operator-tutorial-pdf?${q.toString()}`
  }

  return `/tutorial/operator/${file}`
}
