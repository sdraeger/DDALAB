import React, { useEffect, useMemo } from 'react'
import { PopoutLayout } from './PopoutLayout'
import { TimeSeriesPlotECharts } from '@/components/TimeSeriesPlotECharts'
import { useAppStore } from '@/store/appStore'
import { ApiService } from '@/services/apiService'

interface TimeSeriesPopoutContentProps {
  data?: any
  isLocked?: boolean
  windowId?: string
}

function TimeSeriesPopoutContent({ data, isLocked, windowId }: TimeSeriesPopoutContentProps) {
  const setSelectedFile = useAppStore(state => state.setSelectedFile)
  const setSelectedChannels = useAppStore(state => state.setSelectedChannels)

  // Create ApiService instance for embedded API
  const apiService = useMemo(() => new ApiService('http://localhost:8765'), [])

  // Sync received data with store on initial load and updates
  useEffect(() => {
    console.log('[POPOUT-TIMESERIES] Received data update:', { hasData: !!data, isLocked, windowId })

    if (!data || isLocked) {
      console.log('[POPOUT-TIMESERIES] Skipping data sync - no data or locked')
      return
    }

    // Mark persistence as restored so components don't wait
    useAppStore.setState({ isPersistenceRestored: true })

    // If we have file information in the data, sync it to the store
    if (data.filePath || data.file_path) {
      console.log('[POPOUT-TIMESERIES] Syncing file to store:', data.filePath || data.file_path)

      // Create a minimal file info object for the store
      const fileInfo = {
        file_path: data.filePath || data.file_path,
        file_name: data.fileName || data.file_name || 'Unknown',
        channels: data.channels || [],
        duration: data.timeWindow || data.duration || 0,
        sample_rate: data.sampleRate || data.sample_rate || 500,
        selected_channels: data.selectedChannels || data.channels || []
      }

      setSelectedFile(fileInfo as any)

      // Set selected channels if available
      if (data.selectedChannels && Array.isArray(data.selectedChannels)) {
        setSelectedChannels(data.selectedChannels)
      }
    }
  }, [data, isLocked, windowId, setSelectedFile, setSelectedChannels])

  return (
    <div className="h-full w-full p-4">
      <TimeSeriesPlotECharts apiService={apiService} />
    </div>
  )
}

export default function TimeSeriesPopout() {
  return (
    <PopoutLayout
      title="Time Series Visualization"
      showRefresh={false}
    >
      <TimeSeriesPopoutContent />
    </PopoutLayout>
  )
}
