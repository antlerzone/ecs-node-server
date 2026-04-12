"use client"

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import type { UserRole, PricingPlan } from './types'
import { getCleanlemonApiBase } from './portal-auth-mock'

/** Slim Cleanlemons block from portal JWT (full employee profile via login/member-roles API). */
export type CleanlemonsJwtContext = {
  operatorChoices: Array<{
    operatorId: string
    operatorName: string
    sources: ('supervisor' | 'employee' | 'master')[]
  }>
  employeeId: string | null
  supervisorOperators: Array<{
    supervisorId: string
    operatorId: string
    operatorName: string
  }>
  employeeOperators: Array<{
    junctionId: string
    operatorId: string
    operatorName: string
    staffRole: string
  }>
}

export interface User {
  id: string
  email: string
  name: string
  avatar?: string
  role: UserRole
  provider?: 'email' | 'google' | 'facebook'
  /** True when account has bcrypt password; OAuth-only users false until they set password. */
  hasPassword?: boolean
  operatorId?: string
  /** From ECS getMemberRoles → JWT: supervisor + employee_operator merged operator list. */
  cleanlemons?: CleanlemonsJwtContext | null
  plan?: PricingPlan
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<boolean>
  loginWithGoogle: () => Promise<boolean>
  loginWithFacebook: () => Promise<boolean>
  register: (email: string, password: string, name: string) => Promise<boolean>
  logout: () => void
  setUserRole: (role: UserRole) => void
  updateUser: (patch: Partial<User>) => void
  /** Re-read `cleanlemons_user` from localStorage (e.g. after OAuth popup wrote session). */
  syncSessionFromStorage: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)
const PORTAL_JWT_KEY = 'cleanlemons_portal_jwt'

function pickUserRoleFromMemberRoles(rows: Array<{ type?: string }> | undefined): UserRole {
  const list = Array.isArray(rows) ? rows : []
  const has = (t: string) => list.some((x) => String(x?.type || '').trim().toLowerCase() === t)
  if (has('saas_admin')) return 'saas-admin'
  if (has('owner')) return 'client'
  if (has('staff')) return 'employee'
  return null
}

/** First role row that carries a Coliving client / Cleanlemons operator id (saas_admin has none). */
export function pickFirstClientIdFromMemberRoles(
  roles?: Array<{ type?: string; clientId?: string; client_id?: string }>
): string {
  const list = Array.isArray(roles) ? roles : []
  for (const r of list) {
    const id = String(r?.clientId ?? r?.client_id ?? '').trim()
    if (id) return id
  }
  return ''
}

