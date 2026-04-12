"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
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
import { User, Mail, Phone, Lock, CreditCard, Camera, Upload, X, Eye, EyeOff, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { shouldUseDemoMock } from '@/lib/portal-api'
import { getMember, getCurrentRole } from '@/lib/portal-session'
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
} from '@/lib/unified-profile-portal-api'

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
}: Props) {
  const member = getMember()
  const email = String(member?.email || '').trim()
  const currentRole = getCurrentRole()
  const staffRole = member?.roles?.find((r) => r.type === 'staff') as { clientId?: string } | undefined
  const clientId = String(currentRole?.clientId || staffRole?.clientId || 'op_demo_001')

  const [backendProfile, setBackendProfile] = useState(false)
  const [localStorageKey, setLocalStorageKey] = useState<string | undefined>(undefined)

  useEffect(() => {
    const demo = shouldUseDemoMock()
    const em = String(getMember()?.email || '').trim()
    setBackendProfile(!demo && !!em)
    setLocalStorageKey(demo ? localStorageKeyDemo : undefined)
  }, [localStorageKeyDemo])

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

  const [fullName, setFullName] = useState(userNameHint)
  const [legalName, setLegalName] = useState(userNameHint)
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

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedPayloadRef = useRef<string>('')
  const didInitSnapshotRef = useRef(false)

  const displayNameForCard = useMemo(
    () => String(nickname || legalName || fullName || 'User').trim() || 'User',
    [nickname, legalName, fullName]
  )

  const publicProfilePath = useMemo(() => {
    const id = String(publicProfileTenantId ?? '').trim()
    if (!id) return ''
    return `/profile/${encodeURIComponent(id)}`
  }, [publicProfileTenantId])

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
        const result = await savePortalProfile(payload)
        if (!result.ok) {
          setSaveState('error')
          toast.error(result.reason || 'Auto-save failed')
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
      const result = await savePortalProfile(payload)
      if (!result.ok) {
        toast.error(result.reason || 'Failed to save profile')
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

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-black text-foreground">Profile Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your personal information and preferences.</p>
          <p className="text-xs text-muted-foreground mt-2">{saveHint}</p>
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
            <div className="font-black text-foreground text-lg">{displayNameForCard}</div>
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
            <div className="flex items-center gap-2 mb-5">
              <User size={16} style={{ color: 'var(--brand)' }} />
              <h2 className="font-bold text-foreground">Personal Information</h2>
            </div>
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
