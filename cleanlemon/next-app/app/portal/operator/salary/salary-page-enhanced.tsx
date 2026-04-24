"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable, Column, Action } from "@/components/shared/data-table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Archive,
  Check,
  CheckCircle,
  ChevronsUpDown,
  EllipsisVertical,
  ListFilter,
  MoreHorizontal,
  Search,
  Pencil,
  Clock,
  HelpCircle,
  Loader2,
  Plus,
  Settings,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/lib/auth-context"
import {
  deleteOperatorSalaryLine,
  patchOperatorSalaryLine,
  fetchOperatorContacts,
  fetchOperatorSalaries,
  fetchOperatorSalaryLines,
  fetchOperatorSalarySettings,
  fetchOperatorSettings,
  patchOperatorSalaryRecord,
  postOperatorSalaryLine,
  postOperatorSalaryRecord,
  postOperatorSalariesComputePreview,
  postOperatorSalariesMarkPaid,
  postOperatorSalariesSyncAccounting,
  postOperatorSalariesSyncFromContacts,
  saveOperatorSalarySettings,
} from "@/lib/cleanlemon-api"
import {
  STATUTORY_AMOUNT_DISCLAIMER,
  roughIllustrativeAmounts,
} from "@/lib/malaysia-salary-statutory-hint"
import {
  illustrativeEmployerEpf,
  illustrativeEisPair,
  illustrativeSocsoPair,
} from "@/lib/malaysia-payroll-estimate"
import type {
  MalaysiaFlexPayrollResult,
  PayrollDefaultsJson,
  PayrollInputsJson,
  SalaryLineApprovalStatus,
  SalaryLineMetaJson,
} from "@/lib/malaysia-flex-payroll.types"
import { cn } from "@/lib/utils"

type SalaryStatus = "pending_sync" | "partial_paid" | "complete" | "void" | "archived"
type PaymentMethod = "bank_transfer" | "cash" | "duitnow" | "cheque"

function recordHasAccrualJournal(r: { bukkuJournalId?: string; xeroManualJournalId?: string }) {
  const b = String(r.bukkuJournalId || "").trim()
  const x = String(r.xeroManualJournalId || "").trim()
  return Boolean(b || x)
}

interface SalaryRecord {
  id: string
  employeeLabel: string
  /** From linked employee row when payroll_inputs.sourceContactId is set */
  contactLegalName?: string
  contactFullName?: string
  contactEmail?: string
  team: string
  baseSalary: number
  netSalary: number
  period: string
  status: SalaryStatus
  bukkuJournalId: string
  bukkuExpenseId?: string
  xeroManualJournalId?: string
  xeroBankTransactionId?: string
  paymentMethod?: string
  paidDate?: string
  mtdApplies?: boolean
  epfApplies?: boolean
  socsoApplies?: boolean
  eisApplies?: boolean
  mtdAmount?: number | null
  epfAmount?: number | null
  socsoAmount?: number | null
  eisAmount?: number | null
  mtdTick?: boolean
  payrollInputs?: PayrollInputsJson
}

interface SalaryLineRow {
  id: string
  salaryRecordId: string
  lineKind: "allowance" | "deduction"
  label: string
  amount: number
  employeeLabel: string
  period: string
  team: string
  meta?: SalaryLineMetaJson
}

const PAYROLL_DEFAULTS_TEMPLATE: PayrollDefaultsJson = {
  workingDaysPerMonth: 26,
  hoursPerDay: 8,
  lateMode: "hourly",
  fixedLateAmount: 0,
  defaultConditionalPolicy: "attendance_style",
  halfDayLateMinutesThreshold: 60,
  businessTimeZone: "Asia/Kuala_Lumpur",
}

const monthOptions = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
]

const paymentMethodOptions: { value: PaymentMethod; label: string }[] = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "duitnow", label: "DuitNow" },
  { value: "cheque", label: "Cheque" },
]

type SalaryStatutoryDefaults = {
  epfApplies: boolean
  socsoApplies: boolean
  eisApplies: boolean
  mtdApplies: boolean
}

const DEFAULT_SALARY_STATUTORY: SalaryStatutoryDefaults = {
  epfApplies: true,
  socsoApplies: true,
  eisApplies: true,
  mtdApplies: false,
}

function normalizeSalaryStatutory(
  v: Partial<SalaryStatutoryDefaults> | undefined
): SalaryStatutoryDefaults {
  if (!v || typeof v !== "object") return { ...DEFAULT_SALARY_STATUTORY }
  return {
    epfApplies: v.epfApplies !== false,
    socsoApplies: v.socsoApplies !== false,
    eisApplies: v.eisApplies !== false,
    mtdApplies: v.mtdApplies === true,
  }
}

type SalaryContactOption = {
  id: string
  name: string
  /** From cln_employeedetail.legal_name when present */
  legalName?: string
  email?: string
  team?: string
  salaryBasic?: number
  status?: string
  contactSource?: string
  permissions?: unknown[]
  /** From Contact CRM — drives statutory toggles on salary when staff is selected / linked. */
  salaryStatutoryDefaults?: Partial<SalaryStatutoryDefaults>
}

const EMPLOYEE_ROLES = new Set(["staff", "driver", "dobi", "supervisor"])

function isSalaryEligibleContact(c: SalaryContactOption): boolean {
  if (!c || String(c.status || "").toLowerCase() !== "active") return false
  if (String(c.contactSource || "").toLowerCase() === "employee") return true
  const perms = Array.isArray(c.permissions) ? c.permissions.map((x) => String(x).toLowerCase()) : []
  return perms.some((p) => EMPLOYEE_ROLES.has(p))
}

function fmtRm(n: number): string {
  if (!Number.isFinite(n)) return "—"
  return `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Allowance / deduction record picker: legal name (email), with sensible fallbacks. */
function salaryRecordPickerLabel(r: SalaryRecord): string {
  const legal = String(r.contactLegalName || "").trim()
  const full = String(r.contactFullName || "").trim()
  const fallback = String(r.employeeLabel || "").trim()
  const name = legal || full || fallback || "Staff"
  const emailFromContact = String(r.contactEmail || "").trim()
  const emailFromPi = String(r.payrollInputs?.sourceContactEmail || "").trim()
  const email = emailFromContact || emailFromPi
  return email ? `${name} (${email})` : name
}

/**
 * Name shown before "(email)" in staff pickers.
 * Prefer legal name, then CRM full name; when API only has email as `name`, use the part before @ so rows are not all "Staff".
 */
function salaryContactDisplayName(c: SalaryContactOption): string {
  const legal = String(c.legalName || "").trim()
  const nm = String(c.name || "").trim()
  const em = String(c.email || "").trim()
  const emailForParts = em || nm
  if (legal) return legal
  if (nm && (!emailForParts || nm.toLowerCase() !== emailForParts.toLowerCase())) return nm
  if (emailForParts) {
    const at = emailForParts.indexOf("@")
    if (at > 0) {
      const local = emailForParts.slice(0, at).trim()
      if (local) return local.replace(/[._]+/g, " ")
    }
    return emailForParts
  }
  return "Staff"
}

function salaryContactPickerLabel(c: SalaryContactOption): string {
  const display = salaryContactDisplayName(c)
  const email = String(c.email || "").trim()
  return email ? `${display} (${email})` : display
}

/** Stored on salary row: prefer legal / full name; if CRM only has email as name, keep email so rows stay distinct. */
function salaryContactEmployeeLabelForRecord(c: SalaryContactOption): string {
  const legal = String(c.legalName || "").trim()
  const nm = String(c.name || "").trim()
  const em = String(c.email || "").trim()
  if (legal) return legal
  if (nm && (!em || nm.toLowerCase() !== em.toLowerCase())) return nm
  if (em) return em
  return "Staff"
}

function lineApprovalStatus(meta: SalaryLineMetaJson | undefined): SalaryLineApprovalStatus {
  const s = meta?.approvalStatus
  if (s === "pending" || s === "approved" || s === "rejected") return s
  return "approved"
}

function teamToEmployment(team: string): "full_time" | "part_time" | "unknown" {
  const t = String(team || "")
    .trim()
    .toLowerCase()
  if (t.includes("full") && t.includes("time")) return "full_time"
  if (t.includes("part") && t.includes("time")) return "part_time"
  return "unknown"
}

const dayChoices = Array.from({ length: 31 }, (_, i) => i + 1)

/** Last calendar day of YYYY-MM (local), matches server accrual default. */
function lastDayOfPeriodYm(p: string) {
  const [ys, ms] = p.split("-").map((x) => parseInt(x, 10))
  if (!ys || !ms) return new Date().toISOString().slice(0, 10)
  const d = new Date(ys, ms, 0)
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${mm}-${dd}`
}

function statusBadge(status: SalaryStatus) {
  if (status === "complete")
    return (
      <Badge variant="secondary" className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100">
        <CheckCircle className="h-3 w-3 mr-1" /> Complete
      </Badge>
    )
  if (status === "partial_paid")
    return (
      <Badge variant="secondary" className="bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-100">
        <Clock className="h-3 w-3 mr-1" /> Part paid
      </Badge>
    )
  if (status === "void")
    return (
      <Badge variant="secondary" className="bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-100">
        <XCircle className="h-3 w-3 mr-1" /> Void
      </Badge>
    )
  if (status === "archived")
    return (
      <Badge variant="secondary" className="bg-zinc-200 text-zinc-800">
        <Archive className="h-3 w-3 mr-1" /> Archived
      </Badge>
    )
  return (
    <Badge variant="secondary" className="bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <Clock className="h-3 w-3 mr-1" /> Pending sync
    </Badge>
  )
}

function payoutReleasedSoFar(r: SalaryRecord): number {
  return Math.max(0, Math.round(Number(r.payrollInputs?.payoutReleasedTotal ?? 0) * 100) / 100)
}

function netOutstandingForRecord(r: SalaryRecord): number {
  const net = Number(r.netSalary || 0)
  return Math.max(0, Math.round((net - payoutReleasedSoFar(r)) * 100) / 100)
}

