"use client"

import { useState, useEffect } from "react"
import { Lock, Unlock, Key, RefreshCw, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getRoomsWithLocks, ownerTtlockUnlock, ownerTtlockPasscode, ownerTtlockPasscodeSave } from "@/lib/owner-api"

interface PropertyWithLock {
  _id: string
  itemId: string
  type: "property" | "room"
  propertyId: string
  propertyShortname?: string
  roomName?: string
  label?: string
}

export default function OwnerSmartDoorPage() {
  const [items, setItems] = useState<PropertyWithLock[]>([])
  const [selectedItemId, setSelectedItemId] = useState<string>("")
  const [loading, setLoading] = useState(true)

  const [unlocked, setUnlocked] = useState(false)
  const [unlockLoading, setUnlockLoading] = useState(false)
  const [unlockError, setUnlockError] = useState<string | null>(null)

  const [passcode, setPasscode] = useState<string | null>(null)
  const [passcodeLoading, setPasscodeLoading] = useState(false)

  const [changePinOpen, setChangePinOpen] = useState(false)
  const [newPin, setNewPin] = useState("")
  const [changePinLoading, setChangePinLoading] = useState(false)
  const [changePinError, setChangePinError] = useState<string | null>(null)

  useEffect(() => {
    getRoomsWithLocks().then((res) => {
      const list = (res?.items as PropertyWithLock[]) || []
      setItems(list)
      if (list[0]) setSelectedItemId((prev) => (prev ? prev : list[0].itemId))
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!selectedItemId) return
    setPasscodeLoading(true)
    ownerTtlockPasscode(selectedItemId)
      .then((res) => {
        if (res?.ok && res?.password) setPasscode(res.password)
        else setPasscode(null)
      })
      .catch(() => setPasscode(null))
      .finally(() => setPasscodeLoading(false))
  }, [selectedItemId])

  const selectedItem = items.find((i) => i.itemId === selectedItemId)
  const hasSmartdoor = selectedItemId != null && selectedItem != null

  const handleUnlock = async () => {
    if (!selectedItemId) {
      setUnlockError("Please select a property.")
      return
    }
    setUnlockError(null)
    setUnlockLoading(true)
    try {
      const res = await ownerTtlockUnlock(selectedItemId)
      if (res?.ok) {
        setUnlocked(true)
        setTimeout(() => setUnlocked(false), 3000)
      } else {
        setUnlockError((res as { reason?: string })?.reason || "Unlock failed.")
      }
    } catch (e) {
      setUnlockError(e instanceof Error ? e.message : "Unlock failed.")
    } finally {
      setUnlockLoading(false)
    }
  }

  const handleChangePinSubmit = async () => {
    if (!selectedItemId || !newPin.trim()) return
    const pwd = newPin.trim()
    if (pwd.length < 4 || pwd.length > 12) {
      setChangePinError("PIN must be 4–12 digits.")
      return
    }
    setChangePinError(null)
    setChangePinLoading(true)
    try {
      const res = await ownerTtlockPasscodeSave(selectedItemId, pwd)
      if (res?.ok) {
        setPasscode(pwd)
        setNewPin("")
        setChangePinOpen(false)
      } else {
        setChangePinError((res as { reason?: string })?.reason || "Change PIN failed.")
      }
    } catch (e) {
      setChangePinError(e instanceof Error ? e.message : "Change PIN failed.")
    } finally {
      setChangePinLoading(false)
    }
  }

  const pinDigits = passcode ? passcode.split("") : []

  if (loading) {
    return (
      <div className="p-4 lg:p-8 flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-foreground">Smart Access</h1>
        <p className="text-muted-foreground mt-1">One password per property or per room. Remote unlock and set owner PIN.</p>
      </div>

      {items.length === 0 && (
        <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          No properties with smart door found. Please contact your operator to set up smart locks.
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="mb-6">
            <Label className="mb-2 block">Select Property</Label>
            <Select value={selectedItemId} onValueChange={setSelectedItemId}>
              <SelectTrigger className="w-full max-w-xs">
                <SelectValue placeholder="Select property" />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => {
                  const displayLabel =
                    i.label ||
                    (i.type === "room"
                      ? `${i.propertyShortname ?? ""} | ${i.roomName ?? "Room"}`
                      : i.propertyShortname ?? i.itemId ?? "Property")
                  return (
                    <SelectItem key={i.itemId} value={i.itemId}>
                      {displayLabel || "\u00A0"}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Unlock Panel */}
            <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-10 flex flex-col items-center justify-center min-h-80">
              <button
                onClick={handleUnlock}
                disabled={unlockLoading || !hasSmartdoor}
                className="w-36 h-36 rounded-full flex items-center justify-center mb-6 transition-all hover:scale-105 active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed"
                style={{
                  background: unlocked ? "#22c55e" : "var(--brand)",
                  boxShadow: unlocked
                    ? "0 0 0 12px rgba(34,197,94,0.15)"
                    : "0 0 0 12px rgba(162,111,92,0.12)",
                }}
              >
                {unlockLoading ? (
                  <RefreshCw size={48} className="text-white animate-spin" />
                ) : unlocked ? (
                  <Unlock size={48} className="text-white" />
                ) : (
                  <Lock size={48} className="text-white" />
                )}
              </button>

              <h2 className="text-2xl font-black text-foreground mb-2">
                {unlockLoading ? "Connecting..." : unlocked ? "Door Unlocked!" : "Tap to Unlock"}
              </h2>
              <p className="text-sm text-muted-foreground text-center mb-4 max-w-xs leading-relaxed">
                {unlocked
                  ? "Your door is now unlocked. It will re-lock automatically in 3 seconds."
                  : "Remote unlock via TTLock. Ensure your lock is online."}
              </p>
              {unlockError && <p className="text-sm text-destructive mb-4">{unlockError}</p>}

              <button
                onClick={handleUnlock}
                disabled={unlockLoading || unlocked || !hasSmartdoor}
                className={cn(
                  "w-full max-w-sm py-4 rounded-2xl font-bold text-white text-sm tracking-wider uppercase transition-all",
                  unlockLoading || unlocked || !hasSmartdoor ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
                )}
                style={{ background: unlocked ? "#22c55e" : "var(--brand)" }}
              >
                {unlockLoading ? "Connecting..." : unlocked ? "Unlocked" : "Remote Unlock"}
              </button>
            </div>

            {/* Right column - Access PIN */}
            <div className="flex flex-col gap-4">
              <div className="bg-foreground rounded-2xl p-6 text-white">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                    <Key size={15} className="text-white" />
                  </div>
                  <h2 className="font-bold text-base">Owner PIN</h2>
                </div>

                <p className="text-[9px] tracking-[0.3em] uppercase text-white/40 mb-3">Current PIN</p>
                <div className="flex items-center gap-2 mb-5">
                  {passcodeLoading ? (
                    <Loader2 size={20} className="text-white/60 animate-spin" />
                  ) : pinDigits.length > 0 ? (
                    pinDigits.map((d, i) => (
                      <div
                        key={i}
                        className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-white font-black text-lg"
                      >
                        {d}
                      </div>
                    ))
                  ) : (
                    <span className="text-white/50 text-sm">No PIN set</span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setChangePinOpen(true)
                    setChangePinError(null)
                    setNewPin("")
                  }}
                  disabled={!hasSmartdoor || passcodeLoading}
                  className="w-full py-3 rounded-xl font-bold text-foreground text-sm bg-white hover:bg-white/90 transition-colors mb-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Set / Change PIN
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Change PIN Dialog */}
      <Dialog open={changePinOpen} onOpenChange={setChangePinOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set Owner PIN</DialogTitle>
            <DialogDescription>
              Enter a 4–12 digit PIN. Property-level lock: one PIN for the main door. Room-level lock: one PIN per room.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label className="text-xs font-semibold block mb-2">New PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="e.g. 123456"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 12))}
                maxLength={12}
                className="font-mono text-lg"
              />
            </div>
            {changePinError && <p className="text-sm text-destructive">{changePinError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangePinOpen(false)} disabled={changePinLoading}>
              Cancel
            </Button>
            <Button
              onClick={handleChangePinSubmit}
              disabled={changePinLoading || newPin.length < 4}
              style={{ background: "var(--brand)" }}
            >
              {changePinLoading ? <Loader2 size={16} className="animate-spin" /> : "Save PIN"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
