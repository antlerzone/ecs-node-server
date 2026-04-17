"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface EmailVerificationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  newEmail: string
  onVerificationComplete: () => void
}

export function EmailVerificationDialog({
  open,
  onOpenChange,
  newEmail,
  onVerificationComplete,
}: EmailVerificationDialogProps) {
  const handleConfirm = () => {
    onVerificationComplete()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Verify new email</DialogTitle>
          <DialogDescription>
            A verification link will be sent to <span className="font-mono text-foreground">{newEmail || "(new email)"}</span>. Click the link to confirm the change.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button style={{ background: "var(--brand)" }} onClick={handleConfirm}>
            Send verification
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
