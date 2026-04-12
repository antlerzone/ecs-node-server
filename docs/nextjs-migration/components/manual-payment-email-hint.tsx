import { Mail } from "lucide-react"
import { cn } from "@/lib/utils"

export const MANUAL_SUPPORT_EMAIL = "colivingmanagement@gmail.com"

/** Shown on enquiry / billing / credit when users may choose manual or offline payment. */
export function ManualPaymentEmailHint({ className }: { className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        "rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground",
        className
      )}
    >
      <div className="flex gap-2.5 items-start">
        <Mail className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
        <p>
          <strong className="text-foreground">Manual payment or offline arrangement?</strong> Email{" "}
          <a
            href={`mailto:${MANUAL_SUPPORT_EMAIL}`}
            className="font-semibold underline break-all"
            style={{ color: "var(--brand)" }}
          >
            {MANUAL_SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    </div>
  )
}
