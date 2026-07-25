import type { Metadata } from 'next'
import ClientAuthGuard from '@/components/ClientAuthGuard'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Shakya Consultants CRM',
    template: '%s | Shakya Consultants',
  },
  description:
    'Shakya Consultants sales portal for managing leads, teams, and operations.',
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">
        <ClientAuthGuard>{children}</ClientAuthGuard>
      </body>
    </html>
  )
}
