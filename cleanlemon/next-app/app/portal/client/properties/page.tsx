'use client'

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import {
  createOperatorProperty,
  fetchClientPortalProperties,
  fetchClientPortalSyncColivingProperties,
  fetchClientPortalPropertyDetail,
  fetchEmployeeProfileByEmail,
  fetchOperatorLookup,
  fetchOperatorDistinctPropertyNames,
  patchClientPortalProperty,
  postClientPortalBulkRequestOperator,
  postClientPortalBulkDisconnect,
  type ClientPortalPropertyRow,
  type ClientPortalPropertyDetail,
} from '@/lib/cleanlemon-api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable, type Action, type Column } from '@/components/shared/data-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import {
  Building2,
  MapPin,
  Eye,
  Plus,
  Upload,
  Copy,
  Trash2,
  Loader2,
  Link2,
  Unlink,
  RefreshCw,
  ChevronDown,
} from 'lucide-react'

/** DataTable filter value when `cln_property.operator_id` is null (Radix Select disallows empty string). */
const OPERATOR_FILTER_UNASSIGNED = '__unassigned__'
/** Row has pending `client_requests_operator` and no `operator_id` yet. */
const OPERATOR_FILTER_PENDING = '__pending_approval__'

type ClientPropertyRow = {
  id: string
  name: string
  address: string
  unitNumber: string
  type: string
  status: string
  /** Display label (name / email / id / Not connected). */
  operator: string
  /** Stable key for column filter + sort. */
  operatorFilterKey: string
  lastCleaned: string
}

function premisesTypeTableLabel(pt: string): string {
  const s = String(pt || '').trim().toLowerCase()
  const m: Record<string, string> = {
    landed: 'Landed',
    apartment: 'Apartment',
    office: 'Office',
    commercial: 'Commercial',
    other: 'Other',
  }
  return m[s] || 'Residential'
}

function mapApiItemToRow(p: ClientPortalPropertyRow): ClientPropertyRow {
  const pt = String(p.premisesType || '').trim()
  const oid = String(p.operatorId || '').trim()
  const baseOp = String(p.operatorName || '').trim() || '—'
  const pending = !!p.clientOperatorLinkPending
  const operator =
    pending &&
    (!baseOp || baseOp === '—' || baseOp === 'Not connected')
      ? '(pending approval)'
      : pending
        ? `${baseOp} (pending approval)`
        : baseOp
  return {
    id: String(p.id || ''),
    name: p.name?.trim() || 'Property',
    address: String(p.address || '').trim() || '—',
    unitNumber: String(p.unitNumber || '').trim(),
    type: premisesTypeTableLabel(pt),
    status: 'Active',
    operator,
    operatorFilterKey:
      pending && !oid
        ? OPERATOR_FILTER_PENDING
        : oid || OPERATOR_FILTER_UNASSIGNED,
    lastCleaned: p.updatedAt ? String(p.updatedAt).slice(0, 10) : '—',
  }
}

type DetailFormState = {
  premisesType: string
  propertyName: string
  address: string
  unitNumber: string
  mailboxPassword: string
  smartdoorPassword: string
  smartdoorPasswordEnabled: boolean
  smartdoorTokenEnabled: boolean
  securitySystem: string
  afterCleanPhotoUrl: string
  keyPhotoUrl: string
  bedCount: string
  roomCount: string
  bathroomCount: string
  kitchen: string
  livingRoom: string
  balcony: string
  staircase: string
  liftLevel: string
  specialAreaCount: string
}

function detailToForm(p: ClientPortalPropertyDetail): DetailFormState {
  const sdp = (p.smartdoorPassword || '').trim()
  return {
    premisesType: String(p.premisesType || '').trim(),
    propertyName: String(p.name || '').trim(),
    address: String(p.address || '').trim(),
    unitNumber: String(p.unitNumber || '').trim(),
    mailboxPassword: p.mailboxPassword || '',
    smartdoorPassword: sdp,
    smartdoorPasswordEnabled: sdp.length > 0,
    smartdoorTokenEnabled: !!p.smartdoorTokenEnabled,
    securitySystem: String(p.securitySystem || '').trim(),
    afterCleanPhotoUrl: String(p.afterCleanPhotoUrl || '').trim(),
    keyPhotoUrl: String(p.keyPhotoUrl || '').trim(),
    bedCount: p.bedCount != null ? String(p.bedCount) : '',
    roomCount: p.roomCount != null ? String(p.roomCount) : '',
    bathroomCount: p.bathroomCount != null ? String(p.bathroomCount) : '',
    kitchen: p.kitchen != null ? String(p.kitchen) : '',
    livingRoom: p.livingRoom != null ? String(p.livingRoom) : '',
    balcony: p.balcony != null ? String(p.balcony) : '',
    staircase: p.staircase != null ? String(p.staircase) : '',
    liftLevel: p.liftLevel || '',
    specialAreaCount: p.specialAreaCount != null ? String(p.specialAreaCount) : '',
  }
}

