"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { User, Building2, Truck, Plus, Edit2, Trash2, Search, ChevronDown, ChevronLeft, ChevronRight, Users, RefreshCcw, Eye, Star, MoreHorizontal } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { toast } from "@/hooks/use-toast"
import {
  getContactList,
  getOnboardStatus,
  getBanks,
  getSupplierDetail,
  updateOwnerAccount,
  updateTenantAccount,
  updateStaffAccount,
  updateContactPortalPhone,
  updateSupplier,
  createSupplier,
  createStaffContact,
  updateStaffContact,
  deleteOwnerOrCancel,
  deleteTenantOrCancel,
  deleteSupplierAccount,
  deleteStaffContact,
  submitOwnerApproval,
  submitTenantApproval,
  syncAllContacts,
  submitOwnerReview,
  getLatestOwnerReview,
  uploadFile,
  getOperatorClientId,
  getOwnerDetail,
  updateOwnerBank,
} from "@/lib/operator-api"

type AccountEntry = { provider?: string; clientId?: string; id?: string }
type BankOption = { value: string; label: string }

type ContactRole = "owner" | "tenant" | "supplier" | "staff"

type Contact = {
  id: string
  type: string
  name: string
  email?: string
  phone?: string
  idType?: string
  idNumber?: string
  bankName?: string
  bankAccount?: string
  bankHolder?: string
  billerCode?: string
  status?: string
  /** Entity id for API (ownerId / tenantId / supplierId). */
  entityId?: string
  /** Accounting account entries (provider, id) for the connected integration (Xero, SQL, AutoCount, etc.). */
  account?: AccountEntry[]
  /** Owner/Tenant pending approval (not yet mapped to client). */
  pending?: boolean
}

/** Same email/name → one row, multiple roles (owner/tenant/supplier/staff). */
type ContactGroup = {
  key: string
  displayName: string
  email?: string
  phone?: string
  members: Contact[]
  roles: ContactRole[]
}

function stripPendingLabel(name: string): string {
  return String(name || "").replace(/\s*\(Pending Approval\)\s*$/i, "").trim()
}

function staffDeleteBlockedReason(reason: string | undefined): string {
  if (reason === "STAFF_IN_USER_MANAGEMENT") {
    return "This email is in User management. Remove them under Company settings first, then you can remove the staff contact here."
  }
  return reason ?? "failed"
}

function memberType(m: Contact): string {
  return String(m.type || "").trim().toLowerCase()
}

function contactDedupeKey(c: Contact): string {
  const e = (c.email || "").trim().toLowerCase()
  if (e) return `e:${e}`
  const n = stripPendingLabel(c.name).toLowerCase()
  return `n:${n || c.id}`
}

function roleSortOrder(r: string): number {
  const order: Record<string, number> = { owner: 0, tenant: 1, supplier: 2, staff: 3 }
  return order[r] ?? 9
}

/** Owner/tenant row label in list = profile name (not Bukku legal name). */
function pickProfileDisplayName(members: Contact[]): string {
  const profile = members.filter((m) => {
    const t = memberType(m)
    return t === "owner" || t === "tenant"
  })
  if (!profile.length) return ""
  const names = profile.map((m) => stripPendingLabel(m.name)).filter((n) => n && n !== "—")
  if (!names.length) return ""
  return names.reduce((a, b) => (a.length >= b.length ? a : b))
}

/** Compare labels for "same display" (ignore case/extra spaces). */
function normLabel(s: string): string {
  return stripPendingLabel(s).replace(/\s+/g, " ").trim().toLowerCase()
}

/**
 * List row title:
 * - Same operator legal name & profile name → show once.
 * - Different (operator renamed in Contact) → `operatorName (profileName)`.
 * - Only profile or only supplier/staff → that name; else email / fallback.
 */
function pickGroupDisplayName(members: Contact[]): string {
  const profile = pickProfileDisplayName(members)
  const operatorName = pickLegalNameDefault(members)

  if (profile && operatorName) {
    if (normLabel(profile) === normLabel(operatorName)) return operatorName
    return `${operatorName} (${profile})`
  }
  if (profile) return profile
  if (operatorName) return operatorName

  const biz = members.filter((m) => {
    const t = memberType(m)
    return t === "supplier" || t === "staff"
  })
  const emails = new Set(members.map((m) => (m.email || "").trim().toLowerCase()).filter(Boolean))
  const stripped = biz.map((m) => stripPendingLabel(m.name)).filter(Boolean)
  const notBareEmail = stripped.filter((n) => !emails.has(n.trim().toLowerCase()))
  const pool = notBareEmail.length ? notBareEmail : stripped
  if (!pool.length) return members[0]?.email || "—"
  return pool.reduce((a, b) => (a.length >= b.length ? a : b))
}

/** Accounting legal name: supplier title and staff name; if both differ, prefer longer (usually operator-updated). */
function pickLegalNameDefault(members: Contact[]): string {
  const sup = members.find((m) => memberType(m) === "supplier")
  const st = members.find((m) => memberType(m) === "staff")
  const a = sup?.name ? stripPendingLabel(sup.name) : ""
  const b = st?.name ? stripPendingLabel(st.name) : ""
  if (!a && !b) return ""
  if (!a) return b
  if (!b) return a
  if (normLabel(a) === normLabel(b)) return a
  return a.length >= b.length ? a : b
}

/** NRIC / ID type from owner or tenant rows (same person may have multiple roles). */
function pickIdentityFromMembers(members: Contact[]): { idType?: string; idNumber?: string } {
  const idType = members.map((m) => m.idType).find((t) => t && String(t).trim())
  const idNumber = members.map((m) => m.idNumber).find((n) => n && String(n).trim())
  return {
    idType: idType != null ? String(idType) : undefined,
    idNumber: idNumber != null ? String(idNumber) : undefined,
  }
}

function buildContactGroups(contacts: Contact[]): ContactGroup[] {
  const map = new Map<string, Contact[]>()
  for (const c of contacts) {
    const k = contactDedupeKey(c)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(c)
  }
  const groups: ContactGroup[] = []
  for (const [key, members] of map) {
    const roles = [...new Set(members.map((m) => String(m.type || "").trim().toLowerCase()))].filter((t): t is ContactRole =>
      ["owner", "tenant", "supplier", "staff"].includes(t)
    )
    roles.sort((a, b) => roleSortOrder(a) - roleSortOrder(b))
    const primary = members[0]
    groups.push({
      key,
      displayName: pickGroupDisplayName(members),
      email: primary.email,
      phone: primary.phone,
      members,
      roles,
    })
  }
  return groups.sort((a, b) => a.displayName.localeCompare(b.displayName))
}

type EditRoleSelection = { owner: boolean; tenant: boolean; supplier: boolean; staff: boolean }

function groupHasRole(group: ContactGroup | null, role: ContactRole): boolean {
  if (!group?.roles?.length) return false
  return group.roles.some((r) => String(r).toLowerCase() === role)
}

function normId(s: unknown): string {
  return String(s ?? "").trim()
}

function normEmail(s: string | undefined | null): string {
  return String(s ?? "").trim().toLowerCase()
}

/** Merged contact row email matches operatordetail.email (master / company account). */
function isOperatorCompanyContact(group: ContactGroup, operatorCompanyEmail: string | null | undefined): boolean {
  const oe = normEmail(operatorCompanyEmail ?? "")
  const ge = normEmail(group.email)
  if (!oe || !ge) return false
  return ge === oe
}

/**
 * List items set `entityId` from `raw._id`; if missing, parse MySQL id from row id (`owner-<uuid>`, etc.).
 * Without this, unchecking a role and saving skipped the unlink API silently.
 */
function entityIdForContact(m: Contact | undefined): string {
  if (!m) return ""
  const e = normId(m.entityId)
  if (e) return e
  const t = memberType(m)
  const prefix =
    t === "owner" ? "owner-" : t === "tenant" ? "tenant-" : t === "supplier" ? "supplier-" : t === "staff" ? "staff-" : ""
  const id = String(m.id || "").trim()
  if (prefix && id.startsWith(prefix)) return id.slice(prefix.length)
  return ""
}

