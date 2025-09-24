'use client'

import { ClientOnly } from '@/components/ClientOnly'
import dynamic from 'next/dynamic'

const TimeSeriesPopout = dynamic(() => import('@/components/popout/TimeSeriesPopout'), {
  ssr: false
})

export default function TimeSeriesPopoutPage() {
  return (
    <ClientOnly>
      <TimeSeriesPopout />
    </ClientOnly>
  )
}