"use client"

import { MANUAL_PAYMENT_BANK } from "@/lib/manual-payment-bank"

export function ManualPaymentBankPanel() {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm space-y-2">
      <p className="font-semibold text-foreground">Bank transfer (Malaysia)</p>
      <dl className="grid gap-1.5 text-left">
        <div>
          <dt className="text-xs text-muted-foreground">Bank name</dt>
          <dd className="font-medium text-foreground">{MANUAL_PAYMENT_BANK.bankName}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">SWIFT code</dt>
          <dd className="font-mono font-medium text-foreground">{MANUAL_PAYMENT_BANK.swiftCode}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Bank account number</dt>
          <dd className="font-mono font-medium text-foreground">{MANUAL_PAYMENT_BANK.accountNumber}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Account name</dt>
          <dd className="font-medium text-foreground">{MANUAL_PAYMENT_BANK.accountHolder}</dd>
        </div>
      </dl>
    </div>
  )
}
