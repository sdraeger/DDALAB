import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { QueryProvider } from '@/providers/QueryProvider'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'DDALAB - Delay Differential Analysis Laboratory',
  description: 'Scientific computing application for performing Delay Differential Analysis on EDF and ASCII files',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <QueryProvider>
          <div className="min-h-screen bg-background text-foreground">
            {children}
          </div>
        </QueryProvider>
      </body>
    </html>
  )
}
