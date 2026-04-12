'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  fetchAdminGlobalPropertyNames,
  fetchAdminPropertiesBrief,
  fetchAdminOperatorsBrief,
  fetchAdminClientdetailsBrief,
  postAdminMergePropertyNames,
  postAdminTransferProperty,
  fetchAdminPropertyDeletePreview,
  postAdminPropertyDelete,
  type AdminPropertyBrief,
  type AdminIdLabel,
  type AdminPropertyDeletePreviewRow,
  type AdminPropertyDeleteCounts,
} from '@/lib/cleanlemon-api'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export default function AdminMergePage() {
  const [mergeToName, setMergeToName] = useState('')
  const [mergeFromName, setMergeFromName] = useState('')
  const [mergeNameOptions, setMergeNameOptions] = useState<string[]>([])
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergeSaving, setMergeSaving] = useState(false)
  const [mergeMsg, setMergeMsg] = useState('')

  const [transferProps, setTransferProps] = useState<AdminPropertyBrief[]>([])
  const [transferPropSearch, setTransferPropSearch] = useState('')
  const [transferPropertyId, setTransferPropertyId] = useState('')
  const [transferOperators, setTransferOperators] = useState<AdminIdLabel[]>([])
  const [transferOpSearch, setTransferOpSearch] = useState('')
  const [transferOperatorId, setTransferOperatorId] = useState('')
  const [transferClients, setTransferClients] = useState<AdminIdLabel[]>([])
  const [transferClientSearch, setTransferClientSearch] = useState('')
  const [transferClientdetailId, setTransferClientdetailId] = useState('')
  const [transferSaving, setTransferSaving] = useState(false)
  const [transferMsg, setTransferMsg] = useState('')

  const [delPropSearch, setDelPropSearch] = useState('')
  const [delProps, setDelProps] = useState<AdminPropertyBrief[]>([])
  const [delPropertyId, setDelPropertyId] = useState('')
  const [delPreview, setDelPreview] = useState<{
    property: AdminPropertyDeletePreviewRow
    counts: AdminPropertyDeleteCounts
  } | null>(null)
  const [delPreviewLoading, setDelPreviewLoading] = useState(false)
  const [delMsg, setDelMsg] = useState('')
  const [delDeleting, setDelDeleting] = useState(false)
  const [delConfirmOpen, setDelConfirmOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setMergeLoading(true)
    fetchAdminGlobalPropertyNames('', 450).then((r) => {
      if (cancelled) return
      setMergeNameOptions(Array.isArray(r.names) ? r.names : [])
      setMergeLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => {
      fetchAdminPropertiesBrief(transferPropSearch || undefined, 120).then((r) => {
        if (r.ok && r.items) setTransferProps(r.items)
      })
    }, 320)
    return () => window.clearTimeout(t)
  }, [transferPropSearch])

  useEffect(() => {
    const t = window.setTimeout(() => {
      fetchAdminOperatorsBrief(transferOpSearch || undefined, 100).then((r) => {
        if (r.ok && r.items) setTransferOperators(r.items)
      })
    }, 320)
    return () => window.clearTimeout(t)
  }, [transferOpSearch])

  useEffect(() => {
    const t = window.setTimeout(() => {
      fetchAdminClientdetailsBrief(transferClientSearch || undefined, 100).then((r) => {
        if (r.ok && r.items) setTransferClients(r.items)
      })
    }, 320)
    return () => window.clearTimeout(t)
  }, [transferClientSearch])

  useEffect(() => {
    const t = window.setTimeout(() => {
      fetchAdminPropertiesBrief(delPropSearch || undefined, 120).then((r) => {
        if (r.ok && r.items) setDelProps(r.items)
      })
    }, 320)
    return () => window.clearTimeout(t)
  }, [delPropSearch])

  useEffect(() => {
    const id = delPropertyId.trim()
    if (!id) {
      setDelPreview(null)
      return
    }
    let cancelled = false
    setDelPreviewLoading(true)
    setDelMsg('')
    fetchAdminPropertyDeletePreview(id).then((r) => {
      if (cancelled) return
      setDelPreviewLoading(false)
      if (!r.ok || !r.property || !r.counts) {
        setDelPreview(null)
        setDelMsg(r.reason || 'PREVIEW_FAILED')
        return
      }
      setDelPreview({ property: r.property, counts: r.counts })
    })
    return () => {
      cancelled = true
    }
  }, [delPropertyId])

  const handleMergePropertyNames = async () => {
    const to = mergeToName.trim()
    const from = mergeFromName.trim()
    setMergeMsg('')
    if (!to || !from) {
      setMergeMsg('Enter target name (A) and choose source name (B).')
      return
    }
    if (from === to) {
      setMergeMsg('Source and target must differ.')
      return
    }
    setMergeSaving(true)
    const r = await postAdminMergePropertyNames(from, to)
    setMergeSaving(false)
    if (!r.ok) {
      setMergeMsg(r.reason || 'MERGE_FAILED')
      return
    }
    setMergeMsg(
      `Renamed ${r.updated ?? 0} property row(s). Coliving shortname rows updated: ${r.colivingUpdated ?? 0}.`
    )
    setMergeFromName('')
    const r2 = await fetchAdminGlobalPropertyNames('', 450)
    if (r2.ok && r2.names) setMergeNameOptions(r2.names)
  }

  const handleTransferProperty = async () => {
    setTransferMsg('')
    const pid = transferPropertyId.trim()
    if (!pid) {
      setTransferMsg('Choose a property.')
      return
    }
    if (!transferOperatorId && !transferClientdetailId) {
      setTransferMsg('Set a new operator and/or binding client (at least one).')
      return
    }
    setTransferSaving(true)
    const r = await postAdminTransferProperty({
      propertyId: pid,
      ...(transferOperatorId ? { operatorId: transferOperatorId } : {}),
      ...(transferClientdetailId ? { clientdetailId: transferClientdetailId } : {}),
    })
    setTransferSaving(false)
    if (!r.ok) {
      setTransferMsg(r.reason || 'TRANSFER_FAILED')
      return
    }
    setTransferMsg('Saved.')
    setTransferOperatorId('')
    setTransferClientdetailId('')
  }

  const handleConfirmDeleteProperty = async () => {
    const id = delPropertyId.trim()
    if (!id) return
    setDelDeleting(true)
    setDelMsg('')
    const r = await postAdminPropertyDelete(id)
    setDelDeleting(false)
    setDelConfirmOpen(false)
    if (!r.ok) {
      setDelMsg(r.reason || 'DELETE_FAILED')
      return
    }
    setDelMsg(
      `Deleted property. Removed damage reports: ${r.deleted?.damageReports ?? 0}, link requests: ${r.deleted?.linkRequests ?? 0}, team JSON updates: ${r.deleted?.operatorTeamsUpdated ?? 0}. Schedules keep history with property unlinked.`
    )
    setDelPropertyId('')
    setDelPreview(null)
    fetchAdminPropertiesBrief(delPropSearch || undefined, 120).then((x) => {
      if (x.ok && x.items) setDelProps(x.items)
    })
    fetchAdminPropertiesBrief(transferPropSearch || undefined, 120).then((x) => {
      if (x.ok && x.items) setTransferProps(x.items)
    })
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Merge & transfer properties</h1>
          <p className="text-muted-foreground">
            Canonical building names, binding, and destructive deletes (platform admin).
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardContent className="p-6 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Merge property names</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Rename every row using name B to the canonical name A (e.g. GREENFIELDS → GREENFIELD). Updates Coliving
                  shortname when a building link exists.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="merge-to-name">A — Target name (keep this spelling)</Label>
                <Input
                  id="merge-to-name"
                  placeholder="e.g. GREENFIELD"
                  value={mergeToName}
                  onChange={(e) => setMergeToName(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label>B — Name to replace (all rows)</Label>
                <Select
                  value={mergeFromName || '__pick__'}
                  onValueChange={(v) => setMergeFromName(v === '__pick__' ? '' : v)}
                  disabled={mergeLoading}
                >
                  <SelectTrigger className="w-full max-w-full">
                    <SelectValue placeholder={mergeLoading ? 'Loading names…' : 'Choose building name…'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__pick__">Choose…</SelectItem>
                    {mergeNameOptions.map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={handleMergePropertyNames} disabled={mergeSaving || mergeLoading}>
                  {mergeSaving ? 'Merging…' : 'Merge'}
                </Button>
                {mergeMsg ? <p className="text-sm text-foreground">{mergeMsg}</p> : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Transfer property</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Move one property to another operator and/or binding client (cln_clientdetail). At least one target is
                  required.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="transfer-prop-search">Search property</Label>
                <Input
                  id="transfer-prop-search"
                  placeholder="Name, unit, or id…"
                  value={transferPropSearch}
                  onChange={(e) => setTransferPropSearch(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label>Property</Label>
                <Select
                  value={transferPropertyId || '__pick__'}
                  onValueChange={(v) => setTransferPropertyId(v === '__pick__' ? '' : v)}
                >
                  <SelectTrigger className="w-full max-w-full">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="__pick__">Choose…</SelectItem>
                    {transferProps.map((p) => (
                      <SelectItem key={p.id} value={p.id} title={p.label}>
                        <span className="line-clamp-2 text-left">
                          {p.propertyName ? (
                            <>
                              <span className="font-medium">{p.propertyName}</span>
                              {p.unitName ? (
                                <span className="text-muted-foreground font-normal"> · {p.unitName}</span>
                              ) : null}
                            </>
                          ) : (
                            <span className="font-medium">{p.label}</span>
                          )}
                          {p.operatorName || p.clientdetailName
                            ? ` — ${[p.operatorName, p.clientdetailName].filter(Boolean).join(' · ')}`
                            : ''}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="transfer-op-search">New operator (optional)</Label>
                <Input
                  id="transfer-op-search"
                  placeholder="Search company…"
                  value={transferOpSearch}
                  onChange={(e) => setTransferOpSearch(e.target.value)}
                  autoComplete="off"
                />
                <Select
                  value={transferOperatorId || '__none__'}
                  onValueChange={(v) => setTransferOperatorId(v === '__none__' ? '' : v)}
                >
                  <SelectTrigger className="w-full max-w-full">
                    <SelectValue placeholder="No change" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value="__none__">No change</SelectItem>
                    {transferOperators.map((o) => (
                      <SelectItem key={o.id} value={o.id} title={o.label}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="transfer-cd-search">New binding client (optional)</Label>
                <Input
                  id="transfer-cd-search"
                  placeholder="Search client…"
                  value={transferClientSearch}
                  onChange={(e) => setTransferClientSearch(e.target.value)}
                  autoComplete="off"
                />
                <Select
                  value={transferClientdetailId || '__none__'}
                  onValueChange={(v) => setTransferClientdetailId(v === '__none__' ? '' : v)}
                >
                  <SelectTrigger className="w-full max-w-full">
                    <SelectValue placeholder="No change" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value="__none__">No change</SelectItem>
                    {transferClients.map((c) => (
                      <SelectItem key={c.id} value={c.id} title={c.label}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={handleTransferProperty} disabled={transferSaving}>
                  {transferSaving ? 'Saving…' : 'Transfer'}
                </Button>
                {transferMsg ? <p className="text-sm text-foreground">{transferMsg}</p> : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-6 border-destructive/40">
          <CardContent className="p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Delete property</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Permanently remove one <span className="font-medium">cln_property</span> row. Related damage reports and
                link requests are deleted; schedules stay but lose this property link; team property lists are updated.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="del-prop-search">Search property</Label>
              <Input
                id="del-prop-search"
                placeholder="Name, unit, or id…"
                value={delPropSearch}
                onChange={(e) => setDelPropSearch(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label>Property to delete</Label>
              <Select
                value={delPropertyId || '__pick__'}
                onValueChange={(v) => setDelPropertyId(v === '__pick__' ? '' : v)}
              >
                <SelectTrigger className="w-full max-w-full">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="__pick__">Choose…</SelectItem>
                  {delProps.map((p) => (
                    <SelectItem key={p.id} value={p.id} title={p.label}>
                      <span className="line-clamp-2 text-left">
                        {p.propertyName ? (
                          <>
                            <span className="font-medium">{p.propertyName}</span>
                            {p.unitName ? (
                              <span className="text-muted-foreground font-normal"> · {p.unitName}</span>
                            ) : null}
                          </>
                        ) : (
                          <span className="font-medium">{p.label}</span>
                        )}
                        {p.operatorName || p.clientdetailName
                          ? ` — ${[p.operatorName, p.clientdetailName].filter(Boolean).join(' · ')}`
                          : ''}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {delPreviewLoading ? (
              <p className="text-sm text-muted-foreground">Loading preview…</p>
            ) : null}
            {delPreview ? (
              <div className="rounded-lg border border-input bg-muted/30 p-4 space-y-2 text-sm">
                <p className="font-medium text-foreground">Preview</p>
                <p>
                  <span className="text-muted-foreground">Name / unit:</span>{' '}
                  {delPreview.property.propertyName || delPreview.property.unitName
                    ? [delPreview.property.propertyName, delPreview.property.unitName].filter(Boolean).join(' · ')
                    : '—'}
                </p>
                {delPreview.property.address ? (
                  <p>
                    <span className="text-muted-foreground">Address:</span> {delPreview.property.address}
                  </p>
                ) : null}
                <p>
                  <span className="text-muted-foreground">Operator:</span>{' '}
                  {delPreview.property.operatorName || delPreview.property.operatorId || '—'}
                  {delPreview.property.operatorEmail ? ` (${delPreview.property.operatorEmail})` : ''}
                </p>
                <p>
                  <span className="text-muted-foreground">Binding client (cln_clientdetail):</span>{' '}
                  {delPreview.property.clientdetailId
                    ? `${delPreview.property.clientdetailName || delPreview.property.clientdetailId}${
                        delPreview.property.clientdetailEmail ? ` · ${delPreview.property.clientdetailEmail}` : ''
                      }`
                    : '—'}
                </p>
                {(delPreview.property.colivingPropertydetailId || delPreview.property.colivingRoomdetailId) && (
                  <p className="text-xs text-muted-foreground">
                    Coliving link: propertydetail {delPreview.property.colivingPropertydetailId || '—'} · roomdetail{' '}
                    {delPreview.property.colivingRoomdetailId || '—'}
                  </p>
                )}
                <div className="pt-2 text-xs text-muted-foreground border-t border-input mt-2 space-y-0.5">
                  <p>
                    Related rows: schedules (will unlink) {delPreview.counts.schedules}, legacy damage (will unlink){' '}
                    {delPreview.counts.legacyDamages}, damage reports (deleted) {delPreview.counts.damageReports}, link
                    requests (deleted) {delPreview.counts.linkRequests}, operator teams (JSON strip){' '}
                    {delPreview.counts.operatorTeamsReferencing}
                  </p>
                </div>
              </div>
            ) : null}

            {delMsg ? <p className="text-sm text-foreground">{delMsg}</p> : null}

            <AlertDialog open={delConfirmOpen} onOpenChange={setDelConfirmOpen}>
              <Button
                type="button"
                variant="destructive"
                disabled={!delPreview || delDeleting || delPreviewLoading}
                onClick={() => setDelConfirmOpen(true)}
              >
                Delete property
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this property?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This cannot be undone. The property row and related junction rows (damage reports, link requests,
                    team property picks) will be removed. Existing schedule jobs remain with no property link.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={delDeleting}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-white hover:bg-destructive/90"
                    onClick={(e) => {
                      e.preventDefault()
                      void handleConfirmDeleteProperty()
                    }}
                    disabled={delDeleting}
                  >
                    {delDeleting ? 'Deleting…' : 'Confirm delete'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