/** Accounting contact id for this operator (client): `account[]` entries are keyed by clientId + provider. */
function accountIdFromMember(m: Contact | undefined, providerNorm: string, operatorClientId: string | null): string {
  if (!m?.account?.length) return ""
  const list = m.account
  const op = normId(operatorClientId)
  let entry = list.find(
    (a) =>
      normId(a?.clientId) === op &&
      op !== "" &&
      String(a?.provider ?? "").toLowerCase() === providerNorm
  )
  if (!entry) {
    entry = list.find((a) => String(a?.provider ?? "").toLowerCase() === providerNorm && (!a?.clientId || normId(a.clientId) === op))
  }
  return entry?.id != null ? String(entry.id) : ""
}

/** One integration id per person for this company (same value applied to each role row on save). */
function sharedAccountIdForGroup(group: ContactGroup, providerNorm: string, operatorClientId: string | null): string {
  for (const m of group.members) {
    const id = accountIdFromMember(m, providerNorm, operatorClientId).trim()
    if (id !== "") return id
  }
  return ""
}

const CONTACT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200] as const

export default function ContactSettingPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterType, setFilterType] = useState<"all" | "owner" | "tenant" | "supplier" | "staff">("all")
  const [sortBy, setSortBy] = useState<"az" | "za">("az")
  const [activeTab, setActiveTab] = useState("all")
  const [accountingConnected, setAccountingConnected] = useState(false)
  const [accountingProvider, setAccountingProvider] = useState<string>("")
  /** operatordetail.email — hide “Remove from this client” for this merged row */
  const [operatorCompanyEmail, setOperatorCompanyEmail] = useState<string | null>(null)
  /** Single accounting contact id for this merged contact (same id for all roles). */
  const [editAccountId, setEditAccountId] = useState("")
  const [bankOptions, setBankOptions] = useState<BankOption[]>([])
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [addSaving, setAddSaving] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [showSyncDialog, setShowSyncDialog] = useState(false)
  const [syncDirection, setSyncDirection] = useState<"to-accounting" | "from-accounting">("to-accounting")
  const [syncingContacts, setSyncingContacts] = useState(false)
  const [showOwnerReviewDialog, setShowOwnerReviewDialog] = useState(false)
  const [ownerReviewTarget, setOwnerReviewTarget] = useState<Contact | null>(null)
  const [ownerReviewId, setOwnerReviewId] = useState<string | null>(null)
  const [ownerCommunicationScore, setOwnerCommunicationScore] = useState(8)
  const [ownerResponsibilityScore, setOwnerResponsibilityScore] = useState(8)
  const [ownerCooperationScore, setOwnerCooperationScore] = useState(8)
  const [ownerReviewComment, setOwnerReviewComment] = useState("")
  const [ownerReviewEvidence, setOwnerReviewEvidence] = useState<string[]>([])
  const [ownerReviewSubmitting, setOwnerReviewSubmitting] = useState(false)

  /** Client-side list pagination (merged contact rows). */
  const [listPage, setListPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof CONTACT_PAGE_SIZE_OPTIONS)[number]>(10)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [r, onboard] = await Promise.all([
        getContactList({ search: search || undefined, limit: 10000 }),
        getOnboardStatus().catch(() => ({ ok: false, accountingConnected: false, accountingProvider: "" })),
      ])
      const os = onboard as {
        accountingConnected?: boolean
        accountingProvider?: string
        operatorCompanyEmail?: string
      }
      setAccountingConnected(!!os?.accountingConnected)
      setAccountingProvider(String(os?.accountingProvider ?? "").toUpperCase() || "Accounting")
      if (typeof os?.operatorCompanyEmail === "string") {
        const t = os.operatorCompanyEmail.trim().toLowerCase()
        setOperatorCompanyEmail(t || null)
      }
      const items = (r?.items || []) as Array<Record<string, unknown>>
      setContacts(items.map((c) => {
        const raw = (c.raw || c) as Record<string, unknown>
        const account = Array.isArray(raw.account) ? (raw.account as AccountEntry[]) : []
        const entityId = raw._id != null ? String(raw._id) : ""
        const pending = !!(c as { __pending?: boolean }).__pending
        const nameBase = String(raw.ownerName ?? raw.ownername ?? raw.fullname ?? raw.title ?? "—").trim() || (raw.email ? String(raw.email) : "—")
        const idTypeRaw = raw.idType != null ? String(raw.idType).trim() : ""
        const nricRaw = raw.nric != null ? String(raw.nric).trim() : ""
        return {
          id: String(c._id ?? c.id ?? ""),
          type: String(c.type ?? "").trim().toLowerCase(),
          name: nameBase + (pending ? " (Pending Approval)" : ""),
          email: raw.email ? String(raw.email) : undefined,
          phone: raw.phone ? String(raw.phone) : undefined,
          idType: idTypeRaw || undefined,
          idNumber: nricRaw || undefined,
          bankName: raw.bankName != null ? String(raw.bankName) : undefined,
          bankAccount: raw.bankAccount ? String(raw.bankAccount) : undefined,
          bankHolder: raw.bankHolder ? String(raw.bankHolder) : undefined,
          billerCode: raw.billerCode ? String(raw.billerCode) : undefined,
          status: "active",
          entityId,
          account,
          pending,
        }
      }))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    setListPage(1)
  }, [search, activeTab, sortBy, pageSize])

  useEffect(() => {
    getBanks().then((res) => {
      const list = (res?.items || []) as Array<{ id?: string; bankname?: string; value?: string; label?: string }>
      setBankOptions(list.map((b) => ({ value: b.id ?? b.value ?? "", label: b.bankname ?? b.label ?? b.id ?? "—" })).filter((o) => o.value))
    }).catch(() => setBankOptions([]))
  }, [])

  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  /** Bulk remove: same person, all roles from this client */
  const [selectedDeleteGroup, setSelectedDeleteGroup] = useState<ContactGroup | null>(null)
  /** Merged row (same email): edit dialog + role checkboxes */
  const [selectedEditGroup, setSelectedEditGroup] = useState<ContactGroup | null>(null)
  const [editRoleSelection, setEditRoleSelection] = useState<EditRoleSelection>({
    owner: true,
    tenant: true,
    supplier: true,
    staff: true,
  })
  const [newContactType, setNewContactType] = useState<"owner" | "tenant" | "supplier" | "staff">("supplier")

  // Form state (add / edit)
  const [formData, setFormData] = useState({
    name: "",
    /** Accounting / Bukku legal name — supplier + staff only; not owner/tenant profile. */
    legalName: "",
    email: "",
    phone: "",
    idType: "NRIC",
    idNumber: "",
    bankName: "",
    bankAccount: "",
    bankHolder: "",
    billerCode: "",
    productid: "",
    ownerBankName: "",
    ownerBankAccount: "",
    ownerBankHolder: "",
  })
  const [supplierPaymentMode, setSupplierPaymentMode] = useState<"jompay" | "bank">("bank")
  /** Read-only: owner/tenant profile name shown on list (not legal name). */
  const [profileNameReadonly, setProfileNameReadonly] = useState("")

  const contactGroups = useMemo(() => buildContactGroups(contacts), [contacts])

  const filteredGroups = useMemo(() => {
    return contactGroups
      .filter((g) => {
        if (activeTab !== "all" && !g.roles.includes(activeTab as ContactRole)) return false
        if (search) {
          const s = search.toLowerCase()
          const hit =
            g.displayName.toLowerCase().includes(s) ||
            (g.email?.toLowerCase().includes(s) ?? false) ||
            (g.phone?.includes(s) ?? false) ||
            g.members.some((m) => m.name.toLowerCase().includes(s) || (m.email?.toLowerCase().includes(s) ?? false))
          return hit
        }
        return true
      })
      .sort((a, b) => (sortBy === "az" ? a.displayName.localeCompare(b.displayName) : b.displayName.localeCompare(a.displayName)))
  }, [contactGroups, activeTab, search, sortBy])

  const totalFiltered = filteredGroups.length
  const totalListPages = Math.max(1, Math.ceil(totalFiltered / pageSize) || 1)
  const currentListPage = Math.min(Math.max(1, listPage), totalListPages)
  const listRangeStart = totalFiltered === 0 ? 0 : (currentListPage - 1) * pageSize + 1
  const listRangeEnd = Math.min(currentListPage * pageSize, totalFiltered)

  const paginatedGroups = useMemo(() => {
    const start = (currentListPage - 1) * pageSize
    return filteredGroups.slice(start, start + pageSize)
  }, [filteredGroups, currentListPage, pageSize])

  const counts = useMemo(
    () => ({
      all: contactGroups.length,
      owner: contactGroups.filter((g) => g.roles.includes("owner")).length,
      tenant: contactGroups.filter((g) => g.roles.includes("tenant")).length,
      supplier: contactGroups.filter((g) => g.roles.includes("supplier")).length,
      staff: contactGroups.filter((g) => g.roles.includes("staff")).length,
    }),
    [contactGroups]
  )

  const handleEditGroup = async (group: ContactGroup) => {
    setSelectedEditGroup(group)
    setProfileNameReadonly(pickProfileDisplayName(group.members))
    setSelectedContact(group.members[0])
    setEditRoleSelection({
      owner: groupHasRole(group, "owner"),
      tenant: groupHasRole(group, "tenant"),
      supplier: groupHasRole(group, "supplier"),
      staff: groupHasRole(group, "staff"),
    })
    const providerNorm = String(accountingProvider).toLowerCase()
    const operatorClientId = getOperatorClientId()
    setEditAccountId(sharedAccountIdForGroup(group, providerNorm, operatorClientId))
    const sup = group.members.find((m) => String(m.type || "").toLowerCase() === "supplier")
    const supId = sup ? entityIdForContact(sup) : ""
    if (supId) {
      try {
        const res = (await getSupplierDetail(supId)) as {
          ok?: boolean
          title?: string
          email?: string
          billerCode?: string
          bankName?: string
          bankAccount?: string
          bankHolder?: string
          account?: AccountEntry[]
        }
        const raw = res ?? {}
        const name = (raw.title ?? sup.name ?? "").trim()
        const email = (raw.email ?? sup.email ?? "").trim()
        const billerCode = (raw.billerCode ?? sup.billerCode ?? "").trim()
        const bankName = (raw.bankName ?? sup.bankName ?? "").trim()
        const bankAccount = (raw.bankAccount ?? sup.bankAccount ?? "").trim()
        const bankHolder = (raw.bankHolder ?? sup.bankHolder ?? "").trim()
        const supAcc = Array.isArray(raw.account) ? raw.account : []
        const op = normId(operatorClientId)
        const supEntry =
          supAcc.find(
            (a) =>
              normId(a?.clientId) === op &&
              op !== "" &&
              String(a?.provider ?? "").toLowerCase() === providerNorm
          ) || supAcc.find((a) => String(a?.provider ?? "").toLowerCase() === providerNorm)
        if (supEntry?.id != null) {
          setEditAccountId(String(supEntry.id))
        }
        setFormData({
          name,
          legalName: name,
          email,
          phone: sup.phone ?? "",
          idType: "SSM",
          idNumber: "",
          bankName,
          bankAccount,
          bankHolder,
          billerCode,
          productid: "",
          ownerBankName: "",
          ownerBankAccount: "",
          ownerBankHolder: "",
        })
        setSupplierPaymentMode(billerCode ? "jompay" : "bank")
      } catch (e) {
        console.error(e)
        setFormData({
          name: sup.name ?? "",
          legalName: pickLegalNameDefault(group.members),
          email: sup.email ?? "",
          phone: sup.phone ?? "",
          idType: "SSM",
          idNumber: "",
          bankName: sup.bankName ?? "",
          bankAccount: sup.bankAccount ?? "",
          bankHolder: sup.bankHolder ?? "",
          billerCode: sup.billerCode ?? "",
          productid: "",
          ownerBankName: "",
          ownerBankAccount: "",
          ownerBankHolder: "",
        })
        setSupplierPaymentMode(sup.billerCode ? "jompay" : "bank")
      }
    } else {
      const contact = group.members[0]
      setFormData({
        name: contact.name ?? "",
        legalName: pickLegalNameDefault(group.members),
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        idType: contact.idType ?? "NRIC",
        idNumber: contact.idNumber ?? "",
        bankName: contact.bankName ?? "",
        bankAccount: contact.bankAccount ?? "",
        bankHolder: contact.bankHolder ?? "",
        billerCode: "",
        productid: "",
        ownerBankName: "",
        ownerBankAccount: "",
        ownerBankHolder: "",
      })
    }
    const ownM = group.members.find((m) => String(m.type || "").toLowerCase() === "owner")
    const ownId = ownM ? entityIdForContact(ownM) : ""
    if (ownId) {
      try {
        const od = (await getOwnerDetail(ownId)) as {
          bankName?: string
          bankAccount?: string
          bankHolder?: string
        }
        setFormData((prev) => ({
          ...prev,
          ownerBankName: String(od.bankName ?? ""),
          ownerBankAccount: String(od.bankAccount ?? ""),
          ownerBankHolder: String(od.bankHolder ?? ""),
        }))
      } catch (e) {
        console.error(e)
        setFormData((prev) => ({
          ...prev,
          ownerBankName: "",
          ownerBankAccount: "",
          ownerBankHolder: "",
        }))
      }
    } else {
      setFormData((prev) => ({
        ...prev,
        ownerBankName: "",
        ownerBankAccount: "",
        ownerBankHolder: "",
      }))
    }
    const idPick = pickIdentityFromMembers(group.members)
    if (idPick.idType || idPick.idNumber) {
      setFormData((prev) => ({
        ...prev,
        ...(idPick.idType ? { idType: idPick.idType } : {}),
        ...(idPick.idNumber ? { idNumber: idPick.idNumber } : {}),
      }))
    }
    setShowEditDialog(true)
  }

  const handleAddNew = (type: "owner" | "tenant" | "supplier" | "staff") => {
    setNewContactType(type)
    setFormData({
      name: "",
      legalName: "",
      email: "",
      phone: "",
      idType: type === "supplier" ? "SSM" : "NRIC",
      idNumber: "",
      bankName: "",
      bankAccount: "",
      bankHolder: "",
      billerCode: "",
      productid: "",
      ownerBankName: "",
      ownerBankAccount: "",
      ownerBankHolder: "",
    })
    setSupplierPaymentMode("bank")
    setShowAddDialog(true)
  }

  const handleSaveNew = async () => {
    if (newContactType === "owner") {
      const email = (formData.email || "").trim()
      if (!email) {
        alert("Please enter owner email.")
        return
      }
      setAddSaving(true)
      try {
        const res = await submitOwnerApproval(email, { directMap: true }) as { ok?: boolean; reason?: string }
        if (res?.ok !== false) {
          setShowAddDialog(false)
          loadData()
        } else {
          alert(res?.reason ?? "Submit failed")
        }
      } catch (e) {
        console.error(e)
        alert("Submit failed")
      } finally {
        setAddSaving(false)
      }
      return
    }
    if (newContactType === "tenant") {
      const email = (formData.email || "").trim()
      if (!email) {
        alert("Please enter tenant email.")
        return
      }
      setAddSaving(true)
      try {
        const res = await submitTenantApproval(email, { directMap: true }) as { ok?: boolean; reason?: string }
        if (res?.ok !== false) {
          setShowAddDialog(false)
          loadData()
        } else {
          alert(res?.reason ?? "Submit failed")
        }
      } catch (e) {
        console.error(e)
        alert("Submit failed")
      } finally {
        setAddSaving(false)
      }
      return
    }
    if (newContactType === "staff") {
      const name = (formData.name || "").trim()
      const email = (formData.email || "").trim()
      if (!email) {
        alert("Please enter staff email.")
        return
      }
      setAddSaving(true)
      try {
        const res = await createStaffContact({ name, email }) as { ok?: boolean; reason?: string }
        if (res?.ok !== false) {
          setShowAddDialog(false)
          loadData()
        } else {
          alert(res?.reason ?? "Create staff failed")
        }
      } catch (e) {
        console.error(e)
        alert("Create staff failed")
      } finally {
        setAddSaving(false)
      }
      return
    }
    // supplier — name required; email optional (accounting sync uses legal name when email empty)
    const name = (formData.name || "").trim()
    const email = (formData.email || "").trim()
    if (!name) {
      alert("Please enter supplier name.")
      return
    }
    setAddSaving(true)
    try {
      const payload: { name: string; email?: string; billerCode?: string; bankName?: string; bankAccount?: string; bankHolder?: string; productid?: string } = {
        name,
        ...(email ? { email } : {}),
      }
      if (supplierPaymentMode === "jompay") {
        payload.billerCode = (formData.billerCode || "").trim() || undefined
      } else {
        payload.bankName = (formData.bankName || "").trim() || undefined
        payload.bankAccount = (formData.bankAccount || "").trim() || undefined
        payload.bankHolder = (formData.bankHolder || "").trim() || undefined
      }
      const res = await createSupplier(payload) as { ok?: boolean; reason?: string }
      if (res?.ok !== false) {
        setShowAddDialog(false)
        loadData()
      } else {
        alert(res?.reason ?? "Create supplier failed")
      }
    } catch (e) {
      console.error(e)
      alert("Create supplier failed")
    } finally {
      setAddSaving(false)
    }
  }

  const handleSaveEdit = async () => {
    const group = selectedEditGroup
    if (!group) return
    const tenantOnly = group.roles.length === 1 && group.roles[0] === "tenant"
    if (tenantOnly) return

    const anyRoleKept =
      editRoleSelection.owner ||
      editRoleSelection.tenant ||
      editRoleSelection.supplier ||
      editRoleSelection.staff
    if (!anyRoleKept) {
      alert("Select at least one role to keep.")
      return
    }

    const accounting = accountingConnected && String(accountingProvider || "").toLowerCase() !== ""

    setEditSaving(true)
    try {
      const contactEmail = formData.email.trim().toLowerCase()
      const phoneVal = (formData.phone || "").trim()
      try {
        await updateContactPortalPhone({ contactEmail, phone: phoneVal })
      } catch {
        /* optional when no portal row */
      }

      const sup = group.members.find((m) => String(m.type || "").toLowerCase() === "supplier")
      let supplierEntityId = sup ? entityIdForContact(sup) || undefined : undefined
      const cid = editAccountId.trim()
      const legalName = formData.legalName.trim()

      /** Unchecking a role removes this client ↔ row link (same APIs as Remove in the delete flow). */
      if (groupHasRole(group, "owner") && !editRoleSelection.owner) {
        const own = group.members.find((m) => String(m.type || "").toLowerCase() === "owner")
        const oid = entityIdForContact(own)
        if (!oid) {
          alert("Could not resolve owner record id. Refresh the page and try again.")
          return
        }
        const r = (await deleteOwnerOrCancel(oid, !!own?.pending)) as { ok?: boolean; reason?: string }
        if (r?.ok === false) {
          alert(r?.reason ?? "Could not remove owner link")
          return
        }
      }
      if (groupHasRole(group, "tenant") && !editRoleSelection.tenant) {
        const ten = group.members.find((m) => String(m.type || "").toLowerCase() === "tenant")
        const tid = entityIdForContact(ten)
        if (!tid) {
          alert("Could not resolve tenant record id. Refresh the page and try again.")
          return
        }
        const r = (await deleteTenantOrCancel(tid, !!ten?.pending)) as { ok?: boolean; reason?: string }
        if (r?.ok === false) {
          alert(r?.reason ?? "Could not remove tenant link")
          return
        }
      }
      if (groupHasRole(group, "supplier") && !editRoleSelection.supplier) {
        if (!supplierEntityId) {
          alert("Could not resolve supplier record id. Refresh the page and try again.")
          return
        }
        const r = (await deleteSupplierAccount(supplierEntityId)) as { ok?: boolean; reason?: string }
        if (r?.ok === false) {
          alert(r?.reason ?? "Could not remove supplier")
          return
        }
        supplierEntityId = undefined
      }
      if (groupHasRole(group, "staff") && !editRoleSelection.staff) {
        const st = group.members.find((m) => String(m.type || "").toLowerCase() === "staff")
        const sid = st ? entityIdForContact(st) : ""
        if (!sid) {
          alert("Could not resolve staff record id. Refresh the page and try again.")
          return
        }
        const r = (await deleteStaffContact(sid)) as { ok?: boolean; reason?: string }
        if (r?.ok === false) {
          alert(staffDeleteBlockedReason(r.reason))
          return
        }
      }

      if (editRoleSelection.supplier) {
        const email = formData.email.trim()
        if (!legalName) {
          alert("Legal name is required to save supplier.")
          return
        }
        if (!supplierEntityId) {
          const createPayload: {
            name: string
            email?: string
            billerCode?: string
            bankName?: string
            bankAccount?: string
            bankHolder?: string
          } = { name: legalName, email }
          if (supplierPaymentMode === "jompay") {
            createPayload.billerCode = (formData.billerCode || "").trim() || undefined
          } else {
            createPayload.bankName = (formData.bankName || "").trim() || undefined
            createPayload.bankAccount = (formData.bankAccount || "").trim() || undefined
            createPayload.bankHolder = (formData.bankHolder || "").trim() || undefined
          }
          const cr = (await createSupplier(createPayload)) as { ok?: boolean; reason?: string; id?: string }
          if (cr?.ok === false) {
            alert(cr?.reason ?? "Create supplier failed")
            return
          }
          if (cr?.id) supplierEntityId = String(cr.id)
          if (accounting && supplierEntityId && cid) {
            const mer = (await updateSupplier(supplierEntityId, { contactId: cid })) as { ok?: boolean; reason?: string }
            if (mer?.ok === false) {
              alert(mer?.reason ?? "Account ID update failed (supplier)")
              return
            }
          }
        } else {
          const payload: {
            name: string
            email: string
            billerCode?: string
            bankName?: string
            bankAccount?: string
            bankHolder?: string
            contactId?: string
          } = {
            name: legalName,
            email,
            billerCode: supplierPaymentMode === "jompay" ? (formData.billerCode || "").trim() || undefined : undefined,
            bankName: supplierPaymentMode === "bank" ? (formData.bankName || "").trim() || undefined : undefined,
            bankAccount: supplierPaymentMode === "bank" ? (formData.bankAccount || "").trim() || undefined : undefined,
            bankHolder: supplierPaymentMode === "bank" ? (formData.bankHolder || "").trim() || undefined : undefined,
            contactId: cid || undefined,
          }
          const res = (await updateSupplier(supplierEntityId, payload)) as { ok?: boolean; reason?: string }
          if (res?.ok === false) {
            alert(res?.reason ?? "Update failed")
            return
          }
        }
      }

      const ownForBank = group.members.find((m) => String(m.type || "").toLowerCase() === "owner")
      if (editRoleSelection.owner && ownForBank?.entityId) {
        const r = (await updateOwnerBank(ownForBank.entityId, {
          bankName: formData.ownerBankName,
          bankAccount: formData.ownerBankAccount,
          bankHolder: formData.ownerBankHolder,
        })) as { ok?: boolean; reason?: string }
        if (r?.ok === false) {
          alert(r?.reason ?? "Owner bank update failed")
          return
        }
      }

      const st = group.members.find((m) => String(m.type || "").toLowerCase() === "staff")
      if (editRoleSelection.staff && st?.entityId) {
        if (!legalName) {
          alert("Legal name is required to update staff for accounting.")
          return
        }
        const res = (await updateStaffContact(st.entityId, {
          name: legalName,
          email: formData.email.trim().toLowerCase(),
        })) as { ok?: boolean; reason?: string }
        if (res?.ok === false) {
          alert(res?.reason ?? "Update failed")
          return
        }
      }

      if (accounting) {
        const own = group.members.find((m) => String(m.type || "").toLowerCase() === "owner")
        if (editRoleSelection.owner && own?.entityId) {
          const r = (await updateOwnerAccount(own.entityId, cid)) as { ok?: boolean; reason?: string }
          if (r?.ok === false) {
            alert(r?.reason ?? "Account ID update failed (owner)")
            return
          }
        }
        const ten = group.members.find((m) => String(m.type || "").toLowerCase() === "tenant")
        if (editRoleSelection.tenant && ten?.entityId) {
          const r = (await updateTenantAccount(ten.entityId, cid)) as { ok?: boolean; reason?: string }
          if (r?.ok === false) {
            alert(r?.reason ?? "Account ID update failed (tenant)")
            return
          }
        }
        const stf = group.members.find((m) => String(m.type || "").toLowerCase() === "staff")
        if (editRoleSelection.staff && stf?.entityId) {
          const r = (await updateStaffAccount(stf.entityId, cid)) as { ok?: boolean; reason?: string }
          if (r?.ok === false) {
            alert(r?.reason ?? "Account ID update failed (staff)")
            return
          }
        }
      }

      setShowEditDialog(false)
      setSelectedEditGroup(null)
      setEditAccountId("")
      await loadData()
    } catch (e) {
      console.error(e)
      alert("Update failed")
    } finally {
      setEditSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (selectedDeleteGroup) {
      const group = selectedDeleteGroup
      if (isOperatorCompanyContact(group, operatorCompanyEmail)) {
        setShowDeleteDialog(false)
        setSelectedDeleteGroup(null)
        toast({
          title: "Cannot remove",
          description: "The company (master) account cannot be removed from Contact Settings.",
        })
        return
      }
      setDeleteSaving(true)
      const failures: string[] = []
      try {
        for (const m of group.members) {
          const entityId = m.entityId
          if (!entityId) continue
          if (m.type === "staff") {
            try {
              const res = (await deleteStaffContact(entityId)) as { ok?: boolean; reason?: string }
              if (res?.ok === false) {
                failures.push(`Staff: ${staffDeleteBlockedReason(res.reason)}`)
              }
            } catch (e) {
              failures.push(`Staff: ${e instanceof Error ? e.message : String(e)}`)
            }
            continue
          }
          try {
            let res: { ok?: boolean; reason?: string }
            if (m.type === "owner") {
              res = (await deleteOwnerOrCancel(entityId, !!m.pending)) as { ok?: boolean; reason?: string }
            } else if (m.type === "tenant") {
              res = (await deleteTenantOrCancel(entityId, !!m.pending)) as { ok?: boolean; reason?: string }
            } else if (m.type === "supplier") {
              res = (await deleteSupplierAccount(entityId)) as { ok?: boolean; reason?: string }
            } else {
              continue
            }
            if (res?.ok === false) failures.push(`${m.type}: ${res.reason ?? "failed"}`)
          } catch (e) {
            failures.push(`${m.type}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
        setShowDeleteDialog(false)
        setSelectedDeleteGroup(null)
        if (failures.length) {
          toast({ variant: "destructive", title: "Some removals failed", description: failures.slice(0, 5).join("\n") })
        } else {
          toast({ title: "Removed from this client" })
        }
        await loadData()
      } catch (e) {
        console.error(e)
        toast({ variant: "destructive", title: "Delete failed", description: e instanceof Error ? e.message : "Unknown error" })
      } finally {
        setDeleteSaving(false)
      }
      return
    }

    if (!selectedContact) return
    const entityId = selectedContact.entityId
    if (!entityId) {
      setContacts(contacts.filter((c) => c.id !== selectedContact.id))
      setShowDeleteDialog(false)
      return
    }
    setDeleteSaving(true)
    try {
      let res: { ok?: boolean; reason?: string }
      if (selectedContact.type === "owner") {
        res = (await deleteOwnerOrCancel(entityId, !!selectedContact.pending)) as { ok?: boolean; reason?: string }
      } else if (selectedContact.type === "tenant") {
        res = (await deleteTenantOrCancel(entityId, !!selectedContact.pending)) as { ok?: boolean; reason?: string }
      } else if (selectedContact.type === "supplier") {
        res = (await deleteSupplierAccount(entityId)) as { ok?: boolean; reason?: string }
      } else if (selectedContact.type === "staff") {
        res = (await deleteStaffContact(entityId)) as { ok?: boolean; reason?: string }
      } else {
        setDeleteSaving(false)
        return
      }
      if (res?.ok !== false) {
        setShowDeleteDialog(false)
        setDeleteConfirmId(null)
        loadData()
      } else {
        alert(
          selectedContact.type === "staff"
            ? staffDeleteBlockedReason(res.reason)
            : (res?.reason ?? "Delete failed")
        )
      }
    } catch (e) {
      console.error(e)
      alert("Delete failed")
    } finally {
      setDeleteSaving(false)
    }
  }

  const handleConfirmSyncAll = async () => {
    setSyncingContacts(true)
    try {
      const res = await syncAllContacts(syncDirection) as {
        ok?: boolean
        reason?: string
        provider?: string
        scanned?: number
        synced?: number
        linked?: number
        created?: number
        failed?: number
        failureSamples?: Array<{
          remoteId?: string
          email?: string
          name?: string
          stage?: string
          reason?: string
        }>
      }
      if (res?.ok === false) {
        toast({
          variant: "destructive",
          title: "Sync failed",
          description: res?.reason ?? "Unknown error",
        })
        return
      }
      const provider = String(res?.provider ?? accountingProvider ?? "accounting").toUpperCase()
      const linkedOrSynced = (res?.synced ?? 0) + (res?.linked ?? 0)
      const samples = res?.failureSamples ?? []
      const sampleLines =
        samples.length > 0
          ? `\n\n${samples
              .slice(0, 5)
              .map(
                (s) =>
                  `• ${s.stage ?? "?"}: ${s.reason ?? "unknown"}${s.email || s.name ? ` (${[s.email, s.name].filter(Boolean).join(" / ")})` : ""}`
              )
              .join("\n")}${samples.length > 5 ? `\n… +${samples.length - 5} more (see server log)` : ""}`
          : ""
      toast({
        title: `Sync finished (${provider})`,
        description: (
          <span className="block text-left whitespace-pre-line">
            {`Scanned: ${res?.scanned ?? 0}\nLinked/Synced: ${linkedOrSynced}\nCreated: ${res?.created ?? 0}\nFailed: ${res?.failed ?? 0}${sampleLines}`}
          </span>
        ),
      })
      setShowSyncDialog(false)
      await loadData()
    } catch (e) {
      console.error(e)
      toast({
        variant: "destructive",
        title: "Sync failed",
        description: e instanceof Error ? e.message : "Please try again.",
      })
    } finally {
      setSyncingContacts(false)
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "owner": return <Building2 size={16} className="text-blue-600" />
      case "tenant": return <User size={16} className="text-green-600" />
      case "supplier": return <Truck size={16} className="text-orange-600" />
      case "staff": return <Users size={16} className="text-purple-600" />
      default: return null
    }
  }

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "owner": return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Owner</Badge>
      case "tenant": return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Tenant</Badge>
      case "supplier": return <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">Supplier</Badge>
      case "staff": return <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100">Staff</Badge>
      default: return null
    }
  }

  const getTypeBadges = (roles: ContactRole[]) => (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <span key={r}>{getTypeBadge(r)}</span>
      ))}
    </span>
  )

  const StarRating = ({
    label,
    value,
    onChange,
  }: {
    label: string
    value: number
    onChange: (v: number) => void
  }) => (
    <div>
      <Label className="text-xs font-semibold">{label}</Label>
      <div className="flex items-center gap-1 mt-1">
        {Array.from({ length: 10 }, (_, i) => {
          const n = i + 1
          const active = n <= value
          return (
            <button key={n} type="button" className="p-0.5" onClick={() => onChange(n)}>
              <Star size={15} className={active ? "fill-amber-400 text-amber-400" : "text-muted-foreground"} />
            </button>
          )
        })}
        <span className="text-sm font-semibold ml-1">{value}</span>
      </div>
    </div>
  )

  const openOwnerReview = async (contact: Contact) => {
    if (contact.type !== "owner" || !contact.entityId) return
    setOwnerReviewTarget(contact)
    setOwnerReviewId(null)
    setOwnerCommunicationScore(8)
    setOwnerResponsibilityScore(8)
    setOwnerCooperationScore(8)
    setOwnerReviewComment("")
    setOwnerReviewEvidence([])
    try {
      const latest = await getLatestOwnerReview({ ownerId: contact.entityId })
      if (latest?.item) {
        setOwnerReviewId(latest.item.id)
        setOwnerCommunicationScore(Number(latest.item.communicationScore || 8))
        setOwnerResponsibilityScore(Number(latest.item.responsibilityScore || 8))
        setOwnerCooperationScore(Number(latest.item.cooperationScore || 8))
        setOwnerReviewComment(latest.item.comment || "")
        setOwnerReviewEvidence(Array.isArray(latest.item.evidenceUrls) ? latest.item.evidenceUrls : [])
      }
    } catch {}
    setShowOwnerReviewDialog(true)
  }

  const handleOwnerEvidenceUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const uploaded: string[] = []
    for (const file of Array.from(files)) {
      const r = await uploadFile(file)
      if (r?.ok && r.url) uploaded.push(r.url)
    }
    if (uploaded.length) setOwnerReviewEvidence((prev) => [...prev, ...uploaded].slice(0, 30))
  }

  const handleSubmitOwnerReview = async () => {
    if (!ownerReviewTarget?.entityId) return
    setOwnerReviewSubmitting(true)
    try {
      const resp = await submitOwnerReview({
        reviewId: ownerReviewId || undefined,
        ownerId: ownerReviewTarget.entityId,
        communicationScore: ownerCommunicationScore,
        responsibilityScore: ownerResponsibilityScore,
        cooperationScore: ownerCooperationScore,
        comment: ownerReviewComment.trim(),
        evidenceUrls: ownerReviewEvidence,
      })
      if (resp?.ok === false) {
        toast({
          variant: "destructive",
          title: "Owner review not saved",
          description: resp?.reason || "Submit failed",
        })
        return
      }
      setShowOwnerReviewDialog(false)
      toast({
        title: ownerReviewId ? "Owner review updated" : "Owner review submitted",
      })
    } catch (e) {
      console.error(e)
      toast({
        variant: "destructive",
        title: "Owner review failed",
        description: e instanceof Error ? e.message : "Network or server error",
      })
    } finally {
      setOwnerReviewSubmitting(false)
    }
  }

  return (
    <main className="p-3 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Contact Settings</h1>
          <p className="text-sm text-muted-foreground">Manage owners, tenants, suppliers, and staff</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end w-full sm:w-auto">
          {accountingConnected && (
            <Button variant="outline" className="gap-2" onClick={() => setShowSyncDialog(true)}>
              <RefreshCcw size={16} />
              Sync Contact
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="gap-2" style={{ background: "var(--brand)" }}>
                <Plus size={18} /> Add Contact <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleAddNew("owner")}>
                <Building2 size={16} className="mr-2 text-blue-600" /> Add Owner
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAddNew("tenant")}>
                <User size={16} className="mr-2 text-green-600" /> Add Tenant
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAddNew("supplier")}>
                <Truck size={16} className="mr-2 text-orange-600" /> Add Supplier
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAddNew("staff")}>
                <Users size={16} className="mr-2 text-purple-600" /> Add Staff
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mb-6">
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab("all")}>
          <CardContent className="p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">All Contacts</p>
            <p className="text-2xl font-bold text-foreground">{counts.all}</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab("owner")}>
          <CardContent className="p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-blue-600">Owners</p>
            <p className="text-2xl font-bold text-foreground">{counts.owner}</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab("tenant")}>
          <CardContent className="p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-green-600">Tenants</p>
            <p className="text-2xl font-bold text-foreground">{counts.tenant}</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab("supplier")}>
          <CardContent className="p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-orange-600">Suppliers</p>
            <p className="text-2xl font-bold text-foreground">{counts.supplier}</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab("staff")}>
          <CardContent className="p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-purple-600">Staff</p>
            <p className="text-2xl font-bold text-foreground">{counts.staff}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, email or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "az" | "za")}
          className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
        >
          <option value="az">A &rarr; Z</option>
          <option value="za">Z &rarr; A</option>
        </select>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Show</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value) as (typeof CONTACT_PAGE_SIZE_OPTIONS)[number])}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm min-w-[5rem]"
            aria-label="Items per page"
          >
            {CONTACT_PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
          <TabsTrigger value="owner">Owners ({counts.owner})</TabsTrigger>
          <TabsTrigger value="tenant">Tenants ({counts.tenant})</TabsTrigger>
          <TabsTrigger value="supplier">Suppliers ({counts.supplier})</TabsTrigger>
          <TabsTrigger value="staff">Staff ({counts.staff})</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab}>
          <div className="space-y-2">
            {filteredGroups.length === 0 ? (
              <Card className="p-8 text-center">
                <p className="text-muted-foreground">No contacts found</p>
              </Card>
            ) : (
              paginatedGroups.map((group) => {
                const multi = group.roles.length > 1
                const staffOnly = group.roles.length === 1 && group.roles[0] === "staff"
                const tenantOnly = group.roles.length === 1 && group.roles[0] === "tenant"
                const ownerM = group.members.find((m) => m.type === "owner")
                const tenantM = group.members.find((m) => m.type === "tenant")
                const bankRow = ownerM ?? group.members.find((m) => m.bankAccount || m.bankName)
                return (
                  <Card key={group.key} className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0">
                          {multi ? <Users size={18} className="text-muted-foreground" /> : getTypeIcon(group.roles[0])}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-foreground">{group.displayName}</p>
                            {getTypeBadges(group.roles)}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {group.email || "—"} | {group.phone || "—"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {group.members.map((m) => m.idType).filter(Boolean)[0] ?? "—"}: {group.members.map((m) => m.idNumber).filter(Boolean)[0] ?? "—"} | Bank: {bankRow?.bankName ?? "—"} — {bankRow?.bankAccount ?? "—"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-end shrink-0">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-2">
                              <MoreHorizontal size={16} />
                              Actions
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            {staffOnly || (tenantOnly && tenantM) ? (
                              <DropdownMenuItem onClick={() => handleEditGroup(group)}>
                                {tenantOnly ? "View / edit (tenant read-only)" : "Edit staff"}
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => handleEditGroup(group)}>
                                <Edit2 size={14} className="mr-2 opacity-70" />
                                Edit contact
                              </DropdownMenuItem>
                            )}
                            {ownerM ? (
                              <DropdownMenuItem onClick={() => window.open(`/profile/${ownerM.entityId || ownerM.id}`, "_blank")}>
                                <Eye size={14} className="mr-2 opacity-70" />
                                Owner profile
                              </DropdownMenuItem>
                            ) : null}
                            {tenantM ? (
                              <DropdownMenuItem onClick={() => window.open(`/profile/${tenantM.entityId || tenantM.id}`, "_blank")}>
                                <Eye size={14} className="mr-2 opacity-70" />
                                Tenant profile
                              </DropdownMenuItem>
                            ) : null}
                            {ownerM ? (
                              <DropdownMenuItem onClick={() => openOwnerReview(ownerM)}>
                                <Star size={14} className="mr-2 opacity-70" />
                                Review owner
                              </DropdownMenuItem>
                            ) : null}
                            {!isOperatorCompanyContact(group, operatorCompanyEmail) ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => {
                                    setSelectedDeleteGroup(group)
                                    setSelectedContact(null)
                                    setShowDeleteDialog(true)
                                  }}
                                >
                                  Remove from this client…
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </Card>
                )
              })
            )}
          </div>
          {filteredGroups.length > 0 ? (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4 pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Showing {listRangeStart}–{listRangeEnd} of {totalFiltered}
              </p>
              <div className="flex items-center gap-2 justify-end flex-wrap">
                <span className="text-sm text-muted-foreground">
                  Page {currentListPage} of {totalListPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={currentListPage <= 1 || loading}
                  onClick={() => setListPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16} />
                  Prev
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={currentListPage >= totalListPages || loading}
                  onClick={() => setListPage((p) => Math.min(totalListPages, p + 1))}
                  aria-label="Next page"
                >
                  Next
                  <ChevronRight size={16} />
                </Button>
              </div>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>

      {/* Add Dialog: Owner/Tenant = submit approval (email only); Supplier = name + optional email + payment mode */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {getTypeIcon(newContactType)} Add New {newContactType.charAt(0).toUpperCase() + newContactType.slice(1)}
            </DialogTitle>
            <DialogDescription>
              {newContactType === "owner" && "Submit owner approval request by email. They will receive an invite."}
              {newContactType === "tenant" && "Submit tenant approval request by email. They will receive an invite."}
              {newContactType === "staff" && "Create a new staff member for this client (booking/commission recipient)."}
              {newContactType === "supplier" && "Create a new supplier with payment details (Jompay or Bank)."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {(newContactType === "owner" || newContactType === "tenant") && (
              <div>
                <Label className="text-xs font-semibold">Email</Label>
                <Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="mt-1" placeholder="email@example.com" />
              </div>
            )}
            {newContactType === "staff" && (
              <>
                <div>
                  <Label className="text-xs font-semibold">Name</Label>
                  <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="mt-1" placeholder="Staff name" />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Email</Label>
                  <Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="mt-1" placeholder="email@example.com" />
                </div>
              </>
            )}
            {newContactType === "supplier" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label className="text-xs font-semibold">Name</Label>
                  <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="mt-1" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs font-semibold">Email (optional)</Label>
                  <Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="mt-1" placeholder="Leave blank if not applicable" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs font-semibold">Payment mode</Label>
                  <select
                    value={supplierPaymentMode}
                    onChange={(e) => setSupplierPaymentMode(e.target.value as "jompay" | "bank")}
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  >
                    <option value="bank">Bank Transfer</option>
                    <option value="jompay">Jompay</option>
                  </select>
                </div>
                {supplierPaymentMode === "jompay" && (
                  <div className="col-span-2">
                    <Label className="text-xs font-semibold">Biller Code</Label>
                    <Input value={formData.billerCode} onChange={(e) => setFormData({ ...formData, billerCode: e.target.value })} className="mt-1" placeholder="Jompay biller code" />
                  </div>
                )}
                {supplierPaymentMode === "bank" && (
                  <>
                    <div className="col-span-2">
                      <Label className="text-xs font-semibold">Bank</Label>
                      <select
                        value={formData.bankName}
                        onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                        className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
                      >
                        <option value="">Select Bank</option>
                        {bankOptions.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Bank Account</Label>
                      <Input value={formData.bankAccount} onChange={(e) => setFormData({ ...formData, bankAccount: e.target.value })} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Account Holder</Label>
                      <Input value={formData.bankHolder} onChange={(e) => setFormData({ ...formData, bankHolder: e.target.value })} className="mt-1" />
                    </div>
                  </>
                )                }
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleSaveNew} disabled={addSaving}>
              {addSaving
                ? "Saving…"
                : newContactType === "supplier"
                  ? "Create Supplier"
                  : newContactType === "staff"
                    ? "Create Staff"
                    : `Submit ${newContactType === "owner" ? "Owner" : "Tenant"} Approval`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit / View: merged row = role checkboxes; tenant-only = read-only */}
      <Dialog
        open={showEditDialog}
        onOpenChange={(open) => {
          setShowEditDialog(open)
          if (!open) {
            setSelectedEditGroup(null)
            setEditAccountId("")
            setProfileNameReadonly("")
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {selectedEditGroup && selectedEditGroup.roles.length === 1 ? getTypeIcon(selectedEditGroup.roles[0]) : <Users size={18} className="text-muted-foreground" />}
              {selectedEditGroup && selectedEditGroup.roles.length === 1 && selectedEditGroup.roles[0] === "tenant"
                ? "View Tenant"
                : "Edit contact"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {selectedEditGroup && !(selectedEditGroup.roles.length === 1 && selectedEditGroup.roles[0] === "tenant") ? (
              <div className="rounded-lg border border-border p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Apply changes to</p>
                <div className="flex flex-wrap gap-x-4 gap-y-2 relative z-10 pointer-events-auto">
                  {(["owner", "tenant", "supplier", "staff"] as const).map((role) => {
                    const has = groupHasRole(selectedEditGroup, role)
                    const label =
                      role === "owner"
                        ? "Owner"
                        : role === "tenant"
                          ? "Tenant"
                          : role === "supplier"
                            ? "Supplier"
                            : "Staff"
                    const id = `edit-contact-role-${role}-${selectedEditGroup.key}`
                    return (
                      <div key={role} className="flex items-center gap-2">
                        <input
                          id={id}
                          type="checkbox"
                          className="h-4 w-4 shrink-0 rounded border border-input accent-primary cursor-pointer"
                          checked={!!editRoleSelection[role]}
                          onChange={(e) =>
                            setEditRoleSelection((prev) => ({ ...prev, [role]: e.target.checked }))
                          }
                        />
                        <label htmlFor={id} className="text-sm font-normal cursor-pointer select-none">
                          {label}
                          {!has ? <span className="text-muted-foreground"> (no record)</span> : null}
                        </label>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-4">
              {(() => {
                const g = selectedEditGroup
                const tenantOnlyDialog = !!(g && g.roles.length === 1 && g.roles[0] === "tenant")
                const isViewMode = tenantOnlyDialog
                /** Same person as tenant + owner + staff: NRIC etc. live on profile only. */
                const idDocLocked =
                  !!g &&
                  groupHasRole(g, "tenant") &&
                  groupHasRole(g, "owner") &&
                  groupHasRole(g, "staff")
                const hasBizRole = !!(g && (groupHasRole(g, "supplier") || groupHasRole(g, "staff")))
                const legalNameReadOnly =
                  isViewMode ||
                  !hasBizRole ||
                  (!editRoleSelection.supplier && !editRoleSelection.staff)
                const emailReadOnly = true
                const phoneReadOnly = isViewMode
                const showSupplierForm = !!(g && editRoleSelection.supplier && !isViewMode)
                const showOwnerBankForm =
                  !!g &&
                  !isViewMode &&
                  editRoleSelection.owner &&
                  groupHasRole(g, "owner")
                const showOwnerStaffExtras =
                  !!g &&
                  !isViewMode &&
                  ((editRoleSelection.owner && groupHasRole(g, "owner")) || (editRoleSelection.staff && groupHasRole(g, "staff")))
                const emailDisabledClass = emailReadOnly ? " opacity-80 cursor-not-allowed bg-muted/50" : ""
                const phoneDisabledClass = phoneReadOnly ? " opacity-80 cursor-not-allowed bg-muted/50" : ""
                const legalNameDisabledClass = legalNameReadOnly ? " opacity-80 cursor-not-allowed bg-muted/50" : ""
                return (
                  <>
                    {profileNameReadonly ? (
                      <div className="col-span-2">
                        <Label className="text-xs font-semibold">Profile name (owner / tenant)</Label>
                        <Input
                          value={profileNameReadonly}
                          readOnly
                          disabled
                          className="mt-1 opacity-80 cursor-not-allowed bg-muted/50"
                        />
                      </div>
                    ) : null}
                    {hasBizRole ? (
                      <div className="col-span-2">
                        <Label className="text-xs font-semibold">Legal name (accounting)</Label>
                        <Input
                          value={formData.legalName}
                          onChange={(e) => setFormData({ ...formData, legalName: e.target.value })}
                          className={"mt-1" + legalNameDisabledClass}
                          readOnly={legalNameReadOnly}
                          disabled={legalNameReadOnly}
                        />
                      </div>
                    ) : null}
                    <div>
                      <Label className="text-xs font-semibold">Email</Label>
                      <Input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className={"mt-1" + emailDisabledClass}
                        readOnly={emailReadOnly}
                        disabled={emailReadOnly}
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Phone</Label>
                      <Input
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className={"mt-1" + phoneDisabledClass}
                        readOnly={phoneReadOnly}
                        disabled={phoneReadOnly}
                      />
                    </div>
                    {accountingConnected && g && !isViewMode ? (
                      <div className="col-span-2 rounded-lg border border-border p-3 space-y-2 bg-muted/20">
                        <Label className="text-xs font-semibold">Account ID</Label>
                        <Input
                          value={editAccountId}
                          onChange={(e) => setEditAccountId(e.target.value)}
                          className="mt-1"
                          placeholder="Account ID"
                        />
                      </div>
                    ) : null}
                    {showOwnerBankForm && (
                      <div className="col-span-2 rounded-lg border border-border p-3 space-y-3 bg-muted/10">
                        <p className="text-xs font-semibold text-muted-foreground">Owner — bank transfer</p>
                        <div className="col-span-2">
                          <Label className="text-xs font-semibold">Bank</Label>
                          <select
                            value={formData.ownerBankName}
                            onChange={(e) => setFormData({ ...formData, ownerBankName: e.target.value })}
                            className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
                          >
                            <option value="">Select Bank</option>
                            {bankOptions.map((b) => (
                              <option key={b.value} value={b.value}>
                                {b.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <Label className="text-xs font-semibold">Bank Account</Label>
                          <Input
                            value={formData.ownerBankAccount}
                            onChange={(e) => setFormData({ ...formData, ownerBankAccount: e.target.value })}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-semibold">Account Holder</Label>
                          <Input
                            value={formData.ownerBankHolder}
                            onChange={(e) => setFormData({ ...formData, ownerBankHolder: e.target.value })}
                            className="mt-1"
                          />
                        </div>
                      </div>
                    )}
                    {showSupplierForm && (
                      <>
                        <div className="col-span-2">
                          <Label className="text-xs font-semibold">Supplier — payment mode</Label>
                          <select
                            value={supplierPaymentMode}
                            onChange={(e) => setSupplierPaymentMode(e.target.value as "jompay" | "bank")}
                            className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
                          >
                            <option value="bank">Bank Transfer</option>
                            <option value="jompay">Jompay</option>
                          </select>
                        </div>
                        {supplierPaymentMode === "jompay" && (
                          <div className="col-span-2">
                            <Label className="text-xs font-semibold">Biller Code</Label>
                            <Input value={formData.billerCode} onChange={(e) => setFormData({ ...formData, billerCode: e.target.value })} className="mt-1" />
                          </div>
                        )}
                        {supplierPaymentMode === "bank" && (
                          <>
                            <div className="col-span-2">
                              <Label className="text-xs font-semibold">Bank</Label>
                              <select
                                value={formData.bankName}
                                onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                                className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
                              >
                                <option value="">Select Bank</option>
                                {bankOptions.map((b) => (
                                  <option key={b.value} value={b.value}>
                                    {b.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <Label className="text-xs font-semibold">Bank Account</Label>
                              <Input value={formData.bankAccount} onChange={(e) => setFormData({ ...formData, bankAccount: e.target.value })} className="mt-1" />
                            </div>
                            <div>
                              <Label className="text-xs font-semibold">Account Holder</Label>
                              <Input value={formData.bankHolder} onChange={(e) => setFormData({ ...formData, bankHolder: e.target.value })} className="mt-1" />
                            </div>
                          </>
                        )}
                      </>
                    )}
                    {showOwnerStaffExtras && (
                      <>
                        <div>
                          <Label className="text-xs font-semibold">ID Type</Label>
                          <select
                            value={formData.idType}
                            onChange={(e) => setFormData({ ...formData, idType: e.target.value })}
                            className={
                              "w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm" +
                              (isViewMode || idDocLocked ? " opacity-80 cursor-not-allowed bg-muted/50" : "")
                            }
                            disabled={isViewMode || idDocLocked}
                          >
                            <option value="NRIC">NRIC (Malaysia)</option>
                            <option value="SG ID">SG ID (Singapore)</option>
                            <option value="Passport">Passport</option>
                            <option value="SSM">SSM (Company)</option>
                          </select>
                        </div>
                        <div>
                          <Label className="text-xs font-semibold">ID Number</Label>
                          <Input
                            value={formData.idNumber}
                            onChange={(e) => setFormData({ ...formData, idNumber: e.target.value })}
                            className={"mt-1" + (isViewMode || idDocLocked ? " opacity-80 cursor-not-allowed bg-muted/50" : "")}
                            readOnly={isViewMode || idDocLocked}
                            disabled={isViewMode || idDocLocked}
                          />
                        </div>
                      </>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              {selectedEditGroup && selectedEditGroup.roles.length === 1 && selectedEditGroup.roles[0] === "tenant" ? "Close" : "Cancel"}
            </Button>
            {!(selectedEditGroup && selectedEditGroup.roles.length === 1 && selectedEditGroup.roles[0] === "tenant") && (
              <Button style={{ background: "var(--brand)" }} onClick={handleSaveEdit} disabled={editSaving}>
                {editSaving ? "Saving…" : "Save Changes"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete / Cancel approval confirmation */}
      <Dialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteConfirmId(null)
            setSelectedDeleteGroup(null)
          }
          setShowDeleteDialog(open)
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {selectedDeleteGroup
                ? "Remove from this client"
                : selectedContact?.pending
                  ? "Cancel approval"
                  : "Delete contact"}
            </DialogTitle>
            <DialogDescription>
              {selectedDeleteGroup ? (
                <>
                  Remove <strong>{selectedDeleteGroup.displayName}</strong> from this operator for{" "}
                  <strong>all roles</strong> (owner, tenant, supplier, staff, etc.)? This cannot be undone. Staff linked to User management (Company settings) must be removed there first.
                </>
              ) : selectedContact?.pending ? (
                <>Cancel pending approval for <strong>{selectedContact?.name?.replace?.(" (Pending Approval)", "") ?? selectedContact?.name}</strong>?</>
              ) : (
                <>Are you sure you want to delete <strong>{selectedContact?.name}</strong>? This action cannot be undone.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Close</Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={deleteSaving}>
              {deleteSaving ? "Removing…" : selectedDeleteGroup ? "Remove all" : selectedContact?.pending ? "Cancel approval" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSyncDialog} onOpenChange={setShowSyncDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Sync Contact</DialogTitle>
            <DialogDescription>
              We will sync all contacts with your accounting system. Choose sync direction.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
              <input
                type="radio"
                name="syncDirection"
                value="to-accounting"
                checked={syncDirection === "to-accounting"}
                onChange={() => setSyncDirection("to-accounting")}
                className="mt-1"
              />
              <div>
                <p className="font-medium">Export to Accounting</p>
                <p className="text-sm text-muted-foreground">
                  Check by email/name. If accounting contact does not exist, create and save returned ID.
                </p>
              </div>
            </label>
            <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
              <input
                type="radio"
                name="syncDirection"
                value="from-accounting"
                checked={syncDirection === "from-accounting"}
                onChange={() => setSyncDirection("from-accounting")}
                className="mt-1"
              />
              <div>
                <p className="font-medium">Import from Accounting</p>
                <p className="text-sm text-muted-foreground">
                  Check local contact by email/name. If missing, create contact entry and save accounting ID.
                </p>
              </div>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSyncDialog(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleConfirmSyncAll} disabled={syncingContacts}>
              {syncingContacts ? "Syncing..." : "Start Sync"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showOwnerReviewDialog} onOpenChange={setShowOwnerReviewDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Submit Owner Review</DialogTitle>
            <DialogDescription>{ownerReviewTarget?.name || ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <StarRating label="Easy communication" value={ownerCommunicationScore} onChange={setOwnerCommunicationScore} />
            <StarRating label="Responsible & reliable" value={ownerResponsibilityScore} onChange={setOwnerResponsibilityScore} />
            <StarRating label="Cooperative in operations" value={ownerCooperationScore} onChange={setOwnerCooperationScore} />
            <div>
              <Label className="text-xs font-semibold">Review input</Label>
              <textarea
                value={ownerReviewComment}
                onChange={(e) => setOwnerReviewComment(e.target.value)}
                rows={3}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm mt-1 bg-background text-foreground resize-none"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">Evidence upload (optional)</Label>
              <Input type="file" multiple accept="image/*,video/*" className="mt-1" onChange={(e) => handleOwnerEvidenceUpload(e.target.files)} />
              {ownerReviewEvidence.length ? <p className="text-xs text-muted-foreground mt-1">{ownerReviewEvidence.length} file(s) uploaded</p> : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOwnerReviewDialog(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleSubmitOwnerReview} disabled={ownerReviewSubmitting}>
              {ownerReviewSubmitting ? "Submitting..." : (ownerReviewId ? "Update Review" : "Submit Review")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
