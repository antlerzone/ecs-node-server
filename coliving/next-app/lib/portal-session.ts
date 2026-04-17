/**
 * Portal session storage keys and types. Stored in localStorage (client).
 * One email = one member; currentRole = chosen identity for this session.
 */

import type { MemberRole, MemberRoleType } from "./portal-api";

export const PORTAL_KEYS = {
  MEMBER: "portal_member",
  CURRENT_ROLE: "portal_current_role",
  /** Short-lived JWT from OAuth callback or password login — required for GET/PUT /api/portal-auth/profile. */
  PORTAL_JWT: "portal_jwt",
} as const;

export interface PortalMember {
  email: string;
  roles: MemberRole[];
}

export interface CurrentRole {
  type: MemberRoleType;
  staffId?: string;
  clientId?: string;
  clientTitle?: string;
  tenantId?: string;
  ownerId?: string;
}

export function getMember(): PortalMember | null {
  if (typeof window === "undefined") return null;
  try {
    let raw = localStorage.getItem(PORTAL_KEYS.MEMBER);
    if (raw) {
      const parsed = JSON.parse(raw) as PortalMember;
      if (parsed?.email) return { email: parsed.email, roles: Array.isArray(parsed.roles) ? parsed.roles : [] };
    }
    // Fallback: legacy "user" key (login form also sets this); 避免 tenant/owner 誤判為未登入
    const userRaw = localStorage.getItem("user");
    if (userRaw) {
      try {
        const user = JSON.parse(userRaw) as { email?: string; roles?: string[] };
        if (user?.email) {
          const roles: MemberRole[] = (user.roles || []).map((r) => ({
            type: (r === "operator" ? "staff" : r) as MemberRoleType,
          }));
          const member: PortalMember = { email: user.email, roles };
          localStorage.setItem(PORTAL_KEYS.MEMBER, JSON.stringify(member));
          return member;
        }
      } catch {
        // ignore
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function setMember(member: PortalMember): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PORTAL_KEYS.MEMBER, JSON.stringify(member));
}

export function getCurrentRole(): CurrentRole | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PORTAL_KEYS.CURRENT_ROLE);
    if (!raw) return null;
    return JSON.parse(raw) as CurrentRole;
  } catch {
    return null;
  }
}

export function setCurrentRole(role: CurrentRole | null): void {
  if (typeof window === "undefined") return;
  if (role) {
    localStorage.setItem(PORTAL_KEYS.CURRENT_ROLE, JSON.stringify(role));
  } else {
    localStorage.removeItem(PORTAL_KEYS.CURRENT_ROLE);
  }
}

export function clearPortalSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PORTAL_KEYS.MEMBER);
  localStorage.removeItem(PORTAL_KEYS.CURRENT_ROLE);
  localStorage.removeItem(PORTAL_KEYS.PORTAL_JWT);
  localStorage.removeItem("user");
}
