"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { getAgreementList, getOwner } from "@/lib/owner-api"

export interface OwnerProfile {
  _id?: string
  id?: string
  ownerName?: string
  email?: string
  mobileNumber?: string
  nric?: string
  bankName?: string | { _id?: string }
  bankAccount?: string
  accountholder?: string
  nricFront?: string
  nricback?: string
  profile?: {
    entity_type?: string
    reg_no_type?: string
    id_type?: string
    tax_id_no?: string
    avatar_url?: string
    address?: { street?: string; city?: string; state?: string; postcode?: string } | string
  }
  property?: string[] | { _id: string }[]
  client?: string[]
  /** Operators linked to this owner (junction + legacy + properties); contact for WhatsApp */
  linkedOperators?: Array<{ clientId: string; title: string; contact: string }>
  /** ISO from portal_account — gate requires this + complete fields */
  profileSelfVerifiedAt?: string | null
  /** Server: self-attest or Aliyun eKYC */
  profileIdentityVerified?: boolean
}

function ownerAddressLine(o: OwnerProfile): string {
  const a = o.profile?.address
  if (typeof a === "string") return a.trim()
  if (a && typeof a === "object") {
    return [a.street, a.city, a.state, a.postcode]
      .filter((v) => v != null && String(v).trim())
      .map((v) => String(v).trim())
      .join(", ")
      .trim()
  }
  return ""
}

function ownerBankId(o: OwnerProfile): string {
  const b = o.bankName
  if (b && typeof b === "object" && "_id" in b) return String((b as { _id?: string })._id || "").trim()
  return String(b || "").trim()
}

interface OwnerState {
  owner: OwnerProfile | null
  loading: boolean
  error: string | null
  refetch: () => Promise<OwnerProfile | null | void>
  /** Derived: owner has saved profile (ownerdetail row exists); must be true before navigating to other pages */
  profileComplete: boolean
  /** Derived: owner has at least one agreement waiting for owner signature. */
  hasPendingAgreement: boolean
}

const OwnerContext = createContext<OwnerState | null>(null)

export function OwnerProvider({ children }: { children: ReactNode }) {
  const [owner, setOwner] = useState<OwnerProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasPendingAgreement, setHasPendingAgreement] = useState(false)

  const fetchOwner = useCallback(async (): Promise<OwnerProfile | null | void> => {
    setLoading(true)
    setError(null)
    try {
      const res = await getOwner()
      if (res?.ok && res.owner != null) {
        const data = res.owner as OwnerProfile
        setOwner(data)
        try {
          const ownerId = data._id || data.id || ""
          if (!ownerId) {
            setHasPendingAgreement(false)
          } else {
            const listRes = await getAgreementList({ ownerId: String(ownerId) })
            const items = (listRes?.items || []) as Array<{ status?: string }>
            const pending = items.some((row) => {
              const st = String(row?.status || "").trim().toLowerCase()
              return st === "pending" || st === "ready_for_signature"
            })
            setHasPendingAgreement(pending)
          }
        } catch {
          setHasPendingAgreement(false)
        }
        return data
      }
      setOwner(null)
      setHasPendingAgreement(false)
      return null
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong"
      console.error("[OwnerProvider] getOwner failed:", msg)
      setError(msg)
      setOwner(null)
      setHasPendingAgreement(false)
      return
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOwner()
  }, [fetchOwner])

  const profileFieldsComplete = useMemo(() => {
    if (!owner) return false
    const prof = owner.profile || {}
    const legalName = String(owner.ownerName || "").trim()
    const entityType = String(prof.entity_type || "").trim()
    const idType = String((prof as { id_type?: string }).id_type || prof.reg_no_type || "").trim()
    const nric = String(owner.nric || "").trim()
    const phone = String(owner.mobileNumber || "").trim()
    const address = ownerAddressLine(owner)
    const bankId = ownerBankId(owner)
    const bankAccount = String(owner.bankAccount || "").trim()
    const accHolder = String(owner.accountholder || "").trim()
    const nf = String(owner.nricFront || "").trim()
    const nb = String(owner.nricback || "").trim()
    const exempt = entityType === "EXEMPTED_PERSON"
    const isSingaporeEntity = entityType === "FOREIGN_INDIVIDUAL" || entityType === "FOREIGN_COMPANY"
    const normalizedIdType = idType.toUpperCase()
    const requiresBackImage = normalizedIdType !== "PASSPORT"
    return Boolean(
      legalName &&
        entityType &&
        idType &&
        phone &&
        address &&
        (isSingaporeEntity || (bankId && bankAccount && accHolder)) &&
        (exempt || (nric && nf && (!requiresBackImage || nb)))
    )
  }, [owner])

  const profileSelfVerified = useMemo(
    () =>
      owner?.profileIdentityVerified === true ||
      (owner?.profileSelfVerifiedAt != null && String(owner.profileSelfVerifiedAt).trim() !== ""),
    [owner]
  )

  const profileComplete = profileFieldsComplete && profileSelfVerified

  const value = useMemo<OwnerState>(
    () => ({
      owner,
      loading,
      error,
      refetch: fetchOwner,
      profileComplete,
      hasPendingAgreement,
    }),
    [owner, loading, error, fetchOwner, profileComplete, hasPendingAgreement]
  )

  return (
    <OwnerContext.Provider value={value}>
      {children}
    </OwnerContext.Provider>
  )
}

export function useOwner(): OwnerState {
  const ctx = useContext(OwnerContext)
  if (!ctx) {
    throw new Error("useOwner must be used within OwnerProvider")
  }
  return ctx
}

export function useOwnerOptional(): OwnerState | null {
  return useContext(OwnerContext)
}
