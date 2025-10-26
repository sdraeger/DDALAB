'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '@/store/appStore'
import { ApiService } from '@/services/apiService'
import { DDAResult } from '@/types/api'
import { useDDAHistory, useDeleteAnalysis, useRenameAnalysis, useAnalysisFromHistory } from '@/hooks/useDDAAnalysis'
import { DDAHistorySidebar } from './DDAHistorySidebar'
import { DDAAnalysis } from '@/components/DDAAnalysis'
import { DDAResults } from '@/components/DDAResults'
import { Loader2 } from 'lucide-react'

interface DDAWithHistoryProps {
  apiService: ApiService
}

export function DDAWithHistory({ apiService }: DDAWithHistoryProps) {
  const fileManager = useAppStore(state => state.fileManager)
  const currentAnalysis = useAppStore(state => state.dda.currentAnalysis)
  const setCurrentAnalysis = useAppStore(state => state.setCurrentAnalysis)
  const isServerReady = useAppStore(state => state.ui.isServerReady)

  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false)
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null)
  const isSettingAnalysis = useRef(false)

  // Fetch history from server using TanStack Query
  const {
    data: allHistory,
    isLoading: historyLoading,
    refetch: refetchHistory
  } = useDDAHistory(apiService, isServerReady && !!apiService.getSessionToken())

  // Memoize filtered history to prevent unnecessary re-renders
  const currentFilePath = fileManager.selectedFile?.file_path
  const fileHistory = useMemo(
    () => allHistory?.filter(item => item.file_path === currentFilePath) || [],
    [allHistory, currentFilePath]
  )

  // Fetch full analysis data when a history item is selected
  // TanStack Query will cache this and prevent duplicate requests
  const {
    data: selectedAnalysisData,
    isLoading: isLoadingAnalysis,
    isFetching: isFetchingAnalysis
  } = useAnalysisFromHistory(
    apiService,
    selectedAnalysisId,
    !!selectedAnalysisId && selectedAnalysisId !== currentAnalysis?.id
  )

  // Mutations
  const deleteAnalysisMutation = useDeleteAnalysis(apiService)
  const renameAnalysisMutation = useRenameAnalysis(apiService)

  // Initialize selected ID when current analysis changes or file changes
  useEffect(() => {
    if (currentAnalysis?.file_path === currentFilePath) {
      setSelectedAnalysisId(currentAnalysis.id)
    } else if (!currentAnalysis && fileHistory.length > 0) {
      // Auto-select most recent for this file
      setSelectedAnalysisId(fileHistory[0].id)
    } else if (!currentAnalysis) {
      setSelectedAnalysisId(null)
    }
  }, [currentAnalysis?.id, currentFilePath]) // Only depend on IDs, not whole objects

  // Update store when full analysis data is loaded
  useEffect(() => {
    if (selectedAnalysisData && !isSettingAnalysis.current) {
      isSettingAnalysis.current = true
      console.log('[DDA] Setting loaded analysis as current:', selectedAnalysisData.id)
      setCurrentAnalysis(selectedAnalysisData)
      // Use setTimeout to break out of sync rendering
      setTimeout(() => {
        isSettingAnalysis.current = false
      }, 0)
    }
  }, [selectedAnalysisData?.id]) // Only depend on ID

  const handleSelectAnalysis = (analysis: DDAResult) => {
    // Prevent multiple clicks while loading
    if (isLoadingAnalysis || isFetchingAnalysis) {
      console.log('[DDA] Already loading, ignoring click')
      return
    }

    // Don't re-select the same analysis
    if (selectedAnalysisId === analysis.id) {
      console.log('[DDA] Analysis already selected:', analysis.id)
      return
    }

    console.log('[DDA] Selecting analysis:', analysis.id)
    setSelectedAnalysisId(analysis.id)
  }

  const handleDeleteAnalysis = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()

    if (!confirm('Are you sure you want to delete this analysis?')) {
      return
    }

    try {
      await deleteAnalysisMutation.mutateAsync(id)

      // If we deleted the selected analysis, clear selection
      if (selectedAnalysisId === id) {
        setSelectedAnalysisId(null)
        setCurrentAnalysis(null)
      }

      // Refresh history
      await refetchHistory()
    } catch (error) {
      console.error('[DDA] Failed to delete analysis:', error)
    }
  }

  const handleRenameAnalysis = async (id: string, name: string) => {
    try {
      await renameAnalysisMutation.mutateAsync({ id, name })
      await refetchHistory()
    } catch (error) {
      console.error('[DDA] Failed to rename analysis:', error)
    }
  }

  // Determine what to display
  const displayAnalysis = currentAnalysis?.id === selectedAnalysisId
    ? currentAnalysis
    : selectedAnalysisData

  return (
    <div className="flex h-full">
      {/* History Sidebar */}
      <DDAHistorySidebar
        history={fileHistory}
        currentAnalysisId={selectedAnalysisId}
        selectedAnalysisId={selectedAnalysisId}
        isLoading={historyLoading || isLoadingAnalysis || isFetchingAnalysis}
        isCollapsed={isHistoryCollapsed}
        onToggleCollapse={() => setIsHistoryCollapsed(!isHistoryCollapsed)}
        onSelectAnalysis={handleSelectAnalysis}
        onDeleteAnalysis={handleDeleteAnalysis}
        onRenameAnalysis={handleRenameAnalysis}
        onRefresh={() => refetchHistory()}
      />

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {(isLoadingAnalysis || isFetchingAnalysis) && selectedAnalysisId ? (
          // Show loading state while fetching analysis data
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
              <p className="text-sm text-muted-foreground">Loading analysis...</p>
            </div>
          </div>
        ) : displayAnalysis ? (
          // Show results when analysis data is loaded
          // Key forces re-mount when switching between analyses
          <div key={displayAnalysis.id} className="p-4">
            <DDAResults result={displayAnalysis} />
          </div>
        ) : (
          // Show parameters form when no analysis selected
          <div className="p-4">
            <DDAAnalysis apiService={apiService} />
          </div>
        )}
      </div>
    </div>
  )
}
