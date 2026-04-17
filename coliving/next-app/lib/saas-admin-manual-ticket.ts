import type { PendingTicket } from "@/lib/saas-admin-api"

/**
 * Short one-line summary for SaaS Admin manual ticket rows (e.g. "50 credits · subtotal sgd 100.00").
 */
export function formatManualPendingTicketSummary(ticket: Pick<PendingTicket, "mode" | "description">): string {
  const mode = String(ticket.mode || "")
  const d = String(ticket.description || "")

  if (mode === "topup_manual") {
    const credits = d.match(/(\d+(?:\.\d+)?)\s*credits/i)?.[1]
    const cur = (/\((SGD|MYR)\)/i.exec(d)?.[1] || (d.includes("SGD") ? "SGD" : d.includes("MYR") ? "MYR" : "")).toLowerCase()
    const amount =
      d.match(/subtotal\s+(?:S\$|RM)\s*([\d,.]+)/i)?.[1] ||
      d.match(/subtotal\s+([\d,.]+)/i)?.[1] ||
      d.match(/(?:S\$|RM)\s*([\d,.]+)/)?.[1]
    if (credits && cur && amount) {
      return `${credits} credits · subtotal ${cur} ${amount}`
    }
    if (credits && cur) {
      return `${credits} credits · subtotal ${cur}`
    }
    if (credits) {
      return `${credits} credits`
    }
  }

  if (mode === "billing_manual") {
    const sub = d.match(/Subtotal\s+(SGD|MYR)\s+([\d,.]+)/i)
    if (sub) {
      return `subtotal ${sub[1].toLowerCase()} ${sub[2]}`
    }
    const subSym = d.match(/Subtotal\s+(S\$|RM)([\d,.]+)/i)
    if (subSym) {
      const cur = subSym[1] === "S$" ? "sgd" : "myr"
      return `subtotal ${cur} ${subSym[2]}`
    }
    const money = d.match(/(S\$[\d,.]+|RM[\d,.]+)/)
    if (money) {
      return `subtotal ${money[1]}`
    }
  }

  const stripped = d.replace(/\s*Receipt:\s*https?:\/\/\S+\s*$/i, "").trim()
  return stripped.length > 72 ? `${stripped.slice(0, 72)}…` : stripped || "—"
}

/** Credits count from a top-up manual ticket description, for prefilling SaaS admin top-up form. */
export function extractCreditsFromTopupTicketDescription(description: string): string {
  const m = String(description || "").match(/(\d+(?:\.\d+)?)\s*credits/i)
  return m ? m[1] : ""
}

/** Extract trailing receipt URL from ticket description if present. */
export function extractReceiptUrlFromTicketDescription(description: string): string | null {
  const m = String(description || "").match(/Receipt:\s*(https?:\/\/\S+)/i)
  return m ? m[1].replace(/[.,;]+$/, "") : null
}

/**
 * Prefer opening the file in a browser tab (inline) instead of forcing download.
 * Appends OSS GetObject `response-content-disposition=inline` when safe (unsigned URLs only;
 * altering query on signed URLs would invalidate the signature).
 */
export function receiptUrlForBrowserOpen(url: string): string {
  const u = String(url || "").trim()
  if (!u) return u
  try {
    const parsed = new URL(u)
    if (parsed.searchParams.has("Signature") || parsed.searchParams.has("X-Amz-Signature")) {
      return u
    }
    if (!parsed.searchParams.get("response-content-disposition")) {
      parsed.searchParams.set("response-content-disposition", "inline")
    }
    return parsed.toString()
  } catch {
    return u
  }
}
