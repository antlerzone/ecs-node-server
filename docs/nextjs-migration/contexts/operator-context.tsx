"use client"

import React, { createContext, useContext, useEffect, useState, useCallback } from "react"
import { getMember, getCurrentRole, setCurrentRole } from "@/lib/portal-session"
import {
  getAccessContext,
  getMyBillingInfo,
  getProfile,
  getOperatorBankDetails,
  getAdminList,
  getTermsSaasOperator,
  getPaymentVerificationInvoices,
  type AccessContextResponse,
} from "@/lib/operator-api"

export type StaffPermission = Record<string, boolean>

interface OperatorContextValue {
  accessCtx: AccessContextResponse | null
  permission: StaffPermission
  creditBalance: number
  creditOk: boolean
  clientTitle: string | null
  companyProfileComplete: boolean
  /** True when operator My Profile has all mandatory fields (entity/id/nric, contact, address, docs, bank). */
  personalProfileComplete: boolean
  /** True when operator has signed SaaS–Operator Terms & Conditions (required after profile). */
  termsAccepted: boolean
  /** True when client has accounting plan/addon (show Accounting menu; else hide and redirect). */
  hasAccountingCapability: boolean
  /** Elite / Enterprise / Enterprise Plus — third-party integration tier (see pricing). */
  hasThirdPartyIntegrationCapability: boolean
  /** Malaysia (MYR) operator — Cleanlemons partner integration (not gated on pricing plan). */
  hasCleanlemonsPartnerCapability: boolean
  feedbackPendingCount: number
  paymentVerificationPendingCount: number
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const OperatorContext = createContext<OperatorContextValue | null>(null)

export function useOperatorContext() {
  const ctx = useContext(OperatorContext)
  if (!ctx) throw new Error("useOperatorContext must be used within OperatorProvider")
  return ctx
}

const DEFAULT_PERMISSION: StaffPermission = {}

export function OperatorProvider({ children }: { children: React.ReactNode }) {
  const [accessCtx, setAccessCtx] = useState<AccessContextResponse | null>(null)
  const [permission, setPermission] = useState<StaffPermission>(DEFAULT_PERMISSION)
  const [creditBalance, setCreditBalance] = useState(0)
  const [creditOk, setCreditOk] = useState(true)
  const [clientTitle, setClientTitle] = useState<string | null>(null)
  const [companyProfileComplete, setCompanyProfileComplete] = useState(false)
  const [personalProfileComplete, setPersonalProfileComplete] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [hasAccountingCapability, setHasAccountingCapability] = useState(false)
  const [hasThirdPartyIntegrationCapability, setHasThirdPartyIntegrationCapability] = useState(false)
  const [hasCleanlemonsPartnerCapability, setHasCleanlemonsPartnerCapability] = useState(false)
  const [feedbackPendingCount, setFeedbackPendingCount] = useState(0)
  const [paymentVerificationPendingCount, setPaymentVerificationPendingCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const member = getMember()
    if (!member?.email) return

    // Ensure current role is set for staff (first staff role if multiple)
    const staffRoles = member.roles.filter((r) => r.type === "staff")
    if (staffRoles.length > 0 && !getCurrentRole()) {
      const first = staffRoles[0] as { type: string; staffId?: string; clientId?: string; clientTitle?: string }
      setCurrentRole({
        type: "staff",
        staffId: first.staffId,
        clientId: first.clientId ?? undefined,
        clientTitle: first.clientTitle ?? undefined,
      })
    }

    // IMPORTANT: never use `getCurrentRole()?.clientId ?? staffRoles[0] ? staffRoles[0].clientId : null`
    // — ?? binds tighter than ?:, so it becomes `(a ?? b) ? first.clientId : null` and always picks the
    // first staff company when a clientId is selected (wrong for multi-company operators).
    const role = getCurrentRole()
    const firstStaff = staffRoles[0] as { clientId?: string } | undefined
    const clientId = role?.clientId ?? firstStaff?.clientId ?? null

    setError(null)
    try {
      const [ctxRes, billingRes] = await Promise.all([
        getAccessContext(clientId ?? undefined),
        getMyBillingInfo(),
      ])

      if (!ctxRes.ok) {
        setError(ctxRes.reason ?? "Access denied")
        setAccessCtx(ctxRes)
        return
      }
      setAccessCtx(ctxRes)
      const resolvedClientId = ctxRes.client?.id && String(ctxRes.client.id).trim()
      if (resolvedClientId) {
        const cr = getCurrentRole()
        if (cr?.type === "staff" && !cr.clientId) {
          setCurrentRole({
            ...cr,
            clientId: resolvedClientId,
            clientTitle: ctxRes.client?.title ?? cr.clientTitle,
          })
        }
      }
      setClientTitle(ctxRes.client?.title ?? null)
      setPermission((ctxRes.staff?.permission as StaffPermission) ?? DEFAULT_PERMISSION)
      const staff = (ctxRes.staff as {
        name?: string
        /** portal_account.fullname — access merges; client_user.name may lag after profile save */
        fullname?: string | null
        nric?: string
        phone?: string
        address?: string
        nricfront?: string
        nricback?: string
        bankname_id?: string | null
        bankaccount?: string
        accountholder?: string
        /** Portal_account + access merge — may be on staff root, not only staffdetail.profile JSON */
        entity_type?: string
        reg_no_type?: string
        id_type?: string
        tax_id_no?: string
        profile?: { entity_type?: string; reg_no_type?: string; id_type?: string; tax_id_no?: string }
      } | undefined) ?? {}
      const legalName = String(staff.name || staff.fullname || "").trim()
      const nric = String(staff.nric || staff.tax_id_no || staff.profile?.tax_id_no || "").trim()
      const entityType = String(staff.entity_type || staff.profile?.entity_type || "").trim()
      const idType = String(
        staff.id_type || staff.reg_no_type || staff.profile?.id_type || staff.profile?.reg_no_type || ""
      ).trim()
      const mobileNumber = String(staff.phone || "").trim()
      const addressLine = String(staff.address || "").trim()
      const nricFront = String(staff.nricfront || "").trim()
      const nricBack = String(staff.nricback || "").trim()
      let bankId = String(staff.bankname_id ?? "").trim()
      let bankAccount = String(staff.bankaccount || "").trim()
      let bankHolder = String(staff.accountholder || "").trim()
      if (!bankId || !bankAccount || !bankHolder) {
        try {
          const bankRes = await getOperatorBankDetails(clientId ? { clientId } : undefined)
          if ((bankRes as { ok?: boolean })?.ok !== false) {
            const b = bankRes as { bankId?: string | null; bankaccount?: string; accountholder?: string }
            bankId = bankId || (b.bankId != null && String(b.bankId).trim() ? String(b.bankId).trim() : "")
            bankAccount = bankAccount || String(b.bankaccount || "").trim()
            bankHolder = bankHolder || String(b.accountholder || "").trim()
          }
        } catch {
          /* gate stays false */
        }
      }
      const exemptEntity = entityType === "EXEMPTED_PERSON"
      const isSingaporeEntity = entityType === "FOREIGN_INDIVIDUAL" || entityType === "FOREIGN_COMPANY"
      const normalizedIdType = idType.toUpperCase()
      const requiresBackImage = normalizedIdType !== "PASSPORT"
      setPersonalProfileComplete(
        Boolean(
          legalName &&
            entityType &&
            idType &&
            mobileNumber &&
            addressLine &&
            (isSingaporeEntity || (bankId && bankAccount && bankHolder)) &&
            (exemptEntity || (nric && nricFront && (!requiresBackImage || nricBack)))
        )
      )
      const cap = ctxRes.capability as {
        accounting?: boolean
        thirdPartyIntegration?: boolean
        cleanlemonsPartner?: boolean
      } | undefined
      setHasAccountingCapability(Boolean(cap?.accounting))
      setHasThirdPartyIntegrationCapability(Boolean(cap?.thirdPartyIntegration))
      setHasCleanlemonsPartnerCapability(Boolean(cap?.cleanlemonsPartner))

      // Company (operator company-setting) gate: subdomain, company name, contact, address
      try {
        const profileRes = await getProfile(clientId ? { clientId } : undefined) as {
          ok?: boolean
          client?: { title?: string; currency?: string; subdomain?: string }
          profile?: {
            subdomain?: string
            contact?: string
            address?: string
            accountnumber?: string
            accountholder?: string
            bankId?: string | null
          }
        }
        if (!profileRes?.ok) {
          setCompanyProfileComplete(false)
        } else {
          const p = profileRes.profile ?? {}
          const companyName = String(profileRes.client?.title || "").trim()
          const subdomain = String(p.subdomain || profileRes.client?.subdomain || "").trim()
          const contact = String(p.contact || "").trim()
          const address = String(p.address || "").trim()
          setCompanyProfileComplete(
            Boolean(
              companyName &&
                subdomain &&
                contact &&
                address
            )
          )
        }
      } catch {
        setCompanyProfileComplete(false)
      }

      // Terms & Conditions: operator must sign SaaS–Operator terms after profile is complete
      try {
        const termsRes = await getTermsSaasOperator()
        setTermsAccepted(Boolean(termsRes?.ok && termsRes?.accepted))
      } catch {
        setTermsAccepted(false)
      }

      if (billingRes.noPermission) {
        setCreditOk(false)
        // Fallback: use access context credit (from client_credit) when no billing permission
        const accessBal = (ctxRes as { credit?: { balance?: number } }).credit?.balance
        setCreditBalance(typeof accessBal === "number" ? accessBal : 0)
      } else {
        // getMyBillingInfo returns credit as array [{ type, amount, expired }], not { balance }
        const credits = Array.isArray(billingRes.credit) ? billingRes.credit : []
        const bal = credits.reduce((sum: number, c: unknown) => sum + Number((c as { amount?: number })?.amount || 0), 0)
        setCreditBalance(typeof bal === "number" ? bal : 0)
        setCreditOk(billingRes.credit !== undefined)
      }

      // Pending feedback count for sidebar badge (only when user can see Feedback)
      try {
        const staffPerm = (ctxRes.staff?.permission as StaffPermission) ?? {}
        if (staffPerm.tenantdetail) {
          const adminRes = await getAdminList({ filterType: "Feedback", limit: 500 })
          const items = Array.isArray(adminRes?.items) ? adminRes.items : []
          const pendingOnly = items.filter((item) => !(item as { done?: boolean }).done)
          setFeedbackPendingCount(pendingOnly.length)
        } else {
          setFeedbackPendingCount(0)
        }
      } catch {
        setFeedbackPendingCount(0)
      }

      // Payment verification pending (PENDING_REVIEW) for Approval menu badge
      try {
        if ((ctxRes.staff?.permission as StaffPermission)?.finance || (ctxRes.staff?.permission as StaffPermission)?.integration) {
          const pvRes = await getPaymentVerificationInvoices({ status: "PENDING_REVIEW" })
          const data = Array.isArray(pvRes?.data) ? pvRes.data : []
          setPaymentVerificationPendingCount(data.length)
        } else {
          setPaymentVerificationPendingCount(0)
        }
      } catch {
        setPaymentVerificationPendingCount(0)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load"
      setError(msg.includes("502") || msg.includes("Bad Gateway") ? "Backend unavailable. Please try again in a moment." : msg)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const value: OperatorContextValue = {
    accessCtx,
    permission,
    creditBalance,
    creditOk,
    clientTitle,
    companyProfileComplete,
    personalProfileComplete,
    termsAccepted,
    hasAccountingCapability,
    hasThirdPartyIntegrationCapability,
    hasCleanlemonsPartnerCapability,
    feedbackPendingCount,
    paymentVerificationPendingCount,
    isLoading,
    error,
    refresh,
  }

  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>
}
