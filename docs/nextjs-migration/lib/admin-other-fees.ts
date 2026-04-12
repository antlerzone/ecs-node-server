/** Normalized rows from operatordetail.admin.otherFees (legacy object or JSON array). */

export type AdminOtherFeeRow = { name: string; amount: string }

export function otherFeesRowsFromAdmin(raw: unknown): AdminOtherFeeRow[] {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => ({
        name: String((x as { name?: string })?.name ?? "").trim(),
        amount: String((x as { amount?: string | number })?.amount ?? "").trim(),
      }))
      .filter((r) => r.name !== "" || r.amount !== "")
  }
  if (raw && typeof raw === "object") {
    const o = raw as { name?: string; amount?: string | number }
    const name = String(o.name ?? "").trim()
    const amount = String(o.amount ?? "").trim()
    if (name !== "" || amount !== "") return [{ name, amount }]
  }
  return []
}

/** Persist as a JSON array (supports multiple rows). Omits key when empty. */
export function otherFeesToAdminPayload(rows: AdminOtherFeeRow[]): AdminOtherFeeRow[] | undefined {
  const cleaned = rows
    .map((r) => ({ name: r.name.trim(), amount: r.amount.trim() }))
    .filter((r) => r.name !== "" && r.amount !== "")
  return cleaned.length > 0 ? cleaned : undefined
}