function pickInitialOperatorIdFromMemberPayload(payload: {
  cleanlemons?: CleanlemonsJwtContext | null
  roles?: Array<{ clientId?: string; client_id?: string }>
}): string {
  const choices = Array.isArray(payload.cleanlemons?.operatorChoices)
    ? payload.cleanlemons?.operatorChoices
    : []
  if (choices.length > 0) return String(choices[0].operatorId || 'op_demo_001')
  const fromRoles = pickFirstClientIdFromMemberRoles(payload.roles)
  if (fromRoles) return fromRoles
  return 'op_demo_001'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const syncSessionFromStorage = useCallback(() => {
    try {
      const savedUser = localStorage.getItem('cleanlemons_user')
      if (savedUser) {
        setUser(JSON.parse(savedUser) as User)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    syncSessionFromStorage()
    setIsLoading(false)
  }, [syncSessionFromStorage])

  const login = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true)
    try {
      const apiBase = getCleanlemonApiBase()
      if (apiBase) {
        const r = await fetch(`${apiBase}/api/portal-auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: String(email || '').trim().toLowerCase(),
            password: String(password || ''),
            frontend: typeof window !== 'undefined' ? window.location.origin : '',
          }),
        })
        const data = (await r.json().catch(() => ({}))) as {
          ok?: boolean
          email?: string
          roles?: Array<{ type?: string; clientId?: string; client_id?: string }>
          cleanlemons?: CleanlemonsJwtContext | null
          token?: string
        }
        if (!r.ok || !data?.ok || !data?.email) {
          setIsLoading(false)
          return false
        }
        const normalizedEmail = String(data.email).trim().toLowerCase()
        const newUser: User = {
          id: `user_${Date.now()}`,
          email: normalizedEmail,
          name: normalizedEmail.split('@')[0],
          role: pickUserRoleFromMemberRoles(data.roles),
          provider: 'email',
          hasPassword: true,
          operatorId: pickInitialOperatorIdFromMemberPayload(data),
          cleanlemons: data.cleanlemons ?? null,
          plan: 'grow',
        }
        if (data.token) {
          try {
            localStorage.setItem(PORTAL_JWT_KEY, String(data.token))
          } catch {
            /* ignore */
          }
        }
        setUser(newUser)
        localStorage.setItem('cleanlemons_user', JSON.stringify(newUser))
        setIsLoading(false)
        return true
      }

      await new Promise(resolve => setTimeout(resolve, 1000))
      const newUser: User = {
        id: `user_${Date.now()}`,
        email,
        name: email.split('@')[0],
        role: null,
        provider: 'email',
        hasPassword: true,
        operatorId: 'op_demo_001',
        plan: 'grow'
      }
      setUser(newUser)
      localStorage.setItem('cleanlemons_user', JSON.stringify(newUser))
      setIsLoading(false)
      return true
    } catch {
      setIsLoading(false)
      return false
    }
  }

  const loginWithGoogle = async (): Promise<boolean> => {
    setIsLoading(true)
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    const demoEmail = 'user@gmail.com'
    const newUser: User = {
      id: `google_${Date.now()}`,
      email: demoEmail,
      // 與 portal.colivingjb.com 一致：顯示名用 email @ 前綴，不用「Google User」佔位
      name: demoEmail.split('@')[0],
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=google',
      role: null,
      provider: 'google',
      hasPassword: false,
      operatorId: 'op_demo_001',
      plan: 'grow'
    }
    setUser(newUser)
    localStorage.setItem('cleanlemons_user', JSON.stringify(newUser))
    setIsLoading(false)
    return true
  }

  const loginWithFacebook = async (): Promise<boolean> => {
    setIsLoading(true)
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    const demoFbEmail = 'user@facebook.com'
    const newUser: User = {
      id: `facebook_${Date.now()}`,
      email: demoFbEmail,
      name: demoFbEmail.split('@')[0],
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=facebook',
      role: null,
      provider: 'facebook',
      hasPassword: false,
      operatorId: 'op_demo_001',
      plan: 'grow'
    }
    setUser(newUser)
    localStorage.setItem('cleanlemons_user', JSON.stringify(newUser))
    setIsLoading(false)
    return true
  }

  const register = async (email: string, password: string, name: string): Promise<boolean> => {
    setIsLoading(true)
    try {
      const apiBase = getCleanlemonApiBase()
      if (apiBase) {
        const r = await fetch(`${apiBase}/api/portal-auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: String(email || '').trim().toLowerCase(),
            password: String(password || ''),
            frontend: typeof window !== 'undefined' ? window.location.origin : '',
          }),
        })
        const data = (await r.json().catch(() => ({}))) as { ok?: boolean }
        if (!r.ok || !data?.ok) {
          setIsLoading(false)
          return false
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      const newUser: User = {
        id: `user_${Date.now()}`,
        email,
        name,
        role: null,
        provider: 'email',
        hasPassword: true,
        operatorId: 'op_demo_001',
        plan: 'basic'
      }
      setUser(newUser)
      localStorage.setItem('cleanlemons_user', JSON.stringify(newUser))
      setIsLoading(false)
      return true
    } catch {
      setIsLoading(false)
      return false
    }
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem('cleanlemons_user')
    try {
      localStorage.removeItem('cleanlemons_portal_jwt')
    } catch {
      /* ignore */
    }
  }

  const setUserRole = (role: UserRole) => {
    if (user) {
      const updatedUser = { ...user, role }
      setUser(updatedUser)
      localStorage.setItem('cleanlemons_user', JSON.stringify(updatedUser))
    }
  }

  const updateUser = useCallback((patch: Partial<User>) => {
    if (!patch) return
    setUser((prev) => {
      if (!prev) return prev
      const updatedUser = { ...prev, ...patch }
      try {
        localStorage.setItem('cleanlemons_user', JSON.stringify(updatedUser))
      } catch {
        /* ignore */
      }
      return updatedUser
    })
  }, [])

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      login,
      loginWithGoogle,
      loginWithFacebook,
      register,
      logout,
      setUserRole,
      updateUser,
      syncSessionFromStorage
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
