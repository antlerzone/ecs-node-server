import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as SonnerToaster } from 'sonner'
import { SeoJsonLd } from '@/components/seo-json-ld'
import { SITE_URL, SITE_NAME, DEFAULT_DESCRIPTION, defaultOpenGraph, defaultTwitter } from '@/lib/seo'

/** Fonts load via <link> so `next build` does not fetch Google (ECS / offline builds often ETIMEDOUT). */

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} | Tenant & Owner Portal`,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  keywords: [
    'room management SaaS',
    'fully automated room management',
    'automated rental management',
    'room management software Malaysia',
    'room management software Singapore',
    'coliving management',
    'rental room management',
    'tenant portal',
    'owner portal',
    'operator dashboard',
    'property management software',
    'smart lock',
    'metered billing',
    'Malaysia coliving',
    'Singapore coliving',
    'Johor Bahru',
    'rental management platform',
  ],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  openGraph: {
    ...defaultOpenGraph,
    title: `${SITE_NAME} | Tenant & Owner Portal`,
    // Add images: [{ url: '/og-portal.png', width: 1200, height: 630, alt: SITE_NAME }] when you have the asset in public/
  },
  twitter: {
    ...defaultTwitter,
    title: `${SITE_NAME} | Tenant & Owner Portal`,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  icons: {
    icon: [
      { url: '/favicon-cm.ico', sizes: 'any' },
      { url: '/favicon-cm.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-icon-cm.png',
  },
  alternates: { canonical: SITE_URL },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="preload" href="/favicon-cm.ico" as="image" />
        <link rel="icon" href="/favicon-cm.ico" sizes="any" />
      </head>
      <body className="font-sans antialiased">
        <SeoJsonLd />
        {children}
        <Toaster />
        <SonnerToaster richColors closeButton position="top-center" />
      </body>
    </html>
  )
}
