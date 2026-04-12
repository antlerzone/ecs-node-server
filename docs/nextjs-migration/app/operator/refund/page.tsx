"use client"

import { useState, useEffect, useCallback } from "react"
import { Banknote, Search, Filter, Eye, CheckCircle, Clock, XCircle, Calendar, User, Home, Download, MoreHorizontal, ArrowUpRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { getAdminList, updateRefund, bulkUpdateRefunds, getBankBulkTransferBanks, getBankBulkTransferDownloadUrl } from "@/lib/operator-api"
import { useOperatorContext } from "@/contexts/operator-context"
import { getTodayMalaysiaYmd, tenancyDbDateToMalaysiaYmd } from "@/lib/dateMalaysia"

interface Refund {
  id: string
  tenant: string
  tenantEmail: string
  room: string
  property: string
  depositAmount: number
  deductions: number
  refundAmount: number
  status: "pending" | "approved" | "completed" | "rejected"
  terminationDate: string
  requestDate: string
  processedDate?: string
  bankName?: string
  bankAccount?: string
  accountingProvider?: string
  accountingRefId?: string
  accountingRefUrl?: string
  forfeitAccountingProvider?: string
  forfeitAccountingRefId?: string
  forfeitAccountingRefUrl?: string
  forfeitInvoiceId?: string
  forfeitMoneyOutId?: string
  forfeitInvoiceLabel?: string
  forfeitMoneyOutLabel?: string
  accountingRefLabel?: string
  refundMoneyOutId?: string
  reason?: string
  notes?: string
}

function mapApiRefundToRefund(r: Record<string, unknown>): Refund {
  const amount = Number(r.amount ?? 0)
  const depositAmountRaw = Number(r.depositAmount ?? amount)
  const depositAmount = Number.isFinite(depositAmountRaw) ? depositAmountRaw : amount
  const deductions = Math.max(0, depositAmount - amount)
  const done = !!(r.done ?? false)
  const rawStatus = String(r.status ?? "").toLowerCase()
  const status: Refund["status"] =
    rawStatus === "approved" || rawStatus === "completed" || rawStatus === "rejected" || rawStatus === "pending"
      ? (rawStatus as Refund["status"])
      : (done ? "completed" : "pending")
  const room = (r.room as { title_fld?: string })?.title_fld ?? (r.roomtitle as string) ?? ""
  const tenant = (r.tenant as { fullname?: string })?.fullname ?? (r.tenantname as string) ?? ""
  const tenantEmail = (r.tenant as { email?: string })?.email ?? ""
  const bankName = (r.tenant as { bankName?: { bankname?: string } })?.bankName?.bankname ?? ""
  const bankAccount = (r.tenant as { bankAccount?: string })?.bankAccount ?? ""
  const created = r._createdDate ? tenancyDbDateToMalaysiaYmd(String(r._createdDate)) : ""
  const tenancyEnd = r.tenancyEnd ? tenancyDbDateToMalaysiaYmd(String(r.tenancyEnd)) : ""
  const property = (r.property as { shortname?: string })?.shortname ?? ""
  const refundMoneyOutId = String((r.accountingRefId as string) || "").trim()
  let accountingRefLabel = refundMoneyOutId
  let accountingRefUrl = String((r.accountingRefUrl as string) || "").trim()
  if (accountingRefUrl) {
    try {
      const parsed = JSON.parse(accountingRefUrl) as { refundLabel?: unknown; refundUrl?: unknown }
      accountingRefLabel = String(parsed?.refundLabel ?? accountingRefLabel).trim()
      accountingRefUrl = String(parsed?.refundUrl ?? accountingRefUrl).trim()
    } catch {
      // keep legacy plain url string
    }
  }
  let forfeitInvoiceId = ""
  let forfeitMoneyOutId = ""
  let forfeitInvoiceLabel = ""
  let forfeitMoneyOutLabel = ""
  const forfeitRefRaw = String((r.forfeitAccountingRefUrl as string) || "").trim()
  if (forfeitRefRaw) {
    try {
      const parsed = JSON.parse(forfeitRefRaw) as {
        invoiceId?: unknown
        moneyOutId?: unknown
        invoiceLabel?: unknown
        moneyOutLabel?: unknown
      }
      forfeitInvoiceId = String(parsed?.invoiceId ?? "").trim()
      forfeitMoneyOutId = String(parsed?.moneyOutId ?? "").trim()
      forfeitInvoiceLabel = String(parsed?.invoiceLabel ?? forfeitInvoiceId).trim()
      forfeitMoneyOutLabel = String(parsed?.moneyOutLabel ?? forfeitMoneyOutId).trim()
    } catch {
      // keep empty when old/plain text payload
    }
  }
  return {
    id: String(r._id ?? r.id ?? ""),
    tenant,
    tenantEmail,
    room,
    property,
    depositAmount,
    deductions,
    refundAmount: amount,
    status,
    terminationDate: tenancyEnd,
    requestDate: created,
    bankName,
    bankAccount,
    accountingProvider: (r.accountingProvider as string) || "",
    accountingRefId: (r.accountingRefId as string) || "",
    accountingRefUrl,
    forfeitAccountingProvider: (r.forfeitAccountingProvider as string) || "",
    forfeitAccountingRefId: (r.forfeitAccountingRefId as string) || "",
    forfeitAccountingRefUrl: (r.forfeitAccountingRefUrl as string) || "",
    forfeitInvoiceId,
    forfeitMoneyOutId,
    forfeitInvoiceLabel,
    forfeitMoneyOutLabel,
    accountingRefLabel,
    refundMoneyOutId,
  }
}

function normalizeHttpUrl(input: string | null | undefined): string {
  const v = String(input || "").trim()
  return /^https?:\/\//i.test(v) ? v : ""
}

const STATUS_CONFIG = {
  pending: { label: "Pending", color: "bg-yellow-100 text-yellow-700", icon: Clock },
  approved: { label: "Approved", color: "bg-blue-100 text-blue-700", icon: CheckCircle },
  completed: { label: "Completed", color: "bg-green-100 text-green-700", icon: CheckCircle },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700", icon: XCircle },
}

export default function RefundDepositPage() {
  const { accessCtx } = useOperatorContext()
  const currencyCode = String(accessCtx?.client?.currency || "").trim().toUpperCase()
  const currencySymbol = currencyCode === "SGD" ? "S$" : currencyCode === "MYR" ? "RM" : currencyCode
  const [refunds, setRefunds] = useState<Refund[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("pending")
  const [search, setSearch] = useState("")
  const [propertyFilter, setPropertyFilter] = useState("all")
  const [selectedRefund, setSelectedRefund] = useState<Refund | null>(null)
  const [showDetailDialog, setShowDetailDialog] = useState(false)
  const [showProcessDialog, setShowProcessDialog] = useState(false)
  const [processAction, setProcessAction] = useState<"approve" | "reject" | "complete">("approve")
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showMarkPaidDialog, setShowMarkPaidDialog] = useState(false)
  const [markPaidDate, setMarkPaidDate] = useState(() => getTodayMalaysiaYmd())
  const [markPaidMethod, setMarkPaidMethod] = useState<"" | "Bank" | "Cash">("")
  const [markPaidLoading, setMarkPaidLoading] = useState(false)
  const [showBankFileDialog, setShowBankFileDialog] = useState(false)
  const [bankOptions, setBankOptions] = useState<Array<{ label: string; value: string }>>([])
  const [selectedBank, setSelectedBank] = useState("")
  const [bankFileLoading, setBankFileLoading] = useState(false)
  const [refundChoice, setRefundChoice] = useState<"full" | "partial" | "forfeit">("full")
  const [partialRefundAmount, setPartialRefundAmount] = useState("")

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getAdminList({ filterType: "Refund", limit: 500 })
      const items = (res?.items || []) as Record<string, unknown>[]
      const list = items.filter((i) => (i as { _type?: string })._type === "REFUND").map(mapApiRefundToRefund)
      setRefunds(list)
    } catch (e) {
      console.error(e)
      setRefunds([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const getFilteredRefunds = (status: string) => {
    return refunds.filter((r) => {
      const matchStatus = status === "all" || r.status === status
      const matchSearch =
        r.tenant.toLowerCase().includes(search.toLowerCase()) ||
        r.room.toLowerCase().includes(search.toLowerCase()) ||
        r.id.toLowerCase().includes(search.toLowerCase())
      const matchProperty = propertyFilter === "all" || r.property === propertyFilter
      return matchStatus && matchSearch && matchProperty
    })
  }

  const pendingRefunds = getFilteredRefunds("pending")
  const approvedRefunds = getFilteredRefunds("approved")
  const completedRefunds = getFilteredRefunds("completed")
  const rejectedRefunds = getFilteredRefunds("rejected")

  const renderIdCell = (refund: Refund) => {
    const invoiceId = String(refund.forfeitInvoiceId || "").trim()
    const invoiceLabel = String(refund.forfeitInvoiceLabel || invoiceId).trim()
    const moneyOutIds = Array.from(
      new Set(
        [String(refund.refundMoneyOutId || "").trim(), String(refund.forfeitMoneyOutId || "").trim()].filter(Boolean)
      )
    )
    const moneyOutLabels = Array.from(
      new Set(
        [
          String(refund.accountingRefLabel || refund.refundMoneyOutId || "").trim(),
          String(refund.forfeitMoneyOutLabel || refund.forfeitMoneyOutId || "").trim(),
        ].filter(Boolean)
      )
    )
    // Keep original refund id when there is no invoice id.
    // Only switch to accounting ids when invoice exists (invoice + money out).
    if (!invoiceId) {
      return <span className="font-mono text-xs">{refund.id}</span>
    }
    return (
      <div className="text-xs leading-5">
        <p className="font-mono">{invoiceLabel}{moneyOutLabels.length > 0 ? ` | ${moneyOutLabels.join(" + ")}` : ""}</p>
        {moneyOutIds.length > 0 && moneyOutLabels.length === 0 ? <p className="font-mono">{moneyOutIds.join(" + ")}</p> : null}
      </div>
    )
  }

  const handleUpdateRefund = async (
    id: string,
    opts: { done?: boolean; status?: "pending" | "approved" | "completed" | "rejected"; refundAmount?: number; paymentDate?: string; paymentMethod?: string }
  ) => {
    setActionLoading(id)
    try {
      await updateRefund(id, opts)
      await loadData()
      setShowProcessDialog(false)
      setSelectedRefund(null)
    } catch (e) {
      console.error(e)
      window.alert(e instanceof Error ? e.message : "Failed to update refund.")
    } finally {
      setActionLoading(null)
    }
  }

  const handleVoidCompleted = async (refund: Refund) => {
    const ok = window.confirm("Void this completed refund and move it back to Approved?")
    if (!ok) return
    await handleUpdateRefund(refund.id, { status: "approved" })
  }

  const openAccountingDoc = (refund: Refund) => {
    const opened: string[] = []
    const open = (url: string) => {
      const u = String(url || "").trim()
      if (!u || !/^https?:\/\//i.test(u)) return
      window.open(u, "_blank")
      opened.push(u)
    }

    // Refund money out (full refund or partial refund part)
    open(String(refund.accountingRefUrl || ""))

    // Forfeit accounting can be stored as JSON snapshot in forfeitAccountingRefUrl
    const forfeitRaw = String(refund.forfeitAccountingRefUrl || "").trim()
    if (forfeitRaw) {
      try {
        const parsed = JSON.parse(forfeitRaw) as { invoiceUrl?: string; moneyOutUrl?: string }
        open(String(parsed?.invoiceUrl || ""))
        open(String(parsed?.moneyOutUrl || ""))
      } catch {
        open(forfeitRaw)
      }
    }

    if (opened.length > 0) return

    const refId = String(refund.accountingRefId || "").trim()
    const provider = String(refund.accountingProvider || "").trim()
    const forfeitRefId = String(refund.forfeitAccountingRefId || "").trim()
    const forfeitProvider = String(refund.forfeitAccountingProvider || "").trim()
    if (refId || forfeitRefId) {
      window.alert(
        [
          refId ? `Refund money out (${provider || "accounting"}): ${refId}` : "",
          forfeitRefId ? `Forfeit invoice/money out (${forfeitProvider || "accounting"}): ${forfeitRefId}` : "",
        ].filter(Boolean).join("\n")
      )
      return
    }
    window.alert("No accounting reference found for this completed refund.")
  }

  const getAccountingLinks = (refund: Refund) => {
    const forfeitRaw = String(refund.forfeitAccountingRefUrl || "").trim()
    let forfeitInvoiceUrl = ""
    let forfeitMoneyOutUrl = ""
    if (forfeitRaw) {
      try {
        const parsed = JSON.parse(forfeitRaw) as { invoiceUrl?: string; moneyOutUrl?: string }
        forfeitInvoiceUrl = String(parsed?.invoiceUrl || "").trim()
        forfeitMoneyOutUrl = String(parsed?.moneyOutUrl || "").trim()
      } catch {
        // ignore
      }
    }
    const refundMoneyOutUrl = normalizeHttpUrl(refund.accountingRefUrl)
    return {
      forfeitInvoiceUrl: normalizeHttpUrl(forfeitInvoiceUrl),
      forfeitMoneyOutUrl: normalizeHttpUrl(forfeitMoneyOutUrl),
      refundMoneyOutUrl,
    }
  }

  const openDetail = (refund: Refund) => {
    setSelectedRefund(refund)
    setShowDetailDialog(true)
  }

  const openProcess = (refund: Refund, action: "approve" | "reject" | "complete") => {
    setSelectedRefund(refund)
    setProcessAction(action)
    if (action === "complete") {
      setMarkPaidMethod("")
      const deposit = Number(refund.depositAmount || 0)
      const targetRefund = Number(refund.refundAmount || 0)
      if (targetRefund <= 0) {
        setRefundChoice("forfeit")
        setPartialRefundAmount("")
      } else if (deposit > 0 && targetRefund < deposit) {
        setRefundChoice("partial")
        setPartialRefundAmount(String(targetRefund))
      } else {
        setRefundChoice("full")
        setPartialRefundAmount("")
      }
    } else {
      setRefundChoice("full")
      setPartialRefundAmount("")
    }
    setShowProcessDialog(true)
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = (refundList: Refund[]) => {
    const ids = refundList.map((r) => r.id)
    const allSelected = ids.every((id) => selectedIds.has(id))
    if (allSelected) setSelectedIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n })
    else setSelectedIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.add(id)); return n })
  }

  const handleMarkPaidSubmit = async () => {
    if (selectedIds.size === 0) return
    if (!markPaidMethod) return
    setMarkPaidLoading(true)
    try {
      await bulkUpdateRefunds(Array.from(selectedIds), { status: "completed", paymentDate: markPaidDate, paymentMethod: markPaidMethod })
      setSelectedIds(new Set())
      setShowMarkPaidDialog(false)
      await loadData()
    } catch (e) {
      console.error(e)
    } finally {
      setMarkPaidLoading(false)
    }
  }

  const openBankFileDialog = () => {
    if (!selectedBank) setSelectedBank("publicbank")
    setShowBankFileDialog(true)
    if (bankOptions.length === 0) {
      getBankBulkTransferBanks().then((res) => {
        const banks = (res?.banks ?? []) as Array<{ label: string; value: string }>
        setBankOptions(banks.length ? banks : [{ label: "Public Bank MY", value: "publicbank" }])
      })
    }
  }

  const handleBankFileDownload = async () => {
    if (!selectedBank || selectedIds.size === 0) return
    setBankFileLoading(true)
    try {
      const res = await getBankBulkTransferDownloadUrl({ bank: selectedBank, type: "refund", ids: Array.from(selectedIds) })
      const urls = (res?.urls ?? []) as Array<{ filename: string; url: string }>
      if (urls[0]?.url) window.open(urls[0].url, "_blank")
    } catch (e) {
      console.error(e)
    } finally {
      setBankFileLoading(false)
    }
  }

  const handleProcess = () => {
    if (!selectedRefund) return
    if (processAction === "approve") {
      handleUpdateRefund(selectedRefund.id, { status: "approved" })
      setActiveTab("approved")
    } else if (processAction === "complete") {
      let refundAmount: number | undefined
      if (refundChoice === "forfeit") refundAmount = 0
      else if (refundChoice === "full") refundAmount = Number(selectedRefund.depositAmount || 0)
      else if (refundChoice === "partial") {
        const n = Number(partialRefundAmount)
        if (Number.isNaN(n) || n <= 0 || n > selectedRefund.depositAmount) return
        refundAmount = n
      }
      if (!markPaidDate || !markPaidMethod) return
      handleUpdateRefund(selectedRefund.id, {
        status: "completed",
        refundAmount,
        paymentDate: markPaidDate,
        paymentMethod: markPaidMethod
      })
      setActiveTab("completed")
    } else if (processAction === "reject") {
      handleUpdateRefund(selectedRefund.id, { status: "rejected" })
      setActiveTab("rejected")
    }
    setShowProcessDialog(false)
  }

  const RefundTable = ({ refunds, showActions = false, isLoading = false, showCheckbox = false }: { refunds: Refund[]; showActions?: boolean; isLoading?: boolean; showCheckbox?: boolean }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {showCheckbox && (
              <th className="w-10 py-3 px-2 text-center">
                <input
                  type="checkbox"
                  checked={refunds.length > 0 && refunds.every((r) => selectedIds.has(r.id))}
                  onChange={() => toggleSelectAll(refunds)}
                  className="rounded border-border"
                />
              </th>
            )}
            <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground">ID</th>
            <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground">Tenant</th>
            <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground hidden sm:table-cell">Room</th>
            <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground hidden md:table-cell">Deposit</th>
            <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground hidden md:table-cell">Deductions</th>
            <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground">Refund</th>
            <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground hidden lg:table-cell">Request Date</th>
            <th className="text-left py-3 px-4 font-semibold text-xs text-muted-foreground">Status</th>
            <th className="text-center py-3 px-4 font-semibold text-xs text-muted-foreground">Actions</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={showCheckbox ? 9 : 8} className="py-12 text-center text-muted-foreground">Loading...</td></tr>
          ) : refunds.length === 0 ? (
            <tr>
              <td colSpan={showCheckbox ? 10 : 9} className="text-center py-12 text-muted-foreground text-sm">
                No refunds found.
              </td>
            </tr>
          ) : (
            refunds.map((refund) => {
              const statusConfig = STATUS_CONFIG[refund.status]
              const StatusIcon = statusConfig.icon
              return (
                <tr key={refund.id} className="border-b border-border hover:bg-secondary/30 transition-colors">
                  {showCheckbox && (
                    <td className="w-10 py-3 px-2 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(refund.id)}
                        onChange={() => toggleSelect(refund.id)}
                        className="rounded border-border"
                      />
                    </td>
                  )}
                  <td className="py-3 px-4">{renderIdCell(refund)}</td>
                  <td className="py-3 px-4">
                    <div>
                      <p className="font-semibold">{refund.tenant}</p>
                      <p className="text-xs text-muted-foreground hidden sm:block">{refund.tenantEmail}</p>
                    </div>
                  </td>
                  <td className="py-3 px-4 hidden sm:table-cell">
                    <p className="text-muted-foreground">{refund.room}</p>
                    <p className="text-xs text-muted-foreground">{refund.property}</p>
                  </td>
                  <td className="py-3 px-4 hidden md:table-cell font-medium">{currencySymbol} {refund.depositAmount.toLocaleString()}</td>
                  <td className="py-3 px-4 hidden md:table-cell text-destructive font-medium">
                    {refund.deductions > 0 ? `-${currencySymbol} ${refund.deductions.toLocaleString()}` : "-"}
                  </td>
                  <td className="py-3 px-4 font-bold" style={{ color: "var(--brand)" }}>
                    {currencySymbol} {refund.refundAmount.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 hidden lg:table-cell text-xs text-muted-foreground">{refund.requestDate}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${statusConfig.color}`}>
                      <StatusIcon size={11} />
                      {statusConfig.label}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm">
                            <MoreHorizontal size={14} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => openDetail(refund)}>
                            <Eye size={14} className="mr-2" /> View Details
                          </DropdownMenuItem>
                          {showActions && refund.status === "pending" && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => openProcess(refund, "approve")}>
                                <CheckCircle size={14} className="mr-2" /> Approve
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openProcess(refund, "reject")} className="text-destructive">
                                <XCircle size={14} className="mr-2" /> Reject
                              </DropdownMenuItem>
                            </>
                          )}
                          {refund.status === "approved" && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => openProcess(refund, "complete")}>
                                <CheckCircle size={14} className="mr-2" /> Mark Completed
                              </DropdownMenuItem>
                            </>
                          )}
                          {refund.status === "completed" && (
                            <>
                              <DropdownMenuSeparator />
                              {(() => {
                                const links = getAccountingLinks(refund)
                                const hasRefundUrl = !!(links.refundMoneyOutUrl || links.forfeitMoneyOutUrl)
                                return (
                                  <>
                                    <DropdownMenuItem
                                      disabled={!links.forfeitInvoiceUrl}
                                      onClick={() => {
                                        if (links.forfeitInvoiceUrl) window.open(links.forfeitInvoiceUrl, "_blank")
                                        else openAccountingDoc(refund)
                                      }}
                                    >
                                      <ArrowUpRight size={14} className="mr-2" /> Invoice
                                    </DropdownMenuItem>
                                    {hasRefundUrl && (
                                      <DropdownMenuItem
                                        onClick={() => {
                                          const u = links.refundMoneyOutUrl || links.forfeitMoneyOutUrl
                                          if (u) window.open(u, "_blank")
                                          else openAccountingDoc(refund)
                                        }}
                                      >
                                        <ArrowUpRight size={14} className="mr-2" /> Refund
                                      </DropdownMenuItem>
                                    )}
                                  </>
                                )
                              })()}
                              <DropdownMenuItem onClick={() => void handleVoidCompleted(refund)} className="text-destructive">
                                <ArrowUpRight size={14} className="mr-2" /> Void (Back to Approved)
                              </DropdownMenuItem>
                            </>
                          )}
                          {refund.status === "rejected" && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleUpdateRefund(refund.id, { status: "pending" })}>
                                <ArrowUpRight size={14} className="mr-2" /> Undo (Back to Pending)
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )

  return (
    <main className="p-3 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Deposit Refunds</h1>
          <p className="text-sm text-muted-foreground">Manage and process tenant deposit refunds</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {selectedIds.size > 0 && (
            <>
              <Button variant="default" className="gap-2" style={{ background: "var(--brand)" }} onClick={() => setShowMarkPaidDialog(true)}>
                <CheckCircle size={16} /> Mark as paid ({selectedIds.size})
              </Button>
              <Button variant="outline" className="gap-2" onClick={openBankFileDialog}>
                <Download size={16} /> Download bank file
              </Button>
            </>
          )}
          <Button variant="outline" className="gap-2 flex-shrink-0">
            <Download size={16} /> Export
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-yellow-100">
                <Clock size={18} className="text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{refunds.filter(r => r.status === "pending").length}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-100">
                <CheckCircle size={18} className="text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{refunds.filter(r => r.status === "approved").length}</p>
                <p className="text-xs text-muted-foreground">Approved</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-green-100">
                <CheckCircle size={18} className="text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{refunds.filter(r => r.status === "completed").length}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "var(--brand-light)" }}>
                <Banknote size={18} style={{ color: "var(--brand)" }} />
              </div>
              <div>
                <p className="text-2xl font-bold">{currencySymbol} {refunds.filter(r => r.status === "pending").reduce((sum, r) => sum + r.refundAmount, 0).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Pending Amount</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
              <Input
                placeholder="Search by tenant, room, or ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={propertyFilter} onValueChange={setPropertyFilter}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Property" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Properties</SelectItem>
                <SelectItem value="Vibrant">Vibrant</SelectItem>
                <SelectItem value="Serenity">Serenity</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="pending" className="gap-2">
            Pending
            {pendingRefunds.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0.5 text-xs">{pendingRefunds.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="approved" className="gap-2">
            Approved
            {approvedRefunds.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0.5 text-xs">{approvedRefunds.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>

        <Card>
          <CardContent className="p-0">
            <TabsContent value="pending" className="m-0">
              <RefundTable refunds={pendingRefunds} showActions isLoading={loading} />
            </TabsContent>
            <TabsContent value="approved" className="m-0">
              <RefundTable refunds={approvedRefunds} showActions showCheckbox isLoading={loading} />
            </TabsContent>
            <TabsContent value="completed" className="m-0">
              <RefundTable refunds={completedRefunds} isLoading={loading} />
            </TabsContent>
            <TabsContent value="rejected" className="m-0">
              <RefundTable refunds={rejectedRefunds} isLoading={loading} />
            </TabsContent>
            <TabsContent value="all" className="m-0">
              <RefundTable refunds={getFilteredRefunds("all")} showActions showCheckbox isLoading={loading} />
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>

      {/* Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Refund Details - {selectedRefund?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              {selectedRefund && (
                <Badge className={STATUS_CONFIG[selectedRefund.status].color}>
                  {STATUS_CONFIG[selectedRefund.status].label}
                </Badge>
              )}
            </div>

            <div className="p-4 rounded-lg bg-secondary/30 space-y-3">
              <div className="flex items-center gap-3">
                <User size={16} className="text-muted-foreground" />
                <div>
                  <p className="font-semibold">{selectedRefund?.tenant}</p>
                  <p className="text-xs text-muted-foreground">{selectedRefund?.tenantEmail}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Home size={16} className="text-muted-foreground" />
                <div>
                  <p className="font-medium">{selectedRefund?.room}</p>
                  <p className="text-xs text-muted-foreground">{selectedRefund?.property}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Termination Date</p>
                <p className="font-medium">{selectedRefund?.terminationDate}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Request Date</p>
                <p className="font-medium">{selectedRefund?.requestDate}</p>
              </div>
              {selectedRefund?.processedDate && (
                <div>
                  <p className="text-xs text-muted-foreground">Processed Date</p>
                  <p className="font-medium">{selectedRefund.processedDate}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">Reason</p>
                <p className="font-medium">{selectedRefund?.reason}</p>
              </div>
            </div>

            <div className="border-t border-border pt-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deposit Amount</span>
                <span className="font-medium">{currencySymbol} {selectedRefund?.depositAmount?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-destructive">
                <span>Deductions</span>
                <span className="font-medium">
                  {Number(selectedRefund?.deductions || 0) > 0
                    ? `- ${currencySymbol} ${Number(selectedRefund?.deductions || 0).toLocaleString()}`
                    : `${currencySymbol} 0`}
                </span>
              </div>
              <div className="flex justify-between text-lg font-bold pt-2 border-t border-border">
                <span>Refund Amount</span>
                <span style={{ color: "var(--brand)" }}>{currencySymbol} {selectedRefund?.refundAmount?.toLocaleString()}</span>
              </div>
            </div>

            {selectedRefund?.bankName && (
              <div className="p-3 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground mb-1">Bank Details</p>
                <p className="font-medium">{selectedRefund.bankName}</p>
                <p className="text-sm text-muted-foreground font-mono">{selectedRefund.bankAccount}</p>
              </div>
            )}

            {selectedRefund?.notes && (
              <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-200">
                <p className="text-xs text-yellow-700 font-semibold mb-1">Notes</p>
                <p className="text-sm text-yellow-800">{selectedRefund.notes}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetailDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Process Dialog */}
      <Dialog open={showProcessDialog} onOpenChange={setShowProcessDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {processAction === "approve" && "Approve Refund"}
              {processAction === "reject" && "Reject Refund"}
              {processAction === "complete" && "Mark as Completed"}
            </DialogTitle>
            <DialogDescription>
              {processAction === "approve" && `Approve refund of ${currencySymbol} ${selectedRefund?.refundAmount?.toLocaleString()} for ${selectedRefund?.tenant}`}
              {processAction === "reject" && `Reject refund request from ${selectedRefund?.tenant}`}
              {processAction === "complete" && `Mark refund of ${currencySymbol} ${selectedRefund?.refundAmount?.toLocaleString()} as completed`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {processAction === "approve" && (
              <>
                <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                  <p className="text-sm text-blue-800">
                    This will set status to Approved only. No accounting entry is created until you click Mark Completed.
                  </p>
                </div>
              </>
            )}
            {processAction === "reject" && (
              <>
                <div className="p-4 rounded-lg bg-red-50 border border-red-200">
                  <p className="text-sm text-red-800">
                    This will reject the refund request. The tenant will be notified.
                  </p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Rejection Reason</label>
                  <textarea
                    placeholder="Enter reason for rejection..."
                    rows={3}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground resize-none"
                  />
                </div>
              </>
            )}
            {processAction === "complete" && (
              <>
                <div className="p-4 rounded-lg bg-green-50 border border-green-200">
                  <p className="text-sm text-green-800">
                    Confirm bank transfer details. Accounting entry is created only after this action.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Payment date</label>
                    <Input type="date" value={markPaidDate} onChange={(e) => setMarkPaidDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Payment method</label>
      <Select value={markPaidMethod} onValueChange={(v) => setMarkPaidMethod(v as "" | "Bank" | "Cash")}>
        <SelectTrigger><SelectValue placeholder="Select payment method" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Bank">Bank</SelectItem>
                        <SelectItem value="Cash">Cash</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Refund & Forfeit</label>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="refundChoiceComplete" checked={refundChoice === "full"} onChange={() => setRefundChoice("full")} className="rounded border-border" />
                      <span>Refund full ({currencySymbol} {selectedRefund?.depositAmount?.toLocaleString()})</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="refundChoiceComplete" checked={refundChoice === "partial"} onChange={() => setRefundChoice("partial")} className="rounded border-border" />
                      <span>Partial: refund {currencySymbol}</span>
                      <Input type="number" min={0} max={selectedRefund?.depositAmount ?? 0} step={0.01} value={partialRefundAmount} onChange={(e) => setPartialRefundAmount(e.target.value)} placeholder="0" className="w-24" disabled={refundChoice !== "partial"} />
                      <span className="text-muted-foreground text-xs">(rest = forfeit)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="refundChoiceComplete" checked={refundChoice === "forfeit"} onChange={() => setRefundChoice("forfeit")} className="rounded border-border" />
                      <span>Forfeit full (no refund)</span>
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowProcessDialog(false)}>Cancel</Button>
            <Button
              variant={processAction === "reject" ? "destructive" : "default"}
              style={processAction !== "reject" ? { background: "var(--brand)" } : undefined}
              onClick={handleProcess}
              disabled={processAction === "complete" && (!markPaidDate || !markPaidMethod)}
            >
              {processAction === "approve" && "Approve Refund"}
              {processAction === "reject" && "Reject Refund"}
              {processAction === "complete" && "Mark Completed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark as paid (bulk) */}
      <Dialog open={showMarkPaidDialog} onOpenChange={setShowMarkPaidDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as paid</DialogTitle>
            <DialogDescription>
              Set payment date and method for {selectedIds.size} selected refund(s). This creates an entry in your accounting (Bukku/Xero/AutoCount/SQL).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Payment date</label>
              <Input type="date" value={markPaidDate} onChange={(e) => setMarkPaidDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Payment method</label>
              <Select value={markPaidMethod} onValueChange={(v) => setMarkPaidMethod(v as "" | "Bank" | "Cash")}>
                <SelectTrigger><SelectValue placeholder="Select payment method" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Bank">Bank</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMarkPaidDialog(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleMarkPaidSubmit} disabled={markPaidLoading || !markPaidMethod}>
              {markPaidLoading ? "Saving..." : "Mark as paid"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Download bank file */}
      <Dialog open={showBankFileDialog} onOpenChange={setShowBankFileDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Download bank file</DialogTitle>
            <DialogDescription>Select bank and download CSV for {selectedIds.size} selected refund(s).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Bank</label>
              <Select value={selectedBank || (bankOptions[0]?.value ?? "publicbank")} onValueChange={setSelectedBank}>
                <SelectTrigger><SelectValue placeholder="Select bank" /></SelectTrigger>
                <SelectContent>
                  {(bankOptions.length ? bankOptions : [{ label: "Public Bank MY", value: "publicbank" }]).map((b) => (
                    <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBankFileDialog(false)}>Cancel</Button>
            <Button style={{ background: "var(--brand)" }} onClick={handleBankFileDownload} disabled={bankFileLoading || !(selectedBank || "publicbank")}>
              {bankFileLoading ? "Preparing..." : "Download CSV"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
