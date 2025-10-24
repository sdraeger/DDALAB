'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/appStore'
import { ApiService } from '@/services/apiService'
import { DDAResult } from '@/types/api'
import { useDDAHistory, useDeleteAnalysis, useRenameAnalysis } from '@/hooks/useDDAAnalysis'
import { DDAHistorySidebar } from './DDAHistorySidebar'
import { DDAAnalysis } from '@/components/DDAAnalysis'
import { DDAResults } from '@/components/DDAResults'

interface DDAWithHistoryProps {
  apiService: ApiService
}

export function DDAWithHistory({ apiService }: DDAWithHistoryProps) {
  const fileManager = useAppStore(state => state.fileManager)
  const currentAnalysis = useAppStore(state => state.dda.currentAnalysis)
  const setCurrentAnalysis = useAppStore(state => state.setCurrentAnalysis)
  const isServerReady = useAppStore(state => state.ui.isServerReady)

  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false)
  const [selectedAnalysis, setSelectedAnalysis] = useState<DDAResult | null>(null)

  // Fetch history from server
  const {
    data: allHistory,
    isLoading: historyLoading,
    refetch: refetchHistory
  } = useDDAHistory(apiService, isServerReady && !!apiService.getSessionToken())

  // Filter history by current file
  const currentFilePath = fileManager.selectedFile?.file_path
  const fileHistory = allHistory?.filter(item => item.file_path === currentFilePath) || []

  // Mutations
  const deleteAnalysisMutation = useDeleteAnalysis(apiService)
  const renameAnalysisMutation = useRenameAnalysis(apiService)

  // Sync selected analysis with current analysis
  useEffect(() => {
    if (currentAnalysis && currentAnalysis.file_path === currentFilePath) {
      setSelectedAnalysis(currentAnalysis)
    } else if (currentFilePath && !currentAnalysis) {
      // No current analysis - show most recent for this file
      if (fileHistory.length > 0) {
        setSelectedAnalysis(fileHistory[0])
      } else {
        setSelectedAnalysis(null)
      }
    }
  }, [currentAnalysis, currentFilePath, fileHistory])

  const handleSelectAnalysis = (analysis: DDAResult) => {
    setSelectedAnalysis(analysis)
    // Optionally set as current analysis
    setCurrentAnalysis(analysis)
  }

  const handleDeleteAnalysis = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()

    if (!confirm('Are you sure you want to delete this analysis?')) {
      return
    }

    try {
      await deleteAnalysisMutation.mutateAsync(id)

      // If we deleted the selected analysis, clear selection
      if (selectedAnalysis?.id === id) {
        setSelectedAnalysis(null)
      }

      // If we deleted the current analysis, clear it
      if (currentAnalysis?.id === id) {
        setCurrentAnalysis(null)
      }

      // Refresh history
      refetchHistory()
    } catch (error) {
      console.error('[DDA] Failed to delete analysis:', error)
    }
  }

  const handleRenameAnalysis = async (id: string, name: string) => {
    try {
      await renameAnalysisMutation.mutateAsync({ id, name })
      refetchHistory()
    } catch (error) {
      console.error('[DDA] Failed to rename analysis:', error)
    }
  }

  return (
    <div className="flex h-full">
      {/* History Sidebar */}
      <DDAHistorySidebar
        history={fileHistory}
        currentAnalysisId={currentAnalysis?.id || null}
        selectedAnalysisId={selectedAnalysis?.id || null}
        isLoading={historyLoading}
        isCollapsed={isHistoryCollapsed}
        onToggleCollapse={() => setIsHistoryCollapsed(!isHistoryCollapsed)}
        onSelectAnalysis={handleSelectAnalysis}
        onDeleteAnalysis={handleDeleteAnalysis}
        onRenameAnalysis={handleRenameAnalysis}
        onRefresh={() => refetchHistory()}
      />

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {selectedAnalysis ? (
          // Show results when an analysis is selected
          <div className="p-4">
            <DDAResults result={selectedAnalysis} />
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
