"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Check, ChevronsUpDown, Loader2, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  clnGetSmartDoorList,
  type CleanlemonSmartDoorScope,
  type ClnNativeLockBindingRow,
  fetchOperatorTtlockOnboardStatus,
  fetchClientTtlockOnboardStatus,
  postOperatorPropertyLocksBind,
  postOperatorPropertyLocksList,
  postOperatorPropertyLocksUnbind,
  postClientPropertyLocksBind,
  postClientPropertyLocksList,
  postClientPropertyLocksUnbind,
} from "@/lib/cleanlemon-api"

function lockRowId(r: Record<string, unknown>): string {
  return String(r._id ?? r.id ?? "").trim()
}

function lockRowLabel(r: Record<string, unknown>): string {
  const a = String(r.lockalias ?? r.lockAlias ?? "").trim()
  const n = String(r.lockname ?? r.lockName ?? "").trim()
  const id = lockRowId(r)
  return (a || n || id).trim() || id
}

export type CleanlemonPropertyNativeLocksPanelProps = {
  scope: CleanlemonSmartDoorScope
  email: string
  operatorId: string
  propertyId: string | null
  /** Bind/unbind in this portal (false when Coliving row owns locks or role forbids). */
  canBindAndUnbind: boolean
  readOnlyHint?: string
}