const ClientPropertiesPage = () => {
  const { user } = useAuth()
  const [selectedProperty, setSelectedProperty] = useState<ClientPropertyRow | null>(null)
  const [propertyDetail, setPropertyDetail] = useState<ClientPortalPropertyDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailSaving, setDetailSaving] = useState(false)
  const [detailForm, setDetailForm] = useState<DetailFormState>({
    premisesType: '',
    propertyName: '',
    address: '',
    unitNumber: '',
    mailboxPassword: '',
    smartdoorPassword: '',
    smartdoorPasswordEnabled: false,
    smartdoorTokenEnabled: false,
    securitySystem: '',
    afterCleanPhotoUrl: '',
    keyPhotoUrl: '',
    bedCount: '',
    roomCount: '',
    bathroomCount: '',
    kitchen: '',
    livingRoom: '',
    balcony: '',
    staircase: '',
    liftLevel: '',
    specialAreaCount: '',
  })
  const [dbDistinctPropertyNames, setDbDistinctPropertyNames] = useState<string[]>([])
  const [apartmentPropertyNames, setApartmentPropertyNames] = useState<string[]>([])
  const [apartmentNamesStorageReady, setApartmentNamesStorageReady] = useState(false)
  const [isAddApartmentNameOpen, setIsAddApartmentNameOpen] = useState(false)
  const [apartmentNameDraft, setApartmentNameDraft] = useState('')
  const [connectOpen1, setConnectOpen1] = useState(false)
  const [connectOpen2, setConnectOpen2] = useState(false)
  const [connectOperators, setConnectOperators] = useState<Array<{ id: string; name?: string; email?: string }>>([])
  const [connectPickId, setConnectPickId] = useState('')
  const [connectAckTtlock, setConnectAckTtlock] = useState(false)
  const [connectBusy, setConnectBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [propertiesLoading, setPropertiesLoading] = useState(true)
  const [colivingSyncing, setColivingSyncing] = useState(false)
  const [clientUuid, setClientUuid] = useState('-')
  const [operatorSearch, setOperatorSearch] = useState('')
  const [operatorOptions, setOperatorOptions] = useState<Array<{ id: string; name?: string; email?: string }>>([])
  const [selectedOperatorId, setSelectedOperatorId] = useState('')
  const [form, setForm] = useState({
    premisesType: '',
    name: '',
    address: '',
    unitNumber: '',
    keyCollection: 'no',
    securitySystem: '',
    afterCleanPhoto: '',
    remark: '',
    estimateTime: '',
    keyPhoto: '',
    mailboxPassword: '',
    smartdoorPassword: '',
    smartdoorPasswordEnabled: false,
    smartdoorTokenEnabled: false,
    bedCount: '',
    roomCount: '',
    bathroomCount: '',
    kitchen: '',
    livingRoom: '',
    balcony: '',
    staircase: '',
    liftLevel: '',
    specialAreaCount: '',
  })
  const [properties, setProperties] = useState<ClientPropertyRow[]>([])
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<Set<string>>(() => new Set())
  const [bulkConnectOpen1, setBulkConnectOpen1] = useState(false)
  const [bulkConnectOpen2, setBulkConnectOpen2] = useState(false)
  const [bulkConnectPickId, setBulkConnectPickId] = useState('')
  const [bulkConnectAckTtlock, setBulkConnectAckTtlock] = useState(false)
  const [bulkConnectBusy, setBulkConnectBusy] = useState(false)
  const [bulkOverwriteOpen, setBulkOverwriteOpen] = useState(false)
  const [bulkDisconnectOpen, setBulkDisconnectOpen] = useState(false)
  const [bulkDisconnectBusy, setBulkDisconnectBusy] = useState(false)
  const [connectOverwriteOpen, setConnectOverwriteOpen] = useState(false)

  const selectionMeta = useMemo(() => {
    const selectedRows = properties.filter((p) => selectedPropertyIds.has(p.id))
    const boundCount = selectedRows.filter((p) => p.operatorFilterKey !== OPERATOR_FILTER_UNASSIGNED).length
    return {
      selectedCount: selectedPropertyIds.size,
      boundSelectedCount: boundCount,
      bulkOverwriteCount: boundCount,
    }
  }, [properties, selectedPropertyIds])

  const operatorFilterOptions = useMemo(() => {
    const byKey = new Map<string, string>()
    for (const r of properties) {
      const k = r.operatorFilterKey
      if (!byKey.has(k)) {
        byKey.set(
          k,
          k === OPERATOR_FILTER_UNASSIGNED
            ? 'Not connected'
            : k === OPERATOR_FILTER_PENDING
              ? '(pending approval)'
              : r.operator
        )
      }
    }
    return Array.from(byKey.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [properties])

  const columns: Column<ClientPropertyRow>[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'Property',
        sortable: true,
        render: (_, row) => (
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100">
              <Building2 className="h-4 w-4 text-green-800" />
            </div>
            <div>
              <p className="font-medium">{row.name}</p>
              <p className="text-xs text-muted-foreground">{row.unitNumber || '—'}</p>
            </div>
          </div>
        ),
      },
      {
        key: 'unitNumber',
        label: 'Unit Number',
        sortable: true,
        render: (value) => <span className="text-sm">{String(value || '—')}</span>,
      },
      {
        key: 'address',
        label: 'Address',
        sortable: true,
        render: (value) => <span className="text-sm text-muted-foreground">{String(value || '—')}</span>,
      },
      {
        key: 'operatorFilterKey',
        label: 'Operator',
        sortable: true,
        filterable: true,
        filterOptions: operatorFilterOptions,
        render: (_, row) => <span className="text-sm">{row.operator}</span>,
      },
      {
        key: 'type',
        label: 'Type',
        sortable: true,
        filterable: true,
        filterOptions: [
          { label: 'Residential', value: 'Residential' },
          { label: 'Landed', value: 'Landed' },
          { label: 'Apartment', value: 'Apartment' },
          { label: 'Office', value: 'Office' },
          { label: 'Commercial', value: 'Commercial' },
          { label: 'Other', value: 'Other' },
        ],
        render: (value) => (
          <Badge
            variant="secondary"
            className={
              value === 'Commercial' || value === 'Office'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-green-100 text-green-800'
            }
          >
            {String(value)}
          </Badge>
        ),
      },
      {
        key: 'status',
        label: 'Status',
        sortable: true,
        render: (value) => (
          <Badge variant="secondary" className="bg-green-100 text-green-800">
            {String(value)}
          </Badge>
        ),
      },
      {
        key: 'lastCleaned',
        label: 'Last updated',
        sortable: true,
      },
    ],
    [operatorFilterOptions]
  )

  const actions: Action<ClientPropertyRow>[] = useMemo(
    () => [
      {
        label: 'View Details',
        icon: <Eye className="h-4 w-4 mr-2" />,
        onClick: (row) => setSelectedProperty(row),
      },
      {
        label: 'Copy property ID',
        icon: <Copy className="h-4 w-4 mr-2" />,
        onClick: async (row) => {
          try {
            await navigator.clipboard.writeText(row.id)
            toast.success('Property ID copied')
          } catch {
            toast.error('Copy failed')
          }
        },
      },
    ],
    []
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const fallback = String(user?.operatorId || '').trim()
      const email = String(user?.email || '').trim().toLowerCase()
      if (!email) {
        if (!cancelled) setClientUuid(fallback || '-')
        return
      }
      const res = await fetchEmployeeProfileByEmail(email)
      if (cancelled) return
      const fromProfile = String(res?.profile?.clientId || res?.profile?.id || '').trim()
      setClientUuid(fromProfile || fallback || '-')
    })()
    return () => {
      cancelled = true
    }
  }, [user?.operatorId, user?.email])

  const apartmentNamesStorageKey = `cleanlemon-client-apartment-names:${clientUuid !== '-' ? clientUuid : 'local'}`

  useEffect(() => {
    try {
      const raw = localStorage.getItem(apartmentNamesStorageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          setApartmentPropertyNames(
            [...new Set(parsed.map((x) => String(x).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
          )
        }
      }
    } catch {
      /* ignore */
    }
    setApartmentNamesStorageReady(true)
  }, [apartmentNamesStorageKey])

  useEffect(() => {
    if (!apartmentNamesStorageReady) return
    try {
      localStorage.setItem(apartmentNamesStorageKey, JSON.stringify(apartmentPropertyNames))
    } catch {
      /* ignore */
    }
  }, [apartmentNamesStorageKey, apartmentPropertyNames, apartmentNamesStorageReady])

  const operatorIdForPropertyNames = String(selectedOperatorId || user?.operatorId || '').trim()

  useEffect(() => {
    if (!createOpen || !operatorIdForPropertyNames) return
    let cancelled = false
    ;(async () => {
      const r = await fetchOperatorDistinctPropertyNames(operatorIdForPropertyNames)
      if (cancelled || !r?.ok || !Array.isArray(r.items)) return
      setDbDistinctPropertyNames(r.items.map((x: unknown) => String(x).trim()).filter(Boolean))
    })()
    return () => {
      cancelled = true
    }
  }, [createOpen, operatorIdForPropertyNames])

  const apartmentNameChoices = useMemo(() => {
    const s = new Set<string>()
    dbDistinctPropertyNames.forEach((n) => {
      const t = String(n).trim()
      if (t) s.add(t)
    })
    apartmentPropertyNames.forEach((n) => {
      const t = String(n).trim()
      if (t) s.add(t)
    })
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [dbDistinctPropertyNames, apartmentPropertyNames])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const email = String(user?.email || '').trim().toLowerCase()
      const operatorId = String(user?.operatorId || '').trim()
      if (!email) {
        if (!cancelled) {
          setProperties([])
          setPropertiesLoading(false)
        }
        return
      }
      if (!cancelled) setPropertiesLoading(true)
      const res = await fetchClientPortalProperties(email, operatorId)
      if (cancelled) return
      if (res?.ok && Array.isArray(res.items)) {
        setProperties(res.items.map(mapApiItemToRow))
      } else {
        setProperties([])
      }
      setPropertiesLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [user?.email, user?.operatorId])

  useEffect(() => {
    setSelectedPropertyIds((prev) => {
      const valid = new Set(properties.map((p) => p.id))
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (valid.has(id)) next.add(id)
        else changed = true
      }
      if (!changed && next.size === prev.size) return prev
      return next
    })
  }, [properties])

  useEffect(() => {
    if (!selectedProperty?.id) {
      setPropertyDetail(null)
      return
    }
    const email = String(user?.email || '').trim().toLowerCase()
    const operatorId = String(user?.operatorId || '').trim()
    if (!email) return
    let cancelled = false
    ;(async () => {
      setDetailLoading(true)
      try {
        const res = await fetchClientPortalPropertyDetail(email, operatorId, selectedProperty.id)
        if (cancelled) return
        if (res?.ok && res.property) {
          setPropertyDetail(res.property)
          setDetailForm(detailToForm(res.property))
        } else {
          toast.error(res?.reason || 'Could not load property')
          setPropertyDetail(null)
        }
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedProperty?.id, user?.email, user?.operatorId])

  useEffect(() => {
    if (!connectOpen1 && !bulkConnectOpen1) return
    let cancelled = false
    ;(async () => {
      const res = await fetchOperatorLookup({ q: '', limit: 400 })
      if (cancelled) return
      setConnectOperators(Array.isArray(res?.items) ? res.items : [])
    })()
    return () => {
      cancelled = true
    }
  }, [connectOpen1, bulkConnectOpen1])

  useEffect(() => {
    if (!createOpen) return
    let cancelled = false
    ;(async () => {
      const res = await fetchOperatorLookup({ q: operatorSearch, limit: 30 })
      if (cancelled) return
      setOperatorOptions(Array.isArray(res?.items) ? res.items : [])
    })()
    return () => {
      cancelled = true
    }
  }, [createOpen, operatorSearch])

  const selectedOperator = useMemo(
    () => operatorOptions.find((op) => op.id === selectedOperatorId),
    [operatorOptions, selectedOperatorId]
  )

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>, field: 'afterCleanPhoto' | 'keyPhoto') => {
    const file = e.target.files?.[0]
    if (!file) return
    const previewUrl = URL.createObjectURL(file)
    setForm((prev) => ({ ...prev, [field]: previewUrl }))
  }

  const commitNewApartmentName = () => {
    const trimmed = apartmentNameDraft.trim()
    if (!trimmed) {
      toast.error('Enter a property name')
      return
    }
    if (!apartmentNameChoices.includes(trimmed)) {
      setApartmentPropertyNames((prev) => [...prev, trimmed].sort((a, b) => a.localeCompare(b)))
      toast.success('Property name added')
    } else {
      toast.message('Name already in list — selected.')
    }
    setForm((prev) => ({ ...prev, name: trimmed }))
    setApartmentNameDraft('')
    setIsAddApartmentNameOpen(false)
  }

  const handleCreateProperty = async (e: React.FormEvent) => {
    e.preventDefault()
    const opId = String(selectedOperatorId || '').trim() || String(user?.operatorId || '').trim()
    if (form.premisesType === 'apartment') {
      const n = String(form.name || '').trim()
      if (!n || !apartmentNameChoices.includes(n)) {
        toast.error('Select or add a building / condo name for apartment premises')
        return
      }
    }
    setCreating(true)
    try {
      const payload = {
        premisesType: String(form.premisesType || '').trim(),
        name: String(form.name || '').trim(),
        address: String(form.address || '').trim(),
        unitNumber: String(form.unitNumber || '').trim(),
        operatorId: opId,
        clientId: clientUuid !== '-' ? clientUuid : '',
        clientdetailId: clientUuid !== '-' ? clientUuid : '',
        clientPortalOwned: true,
        keyCollection: form.mailboxPassword || form.smartdoorPasswordEnabled || form.smartdoorTokenEnabled ? 'yes' : 'no',
        securitySystem: String(form.securitySystem || '').trim(),
        afterCleanPhoto: form.afterCleanPhoto,
        keyPhoto: form.keyPhoto,
        importSource: '',
        colivingOperatorName: String(selectedOperator?.name || '').trim(),
        mailboxPassword: String(form.mailboxPassword || '').trim(),
        smartdoorPassword: form.smartdoorPasswordEnabled ? String(form.smartdoorPassword || '').trim() : '',
        smartdoorToken: form.smartdoorTokenEnabled ? '1' : '',
        smartdoorTokenEnabled: form.smartdoorTokenEnabled,
        bedCount: form.bedCount,
        roomCount: form.roomCount,
        bathroomCount: form.bathroomCount,
        kitchen: form.kitchen,
        livingRoom: form.livingRoom,
        balcony: form.balcony,
        staircase: form.staircase,
        liftLevel: form.liftLevel,
        specialAreaCount: form.specialAreaCount,
      }
      const res = await createOperatorProperty(payload)
      if (!res?.ok) {
        throw new Error(res?.reason || 'Create property failed')
      }
      toast.success('Property created')
      const reload = await fetchClientPortalProperties(
        String(user?.email || '').trim().toLowerCase(),
        String(user?.operatorId || '').trim()
      )
      if (reload?.ok && Array.isArray(reload.items)) {
        setProperties(reload.items.map(mapApiItemToRow))
      }
      setCreateOpen(false)
      setForm({
        premisesType: '',
        name: '',
        address: '',
        unitNumber: '',
        keyCollection: 'no',
        securitySystem: '',
        afterCleanPhoto: '',
        remark: '',
        estimateTime: '',
        keyPhoto: '',
        mailboxPassword: '',
        smartdoorPassword: '',
        smartdoorPasswordEnabled: false,
        smartdoorTokenEnabled: false,
        bedCount: '',
        roomCount: '',
        bathroomCount: '',
        kitchen: '',
        livingRoom: '',
        balcony: '',
        staircase: '',
        liftLevel: '',
        specialAreaCount: '',
      })
      setOperatorSearch('')
      setSelectedOperatorId('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create property failed')
    } finally {
      setCreating(false)
    }
  }

  const closePropertyDialog = useCallback(() => {
    setSelectedProperty(null)
    setPropertyDetail(null)
    setConnectOpen1(false)
    setConnectOpen2(false)
    setConnectPickId('')
    setConnectAckTtlock(false)
    setConnectOverwriteOpen(false)
  }, [])

  const reloadPropertyList = useCallback(async () => {
    const email = String(user?.email || '').trim().toLowerCase()
    const operatorId = String(user?.operatorId || '').trim()
    if (!email) return
    const res = await fetchClientPortalProperties(email, operatorId)
    if (res?.ok && Array.isArray(res.items)) {
      setProperties(res.items.map(mapApiItemToRow))
    }
  }, [user?.email, user?.operatorId])

  const syncColivingProperties = async () => {
    const email = String(user?.email || '').trim().toLowerCase()
    const operatorId = String(user?.operatorId || '').trim()
    if (!email) return
    setColivingSyncing(true)
    try {
      const res = await fetchClientPortalSyncColivingProperties(email, operatorId)
      if (!res?.ok) {
        toast.error(
          res?.reason === 'NO_COLIVING_OPERATOR_LINK'
            ? 'No Coliving link found. Complete Coliving → Cleanlemons integration in Operator Company, or ensure a property is linked to Coliving.'
            : res?.reason || 'Sync failed'
        )
        return
      }
      toast.success(
        `Synced from Coliving (${res.syncedOperators ?? 0} operator(s), ${res.itemCount ?? 0} items in list).`
      )
      await reloadPropertyList()
    } catch {
      toast.error('Sync failed')
    } finally {
      setColivingSyncing(false)
    }
  }

  const savePropertyDetail = async () => {
    if (!selectedProperty?.id || !user?.email) return
    setDetailSaving(true)
    try {
      const res = await patchClientPortalProperty(
        String(user.email).trim().toLowerCase(),
        String(user.operatorId || '').trim(),
        selectedProperty.id,
        {
          premisesType: detailForm.premisesType,
          name: detailForm.propertyName,
          address: detailForm.address,
          unitNumber: detailForm.unitNumber,
          securitySystem: detailForm.securitySystem,
          mailboxPassword: detailForm.mailboxPassword,
          smartdoorPassword: detailForm.smartdoorPasswordEnabled ? detailForm.smartdoorPassword : '',
          smartdoorTokenEnabled: detailForm.smartdoorTokenEnabled,
          afterCleanPhotoUrl: detailForm.afterCleanPhotoUrl,
          keyPhotoUrl: detailForm.keyPhotoUrl,
          bedCount: detailForm.bedCount,
          roomCount: detailForm.roomCount,
          bathroomCount: detailForm.bathroomCount,
          kitchen: detailForm.kitchen,
          livingRoom: detailForm.livingRoom,
          balcony: detailForm.balcony,
          staircase: detailForm.staircase,
          specialAreaCount: detailForm.specialAreaCount,
          liftLevel: detailForm.liftLevel || '',
        }
      )
      if (!res?.ok || !res.property) {
        toast.error(res?.reason || 'Save failed')
        return
      }
      toast.success('Saved')
      setPropertyDetail(res.property)
      setDetailForm(detailToForm(res.property))
      await reloadPropertyList()
    } catch {
      toast.error('Save failed')
    } finally {
      setDetailSaving(false)
    }
  }

  const disconnectOperator = async () => {
    if (!selectedProperty?.id || !user?.email) return
    setDetailSaving(true)
    try {
      const res = await patchClientPortalProperty(
        String(user.email).trim().toLowerCase(),
        String(user.operatorId || '').trim(),
        selectedProperty.id,
        { clearCleanlemonsOperator: true }
      )
      if (!res?.ok || !res.property) {
        toast.error(res?.reason || 'Disconnect failed')
        return
      }
      toast.success('Operator disconnected')
      setPropertyDetail(res.property)
      await reloadPropertyList()
    } catch {
      toast.error('Disconnect failed')
    } finally {
      setDetailSaving(false)
    }
  }

  const runBulkConnectOperator = useCallback(
    async (replaceExistingBindings: boolean) => {
      const email = String(user?.email || '').trim().toLowerCase()
      const operatorId = String(user?.operatorId || '').trim()
      const ids = Array.from(selectedPropertyIds)
      if (!email || !bulkConnectPickId || ids.length === 0) return
      setBulkConnectBusy(true)
      try {
        const res = await postClientPortalBulkRequestOperator(
          email,
          operatorId,
          ids,
          bulkConnectPickId,
          true,
          replaceExistingBindings
        )
        if (!res?.ok) {
          toast.error(res?.reason || 'Bulk connect failed')
          return
        }
        const okCount = res.succeeded?.length ?? 0
        const failCount = res.failed?.length ?? 0
        if (okCount && !failCount) {
          toast.success(`Approval requests sent for ${okCount} propert${okCount === 1 ? 'y' : 'ies'}.`)
        } else if (okCount && failCount) {
          toast.message(`Sent ${okCount}; ${failCount} skipped (e.g. not found).`)
        } else {
          toast.error(
            failCount
              ? `No requests sent. ${res.failed?.map((f) => f.reason).join(', ') || 'Check selection.'}`
              : 'No requests sent.'
          )
          return
        }
        setBulkOverwriteOpen(false)
        setBulkConnectOpen2(false)
        setBulkConnectOpen1(false)
        setBulkConnectPickId('')
        setBulkConnectAckTtlock(false)
        setSelectedPropertyIds(new Set())
        await reloadPropertyList()
      } catch {
        toast.error('Bulk connect failed')
      } finally {
        setBulkConnectBusy(false)
      }
    },
    [user?.email, user?.operatorId, selectedPropertyIds, bulkConnectPickId, reloadPropertyList]
  )

  const runSingleConnectRequest = useCallback(async () => {
    if (!selectedProperty?.id || !user?.email || !connectPickId) return
    setConnectBusy(true)
    try {
      const res = await patchClientPortalProperty(
        String(user.email).trim().toLowerCase(),
        String(user.operatorId || '').trim(),
        selectedProperty.id,
        {
          setCleanlemonsOperator: {
            operatorId: connectPickId,
            authorizePropertyAndTtlock: true,
            requestApproval: true,
          },
        }
      )
      if (!res?.ok || !res.property) {
        toast.error(res?.reason || 'Connect failed')
        return
      }
      toast.success('Approval request sent. The operator will review.')
      setPropertyDetail(res.property)
      setConnectOpen2(false)
      setConnectOpen1(false)
      setConnectOverwriteOpen(false)
      setConnectPickId('')
      setConnectAckTtlock(false)
      await reloadPropertyList()
    } catch {
      toast.error('Connect failed')
    } finally {
      setConnectBusy(false)
    }
  }, [selectedProperty?.id, user?.email, user?.operatorId, connectPickId, reloadPropertyList])

  const onConnectWizardStep2Confirm = () => {
    if (!propertyDetail || !connectPickId || !connectAckTtlock || !user?.email) return
    const cur = String(propertyDetail.operatorId || '').trim()
    if (cur && connectPickId === cur) {
      toast.message('This property is already linked to the selected operator.')
      return
    }
    if (cur && connectPickId !== cur) {
      setConnectOpen2(false)
      setConnectOverwriteOpen(true)
      return
    }
    void runSingleConnectRequest()
  }

  const runBulkDisconnect = useCallback(async () => {
    const email = String(user?.email || '').trim().toLowerCase()
    const operatorId = String(user?.operatorId || '').trim()
    const ids = Array.from(selectedPropertyIds)
    if (!email || ids.length === 0) return
    setBulkDisconnectBusy(true)
    try {
      const res = await postClientPortalBulkDisconnect(email, operatorId, ids)
      if (!res?.ok) {
        toast.error(res?.reason || 'Bulk disconnect failed')
        return
      }
      const okCount = res.succeeded?.length ?? 0
      const failCount = res.failed?.length ?? 0
      if (okCount && !failCount) {
        toast.success(`Disconnected operator from ${okCount} propert${okCount === 1 ? 'y' : 'ies'}.`)
      } else if (okCount && failCount) {
        toast.message(`Disconnected ${okCount}; ${failCount} were not linked to an operator.`)
      } else {
        toast.error(
          failCount ? `Nothing disconnected. ${res.failed?.map((f) => f.reason).join(', ') || ''}` : 'Nothing disconnected.'
        )
        return
      }
      setBulkDisconnectOpen(false)
      setSelectedPropertyIds(new Set())
      await reloadPropertyList()
      if (selectedProperty?.id && ids.includes(selectedProperty.id)) {
        const d = await fetchClientPortalPropertyDetail(email, operatorId, selectedProperty.id)
        if (d?.ok && d.property) setPropertyDetail(d.property)
      }
    } catch {
      toast.error('Bulk disconnect failed')
    } finally {
      setBulkDisconnectBusy(false)
    }
  }, [user?.email, user?.operatorId, selectedPropertyIds, reloadPropertyList, selectedProperty?.id])

  const copyUuid = async () => {
    if (!clientUuid || clientUuid === '-') return
    try {
      await navigator.clipboard.writeText(clientUuid)
      toast.success('Client UUID copied')
    } catch {
      toast.error('Failed to copy UUID')
    }
  }

  return (
    <main className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Properties</h1>
          <p className="text-sm text-muted-foreground">Manage locations assigned to your client account</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground mr-1">
            {propertiesLoading ? 'Loading…' : `${properties.length} registered`}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="default" className="gap-2 min-w-[7.5rem]">
                Actions
                <ChevronDown className="h-4 w-4 opacity-80" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={() => setCreateOpen(true)}
                className="gap-2 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Add property
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setImportOpen(true)} className="gap-2 cursor-pointer">
                <Upload className="h-4 w-4" />
                Import
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={colivingSyncing || propertiesLoading}
                onClick={() => void syncColivingProperties()}
                className="gap-2 cursor-pointer"
              >
                {colivingSyncing ? (
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                ) : (
                  <RefreshCw className="h-4 w-4 shrink-0" />
                )}
                Sync from Coliving
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={propertiesLoading || selectionMeta.selectedCount === 0}
                onClick={() => {
                  setBulkConnectPickId('')
                  setBulkConnectAckTtlock(false)
                  setBulkConnectOpen1(true)
                }}
                className="gap-2 cursor-pointer"
              >
                <Link2 className="h-4 w-4 shrink-0" />
                Authorise operator… ({selectionMeta.selectedCount})
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={propertiesLoading || selectionMeta.boundSelectedCount === 0}
                onClick={() => setBulkDisconnectOpen(true)}
                className="gap-2 cursor-pointer"
              >
                <Unlink className="h-4 w-4 shrink-0" />
                Disconnect operator… ({selectionMeta.boundSelectedCount})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {propertiesLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading properties…</div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All Properties</CardTitle>
            <CardDescription>{properties.length} properties registered</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              data={properties}
              columns={columns}
              actions={actions}
              onEditClick={(row) => setSelectedProperty(row)}
              searchKeys={['name', 'address', 'unitNumber', 'operator']}
              pageSize={10}
              emptyMessage="No properties found. Add your first property or link Coliving to sync units."
              rowSelection={{
                selectedIds: selectedPropertyIds,
                onSelectionChange: setSelectedPropertyIds,
              }}
            />
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedProperty} onOpenChange={(open) => !open && closePropertyDialog()}>
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto">
          {selectedProperty && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  {propertyDetail?.name || selectedProperty.name}
                </DialogTitle>
                <DialogDescription className="font-mono text-xs break-all">ID: {selectedProperty.id}</DialogDescription>
              </DialogHeader>

              {detailLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Loading…
                </div>
              ) : propertyDetail ? (
                <div className="space-y-6 py-2">
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div>
                      <p>{propertyDetail.address}</p>
                      {propertyDetail.unitNumber ? (
                        <p className="text-muted-foreground mt-1">Unit: {propertyDetail.unitNumber}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-lg border p-4 space-y-4">
                    <p className="text-sm font-semibold text-foreground">Property & access</p>
                    <p className="text-xs text-muted-foreground">
                      Aligns with operator property form: premises type, name, address, unit, key collection, security, photo
                      previews.
                    </p>
                    <div className="space-y-2 max-w-xs">
                      <Label>Premises type</Label>
                      <Select
                        value={detailForm.premisesType || '__none__'}
                        onValueChange={(v) => setDetailForm((f) => ({ ...f, premisesType: v === '__none__' ? '' : v }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">—</SelectItem>
                          <SelectItem value="landed">landed</SelectItem>
                          <SelectItem value="apartment">apartment</SelectItem>
                          <SelectItem value="office">office</SelectItem>
                          <SelectItem value="commercial">commercial</SelectItem>
                          <SelectItem value="other">other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dlg-prop-name">Property name</Label>
                      <Input
                        id="dlg-prop-name"
                        value={detailForm.propertyName}
                        onChange={(e) => setDetailForm((f) => ({ ...f, propertyName: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dlg-address">Address</Label>
                      <Input
                        id="dlg-address"
                        value={detailForm.address}
                        onChange={(e) => setDetailForm((f) => ({ ...f, address: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2 max-w-xs">
                      <Label htmlFor="dlg-unit">Unit number</Label>
                      <Input
                        id="dlg-unit"
                        value={detailForm.unitNumber}
                        onChange={(e) => setDetailForm((f) => ({ ...f, unitNumber: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2 max-w-xs">
                      <Label>Security system</Label>
                      <Select
                        value={detailForm.securitySystem || '__none__'}
                        onValueChange={(v) => setDetailForm((f) => ({ ...f, securitySystem: v === '__none__' ? '' : v }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">—</SelectItem>
                          <SelectItem value="icare">icare</SelectItem>
                          <SelectItem value="ecommunity">ecommunity</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dlg-mailbox2">Mailbox password</Label>
                      <Input
                        id="dlg-mailbox2"
                        type="text"
                        autoComplete="off"
                        value={detailForm.mailboxPassword}
                        onChange={(e) => setDetailForm((f) => ({ ...f, mailboxPassword: e.target.value }))}
                      />
                    </div>
                    <div className="rounded-md border p-3 space-y-2">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={detailForm.smartdoorPasswordEnabled}
                          onCheckedChange={(c) => setDetailForm((f) => ({ ...f, smartdoorPasswordEnabled: c === true }))}
                        />
                        Smart door (password)
                      </label>
                      {detailForm.smartdoorPasswordEnabled ? (
                        <Input
                          value={detailForm.smartdoorPassword}
                          onChange={(e) => setDetailForm((f) => ({ ...f, smartdoorPassword: e.target.value }))}
                          placeholder="Smart door password"
                        />
                      ) : null}
                    </div>
                    <div className="rounded-md border p-3">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={detailForm.smartdoorTokenEnabled}
                          onCheckedChange={(c) => setDetailForm((f) => ({ ...f, smartdoorTokenEnabled: c === true }))}
                        />
                        Smart door (token)
                      </label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>After clean photo (preview)</Label>
                        <Input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            setDetailForm((f) => ({ ...f, afterCleanPhotoUrl: URL.createObjectURL(file) }))
                          }}
                        />
                        {detailForm.afterCleanPhotoUrl ? (
                          <img
                            src={detailForm.afterCleanPhotoUrl}
                            alt="After clean"
                            className="h-28 rounded-md border object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        <Label>Key photo</Label>
                        <Input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            setDetailForm((f) => ({ ...f, keyPhotoUrl: URL.createObjectURL(file) }))
                          }}
                        />
                        {detailForm.keyPhotoUrl ? (
                          <img
                            src={detailForm.keyPhotoUrl}
                            alt="Key"
                            className="h-28 rounded-md border object-cover"
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* 1) Cleanlemons cleaning operator — Connect / bound + Disconnect */}
                  <div className="rounded-lg border p-4 space-y-3">
                    <p className="text-sm font-semibold text-foreground">Cleaning operator (Cleanlemons)</p>
                    {propertyDetail.operatorId ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm">
                          {propertyDetail.cleanlemonsOperatorName || propertyDetail.cleanlemonsOperatorEmail || propertyDetail.operatorId}
                        </span>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="gap-1"
                          disabled={detailSaving}
                          onClick={() => {
                            setConnectPickId('')
                            setConnectAckTtlock(false)
                            setConnectOverwriteOpen(false)
                            setConnectOpen1(true)
                          }}
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          Change operator
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          disabled={detailSaving}
                          onClick={() => void disconnectOperator()}
                        >
                          <Unlink className="h-3.5 w-3.5" />
                          Disconnect
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        className="gap-2"
                        onClick={() => {
                          setConnectPickId('')
                          setConnectOpen1(true)
                        }}
                      >
                        <Link2 className="h-4 w-4" />
                        Connect
                      </Button>
                    )}
                  </div>

                  {/* 2) Contact — same data pattern as Coliving owner portal (operator title + client_profile.contact) */}
                  {(propertyDetail.colivingOperatorTitle || propertyDetail.colivingOperatorContact) && (
                    <div className="rounded-lg border p-4 space-y-2">
                      <p className="text-sm font-semibold text-foreground">Contact operator (Coliving)</p>
                      <p className="text-sm text-muted-foreground">
                        Matches owner portal: Coliving operator title + profile contact (e.g. WhatsApp).
                      </p>
                      {propertyDetail.colivingOperatorTitle ? (
                        <p className="text-sm font-medium">{propertyDetail.colivingOperatorTitle}</p>
                      ) : null}
                      {propertyDetail.colivingOperatorContact ? (
                        <p className="text-sm whitespace-pre-wrap break-all">{propertyDetail.colivingOperatorContact}</p>
                      ) : null}
                    </div>
                  )}

                  {/* 3–12 Editable fields (sync to cln_property + linked propertydetail when Coliving row exists) */}
                  <div className="rounded-lg border p-4 space-y-4">
                    <p className="text-sm font-semibold text-foreground">Property details</p>
                    <p className="text-xs text-muted-foreground">
                      Counts and mailbox (above) are saved to Cleanlemons and mirrored to Coliving{' '}
                      <code className="text-xs">propertydetail</code> when this unit is linked (same DB as api.colivingjb.com).
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {(
                        [
                          ['bedCount', 'Bed count'],
                          ['roomCount', 'Room count'],
                          ['bathroomCount', 'Bathroom count'],
                          ['kitchen', 'Kitchen'],
                          ['livingRoom', 'Living room'],
                          ['balcony', 'Balcony'],
                          ['staircase', 'Staircase'],
                          ['specialAreaCount', 'Special area count'],
                        ] as const
                      ).map(([key, label]) => (
                        <div key={key} className="space-y-1">
                          <Label className="text-xs">{label}</Label>
                          <Input
                            inputMode="numeric"
                            value={detailForm[key]}
                            onChange={(e) => setDetailForm((f) => ({ ...f, [key]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2 max-w-xs">
                      <Label>Lift level</Label>
                      <Select
                        value={detailForm.liftLevel || '__none__'}
                        onValueChange={(v) => setDetailForm((f) => ({ ...f, liftLevel: v === '__none__' ? '' : v }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">—</SelectItem>
                          <SelectItem value="slow">slow</SelectItem>
                          <SelectItem value="medium">medium</SelectItem>
                          <SelectItem value="fast">fast</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {propertyDetail.colivingPropertydetailId ? (
                    <div className="rounded-lg border p-4 space-y-4">
                      <p className="text-sm font-semibold text-foreground">Edit utility (read-only)</p>
                      <p className="text-xs text-muted-foreground">
                        Same as Coliving Operator → Property → Edit utility. Smart door binding is managed there; shown here for reference only.
                      </p>
                      <div className="space-y-2 max-w-md">
                        <Label className="text-xs">Smart door</Label>
                        <Input
                          readOnly
                          className="bg-muted cursor-default"
                          value={
                            propertyDetail.smartdoorBindings?.property?.displayLabel?.trim()
                              ? propertyDetail.smartdoorBindings.property.displayLabel
                              : '—'
                          }
                        />
                      </div>
                      {propertyDetail.smartdoorBindings?.rooms &&
                      propertyDetail.smartdoorBindings.rooms.length > 0 ? (
                        <div className="space-y-2">
                          <Label className="text-xs">Room-bound locks</Label>
                          <ul className="text-sm space-y-2 rounded-md border p-3 bg-muted/30">
                            {propertyDetail.smartdoorBindings.rooms.map((r) => (
                              <li
                                key={r.roomId}
                                className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:items-baseline sm:gap-4"
                              >
                                <span className="text-muted-foreground">{r.roomDisplayLabel}</span>
                                <span className="font-medium">{r.lockDisplayLabel}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {!propertyDetail.smartdoorBindings?.property &&
                      (!propertyDetail.smartdoorBindings?.rooms ||
                        propertyDetail.smartdoorBindings.rooms.length === 0) ? (
                        <p className="text-xs text-muted-foreground">
                          No smart door bound at property or room level in Coliving.
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Cleaning prices — view only, MYR; cleang_fees / cleaning_fees shown as Homestay cleaning */}
                  {propertyDetail.pricing.length > 0 ? (
                    <div className="rounded-lg border p-4 space-y-2">
                      <p className="text-sm font-semibold text-foreground">Cleaning prices (read-only)</p>
                      <ul className="text-sm space-y-1">
                        {propertyDetail.pricing.map((row) => (
                          <li key={row.key} className="flex justify-between gap-4">
                            <span className="text-muted-foreground">{row.label}</span>
                            <span className="font-medium tabular-nums">{row.display}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                    <Badge variant="secondary" className="bg-green-100 text-green-800">
                      {selectedProperty.type}
                    </Badge>
                    <span>Last updated: {selectedProperty.lastCleaned}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-6">Could not load this property.</p>
              )}

              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" type="button" onClick={closePropertyDialog}>
                  Close
                </Button>
                {propertyDetail ? (
                  <Button type="button" disabled={detailSaving || detailLoading} onClick={() => void savePropertyDetail()}>
                    {detailSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save changes
                  </Button>
                ) : null}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk connect — step 1 */}
      <Dialog
        open={bulkConnectOpen1}
        onOpenChange={(o) => {
          setBulkConnectOpen1(o)
          if (!o) setBulkConnectPickId('')
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Authorise operator (bulk)</DialogTitle>
            <DialogDescription>
              Choose one cleaning operator for {selectedPropertyIds.size} selected propert
              {selectedPropertyIds.size === 1 ? 'y' : 'ies'}. Each will get a pending approval request (same as single
              Connect).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Operator</Label>
            <Select value={bulkConnectPickId || undefined} onValueChange={setBulkConnectPickId}>
              <SelectTrigger>
                <SelectValue placeholder="Select operator…" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {connectOperators.map((op) => (
                  <SelectItem key={op.id} value={op.id}>
                    {op.name || op.email || op.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setBulkConnectOpen1(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!bulkConnectPickId}
              onClick={() => {
                setBulkConnectAckTtlock(false)
                setBulkConnectOpen1(false)
                setBulkConnectOpen2(true)
              }}
            >
              Next
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk connect — step 2 */}
      <Dialog
        open={bulkConnectOpen2}
        onOpenChange={(o) => {
          setBulkConnectOpen2(o)
          if (!o) setBulkConnectAckTtlock(false)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm access (bulk)</DialogTitle>
            <DialogDescription>
              You authorise the selected operator for every selected property, including TTLock-related access where
              applicable.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 py-4">
            <Checkbox
              id="ack-bulk-ttlock"
              checked={bulkConnectAckTtlock}
              onCheckedChange={(c) => setBulkConnectAckTtlock(c === true)}
            />
            <label htmlFor="ack-bulk-ttlock" className="text-sm leading-snug cursor-pointer">
              I authorise the selected operator for all {selectedPropertyIds.size} selected propert
              {selectedPropertyIds.size === 1 ? 'y' : 'ies'}, including TTLock-related access where applicable.
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setBulkConnectOpen2(false)
                setBulkConnectOpen1(true)
              }}
            >
              Back
            </Button>
            <Button
              type="button"
              disabled={!bulkConnectAckTtlock || bulkConnectBusy || selectedPropertyIds.size === 0}
              onClick={() => {
                if (!bulkConnectAckTtlock || selectedPropertyIds.size === 0) return
                if (selectionMeta.bulkOverwriteCount > 0) {
                  setBulkConnectOpen2(false)
                  setBulkOverwriteOpen(true)
                } else {
                  void runBulkConnectOperator(false)
                }
              }}
            >
              {bulkConnectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk — overwrite warning when some rows already have an operator */}
      <Dialog open={bulkOverwriteOpen} onOpenChange={setBulkOverwriteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Replace existing operator?</DialogTitle>
            <DialogDescription>
              {selectionMeta.bulkOverwriteCount} selected propert
              {selectionMeta.bulkOverwriteCount === 1 ? 'y' : 'ies'} already have a cleaning operator linked. If you
              continue, we will send approval requests to the new operator; when approved, the previous Cleanlemons
              operator binding for those properties will be replaced.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setBulkOverwriteOpen(false)
                setBulkConnectOpen2(true)
              }}
            >
              Back
            </Button>
            <Button type="button" disabled={bulkConnectBusy} onClick={() => void runBulkConnectOperator(true)}>
              {bulkConnectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirm replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk disconnect */}
      <Dialog open={bulkDisconnectOpen} onOpenChange={setBulkDisconnectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect operator</DialogTitle>
            <DialogDescription>
              Remove the Cleanlemons cleaning operator link from up to {selectionMeta.boundSelectedCount} selected propert
              {selectionMeta.boundSelectedCount === 1 ? 'y' : 'ies'} that are currently connected. Rows with no operator
              are skipped.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setBulkDisconnectOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={bulkDisconnectBusy} onClick={() => void runBulkDisconnect()}>
              {bulkDisconnectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Connect wizard step 1 — pick operator */}
      <Dialog
        open={connectOpen1}
        onOpenChange={(o) => {
          setConnectOpen1(o)
          if (!o) setConnectPickId('')
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Connect cleaning operator</DialogTitle>
            <DialogDescription>Choose which Cleanlemons operator company manages this property.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Operator</Label>
            <Select value={connectPickId || undefined} onValueChange={setConnectPickId}>
              <SelectTrigger>
                <SelectValue placeholder="Select operator…" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {connectOperators.map((op) => (
                  <SelectItem key={op.id} value={op.id}>
                    {op.name || op.email || op.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setConnectOpen1(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!connectPickId}
              onClick={() => {
                setConnectAckTtlock(false)
                setConnectOpen1(false)
                setConnectOpen2(true)
              }}
            >
              Next
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Connect wizard step 2 — must acknowledge property + TTLock */}
      <Dialog
        open={connectOpen2}
        onOpenChange={(o) => {
          setConnectOpen2(o)
          if (!o) setConnectAckTtlock(false)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm access</DialogTitle>
            <DialogDescription>
              Authorise this operator for the entire property, including any TTLock access that your integration grants.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 py-4">
            <Checkbox
              id="ack-ttlock"
              checked={connectAckTtlock}
              onCheckedChange={(c) => setConnectAckTtlock(c === true)}
            />
            <label htmlFor="ack-ttlock" className="text-sm leading-snug cursor-pointer">
              I authorise the selected operator for this whole property, including TTLock-related access where applicable.
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConnectOpen2(false)
                setConnectOpen1(true)
              }}
            >
              Back
            </Button>
            <Button type="button" disabled={!connectAckTtlock || connectBusy} onClick={() => onConnectWizardStep2Confirm()}>
              {connectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single property — replace operator warning */}
      <Dialog open={connectOverwriteOpen} onOpenChange={setConnectOverwriteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Replace cleaning operator?</DialogTitle>
            <DialogDescription>
              This property already has a cleaning operator. Sending a request to a different operator will replace the
              current binding after the new operator approves.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConnectOverwriteOpen(false)
                setConnectOpen2(true)
              }}
            >
              Back
            </Button>
            <Button type="button" disabled={connectBusy} onClick={() => void runSingleConnectRequest()}>
              {connectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirm replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="mt-8 bg-accent/10 border-accent/30">
        <CardContent className="p-4">
          <p className="text-sm text-foreground">
            <span className="font-semibold">Note:</span> Only your assigned cleaning operator can create or modify
            properties. To add or remove properties, please contact your cleaning service provider.
          </p>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Property</DialogTitle>
            <DialogDescription>
              Create a new property record for this client account.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={handleCreateProperty}>
            <div className="border rounded-lg p-4 space-y-4">
              <p className="text-sm font-semibold text-foreground">Basic Information</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="premisesType">Premises Type</Label>
                  <select
                    id="premisesType"
                    value={form.premisesType}
                    onChange={(e) => setForm((prev) => ({ ...prev, premisesType: e.target.value }))}
                    className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground"
                    required
                  >
                    <option value="">Select premises type</option>
                    <option value="landed">landed</option>
                    <option value="apartment">apartment</option>
                    <option value="office">office</option>
                    <option value="commercial">commercial</option>
                    <option value="other">other</option>
                  </select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="name">Property name</Label>
                  {form.premisesType === 'apartment' ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="min-w-0 flex-1 space-y-2">
                        <Select
                          value={
                            form.name.trim() && apartmentNameChoices.includes(form.name.trim())
                              ? form.name.trim()
                              : '__none__'
                          }
                          onValueChange={(v) => setForm((prev) => ({ ...prev, name: v === '__none__' ? '' : v }))}
                        >
                          <SelectTrigger id="property-name-select" className="w-full">
                            <SelectValue placeholder="Select building / condo name" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Select building / condo name</SelectItem>
                            {apartmentNameChoices.map((n) => (
                              <SelectItem key={n} value={n}>
                                {n}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {apartmentNameChoices.length === 0 && operatorIdForPropertyNames ? (
                          <p className="text-xs text-muted-foreground">
                            No building names in the database for this operator yet. Use &quot;Add property name&quot; to add one.
                          </p>
                        ) : null}
                      </div>
                      <Button type="button" variant="outline" className="shrink-0" onClick={() => setIsAddApartmentNameOpen(true)}>
                        Add property name
                      </Button>
                    </div>
                  ) : (
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                      required
                    />
                  )}
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="address">Address</Label>
                  <Input
                    id="address"
                    value={form.address}
                    onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unitNumber">Unit Number</Label>
                  <Input
                    id="unitNumber"
                    value={form.unitNumber}
                    onChange={(e) => setForm((prev) => ({ ...prev, unitNumber: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4 space-y-4">
              <p className="text-sm font-semibold text-foreground">Operator and Source</p>
              <div className="space-y-2">
                <Label htmlFor="operator-search">Operator (optional)</Label>
                <Input
                  id="operator-search"
                  placeholder="Search operator by id / name / email"
                  value={operatorSearch}
                  onChange={(e) => setOperatorSearch(e.target.value)}
                />
                <select
                  value={selectedOperatorId}
                  onChange={(e) => setSelectedOperatorId(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground"
                >
                  <option value="">Choose operator</option>
                  {operatorOptions.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.name || 'Unnamed operator'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-md border p-3 bg-muted/30 text-sm">
                <p className="font-medium text-foreground">Coliving Import Label</p>
                <p className="text-muted-foreground">Operator: {selectedOperator?.name || selectedOperatorId || '-'}</p>
                <p className="text-muted-foreground">Import Source: read-only from operator process</p>
              </div>
            </div>

            <div className="border rounded-lg p-4 space-y-4">
              <p className="text-sm font-semibold text-foreground">Access and Security</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="mailboxPassword">Mail Box Password</Label>
                  <Input
                    id="mailboxPassword"
                    value={form.mailboxPassword}
                    onChange={(e) => setForm((prev) => ({ ...prev, mailboxPassword: e.target.value }))}
                    placeholder="Mailbox password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="securitySystem">Security System</Label>
                  <select
                    id="securitySystem"
                    value={form.securitySystem}
                    onChange={(e) => setForm((prev) => ({ ...prev, securitySystem: e.target.value }))}
                    className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground"
                  >
                    <option value="">Select security system</option>
                    <option value="icare">icare</option>
                    <option value="ecommunity">ecommunity</option>
                  </select>
                </div>
                <div className="space-y-2 md:col-span-2 border rounded-md p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.smartdoorPasswordEnabled}
                      onCheckedChange={(checked) =>
                        setForm((prev) => ({ ...prev, smartdoorPasswordEnabled: !!checked }))
                      }
                    />
                    Smart Door (Password)
                  </label>
                  {form.smartdoorPasswordEnabled && (
                    <Input
                      value={form.smartdoorPassword}
                      onChange={(e) => setForm((prev) => ({ ...prev, smartdoorPassword: e.target.value }))}
                      placeholder="Smart door password"
                    />
                  )}
                </div>
                <div className="space-y-2 md:col-span-2 border rounded-md p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.smartdoorTokenEnabled}
                      onCheckedChange={(checked) =>
                        setForm((prev) => ({ ...prev, smartdoorTokenEnabled: !!checked }))
                      }
                    />
                    Smart Door (Token)
                  </label>
                </div>
                <div className="space-y-2">
                  <Label>After Clean Photo</Label>
                  <Input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, 'afterCleanPhoto')} />
                  {form.afterCleanPhoto && (
                    <div className="space-y-2">
                      <img src={form.afterCleanPhoto} alt="After clean photo preview" className="h-28 rounded-md border object-cover" />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setForm((prev) => ({ ...prev, afterCleanPhoto: '' }))}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Key Photo</Label>
                  <Input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, 'keyPhoto')} />
                  {form.keyPhoto && (
                    <div className="space-y-2">
                      <img src={form.keyPhoto} alt="Key photo preview" className="h-28 rounded-md border object-cover" />
                      <Button type="button" variant="outline" onClick={() => setForm((prev) => ({ ...prev, keyPhoto: '' }))}>
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4 space-y-4">
              <p className="text-sm font-semibold text-foreground">Property Structure</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="bedCount">Bed Count</Label>
                  <Input id="bedCount" type="number" min={0} value={form.bedCount} onChange={(e) => setForm((prev) => ({ ...prev, bedCount: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="roomCount">Room Count</Label>
                  <Input id="roomCount" type="number" min={0} value={form.roomCount} onChange={(e) => setForm((prev) => ({ ...prev, roomCount: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bathroomCount">Bathroom Count</Label>
                  <Input id="bathroomCount" type="number" min={0} value={form.bathroomCount} onChange={(e) => setForm((prev) => ({ ...prev, bathroomCount: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="kitchen">Kitchen</Label>
                  <Input id="kitchen" type="number" min={0} value={form.kitchen} onChange={(e) => setForm((prev) => ({ ...prev, kitchen: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="livingRoom">Living Room</Label>
                  <Input id="livingRoom" type="number" min={0} value={form.livingRoom} onChange={(e) => setForm((prev) => ({ ...prev, livingRoom: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="balcony">Balcony</Label>
                  <Input id="balcony" type="number" min={0} value={form.balcony} onChange={(e) => setForm((prev) => ({ ...prev, balcony: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="staircase">Stair Case</Label>
                  <Input id="staircase" type="number" min={0} value={form.staircase} onChange={(e) => setForm((prev) => ({ ...prev, staircase: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="specialAreaCount">Special Area Count</Label>
                  <Input id="specialAreaCount" type="number" min={0} value={form.specialAreaCount} onChange={(e) => setForm((prev) => ({ ...prev, specialAreaCount: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="liftLevel">Lift Level</Label>
                  <select
                    id="liftLevel"
                    value={form.liftLevel}
                    onChange={(e) => setForm((prev) => ({ ...prev, liftLevel: e.target.value }))}
                    className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground"
                  >
                    <option value="">Select lift speed</option>
                    <option value="slow">slow</option>
                    <option value="medium">medium</option>
                    <option value="fast">fast</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4 space-y-4">
              <p className="text-sm font-semibold text-foreground">Operator-only Fields (Read-only)</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Remark (operator only)</Label>
                  <Textarea
                    value={form.remark}
                    readOnly
                    placeholder="Only operator can edit remark"
                    rows={3}
                    className="bg-muted"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Estimate Time (operator only)</Label>
                  <Input
                    value={form.estimateTime}
                    readOnly
                    placeholder="Only operator can edit estimate time"
                    className="bg-muted"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddApartmentNameOpen} onOpenChange={setIsAddApartmentNameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add property name</DialogTitle>
            <DialogDescription>Building or condo name (saved locally for this client account).</DialogDescription>
          </DialogHeader>
          <Input
            value={apartmentNameDraft}
            onChange={(e) => setApartmentNameDraft(e.target.value)}
            placeholder="e.g. The Sky Residences"
          />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setIsAddApartmentNameOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => commitNewApartmentName()}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Property</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="client-uuid">Client UUID</Label>
            <div className="flex gap-2">
              <Input id="client-uuid" value={clientUuid} readOnly />
              <Button type="button" variant="outline" onClick={() => void copyUuid()} className="gap-2">
                <Copy className="w-4 h-4" />
                Copy
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setImportOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

export default ClientPropertiesPage
