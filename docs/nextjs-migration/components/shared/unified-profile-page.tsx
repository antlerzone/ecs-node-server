"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatGovIdErrorReason } from '@/lib/gov-id-callback-messages'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  User,
  Calendar,
  Mail,
  Phone,
  Lock,
  CreditCard,
  Camera,
  Upload,
  X,
  Eye,
  EyeOff,
  ExternalLink,
  ShieldCheck,
  BadgeCheck,
  HelpCircle,
  Check,
  ChevronsUpDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { shouldUseDemoMock } from '@/lib/portal-api'
import { getMember, getCurrentRole, clearPortalSession } from '@/lib/portal-session'
import { uploadFile as tenantUploadFile } from '@/lib/tenant-api'
import { uploadFile as ownerUploadFile } from '@/lib/owner-api'
import { uploadFile as operatorUploadFile } from '@/lib/operator-api'
import {
  fetchProfileBanks,
  fetchPortalProfileByEmail,
  savePortalProfile,
  fetchPortalPasswordStatus,
  requestPortalPasswordResetEmail,
  confirmPortalPasswordReset,
  fetchGovIdStatus,
  startAliyunIdvEkyc,
  fetchAliyunIdvResult,
  requestPortalEmailChangeOtp,
  confirmPortalEmailChange,
  requestPortalPhoneVerifyOtp,
  confirmPortalPhoneVerify,
  requestPortalPhoneChangeOtp,
  confirmPortalPhoneChange,
} from '@/lib/unified-profile-portal-api'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  getTenantProfileIncompleteFields,
  type TenantGateIncompleteField,
  type TenantProfileLite,
} from '@/lib/tenant-gates'
import { GovIdConnectButtons } from '@/components/gov-id-connect-buttons'

type Props = {
  roleLabel: string
  /** OSS upload route: tenantdashboard / ownerportal / operator upload */
  uploadRole: 'tenant' | 'owner' | 'operator'
  /** When demo.colivingjb.com — persist profile in localStorage */
  localStorageKeyDemo?: string
  /** Operator portal: refresh access context so profile gate updates after save (no full reload). */
  onBackendSaveSuccess?: () => void | Promise<void>
  /** Tenant: show button that opens the public `/profile/{id}` page (iframe) + open in new tab. */
  showViewMyProfileButton?: boolean
  /** Wix/CMS tenant UUID for the public profile route (required when showViewMyProfileButton is true). */
  publicProfileTenantId?: string | null
  /** Singpass / MyDigital verification row + avatar badge — only `/demoprofile` (not tenant/owner/operator profile). */
  showGovVerification?: boolean
  /** `/demoprofile` only: no mandatory-field red outlines or gate hint text */
  disableProfileGateUi?: boolean
}

type PhoneCountryOption = {
  code: string
  label: string
}

/** Passport expiry calendar date within 30 days (inclusive) or already past — allow re-eKYC from verification dialog. */
function isPassportRenewalWindow(expiryIso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expiryIso || '').trim())
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const exp = new Date(y, mo - 1, d)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysUntil = Math.floor((exp.getTime() - today.getTime()) / 86400000)
  return daysUntil <= 30
}

const PHONE_COUNTRY_OPTIONS: PhoneCountryOption[] = [
  { code: '60', label: 'Malaysia (+60)' },
  { code: '65', label: 'Singapore (+65)' },
  { code: '62', label: 'Indonesia (+62)' },
  { code: '63', label: 'Philippines (+63)' },
  { code: '66', label: 'Thailand (+66)' },
  { code: '84', label: 'Vietnam (+84)' },
  { code: '86', label: 'China (+86)' },
  { code: '852', label: 'Hong Kong (+852)' },
  { code: '853', label: 'Macau (+853)' },
  { code: '886', label: 'Taiwan (+886)' },
  { code: '91', label: 'India (+91)' },
  { code: '81', label: 'Japan (+81)' },
  { code: '82', label: 'South Korea (+82)' },
  { code: '61', label: 'Australia (+61)' },
  { code: '64', label: 'New Zealand (+64)' },
  { code: '971', label: 'UAE (+971)' },
  { code: '966', label: 'Saudi Arabia (+966)' },
  { code: '44', label: 'United Kingdom (+44)' },
  { code: '1', label: 'United States / Canada (+1)' },
]

const PHONE_COUNTRY_CODES_DESC = [...PHONE_COUNTRY_OPTIONS]
  .map((item) => item.code)
  .sort((a, b) => b.length - a.length)

function normalizePhoneDigits(raw: string): string {
  return String(raw || '').replace(/\D/g, '')
}

function splitPhoneNumberWithCountry(raw: string): { countryCode: string; localNumber: string } {
  const digits = normalizePhoneDigits(raw)
  if (!digits) return { countryCode: '60', localNumber: '' }
  const matched = PHONE_COUNTRY_CODES_DESC.find((code) => digits.startsWith(code))
  if (!matched) return { countryCode: '60', localNumber: digits }
  return { countryCode: matched, localNumber: digits.slice(matched.length) }
}

function joinPhoneNumber(countryCode: string, localNumber: string): string {
  const cc = normalizePhoneDigits(countryCode)
  const local = normalizePhoneDigits(localNumber)
  if (!local) return ''
  return `${cc}${local}`
}

function PhoneCountryCodeSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected =
    PHONE_COUNTRY_OPTIONS.find((x) => x.code === value) ??
    PHONE_COUNTRY_OPTIONS.find((x) => x.code === '60') ??
    PHONE_COUNTRY_OPTIONS[0]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-[11rem] justify-between rounded-xl"
        >
          <span className="truncate">{selected?.label ?? `+${value}`}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[18rem] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search country code..." />
          <CommandList>
            <CommandEmpty>No country code found.</CommandEmpty>
            {PHONE_COUNTRY_OPTIONS.map((opt) => (
              <CommandItem
                key={opt.code}
                value={`${opt.label} ${opt.code}`}
                onSelect={() => {
                  onChange(opt.code)
                  setOpen(false)
                }}
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4',
                    value === opt.code ? 'opacity-100' : 'opacity-0',
                  )}
                />
                {opt.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function syncColivingLocalUser(partial: { name?: string; avatar?: string; hasPassword?: boolean }) {
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem('user')
    const u = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    const next = { ...u } as Record<string, unknown>
    if (partial.name != null) next.name = partial.name
    if (partial.avatar != null) next.avatar = partial.avatar
    if (partial.hasPassword != null) next.hasPassword = partial.hasPassword
    localStorage.setItem('user', JSON.stringify(next))
  } catch {
    // ignore
  }
}

async function uploadProfileFileToOss(
  file: File,
  uploadRole: 'tenant' | 'owner' | 'operator',
  clientId: string
): Promise<{ ok: boolean; url?: string; reason?: string }> {
  if (uploadRole === 'tenant') return tenantUploadFile(file)
  if (uploadRole === 'owner') return ownerUploadFile(file)
  return operatorUploadFile(file, { clientId })
}

export default function UnifiedProfilePage({
  roleLabel,
  uploadRole,
  localStorageKeyDemo,
  onBackendSaveSuccess,
  showViewMyProfileButton = false,
  publicProfileTenantId = null,
  showGovVerification = false,
  disableProfileGateUi = false,
}: Props) {
  const router = useRouter()
  const member = getMember()
  const email = String(member?.email || '').trim()
  const currentRole = getCurrentRole()
  const staffRole = member?.roles?.find((r) => r.type === 'staff') as { clientId?: string } | undefined
  const clientId = String(currentRole?.clientId || staffRole?.clientId || 'op_demo_001')

  const [backendProfile, setBackendProfile] = useState(false)
  const [localStorageKey, setLocalStorageKey] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    const apply = () => {
      if (cancelled) return
      const demo = shouldUseDemoMock()
      const em = String(getMember()?.email || '').trim()
      setBackendProfile(!demo && !!em)
      setLocalStorageKey(demo ? localStorageKeyDemo : undefined)
    }
    apply()
    /** Same-tab login can write `portal_member` after the first effect tick; re-read once tasks flush. */
    const t = typeof window !== 'undefined' ? window.setTimeout(apply, 0) : undefined
    return () => {
      cancelled = true
      if (t != null) window.clearTimeout(t)
    }
    /** Re-sync when `email` appears (session / portal_member hydrates). Previously only [localStorageKeyDemo] ran once with empty email → backendProfile stayed false and Gov row never mounted. */
  }, [localStorageKeyDemo, email])

  const userNameHint = useMemo(() => {
    if (typeof window === 'undefined') return 'User'
    try {
      const raw = localStorage.getItem('user')
      const u = raw ? (JSON.parse(raw) as { name?: string }) : {}
      return String(u.name || email.split('@')[0] || 'User')
    } catch {
      return email.split('@')[0] || 'User'
    }
  }, [email])

  const userAvatarHint = useMemo(() => {
    if (typeof window === 'undefined') return ''
    try {
      const raw = localStorage.getItem('user')
      const u = raw ? (JSON.parse(raw) as { avatar?: string }) : {}
      return String(u.avatar || '')
    } catch {
      return ''
    }
  }, [email])

  const userHasPasswordHint = useMemo(() => {
    if (typeof window === 'undefined') return false
    try {
      const raw = localStorage.getItem('user')
      const u = raw ? (JSON.parse(raw) as { hasPassword?: boolean }) : {}
      return !!u.hasPassword
    } catch {
      return false
    }
  }, [email])
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!showGovVerification || typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const gov = sp.get('gov')
    const reason = sp.get('reason')
    const provider = sp.get('provider')
    const ekyc = sp.get('ekyc')
    const cleanPath = window.location.pathname
    if (gov === 'error' && reason) {
      toast.error(formatGovIdErrorReason(reason))
      router.replace(cleanPath, { scroll: false })
    } else if (gov === 'success') {
      toast.success(`Connected${provider ? ` (${provider})` : ''}`)
      router.replace(cleanPath, { scroll: false })
    } else if (ekyc === '1' && !shouldUseDemoMock()) {
      const tid = sessionStorage.getItem('aliyun_ekyc_tid')
      if (tid) {
        void (async () => {
          const r = await fetchAliyunIdvResult(tid)
          if (r.ok && r.passed) {
            sessionStorage.setItem('aliyun_ekyc_ok', '1')
            sessionStorage.removeItem('aliyun_ekyc_tid')
            const em = String(email || '').trim()
            if (em) {
              const pr = await fetchPortalProfileByEmail(em)
              if (pr.ok && pr.profile) {
                const p = pr.profile as {
                  fullName?: string
                  legalName?: string
                  nickname?: string
                  phone?: string
                  address?: string
                  entityType?: string
                  idType?: string
                  idNumber?: string
                  taxIdNo?: string
                  bankId?: string
                  bankAccountNo?: string
                  bankAccountHolder?: string
                  avatarUrl?: string
                  nricFrontUrl?: string
                  nricBackUrl?: string
                  govIdentityLocked?: boolean
                  aliyunEkycLocked?: boolean
                }
                setFullName(String(p.fullName || ''))
                setLegalName(String(p.legalName || ''))
                setNickname(String(p.nickname || ''))
                setPhone(String(p.phone || ''))
                setAddress(String(p.address || ''))
                setEntityType(String(p.entityType || 'MALAYSIAN_INDIVIDUAL'))
                setIdType(String(p.idType || 'NRIC'))
                setIdNumber(String(p.idNumber || ''))
                setPassportExpiryDate(String((p as { passportExpiryDate?: string }).passportExpiryDate || ''))
                setTaxNo(String(p.taxIdNo || ''))
                setBankId(String(p.bankId || ''))
                setBankAccNo(String(p.bankAccountNo || ''))
                setBankHolder(String(p.bankAccountHolder || ''))
                if (p.avatarUrl) {
                  setAvatarPreview(String(p.avatarUrl))
                  setAvatarUrl(String(p.avatarUrl))
                  syncColivingLocalUser({ avatar: String(p.avatarUrl) })
                }
                if (p.nricFrontUrl) {
                  setNricFront(String(p.nricFrontUrl))
                  setNricFrontUrl(String(p.nricFrontUrl))
                }
                if (p.nricBackUrl) {
                  setNricBack(String(p.nricBackUrl))
                  setNricBackUrl(String(p.nricBackUrl))
                }
                if (typeof p.govIdentityLocked === 'boolean') setGovIdentityLocked(p.govIdentityLocked)
                setAliyunEkycVerified(!!p.aliyunEkycLocked || r.profileApplied === true)
              } else {
                setAliyunEkycVerified(r.profileApplied === true)
              }
            } else {
              setAliyunEkycVerified(true)
            }
            if (r.profileApplied === false && r.profileReason === 'GOV_ID_ALREADY_LINKED') {
              toast.warning('Verified, but name and ID were not saved — a government login is already linked.')
            } else if (r.profileApplied === false && r.profileReason === 'EKYC_OCR_INCOMPLETE') {
              toast.warning('Verified, but name/ID could not be saved automatically. Contact support if needed.')
            }
            toast.success('Identity verification completed')
          } else if (r.ok && r.passed === false) {
            toast.error(
              r.subCode ? `Verification did not pass (${r.subCode})` : 'Verification not completed — try again',
            )
          } else {
            toast.error(r.reason || 'Could not load verification result')
          }
        })()
      }
      router.replace(cleanPath, { scroll: false })
    }
  }, [showGovVerification, router, email])

  const [fullName, setFullName] = useState(userNameHint)
  const [legalName, setLegalName] = useState(userNameHint)
  const [phone, setPhone] = useState('')
  const [entityType, setEntityType] = useState('MALAYSIAN_INDIVIDUAL')
  const [idType, setIdType] = useState('NRIC')
  const [idNumber, setIdNumber] = useState('')
  const [passportExpiryDate, setPassportExpiryDate] = useState('')
  const [taxNo, setTaxNo] = useState('')
  const [nickname, setNickname] = useState('')
  const [address, setAddress] = useState('')
  const [bankId, setBankId] = useState('')
  const [bankAccNo, setBankAccNo] = useState('')
  const [bankHolder, setBankHolder] = useState('')
  const [nricFront, setNricFront] = useState<string | null>(null)
  const [nricBack, setNricBack] = useState<string | null>(null)
  const [nricFrontUrl, setNricFrontUrl] = useState<string | null>(null)
  const [nricBackUrl, setNricBackUrl] = useState<string | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string>(String(userAvatarHint || ''))
  const [avatarUrl, setAvatarUrl] = useState<string>(String(userAvatarHint || ''))
  const [uploadingSide, setUploadingSide] = useState<'front' | 'back' | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [bankOptions, setBankOptions] = useState<Array<{ id: string; name: string }>>([])
  const [isInitializing, setIsInitializing] = useState(true)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [hasPassword, setHasPassword] = useState(!!userHasPasswordHint)
  const [pwdDialogOpen, setPwdDialogOpen] = useState(false)
  const [pwdCodeSent, setPwdCodeSent] = useState(false)
  const [pwdSending, setPwdSending] = useState(false)
  const [pwdSubmitting, setPwdSubmitting] = useState(false)
  const [pwdCode, setPwdCode] = useState('')
  const [pwdNew, setPwdNew] = useState('')
  const [pwdConfirm, setPwdConfirm] = useState('')
  const [showPwdNew, setShowPwdNew] = useState(false)
  const [showPwdConfirm, setShowPwdConfirm] = useState(false)
  const [profilePreviewOpen, setProfilePreviewOpen] = useState(false)
  const [govIdentityLocked, setGovIdentityLocked] = useState(false)
  const [govSingpass, setGovSingpass] = useState(false)
  const [govMydigital, setGovMydigital] = useState(false)
  const [govDialogOpen, setGovDialogOpen] = useState(false)
  const [aliyunEkycVerified, setAliyunEkycVerified] = useState(false)
  const [aliyunEkycStarting, setAliyunEkycStarting] = useState(false)
  const [phoneVerified, setPhoneVerified] = useState(false)

  const [emailChangeOpen, setEmailChangeOpen] = useState(false)
  const [emailNew, setEmailNew] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailStep, setEmailStep] = useState<'enter' | 'code'>('enter')
  const [emailBusy, setEmailBusy] = useState(false)

  const [phoneVerifyOpen, setPhoneVerifyOpen] = useState(false)
  const [phoneVerifyDraft, setPhoneVerifyDraft] = useState('')
  const [phoneVerifyCountryCode, setPhoneVerifyCountryCode] = useState('60')
  const [phoneVerifyLocalNumber, setPhoneVerifyLocalNumber] = useState('')
  const [phoneVerifyCode, setPhoneVerifyCode] = useState('')
  const [phoneVerifyBusy, setPhoneVerifyBusy] = useState(false)

  const [phoneChangeOpen, setPhoneChangeOpen] = useState(false)
  const [phoneChangeNew, setPhoneChangeNew] = useState('')
  const [phoneChangeCountryCode, setPhoneChangeCountryCode] = useState('60')
  const [phoneChangeLocalNumber, setPhoneChangeLocalNumber] = useState('')
  const [phoneChangeCode, setPhoneChangeCode] = useState('')
  const [phoneChangeBusy, setPhoneChangeBusy] = useState(false)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedPayloadRef = useRef<string>('')
  const didInitSnapshotRef = useRef(false)
  /** After Aliyun eKYC, align auto-save baseline once so a pending timer does not POST stale identity fields. */
  const prevAliyunVerifiedForSnapshotRef = useRef(false)

  const displayNameForCard = useMemo(
    () => String(nickname || legalName || fullName || 'User').trim() || 'User',
    [nickname, legalName, fullName]
  )

  const idTypeU = useMemo(() => String(idType || '').toUpperCase(), [idType])

  const publicProfilePath = useMemo(() => {
    const id = String(publicProfileTenantId ?? '').trim()
    if (!id) return ''
    return `/profile/${encodeURIComponent(id)}`
  }, [publicProfileTenantId])

  const idLabels = useMemo(() => {
    if (idTypeU === 'PASSPORT') {
      return {
        section: 'Passport or travel document',
        front: 'Passport',
        back: 'Passport (additional page)',
      }
    }
    if (idTypeU === 'BRN') {
      return {
        section: 'BRN document',
        front: 'BRN (front)',
        back: 'BRN (back)',
      }
    }
    return {
      section: 'NRIC',
      front: 'NRIC Front',
      back: 'NRIC Back',
    }
  }, [idTypeU])
  const requiresBackImage = idTypeU !== 'PASSPORT'

  const inputCls =
    'w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all'

  /** Tenant / Owner / Operator portals — same mandatory shape as respective profile gates (operator merges ID + Tax ID for nric). */
  const colivingProfileGateModel = useMemo((): TenantProfileLite | null => {
    if (uploadRole !== 'tenant' && uploadRole !== 'owner' && uploadRole !== 'operator') return null
    if (shouldUseDemoMock()) return null
    const front = String(nricFrontUrl || nricFront || '').trim()
    const back = String(nricBackUrl || nricBack || '').trim()
    const nricMerged =
      uploadRole === 'operator'
        ? String(idNumber || taxNo || '').trim()
        : String(idNumber || '').trim()
    return {
      fullname: String(legalName || fullName || '').trim(),
      nric: nricMerged,
      phone: String(phone || '').trim(),
      address: String(address || '').trim(),
      nricFront: front,
      nricback: back,
      bankName: String(bankId || '').trim(),
      bankAccount: String(bankAccNo || '').trim(),
      accountholder: String(bankHolder || '').trim(),
      profile: {
        entity_type: entityType,
        id_type: idType,
        reg_no_type: idType,
      },
    }
  }, [
    uploadRole,
    legalName,
    fullName,
    idNumber,
    taxNo,
    phone,
    address,
    nricFrontUrl,
    nricFront,
    nricBackUrl,
    nricBack,
    bankId,
    bankAccNo,
    bankHolder,
    entityType,
    idType,
  ])

  const profileGateIncomplete = useMemo(() => {
    if (disableProfileGateUi) return new Set<TenantGateIncompleteField>()
    if (!colivingProfileGateModel) return new Set<TenantGateIncompleteField>()
    return new Set(getTenantProfileIncompleteFields(colivingProfileGateModel))
  }, [colivingProfileGateModel, disableProfileGateUi])

  const gateErr = (k: TenantGateIncompleteField) => profileGateIncomplete.has(k)

  const profileGateHint =
    uploadRole === 'tenant'
      ? 'Red outline: required fields still missing — complete them to use other tenant pages.'
      : uploadRole === 'owner'
        ? 'Red outline: required fields still missing — complete them to use other owner pages.'
        : uploadRole === 'operator'
          ? 'Red outline: required fields still missing — complete them to use other operator pages.'
          : ''

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await fetchProfileBanks()
      if (cancelled || !result?.ok || !Array.isArray(result.items)) return
      const items = result.items.map((b) => ({
        id: String(b.id),
        name: String((b as { label?: string; bankname?: string; value?: string }).label || (b as { bankname?: string }).bankname || (b as { value?: string }).value || b.id),
      }))
      setBankOptions(items)
      if (!bankId && items.length) setBankId(items[0].id)
    })()
    return () => {
      cancelled = true
    }
  }, [bankId])

  useEffect(() => {
    if (!backendProfile || !email) return
    let cancelled = false
    ;(async () => {
      const st = await fetchPortalPasswordStatus(email)
      if (cancelled) return
      if (st?.ok && typeof st.hasPassword === 'boolean') {
        setHasPassword(st.hasPassword)
        syncColivingLocalUser({ hasPassword: st.hasPassword })
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendProfile, email])

  useEffect(() => {
    if (!localStorageKey || backendProfile) return
    const raw = localStorage.getItem(localStorageKey)
    if (!raw) return
    try {
      const p = JSON.parse(raw)
      setFullName(String(p.fullName || fullName))
      setLegalName(String(p.legalName || legalName))
      setNickname(String(p.nickname || nickname))
      setPhone(String(p.phone || phone))
      setAddress(String(p.address || address))
      setEntityType(String(p.entityType || entityType))
      setIdType(String(p.idType || idType))
      setIdNumber(String(p.idNumber || idNumber))
      setTaxNo(String(p.taxNo || taxNo))
      setBankId(String(p.bankId || bankId))
      setBankAccNo(String(p.bankAccNo || bankAccNo))
      setBankHolder(String(p.bankHolder || bankHolder))
      setAvatarPreview(String(p.avatarUrl || avatarPreview || ''))
      setAvatarUrl(String(p.avatarUrl || avatarUrl || ''))
      setNricFront(String(p.nricFront || ''))
      setNricBack(String(p.nricBack || ''))
      setNricFrontUrl(String(p.nricFrontUrl || ''))
      setNricBackUrl(String(p.nricBackUrl || ''))
    } catch {
      // ignore broken local data
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStorageKey, backendProfile])

  useEffect(() => {
    if (!backendProfile || !email) {
      setIsInitializing(false)
      return
    }
    let cancelled = false
    ;(async () => {
      const result = await fetchPortalProfileByEmail(email)
      if (cancelled) return
      if (result?.ok && result.profile) {
        const p = result.profile
        setFullName(String(p.fullName || fullName))
        setLegalName(String(p.legalName || legalName))
        setNickname(String(p.nickname || nickname))
        setPhone(String(p.phone || phone))
        setAddress(String(p.address || address))
        setEntityType(String(p.entityType || entityType))
        setIdType(String(p.idType || idType))
        setIdNumber(String(p.idNumber || idNumber))
        setPassportExpiryDate(String((p as { passportExpiryDate?: string }).passportExpiryDate || ''))
        setTaxNo(String(p.taxIdNo || taxNo))
        setBankId(String(p.bankId || bankId))
        setBankAccNo(String(p.bankAccountNo || bankAccNo))
        setBankHolder(String(p.bankAccountHolder || bankHolder))
        if (p.avatarUrl) {
          setAvatarPreview(String(p.avatarUrl))
          setAvatarUrl(String(p.avatarUrl))
          syncColivingLocalUser({ avatar: String(p.avatarUrl) })
        }
        if (p.nricFrontUrl) {
          setNricFront(String(p.nricFrontUrl))
          setNricFrontUrl(String(p.nricFrontUrl))
        }
        if (p.nricBackUrl) {
          setNricBack(String(p.nricBackUrl))
          setNricBackUrl(String(p.nricBackUrl))
        }
        const gl = p as {
          govIdentityLocked?: boolean
          singpassLinked?: boolean
          mydigitalLinked?: boolean
          phoneVerified?: boolean
          aliyunEkycLocked?: boolean
        }
        if (typeof gl.govIdentityLocked === 'boolean') setGovIdentityLocked(gl.govIdentityLocked)
        if (typeof gl.singpassLinked === 'boolean') setGovSingpass(gl.singpassLinked)
        if (typeof gl.mydigitalLinked === 'boolean') setGovMydigital(gl.mydigitalLinked)
        if (typeof gl.phoneVerified === 'boolean') setPhoneVerified(gl.phoneVerified)
        /** eKYC verified only when DB says so — never trust stale sessionStorage alone (user may clear DB / retry). */
        setAliyunEkycVerified(!!gl.aliyunEkycLocked)
        try {
          if (!gl.aliyunEkycLocked) sessionStorage.removeItem('aliyun_ekyc_ok')
        } catch {
          /* ignore */
        }
      }
      /** Gov status API must run after profile apply — parallel effect previously overwrote DB-linked state with false when JWT/status won the race. Merge with OR so profile + status never downgrade incorrectly. */
      if (showGovVerification && !shouldUseDemoMock() && !cancelled) {
        const s = await fetchGovIdStatus()
        if (!cancelled && s?.ok) {
          setGovSingpass((prev) => !!s.singpass || !!prev)
          setGovMydigital((prev) => !!s.mydigital || !!prev)
          setGovIdentityLocked((prev) => !!s.identityLocked || !!prev)
          setAliyunEkycVerified((prev) => !!s.aliyunEkycLocked || !!prev)
        }
      }
      setIsInitializing(false)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendProfile, email, showGovVerification])

  const buildProfilePayload = (nextAvatarUrl?: string) => ({
    clientId,
    email,
    fullName,
    legalName,
    nickname,
    phone,
    address,
    entityType,
    idType,
    idNumber,
    taxIdNo: taxNo,
    bankId,
    bankAccountNo: bankAccNo,
    bankAccountHolder: bankHolder,
    avatarUrl: nextAvatarUrl ?? avatarUrl,
    nricFrontUrl,
    nricBackUrl,
  })

  useEffect(() => {
    if (isInitializing || didInitSnapshotRef.current) return
    lastSavedPayloadRef.current = JSON.stringify(buildProfilePayload())
    didInitSnapshotRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isInitializing,
    clientId,
    email,
    fullName,
    legalName,
    nickname,
    phone,
    address,
    entityType,
    idType,
    idNumber,
    taxNo,
    bankId,
    bankAccNo,
    bankHolder,
    avatarUrl,
    nricFrontUrl,
    nricBackUrl,
  ])

  useEffect(() => {
    if (isInitializing || !backendProfile) return
    if (aliyunEkycVerified && !prevAliyunVerifiedForSnapshotRef.current) {
      lastSavedPayloadRef.current = JSON.stringify(buildProfilePayload())
    }
    prevAliyunVerifiedForSnapshotRef.current = aliyunEkycVerified
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    aliyunEkycVerified,
    isInitializing,
    backendProfile,
    clientId,
    email,
    fullName,
    legalName,
    nickname,
    phone,
    address,
    entityType,
    idType,
    idNumber,
    taxNo,
    bankId,
    bankAccNo,
    bankHolder,
    avatarUrl,
    nricFrontUrl,
    nricBackUrl,
  ])

  useEffect(() => {
    if (isInitializing) return
    if (uploadingAvatar || uploadingSide) return
    const payload = buildProfilePayload()
    const payloadString = JSON.stringify(payload)
    if (payloadString === lastSavedPayloadRef.current) return

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaveState('saving')
    saveTimerRef.current = setTimeout(async () => {
      if (backendProfile) {
        const result = await savePortalProfile(payload, {
          govIdentityLocked,
          aliyunEkycVerified,
        })
        if (!result.ok) {
          if (result.reason === 'IDENTITY_LOCKED') {
            /** DB has gov_identity_locked but client may still send fullname/nric until we strip — do not mark saved. */
            if (!govIdentityLocked) {
              setGovIdentityLocked(true)
              setSaveState('idle')
              return
            }
            setSaveState('idle')
            return
          }
          setSaveState('error')
          if (result.reason === 'PHONE_VERIFIED_LOCKED') {
            toast.error('Phone number is verified. Use “change phone number” to update it.')
          } else {
            toast.error(result.reason || 'Auto-save failed')
          }
          return
        }
        void onBackendSaveSuccess?.()
      } else if (localStorageKey) {
        localStorage.setItem(localStorageKey, JSON.stringify(payload))
      }

      syncColivingLocalUser({
        name: payload.fullName || userNameHint || '',
        avatar: payload.avatarUrl || userAvatarHint || '',
      })
      lastSavedPayloadRef.current = payloadString
      setSaveState('saved')
      if (saveStateTimerRef.current) clearTimeout(saveStateTimerRef.current)
      saveStateTimerRef.current = setTimeout(() => setSaveState('idle'), 1200)
    }, 600)

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isInitializing,
    uploadingAvatar,
    uploadingSide,
    clientId,
    email,
    fullName,
    legalName,
    nickname,
    phone,
    address,
    entityType,
    idType,
    idNumber,
    taxNo,
    bankId,
    bankAccNo,
    bankHolder,
    avatarUrl,
    nricFrontUrl,
    nricBackUrl,
    backendProfile,
    localStorageKey,
    govIdentityLocked,
    aliyunEkycVerified,
  ])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (saveStateTimerRef.current) clearTimeout(saveStateTimerRef.current)
    }
  }, [])

  /** Opening the verification dialog: refresh profile + Gov flags so button disabled states match DB (fixes stale client state). */
  useEffect(() => {
    if (!govDialogOpen || !email || !backendProfile || shouldUseDemoMock()) return
    let cancelled = false
    void (async () => {
      try {
        const [pr, gs] = await Promise.all([fetchPortalProfileByEmail(email), fetchGovIdStatus()])
        if (cancelled) return
        let profileAliyun = false
        if (pr?.ok && pr.profile) {
          const p = pr.profile as Record<string, unknown>
          const raw = String(p.idType ?? '').toUpperCase()
          if (raw === 'NRIC' || raw === 'PASSPORT' || raw === 'BRN') setIdType(raw)
          profileAliyun = !!p.aliyunEkycLocked
          const pe = p.passportExpiryDate
          if (typeof pe === 'string' && pe.trim()) setPassportExpiryDate(pe.trim())
        }
        if (gs?.ok) {
          setGovSingpass(!!gs.singpass)
          setGovMydigital(!!gs.mydigital)
          if (typeof gs.identityLocked === 'boolean') setGovIdentityLocked(gs.identityLocked)
        }
        const statusAliyun = !!(gs?.ok && gs.aliyunEkycLocked)
        setAliyunEkycVerified((prev) => profileAliyun || statusAliyun || prev)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [govDialogOpen, email, backendProfile])

  /** Aliyun eKYC_PRO: MyKad — lock identity + address + both NRIC images. */
  const aliyunMykadEkycLocked =
    showGovVerification && backendProfile && !shouldUseDemoMock() && aliyunEkycVerified && idTypeU === 'NRIC'
  /** Aliyun passport — lock identity + passport photo (front slot); address stays editable. */
  const aliyunPassportEkycLocked =
    showGovVerification && backendProfile && !shouldUseDemoMock() && aliyunEkycVerified && idTypeU === 'PASSPORT'

  const aliyunCoreIdentityLocked = govIdentityLocked || aliyunMykadEkycLocked || aliyunPassportEkycLocked
  const aliyunAddressLocked = govIdentityLocked || aliyunMykadEkycLocked
  /** Passport expiry ≤30 days: allow starting passport eKYC again from Verification Status dialog (main form stays locked until success). */
  const passportRenewalEligible =
    showGovVerification &&
    backendProfile &&
    !shouldUseDemoMock() &&
    aliyunEkycVerified &&
    idTypeU === 'PASSPORT' &&
    isPassportRenewalWindow(passportExpiryDate)
  const idFrontUploadLocked = aliyunMykadEkycLocked || aliyunPassportEkycLocked
  const idBackUploadLocked = aliyunMykadEkycLocked

  /** Verification Status dialog: disable only the method currently in use; Gov ID row uses linked flags on each button. */
  const govIdProviderLinked = govSingpass || govMydigital
  const verifiedByAliyunMyKadOnly = aliyunEkycVerified && idTypeU === 'NRIC'
  const verifiedByAliyunPassport = aliyunEkycVerified && idTypeU === 'PASSPORT'
  const disableVerificationDialogMyKad =
    shouldUseDemoMock() || (verifiedByAliyunMyKadOnly && !govIdProviderLinked)
  const disableVerificationDialogPassport =
    shouldUseDemoMock() || (verifiedByAliyunPassport && !passportRenewalEligible)

  const handleSave = async () => {
    const payload = buildProfilePayload()
    if (backendProfile) {
      const result = await savePortalProfile(payload, {
        govIdentityLocked,
        aliyunEkycVerified,
      })
      if (!result.ok) {
        if (result.reason === 'IDENTITY_LOCKED') {
          setGovIdentityLocked(true)
          return
        }
        if (result.reason === 'PHONE_VERIFIED_LOCKED') {
          toast.error('Phone number is verified. Use “change phone number” to update it.')
        } else {
          toast.error(result.reason || 'Failed to save profile')
        }
        return
      }
      void onBackendSaveSuccess?.()
      syncColivingLocalUser({
        name: fullName || userNameHint || '',
        avatar: avatarUrl || userAvatarHint || '',
      })
      toast.success('Profile saved')
      return
    }
    if (localStorageKey) localStorage.setItem(localStorageKey, JSON.stringify(payload))
    syncColivingLocalUser({
      name: fullName || userNameHint || '',
      avatar: avatarUrl || userAvatarHint || '',
    })
    toast.success('Profile saved')
  }

  const handleNricFile = async (side: 'front' | 'back', file: File | null) => {
    if (!file) return
    if (side === 'front' && idFrontUploadLocked) return
    if (side === 'back' && idBackUploadLocked) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file')
      return
    }
    setUploadingSide(side)
    const preview = URL.createObjectURL(file)
    if (side === 'front') setNricFront(preview)
    else setNricBack(preview)
    try {
      const upload = await uploadProfileFileToOss(file, uploadRole, clientId)
      if (!upload.ok || !upload.url) {
        toast.error(upload.reason || 'Upload failed')
        return
      }
      if (side === 'front') {
        setNricFrontUrl(upload.url)
        setNricFront(upload.url)
      } else {
        setNricBackUrl(upload.url)
        setNricBack(upload.url)
      }
      toast.success(`${side === 'front' ? idLabels.front : idLabels.back} uploaded`)
    } finally {
      setUploadingSide(null)
    }
  }

  const handleAvatarFile = async (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file')
      return
    }
    setUploadingAvatar(true)
    const preview = URL.createObjectURL(file)
    setAvatarPreview(preview)
    try {
      const upload = await uploadProfileFileToOss(file, uploadRole, clientId)
      if (!upload.ok || !upload.url) {
        toast.error(upload.reason || 'Upload failed')
        return
      }
      setAvatarUrl(upload.url)
      setAvatarPreview(upload.url)
      syncColivingLocalUser({ avatar: upload.url })
      toast.success('Photo uploaded')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const openPasswordDialog = () => {
    setPwdDialogOpen(true)
    setPwdCodeSent(false)
    setPwdCode('')
    setPwdNew('')
    setPwdConfirm('')
  }

  const sendPasswordCode = async () => {
    if (!email) {
      toast.error('No email on file')
      return
    }
    setPwdSending(true)
    try {
      const r = await requestPortalPasswordResetEmail(email)
      if (!r.ok) {
        toast.error(r.reason === 'NO_ACCOUNT' ? 'Account not found' : r.reason || 'Failed to send code')
        return
      }
      setPwdCodeSent(true)
      toast.success('Verification code sent to your email')
    } finally {
      setPwdSending(false)
    }
  }

  const submitPasswordChange = async () => {
    if (!email) return
    if (!pwdCode.trim() || pwdNew.length < 8) {
      toast.error('Enter the 6-digit code and a password of at least 8 characters')
      return
    }
    if (pwdNew !== pwdConfirm) {
      toast.error('Passwords do not match')
      return
    }
    setPwdSubmitting(true)
    try {
      const r = await confirmPortalPasswordReset({
        email,
        code: pwdCode.trim(),
        newPassword: pwdNew,
      })
      if (!r.ok) {
        toast.error(r.reason === 'INVALID_OR_EXPIRED_CODE' ? 'Invalid or expired code' : r.reason || 'Failed')
        return
      }
      toast.success(hasPassword ? 'Password updated' : 'Password created')
      setHasPassword(true)
      syncColivingLocalUser({ hasPassword: true })
      setPwdDialogOpen(false)
      const st = await fetchPortalPasswordStatus(email)
      if (st?.ok && typeof st.hasPassword === 'boolean') {
        setHasPassword(st.hasPassword)
        syncColivingLocalUser({ hasPassword: st.hasPassword })
      }
    } finally {
      setPwdSubmitting(false)
    }
  }

  const saveHint = isInitializing
    ? 'Loading profile...'
    : saveState === 'saving'
      ? 'Saving changes...'
      : saveState === 'saved'
        ? 'All changes saved'
        : saveState === 'error'
          ? 'Auto-save failed, retrying on next change'
          : 'Auto-save is on'

  const securityTitle = hasPassword ? 'Change password' : 'Create password'

  async function loadAliyunVerifyScript(): Promise<void> {
    if (typeof window === 'undefined') return
    const w = window as unknown as { getMetaInfo?: () => string }
    if (typeof w.getMetaInfo === 'function') return
    const src =
      process.env.NEXT_PUBLIC_ALIYUN_IDV_VERIFY_JS_URL || 'https://hkwebcdn.yuncloudauth.com/cdn/verify.js'
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector(`script[data-aliyun-verify="1"]`)
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true })
        existing.addEventListener('error', () => reject(new Error('verify.js load failed')), { once: true })
        return
      }
      const s = document.createElement('script')
      s.src = src
      s.async = true
      s.dataset.aliyunVerify = '1'
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('verify.js load failed'))
      document.head.appendChild(s)
    })
  }

  const startAliyunEkycFlow = async (docType: 'MYS01001' | 'GLB03002') => {
    if (shouldUseDemoMock() || !backendProfile) {
      toast.error('Use the live portal with a signed-in account (demo is mock-only).')
      return
    }
    if (docType === 'MYS01001') {
      const block =
        verifiedByAliyunMyKadOnly && !govIdProviderLinked
      if (block) {
        toast.error('You are already verified with Malaysian MyKad. Use another method above to switch.')
        return
      }
    }
    if (docType === 'GLB03002') {
      const block = verifiedByAliyunPassport && !isPassportRenewalWindow(passportExpiryDate)
      if (block) {
        toast.error('Passport verification is already completed.')
        return
      }
    }
    setAliyunEkycStarting(true)
    try {
      await loadAliyunVerifyScript()
      const getMetaInfo = (window as unknown as { getMetaInfo?: () => string }).getMetaInfo
      if (typeof getMetaInfo !== 'function') {
        toast.error('Verification script not ready — refresh and try again')
        return
      }
      const rawMeta = getMetaInfo()
      const metaInfo = typeof rawMeta === 'string' ? rawMeta : JSON.stringify(rawMeta)
      const out = await startAliyunIdvEkyc({
        metaInfo,
        docType,
        returnPath: '/demoprofile',
      })
      if (!out.ok || !out.transactionUrl || !out.transactionId) {
        toast.error(out.reason || 'Could not start verification')
        return
      }
      sessionStorage.setItem('aliyun_ekyc_tid', out.transactionId)
      setGovDialogOpen(false)
      window.location.href = out.transactionUrl
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verification start failed')
    } finally {
      setAliyunEkycStarting(false)
    }
  }

  const openEmailChangeDialog = () => {
    setEmailNew('')
    setEmailCode('')
    setEmailStep('enter')
    setEmailChangeOpen(true)
  }

  const sendEmailChangeOtp = async () => {
    const ne = emailNew.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ne)) {
      toast.error('Enter a valid email address')
      return
    }
    setEmailBusy(true)
    try {
      const r = await requestPortalEmailChangeOtp(ne)
      if (!r.ok) {
        const msg =
          r.reason === 'EMAIL_TAKEN'
            ? 'That email is already registered to another account. Use a new email address.'
            : r.reason === 'SAME_EMAIL'
              ? 'New email must differ from your current login'
              : r.reason === 'MIGRATION_REQUIRED'
                ? 'Email change is not available yet — contact support'
                : r.reason || 'Failed to send code'
        toast.error(msg)
        return
      }
      setEmailStep('code')
      toast.success('Verification code sent to the new email address')
    } finally {
      setEmailBusy(false)
    }
  }

  const submitEmailChange = async () => {
    const ne = emailNew.trim().toLowerCase()
    const c = emailCode.trim()
    if (!c) {
      toast.error('Enter the verification code')
      return
    }
    setEmailBusy(true)
    try {
      const r = await confirmPortalEmailChange({ newEmail: ne, code: c })
      if (!r.ok) {
        const failMsg =
          r.reason === 'INVALID_OR_EXPIRED_CODE'
            ? 'Invalid or expired code'
            : r.reason === 'EMAIL_TAKEN'
              ? 'That email is already registered to another account. Use a new email address.'
              : r.reason || 'Failed'
        toast.error(failMsg)
        return
      }
      toast.success('Email updated — signing you out')
      setEmailChangeOpen(false)
      clearPortalSession()
      if (typeof window !== 'undefined') {
        window.location.href = `${window.location.origin}/login`
      }
    } finally {
      setEmailBusy(false)
    }
  }

  const openPhoneVerifyDialog = () => {
    const parsed = splitPhoneNumberWithCountry(phone.trim())
    setPhoneVerifyCountryCode(parsed.countryCode)
    setPhoneVerifyLocalNumber(parsed.localNumber)
    setPhoneVerifyDraft(joinPhoneNumber(parsed.countryCode, parsed.localNumber))
    setPhoneVerifyCode('')
    setPhoneVerifyOpen(true)
  }

  const sendPhoneVerifyOtp = async () => {
    const p = joinPhoneNumber(phoneVerifyCountryCode, phoneVerifyLocalNumber)
    if (p.length < 8) {
      toast.error('Enter a valid phone number')
      return
    }
    setPhoneVerifyBusy(true)
    try {
      const r = await requestPortalPhoneVerifyOtp(p)
      if (!r.ok) {
        const msg =
          r.reason === 'ALREADY_VERIFIED'
            ? 'This number is already verified'
            : r.reason === 'INVALID_PHONE'
              ? 'Enter a valid phone number'
              : r.reason || 'Failed to send code'
        toast.error(msg)
        return
      }
      toast.success('Verification code sent to your login email')
    } finally {
      setPhoneVerifyBusy(false)
    }
  }

  const submitPhoneVerify = async () => {
    const p = joinPhoneNumber(phoneVerifyCountryCode, phoneVerifyLocalNumber)
    const c = phoneVerifyCode.trim()
    if (!c) {
      toast.error('Enter the verification code')
      return
    }
    setPhoneVerifyBusy(true)
    try {
      const r = await confirmPortalPhoneVerify({ phone: p, code: c })
      if (!r.ok) {
        toast.error(
          r.reason === 'INVALID_OR_EXPIRED_CODE' ? 'Invalid or expired code' : r.reason || 'Failed',
        )
        return
      }
      setPhone(p)
      setPhoneVerified(true)
      setPhoneVerifyOpen(false)
      toast.success('Phone number verified')
    } finally {
      setPhoneVerifyBusy(false)
    }
  }

  const openPhoneChangeDialog = () => {
    const parsed = splitPhoneNumberWithCountry(phone.trim())
    setPhoneChangeCountryCode(parsed.countryCode)
    setPhoneChangeLocalNumber('')
    setPhoneChangeNew('')
    setPhoneChangeCode('')
    setPhoneChangeOpen(true)
  }

  const sendPhoneChangeOtp = async () => {
    const np = joinPhoneNumber(phoneChangeCountryCode, phoneChangeLocalNumber)
    if (np.length < 8) {
      toast.error('Enter a valid new phone number')
      return
    }
    setPhoneChangeBusy(true)
    try {
      const r = await requestPortalPhoneChangeOtp(np)
      if (!r.ok) {
        const msg =
          r.reason === 'NOT_VERIFIED'
            ? 'Verify your current number first'
            : r.reason === 'SAME_PHONE'
              ? 'Enter a different number'
              : r.reason === 'MIGRATION_REQUIRED'
                ? 'Phone verification is not available yet — contact support'
                : r.reason || 'Failed to send code'
        toast.error(msg)
        return
      }
      toast.success('Verification code sent to your login email')
    } finally {
      setPhoneChangeBusy(false)
    }
  }

  const submitPhoneChange = async () => {
    const np = joinPhoneNumber(phoneChangeCountryCode, phoneChangeLocalNumber)
    const c = phoneChangeCode.trim()
    if (!c) {
      toast.error('Enter the verification code')
      return
    }
    setPhoneChangeBusy(true)
    try {
      const r = await confirmPortalPhoneChange({ newPhone: np, code: c })
      if (!r.ok) {
        toast.error(
          r.reason === 'INVALID_OR_EXPIRED_CODE' ? 'Invalid or expired code' : r.reason || 'Failed',
        )
        return
      }
      setPhone(np)
      setPhoneChangeOpen(false)
      toast.success('Phone number updated')
    } finally {
      setPhoneChangeBusy(false)
    }
  }

  /** Gov-verified: badge + read-only entity/ID fields (API flags or DB lock, avoids flicker before gov status loads). */
  const govIdVerified =
    showGovVerification &&
    backendProfile &&
    !shouldUseDemoMock() &&
    ((govSingpass || govMydigital) || govIdentityLocked || aliyunEkycVerified)
  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-black text-foreground">Profile Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your personal information and preferences.</p>
          <p className="text-xs text-muted-foreground mt-2">{saveHint}</p>
          {(uploadRole === 'tenant' || uploadRole === 'owner' || uploadRole === 'operator') &&
          profileGateIncomplete.size > 0 &&
          !shouldUseDemoMock() &&
          !disableProfileGateUi ? (
            <p className="text-xs font-medium text-destructive mt-2">{profileGateHint}</p>
          ) : null}
        </div>
        {showViewMyProfileButton ? (
          <Button
            type="button"
            variant="outline"
            className="shrink-0 gap-2 rounded-xl border-border font-semibold"
            disabled={!publicProfilePath}
            title={!publicProfilePath ? 'Public profile link is not available yet' : undefined}
            onClick={() => {
              if (!publicProfilePath) {
                toast.error('Public profile link is not available yet')
                return
              }
              setProfilePreviewOpen(true)
            }}
          >
            <Eye className="h-4 w-4" />
            View my profile
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="flex flex-col items-center gap-4 bg-card border border-border rounded-2xl p-6">
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center text-2xl font-black text-white overflow-hidden"
            style={{ background: 'var(--brand)' }}
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              displayNameForCard.slice(0, 2).toUpperCase()
            )}
          </div>
          <div className="text-center">
            <div className="font-black text-foreground text-lg inline-flex items-center justify-center gap-1.5 flex-wrap">
              <span>{displayNameForCard}</span>
              {govIdVerified ? (
                <span
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-white shadow-sm"
                  title="Verified account"
                  aria-label="Verified account"
                >
                  <BadgeCheck className="h-4 w-4" strokeWidth={2.5} />
                </span>
              ) : null}
            </div>
            <div className="text-sm text-muted-foreground">{roleLabel}</div>
          </div>
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="w-full py-2.5 rounded-xl text-sm font-bold border border-primary text-primary hover:bg-primary hover:text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Camera className="h-4 w-4" />
            {uploadingAvatar ? 'Uploading...' : 'Change Photo'}
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              handleAvatarFile(e.target.files?.[0] ?? null)
              e.currentTarget.value = ''
            }}
          />
          <div className="w-full border-t border-border pt-4 flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail size={14} /> {email || '-'}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone size={14} /> {phone || '-'}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <User size={14} /> {idNumber || '-'}
            </div>
            {idTypeU === 'PASSPORT' ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar size={14} />
                {passportExpiryDate.trim() !== '' ? `Expires ${passportExpiryDate}` : 'Passport expiry —'}
              </div>
            ) : null}
          </div>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-5">
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between mb-5">
              <div className="flex items-center gap-2 min-w-0">
                <User size={16} style={{ color: 'var(--brand)' }} />
                <h2 className="font-bold text-foreground">Personal Information</h2>
              </div>
              {showGovVerification && backendProfile && !shouldUseDemoMock() && (
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:max-w-[min(100%,28rem)] sm:justify-end">
                  {(govSingpass || govMydigital) && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-semibold">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {govSingpass && !govMydigital
                        ? 'Singpass connected'
                        : govMydigital && !govSingpass
                          ? 'MyDigital connected'
                          : 'Verified'}
                    </span>
                  )}
                  {aliyunEkycVerified && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-semibold">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      eKYC (MyKad / passport)
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      'text-xs font-semibold',
                      govIdVerified &&
                        'border-green-600 bg-green-600 text-white hover:bg-green-700 hover:text-white',
                    )}
                    onClick={() => setGovDialogOpen(true)}
                  >
                    Verification Status
                  </Button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Entity Type
                </Label>
                <Select value={entityType} onValueChange={setEntityType} disabled={aliyunCoreIdentityLocked}>
                  <SelectTrigger
                    className={cn(
                      gateErr('entityType') && 'ring-2 ring-destructive border-destructive',
                      aliyunCoreIdentityLocked && 'opacity-80 cursor-not-allowed',
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MALAYSIAN_INDIVIDUAL">Malaysian Individual</SelectItem>
                    <SelectItem value="SINGAPORE_INDIVIDUAL">Singapore Individual</SelectItem>
                    <SelectItem value="MALAYSIAN_COMPANY">Malaysian Company</SelectItem>
                    <SelectItem value="FOREIGN_INDIVIDUAL">Foreign Individual</SelectItem>
                    <SelectItem value="FOREIGN_COMPANY">Foreign Company</SelectItem>
                    <SelectItem value="EXEMPTED_PERSON">Exempted Person</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Legal Name
                </Label>
                <input
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  disabled={aliyunCoreIdentityLocked}
                  className={cn(
                    inputCls,
                    aliyunCoreIdentityLocked && 'opacity-80 cursor-not-allowed',
                    gateErr('legalName') && 'ring-2 ring-destructive border-destructive',
                  )}
                />
              </div>
              <div className="sm:col-span-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
                  <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground shrink-0">
                    ID Type
                  </Label>
                  {idTypeU === 'PASSPORT' ? (
                    <span className="text-sm font-medium text-foreground tabular-nums">
                      {passportExpiryDate.trim() !== '' ? `Expires ${passportExpiryDate}` : 'Expiry date —'}
                    </span>
                  ) : null}
                  {govIdentityLocked && (govSingpass || govMydigital) ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex text-muted-foreground hover:text-foreground rounded-full p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="About ID type"
                        >
                          <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-left">
                        Singpass and MyDigital ID use NRIC. If RPV or other flows are added later, you can choose Passport vs
                        NRIC there.
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
                <Select value={idType} onValueChange={setIdType} disabled={aliyunCoreIdentityLocked}>
                  <SelectTrigger
                    className={cn(
                      gateErr('idType') && 'ring-2 ring-destructive border-destructive',
                      aliyunCoreIdentityLocked && 'opacity-80 cursor-not-allowed',
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NRIC">NRIC</SelectItem>
                    <SelectItem value="PASSPORT">Passport</SelectItem>
                    <SelectItem value="BRN">BRN</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  ID Number
                </Label>
                <input
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  disabled={aliyunCoreIdentityLocked}
                  className={cn(
                    inputCls,
                    aliyunCoreIdentityLocked && 'opacity-80 cursor-not-allowed',
                    gateErr('idNumber') && 'ring-2 ring-destructive border-destructive',
                  )}
                />
              </div>
              <div>
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Tax ID (Optional)
                </Label>
                <input
                  value={taxNo}
                  onChange={(e) => setTaxNo(e.target.value)}
                  className={cn(
                    inputCls,
                    uploadRole === 'operator' && gateErr('idNumber') && 'ring-2 ring-destructive border-destructive',
                  )}
                />
              </div>
              <div>
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Email Address
                </Label>
                <input value={email} disabled className={`${inputCls} opacity-80 cursor-not-allowed`} />
                {backendProfile && !shouldUseDemoMock() ? (
                  <button
                    type="button"
                    className="text-xs font-semibold text-primary hover:underline mt-1.5 block text-left"
                    onClick={openEmailChangeDialog}
                  >
                    change email address
                  </button>
                ) : null}
              </div>
              <div>
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Display Name
                </Label>
                <input value={nickname} onChange={(e) => setNickname(e.target.value)} className={inputCls} />
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
                    Phone Number
                  </Label>
                  {backendProfile && !shouldUseDemoMock() && phoneVerified ? (
                    <span
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#1877F2] text-white"
                      title="Phone verified"
                      aria-label="Phone verified"
                    >
                      <BadgeCheck className="h-3 w-3" strokeWidth={2.5} />
                    </span>
                  ) : null}
                  {backendProfile && !shouldUseDemoMock() && govIdentityLocked && !phoneVerified ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex text-muted-foreground hover:text-foreground rounded-full p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="About phone verification"
                        >
                          <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-left">
                        You can edit your phone here; use &quot;verify your number&quot; when you are ready to lock it.
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
                <input
                  value={phone}
                  onChange={(e) => setPhone(normalizePhoneDigits(e.target.value))}
                  disabled={!!(backendProfile && !shouldUseDemoMock() && phoneVerified)}
                  className={cn(
                    inputCls,
                    gateErr('phone') && 'ring-2 ring-destructive border-destructive',
                    backendProfile && !shouldUseDemoMock() && phoneVerified && 'opacity-80 cursor-not-allowed',
                  )}
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="e.g. 60123456789"
                />
                {backendProfile && !shouldUseDemoMock() ? (
                  phoneVerified ? (
                    <button
                      type="button"
                      className="text-xs font-semibold text-primary hover:underline mt-1.5 block text-left"
                      onClick={openPhoneChangeDialog}
                    >
                      change phone number
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-xs font-semibold text-primary hover:underline mt-1.5 block text-left"
                      onClick={openPhoneVerifyDialog}
                    >
                      verify your number
                    </button>
                  )
                ) : null}
              </div>
              <div className="sm:col-span-2">
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Address
                </Label>
                <textarea
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  disabled={aliyunAddressLocked}
                  className={cn(
                    `${inputCls} resize-none`,
                    gateErr('address') && 'ring-2 ring-destructive border-destructive',
                    aliyunAddressLocked && 'opacity-80 cursor-not-allowed',
                  )}
                />
              </div>
            </div>

            <div className="mt-5 pt-5 border-t border-border">
              <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-2 block">
                {idLabels.section}
              </Label>
              <p className="text-xs text-muted-foreground mb-3">Upload images for verification. Preview updates after upload.</p>
              <div className={`grid grid-cols-1 ${requiresBackImage ? 'sm:grid-cols-2' : ''} gap-4`}>
                <div>
                  <p className="text-xs font-medium text-foreground mb-2">{idLabels.front} *</p>
                  <label
                    className={cn(
                      'relative flex flex-col items-center justify-center w-full min-h-[10rem] border-2 border-dashed rounded-xl transition-colors bg-secondary/30 overflow-hidden',
                      idFrontUploadLocked
                        ? 'cursor-not-allowed opacity-70 border-border'
                        : 'cursor-pointer hover:border-primary border-border',
                      gateErr('nricFront') ? 'border-destructive ring-2 ring-destructive/60' : !idFrontUploadLocked && 'border-border',
                    )}
                  >
                    {nricFront ? (
                      <>
                        <img src={nricFront} alt={idLabels.front} className="w-full max-h-48 object-contain rounded-xl" />
                        {!idFrontUploadLocked ? (
                          <button
                            type="button"
                            className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1"
                            onClick={(e) => {
                              e.preventDefault()
                              setNricFront(null)
                              setNricFrontUrl(null)
                            }}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <Upload size={22} className="text-muted-foreground mb-2" />
                        <span className="text-xs text-muted-foreground">
                          {uploadingSide === 'front' ? 'Uploading...' : idFrontUploadLocked ? 'Verified — cannot replace' : 'Click to upload'}
                        </span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={idFrontUploadLocked}
                      onChange={(e) => handleNricFile('front', e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
                {requiresBackImage ? (
                <div>
                  <p className="text-xs font-medium text-foreground mb-2">{idLabels.back}</p>
                  <label
                    className={cn(
                      'relative flex flex-col items-center justify-center w-full min-h-[10rem] border-2 border-dashed rounded-xl transition-colors bg-secondary/30 overflow-hidden',
                      idBackUploadLocked
                        ? 'cursor-not-allowed opacity-70 border-border'
                        : 'cursor-pointer hover:border-primary border-border',
                      gateErr('nricBack') ? 'border-destructive ring-2 ring-destructive/60' : !idBackUploadLocked && 'border-border',
                    )}
                  >
                    {nricBack ? (
                      <>
                        <img src={nricBack} alt={idLabels.back} className="w-full max-h-48 object-contain rounded-xl" />
                        {!idBackUploadLocked ? (
                          <button
                            type="button"
                            className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1"
                            onClick={(e) => {
                              e.preventDefault()
                              setNricBack(null)
                              setNricBackUrl(null)
                            }}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <Upload size={22} className="text-muted-foreground mb-2" />
                        <span className="text-xs text-muted-foreground">
                          {uploadingSide === 'back' ? 'Uploading...' : idBackUploadLocked ? 'Verified — cannot replace' : 'Click to upload'}
                        </span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={idBackUploadLocked}
                      onChange={(e) => handleNricFile('back', e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <CreditCard size={16} style={{ color: 'var(--brand)' }} />
              <h2 className="font-bold text-foreground">Bank Details</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Bank list from MySQL (bankdetail).</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Bank name
                </Label>
                <Select value={bankId} onValueChange={setBankId}>
                  <SelectTrigger
                    className={cn(gateErr('bank') && 'ring-2 ring-destructive border-destructive')}
                  >
                    <SelectValue placeholder="Select bank" />
                  </SelectTrigger>
                  <SelectContent>
                    {bankOptions.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Account number
                </Label>
                <input
                  value={bankAccNo}
                  onChange={(e) => setBankAccNo(e.target.value)}
                  className={cn(inputCls, gateErr('bankAccount') && 'ring-2 ring-destructive border-destructive')}
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Account holder name
                </Label>
                <input
                  value={bankHolder}
                  onChange={(e) => setBankHolder(e.target.value)}
                  className={cn(inputCls, gateErr('accountHolder') && 'ring-2 ring-destructive border-destructive')}
                />
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <Lock size={16} style={{ color: 'var(--brand)' }} />
              <h2 className="font-bold text-foreground">Security</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {hasPassword
                ? 'Change your password using a verification code sent to your email.'
                : 'You signed in with Google. Create a password to also sign in with email — we will verify by code sent to your inbox.'}
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full py-2.5 rounded-xl text-sm font-bold border-border hover:border-primary hover:text-primary transition-colors"
              onClick={openPasswordDialog}
            >
              {securityTitle}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={profilePreviewOpen} onOpenChange={setProfilePreviewOpen}>
        <DialogContent className="sm:max-w-5xl w-[calc(100vw-1.5rem)] max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>Your public profile</DialogTitle>
            <DialogDescription>
              This is how your reviews and public tenant card appear. Use &quot;Open in new tab&quot; for the full page or to share the link.
            </DialogDescription>
          </DialogHeader>
          {publicProfilePath ? (
            <div className="px-6 pb-2 flex-1 min-h-0 flex flex-col">
              <iframe
                title="Public tenant profile preview"
                src={publicProfilePath}
                className="w-full min-h-[min(72vh,640px)] flex-1 rounded-xl border border-border bg-background"
              />
            </div>
          ) : null}
          <DialogFooter className="px-6 py-4 border-t border-border shrink-0 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setProfilePreviewOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              className="w-full sm:w-auto gap-2"
              disabled={!publicProfilePath}
              onClick={() => {
                if (typeof window === 'undefined' || !publicProfilePath) return
                const url = `${window.location.origin}${publicProfilePath}`
                window.open(url, '_blank', 'noopener,noreferrer')
              }}
            >
              <ExternalLink className="h-4 w-4" />
              Open in new tab
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={govDialogOpen} onOpenChange={setGovDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Government ID verification</DialogTitle>
            <DialogDescription className="sr-only">Choose a verification method.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <GovIdConnectButtons
              returnPath={showGovVerification ? '/demoprofile' : '/demologin'}
              variant="solo"
              appearance="fill"
              singpassLinked={!!govSingpass}
              mydigitalLinked={!!govMydigital}
            />
            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center" aria-hidden>
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or verify with document</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center"
              disabled={aliyunEkycStarting || disableVerificationDialogMyKad}
              onClick={() => void startAliyunEkycFlow('MYS01001')}
            >
              {aliyunEkycStarting ? 'Starting…' : 'Verification by Malaysian MyKad (NRIC)'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center"
              disabled={aliyunEkycStarting || disableVerificationDialogPassport}
              onClick={() => void startAliyunEkycFlow('GLB03002')}
            >
              {aliyunEkycStarting ? 'Starting…' : 'Verification by passport'}
            </Button>
            {passportRenewalEligible ? (
              <p className="text-xs text-center text-muted-foreground">
                Passport expires within one month — you can re-verify with a new document above.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setGovDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={emailChangeOpen}
        onOpenChange={(o) => {
          setEmailChangeOpen(o)
          if (!o) {
            setEmailStep('enter')
            setEmailNew('')
            setEmailCode('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change email address</DialogTitle>
            <DialogDescription>
              {emailStep === 'enter'
                ? 'Enter your new email. We will send a verification code to that address.'
                : `Enter the code sent to ${emailNew.trim().toLowerCase()}.`}
            </DialogDescription>
          </DialogHeader>
          {emailStep === 'enter' ? (
            <div className="space-y-3 py-2">
              <div>
                <Label className="text-xs uppercase text-muted-foreground">New email</Label>
                <Input
                  className="mt-1"
                  type="email"
                  autoComplete="email"
                  value={emailNew}
                  onChange={(e) => setEmailNew(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Verification code</Label>
                <Input
                  className="mt-1"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => setEmailChangeOpen(false)}>
              Cancel
            </Button>
            {emailStep === 'enter' ? (
              <Button type="button" disabled={emailBusy} onClick={() => void sendEmailChangeOtp()}>
                {emailBusy ? 'Sending...' : 'Send verification code'}
              </Button>
            ) : (
              <Button type="button" disabled={emailBusy} onClick={() => void submitEmailChange()}>
                {emailBusy ? 'Submitting...' : 'Submit'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={phoneVerifyOpen}
        onOpenChange={(o) => {
          setPhoneVerifyOpen(o)
          if (!o) {
            setPhoneVerifyDraft('')
            setPhoneVerifyLocalNumber('')
            setPhoneVerifyCode('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Verify your number</DialogTitle>
            <DialogDescription>
              We will send a one-time code to your login email ({email || '—'}). Enter the number to verify and the code
              below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Phone number</Label>
              <div className="mt-1 flex gap-2">
                <PhoneCountryCodeSelect value={phoneVerifyCountryCode} onChange={setPhoneVerifyCountryCode} />
                <Input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  className="flex-1"
                  value={phoneVerifyLocalNumber}
                  onChange={(e) => {
                    const local = normalizePhoneDigits(e.target.value)
                    setPhoneVerifyLocalNumber(local)
                    setPhoneVerifyDraft(joinPhoneNumber(phoneVerifyCountryCode, local))
                  }}
                  placeholder="Phone number"
                />
              </div>
            </div>
            <Button type="button" variant="secondary" className="w-full" disabled={phoneVerifyBusy} onClick={() => void sendPhoneVerifyOtp()}>
              {phoneVerifyBusy ? 'Sending...' : 'Send verification code'}
            </Button>
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Verification code</Label>
              <Input
                className="mt-1"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={phoneVerifyCode}
                onChange={(e) => setPhoneVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => setPhoneVerifyOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={phoneVerifyBusy} onClick={() => void submitPhoneVerify()}>
              {phoneVerifyBusy ? 'Verifying...' : 'Verify'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={phoneChangeOpen}
        onOpenChange={(o) => {
          setPhoneChangeOpen(o)
          if (!o) {
            setPhoneChangeNew('')
            setPhoneChangeLocalNumber('')
            setPhoneChangeCode('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change phone number</DialogTitle>
            <DialogDescription>
              Enter your new number, request a code to your login email ({email || '—'}), then verify with OTP.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs uppercase text-muted-foreground">New phone number</Label>
              <div className="mt-1 flex gap-2">
                <PhoneCountryCodeSelect value={phoneChangeCountryCode} onChange={setPhoneChangeCountryCode} />
                <Input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  className="flex-1"
                  value={phoneChangeLocalNumber}
                  onChange={(e) => {
                    const local = normalizePhoneDigits(e.target.value)
                    setPhoneChangeLocalNumber(local)
                    setPhoneChangeNew(joinPhoneNumber(phoneChangeCountryCode, local))
                  }}
                  placeholder="Phone number"
                />
              </div>
            </div>
            <Button type="button" variant="secondary" className="w-full" disabled={phoneChangeBusy} onClick={() => void sendPhoneChangeOtp()}>
              {phoneChangeBusy ? 'Sending...' : 'Request verification code'}
            </Button>
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Verification code</Label>
              <Input
                className="mt-1"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={phoneChangeCode}
                onChange={(e) => setPhoneChangeCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => setPhoneChangeOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={phoneChangeBusy} onClick={() => void submitPhoneChange()}>
              {phoneChangeBusy ? 'Verifying...' : 'Verify'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pwdDialogOpen} onOpenChange={setPwdDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{securityTitle}</DialogTitle>
            <DialogDescription>
              We will send a one-time verification code to <span className="font-medium text-foreground">{email}</span>.
              Enter the code and your new password below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Button type="button" variant="secondary" className="w-full" disabled={pwdSending} onClick={sendPasswordCode}>
              {pwdSending ? 'Sending...' : pwdCodeSent ? 'Resend verification code' : 'Send verification code'}
            </Button>
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Verification code</Label>
              <Input
                className="mt-1"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={pwdCode}
                onChange={(e) => setPwdCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </div>
            <div className="relative">
              <Label className="text-xs uppercase text-muted-foreground">{hasPassword ? 'New password' : 'Password'}</Label>
              <Input
                className="mt-1 pr-10"
                type={showPwdNew ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={pwdNew}
                onChange={(e) => setPwdNew(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-2 top-[1.85rem] text-muted-foreground"
                onClick={() => setShowPwdNew(!showPwdNew)}
                aria-label="Toggle visibility"
              >
                {showPwdNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="relative">
              <Label className="text-xs uppercase text-muted-foreground">Confirm password</Label>
              <Input
                className="mt-1 pr-10"
                type={showPwdConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                value={pwdConfirm}
                onChange={(e) => setPwdConfirm(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-2 top-[1.85rem] text-muted-foreground"
                onClick={() => setShowPwdConfirm(!showPwdConfirm)}
                aria-label="Toggle visibility"
              >
                {showPwdConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => setPwdDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={pwdSubmitting} onClick={submitPasswordChange}>
              {pwdSubmitting ? 'Saving...' : hasPassword ? 'Update password' : 'Create password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