export function CleanlemonPropertyNativeLocksPanel({
  scope,
  email,
  operatorId,
  propertyId,
  canBindAndUnbind,
  readOnlyHint,
}: CleanlemonPropertyNativeLocksPanelProps) {
  const [bindings, setBindings] = useState<ClnNativeLockBindingRow[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [slots, setSlots] = useState<Array<{ slot: number; label: string }>>([])
  const [ttlockSlot, setTtlockSlot] = useState(0)
  const [lockSearch, setLockSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [lockOptions, setLockOptions] = useState<Array<{ id: string; label: string }>>([])
  const [locksLoading, setLocksLoading] = useState(false)
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null)
  const [comboOpen, setComboOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [unbindId, setUnbindId] = useState<string | null>(null)

  const ctx = useMemo(
    () => ({ email: String(email || "").trim().toLowerCase(), operatorId: String(operatorId || "").trim() }),
    [email, operatorId]
  )

  const reloadBindings = useCallback(async () => {
    if (!propertyId) return
    setListLoading(true)
    try {
      const r =
        scope === "operator"
          ? await postOperatorPropertyLocksList(operatorId, propertyId)
          : await postClientPropertyLocksList(ctx.email, operatorId, propertyId)
      if (!r.ok) {
        toast.error(r.reason || "Could not load lock list")
        return
      }
      setBindings(Array.isArray(r.items) ? r.items : [])
    } finally {
      setListLoading(false)
    }
  }, [propertyId, scope, operatorId, ctx.email])

  useEffect(() => {
    void reloadBindings()
  }, [reloadBindings])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(lockSearch.trim()), 320)
    return () => clearTimeout(t)
  }, [lockSearch])

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true)
    try {
      if (scope === "operator") {
        const r = await fetchOperatorTtlockOnboardStatus(operatorId)
        const acc = Array.isArray(r.accounts) ? r.accounts : []
        const connected = acc.filter((a) => a.connected)
        const opts = (connected.length ? connected : acc).map((a) => ({
          slot: Number(a.slot) || 0,
          label:
            String(a.accountName || "").trim() ||
            (String(a.username || "").trim() ? `TTLock ${a.username}` : `Slot ${a.slot}`),
        }))
        setSlots(opts.length ? opts : [{ slot: 0, label: "Default account" }])
        setTtlockSlot(opts.length ? opts[0].slot : 0)
      } else {
        const r = await fetchClientTtlockOnboardStatus(ctx.email, operatorId)
        const acc = Array.isArray(r.accounts) ? r.accounts : []
        const connected = acc.filter((a) => a.connected)
        const opts = (connected.length ? connected : acc).map((a) => ({
          slot: Number(a.slot) || 0,
          label:
            String(a.accountName || "").trim() ||
            (String(a.username || "").trim() ? `TTLock ${a.username}` : `Slot ${a.slot}`),
        }))
        setSlots(opts.length ? opts : [{ slot: 0, label: "Default account" }])
        setTtlockSlot(opts.length ? opts[0].slot : 0)
      }
    } finally {
      setAccountsLoading(false)
    }
  }, [scope, operatorId, ctx.email])

  useEffect(() => {
    if (!modalOpen || !email) return
    void loadAccounts()
  }, [modalOpen, email, loadAccounts])

  useEffect(() => {
    if (!modalOpen) return
    let cancelled = false
    void (async () => {
      setLocksLoading(true)
      try {
        const listRes = await clnGetSmartDoorList(scope, ctx, {
          filter: "LOCK",
          page: 1,
          pageSize: 100,
          keyword: debouncedSearch || undefined,
          ttlockSlot,
        })
        const listResAny = listRes as Record<string, unknown> | null
        const fromItems = (listResAny?.items ?? []) as unknown[]
        const fromList = (listResAny?.list ?? []) as unknown[]
        const raw = (fromItems.length ? fromItems : fromList) as Array<Record<string, unknown>>
        const opts = raw
          .map((r) => {
            const id = lockRowId(r)
            if (!id) return null
            return { id, label: lockRowLabel(r) }
          })
          .filter((x): x is { id: string; label: string } => x != null)
        if (!cancelled) setLockOptions(opts)
      } catch {
        if (!cancelled) setLockOptions([])
      } finally {
        if (!cancelled) setLocksLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [modalOpen, scope, ctx, debouncedSearch, ttlockSlot])

  const onOpenModal = () => {
    if (!canBindAndUnbind) return
    setPicked(null)
    setLockSearch("")
    setComboOpen(false)
    setModalOpen(true)
  }

  const onConfirmBind = async () => {
    if (!propertyId || !picked?.id) {
      toast.error("Choose a lock")
      return
    }
    const integrationSource = `ttlock_slot_${ttlockSlot}`.slice(0, 32)
    setSaving(true)
    try {
      const r =
        scope === "operator"
          ? await postOperatorPropertyLocksBind(operatorId, propertyId, picked.id, {
              ttlockSlot,
              integrationSource,
            })
          : await postClientPropertyLocksBind(ctx.email, operatorId, propertyId, picked.id, {
              ttlockSlot,
              integrationSource,
            })
      if (!r.ok) {
        toast.error(r.reason || "Bind failed")
        return
      }
      toast.success("Lock linked to this property")
      setModalOpen(false)
      await reloadBindings()
    } finally {
      setSaving(false)
    }
  }

  const onUnbind = async (lockdetailId: string) => {
    if (!propertyId || !canBindAndUnbind) return
    if (!window.confirm("Remove this lock from the property?")) return
    setUnbindId(lockdetailId)
    try {
      const r =
        scope === "operator"
          ? await postOperatorPropertyLocksUnbind(operatorId, propertyId, lockdetailId)
          : await postClientPropertyLocksUnbind(ctx.email, operatorId, propertyId, lockdetailId)
      if (!r.ok) {
        toast.error(r.reason || "Unbind failed")
        return
      }
      toast.success("Lock removed")
      await reloadBindings()
    } finally {
      setUnbindId(null)
    }
  }

  if (!propertyId) return null

  return (
    <div className="space-y-3 rounded-md border border-dashed border-primary/25 bg-muted/10 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Smart door — TTLock on this unit</p>
          <p className="text-xs text-muted-foreground mt-1">
            One lock can be used on several properties. Pick your TTLock account, search the lock, then confirm. (Coliving
            Edit utility stays separate when this unit is linked to Coliving.)
          </p>
          {readOnlyHint ? (
            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-2">
              {readOnlyHint}
            </p>
          ) : null}
        </div>
        {canBindAndUnbind ? (
          <Button type="button" size="sm" className="shrink-0 gap-1" onClick={onOpenModal}>
            <Plus className="h-4 w-4" />
            Add lock
          </Button>
        ) : null}
      </div>

      {listLoading ? (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </p>
      ) : bindings.length === 0 ? (
        <p className="text-xs text-muted-foreground">No TTLock bound to this unit yet.</p>
      ) : (
        <ul className="text-sm space-y-2 rounded-md border bg-background p-3">
          {bindings.map((b) => (
            <li key={b.bindId} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium truncate">{b.lockLabel || b.lockdetailId}</p>
                <p className="text-[11px] text-muted-foreground">
                  Slot {b.ttlockSlot}
                  {b.integrationSource ? ` · ${b.integrationSource}` : ""}
                </p>
              </div>
              {canBindAndUnbind ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="shrink-0 text-destructive"
                  disabled={unbindId === b.lockdetailId}
                  onClick={() => void onUnbind(b.lockdetailId)}
                  aria-label="Remove lock"
                >
                  {unbindId === b.lockdetailId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link a lock</DialogTitle>
            <DialogDescription>Choose integration account and lock, then confirm.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label className="text-xs">Integration account (TTLock)</Label>
              {accountsLoading ? (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading accounts…
                </p>
              ) : (
                <Select
                  value={String(ttlockSlot)}
                  onValueChange={(v) => {
                    setTtlockSlot(Number(v) || 0)
                    setPicked(null)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {slots.map((s) => (
                      <SelectItem key={s.slot} value={String(s.slot)}>
                        {s.label} (slot {s.slot})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Lock</Label>
              <Popover open={comboOpen} onOpenChange={setComboOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={comboOpen}
                    className="w-full justify-between font-normal"
                  >
                    {picked ? picked.label : "Search and pick a lock…"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search locks…"
                      value={lockSearch}
                      onValueChange={setLockSearch}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {locksLoading ? "Loading…" : "No locks found for this account."}
                      </CommandEmpty>
                      <CommandGroup>
                        {lockOptions.map((opt) => (
                          <CommandItem
                            key={opt.id}
                            value={`${opt.label} ${opt.id}`}
                            onSelect={() => {
                              setPicked(opt)
                              setComboOpen(false)
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                picked?.id === opt.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <span className="truncate">{opt.label}</span>
                            <span className="ml-2 text-[10px] text-muted-foreground font-mono truncate">
                              {opt.id.slice(0, 8)}…
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={saving || !picked} onClick={() => void onConfirmBind()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
