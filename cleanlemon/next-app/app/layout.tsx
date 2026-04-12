import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { ChunkLoadRecovery } from '@/components/chunk-load-recovery'
import './globals.css'

const inter = Inter({ 
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans"
});

export const metadata: Metadata = {
  title: 'Cleanlemons - Cleaning Management System',
  description: 'Professional cleaning company management portal for supervisors, staff, and clients',
  generator: 'Cleanlemons',
  icons: {
    icon: 'https://saascoliving.oss-ap-southeast-3.aliyuncs.com/uploads/cleanlemons/2026/03/1510b0b7-66fa-425b-8721-4785c0acd0cd.png?OSSAccessKeyId=LTAI5t5sDvC3DSos4TBBPW39&Expires=1806042133&Signature=D7LWWvapeo9wDGPyxI9zCQp0Z5Y%3D',
    shortcut: 'https://saascoliving.oss-ap-southeast-3.aliyuncs.com/uploads/cleanlemons/2026/03/1510b0b7-66fa-425b-8721-4785c0acd0cd.png?OSSAccessKeyId=LTAI5t5sDvC3DSos4TBBPW39&Expires=1806042133&Signature=D7LWWvapeo9wDGPyxI9zCQp0Z5Y%3D',
    apple: 'https://saascoliving.oss-ap-southeast-3.aliyuncs.com/uploads/cleanlemons/2026/03/78622a67-2737-4d51-9cd8-9e030f5b774c.png?OSSAccessKeyId=LTAI5t5sDvC3DSos4TBBPW39&Expires=1806042131&Signature=7zqE4icvp9rD1P5uD1XoLv6PLcQ%3D',
  },
}

export const viewport: Viewport = {
  themeColor: '#1B2A41',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        <ChunkLoadRecovery />
        {children}
      </body>
    </html>
  )
}
