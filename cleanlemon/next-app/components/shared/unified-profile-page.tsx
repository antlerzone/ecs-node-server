"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { User, Mail, Phone, Lock, CreditCard, Camera, Upload, X, Eye, EyeOff, ShieldCheck, BadgeCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-context'
import { cn } from '@/lib/utils'
import {
  fetchEmployeeBanks,
  fetchEmployeeProfileByEmail,
  saveEmployeeProfile,
  uploadEmployeeFileToOss,
  requestPortalPasswordResetEmail,
  confirmPortalPasswordReset,
  startPortalAliyunIdvEkyc,
  fetchPortalAliyunIdvResult,
  requestPortalEmailChangeOtp,
  confirmPortalEmailChange,
} from '@/lib/cleanlemon-api'

type Props = {
  roleLabel: string
  backendProfile?: boolean
  localStorageKey?: string
  /** Client/employee: confirm profile (portal self-verify gate). */
  selfVerifyMode?: boolean
}

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

export default function UnifiedProfilePage({
  roleLabel,
  backendProfile = false,
  localStorageKey,
  selfVerifyMode = false,
}: Props) {
  const router = useRouter()
  const { user, updateUser, logout } = useAuth()
  const email = String(user?.email || '').trim()
  const clientId = String(user?.operatorId || 'op_demo_001')
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  const [fullName, setFullName] = useState(user?.name || 'User')
  const [legalName, setLegalName] = useState(user?.name || 'User')
  const [phone, setPhone] = useState('')
  const [entityType, setEntityType] = useState('MALAYSIAN_INDIVIDUAL')
  const [idType, setIdType] = useState('NRIC')
  const [idNumber, setIdNumber] = useState('')
  const [taxNo, setTaxNo] = useState('')
  const [nickname, setNickname] = useState('')
  const [address, setAddress] = useState('')
  const [bankId, setBankId] = useState('')
  const [bankAccNo, setBankAccNo] = useState('')
  const [bankHolder, setBankHolder] = useState('')
  const [profileSelfVerifiedAt, setProfileSelfVerifiedAt] = useState('')
  const [profileIdentityVerified, setProfileIdentityVerified] = useState(false)
  const [passportExpiryDate, setPassportExpiryDate] = useState('')
  const [aliyunEkycVerified, setAliyunEkycVerified] = useState(false)
  const [aliyunEkycStarting, setAliyunEkycStarting] = useState(false)
  const [govDialogOpen, setGovDialogOpen] = useState(false)
  const [nricFront, setNricFront] = useState<string | null>(null)
  const [nricBack, setNricBack] = useState<string | null>(null)
  const [nricFrontUrl, setNricFrontUrl] = useState<string | null>(null)
  const [nricBackUrl, setNricBackUrl] = useState<string | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string>(String(user?.avatar || ''))
  const [avatarUrl, setAvatarUrl] = useState<string>(String(user?.avatar || ''))
  const [uploadingSide, setUploadingSide] = useState<'front' | 'back' | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [bankOptions, setBankOptions] = useState<Array<{ id: string; name: string }>>([])
  const [isInitializing, setIsInitializing] = useState(true)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [hasPassword, setHasPassword] = useState(!!user?.hasPassword)
  const [pwdDialogOpen, setPwdDialogOpen] = useState(false)
  const [pwdCodeSent, setPwdCodeSent] = useState(false)
  const [pwdSending, setPwdSending] = useState(false)
  const [pwdSubmitting, setPwdSubmitting] = useState(false)
  const [pwdCode, setPwdCode] = useState('')
  const [pwdNew, setPwdNew] = useState('')
  const [pwdConfirm, setPwdConfirm] = useState('')
  const [showPwdNew, setShowPwdNew] = useState(false)
  const [showPwdConfirm, setShowPwdConfirm] = useState(false)

  const [emailChangeOpen, setEmailChangeOpen] = useState(false)
  const [emailNew, setEmailNew] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailStep, setEmailStep] = useState<'enter' | 'code'>('enter')
  const [emailBusy, setEmailBusy] = useState(false)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedPayloadRef = useRef<string>('')
  const didInitSnapshotRef = useRef(false)
  const prevSelfVerifyVerifiedForUiRef = useRef<boolean | null>(null)

  const displayNameForCard = useMemo(
    () => String(nickname || legalName || fullName || 'User').trim() || 'User',
    [nickname, legalName, fullName]
  )

  const idTypeU = useMemo(() => String(idType || '').toUpperCase(), [idType])

  const roleNorm = String(roleLabel || '')
    .trim()
    .toLowerCase()

  /** Employee/Client + API profile: always show Verify (covers stale builds where selfVerifyMode was omitted). */
  const selfVerifyActive = useMemo(
    () =>
      !!backendProfile &&
      (selfVerifyMode || roleNorm === 'employee' || roleNorm === 'client'),
    [backendProfile, selfVerifyMode, roleNorm]
  )

  useEffect(() => {
    if (!selfVerifyActive || typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const ekyc = sp.get('ekyc')
    const cleanPath = window.location.pathname
    if (ekyc !== '1') return
    const tid = sessionStorage.getItem('aliyun_ekyc_tid')
    if (!tid) {
      router.replace(cleanPath, { scroll: false })
      return
    }
    void (async () => {
      const r = await fetchPortalAliyunIdvResult(tid)
      if (r.ok && r.passed) {
        sessionStorage.removeItem('aliyun_ekyc_tid')
        setAliyunEkycVerified(true)
        const pr = await fetchEmployeeProfileByEmail(email, clientId)
        if (pr?.ok && pr.profile) {
          const p = pr.profile as Record<string, unknown>
          setFullName(String(p.fullName || ''))
          setLegalName(String(p.legalName || ''))
          setNickname(String(p.nickname || ''))
          setPhone(String(p.phone || ''))
          setAddress(String(p.address || ''))
          setEntityType(String(p.entityType || 'MALAYSIAN_INDIVIDUAL'))
          setIdType(String(p.idType || 'NRIC'))
          setIdNumber(String(p.idNumber || ''))
          setTaxNo(String(p.taxIdNo || ''))
          setBankId(String(p.bankId || ''))
          setBankAccNo(String(p.bankAccountNo || ''))
          setBankHolder(String(p.bankAccountHolder || ''))
          setPassportExpiryDate(String(p.passportExpiryDate || '').trim())
          setProfileSelfVerifiedAt(String(p.profileSelfVerifiedAt || '').trim())
          if (p.avatarUrl) {
            setAvatarPreview(String(p.avatarUrl))
            setAvatarUrl(String(p.avatarUrl))
            updateUser({ avatar: String(p.avatarUrl) })
          }
          if (p.nricFrontUrl) {
            setNricFront(String(p.nricFrontUrl))
            setNricFrontUrl(String(p.nricFrontUrl))
          }
          if (p.nricBackUrl) {
            setNricBack(String(p.nricBackUrl))
            setNricBackUrl(String(p.nricBackUrl))
          }
          setAliyunEkycVerified(!!p.aliyunEkycLocked)
          setProfileIdentityVerified(!!(p as { profileIdentityVerified?: boolean }).profileIdentityVerified)
        }
        if (r.profileApplied === false && r.profileReason === 'GOV_ID_ALREADY_LINKED') {
          toast.warning('Verified, but name and ID were not saved — a government login is already linked.')
        } else if (
          r.profileApplied === false &&
          r.profileReason === 'NATIONAL_ID_ALREADY_BOUND' &&
          r.profileBoundEmail
        ) {
          toast.error(
            `National ID already verified on ${r.profileBoundEmail}. Sign in with that email or contact support.`,
          )
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
    router.replace(cleanPath, { scroll: false })
  }, [selfVerifyActive, router, email, clientId, updateUser])

  const idLabels = useMemo(() => {
    if (idType === 'PASSPORT') {
      return {
        section: 'Passport or travel document',
        front: 'Passport',
        back: 'Passport (additional page)',
      }
    }
    if (idType === 'BRN') {
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
  }, [idType])
  const requiresBackImage = idType !== 'PASSPORT'

  const inputCls =
    'w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await fetchEmployeeBanks()
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
      const result = await fetchEmployeeProfileByEmail(email)
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
        setTaxNo(String(p.taxIdNo || taxNo))
        setBankId(String(p.bankId || bankId))
        setBankAccNo(String(p.bankAccountNo || bankAccNo))
        setBankHolder(String(p.bankAccountHolder || bankHolder))
        if (p.avatarUrl) {
          setAvatarPreview(String(p.avatarUrl))
          setAvatarUrl(String(p.avatarUrl))
          updateUser({ avatar: String(p.avatarUrl) })
        }
        if (p.nricFrontUrl) {
          setNricFront(String(p.nricFrontUrl))
          setNricFrontUrl(String(p.nricFrontUrl))
        }
        if (p.nricBackUrl) {
          setNricBack(String(p.nricBackUrl))
          setNricBackUrl(String(p.nricBackUrl))
        }
        setProfileSelfVerifiedAt(String(p.profileSelfVerifiedAt || '').trim())
        setAliyunEkycVerified(!!(p as { aliyunEkycLocked?: boolean }).aliyunEkycLocked)
        setProfileIdentityVerified(!!(p as { profileIdentityVerified?: boolean }).profileIdentityVerified)
        setPassportExpiryDate(String((p as { passportExpiryDate?: string }).passportExpiryDate || '').trim())
      }
      setIsInitializing(false)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendProfile, email])

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
    if (isInitializing) return
    if (uploadingAvatar || uploadingSide) return
    const payload = buildProfilePayload()
    const payloadString = JSON.stringify(payload)
    if (payloadString === lastSavedPayloadRef.current) return

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaveState('saving')
    saveTimerRef.current = setTimeout(async () => {
      if (backendProfile) {
        const result = await saveEmployeeProfile(payload)
        if (!result.ok) {
          setSaveState('error')
          toast.error(result.reason || 'Auto-save failed')
          return
        }
      } else if (localStorageKey) {
        localStorage.setItem(localStorageKey, JSON.stringify(payload))
      }

      updateUser({
        name: payload.fullName || user?.name || '',
        avatar: payload.avatarUrl || user?.avatar || '',
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
  ])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (saveStateTimerRef.current) clearTimeout(saveStateTimerRef.current)
    }
  }, [])

  const handleSave = async () => {
    const payload = buildProfilePayload()
    if (backendProfile) {
      const result = await saveEmployeeProfile(payload)
      if (!result.ok) {
        toast.error(result.reason || 'Failed to save profile')
        return
      }
      updateUser({
        name: fullName || user?.name || '',
        avatar: avatarUrl || user?.avatar || '',
      })
      toast.success('Profile saved')
      return
    }
    if (localStorageKey) localStorage.setItem(localStorageKey, JSON.stringify(payload))
    updateUser({
      name: fullName || user?.name || '',
      avatar: avatarUrl || user?.avatar || '',
    })
    toast.success('Profile saved')
  }

  const handleNricFile = async (side: 'front' | 'back', file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file')
      return
    }
    setUploadingSide(side)
    const preview = URL.createObjectURL(file)
    if (side === 'front') setNricFront(preview)
    else setNricBack(preview)
    try {
      const upload = await uploadEmployeeFileToOss(file, clientId)
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
      const upload = await uploadEmployeeFileToOss(file, clientId)
      if (!upload.ok || !upload.url) {
        toast.error(upload.reason || 'Upload failed')
        return
      }
      setAvatarUrl(upload.url)
      setAvatarPreview(upload.url)
      updateUser({ avatar: upload.url })
      toast.success('Photo uploaded')
    } finally {
      setUploadingAvatar(false)
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
      logout()
      if (typeof window !== 'undefined') {
        window.location.href = `${window.location.origin}/login`
      }
    } finally {
      setEmailBusy(false)
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
      updateUser({ hasPassword: true })
      setPwdDialogOpen(false)
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

  const passportRenewalEligible =
    selfVerifyActive &&
    aliyunEkycVerified &&
    idTypeU === 'PASSPORT' &&
    isPassportRenewalWindow(passportExpiryDate)

  const selfVerifyVerifiedForUi =
    selfVerifyActive &&
    (profileSelfVerifiedAt.trim() !== '' || aliyunEkycVerified || profileIdentityVerified)

  const selfVerifyAliyunDone = selfVerifyActive && aliyunEkycVerified
  const disableVerificationDialogMyKad = !backendProfile || aliyunEkycStarting || selfVerifyAliyunDone
  const disableVerificationDialogPassport =
    !backendProfile || aliyunEkycStarting || (selfVerifyAliyunDone && !passportRenewalEligible)

  const startAliyunEkycFlow = async (docType: 'MYS01001' | 'GLB03002') => {
    if (!backendProfile) return
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
      const returnPath =
        typeof window !== 'undefined'
          ? (() => {
              const u = new URL(window.location.href)
              u.searchParams.set('ekyc', '1')
              return `${u.pathname}${u.search}`
            })()
          : '/portal/client/profile'
      const out = await startPortalAliyunIdvEkyc({
        metaInfo,
        docType,
        returnPath,
      })
      if (!out.ok || !out.transactionUrl || !out.transactionId) {
        toast.error(
          out.reason === 'ALIYUN_IDV_NOT_CONFIGURED'
            ? 'Identity verification isn’t enabled on this API (Alibaba Cloud keys missing in the server .env). Add them and restart the API, or use the live portal.'
            : out.reason || 'Could not start verification',
        )
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

  const selfVerifyDialogMandatory = selfVerifyActive && !selfVerifyVerifiedForUi

  useEffect(() => {
    if (isInitializing) return
    if (!selfVerifyActive) return
    if (!selfVerifyVerifiedForUi) setGovDialogOpen(true)
  }, [isInitializing, selfVerifyActive, selfVerifyVerifiedForUi])

  useEffect(() => {
    if (!selfVerifyActive) {
      prevSelfVerifyVerifiedForUiRef.current = null
      return
    }
    const wasUnverified = prevSelfVerifyVerifiedForUiRef.current === false
    if (selfVerifyVerifiedForUi && wasUnverified) {
      setGovDialogOpen(false)
    }
    prevSelfVerifyVerifiedForUiRef.current = selfVerifyVerifiedForUi
  }, [selfVerifyActive, selfVerifyVerifiedForUi])

  useEffect(() => {
    if (!selfVerifyActive || typeof window === 'undefined') return
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return
      const em = String(email || '').trim()
      if (!em) return
      void (async () => {
        const result = await fetchEmployeeProfileByEmail(em, clientId)
        if (!result?.ok || !result.profile) {
          setGovDialogOpen(true)
          return
        }
        const p = result.profile as Record<string, unknown>
        const psva = String(p.profileSelfVerifiedAt || '').trim()
        const ekycLock = !!(p as { aliyunEkycLocked?: boolean }).aliyunEkycLocked
        const piv = !!(p as { profileIdentityVerified?: boolean }).profileIdentityVerified
        setProfileSelfVerifiedAt(psva)
        setAliyunEkycVerified(ekycLock)
        setProfileIdentityVerified(piv)
        setPassportExpiryDate(String((p as { passportExpiryDate?: string }).passportExpiryDate || '').trim())
        if (psva === '' && !ekycLock && !piv) setGovDialogOpen(true)
      })()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [selfVerifyActive, email, clientId])

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-foreground">Profile Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your personal information and preferences.</p>
        <p className="text-xs text-muted-foreground mt-2">{saveHint}</p>
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
              {selfVerifyActive && selfVerifyVerifiedForUi ? (
                <span
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-white shadow-sm"
                  title="Verified"
                  aria-label="Verified"
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
          </div>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-5">
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0 shrink">
                <User size={16} style={{ color: 'var(--brand)' }} />
                <h2 className="font-bold text-foreground">Personal Information</h2>
              </div>
              {selfVerifyActive ? (
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:justify-end sm:shrink-0">
                  {aliyunEkycVerified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-semibold">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      eKYC (MyKad / passport)
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={selfVerifyVerifiedForUi && !passportRenewalEligible}
                    className={cn(
                      'w-full sm:w-auto min-w-[14rem] px-8 py-2.5 text-sm font-semibold rounded-xl shrink-0',
                      selfVerifyVerifiedForUi &&
                        'border-green-600 bg-green-600 text-white hover:bg-green-600 hover:text-white disabled:opacity-100 disabled:border-green-600 disabled:bg-green-600',
                    )}
                    onClick={() => setGovDialogOpen(true)}
                  >
                    {passportRenewalEligible
                      ? 'Re-verify passport'
                      : selfVerifyVerifiedForUi
                        ? 'Verified'
                        : 'Verify'}
                  </Button>
                </div>
              ) : null}
            </div>
            {selfVerifyActive && !selfVerifyVerifiedForUi ? (
              <div className="mb-5 flex flex-col gap-3 rounded-xl border border-primary/35 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-medium text-foreground">
                  Complete identity verification (MyKad or passport). Required for Employee and Client portal access.
                </p>
                <Button
                  type="button"
                  className="h-11 w-full min-w-[12rem] shrink-0 px-8 text-base font-semibold sm:w-auto"
                  onClick={() => setGovDialogOpen(true)}
                >
                  Verify identity
                </Button>
              </div>
            ) : null}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Entity Type
                </Label>
                <Select value={entityType} onValueChange={setEntityType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MALAYSIAN_INDIVIDUAL">Malaysian Individual</SelectItem>
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
                <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  ID Type
                </Label>
                <Select value={idType} onValueChange={setIdType}>
                  <SelectTrigger>
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
                <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} className={inputCls} />
              </div>
              <div>
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Tax ID (Optional)
                </Label>
                <input value={taxNo} onChange={(e) => setTaxNo(e.target.value)} className={inputCls} />
              </div>
              <div>
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Email Address
                </Label>
                <input value={email} disabled className={`${inputCls} opacity-80 cursor-not-allowed`} />
                {backendProfile ? (
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
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Phone Number
                </Label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Address
                </Label>
                <textarea
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className={`${inputCls} resize-none`}
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
                  <label className="relative flex flex-col items-center justify-center w-full min-h-[10rem] border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary transition-colors bg-secondary/30 overflow-hidden">
                    {nricFront ? (
                      <>
                        <img src={nricFront} alt={idLabels.front} className="w-full max-h-48 object-contain rounded-xl" />
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
                      </>
                    ) : (
                      <>
                        <Upload size={22} className="text-muted-foreground mb-2" />
                        <span className="text-xs text-muted-foreground">
                          {uploadingSide === 'front' ? 'Uploading...' : 'Click to upload'}
                        </span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleNricFile('front', e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
                {requiresBackImage ? (
                <div>
                  <p className="text-xs font-medium text-foreground mb-2">{idLabels.back}</p>
                  <label className="relative flex flex-col items-center justify-center w-full min-h-[10rem] border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary transition-colors bg-secondary/30 overflow-hidden">
                    {nricBack ? (
                      <>
                        <img src={nricBack} alt={idLabels.back} className="w-full max-h-48 object-contain rounded-xl" />
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
                      </>
                    ) : (
                      <>
                        <Upload size={22} className="text-muted-foreground mb-2" />
                        <span className="text-xs text-muted-foreground">
                          {uploadingSide === 'back' ? 'Uploading...' : 'Click to upload'}
                        </span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
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
                  <SelectTrigger>
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
                <input value={bankAccNo} onChange={(e) => setBankAccNo(e.target.value)} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5 block">
                  Account holder name
                </Label>
                <input value={bankHolder} onChange={(e) => setBankHolder(e.target.value)} className={inputCls} />
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

      <Dialog
        open={govDialogOpen}
        onOpenChange={(open) => {
          if (!open && selfVerifyDialogMandatory) return
          setGovDialogOpen(open)
        }}
      >
        <DialogContent
          className="sm:max-w-lg"
          showCloseButton={!selfVerifyDialogMandatory}
          onPointerDownOutside={(e) => {
            if (selfVerifyDialogMandatory) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            if (selfVerifyDialogMandatory) e.preventDefault()
          }}
          onEscapeKeyDown={(e) => {
            if (selfVerifyDialogMandatory) e.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>Identity verification</DialogTitle>
            <DialogDescription className="sr-only">Choose MyKad or passport.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              Choose Malaysian MyKad (NRIC) or passport. After verification you can finish your profile here.
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center"
              disabled={disableVerificationDialogMyKad}
              onClick={() => void startAliyunEkycFlow('MYS01001')}
            >
              {aliyunEkycStarting ? 'Starting…' : 'Verification by Malaysian MyKad (NRIC)'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center"
              disabled={disableVerificationDialogPassport}
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
          {!selfVerifyDialogMandatory ? (
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setGovDialogOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          ) : null}
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