export default function SalaryPageEnhanced() {
  const { user } = useAuth()
  const operatorId = user?.operatorId || ""
  const [records, setRecords] = useState<SalaryRecord[]>([])
  const [lines, setLines] = useState<SalaryLineRow[]>([])
  const [load, setLoad] = useState<"loading" | "ready" | "error">("loading")
  const [linesLoad, setLinesLoad] = useState<"loading" | "ready">("loading")

  const now = new Date()
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"))
  const [year, setYear] = useState(String(now.getFullYear()))
  const period = useMemo(() => `${year}-${month}`, [year, month])

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [payDays, setPayDays] = useState<number[]>([28])
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [payrollDefaultsDraft, setPayrollDefaultsDraft] = useState<PayrollDefaultsJson>(() => ({
    ...PAYROLL_DEFAULTS_TEMPLATE,
  }))

  const [addOpen, setAddOpen] = useState(false)
  const [addSummaryOpen, setAddSummaryOpen] = useState(false)
  const [addEmployment, setAddEmployment] = useState<"full_time" | "part_time">("full_time")
  const [addContactId, setAddContactId] = useState("")
  const [addBase, setAddBase] = useState("")
  const [addChkMtd, setAddChkMtd] = useState(false)
  const [addChkEpf, setAddChkEpf] = useState(true)
  const [addChkSocso, setAddChkSocso] = useState(true)
  const [addChkEis, setAddChkEis] = useState(true)
  const [addContacts, setAddContacts] = useState<SalaryContactOption[]>([])
  const [addContactsLoading, setAddContactsLoading] = useState(false)
  const [addStaffComboOpen, setAddStaffComboOpen] = useState(false)
  const [addPreviewBusy, setAddPreviewBusy] = useState(false)
  const [addFlexPreview, setAddFlexPreview] = useState<MalaysiaFlexPayrollResult | null>(null)
  const skipResetOnAddCloseRef = useRef(false)
  const backFromSummaryRef = useRef(false)

  const [lineOpen, setLineOpen] = useState(false)
  const [lineKind, setLineKind] = useState<"allowance" | "deduction">("allowance")
  const [lineRecordId, setLineRecordId] = useState("")
  const [lineLabel, setLineLabel] = useState("")
  const [lineAmount, setLineAmount] = useState("")
  const [lineAllowanceType, setLineAllowanceType] = useState<"fixed" | "conditional">("fixed")
  const [lineConditionalPolicy, setLineConditionalPolicy] = useState<"attendance_style" | "none">(
    "attendance_style"
  )

  const [lineSearch, setLineSearch] = useState("")
  const [recordStatusFilter, setRecordStatusFilter] = useState<"all" | SalaryStatus>("all")
  const [recordFilterExpanded, setRecordFilterExpanded] = useState(false)
  const [lineFilterExpanded, setLineFilterExpanded] = useState(false)
  const [lineFilterTeam, setLineFilterTeam] = useState("")
  const [lineFilterStaff, setLineFilterStaff] = useState("")
  const [lineFilterEmployment, setLineFilterEmployment] = useState<"all" | "full_time" | "part_time">("all")
  /** Sub-tabs within Allowances & deductions: which approval bucket to show */
  const [lineStatusTab, setLineStatusTab] = useState<SalaryLineApprovalStatus>("pending")
  const [lineSelectedIds, setLineSelectedIds] = useState<Set<string>>(new Set())
  const [lineEditOpen, setLineEditOpen] = useState(false)
  const [lineEditId, setLineEditId] = useState("")
  const [lineEditRecordId, setLineEditRecordId] = useState("")
  const [lineEditKind, setLineEditKind] = useState<"allowance" | "deduction">("allowance")
  const [lineEditLabel, setLineEditLabel] = useState("")
  const [lineEditAmount, setLineEditAmount] = useState("")
  const [lineEditAllowanceType, setLineEditAllowanceType] = useState<"fixed" | "conditional">("fixed")
  const [lineEditConditionalPolicy, setLineEditConditionalPolicy] = useState<"attendance_style" | "none">(
    "attendance_style"
  )
  const [lineEditPreview, setLineEditPreview] = useState<MalaysiaFlexPayrollResult | null>(null)
  const [lineEditPreviewBusy, setLineEditPreviewBusy] = useState(false)

  const [paidOpen, setPaidOpen] = useState(false)
  const [paidDate, setPaidDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [paidMethod, setPaidMethod] = useState<PaymentMethod>("bank_transfer")
  /** MYR string per record id — this payment run (default = remaining net). */
  const [paidReleaseById, setPaidReleaseById] = useState<Record<string, string>>({})
  const [paidBusy, setPaidBusy] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncDialogOpen, setSyncDialogOpen] = useState(false)
  const [syncJournalDate, setSyncJournalDate] = useState("")
  /** null = loading; false = no Bukku/Xero — Mark as paid is manual-only (no accrual sync). */
  const [accountingConnected, setAccountingConnected] = useState<boolean | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editId, setEditId] = useState("")
  const [editTeam, setEditTeam] = useState("")
  const [editName, setEditName] = useState("")
  const [editBase, setEditBase] = useState("")
  const [editNet, setEditNet] = useState("")
  const [editSaving, setEditSaving] = useState(false)
  const [chkMtd, setChkMtd] = useState(false)
  const [chkEpf, setChkEpf] = useState(false)
  const [chkSocso, setChkSocso] = useState(false)
  const [chkEis, setChkEis] = useState(false)
  const [amtMtd, setAmtMtd] = useState("")
  const [amtEpf, setAmtEpf] = useState("")
  const [amtSocso, setAmtSocso] = useState("")
  const [amtEis, setAmtEis] = useState("")
  const [payrollPreview, setPayrollPreview] = useState<MalaysiaFlexPayrollResult | null>(null)
  const [payrollPreviewBusy, setPayrollPreviewBusy] = useState(false)
  const [editPayrollInputs, setEditPayrollInputs] = useState<PayrollInputsJson>({})

  useEffect(() => {
    if (!operatorId) {
      setAccountingConnected(null)
      return
    }
    let cancelled = false
    void (async () => {
      const r = await fetchOperatorSettings(operatorId)
      if (cancelled) return
      const s = (r as { settings?: { bukku?: boolean; xero?: boolean } })?.settings
      setAccountingConnected(!!(s?.bukku || s?.xero))
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId])

  const loadRecords = useCallback(async () => {
    if (!operatorId) {
      setRecords([])
      setLoad("ready")
      return
    }
    setLoad("loading")
    const r = await fetchOperatorSalaries(operatorId, period)
    if (!r?.ok || !Array.isArray(r.items)) {
      setLoad("error")
      setRecords([])
      return
    }
    setRecords(
      r.items.map((item: any) => ({
        id: String(item.id),
        employeeLabel: String(item.employeeLabel || ""),
        contactLegalName:
          item.contactLegalName != null && String(item.contactLegalName).trim() !== ""
            ? String(item.contactLegalName).trim()
            : undefined,
        contactFullName:
          item.contactFullName != null && String(item.contactFullName).trim() !== ""
            ? String(item.contactFullName).trim()
            : undefined,
        contactEmail:
          item.contactEmail != null && String(item.contactEmail).trim() !== ""
            ? String(item.contactEmail).trim()
            : undefined,
        team: String(item.team || ""),
        baseSalary: Number(item.baseSalary || 0),
        netSalary: Number(item.netSalary || 0),
        period: String(item.period || ""),
        status: (item.status || "pending_sync") as SalaryStatus,
        bukkuJournalId: String(item.bukkuJournalId || ""),
        bukkuExpenseId: item.bukkuExpenseId ? String(item.bukkuExpenseId) : "",
        xeroManualJournalId: item.xeroManualJournalId ? String(item.xeroManualJournalId) : "",
        xeroBankTransactionId: item.xeroBankTransactionId ? String(item.xeroBankTransactionId) : "",
        paymentMethod: item.paymentMethod ? String(item.paymentMethod) : undefined,
        paidDate: item.paidDate ? String(item.paidDate).slice(0, 10) : undefined,
        mtdApplies: Boolean(item.mtdApplies),
        epfApplies: Boolean(item.epfApplies),
        socsoApplies: Boolean(item.socsoApplies),
        eisApplies: Boolean(item.eisApplies),
        mtdAmount: item.mtdAmount != null ? Number(item.mtdAmount) : null,
        epfAmount: item.epfAmount != null ? Number(item.epfAmount) : null,
        socsoAmount: item.socsoAmount != null ? Number(item.socsoAmount) : null,
        eisAmount: item.eisAmount != null ? Number(item.eisAmount) : null,
        mtdTick: Boolean(item.mtdTick),
        payrollInputs:
          item.payrollInputs && typeof item.payrollInputs === "object"
            ? (item.payrollInputs as PayrollInputsJson)
            : undefined,
      }))
    )
    setLoad("ready")
  }, [operatorId, period])

  const loadLines = useCallback(async () => {
    if (!operatorId) {
      setLines([])
      setLinesLoad("ready")
      return
    }
    setLinesLoad("loading")
    const r = await fetchOperatorSalaryLines(operatorId, period)
    if (!r?.ok || !Array.isArray(r.items)) {
      setLines([])
      setLinesLoad("ready")
      return
    }
    setLines(
      r.items.map((x: any) => ({
        id: String(x.id),
        salaryRecordId: String(x.salaryRecordId),
        lineKind: x.lineKind === "deduction" ? "deduction" : "allowance",
        label: String(x.label || ""),
        amount: Number(x.amount || 0),
        employeeLabel: String(x.employeeLabel || ""),
        period: String(x.period || ""),
        team: String(x.team || ""),
        meta: x.meta && typeof x.meta === "object" ? (x.meta as SalaryLineMetaJson) : undefined,
      }))
    )
    setLinesLoad("ready")
  }, [operatorId, period])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await loadRecords()
      if (cancelled) return
      if (!operatorId) return
      const s = await postOperatorSalariesSyncFromContacts({ operatorId, period })
      if (cancelled) return
      if (!s?.ok) {
        const reason = typeof s?.reason === "string" ? s.reason : ""
        if (reason === "SALARY_TABLES_MISSING") {
          toast.error("Salary tables are missing. Run database migrations on the server, then try again.")
        } else if (reason) {
          toast.error(`Could not sync contacts: ${reason}`)
        }
        await loadLines()
        return
      }
      if ((s.created ?? 0) > 0) {
        const n = s.created ?? 0
        toast.success(
          `Added ${n} active employee${n === 1 ? "" : "s"} from contacts`
        )
        await loadRecords()
      }
      await loadLines()
    })()
    return () => {
      cancelled = true
    }
  }, [operatorId, period, loadRecords, loadLines])

  useEffect(() => {
    if (!editOpen || !editId || !operatorId) return
    let cancelled = false
    void (async () => {
      setPayrollPreviewBusy(true)
      const r = await postOperatorSalariesComputePreview({
        operatorId,
        salaryRecordId: editId,
      })
      if (cancelled) return
      setPayrollPreviewBusy(false)
      if (!r?.ok) {
        setPayrollPreview(null)
        return
      }
      setPayrollPreview((r.result as MalaysiaFlexPayrollResult) || null)
    })()
    return () => {
      cancelled = true
    }
  }, [editOpen, editId, operatorId])

  useEffect(() => {
    if ((!addOpen && !editOpen) || !operatorId) return
    let cancelled = false
    void (async () => {
      setAddContactsLoading(true)
      const r = await fetchOperatorContacts(operatorId)
      setAddContactsLoading(false)
      if (cancelled) return
      if (r?.ok && Array.isArray(r.items)) {
        const rows: SalaryContactOption[] = (r.items as Record<string, unknown>[])
          .map((c) => ({
            id: String(c.id ?? ""),
            name: String(c.name ?? "").trim(),
            legalName:
              c.legalName != null && String(c.legalName).trim() !== ""
                ? String(c.legalName).trim()
                : undefined,
            email: c.email != null ? String(c.email) : "",
            team: c.team != null ? String(c.team) : "",
            salaryBasic: Number(
              typeof c.salaryBasic === "number" ? c.salaryBasic : Number(c.salaryBasic || 0)
            ),
            status: c.status != null ? String(c.status) : "",
            contactSource: c.contactSource != null ? String(c.contactSource) : "",
            permissions: Array.isArray(c.permissions) ? c.permissions : [],
            salaryStatutoryDefaults:
              c.salaryStatutoryDefaults != null && typeof c.salaryStatutoryDefaults === "object"
                ? (c.salaryStatutoryDefaults as Partial<SalaryStatutoryDefaults>)
                : undefined,
          }))
          .filter((c) => c.id && isSalaryEligibleContact(c))
        setAddContacts(rows)
      } else {
        setAddContacts([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [addOpen, editOpen, operatorId])

  useEffect(() => {
    setSelectedIds(new Set())
    setLineSelectedIds(new Set())
    setLineSearch("")
    setLineStatusTab("pending")
  }, [period])

  useEffect(() => {
    setLineSelectedIds(new Set())
  }, [lineStatusTab])

  useEffect(() => {
    if (!lineEditOpen || !lineEditRecordId || !operatorId) return
    let cancelled = false
    void (async () => {
      setLineEditPreviewBusy(true)
      const r = await postOperatorSalariesComputePreview({
        operatorId,
        salaryRecordId: lineEditRecordId,
      })
      if (cancelled) return
      setLineEditPreviewBusy(false)
      if (!r?.ok) {
        setLineEditPreview(null)
        return
      }
      setLineEditPreview((r.result as MalaysiaFlexPayrollResult) || null)
    })()
    return () => {
      cancelled = true
    }
  }, [lineEditOpen, lineEditRecordId, operatorId])

  useEffect(() => {
    setSyncJournalDate(lastDayOfPeriodYm(period))
  }, [period])

  const openSettings = async () => {
    if (!operatorId) return
    const r = await fetchOperatorSalarySettings(operatorId)
    if (r?.ok && r.settings?.payDays && Array.isArray(r.settings.payDays)) {
      setPayDays(r.settings.payDays.map((n: number) => Math.min(31, Math.max(1, Number(n) || 1))))
    } else {
      setPayDays([28])
    }
    const pd = r?.ok && r.settings?.payrollDefaults && typeof r.settings.payrollDefaults === "object"
      ? r.settings.payrollDefaults
      : {}
    setPayrollDefaultsDraft({
      ...PAYROLL_DEFAULTS_TEMPLATE,
      ...(pd as PayrollDefaultsJson),
    })
    setSettingsOpen(true)
  }

  const saveSettings = async () => {
    if (!operatorId) return
    setSettingsSaving(true)
    const r = await saveOperatorSalarySettings(operatorId, payDays, payrollDefaultsDraft)
    setSettingsSaving(false)
    if (!r?.ok) {
      toast.error(typeof r?.reason === "string" ? r.reason : "Could not save")
      return
    }
    toast.success("Salary days saved")
    setSettingsOpen(false)
  }

  const addPayDayRow = () => setPayDays((p) => [...p, 28])
  const setPayDayAt = (idx: number, v: string) => {
    const n = Math.min(31, Math.max(1, parseInt(v, 10) || 1))
    setPayDays((p) => p.map((x, i) => (i === idx ? n : x)))
  }
  const removePayDayAt = (idx: number) => setPayDays((p) => p.filter((_, i) => i !== idx))

  const yearOptions = useMemo(() => {
    const y = now.getFullYear()
    return [y + 1, y, y - 1, y - 2].map(String)
  }, [now])

  const lineTeamOptions = useMemo(() => {
    const s = new Set<string>()
    for (const l of lines) {
      if (l.team?.trim()) s.add(l.team.trim())
    }
    return [...s].sort()
  }, [lines])

  const filteredSalaryLines = useMemo(() => {
    const q = lineSearch.trim().toLowerCase()
    return lines.filter((row) => {
      if (lineFilterTeam && row.team !== lineFilterTeam) return false
      if (lineFilterStaff.trim()) {
        if (!row.employeeLabel.toLowerCase().includes(lineFilterStaff.trim().toLowerCase())) return false
      }
      if (lineFilterEmployment !== "all") {
        const em = teamToEmployment(row.team)
        if (em !== lineFilterEmployment) return false
      }
      if (lineApprovalStatus(row.meta) !== lineStatusTab) return false
      if (q) {
        const blob = `${row.label} ${row.employeeLabel} ${row.team} ${row.period}`.toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
  }, [lines, lineSearch, lineFilterTeam, lineFilterStaff, lineFilterEmployment, lineStatusTab])

  const hasActiveLineFilters = useMemo(() => {
    return !!lineFilterTeam || lineFilterStaff.trim() !== "" || lineFilterEmployment !== "all"
  }, [lineFilterTeam, lineFilterStaff, lineFilterEmployment])

  const recordPeriodFilterActive = useMemo(() => {
    const n = new Date()
    const cm = String(n.getMonth() + 1).padStart(2, "0")
    const cy = String(n.getFullYear())
    return month !== cm || year !== cy
  }, [month, year])

  const recordTableRows = useMemo(() => {
    if (recordStatusFilter === "all") return records
    return records.filter((r) => r.status === recordStatusFilter)
  }, [records, recordStatusFilter])

  const recordFiltersActive = recordPeriodFilterActive || recordStatusFilter !== "all"

  const resetPeriodToCurrentMonth = useCallback(() => {
    const n = new Date()
    setMonth(String(n.getMonth() + 1).padStart(2, "0"))
    setYear(String(n.getFullYear()))
  }, [])

  const editBaseNum = useMemo(() => Math.max(0, Number(editBase || 0)), [editBase])

  /**
   * Net pay = flexible payroll net − employee MTD/EPF/SOCSO/EIS (amount to bank to staff).
   * Uses same employee amounts as Summary: saved field, else illustrative when ticked.
   */
  const editComputedTakeHome = useMemo(() => {
    const flexNet = payrollPreview?.netSalary
    if (flexNet == null || !Number.isFinite(flexNet)) return Math.max(0, Number(editNet || 0))
    const parse = (s: string) => {
      const t = s.trim()
      if (t === "") return 0
      const n = Number(t)
      return Number.isFinite(n) ? Math.max(0, n) : 0
    }
    const ill = roughIllustrativeAmounts(editBaseNum)
    const socsoEmpFallback = illustrativeSocsoPair(editBaseNum).employee
    const mtd = chkMtd ? parse(amtMtd) : 0
    const epf = chkEpf ? (amtEpf.trim() !== "" ? parse(amtEpf) : ill.epfAmount) : 0
    const socso = chkSocso ? (amtSocso.trim() !== "" ? parse(amtSocso) : socsoEmpFallback) : 0
    const eis = chkEis ? (amtEis.trim() !== "" ? parse(amtEis) : ill.eisAmount) : 0
    return Math.max(0, flexNet - mtd - epf - socso - eis)
  }, [payrollPreview, chkMtd, chkEpf, chkSocso, chkEis, amtMtd, amtEpf, amtSocso, amtEis, editNet, editBaseNum])

  const editStatutorySocso = useMemo(() => illustrativeSocsoPair(editBaseNum), [editBaseNum])
  const editStatutoryEis = useMemo(() => illustrativeEisPair(editBaseNum), [editBaseNum])
  const editEpfEmployerDisplay = useMemo(() => illustrativeEmployerEpf(editBaseNum), [editBaseNum])

  /** Sum of employer-side EPF + SOCSO + EIS (illustrative) for ticked items. */
  const editEmployerExtraPayTotal = useMemo(() => {
    let t = 0
    if (chkEpf) t += editEpfEmployerDisplay
    if (chkSocso) t += editStatutorySocso.employer
    if (chkEis) t += editStatutoryEis.employer
    return Math.round(t * 100) / 100
  }, [chkEpf, chkSocso, chkEis, editEpfEmployerDisplay, editStatutorySocso, editStatutoryEis])

  const addSelectedContact = useMemo(
    () => addContacts.find((c) => c.id === addContactId),
    [addContacts, addContactId]
  )

  const addIllustrativeStatutory = useMemo(() => {
    const b = Math.max(0, Number(addBase || 0))
    const { epfAmount, eisAmount } = roughIllustrativeAmounts(b)
    const soc = illustrativeSocsoPair(b)
    return { epfAmount, eisAmount, socsoEmployee: soc.employee, socsoEmployer: soc.employer }
  }, [addBase])

  const addSummaryTakeHome = useMemo(() => {
    if (!addFlexPreview) return 0
    let n = addFlexPreview.netSalary
    if (addChkEpf) n -= addIllustrativeStatutory.epfAmount
    if (addChkSocso) n -= addIllustrativeStatutory.socsoEmployee
    if (addChkEis) n -= addIllustrativeStatutory.eisAmount
    return Math.max(0, n)
  }, [addFlexPreview, addChkEpf, addChkSocso, addChkEis, addIllustrativeStatutory])

  const selectedEligibleSync = useMemo(() => {
    if (accountingConnected !== true) return []
    return records.filter(
      (r) =>
        selectedIds.has(r.id) &&
        r.status === "pending_sync" &&
        !recordHasAccrualJournal(r) &&
        r.netSalary > 0
    )
  }, [records, selectedIds, accountingConnected])

  const selectedEligiblePaid = useMemo(() => {
    if (accountingConnected === null) return []
    return records.filter((r) => {
      if (!selectedIds.has(r.id)) return false
      if (r.status !== "pending_sync" && r.status !== "partial_paid") return false
      if (netOutstandingForRecord(r) <= 0.009) return false
      if (accountingConnected) return recordHasAccrualJournal(r)
      return true
    })
  }, [records, selectedIds, accountingConnected])

  const openSyncDialog = () => {
    if (!selectedEligibleSync.length) {
      toast.error("Select rows that are pending sync (no journal yet)")
      return
    }
    setSyncJournalDate(lastDayOfPeriodYm(period))
    setSyncDialogOpen(true)
  }

  const confirmSyncAccounting = async () => {
    if (!operatorId) return
    const ids = selectedEligibleSync.map((r) => r.id)
    if (!ids.length) return
    const jd = syncJournalDate.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jd)) {
      toast.error("Choose a valid journal date")
      return
    }
    setSyncBusy(true)
    const r = await postOperatorSalariesSyncAccounting(operatorId, ids, jd)
    setSyncBusy(false)
    if (!r?.ok) {
      toast.error(typeof r?.reason === "string" ? r.reason : "Sync failed")
      void loadRecords()
      return
    }
    const results = Array.isArray(r.results) ? r.results : []
    const okN = results.filter((x: any) => x.ok).length
    const skipped = results.filter((x: any) => x.skipped).length
    const prov = typeof r.provider === "string" ? r.provider : ""
    toast.success(
      `Accrual posted (${prov || "accounting"}): ${okN} ok${skipped ? ` · ${skipped} already synced` : ""}`
    )
    setSyncDialogOpen(false)
    void loadRecords()
  }

  const openBulkPaid = () => {
    const rows = selectedEligiblePaid
    if (!rows.length) {
      toast.error(
        accountingConnected
          ? "Select synced rows still pending payment"
          : "Select rows with a balance to pay"
      )
      return
    }
    const init: Record<string, string> = {}
    for (const r of rows) {
      const o = netOutstandingForRecord(r)
      init[r.id] = o > 0 ? String(o) : ""
    }
    setPaidReleaseById(init)
    setPaidDate(new Date().toISOString().slice(0, 10))
    setPaidOpen(true)
  }

  const confirmBulkPaid = async () => {
    if (!operatorId) return
    const ids = Object.keys(paidReleaseById)
    if (!ids.length) return
    const releaseAmounts: Record<string, number> = {}
    for (const id of ids) {
      const row = records.find((x) => x.id === id)
      if (!row) {
        toast.error("Record not found — refresh the page and try again")
        return
      }
      if (accountingConnected && !recordHasAccrualJournal(row)) {
        toast.error("Accrual journal required before payment")
        return
      }
      if (row.status !== "pending_sync" && row.status !== "partial_paid") {
        toast.error("This row cannot be paid in the current status")
        return
      }
      const raw = String(paidReleaseById[id] ?? "").replace(/,/g, "").trim()
      const n = Math.max(0, Number(raw))
      if (!Number.isFinite(n) || n <= 0) {
        toast.error("Enter a valid amount to release for each selected employee")
        return
      }
      const max = netOutstandingForRecord(row)
      if (n > max + 0.01) {
        toast.error(
          `Release amount cannot exceed balance (${fmtRm(max)}) for ${row.employeeLabel || "employee"}`
        )
        return
      }
      releaseAmounts[id] = Math.round(n * 100) / 100
    }
    if (!Object.keys(releaseAmounts).length) {
      toast.error("Nothing to save")
      return
    }
    setPaidBusy(true)
    const recordIdsOut = Object.keys(releaseAmounts)
    const r = await postOperatorSalariesMarkPaid({
      operatorId,
      recordIds: recordIdsOut,
      paymentDate: paidDate,
      paymentMethod: paidMethod,
      releaseAmounts,
    })
    setPaidBusy(false)
    if (!r?.ok) {
      toast.error(typeof r?.reason === "string" ? r.reason : "Update failed")
      return
    }
    toast.success("Payment recorded")
    setPaidOpen(false)
    setSelectedIds(new Set())
    void loadRecords()
  }

  const markVoid = async (row: SalaryRecord) => {
    const r = await patchOperatorSalaryRecord(row.id, { operatorId, status: "void" })
    if (!r?.ok) {
      toast.error(typeof r?.reason === "string" ? r.reason : "Failed")
      return
    }
    toast.success("Voided")
    void loadRecords()
  }

  const markArchived = async (row: SalaryRecord) => {
    const r = await patchOperatorSalaryRecord(row.id, { operatorId, status: "archived" })
    if (!r?.ok) {
      toast.error(typeof r?.reason === "string" ? r.reason : "Failed")
      return
    }
    toast.success("Archived")
    void loadRecords()
  }

  const voidPaymentOnly = async (row: SalaryRecord) => {
    const r = await patchOperatorSalaryRecord(row.id, { operatorId, action: "void_payment" })
    if (!r?.ok) {
      const reason = typeof r?.reason === "string" ? r.reason : ""
      const detail = typeof (r as { detail?: unknown })?.detail === "string" ? (r as { detail: string }).detail : ""
      let msg = reason || "Failed"
      if (reason === "BUKKU_VOID_FAILED") {
        msg = "Could not void the linked Bukku banking expense (money out). Fix in accounting or void there first."
      } else if (reason === "VOID_XERO_SPEND_FAILED" || reason === "VOID_XERO_EXCEPTION") {
        msg = "Could not void the linked Xero bank spend. Check accounting integration."
      } else if (reason === "BUKKU_NOT_CONNECTED") {
        msg = "Bukku is not connected; reconnect accounting or void the payout in Bukku manually."
      } else if (detail && reason !== "INVALID_STATUS") {
        msg = `${reason}: ${detail}`.slice(0, 280)
      }
      toast.error(msg)
      return
    }
    toast.success("Payment cleared — record is payable again")
    void loadRecords()
  }

  const unvoidRecord = async (row: SalaryRecord) => {
    const r = await patchOperatorSalaryRecord(row.id, { operatorId, action: "unvoid" })
    if (!r?.ok) {
      toast.error(typeof r?.reason === "string" ? r.reason : "Failed")
      return
    }
    toast.success("Restored from void")
    void loadRecords()
  }

  const unarchiveRecord = async (row: SalaryRecord) => {
    const r = await patchOperatorSalaryRecord(row.id, { operatorId, action: "unarchive" })
    if (!r?.ok) {
      toast.error(typeof r?.reason === "string" ? r.reason : "Failed")
      return
    }
    toast.success("Restored from archive")
    void loadRecords()
  }

  const resetAddWizard = () => {
    setAddSummaryOpen(false)
    setAddEmployment("full_time")
    setAddContactId("")
    setAddBase("")
    setAddChkMtd(false)
    setAddChkEpf(true)
    setAddChkSocso(true)
    setAddChkEis(true)
    setAddFlexPreview(null)
    setAddStaffComboOpen(false)
  }

  const handleAddNext = async () => {
    if (!operatorId) return
    if (!addContactId) {
      toast.error("Select a staff member")
      return
    }
    const base = Math.max(0, Number(addBase || 0))
    if (base <= 0) {
      toast.error("Enter a valid base salary")
      return
    }
    setAddPreviewBusy(true)
    const r = await postOperatorSalariesComputePreview({
      operatorId,
      baseSalary: base,
    })
    setAddPreviewBusy(false)
    if (!r?.ok || !r.result) {
      toast.error(typeof r?.reason === "string" ? r.reason : "Could not preview payroll")
      setAddFlexPreview(null)
      return
    }
    setAddFlexPreview(r.result as MalaysiaFlexPayrollResult)
    skipResetOnAddCloseRef.current = true
    setAddOpen(false)
    setAddSummaryOpen(true)
    queueMicrotask(() => {
      skipResetOnAddCloseRef.current = false
    })
  }

  const confirmAddRecord = async () => {
    if (!operatorId || !addSelectedContact) return
    const base = Math.max(0, Number(addBase || 0))
    const teamLabel = addEmployment === "full_time" ? "Full time" : "Part time"
    const pi: PayrollInputsJson = {}
    if (addSelectedContact.id) pi.sourceContactId = addSelectedContact.id
    if (addSelectedContact.email?.trim()) pi.sourceContactEmail = addSelectedContact.email.trim()

    const create = await postOperatorSalaryRecord({
      operatorId,
      period,
      team: teamLabel,
      employeeLabel: salaryContactEmployeeLabelForRecord(addSelectedContact),
      baseSalary: base,
      netSalary: addSummaryTakeHome,
      payrollInputs: Object.keys(pi).length ? pi : undefined,
    })
    if (!create?.ok || !create.item?.id) {
      toast.error(typeof create?.reason === "string" ? create.reason : "Could not add")
      return
    }
    const id = String(create.item.id)
    const patch = await patchOperatorSalaryRecord(id, {
      operatorId,
      mtdApplies: addChkMtd,
      epfApplies: addChkEpf,
      socsoApplies: addChkSocso,
      eisApplies: addChkEis,
      mtdAmount: null,
      epfAmount: addChkEpf ? addIllustrativeStatutory.epfAmount : null,
      socsoAmount: addChkSocso ? addIllustrativeStatutory.socsoEmployee : null,
      eisAmount: addChkEis ? addIllustrativeStatutory.eisAmount : null,
    })
    if (!patch?.ok) {
      toast.error(typeof patch?.reason === "string" ? patch.reason : "Record created but statutory flags failed")
      resetAddWizard()
      void loadRecords()
      return
    }
    toast.success("Record added")
    resetAddWizard()
    void loadRecords()
  }

  const openLineDialog = (kind: "allowance" | "deduction") => {
    setLineKind(kind)
    setLineRecordId(records[0]?.id || "")
    setLineLabel(kind === "allowance" ? "Allowance" : "Deduction")
    setLineAmount("")
    setLineAllowanceType("fixed")
    setLineConditionalPolicy("attendance_style")
    setLineOpen(true)
  }

  const submitLine = async () => {
    if (!operatorId || !lineRecordId) return
    const payload: Record<string, unknown> = {
      operatorId,
      salaryRecordId: lineRecordId,
      lineKind,
      label: lineLabel.trim(),
      amount: Number(lineAmount || 0),
    }
    if (lineKind === "allowance") {
      payload.meta = {
        allowanceType: lineAllowanceType,
        ...(lineAllowanceType === "conditional" ? { conditionalPolicy: lineConditionalPolicy } : {}),
      }
    }
    const r = await postOperatorSalaryLine(payload)
    if (!r?.ok) {
      toast.error(typeof r?.reason === "string" ? r.reason : "Could not save line")
      return
    }
    toast.success("Line added")
    setLineOpen(false)
    void loadLines()
    void loadRecords()
  }

  const deleteLine = async (id: string) => {
    if (!operatorId) return
    const r = await deleteOperatorSalaryLine(operatorId, id)
    if (!r?.ok) {
      toast.error("Could not delete")
      return
    }
    toast.success("Removed")
    void loadLines()
    void loadRecords()
  }

  const openLineEdit = (row: SalaryLineRow) => {
    setLineEditId(row.id)
    setLineEditRecordId(row.salaryRecordId)
    setLineEditKind(row.lineKind)
    setLineEditLabel(row.label)
    setLineEditAmount(String(row.amount ?? ""))
    setLineEditAllowanceType(row.meta?.allowanceType === "conditional" ? "conditional" : "fixed")
    setLineEditConditionalPolicy(row.meta?.conditionalPolicy === "none" ? "none" : "attendance_style")
    setLineEditPreview(null)
    setLineEditOpen(true)
  }

  const saveLineEdit = async () => {
    if (!operatorId || !lineEditId) return
    const row = lines.find((l) => l.id === lineEditId)
    const baseMeta: SalaryLineMetaJson = { ...(row?.meta || {}) }
    if (lineEditKind === "allowance") {
      baseMeta.allowanceType = lineEditAllowanceType
      if (lineEditAllowanceType === "conditional") {
        baseMeta.conditionalPolicy = lineEditConditionalPolicy
      } else {
        delete baseMeta.conditionalPolicy
      }
    }
    const r = await patchOperatorSalaryLine(operatorId, lineEditId, {
      label: lineEditLabel.trim() || "Line",
      amount: Number(lineEditAmount || 0),
      meta: baseMeta,
    })
    if (!r?.ok) {
      toast.error(typeof r?.reason === "string" ? r.reason : "Could not save")
      return
    }
    toast.success("Line saved")
    setLineEditOpen(false)
    void loadLines()
    void loadRecords()
  }

  const patchLineApproval = async (id: string, approvalStatus: SalaryLineApprovalStatus) => {
    if (!operatorId) return
    const r = await patchOperatorSalaryLine(operatorId, id, { approvalStatus })
    if (!r?.ok) {
      toast.error(typeof r?.reason === "string" ? r.reason : "Update failed")
      return
    }
    toast.success(
      approvalStatus === "approved" ? "Approved" : approvalStatus === "rejected" ? "Rejected" : "Updated"
    )
    void loadLines()
    void loadRecords()
  }

  const bulkLineApproval = async (ids: string[], approvalStatus: SalaryLineApprovalStatus) => {
    if (!operatorId || !ids.length) return
    const results = await Promise.all(ids.map((id) => patchOperatorSalaryLine(operatorId, id, { approvalStatus })))
    if (results.some((x) => !x?.ok)) {
      toast.error("Some rows could not be updated")
      void loadLines()
      void loadRecords()
      return
    }
    toast.success(approvalStatus === "approved" ? "Approved" : "Rejected")
    setLineSelectedIds(new Set())
    void loadLines()
    void loadRecords()
  }

  const editStatutoryLocked = useMemo(
    () => Boolean(String(editPayrollInputs?.sourceContactId || "").trim()),
    [editPayrollInputs]
  )

  const addStatutoryLocked = Boolean(addContactId)

  useEffect(() => {
    if (!addContactId) return
    const c = addContacts.find((x) => x.id === addContactId)
    if (!c) return
    const sd = normalizeSalaryStatutory(c.salaryStatutoryDefaults)
    setAddChkMtd(sd.mtdApplies)
    setAddChkEpf(sd.epfApplies)
    setAddChkSocso(sd.socsoApplies)
    setAddChkEis(sd.eisApplies)
  }, [addContactId, addContacts])

  useEffect(() => {
    if (!editOpen) return
    const cid = String(editPayrollInputs?.sourceContactId || "").trim()
    if (!cid) return
    const c = addContacts.find((x) => x.id === cid)
    if (!c) return
    const sd = normalizeSalaryStatutory(c.salaryStatutoryDefaults)
    setChkMtd(sd.mtdApplies)
    setChkEpf(sd.epfApplies)
    setChkSocso(sd.socsoApplies)
    setChkEis(sd.eisApplies)
  }, [editOpen, editPayrollInputs?.sourceContactId, addContacts])

  const openEdit = (row: SalaryRecord) => {
    setEditId(row.id)
    setEditTeam(row.team)
    setEditName(row.employeeLabel)
    setEditBase(String(row.baseSalary ?? ""))
    setEditNet(String(row.netSalary ?? ""))
    const pi: PayrollInputsJson =
      row.payrollInputs && typeof row.payrollInputs === "object" ? { ...row.payrollInputs } : {}
    setEditPayrollInputs(pi)
    setPayrollPreview(null)
    const cid = String(pi.sourceContactId || "").trim()
    const fromContact = cid ? addContacts.find((c) => c.id === cid) : undefined
    if (fromContact) {
      const sd = normalizeSalaryStatutory(fromContact.salaryStatutoryDefaults)
      setChkMtd(sd.mtdApplies)
      setChkEpf(sd.epfApplies)
      setChkSocso(sd.socsoApplies)
      setChkEis(sd.eisApplies)
    } else {
      setChkMtd(Boolean(row.mtdApplies))
      setChkEpf(Boolean(row.epfApplies))
      setChkSocso(Boolean(row.socsoApplies))
      setChkEis(Boolean(row.eisApplies))
    }
    setAmtMtd(row.mtdAmount != null && !Number.isNaN(Number(row.mtdAmount)) ? String(row.mtdAmount) : "")
    setAmtEpf(row.epfAmount != null && !Number.isNaN(Number(row.epfAmount)) ? String(row.epfAmount) : "")
    setAmtSocso(row.socsoAmount != null && !Number.isNaN(Number(row.socsoAmount)) ? String(row.socsoAmount) : "")
    setAmtEis(row.eisAmount != null && !Number.isNaN(Number(row.eisAmount)) ? String(row.eisAmount) : "")
    setEditOpen(true)
  }

  const applyRoughIllustrative = () => {
    if (editStatutoryLocked) {
      toast.info("Statutory toggles are set on the staff Contact profile — change them there.")
      return
    }
    const base = Number(editBase || 0)
    const { epfAmount, eisAmount } = roughIllustrativeAmounts(base)
    const soc = illustrativeSocsoPair(base)
    setChkEpf(true)
    setChkSocso(true)
    setChkEis(true)
    setAmtEpf(String(epfAmount))
    setAmtSocso(String(soc.employee))
    setAmtEis(String(eisAmount))
    toast.info("Illustration only — verify with payroll / official tables")
  }

  const saveEdit = async () => {
    if (!operatorId || !editId) return
    setEditSaving(true)
    const parseAmt = (s: string) => {
      const t = s.trim()
      if (t === "") return null
      const n = Number(t)
      return Number.isFinite(n) ? Math.max(0, n) : null
    }
    const baseN = Number(editBase || 0)
    const ill = roughIllustrativeAmounts(baseN)
    const socIll = illustrativeSocsoPair(baseN)
    const r = await patchOperatorSalaryRecord(editId, {
      operatorId,
      team: editTeam,
      employeeLabel: editName,
      baseSalary: baseN,
      netSalary: payrollPreview ? editComputedTakeHome : Number(editNet || 0),
      payrollInputs: {
        ...editPayrollInputs,
        lateMinutes: editPayrollInputs.lateMinutes ?? 0,
        lateCount: editPayrollInputs.lateCount ?? 0,
        unpaidLeaveDays: editPayrollInputs.unpaidLeaveDays ?? 0,
      },
      mtdApplies: chkMtd,
      epfApplies: chkEpf,
      socsoApplies: chkSocso,
      eisApplies: chkEis,
      mtdAmount: parseAmt(amtMtd),
      epfAmount: chkEpf ? parseAmt(amtEpf) ?? ill.epfAmount : null,
      socsoAmount: chkSocso ? parseAmt(amtSocso) ?? socIll.employee : null,
      eisAmount: chkEis ? parseAmt(amtEis) ?? ill.eisAmount : null,
    })
    setEditSaving(false)
    if (!r?.ok) {
      toast.error(typeof r?.reason === "string" ? r.reason : "Could not save")
      return
    }
    toast.success("Saved")
    setEditOpen(false)
    void loadRecords()
  }

  const recordColumns: Column<SalaryRecord>[] = [
    {
      key: "employeeLabel",
      label: "Staff",
      sortable: true,
      render: (v) => <span className="font-medium">{String(v || "—")}</span>,
    },
    {
      key: "baseSalary",
      label: "Base salary",
      sortable: true,
      render: (v) => `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`,
    },
    {
      key: "netSalary",
      label: "Net salary",
      sortable: true,
      render: (v) => `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`,
    },
    {
      key: "released",
      label: "Released",
      render: (_, row) => fmtRm(payoutReleasedSoFar(row)),
    },
    {
      key: "outstanding",
      label: "Balance",
      render: (_, row) => fmtRm(netOutstandingForRecord(row)),
    },
    {
      key: "mtdTick",
      label: "MTD",
      sortable: true,
      render: (_, row) =>
        row.mtdTick ? (
          <Check className="h-4 w-4 text-emerald-600" aria-label="MTD" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: "team", label: "Team", sortable: true, render: (v) => String(v || "—") },
    {
      key: "status",
      label: "Status",
      render: (v) => statusBadge(v as SalaryStatus),
    },
  ]

  const recordActions: Action<SalaryRecord>[] = [
    {
      label: "Edit",
      icon: <Pencil className="h-4 w-4 mr-2" />,
      onClick: (row) => openEdit(row),
      visible: (row) => row.status !== "archived" && row.status !== "void",
    },
    {
      label: "Mark as paid",
      icon: <CheckCircle className="h-4 w-4 mr-2" />,
      onClick: (row) => {
        setSelectedIds(new Set([row.id]))
        const o = netOutstandingForRecord(row)
        setPaidReleaseById({ [row.id]: o > 0 ? String(o) : "" })
        setPaidDate(new Date().toISOString().slice(0, 10))
        setPaidOpen(true)
      },
      visible: (row) => {
        if (accountingConnected === null) return false
        if (row.status !== "pending_sync" && row.status !== "partial_paid") return false
        if (netOutstandingForRecord(row) <= 0.009) return false
        if (accountingConnected) return recordHasAccrualJournal(row)
        return true
      },
    },
    {
      label: "Void payment",
      icon: <XCircle className="h-4 w-4 mr-2" />,
      variant: "destructive",
      onClick: (row) => void voidPaymentOnly(row),
      visible: (row) => row.status === "complete" || row.status === "partial_paid",
    },
    {
      label: "Void",
      icon: <XCircle className="h-4 w-4 mr-2" />,
      variant: "destructive",
      onClick: (row) => void markVoid(row),
      visible: (row) => {
        if (row.status === "void" || row.status === "archived") return false
        if (accountingConnected === null) return false
        if (accountingConnected) return recordHasAccrualJournal(row)
        return true
      },
    },
    {
      label: "Archive",
      icon: <Archive className="h-4 w-4 mr-2" />,
      onClick: (row) => void markArchived(row),
      visible: (row) => row.status !== "archived",
    },
    {
      label: "Unvoid",
      icon: <Undo2 className="h-4 w-4 mr-2" />,
      onClick: (row) => void unvoidRecord(row),
      visible: (row) => row.status === "void",
    },
    {
      label: "Unarchive",
      icon: <Undo2 className="h-4 w-4 mr-2" />,
      onClick: (row) => void unarchiveRecord(row),
      visible: (row) => row.status === "archived",
    },
  ]

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6 pb-20 lg:pb-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Salary</h2>
            <p className="text-muted-foreground text-sm">
              {accountingConnected === false ? (
                <>
                  Salary records, allowances & deductions, and mark payments without connecting accounting. When you
                  connect Bukku or Xero in Company, you can also sync accrual and post payouts to the books.
                </>
              ) : (
                <>
                  Records, allowances & deductions, then accrual to your connected accounting (Bukku journal or Xero
                  manual journal — same GL mapping). See{" "}
                  <a
                    className="underline underline-offset-2"
                    href="https://intercom.help/bukku/en/articles/11983121-recording-employee-salaries-statutory-payments"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Bukku payroll guide
                  </a>
                  . Choose pay period in each tab&apos;s Filter.
                </>
              )}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            title="Salary day settings"
            onClick={() => void openSettings()}
            className="shrink-0"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>

        <Tabs defaultValue="record" className="w-full">
          <TabsList className="grid w-full max-w-xl grid-cols-2 gap-1 sm:max-w-2xl">
            <TabsTrigger value="record" className="text-xs sm:text-sm">
              Salary record
            </TabsTrigger>
            <TabsTrigger value="detail" className="text-xs sm:text-sm">
              Allowances & deductions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="record" className="mt-4 space-y-4">
            <Card className="rounded-2xl border">
              <CardHeader className="space-y-4">
                <div>
                  <CardTitle className="text-lg">Payroll</CardTitle>
                  <CardDescription>
                    Salary records for <strong>{period}</strong>. Use Filter to change month and year.
                  </CardDescription>
                </div>
                <div className="flex w-full flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      resetAddWizard()
                      setAddOpen(true)
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add record
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="default" size="sm" className="gap-2">
                        <EllipsisVertical className="h-4 w-4" />
                        Action
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52">
                      {accountingConnected ? (
                        <DropdownMenuItem
                          disabled={syncBusy || !selectedEligibleSync.length}
                          onClick={() => openSyncDialog()}
                        >
                          Sync to accounting
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem
                        disabled={accountingConnected === null || !selectedEligiblePaid.length}
                        onClick={() => openBulkPaid()}
                      >
                        Mark as paid
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                {load === "loading" ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Loading…
                  </div>
                ) : load === "error" ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">Could not load salary data.</p>
                ) : (
                  <DataTable
                    data={recordTableRows}
                    columns={recordColumns}
                    actions={recordActions}
                    searchKeys={["employeeLabel", "team"]}
                    pageSize={10}
                    emptyMessage="No records for this month. Add a record or pick another period."
                    stackedOnNarrow
                    noHorizontalScroll
                    toolbarEnd={
                      <Button
                        type="button"
                        variant={recordFilterExpanded ? "secondary" : "outline"}
                        className="h-10 shrink-0"
                        onClick={() => setRecordFilterExpanded((v) => !v)}
                        aria-expanded={recordFilterExpanded}
                      >
                        <ListFilter className="h-4 w-4 mr-2" />
                        Filter
                        {recordFiltersActive ? (
                          <span className="ml-2 inline-flex h-2 w-2 rounded-full bg-primary" aria-hidden />
                        ) : null}
                      </Button>
                    }
                    toolbarBelowSearch={
                      recordFilterExpanded ? (
                        <div className="rounded-lg border bg-muted/30 p-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
                            <div className="space-y-1.5 w-full lg:w-[200px]">
                              <Label className="text-xs text-muted-foreground">Month</Label>
                              <Select value={month} onValueChange={setMonth}>
                                <SelectTrigger className="border-input w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {monthOptions.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>
                                      {o.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5 w-full lg:w-[120px]">
                              <Label className="text-xs text-muted-foreground">Year</Label>
                              <Select value={year} onValueChange={setYear}>
                                <SelectTrigger className="border-input w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {yearOptions.map((y) => (
                                    <SelectItem key={y} value={y}>
                                      {y}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5 w-full min-w-0 sm:min-w-[11rem] lg:w-[200px]">
                              <Label className="text-xs text-muted-foreground">Status</Label>
                              <Select
                                value={recordStatusFilter}
                                onValueChange={(v) =>
                                  setRecordStatusFilter(v === "all" ? "all" : (v as SalaryStatus))
                                }
                              >
                                <SelectTrigger className="border-input w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">All status</SelectItem>
                                  <SelectItem value="pending_sync">Pending sync</SelectItem>
                                  <SelectItem value="partial_paid">Part paid</SelectItem>
                                  <SelectItem value="complete">Complete</SelectItem>
                                  <SelectItem value="void">Void</SelectItem>
                                  <SelectItem value="archived">Archived</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            {recordPeriodFilterActive ? (
                              <Button type="button" variant="ghost" size="sm" onClick={resetPeriodToCurrentMonth}>
                                Reset to current month
                              </Button>
                            ) : null}
                            {recordStatusFilter !== "all" ? (
                              <Button type="button" variant="ghost" size="sm" onClick={() => setRecordStatusFilter("all")}>
                                Clear status
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ) : null
                    }
                    rowSelection={{
                      selectedIds,
                      onSelectionChange: setSelectedIds,
                      isRowSelectable: (row) => row.status !== "void" && row.status !== "archived",
                    }}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="detail" className="mt-4 space-y-4">
            <Card className="rounded-2xl border w-full">
              <CardHeader className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-lg">Allowances & deductions</CardTitle>
                    <CardDescription>
                      Pay period <strong>{period}</strong> (set month/year in Filter below). Only the{" "}
                      <strong>Approved</strong> tab items count in payroll; net salary updates after you approve or
                      reject.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => openLineDialog("allowance")}
                      disabled={!records.length}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Allowance
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => openLineDialog("deduction")}
                      disabled={!records.length}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Deduction
                    </Button>
                  </div>
                </div>
                <Tabs
                  value={lineStatusTab}
                  onValueChange={(v) => setLineStatusTab(v as SalaryLineApprovalStatus)}
                  className="w-full"
                >
                  <TabsList className="grid w-full max-w-md grid-cols-3 sm:w-auto sm:max-w-none sm:inline-flex">
                    <TabsTrigger value="pending">Pending</TabsTrigger>
                    <TabsTrigger value="approved">Approved</TabsTrigger>
                    <TabsTrigger value="rejected">Rejected</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative min-w-0 flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search label, staff, team…"
                      value={lineSearch}
                      onChange={(e) => setLineSearch(e.target.value)}
                      className="border-input pl-9"
                    />
                  </div>
                  <Button
                    type="button"
                    variant={lineFilterExpanded ? "secondary" : "outline"}
                    className="shrink-0"
                    onClick={() => setLineFilterExpanded((v) => !v)}
                    aria-expanded={lineFilterExpanded}
                  >
                    <ListFilter className="h-4 w-4 mr-2" />
                    Filter
                    {hasActiveLineFilters || recordPeriodFilterActive ? (
                      <span className="ml-2 inline-flex h-2 w-2 rounded-full bg-primary" aria-hidden />
                    ) : null}
                  </Button>
                  {lineStatusTab === "pending" ? (
                    <div className="flex flex-wrap gap-2 sm:ml-auto">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="shrink-0"
                        disabled={
                          !filteredSalaryLines.some(
                            (r) => lineSelectedIds.has(r.id) && lineApprovalStatus(r.meta) === "pending"
                          )
                        }
                        onClick={() =>
                          void bulkLineApproval(
                            filteredSalaryLines
                              .filter((r) => lineSelectedIds.has(r.id) && lineApprovalStatus(r.meta) === "pending")
                              .map((r) => r.id),
                            "approved"
                          )
                        }
                      >
                        Approve selected
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        disabled={
                          !filteredSalaryLines.some(
                            (r) => lineSelectedIds.has(r.id) && lineApprovalStatus(r.meta) === "pending"
                          )
                        }
                        onClick={() =>
                          void bulkLineApproval(
                            filteredSalaryLines
                              .filter((r) => lineSelectedIds.has(r.id) && lineApprovalStatus(r.meta) === "pending")
                              .map((r) => r.id),
                            "rejected"
                          )
                        }
                      >
                        Reject selected
                      </Button>
                    </div>
                  ) : null}
                </div>
                {lineFilterExpanded ? (
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-xs text-muted-foreground mb-3">
                      Same pay period as Payroll tab — changing month/year here updates both tabs.
                    </p>
                    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
                      <div className="space-y-1.5 w-full lg:w-[200px]">
                        <Label className="text-xs text-muted-foreground">Month</Label>
                        <Select value={month} onValueChange={setMonth}>
                          <SelectTrigger className="border-input w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {monthOptions.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5 w-full lg:w-[120px]">
                        <Label className="text-xs text-muted-foreground">Year</Label>
                        <Select value={year} onValueChange={setYear}>
                          <SelectTrigger className="border-input w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {yearOptions.map((y) => (
                              <SelectItem key={y} value={y}>
                                {y}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {recordPeriodFilterActive ? (
                        <Button type="button" variant="ghost" size="sm" onClick={resetPeriodToCurrentMonth}>
                          Reset to current month
                        </Button>
                      ) : null}
                      <div className="space-y-1.5 w-full lg:w-[260px]">
                        <Label className="text-xs text-muted-foreground">Team</Label>
                        <Select
                          value={lineFilterTeam || "__all__"}
                          onValueChange={(v) => setLineFilterTeam(v === "__all__" ? "" : v)}
                        >
                          <SelectTrigger className="border-input w-full">
                            <SelectValue placeholder="All teams" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">All teams</SelectItem>
                            {lineTeamOptions.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5 w-full lg:min-w-[200px] lg:max-w-sm lg:flex-1">
                        <Label className="text-xs text-muted-foreground">Staff (contains)</Label>
                        <Input
                          className="border-input"
                          value={lineFilterStaff}
                          onChange={(e) => setLineFilterStaff(e.target.value)}
                          placeholder="Name…"
                        />
                      </div>
                      <div className="space-y-1.5 w-full lg:w-[180px]">
                        <Label className="text-xs text-muted-foreground">Full / Part time</Label>
                        <Select
                          value={lineFilterEmployment}
                          onValueChange={(v) =>
                            setLineFilterEmployment(v as "all" | "full_time" | "part_time")
                          }
                        >
                          <SelectTrigger className="border-input w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="full_time">Full time</SelectItem>
                            <SelectItem value="part_time">Part time</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {hasActiveLineFilters ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setLineFilterTeam("")
                            setLineFilterStaff("")
                            setLineFilterEmployment("all")
                          }}
                        >
                          Clear filters
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                {linesLoad === "loading" ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Loading…
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            {lineStatusTab === "pending" ? (
                              <th className="w-10 px-2 py-2 text-left">
                                <Checkbox
                                  checked={
                                    filteredSalaryLines.length > 0 &&
                                    filteredSalaryLines.every((r) => lineSelectedIds.has(r.id))
                                  }
                                  onCheckedChange={() => {
                                    if (
                                      filteredSalaryLines.length > 0 &&
                                      filteredSalaryLines.every((r) => lineSelectedIds.has(r.id))
                                    ) {
                                      setLineSelectedIds(new Set())
                                    } else {
                                      setLineSelectedIds(new Set(filteredSalaryLines.map((r) => r.id)))
                                    }
                                  }}
                                  aria-label="Select all"
                                />
                              </th>
                            ) : null}
                            <th className="px-2 py-2 text-left">Staff</th>
                            <th className="px-2 py-2 text-left">Team</th>
                            <th className="px-2 py-2 text-left">Type</th>
                            <th className="px-2 py-2 text-left">Allowance kind</th>
                            <th className="px-2 py-2 text-left">Label</th>
                            <th className="px-2 py-2 text-right">Nominal</th>
                            <th className="px-2 py-2 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredSalaryLines.length === 0 ? (
                            <tr>
                              <td
                                colSpan={lineStatusTab === "pending" ? 8 : 7}
                                className="px-3 py-8 text-center text-muted-foreground"
                              >
                                {lineStatusTab === "pending"
                                  ? "No pending lines, or nothing matches your search and filters."
                                  : lineStatusTab === "approved"
                                    ? "No approved lines, or nothing matches your search and filters."
                                    : "No rejected lines, or nothing matches your search and filters."}
                              </td>
                            </tr>
                          ) : (
                            filteredSalaryLines.map((row) => {
                              const ap = lineApprovalStatus(row.meta)
                              return (
                                <tr key={row.id} className="border-t">
                                  {lineStatusTab === "pending" ? (
                                    <td className="px-2 py-2">
                                      <Checkbox
                                        checked={lineSelectedIds.has(row.id)}
                                        onCheckedChange={(c) => {
                                          setLineSelectedIds((prev) => {
                                            const n = new Set(prev)
                                            if (c === true) n.add(row.id)
                                            else n.delete(row.id)
                                            return n
                                          })
                                        }}
                                      />
                                    </td>
                                  ) : null}
                                  <td className="px-2 py-2">{row.employeeLabel}</td>
                                  <td className="px-2 py-2 text-muted-foreground">{row.team || "—"}</td>
                                  <td className="px-2 py-2">
                                    <Badge variant="outline" className="capitalize">
                                      {row.lineKind}
                                    </Badge>
                                  </td>
                                  <td className="px-2 py-2 text-muted-foreground">
                                    {row.lineKind !== "allowance"
                                      ? "—"
                                      : row.meta?.allowanceType === "conditional"
                                        ? "Conditional"
                                        : "Fixed"}
                                  </td>
                                  <td className="px-2 py-2 font-medium">{row.label}</td>
                                  <td className="px-2 py-2 text-right tabular-nums">
                                    {fmtRm(row.amount)}
                                  </td>
                                  <td className="px-2 py-2 text-right">
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8">
                                          <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => openLineEdit(row)}>
                                          <Pencil className="h-4 w-4 mr-2" /> Edit
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          disabled={ap !== "pending"}
                                          onClick={() => void patchLineApproval(row.id, "approved")}
                                        >
                                          <Check className="h-4 w-4 mr-2" /> Approve
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          disabled={ap !== "pending"}
                                          onClick={() => void patchLineApproval(row.id, "rejected")}
                                        >
                                          <XCircle className="h-4 w-4 mr-2" /> Reject
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          className="text-destructive"
                                          onClick={() => void deleteLine(row.id)}
                                        >
                                          <Trash2 className="h-4 w-4 mr-2" /> Delete
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </td>
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Salary settings</DialogTitle>
              <DialogDescription>
                Pay dates in the month (Malaysia). Defaults below apply to flexible payroll unless overridden per
                allowance line.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {payDays.map((d, idx) => (
                <div key={`day-${idx}`} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Label className="w-24 shrink-0 text-xs text-muted-foreground">Pay day</Label>
                    <Select value={String(d)} onValueChange={(v) => setPayDayAt(idx, v)}>
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {dayChoices.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="text-muted-foreground hover:text-foreground">
                          <HelpCircle className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        If the month has fewer days, pay on the last day of that month.
                      </TooltipContent>
                    </Tooltip>
                    {payDays.length > 1 ? (
                      <Button type="button" variant="ghost" size="icon" onClick={() => removePayDayAt(idx)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                  {d === 31 ? (
                    <p className="text-xs text-red-600 pl-[5.5rem]">
                      Short months pay on the last day (e.g. Feb 28/29).
                    </p>
                  ) : null}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addPayDayRow}>
                <Plus className="h-4 w-4 mr-1" />
                Add pay day
              </Button>

              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-sm font-medium">Flexible payroll defaults</p>
                <div className="grid gap-2">
                  <Label className="text-xs">Late deduction mode</Label>
                  <RadioGroup
                    value={payrollDefaultsDraft.lateMode || "hourly"}
                    onValueChange={(v) =>
                      setPayrollDefaultsDraft((d) => ({
                        ...d,
                        lateMode: v as PayrollDefaultsJson["lateMode"],
                      }))
                    }
                    className="grid gap-3"
                  >
                    <div className="flex items-start gap-2">
                      <RadioGroupItem value="hourly" id="late-hourly" className="mt-1 shrink-0" />
                      <Label htmlFor="late-hourly" className="cursor-pointer text-sm font-normal leading-snug">
                        <span className="font-medium">Hourly</span> — deduct hourly rate × (late minutes ÷ 60).
                        Uses <em className="not-italic text-muted-foreground">Working days</em> &amp;{" "}
                        <em className="not-italic text-muted-foreground">Hours / day</em> below.
                      </Label>
                    </div>
                    <div className="flex items-start gap-2">
                      <RadioGroupItem value="fixed" id="late-fixed" className="mt-1 shrink-0" />
                      <Label htmlFor="late-fixed" className="cursor-pointer text-sm font-normal leading-snug">
                        <span className="font-medium">Fixed</span> — deduct{" "}
                        <em className="not-italic text-muted-foreground">fixed amount × late count</em> (set
                        below).
                      </Label>
                    </div>
                    <div className="flex items-start gap-2">
                      <RadioGroupItem value="half_day" id="late-half" className="mt-1 shrink-0" />
                      <Label htmlFor="late-half" className="cursor-pointer text-sm font-normal leading-snug">
                        <span className="font-medium">Half day</span> — if late minutes over threshold, deduct{" "}
                        <em className="not-italic text-muted-foreground">½ day&apos;s pay</em> (daily rate from
                        working days below).
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                {(payrollDefaultsDraft.lateMode || "hourly") === "fixed" ? (
                  <div className="grid gap-1 rounded-lg border border-border bg-muted/20 p-3">
                    <Label className="text-xs">Fixed late amount (RM per late count)</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      className="max-w-[12rem]"
                      value={String(payrollDefaultsDraft.fixedLateAmount ?? 0)}
                      onChange={(e) =>
                        setPayrollDefaultsDraft((d) => ({
                          ...d,
                          fixedLateAmount: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                    />
                  </div>
                ) : null}

                {(payrollDefaultsDraft.lateMode || "hourly") === "half_day" ? (
                  <div className="grid gap-1 rounded-lg border border-border bg-muted/20 p-3">
                    <Label className="text-xs">Half-day late over (minutes)</Label>
                    <Input
                      type="number"
                      min={0}
                      className="max-w-[12rem]"
                      value={String(payrollDefaultsDraft.halfDayLateMinutesThreshold ?? 60)}
                      onChange={(e) =>
                        setPayrollDefaultsDraft((d) => ({
                          ...d,
                          halfDayLateMinutesThreshold: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Late minutes above this use a half-day deduction (from daily rate).
                    </p>
                  </div>
                ) : null}

                {(payrollDefaultsDraft.lateMode || "hourly") === "hourly" ? (
                  <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border px-3 py-2">
                    Hourly late rate = base salary ÷ working days ÷ hours per day. Enter those under{" "}
                    <span className="font-medium">Rates</span> below.
                  </p>
                ) : null}

                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Rates (working month)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1">
                      <Label className="text-xs">Working days / month</Label>
                      <Input
                        type="number"
                        min={1}
                        value={String(payrollDefaultsDraft.workingDaysPerMonth ?? 26)}
                        onChange={(e) =>
                          setPayrollDefaultsDraft((d) => ({
                            ...d,
                            workingDaysPerMonth: Math.max(1, Number(e.target.value) || 26),
                          }))
                        }
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs">Hours / day</Label>
                      <Input
                        type="number"
                        min={1}
                        value={String(payrollDefaultsDraft.hoursPerDay ?? 8)}
                        onChange={(e) =>
                          setPayrollDefaultsDraft((d) => ({
                            ...d,
                            hoursPerDay: Math.max(1, Number(e.target.value) || 8),
                          }))
                        }
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug">
                    Used for hourly late deduction, daily rate (unpaid leave &amp; half-day late), and
                    conditional allowance math — not only late mode.
                  </p>
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs">Default conditional allowance rule</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground rounded-full"
                          aria-label="About default conditional allowance"
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                        Only applies to allowance lines you add as <strong>Conditional</strong>, not Fixed.
                        <span className="block mt-2">
                          <strong>Attendance-style:</strong> if unpaid leave → allowance 0; if late → 50%;
                          otherwise full.
                        </span>
                        <span className="block mt-2">
                          <strong>No automatic reduction:</strong> conditional lines stay full unless you change
                          them elsewhere.
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Select
                    value={payrollDefaultsDraft.defaultConditionalPolicy || "attendance_style"}
                    onValueChange={(v) =>
                      setPayrollDefaultsDraft((d) => ({
                        ...d,
                        defaultConditionalPolicy: v as PayrollDefaultsJson["defaultConditionalPolicy"],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="attendance_style">
                        Attendance-style (unpaid → 0; late → 50%)
                      </SelectItem>
                      <SelectItem value="none">No automatic reduction</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  Business timezone for payroll JSON: {payrollDefaultsDraft.businessTimeZone || "Asia/Kuala_Lumpur"}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={settingsSaving} onClick={() => void saveSettings()}>
                {settingsSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={addOpen}
          onOpenChange={(o) => {
            setAddOpen(o)
            if (!o && !skipResetOnAddCloseRef.current) resetAddWizard()
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add salary record</DialogTitle>
              <DialogDescription>Period {period}. Choose employment type, staff, and base pay.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-2">
                <Label>Employment</Label>
                <Select
                  value={addEmployment}
                  onValueChange={(v) => setAddEmployment(v as "full_time" | "part_time")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_time">Full time</SelectItem>
                    <SelectItem value="part_time">Part time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Staff</Label>
                <Popover open={addStaffComboOpen} onOpenChange={setAddStaffComboOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={addStaffComboOpen}
                      className="justify-between font-normal"
                      disabled={addContactsLoading}
                    >
                      {addSelectedContact
                        ? salaryContactPickerLabel(addSelectedContact)
                        : addContactsLoading
                          ? "Loading contacts…"
                          : "Search and select staff…"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search name or email…" />
                      <CommandList>
                        <CommandEmpty>No staff found.</CommandEmpty>
                        <CommandGroup>
                          {addContacts.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={`${salaryContactPickerLabel(c)} ${c.name} ${c.legalName ?? ""} ${c.email ?? ""}`}
                              onSelect={() => {
                                setAddContactId(c.id)
                                setAddStaffComboOpen(false)
                                if (Number(c.salaryBasic) > 0) setAddBase(String(c.salaryBasic))
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  addContactId === c.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <span className="truncate">{salaryContactPickerLabel(c)}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="grid gap-2">
                <Label>Base salary (RM)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={addBase}
                  onChange={(e) => setAddBase(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Statutory (apply on save)</p>
                  {addStatutoryLocked ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex text-muted-foreground cursor-help rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="Statutory toggles info"
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        Toggles follow the selected staff profile in Operator → Contact. Change them there.
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  <label
                    className={`flex items-center gap-2 text-sm ${addStatutoryLocked ? "cursor-not-allowed opacity-80" : ""}`}
                  >
                    <Checkbox
                      checked={addChkMtd}
                      disabled={addStatutoryLocked}
                      onCheckedChange={(c) => setAddChkMtd(c === true)}
                    />
                    MTD (PCB)
                  </label>
                  <label
                    className={`flex items-center gap-2 text-sm ${addStatutoryLocked ? "cursor-not-allowed opacity-80" : ""}`}
                  >
                    <Checkbox
                      checked={addChkEpf}
                      disabled={addStatutoryLocked}
                      onCheckedChange={(c) => setAddChkEpf(c === true)}
                    />
                    EPF
                  </label>
                  <label
                    className={`flex items-center gap-2 text-sm ${addStatutoryLocked ? "cursor-not-allowed opacity-80" : ""}`}
                  >
                    <Checkbox
                      checked={addChkSocso}
                      disabled={addStatutoryLocked}
                      onCheckedChange={(c) => setAddChkSocso(c === true)}
                    />
                    SOCSO
                  </label>
                  <label
                    className={`flex items-center gap-2 text-sm ${addStatutoryLocked ? "cursor-not-allowed opacity-80" : ""}`}
                  >
                    <Checkbox
                      checked={addChkEis}
                      disabled={addStatutoryLocked}
                      onCheckedChange={(c) => setAddChkEis(c === true)}
                    />
                    EIS
                  </label>
                </div>
                {addChkMtd ? (
                  <p className="text-xs text-amber-700 dark:text-amber-200">
                    MTD amount is not auto-estimated. You can enter it after the record is created (Edit).
                  </p>
                ) : null}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button disabled={addPreviewBusy} onClick={() => void handleAddNext()}>
                {addPreviewBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Next
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={addSummaryOpen}
          onOpenChange={(o) => {
            setAddSummaryOpen(o)
            if (!o && !backFromSummaryRef.current) resetAddWizard()
            if (!o) queueMicrotask(() => { backFromSummaryRef.current = false })
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Confirm new record</DialogTitle>
              <DialogDescription>Review the summary before creating the salary row.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Staff</span>
                <span className="font-medium text-right text-balance max-w-[70%]">
                  {addSelectedContact ? salaryContactPickerLabel(addSelectedContact) : "—"}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Employment</span>
                <span>{addEmployment === "full_time" ? "Full time" : "Part time"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Base salary</span>
                <span className="tabular-nums">{fmtRm(Math.max(0, Number(addBase || 0)))}</span>
              </div>
              {addFlexPreview ? (
                <>
                  <div className="flex justify-between gap-2 border-t border-border pt-2">
                    <span className="text-muted-foreground">Flexible payroll net (before statutory)</span>
                    <span className="tabular-nums font-medium">{fmtRm(addFlexPreview.netSalary)}</span>
                  </div>
                  <ul className="text-xs text-muted-foreground space-y-0.5 pl-1">
                    {addFlexPreview.breakdown.late.amount > 0 ? (
                      <li>Late: {fmtRm(addFlexPreview.breakdown.late.amount)}</li>
                    ) : null}
                    {addFlexPreview.breakdown.unpaidLeave.amount > 0 ? (
                      <li>Unpaid leave: {fmtRm(addFlexPreview.breakdown.unpaidLeave.amount)}</li>
                    ) : null}
                    {addFlexPreview.breakdown.allowances.map((a) => (
                      <li key={a.name}>
                        Allowance {a.name}: {fmtRm(a.effectiveAmount)}
                      </li>
                    ))}
                    {addFlexPreview.breakdown.otherDeductions.map((d) => (
                      <li key={d.name}>
                        Deduction {d.name}: {fmtRm(d.amount)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <div className="flex justify-between gap-2 border-t border-border pt-2">
                <span className="text-muted-foreground">Estimated take-home</span>
                <span className="tabular-nums font-semibold">{fmtRm(addSummaryTakeHome)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                EPF / SOCSO / EIS amounts use the same in-house illustration as the edit screen. Add late
                minutes, unpaid leave, and extra lines under Allowances &amp; deductions after saving.
              </p>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  backFromSummaryRef.current = true
                  setAddSummaryOpen(false)
                  setAddOpen(true)
                  queueMicrotask(() => {
                    backFromSummaryRef.current = false
                  })
                }}
              >
                Back
              </Button>
              <Button type="button" onClick={() => void confirmAddRecord()}>
                Confirm &amp; submit
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit salary</DialogTitle>
              <DialogDescription className="text-xs leading-snug">{STATUTORY_AMOUNT_DISCLAIMER}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-6 py-2 md:grid-cols-2 md:gap-6">
              <div className="space-y-4 min-w-0 md:min-h-0 text-left">
                <div className="grid gap-2">
                  <Label className="text-left">Staff</Label>
                  <Input value={editName} readOnly disabled className="bg-muted/60 text-left" />
                </div>
                <div className="grid gap-2">
                  <Label className="text-left">Team</Label>
                  <Input value={editTeam} readOnly disabled className="bg-muted/60 text-left" />
                </div>
                <div className="grid gap-2">
                  <Label className="text-left">Base salary</Label>
                  <Input
                    type="number"
                    min={0}
                    value={editBase}
                    readOnly
                    disabled
                    className="bg-muted/60 text-left"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-start gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={editStatutoryLocked}
                    onClick={() => applyRoughIllustrative()}
                  >
                    Fill illustrative EPF / SOCSO / EIS
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-muted-foreground cursor-help text-xs">?</span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      Fills employee statutory amounts for save; employer stays illustrative in Summary.
                    </TooltipContent>
                  </Tooltip>
                </div>

                <div className="rounded-xl border border-border p-4 space-y-4 text-left">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-medium text-left">Statutory</p>
                    {editStatutoryLocked ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex text-muted-foreground cursor-help rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label="Statutory toggles info"
                          >
                            <HelpCircle className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          EPF / SOCSO / EIS / MTD toggles follow the staff profile in Operator → Contact. Change them
                          there.
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground text-left">Tick what applies. Amounts appear in Summary →</p>

                  <div className="space-y-3">
                    <label
                      className={`flex items-center gap-2 text-sm ${editStatutoryLocked ? "cursor-not-allowed opacity-80" : "cursor-pointer"}`}
                    >
                      <Checkbox
                        id="st-mtd"
                        checked={chkMtd}
                        disabled={editStatutoryLocked}
                        onCheckedChange={(c) => setChkMtd(c === true)}
                      />
                      <span>MTD (PCB)</span>
                    </label>
                    {chkMtd ? (
                      <div className="pl-6 space-y-1">
                        <Label className="text-xs text-muted-foreground">Amount (PCB)</Label>
                        <Input
                          className="tabular-nums h-9 max-w-[11rem]"
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="0"
                          value={amtMtd}
                          onChange={(e) => setAmtMtd(e.target.value)}
                        />
                      </div>
                    ) : null}
                  </div>

                  <label
                    className={`flex items-center gap-2 text-sm ${editStatutoryLocked ? "cursor-not-allowed opacity-80" : "cursor-pointer"}`}
                  >
                    <Checkbox
                      id="st-epf"
                      checked={chkEpf}
                      disabled={editStatutoryLocked}
                      onCheckedChange={(c) => setChkEpf(c === true)}
                    />
                    <span>EPF</span>
                  </label>

                  <label
                    className={`flex items-center gap-2 text-sm ${editStatutoryLocked ? "cursor-not-allowed opacity-80" : "cursor-pointer"}`}
                  >
                    <Checkbox
                      id="st-socso"
                      checked={chkSocso}
                      disabled={editStatutoryLocked}
                      onCheckedChange={(c) => setChkSocso(c === true)}
                    />
                    <span>SOCSO</span>
                  </label>

                  <label
                    className={`flex items-center gap-2 text-sm ${editStatutoryLocked ? "cursor-not-allowed opacity-80" : "cursor-pointer"}`}
                  >
                    <Checkbox
                      id="st-eis"
                      checked={chkEis}
                      disabled={editStatutoryLocked}
                      onCheckedChange={(c) => setChkEis(c === true)}
                    />
                    <span>EIS</span>
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4 min-w-0 text-left">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-left">Summary</p>
                  {payrollPreviewBusy ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
                </div>

                {!payrollPreview && !payrollPreviewBusy ? (
                  <p className="text-sm text-muted-foreground">No payroll preview. Check period and allowances.</p>
                ) : null}

                {payrollPreview ? (
                  <>
                    <div className="space-y-2 text-sm">
                      <div className="flex w-full items-baseline justify-between gap-3">
                        <span className="min-w-0 flex-1 text-left text-muted-foreground">Base salary</span>
                        <span className="shrink-0 text-right tabular-nums font-medium">
                          {fmtRm(payrollPreview.breakdown.basicSalary)}
                        </span>
                      </div>
                      <div className="flex w-full items-baseline justify-between gap-3">
                        <span className="min-w-0 flex-1 text-left text-muted-foreground">Total allowance</span>
                        <span className="shrink-0 text-right tabular-nums font-medium">
                          {fmtRm(
                            payrollPreview.breakdown.allowances.reduce((s, a) => s + a.effectiveAmount, 0)
                          )}
                        </span>
                      </div>
                      <div className="flex w-full items-baseline justify-between gap-3">
                        <span className="min-w-0 flex-1 text-left text-muted-foreground">Total deduction</span>
                        <span className="shrink-0 text-right tabular-nums font-medium">
                          {fmtRm(payrollPreview.totalDeductions)}
                        </span>
                      </div>
                      <div className="flex w-full items-baseline justify-between gap-3 border-t border-border pt-2">
                        <span className="min-w-0 flex-1 text-left font-medium">Gross salary</span>
                        <span className="shrink-0 text-right tabular-nums font-semibold">
                          {fmtRm(payrollPreview.grossSalary)}
                        </span>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground space-y-1 border-t border-border pt-3">
                      <p className="font-medium text-foreground">Line detail</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {payrollPreview.breakdown.late.amount > 0 ? (
                          <li>
                            Late ({payrollPreview.breakdown.late.mode}):{" "}
                            {fmtRm(payrollPreview.breakdown.late.amount)}
                          </li>
                        ) : null}
                        {payrollPreview.breakdown.unpaidLeave.amount > 0 ? (
                          <li>Unpaid leave: {fmtRm(payrollPreview.breakdown.unpaidLeave.amount)}</li>
                        ) : null}
                        {payrollPreview.breakdown.allowances.map((a) => (
                          <li key={a.name}>
                            Allowance {a.name}: {fmtRm(a.effectiveAmount)}
                          </li>
                        ))}
                        {payrollPreview.breakdown.otherDeductions.map((d) => (
                          <li key={d.name}>
                            Deduction {d.name}: {fmtRm(d.amount)}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-2 text-sm border-t border-border pt-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Statutory
                      </p>
                      {chkMtd ? (
                        <div className="flex w-full items-baseline justify-between gap-3">
                          <span className="min-w-0 flex-1 text-left text-muted-foreground">MTD (PCB)</span>
                          <span className="shrink-0 text-right tabular-nums">
                            {fmtRm(Math.max(0, Number(amtMtd || 0) || 0))}
                          </span>
                        </div>
                      ) : null}
                      {chkEpf ? (
                        <>
                          <div className="flex w-full items-baseline justify-between gap-3">
                            <span className="min-w-0 flex-1 text-left text-muted-foreground">EPF (employee)</span>
                            <span className="shrink-0 text-right tabular-nums">
                              {fmtRm(
                                amtEpf.trim() !== ""
                                  ? Number(amtEpf) || 0
                                  : roughIllustrativeAmounts(editBaseNum).epfAmount
                              )}
                            </span>
                          </div>
                          <div className="flex w-full items-baseline justify-between gap-3">
                            <span className="min-w-0 flex-1 text-left text-muted-foreground">
                              EPF (employer, illustrative)
                            </span>
                            <span className="shrink-0 text-right tabular-nums">{fmtRm(editEpfEmployerDisplay)}</span>
                          </div>
                        </>
                      ) : null}
                      {chkSocso ? (
                        <>
                          <div className="flex w-full items-baseline justify-between gap-3">
                            <span className="min-w-0 flex-1 text-left text-muted-foreground">SOCSO (employee)</span>
                            <span className="shrink-0 text-right tabular-nums">
                              {fmtRm(
                                amtSocso.trim() !== ""
                                  ? Number(amtSocso) || 0
                                  : editStatutorySocso.employee
                              )}
                            </span>
                          </div>
                          <div className="flex w-full items-baseline justify-between gap-3">
                            <span className="min-w-0 flex-1 text-left text-muted-foreground">
                              SOCSO (employer, illustrative)
                            </span>
                            <span className="shrink-0 text-right tabular-nums">
                              {fmtRm(editStatutorySocso.employer)}
                            </span>
                          </div>
                        </>
                      ) : null}
                      {chkEis ? (
                        <>
                          <div className="flex w-full items-baseline justify-between gap-3">
                            <span className="min-w-0 flex-1 text-left text-muted-foreground">EIS (employee)</span>
                            <span className="shrink-0 text-right tabular-nums">
                              {fmtRm(
                                amtEis.trim() !== ""
                                  ? Number(amtEis) || 0
                                  : roughIllustrativeAmounts(editBaseNum).eisAmount
                              )}
                            </span>
                          </div>
                          <div className="flex w-full items-baseline justify-between gap-3">
                            <span className="min-w-0 flex-1 text-left text-muted-foreground">
                              EIS (employer, illustrative)
                            </span>
                            <span className="shrink-0 text-right tabular-nums">{fmtRm(editStatutoryEis.employer)}</span>
                          </div>
                        </>
                      ) : null}
                    </div>

                    <div className="border-t border-border pt-4 mt-2 space-y-3">
                      <div className="flex w-full items-baseline justify-between gap-3">
                        <span className="min-w-0 flex-1 text-left text-base font-semibold">Net salary</span>
                        <span className="shrink-0 text-right text-lg font-bold tabular-nums text-primary">
                          {payrollPreviewBusy
                            ? "…"
                            : payrollPreview
                              ? fmtRm(editComputedTakeHome)
                              : fmtRm(Number(editNet || 0))}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Amount to pay the staff (bank transfer): flexible payroll net minus employee MTD (if
                        on), EPF, SOCSO, and EIS. Employer contributions are shown below separately—not
                        deducted from this net.
                      </p>
                      <div className="rounded-lg border border-border bg-background/80 p-3 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          Employer extra pay (illustrative)
                        </p>
                        {chkEpf ? (
                          <div className="flex w-full items-baseline justify-between gap-3 text-sm">
                            <span className="min-w-0 flex-1 text-left text-muted-foreground">EPF (employer)</span>
                            <span className="shrink-0 text-right tabular-nums">{fmtRm(editEpfEmployerDisplay)}</span>
                          </div>
                        ) : null}
                        {chkSocso ? (
                          <div className="flex w-full items-baseline justify-between gap-3 text-sm">
                            <span className="min-w-0 flex-1 text-left text-muted-foreground">SOCSO (employer)</span>
                            <span className="shrink-0 text-right tabular-nums">
                              {fmtRm(editStatutorySocso.employer)}
                            </span>
                          </div>
                        ) : null}
                        {chkEis ? (
                          <div className="flex w-full items-baseline justify-between gap-3 text-sm">
                            <span className="min-w-0 flex-1 text-left text-muted-foreground">EIS (employer)</span>
                            <span className="shrink-0 text-right tabular-nums">{fmtRm(editStatutoryEis.employer)}</span>
                          </div>
                        ) : null}
                        {!chkEpf && !chkSocso && !chkEis ? (
                          <p className="text-xs text-muted-foreground">Tick EPF / SOCSO / EIS on the left to include.</p>
                        ) : null}
                        <div className="flex w-full items-baseline justify-between gap-3 border-t border-border pt-2 text-sm font-semibold">
                          <span className="min-w-0 flex-1 text-left">Total</span>
                          <span className="shrink-0 text-right tabular-nums">{fmtRm(editEmployerExtraPayTotal)}</span>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={editSaving || payrollPreviewBusy}
                onClick={() => void saveEdit()}
              >
                {editSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={lineOpen} onOpenChange={setLineOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{lineKind === "allowance" ? "Allowance" : "Deduction"}</DialogTitle>
              <DialogDescription>Attach to a salary record for {period}.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-2">
                <Label>Record</Label>
                <Select value={lineRecordId} onValueChange={setLineRecordId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose staff" />
                  </SelectTrigger>
                  <SelectContent>
                    {records.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {salaryRecordPickerLabel(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Label</Label>
                <Input value={lineLabel} onChange={(e) => setLineLabel(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Amount (RM)</Label>
                <Input type="number" min={0} value={lineAmount} onChange={(e) => setLineAmount(e.target.value)} />
              </div>
              {lineKind === "allowance" ? (
                <>
                  <div className="grid gap-2">
                    <div className="flex items-center gap-1.5">
                      <Label>Allowance type</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground rounded-full"
                            aria-label="About allowance type"
                          >
                            <HelpCircle className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                          <strong>Fixed:</strong> pays the full amount you enter — not reduced by attendance rules.
                          <span className="block mt-2">
                            <strong>Conditional:</strong> the amount can be reduced (e.g. unpaid leave, late) using
                            the default rule or the per-line rule below.
                          </span>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Select
                      value={lineAllowanceType}
                      onValueChange={(v) => setLineAllowanceType(v as "fixed" | "conditional")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">Fixed (always full)</SelectItem>
                        <SelectItem value="conditional">Conditional</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {lineAllowanceType === "conditional" ? (
                    <div className="grid gap-2">
                      <Label>Conditional rule</Label>
                      <Select
                        value={lineConditionalPolicy}
                        onValueChange={(v) => setLineConditionalPolicy(v as "attendance_style" | "none")}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="attendance_style">
                            Attendance-style (unpaid → 0; late → 50%)
                          </SelectItem>
                          <SelectItem value="none">No reduction</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setLineOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submitLine()}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={lineEditOpen} onOpenChange={setLineEditOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit {lineEditKind === "allowance" ? "allowance" : "deduction"}</DialogTitle>
              <DialogDescription>
                {((): string => {
                  const rec = records.find((x) => x.id === lineEditRecordId)
                  return rec ? salaryRecordPickerLabel(rec) : "Staff"
                })()}{" "}
                · {period}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-2">
                <Label>Label</Label>
                <Input value={lineEditLabel} onChange={(e) => setLineEditLabel(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Amount (RM)</Label>
                <Input
                  type="number"
                  min={0}
                  value={lineEditAmount}
                  onChange={(e) => setLineEditAmount(e.target.value)}
                />
              </div>
              {lineEditKind === "allowance" ? (
                <>
                  <div className="grid gap-2">
                    <div className="flex items-center gap-1.5">
                      <Label>Allowance type</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground rounded-full"
                            aria-label="About allowance type"
                          >
                            <HelpCircle className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                          <strong>Fixed:</strong> pays the full amount you enter — not reduced by attendance rules.
                          <span className="block mt-2">
                            <strong>Conditional:</strong> the amount can be reduced (e.g. unpaid leave, late) using
                            the default rule or the per-line rule below.
                          </span>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Select
                      value={lineEditAllowanceType}
                      onValueChange={(v) => setLineEditAllowanceType(v as "fixed" | "conditional")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">Fixed (always full)</SelectItem>
                        <SelectItem value="conditional">Conditional</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {lineEditAllowanceType === "conditional" ? (
                    <div className="grid gap-2">
                      <Label>Conditional rule</Label>
                      <Select
                        value={lineEditConditionalPolicy}
                        onValueChange={(v) => setLineEditConditionalPolicy(v as "attendance_style" | "none")}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="attendance_style">
                            Attendance-style (unpaid → 0; late → 50%)
                          </SelectItem>
                          <SelectItem value="none">No reduction</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </>
              ) : null}

              <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
                <p className="font-medium">How this amount is calculated</p>
                {lineEditPreviewBusy ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading payroll preview…
                  </div>
                ) : null}
                {(() => {
                  const row = lines.find((l) => l.id === lineEditId)
                  const ap = row ? lineApprovalStatus(row.meta) : "pending"
                  if (ap === "pending") {
                    return (
                      <p className="text-xs text-amber-800 dark:text-amber-200">
                        This line is <strong>pending</strong> — it is not included in payroll until you approve it.
                        Nominal entry: {fmtRm(Number(lineEditAmount || 0) || 0)}.
                      </p>
                    )
                  }
                  if (ap === "rejected") {
                    return (
                      <p className="text-xs text-muted-foreground">
                        Rejected lines are excluded from payroll and do not change gross pay.
                      </p>
                    )
                  }
                  if (!lineEditPreview) {
                    return <p className="text-xs text-muted-foreground">No preview available.</p>
                  }
                  const labelKey = lineEditLabel.trim()
                  if (lineEditKind === "allowance") {
                    const b = lineEditPreview.breakdown.allowances.find((a) => a.name === labelKey)
                    if (!b) {
                      return (
                        <p className="text-xs text-muted-foreground">
                          No matching allowance in the current preview (check label matches exactly).
                        </p>
                      )
                    }
                    return (
                      <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
                        <li>Nominal amount: {fmtRm(b.nominalAmount)}</li>
                        <li>
                          Type: {b.allowanceType === "conditional" ? "Conditional" : "Fixed"}
                          {b.allowanceType === "conditional" && b.conditionalPolicy ? (
                            <span>
                              {" "}
                              · Rule:{" "}
                              {b.conditionalPolicy === "none"
                                ? "No automatic reduction"
                                : "Attendance-style (unpaid leave → 0; late → 50%)"}
                            </span>
                          ) : null}
                        </li>
                        <li className="text-foreground font-medium list-none -ml-5 mt-2">
                          Counted in gross (effective): {fmtRm(b.effectiveAmount)}
                        </li>
                      </ul>
                    )
                  }
                  const d = lineEditPreview.breakdown.otherDeductions.find((x) => x.name === labelKey)
                  if (!d) {
                    return (
                      <p className="text-xs text-muted-foreground">
                        No matching deduction in the current preview (check label matches exactly).
                      </p>
                    )
                  }
                  return (
                    <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
                      <li>Other deduction (full amount reduces gross): {fmtRm(d.amount)}</li>
                    </ul>
                  )
                })()}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLineEditOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void saveLineEdit()}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={syncDialogOpen} onOpenChange={setSyncDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Sync to accounting</DialogTitle>
              <DialogDescription>
                Choose the journal entry date, then post accrual (Dr Salary &amp; Wages, Cr Salary Control) to
                Bukku or Xero, depending on your integration.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-2">
                <Label>Journal date</Label>
                <Input
                  type="date"
                  value={syncJournalDate}
                  onChange={(e) => setSyncJournalDate(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSyncDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={syncBusy} onClick={() => void confirmSyncAccounting()}>
                {syncBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Post journal
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={paidOpen} onOpenChange={setPaidOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Mark as paid</DialogTitle>
              <DialogDescription>
                {accountingConnected === false ? (
                  <>
                    Record payment date, method, and amount in the portal (no Bukku/Xero posting). Default is the
                    remaining net — change for advance pay; the next run pre-fills the balance.
                  </>
                ) : (
                  <>
                    After month-end accrual (journal), each run posts Money Out (Bukku) or bank spend (Xero) for the
                    amount below. Default is the remaining net — change it for advance pay; the next run pre-fills the
                    balance.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-2">
                <Label>Date</Label>
                <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Method</Label>
                <Select value={paidMethod} onValueChange={(v) => setPaidMethod(v as PaymentMethod)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentMethodOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-3 border-t pt-3">
                <Label className="text-foreground">Amount to release (this payment)</Label>
                {Object.keys(paidReleaseById).map((rid) => {
                  const rec = records.find((x) => x.id === rid)
                  if (!rec) return null
                  const rel = payoutReleasedSoFar(rec)
                  const bal = netOutstandingForRecord(rec)
                  return (
                    <div key={rid} className="grid gap-2 rounded-xl border border-border bg-muted/30 p-3">
                      <p className="text-sm font-semibold">{rec.employeeLabel || "Employee"}</p>
                      <p className="text-xs text-muted-foreground">
                        Net {fmtRm(rec.netSalary)} · Released so far {fmtRm(rel)} · Balance before this run{" "}
                        {fmtRm(bal)}
                      </p>
                      <Input
                        inputMode="decimal"
                        value={paidReleaseById[rid] ?? ""}
                        onChange={(e) =>
                          setPaidReleaseById((prev) => ({ ...prev, [rid]: e.target.value }))
                        }
                        placeholder={String(bal)}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPaidOpen(false)}>
                Cancel
              </Button>
              <Button disabled={paidBusy} onClick={() => void confirmBulkPaid()}>
                {paidBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}
