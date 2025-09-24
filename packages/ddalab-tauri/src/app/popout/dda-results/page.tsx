'use client'

import { ClientOnly } from '@/components/ClientOnly'
import dynamic from 'next/dynamic'

const DDAResultsPopout = dynamic(() => import('@/components/popout/DDAResultsPopout'), {
  ssr: false
})

export default function DDAResultsPopoutPage() {
  return (
    <ClientOnly>
      <DDAResultsPopout />
    </ClientOnly>
  )
}