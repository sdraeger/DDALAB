'use client'

import { ClientOnly } from '@/components/ClientOnly'
import dynamic from 'next/dynamic'

// For now, reuse TimeSeriesPopout for EEG visualization
// In the future, this could be a specialized EEG component
const TimeSeriesPopout = dynamic(() => import('@/components/popout/TimeSeriesPopout'), {
  ssr: false
})

export default function EEGVisualizationPopoutPage() {
  return (
    <ClientOnly>
      <TimeSeriesPopout />
    </ClientOnly>
  )
}