"use client"

import { useState, useEffect, useCallback } from "react"
import { Lock, Unlock, Key, RefreshCw, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTenantOptional } from "@/contexts/tenant-context"
import {
  tenantTtlockUnlock,
  tenantTtlockPasscode,
  tenantTtlockPasscodeSave,
  type TenantSmartDoorScope,
} from "@/lib/tenant-api"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export default function SmartDoorPage() {
  const state = useTenantOptional()
  const tenancies = (state?.tenancies ?? []) as {
    id?: string
    _id?: string
    room?: { hasSmartDoor?: boolean }
    property?: { hasSmartDoor?: boolean }
  }[]
  const selectedTenancyId = state?.selectedTenancyId ?? null
  const activeTenancy = tenancies.find((t) => (t.id ?? t._id) === selectedTenancyId) ?? tenancies[0]
  const activeTenancyId = activeTenancy?.id ?? activeTenancy?._id
  const tenancyReadOnly = !!(activeTenancy as { isPortalReadOnly?: boolean } | undefined)?.isPortalReadOnly

  const [smartDoorScope, setSmartDoorScope] = useState<TenantSmartDoorScope>("all")
  const [hasPropertyLock, setHasPropertyLock] = useState(false)
  const [hasRoomLock, setHasRoomLock] = useState(false)
  const [passwordMismatch, setPasswordMismatch] = useState(false)
  const [passwordProperty, setPasswordProperty] = useState<string | null>(null)
  const [passwordRoom, setPasswordRoom] = useState<string | null>(null)

  const [unlocked, setUnlocked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [unlockError, setUnlockError] = useState<string | null>(null)
  /** Partial success: some locks opened, others not supported by TTLock cloud unlock */
  const [unlockNotice, setUnlockNotice] = useState<string | null>(null)

  const [passcode, setPasscode] = useState<string | null>(null)
  const [passcodeLoading, setPasscodeLoading] = useState(false)

  const [changePinOpen, setChangePinOpen] = useState(false)
  const [newPin, setNewPin] = useState("")
  const [changePinLoading, setChangePinLoading] = useState(false)
  const [changePinError, setChangePinError] = useState<string | null>(null)
  const [pinNotice, setPinNotice] = useState<string | null>(null)

  const showDoorPicker = hasPropertyLock && hasRoomLock

  const loadPasscode = useCallback(async () => {
    if (!activeTenancyId) return
    setPasscodeLoading(true)
    try {
      const res = await tenantTtlockPasscode(activeTenancyId, smartDoorScope)
      if (res?.ok) {
        setHasPropertyLock(!!res.hasPropertyLock)
        setHasRoomLock(!!res.hasRoomLock)
        setPasswordMismatch(!!res.passwordMismatch)
        setPasswordProperty(res.passwordProperty ?? null)
        setPasswordRoom(res.passwordRoom ?? null)
        setPasscode(res.password ?? null)
      } else {
        setPasscode(null)
      }
    } catch {
      setPasscode(null)
    } finally {
      setPasscodeLoading(false)
    }
  }, [activeTenancyId, smartDoorScope])

  useEffect(() => {
    if (!activeTenancyId) return
    void loadPasscode()
  }, [activeTenancyId, smartDoorScope, loadPasscode])

  const handleUnlock = async () => {
    if (tenancyReadOnly) {
      setUnlockError("This tenancy has ended. Remote unlock is disabled.")
      return
    }
    if (!activeTenancyId) {
      setUnlockError("No tenancy selected.")
      return
    }
    setUnlockError(null)
    setUnlockNotice(null)
    setLoading(true)
    try {
      const res = await tenantTtlockUnlock(activeTenancyId, smartDoorScope)
      if (res?.ok) {
        setUnlocked(true)
        setUnlockNotice(
          res.partial && res.warning
            ? res.warning
            : res.partial && res.failedUnlocks?.length
              ? res.failedUnlocks.map((f) => `${f.lockId}: ${f.reason}`).join(" · ")
              : null
        )
        setTimeout(() => setUnlocked(false), 3000)
      } else {
        setUnlockError((res as { reason?: string })?.reason || "Unlock failed.")
      }
    } catch (e) {
      setUnlockError(e instanceof Error ? e.message : "Unlock failed.")
    } finally {
      setLoading(false)
    }
  }

  const handleChangePinSubmit = async () => {
    if (tenancyReadOnly) return
    if (!activeTenancyId || !newPin.trim()) return
    const pwd = newPin.trim()
    if (pwd.length < 4 || pwd.length > 12) {
      setChangePinError("PIN must be 4–12 digits.")
      return
    }
    setChangePinError(null)
    setPinNotice(null)
    setChangePinLoading(true)
    try {
      const res = await tenantTtlockPasscodeSave(activeTenancyId, pwd, smartDoorScope)
      if (res?.ok) {
        setPasscode(pwd)
        if (res.partial) {
          setPinNotice(
            res.warning ??
              (res.failedTargets?.map((f) => `${f.type}:${f.lockId} ${f.reason}`).join(" · ") || null)
          )
        }
        setNewPin("")
        setChangePinOpen(false)
        await loadPasscode()
      } else {
        const r = res as {
          reason?: string
          message?: string
          conflictLabel?: string
          conflictLockId?: string | number
        }
        if (r.reason === "PASSCODE_ALREADY_USED_ON_LOCK") {
          setChangePinError(
            r.message ||
              (r.conflictLabel
                ? `This PIN is already in use on the ${r.conflictLabel} (lock ID: ${r.conflictLockId ?? ""}). It may belong to another tenant. Please choose a different PIN.`
                : "This PIN is already in use on a lock. It may belong to another tenant. Please choose a different PIN.")
          )
        } else {
          setChangePinError(r.reason || "Change PIN failed.")
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes("Unexpected token") || msg.includes("not valid JSON") || msg.includes("non-JSON")) {
        setChangePinError(`API 返回了 HTML 而非 JSON。預設應直接調用 api.colivingjb.com。錯誤詳情：${msg}`)
      } else {
        setChangePinError(msg || "Change PIN failed.")
      }
    } finally {
      setChangePinLoading(false)
    }
  }

  const pinDigits =
    passcode && !(passwordMismatch && smartDoorScope === "all") ? passcode.split("") : []
  const hasSmartdoor = !!(activeTenancy?.room?.hasSmartDoor || activeTenancy?.property?.hasSmartDoor)

  const scopeLabel =
    smartDoorScope === "all"
      ? "all smart doors"
      : smartDoorScope === "property"
        ? "property door"
        : "room door"

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-foreground">Smart Access</h1>
        <p className="text-muted-foreground mt-1">Control your room access and manage guest PINs.</p>
      </div>

      {!hasSmartdoor && (
        <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          The selected tenancy has no room/property smart door. Please switch room or contact your operator.
        </div>
      )}

      {hasSmartdoor && tenancyReadOnly && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-sm">
          This tenancy is ended. You can view your PIN below, but remote unlock and PIN changes are disabled.
        </div>
      )}

      {hasSmartdoor && showDoorPicker && (
        <div className="mb-6 max-w-md">
          <Label className="text-xs font-semibold text-muted-foreground mb-2 block">Door</Label>
          <Select
            value={smartDoorScope}
            onValueChange={(v) => setSmartDoorScope(v as TenantSmartDoorScope)}
            disabled={tenancyReadOnly}
          >
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Select door" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All smart doors</SelectItem>
              <SelectItem value="property">Property (main / shared) door</SelectItem>
              <SelectItem value="room">Room door</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-2">
            Unlock and PIN changes apply to the selection above. Default is all doors.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Unlock Panel */}
        <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-10 flex flex-col items-center justify-center min-h-80">
          <button
            onClick={handleUnlock}
            disabled={loading || !hasSmartdoor || tenancyReadOnly}
            className="w-36 h-36 rounded-full flex items-center justify-center mb-6 transition-all hover:scale-105 active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed"
            style={{
              background: unlocked ? "#22c55e" : "var(--brand)",
              boxShadow: unlocked
                ? "0 0 0 12px rgba(34,197,94,0.15)"
                : "0 0 0 12px rgba(162,111,92,0.12)",
            }}
          >
            {loading ? (
              <RefreshCw size={48} className="text-white animate-spin" />
            ) : unlocked ? (
              <Unlock size={48} className="text-white" />
            ) : (
              <Lock size={48} className="text-white" />
            )}
          </button>

          <h2 className="text-2xl font-black text-foreground mb-2">
            {loading ? "Connecting..." : unlocked ? "Door Unlocked!" : "Tap to Unlock"}
          </h2>
          <p className="text-sm text-muted-foreground text-center mb-4 max-w-xs leading-relaxed">
            {unlocked
              ? "Your door is now unlocked. It will re-lock automatically in 3 seconds."
              : `Remote unlock (${scopeLabel}) via TTLock. Ensure your lock is online.`}
          </p>
          {unlockError && <p className="text-sm text-destructive mb-4">{unlockError}</p>}
          {unlockNotice && (
            <p className="text-sm text-amber-700 dark:text-amber-400 mb-4 max-w-md text-center leading-snug">
              {unlockNotice}
            </p>
          )}

          <button
            onClick={handleUnlock}
            disabled={loading || unlocked || !hasSmartdoor || tenancyReadOnly}
            className={cn(
              "w-full max-w-sm py-4 rounded-2xl font-bold text-white text-sm tracking-wider uppercase transition-all",
              loading || unlocked || !hasSmartdoor ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
            )}
            style={{ background: unlocked ? "#22c55e" : "var(--brand)" }}
          >
            {loading ? "Connecting..." : unlocked ? "Unlocked" : "Remote Unlock"}
          </button>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">
          {/* Access PIN */}
          <div className="bg-foreground rounded-2xl p-6 text-white">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <Key size={15} className="text-white" />
              </div>
              <h2 className="font-bold text-base">Access PIN</h2>
            </div>

            <p className="text-[9px] tracking-[0.3em] uppercase text-white/40 mb-3">Current PIN</p>

            {passwordMismatch && smartDoorScope === "all" && (
              <p className="text-xs text-amber-200/90 mb-3 leading-relaxed">
                Property and room use different PINs. Pick a door above to view or change each PIN, or set the same PIN on both using &quot;All smart doors&quot;.
              </p>
            )}

            {passwordMismatch && smartDoorScope === "all" && (
              <div className="grid grid-cols-1 gap-2 mb-4 text-xs">
                <div className="rounded-lg bg-white/10 px-3 py-2">
                  <span className="text-white/50 block text-[10px] uppercase tracking-wider mb-1">
                    Property
                  </span>
                  <span className="font-mono font-bold tracking-widest">
                    {passwordProperty ?? "—"}
                  </span>
                </div>
                <div className="rounded-lg bg-white/10 px-3 py-2">
                  <span className="text-white/50 block text-[10px] uppercase tracking-wider mb-1">Room</span>
                  <span className="font-mono font-bold tracking-widest">{passwordRoom ?? "—"}</span>
                </div>
              </div>
            )}

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
              ) : !(passwordMismatch && smartDoorScope === "all") ? (
                <span className="text-white/50 text-sm">No PIN set</span>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => {
                setChangePinOpen(true)
                setChangePinError(null)
                setNewPin("")
              }}
              disabled={!hasSmartdoor || passcodeLoading || tenancyReadOnly}
              className="w-full py-3 rounded-xl font-bold text-foreground text-sm bg-white hover:bg-white/90 transition-colors mb-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Change PIN
            </button>
            <button
              type="button"
              disabled
              className="w-full py-3 rounded-xl font-bold text-white/60 text-sm cursor-not-allowed"
              title="Coming soon"
            >
              Generate Guest PIN
            </button>
          </div>
        </div>
      </div>

      {/* Change PIN Dialog */}
      <Dialog open={changePinOpen} onOpenChange={setChangePinOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change PIN</DialogTitle>
            <DialogDescription>
              Enter a new 4–12 digit PIN for{" "}
              {smartDoorScope === "all"
                ? "all selected smart doors"
                : smartDoorScope === "property"
                  ? "the property (main / shared) door"
                  : "your room door"}
              .
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
            {pinNotice && (
              <p className="text-xs text-amber-200/90 mb-3 leading-relaxed">{pinNotice}</p>
            )}
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
