import type { Metadata } from "next"
import TenantLayoutClient from "../tenant/tenant-layout-client"

export const metadata: Metadata = {
  title: "Demo profile (Gov ID)",
  robots: { index: false, follow: false },
}

export default function DemoprofileLayout({ children }: { children: React.ReactNode }) {
  return <TenantLayoutClient>{children}</TenantLayoutClient>
}
