/**
 * Avoid Next prerender + `s-maxage=31536000` on this route: stale HTML keeps old
 * form markup and mismatched `/_next/static/*` hashes after deploy (CDN / shared cache).
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function OperatorPropertyLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
