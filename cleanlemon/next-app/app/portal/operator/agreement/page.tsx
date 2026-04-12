"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable, Column, Action } from '@/components/shared/data-table'
import {
  FileText,
  Plus,
  Send,
  Eye,
  Edit,
  Trash2,
  CheckCircle,
  Clock,
  XCircle,
  Download,
  Copy,
  FileSignature,
  BookOpen,
  ChevronsUpDown,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  fetchOperatorAgreements,
  createOperatorAgreement,
  fetchOperatorAgreementTemplates,
  createOperatorAgreementTemplate,
  openOperatorAgreementTemplatePreview,
  fetchOperatorSettings,
  saveOperatorSettings,
  fetchOperatorContacts,
  signOperatorAgreement,
  downloadClnAgreementVariablesReferenceDocx,
} from '@/lib/cleanlemon-api'
import { clnGeneralVariableTags } from '@/lib/cln-agreement-variable-reference'
import { useAuth } from '@/lib/auth-context'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Agreement {
  id: string
  recipientName: string
  recipientEmail: string
  recipientType: 'employee' | 'driver' | 'dobi'
  templateName: string
  salary: number
  startDate: string
  status:
    | 'pending'
    | 'signing'
    | 'pending_staff_sign'
    | 'pending_client_sign'
    | 'pending_operator_sign'
    | 'complete'
    | 'draft'
    | 'sent'
    | 'signed'
    | 'rejected'
  templateId?: string
  templateMode?: string
  createdAt: string
  signedAt?: string
  signedMeta?: unknown
  finalAgreementUrl?: string
}

interface Template {
  id: string
  name: string
  mode: 'operator_staff' | 'operator_client'
  templateUrl: string
  folderUrl: string
  description: string
  lastUpdated: string
}

interface AgreementAutomationRule {
  id: string
  templateId: string
  triggerWhen: 'new_customer' | 'new_employee_all' | 'new_employee_parttime_only' | 'new_employee_fulltime_only'
}

const statusConfig = {
  pending: { bg: 'bg-slate-100', text: 'text-slate-800', icon: Clock },
  signing: { bg: 'bg-sky-100', text: 'text-sky-900', icon: FileSignature },
  pending_staff_sign: { bg: 'bg-amber-100', text: 'text-amber-900', icon: FileSignature },
  pending_client_sign: { bg: 'bg-orange-100', text: 'text-orange-900', icon: FileSignature },
  pending_operator_sign: { bg: 'bg-violet-100', text: 'text-violet-900', icon: FileSignature },
  complete: { bg: 'bg-green-100', text: 'text-green-800', icon: CheckCircle },
  draft: { bg: 'bg-gray-100', text: 'text-gray-800', icon: FileText },
  sent: { bg: 'bg-blue-100', text: 'text-blue-800', icon: Send },
  signed: { bg: 'bg-green-100', text: 'text-green-800', icon: CheckCircle },
  rejected: { bg: 'bg-red-100', text: 'text-red-800', icon: XCircle },
}
const fallbackAgreementStatus = { bg: 'bg-gray-100', text: 'text-gray-800', icon: FileText }

type StaffPick = {
  id: string
  name: string
  email: string
  recipientType: 'employee' | 'driver' | 'dobi'
}

function permissionToRecipientType(perms: string[]): 'employee' | 'driver' | 'dobi' {
  if (perms.includes('driver')) return 'driver'
  if (perms.includes('dobi')) return 'dobi'
  return 'employee'
}

function isStaffOfferContact(raw: unknown): raw is { id: string; name?: string; email?: string; permissions: string[] } {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as { permissions?: unknown }
  const p = Array.isArray(o.permissions) ? o.permissions.map(String) : []
  return p.some((x) => ['staff', 'driver', 'dobi', 'supervisor'].includes(x))
}

function mapContactsToStaffPicks(items: unknown[]): StaffPick[] {
  return items.filter(isStaffOfferContact).map((c) => ({
    id: String(c.id),
    name: String(c.name || ''),
    email: String(c.email || ''),
    recipientType: permissionToRecipientType(c.permissions),
  }))
}

/** Operator/supervisor may sign before or after the other party; pad shown until operator party has signed. */
function operatorNeedsToSign(agr: Agreement | null, meta: unknown): boolean {
  if (!agr) return false
  const st = String(agr.status || '')
    .trim()
    .toLowerCase()
  if (st === 'complete' || st === 'signed') return false
  const active = [
    'signing',
    'pending_operator_sign',
    'pending_client_sign',
    'pending_staff_sign',
    'draft',
    'sent',
  ].includes(st)
  if (!active) return false
  const m = meta as { parties?: { operator?: { signatureDataUrl?: string } }; operatorSignAt?: string } | null
  if (m?.parties?.operator?.signatureDataUrl) return false
  if (m?.operatorSignAt) return false
  return true
}

function AgreementPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const operatorId = user?.operatorId || 'op_demo_001'
  const [agreements, setAgreements] = useState<Agreement[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [activeTab, setActiveTab] = useState('agreements')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false)
  const [isVariablesDialogOpen, setIsVariablesDialogOpen] = useState(false)
  const [previewAgreement, setPreviewAgreement] = useState<Agreement | null>(null)
  const [signingAgreement, setSigningAgreement] = useState<Agreement | null>(null)
  const [isAutomationDialogOpen, setIsAutomationDialogOpen] = useState(false)
  const [automationRules, setAutomationRules] = useState<AgreementAutomationRule[]>([])
  const [automationSaving, setAutomationSaving] = useState(false)
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    mode: '',
    templateUrl: '',
    folderUrl: '',
    description: '',
  })
  const [newAgreement, setNewAgreement] = useState({
    recipientName: '',
    recipientEmail: '',
    recipientType: '',
    template: '',
    salary: '',
    startDate: '',
  })
  const [staffContacts, setStaffContacts] = useState<StaffPick[]>([])
  const [selectedStaffId, setSelectedStaffId] = useState('')
  const [staffComboOpen, setStaffComboOpen] = useState(false)
  const [previewingTemplateId, setPreviewingTemplateId] = useState<string | null>(null)
  const opSignCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const opSignWrapRef = useRef<HTMLDivElement | null>(null)
  const opDrawingRef = useRef(false)
  const opLastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [opSignatureDataUrl, setOpSignatureDataUrl] = useState('')
  const [opHasSignature, setOpHasSignature] = useState(false)
  const [opSignSaving, setOpSignSaving] = useState(false)
  /** Offer letters export to Google Drive — same flag as Company → Integration. */
  const [googleDriveConnected, setGoogleDriveConnected] = useState<boolean | null>(null)

  const loadStaffForOffer = useCallback(async () => {
    const r = await fetchOperatorContacts(operatorId)
    if (r?.ok && Array.isArray(r.items)) {
      setStaffContacts(mapContactsToStaffPicks(r.items))
    } else {
      setStaffContacts([])
    }
  }, [operatorId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [a, t, s] = await Promise.all([
        fetchOperatorAgreements(operatorId),
        fetchOperatorAgreementTemplates(operatorId),
        fetchOperatorSettings(operatorId),
      ])
      if (cancelled) return
      if (a?.ok) setAgreements(a.items || [])
      if (t?.ok) setTemplates(t.items || [])
      const settings = s?.ok && s.settings && typeof s.settings === 'object' ? s.settings : {}
      setGoogleDriveConnected(!!settings.googleDrive)
      if (Array.isArray(settings.agreementAutomations)) {
        setAutomationRules(
          settings.agreementAutomations
            .map((x: any, idx: number) => ({
              id: String(x?.id || `auto-${idx + 1}`),
              templateId: String(x?.templateId || ''),
              triggerWhen: (
                x?.triggerWhen || 'new_employee_all'
              ) as AgreementAutomationRule['triggerWhen'],
            }))
            .filter((x: AgreementAutomationRule) => x.templateId)
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  useEffect(() => {
    if (searchParams.get('createOffer') !== '1') return
    if (googleDriveConnected === null) return
    if (!googleDriveConnected) {
      toast.error('Connect Google Drive under Company → Integration before creating offer letters.')
      router.replace('/portal/operator/agreement', { scroll: false })
      return
    }
    setIsCreateDialogOpen(true)
  }, [searchParams, googleDriveConnected, router])

  useEffect(() => {
    if (!isCreateDialogOpen) return
    void loadStaffForOffer()
  }, [isCreateDialogOpen, loadStaffForOffer])

  useEffect(() => {
    if (!signingAgreement) return
    setOpSignatureDataUrl('')
    setOpHasSignature(false)
    opDrawingRef.current = false
    const raf = requestAnimationFrame(() => {
      const canvas = opSignCanvasRef.current
      const wrap = opSignWrapRef.current
      if (!canvas || !wrap) return
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.max(1, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
      const cssWidth = Math.max(320, Math.floor(rect.width))
      const cssHeight = 180
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      canvas.width = Math.floor(cssWidth * dpr)
      canvas.height = Math.floor(cssHeight * dpr)
      canvas.style.touchAction = 'none'
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#111827'
      ctx.lineWidth = 2 * dpr
    })
    return () => cancelAnimationFrame(raf)
  }, [signingAgreement])

  const getOpCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = opSignCanvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  const opBeginDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = opSignCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.setPointerCapture(e.pointerId)
    const p = getOpCanvasPoint(e)
    opDrawingRef.current = true
    opLastPointRef.current = p
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  const opMoveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!opDrawingRef.current) return
    const canvas = opSignCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const p = getOpCanvasPoint(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    opLastPointRef.current = p
    if (!opHasSignature) setOpHasSignature(true)
  }

  const opEndDraw = () => {
    if (!opDrawingRef.current) return
    opDrawingRef.current = false
    opLastPointRef.current = null
    const canvas = opSignCanvasRef.current
    if (!canvas) return
    setOpSignatureDataUrl(canvas.toDataURL('image/png'))
  }

  const opClearSignature = () => {
    const canvas = opSignCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setOpSignatureDataUrl('')
    setOpHasSignature(false)
  }

  const submitOperatorAgreementSign = async () => {
    if (!signingAgreement?.id) return
    if (!opHasSignature || !opSignatureDataUrl) {
      toast.error('Please draw your signature first.')
      return
    }
    setOpSignSaving(true)
    const res = await signOperatorAgreement(signingAgreement.id, {
      signerName: user?.name || '',
      signerEmail: user?.email || '',
      signatureDataUrl: opSignatureDataUrl,
      signedFrom: 'operator_portal',
      signedAt: new Date().toISOString(),
    })
    setOpSignSaving(false)
    if (!res?.ok) {
      toast.error(res?.reason || 'Sign failed')
      return
    }
    toast.success('Agreement completed.')
    setSigningAgreement(null)
    const r = await fetchOperatorAgreements(operatorId)
    if (r?.ok) setAgreements(r.items || [])
  }

  const contactIdFromUrl = searchParams.get('contactId')

  useEffect(() => {
    if (!isCreateDialogOpen || !contactIdFromUrl || staffContacts.length === 0) return
    const hit = staffContacts.find((s) => s.id === contactIdFromUrl)
    if (!hit) return
    setSelectedStaffId(hit.id)
    setNewAgreement((prev) => ({
      ...prev,
      recipientName: hit.name,
      recipientEmail: hit.email,
      recipientType: hit.recipientType,
    }))
    router.replace('/portal/operator/agreement', { scroll: false })
  }, [isCreateDialogOpen, contactIdFromUrl, staffContacts, router])

  const resetCreateOfferForm = () => {
    setSelectedStaffId('')
    setNewAgreement({
      recipientName: '',
      recipientEmail: '',
      recipientType: '',
      template: '',
      salary: '',
      startDate: '',
    })
  }

  const onCreateDialogOpenChange = (open: boolean) => {
    setIsCreateDialogOpen(open)
    setStaffComboOpen(false)
    if (!open) {
      if (searchParams.get('createOffer') || searchParams.get('contactId')) {
        router.replace('/portal/operator/agreement', { scroll: false })
      }
      resetCreateOfferForm()
    }
  }

  const selectStaff = (s: StaffPick) => {
    setSelectedStaffId(s.id)
    setNewAgreement((prev) => ({
      ...prev,
      recipientName: s.name,
      recipientEmail: s.email,
      recipientType: s.recipientType,
    }))
    setStaffComboOpen(false)
  }

  const addAutomationRule = () => {
    setAutomationRules((prev) => [
      ...prev,
      {
        id: `auto-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        templateId: '',
        triggerWhen: 'new_employee_all',
      },
    ])
  }

  const updateAutomationRule = (id: string, patch: Partial<AgreementAutomationRule>) => {
    setAutomationRules((prev) => prev.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))
  }

  const removeAutomationRule = (id: string) => {
    setAutomationRules((prev) => prev.filter((rule) => rule.id !== id))
  }

  const handleSaveAutomations = async () => {
    const invalid = automationRules.some((x) => !x.templateId || !x.triggerWhen)
    if (invalid) {
      toast.error('Please select template and trigger for all automation cards')
      return
    }
    setAutomationSaving(true)
    const settingsR = await fetchOperatorSettings(operatorId)
    const settings = settingsR?.ok && settingsR.settings && typeof settingsR.settings === 'object' ? settingsR.settings : {}
    const saveR = await saveOperatorSettings(operatorId, {
      ...settings,
      agreementAutomations: automationRules,
    })
    setAutomationSaving(false)
    if (!saveR?.ok) {
      toast.error(saveR?.reason || 'Failed to save agreement automation')
      return
    }
    toast.success('Agreement automation saved')
    setIsAutomationDialogOpen(false)
  }

  const agreementColumns: Column<Agreement>[] = [
    {
      key: 'recipientName',
      label: 'Recipient',
      sortable: true,
      render: (_, row) => (
        <div>
          <p className="font-medium">{row.recipientName}</p>
          <p className="text-xs text-muted-foreground">{row.recipientEmail}</p>
        </div>
      ),
    },
    {
      key: 'recipientType',
      label: 'Type',
      filterable: true,
      filterOptions: [
        { label: 'Employee', value: 'employee' },
        { label: 'Driver', value: 'driver' },
        { label: 'Dobi', value: 'dobi' },
      ],
      render: (value) => (
        <Badge variant="secondary" className="capitalize">{String(value)}</Badge>
      ),
    },
    {
      key: 'templateName',
      label: 'Template',
    },
    {
      key: 'salary',
      label: 'Salary',
      sortable: true,
      render: (value) => `RM ${Number(value).toLocaleString()}/month`,
    },
    {
      key: 'startDate',
      label: 'Start Date',
      sortable: true,
      render: (value) => new Date(String(value)).toLocaleDateString('en-MY'),
    },
    {
      key: 'status',
      label: 'Status',
      filterable: true,
      filterOptions: [
        { label: 'Pending (profiles)', value: 'pending' },
        { label: 'Signing in progress', value: 'signing' },
        { label: 'Pending staff sign (legacy)', value: 'pending_staff_sign' },
        { label: 'Pending client sign (legacy)', value: 'pending_client_sign' },
        { label: 'Pending operator sign (legacy)', value: 'pending_operator_sign' },
        { label: 'Complete', value: 'complete' },
        { label: 'Draft (legacy)', value: 'draft' },
        { label: 'Sent (legacy)', value: 'sent' },
        { label: 'Signed (legacy)', value: 'signed' },
        { label: 'Rejected', value: 'rejected' },
      ],
      render: (value) => {
        const config = statusConfig[value as keyof typeof statusConfig] || fallbackAgreementStatus
        const Icon = config.icon
        return (
          <Badge variant="secondary" className={`${config.bg} ${config.text}`}>
            <Icon className="h-3 w-3 mr-1" />
            <span className="capitalize">{String(value)}</span>
          </Badge>
        )
      },
    },
  ]

  const agreementActions: Action<Agreement>[] = [
    {
      label: 'Preview',
      icon: <Eye className="h-4 w-4 mr-2" />,
      onClick: (row) => setPreviewAgreement(row),
    },
    {
      label: 'Signing',
      icon: <FileSignature className="h-4 w-4 mr-2" />,
      onClick: (row) => setSigningAgreement(row),
    },
    {
      label: 'Send',
      icon: <Send className="h-4 w-4 mr-2" />,
      onClick: (row) => toast.success(`Agreement sent to ${row.recipientEmail}`),
    },
    {
      label: 'Download PDF',
      icon: <Download className="h-4 w-4 mr-2" />,
      onClick: (row) => {
        const url = row.finalAgreementUrl?.trim()
        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer')
          return
        }
        toast.info('Final PDF is available after all parties have signed and Google Drive export finishes.')
      },
    },
    {
      label: 'Delete',
      icon: <Trash2 className="h-4 w-4 mr-2" />,
      variant: 'destructive',
      onClick: (row) => toast.error(`Delete agreement for ${row.recipientName}?`),
    },
  ]

  const templateColumns: Column<Template>[] = [
    {
      key: 'name',
      label: 'Template Name',
      sortable: true,
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <FileSignature className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{row.name}</span>
        </div>
      ),
    },
    {
      key: 'mode',
      label: 'Mode',
      filterable: true,
      filterOptions: [
        { label: 'Operator & staff (offer letter)', value: 'operator_staff' },
        { label: 'Operator & client — your customer (cleaning)', value: 'operator_client' },
      ],
      render: (value) => {
        const modeLabel = value === 'operator_staff'
          ? 'Operator & staff (offer letter)'
          : 'Operator & client — your customer (cleaning)'
        return <Badge variant="secondary">{modeLabel}</Badge>
      },
    },
    {
      key: 'templateUrl',
      label: 'Template URL',
      render: (value) => (
        <a
          href={String(value)}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary hover:underline"
        >
          {String(value)}
        </a>
      ),
    },
    {
      key: 'folderUrl',
      label: 'Template Folder',
      render: (value) => (
        <a
          href={String(value)}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary hover:underline"
        >
          Open folder
        </a>
      ),
    },
    {
      key: 'description',
      label: 'Description',
      render: (value) => (
        <span className="text-sm text-muted-foreground">{String(value)}</span>
      ),
    },
    {
      key: 'lastUpdated',
      label: 'Last Updated',
      sortable: true,
      render: (value) => new Date(String(value)).toLocaleDateString('en-MY'),
    },
  ]

  const templateActions: Action<Template>[] = [
    {
      label: 'Preview',
      icon: <Eye className="h-4 w-4 mr-2" />,
      onClick: async (row) => {
        if (previewingTemplateId) return
        setPreviewingTemplateId(row.id)
        try {
          const out = await openOperatorAgreementTemplatePreview(operatorId, row.id)
          if (!out.ok) {
            toast.error(out.reason || 'Preview failed')
            return
          }
        } finally {
          setPreviewingTemplateId(null)
        }
      },
    },
    {
      label: 'Edit',
      icon: <Edit className="h-4 w-4 mr-2" />,
      onClick: (row) => toast.info(`Editing template: ${row.name}`),
    },
    {
      label: 'Duplicate',
      icon: <Copy className="h-4 w-4 mr-2" />,
      onClick: (row) => toast.success(`Template "${row.name}" duplicated`),
    },
    {
      label: 'Delete',
      icon: <Trash2 className="h-4 w-4 mr-2" />,
      variant: 'destructive',
      onClick: (row) => toast.error(`Delete template "${row.name}"?`),
    },
  ]

  const handleCreateAgreement = async () => {
    if (!googleDriveConnected) {
      toast.error('Connect Google Drive under Company → Integration before creating offer letters.')
      return
    }
    if (!selectedStaffId) {
      toast.error('Please select a staff recipient from the list')
      return
    }
    if (!newAgreement.recipientEmail.trim() || !newAgreement.recipientType || !newAgreement.template) {
      toast.error('Please complete email, role type, and template')
      return
    }
    const res = await createOperatorAgreement({
      operatorId,
      templateId: newAgreement.template,
      recipientName: newAgreement.recipientName,
      recipientEmail: newAgreement.recipientEmail,
      recipientType: newAgreement.recipientType,
      templateName: templates.find((t) => t.id === newAgreement.template)?.name || 'Template',
      salary: Number(newAgreement.salary || 0),
      startDate: newAgreement.startDate,
    })
    if (!res?.ok) {
      const reason = String(res?.reason || '')
      if (reason === 'GOOGLE_DRIVE_REQUIRED') {
        toast.error('Connect Google Drive under Company → Integration before creating offer letters.')
      } else {
        toast.error(reason || 'Failed to create offer letter')
      }
      return
    }
    const r = await fetchOperatorAgreements(operatorId)
    if (r?.ok) setAgreements(r.items || [])
    toast.success(`Offer letter created for ${newAgreement.recipientName}`)
    onCreateDialogOpenChange(false)
  }

  const handleCreateTemplate = () => {
    if (!newTemplate.name || !newTemplate.mode || !newTemplate.templateUrl || !newTemplate.folderUrl) {
      toast.error('Template name, mode, template URL and folder URL are required')
      return
    }
    void createOperatorAgreementTemplate({
      operatorId,
      name: newTemplate.name,
      mode: newTemplate.mode,
      templateUrl: newTemplate.templateUrl,
      folderUrl: newTemplate.folderUrl,
      description: newTemplate.description,
    }).then(async () => {
      const r = await fetchOperatorAgreementTemplates(operatorId)
      if (r?.ok) setTemplates(r.items || [])
    })
    toast.success(`Template "${newTemplate.name}" created`)
    setIsTemplateDialogOpen(false)
    setNewTemplate({
      name: '',
      mode: '',
      templateUrl: '',
      folderUrl: '',
      description: '',
    })
  }

  /** Placeholder reference for Google Docs — General keys from shared JSON (same as Word .docx). */
  const variableReferenceGeneral = clnGeneralVariableTags()

  const variableReferenceOperator: { subtitle: string; vars: string[] }[] = [
    {
      subtitle: 'Operator (company profile + PIC)',
      vars: [
        '{{operator_company_name}}',
        '{{operator_ssm}}',
        '{{operator_chop}}',
        '{{operator_phone}}',
        '{{operator_email}}',
        '{{operator_pic_name}}',
        '{{operator_pic_nric}}',
        '{{operator_sign}}',
      ],
    },
  ]

  const variableReferenceStaff = [
    '{{staff_name}}',
    '{{staff_nric}}',
    '{{staff_nricfront}}',
    '{{staff_nricback}}',
    '{{staff_email}}',
    '{{staff_phone}}',
    '{{staff_sign}}',
    '{{salary}}',
    '{{staff_start_date}}',
    '{{staff_address}}',
  ]

  /** `client_*` = operator’s customer (the SaaS tenant’s client), not the operator company. */
  const variableReferenceClientParty: { subtitle: string; vars: string[] }[] = [
    {
      subtitle: 'Client (your customer)',
      vars: [
        '{{client_name}}',
        '{{client_nric}}',
        '{{client_contact}}',
        '{{client_phone}}',
        '{{client_email}}',
        '{{client_address}}',
        '{{client_sign}}',
      ],
    },
  ]

  const stats = {
    total: agreements.length,
    complete: agreements.filter((a) => a.status === 'complete' || a.status === 'signed').length,
    awaitingProfiles: agreements.filter((a) => a.status === 'pending').length,
    signingInProgress: agreements.filter((a) =>
      ['signing', 'pending_staff_sign', 'pending_client_sign', 'pending_operator_sign', 'draft', 'sent'].includes(
        a.status
      )
    ).length,
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Agreement Management</h2>
          <p className="text-muted-foreground">
            Create and manage agreements. Staff, client, and operator may sign in any order; the agreement completes when all
            required signatures are collected. A final PDF is generated when complete (Google Drive).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setIsAutomationDialogOpen(true)}>
            Agreement Automation
          </Button>
          {googleDriveConnected === true ? (
          <Dialog open={isCreateDialogOpen} onOpenChange={onCreateDialogOpenChange}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Offer Letter
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Offer Letter</DialogTitle>
              <DialogDescription>
                Generate and send an offer letter to a new hire
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-2">
                  <Label>Recipient (staff)</Label>
                  <Popover open={staffComboOpen} onOpenChange={setStaffComboOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={staffComboOpen}
                        className={cn('w-full justify-between font-normal', !selectedStaffId && 'text-muted-foreground')}
                      >
                        {selectedStaffId
                          ? staffContacts.find((s) => s.id === selectedStaffId)?.name || newAgreement.recipientName || 'Select staff'
                          : 'Search and select staff…'}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search by name or email…" />
                        <CommandList>
                          <CommandEmpty>No matching staff.</CommandEmpty>
                          <CommandGroup>
                            {staffContacts.map((s) => (
                              <CommandItem
                                key={s.id}
                                value={`${s.name} ${s.email}`}
                                onSelect={() => selectStaff(s)}
                              >
                                <span className="truncate">{s.name}</span>
                                <span className="ml-2 truncate text-xs text-muted-foreground">{s.email}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={newAgreement.recipientEmail}
                    onChange={(e) => setNewAgreement({ ...newAgreement, recipientEmail: e.target.value })}
                    placeholder="email@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Role Type</Label>
                  <Select
                    value={newAgreement.recipientType}
                    onValueChange={(value) => setNewAgreement({ ...newAgreement, recipientType: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">Employee</SelectItem>
                      <SelectItem value="driver">Driver</SelectItem>
                      <SelectItem value="dobi">Dobi</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2 col-span-2">
                  <Label>Template</Label>
                  <Select
                    value={newAgreement.template}
                    onValueChange={(value) => setNewAgreement({ ...newAgreement, template: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Monthly Salary (RM)</Label>
                  <Input
                    type="number"
                    value={newAgreement.salary}
                    onChange={(e) => setNewAgreement({ ...newAgreement, salary: e.target.value })}
                    placeholder="2000"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input
                    type="date"
                    value={newAgreement.startDate}
                    onChange={(e) => setNewAgreement({ ...newAgreement, startDate: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onCreateDialogOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="outline">
                Save as Draft
              </Button>
              <Button onClick={handleCreateAgreement}>
                <Send className="h-4 w-4 mr-2" />
                Create & Send
              </Button>
            </DialogFooter>
            </DialogContent>
          </Dialog>
          ) : googleDriveConnected === false ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button type="button" disabled>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Offer Letter
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                Connect Google Drive under Company → Integration first. Offer letters need Drive to generate and store
                documents.
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button type="button" disabled>
              <Plus className="h-4 w-4 mr-2" />
              Create Offer Letter
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-sm text-muted-foreground">Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-green-600">{stats.complete}</p>
                <p className="text-sm text-muted-foreground">Complete</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-slate-100">
                <Clock className="h-5 w-5 text-slate-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-700">{stats.awaitingProfiles}</p>
                <p className="text-sm text-muted-foreground">Pending profiles</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-sky-100">
                <FileSignature className="h-5 w-5 text-sky-800" />
              </div>
              <div>
                <p className="text-2xl font-bold text-sky-900">{stats.signingInProgress}</p>
                <p className="text-sm text-muted-foreground">Signing in progress</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Card>
        <CardHeader className="pb-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="agreements">Agreements</TabsTrigger>
              <TabsTrigger value="templates">Templates</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="pt-6">
          {activeTab === 'agreements' && (
            <DataTable
              data={agreements}
              columns={agreementColumns}
              actions={agreementActions}
              searchKeys={['recipientName', 'recipientEmail']}
              pageSize={10}
              emptyMessage="No agreements found. Create your first offer letter."
            />
          )}
          {activeTab === 'templates' && (
            <>
              <div className="flex justify-end mb-4">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setIsVariablesDialogOpen(true)}>
                    <BookOpen className="h-4 w-4 mr-2" />
                    Template Variables
                  </Button>
                <Dialog open={isTemplateDialogOpen} onOpenChange={setIsTemplateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline">
                      <Plus className="h-4 w-4 mr-2" />
                      New Template
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Create Agreement Template</DialogTitle>
                      <DialogDescription>
                        Create template with mode and source URL (same flow as agreement-setting).
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Template Name</Label>
                        <Input
                          value={newTemplate.name}
                          onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                          placeholder="e.g. Cleaner Offer Letter"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Mode</Label>
                        <Select
                          value={newTemplate.mode}
                          onValueChange={(value) => setNewTemplate({ ...newTemplate, mode: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select mode" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="operator_staff">Operator & staff (offer letter)</SelectItem>
                            <SelectItem value="operator_client">Operator & client — your customer (cleaning)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Template URL</Label>
                        <Input
                          type="url"
                          value={newTemplate.templateUrl}
                          onChange={(e) => setNewTemplate({ ...newTemplate, templateUrl: e.target.value })}
                          placeholder="https://docs.google.com/document/d/..."
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Template Folder URL</Label>
                        <Input
                          type="url"
                          value={newTemplate.folderUrl}
                          onChange={(e) => setNewTemplate({ ...newTemplate, folderUrl: e.target.value })}
                          placeholder="https://drive.google.com/drive/folders/..."
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Description (Optional)</Label>
                        <Textarea
                          value={newTemplate.description}
                          onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                          placeholder="Short template description"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsTemplateDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleCreateTemplate}>
                        Create Template
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                </div>
              </div>
              <DataTable
                data={templates}
                columns={templateColumns}
                actions={templateActions}
                searchKeys={['name', 'description']}
                pageSize={10}
                emptyMessage="No templates found. Create your first template."
              />
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={isVariablesDialogOpen} onOpenChange={setIsVariablesDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Variable Template Reference</DialogTitle>
            <DialogDescription>
              Use these placeholders in your Google Doc. Format: <code className="rounded bg-muted px-1 text-xs">{'{{name}}'}</code>
              . Sections match the downloadable Word reference (variable + example columns). Staff vs client keys depend on template
              mode (offer letter vs client agreement).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-2 text-sm">
            <section>
              <h3 className="font-semibold text-foreground mb-2">General</h3>
              <p className="text-xs text-muted-foreground mb-2">Agreement date and currency — both template modes.</p>
              <div className="flex flex-wrap gap-2">
                {variableReferenceGeneral.map((v) => (
                  <code key={v} className="text-xs rounded bg-muted px-2 py-1 font-mono">
                    {v}
                  </code>
                ))}
              </div>
            </section>

            <section>
              <h3 className="font-semibold text-foreground mb-2">Operator</h3>
              <p className="text-xs text-muted-foreground mb-3">Company Settings profile; chop = public image URL if embedded in the Doc.</p>
              <div className="space-y-4">
                {variableReferenceOperator.map((block) => (
                  <div key={block.subtitle}>
                    <p className="text-xs font-medium text-muted-foreground mb-2">{block.subtitle}</p>
                    <div className="flex flex-wrap gap-2">
                      {block.vars.map((v) => (
                        <code key={v} className="text-xs rounded bg-muted px-2 py-1 font-mono">
                          {v}
                        </code>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="font-semibold text-foreground mb-2">Staff (operator &amp; staff — offer letter)</h3>
              <p className="text-xs text-muted-foreground mb-2">
                Name, phone, salary, joined date from <code className="text-[11px]">cln_employeedetail</code> /{' '}
                <code className="text-[11px]">cln_employee_operator</code> (operator + recipient email). NRIC / address from
                portal profile when set. Agreement row used as fallback for salary / start date.
              </p>
              <div className="flex flex-wrap gap-2">
                {variableReferenceStaff.map((v) => (
                  <code key={v} className="text-xs rounded bg-muted px-2 py-1 font-mono">
                    {v}
                  </code>
                ))}
              </div>
            </section>

            <section>
              <h3 className="font-semibold text-foreground mb-2">Client (operator &amp; client — cleaning agreement)</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Cleanlemons has three parties: <strong>operator</strong> (your cleaning company on this SaaS),{' '}
                <strong>client</strong> (your customer — the party you clean for), and <strong>staff</strong>. Placeholders{' '}
                <code className="text-[11px]">{'{{client_*}}'}</code> are filled from the <strong>client</strong> (customer), not from the operator.
              </p>
              <div className="space-y-4">
                {variableReferenceClientParty.map((block) => (
                  <div key={block.subtitle}>
                    <p className="text-xs font-medium text-muted-foreground mb-2">{block.subtitle}</p>
                    <div className="flex flex-wrap gap-2">
                      {block.vars.map((v) => (
                        <code key={v} className="text-xs rounded bg-muted px-2 py-1 font-mono">
                          {v}
                        </code>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <DialogFooter className="flex flex-wrap gap-2 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => {
                void downloadClnAgreementVariablesReferenceDocx().then((r) => {
                  if (!r.ok) toast.error(r.reason || 'Download failed')
                })
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Download Word (all variables)
            </Button>
            <Button variant="outline" onClick={() => setIsVariablesDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAutomationDialogOpen} onOpenChange={setIsAutomationDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Agreement Automation</DialogTitle>
            <DialogDescription>
              Three roles: <strong>operator</strong>, <strong>client</strong> (your customer), <strong>staff</strong>.
              Automation uses <strong>Operator &amp; staff</strong> templates: when profiles are ready → status{' '}
              <strong>signing</strong> → staff and operator may sign in any order → <strong>complete</strong> when both have
              signed. <strong>Operator &amp; client</strong> templates are not automated here yet; use Create flow and client
              portal — signatures can complete in any order.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
            <Button variant="outline" onClick={addAutomationRule}>
              <Plus className="h-4 w-4 mr-2" />
              Add Automation
            </Button>
            {automationRules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No automation yet. Click Add Automation.</p>
            ) : (
              automationRules.map((rule, idx) => (
                <Card key={rule.id}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Automation #{idx + 1}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label>Template</Label>
                      <Select
                        value={rule.templateId}
                        onValueChange={(value) => updateAutomationRule(rule.id, { templateId: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select template" />
                        </SelectTrigger>
                        <SelectContent>
                          {templates.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Trigger when</Label>
                      <Select
                        value={rule.triggerWhen}
                        onValueChange={(value) =>
                          updateAutomationRule(rule.id, {
                            triggerWhen: value as AgreementAutomationRule['triggerWhen'],
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="new_customer">New customer</SelectItem>
                          <SelectItem value="new_employee_all">New employee all</SelectItem>
                          <SelectItem value="new_employee_parttime_only">New employee parttime only</SelectItem>
                          <SelectItem value="new_employee_fulltime_only">New employee full time only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex justify-end">
                      <Button variant="destructive" size="sm" onClick={() => removeAutomationRule(rule.id)}>
                        Remove
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAutomationDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveAutomations} disabled={automationSaving}>
              {automationSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewAgreement} onOpenChange={(open) => !open && setPreviewAgreement(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Agreement Preview</DialogTitle>
            <DialogDescription>
              Preview generated agreement before signing.
            </DialogDescription>
          </DialogHeader>
          {previewAgreement ? (
            <div className="space-y-2 text-sm">
              <p><span className="font-medium">Recipient:</span> {previewAgreement.recipientName}</p>
              <p><span className="font-medium">Email:</span> {previewAgreement.recipientEmail}</p>
              <p><span className="font-medium">Template:</span> {previewAgreement.templateName}</p>
              <p><span className="font-medium">Start Date:</span> {new Date(previewAgreement.startDate).toLocaleDateString('en-MY')}</p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewAgreement(null)}>Close</Button>
            <Button
              onClick={() => {
                toast.info('Opening PDF preview...')
              }}
            >
              <Eye className="h-4 w-4 mr-2" />
              Open Preview
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!signingAgreement}
        onOpenChange={(open) => {
          if (!open) setSigningAgreement(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Signing</DialogTitle>
            <DialogDescription>
              {operatorNeedsToSign(signingAgreement, signingAgreement?.signedMeta)
                ? 'Sign as the operator company (supervisor can use this page). Staff and client may sign before or after you; the agreement completes when every required party has signed.'
                : 'Your operator signature is already recorded, or we are still waiting for another required signatory (employee or client). Use Employee → Agreement or Client → Agreement as needed.'}
            </DialogDescription>
          </DialogHeader>
          {signingAgreement ? (
            <div className="space-y-4 text-sm">
              <div className="space-y-1">
                <p><span className="font-medium">Recipient:</span> {signingAgreement.recipientName}</p>
                <p><span className="font-medium">Template:</span> {signingAgreement.templateName}</p>
                <p><span className="font-medium">Status:</span> {signingAgreement.status}</p>
              </div>
              {operatorNeedsToSign(signingAgreement, signingAgreement.signedMeta) ? (
                <div className="space-y-2">
                  <Label>Operator (your company) signature</Label>
                  <div ref={opSignWrapRef} className="w-full rounded-md border bg-muted/30 p-2">
                    <canvas
                      ref={opSignCanvasRef}
                      className="w-full touch-none cursor-crosshair rounded bg-white"
                      onPointerDown={opBeginDraw}
                      onPointerMove={opMoveDraw}
                      onPointerUp={opEndDraw}
                      onPointerLeave={opEndDraw}
                    />
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={opClearSignature}>
                    Clear
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  <strong>Operator &amp; staff</strong>: employee signs in Employee → Agreement. <strong>Operator &amp;
                  client</strong>: your customer signs in Client → Agreement. When the other party has signed, you can sign
                  here if you have not already.
                </p>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSigningAgreement(null)}>Close</Button>
            {operatorNeedsToSign(signingAgreement, signingAgreement?.signedMeta) ? (
              <Button onClick={() => void submitOperatorAgreementSign()} disabled={opSignSaving}>
                {opSignSaving ? 'Saving…' : 'Sign & complete'}
              </Button>
            ) : (
              <Button
                onClick={() => {
                  if (!signingAgreement) return
                  toast.message(`Reminder: ask ${signingAgreement.recipientEmail} to open Employee → Agreement and sign.`)
                  setSigningAgreement(null)
                }}
              >
                <Send className="h-4 w-4 mr-2" />
                OK
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function AgreementPage() {
  return (
    <Suspense
      fallback={<div className="space-y-6 pb-20 p-4 text-muted-foreground">Loading agreements…</div>}
    >
      <AgreementPageContent />
    </Suspense>
  )
}
