'use client'

import { useState, useEffect } from 'react'
import { ApiService } from '@/services/apiService'
import { useAppStore } from '@/store/appStore'
import { FileManager } from '@/components/FileManager'
import { HealthStatusBar } from '@/components/HealthStatusBar'
import { TimeSeriesPlot } from '@/components/TimeSeriesPlot'
import { DDAAnalysis } from '@/components/DDAAnalysis'
import { DDAResults } from '@/components/DDAResults'
import { SettingsPanel } from '@/components/SettingsPanel'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  Brain,
  FileText,
  BarChart3,
  Activity,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Maximize2,
  Minimize2
} from 'lucide-react'
import { TauriService } from '@/services/tauriService'

interface DashboardLayoutProps {
  apiUrl: string
}

export function DashboardLayout({ apiUrl }: DashboardLayoutProps) {
  const [apiService, setApiService] = useState(() => new ApiService(apiUrl))
  const {
    ui,
    fileManager,
    dda,
    setSidebarOpen,
    setActiveTab,
    setLayout,
    setCurrentAnalysis,
    setAnalysisHistory
  } = useAppStore()

  const [autoLoadingResults, setAutoLoadingResults] = useState(false)

  // Update API service when mode changes
  useEffect(() => {
    const getApiUrl = () => {
      if (ui.apiMode === 'embedded') {
        return 'http://localhost:8765' // Embedded API server port
      } else {
        return apiUrl // Docker API URL
      }
    }

    const newApiUrl = getApiUrl()
    if (apiService.baseURL !== newApiUrl) {
      setApiService(new ApiService(newApiUrl))
    }
  }, [ui.apiMode, apiUrl, apiService.baseURL])

  // Auto-load most recent analysis from MinIO on component mount
  // Only load after server is ready to avoid connection errors
  useEffect(() => {
    const loadAnalysisHistory = async () => {
      // Wait for server to be ready before attempting to fetch
      if (!ui.isServerReady) {
        console.log('[DASHBOARD] Waiting for server to be ready before loading analysis history')
        return
      }

      console.log('[DASHBOARD] Server is ready, loading analysis history')

      try {
        const history = await apiService.getAnalysisHistory()
        setAnalysisHistory(history)
      } catch (error) {
        console.error('Failed to load analysis history:', error)
      }
    }

    loadAnalysisHistory()
  }, [ui.isServerReady, apiService, setAnalysisHistory])

  // Auto-load most recent analysis if no current analysis is set
  useEffect(() => {
    const autoLoadMostRecent = async () => {
      if (!dda.currentAnalysis && dda.analysisHistory.length > 0 && !autoLoadingResults) {
        setAutoLoadingResults(true)
        try {
          console.log('Auto-loading most recent analysis from dashboard:', dda.analysisHistory[0].id)
          await new Promise(resolve => setTimeout(resolve, 100))

          const fullAnalysis = await apiService.getAnalysisFromHistory(dda.analysisHistory[0].id)
          if (fullAnalysis) {
            console.log('Setting current analysis from dashboard:', fullAnalysis.id)
            setCurrentAnalysis(fullAnalysis)
          }
        } catch (error) {
          console.error('Failed to auto-load most recent analysis:', error)
        } finally {
          setAutoLoadingResults(false)
        }
      }
    }

    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => autoLoadMostRecent())
    } else {
      setTimeout(() => autoLoadMostRecent(), 0)
    }
  }, [dda.currentAnalysis, dda.analysisHistory, autoLoadingResults, apiService, setCurrentAnalysis])

  const handleMinimize = async () => {
    if (TauriService.isTauri()) {
      await TauriService.minimizeWindow()
    }
  }

  const handleMaximize = async () => {
    if (TauriService.isTauri()) {
      await TauriService.maximizeWindow()
    }
  }

  const handleClose = async () => {
    if (TauriService.isTauri()) {
      await TauriService.closeWindow()
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Title Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-background">
        <div className="flex items-center space-x-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!ui.sidebarOpen)}
            className="h-8 w-8"
          >
            {ui.sidebarOpen ?
              <PanelLeftClose className="h-4 w-4" /> :
              <PanelLeftOpen className="h-4 w-4" />
            }
          </Button>

          <div className="flex items-center space-x-2">
            <Brain className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-lg font-bold">DDALAB Desktop</h1>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <div className="text-sm text-muted-foreground">
            {fileManager.selectedFile?.file_name || 'No file selected'}
          </div>

          {TauriService.isTauri() && (
            <div className="flex items-center space-x-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleMinimize}
                className="h-6 w-6"
              >
                <Minimize2 className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleMaximize}
                className="h-6 w-6"
              >
                <Maximize2 className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClose}
                className="h-6 w-6 text-red-500 hover:text-red-600"
              >
                ×
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {ui.sidebarOpen ? (
          <div className="w-80 flex-shrink-0 border-r bg-background overflow-hidden flex flex-col">
            <FileManager apiService={apiService} />
          </div>
        ) : (
          <div
            className="w-12 flex-shrink-0 border-r bg-background hover:bg-accent transition-colors cursor-pointer flex items-center justify-center"
            onClick={() => setSidebarOpen(true)}
            title="Click to expand sidebar"
          >
            <PanelLeftOpen className="h-5 w-5 text-muted-foreground" />
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 flex flex-col">
          <Tabs
            value={ui.activeTab}
            onValueChange={setActiveTab}
            className="flex-1 flex flex-col"
          >
            {/* Tab Navigation */}
            <div className="border-b px-4 py-2">
              <TabsList>
                <TabsTrigger value="files" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Files
                </TabsTrigger>
                <TabsTrigger value="plots" className="flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Time Series
                </TabsTrigger>
                <TabsTrigger value="analysis" className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  DDA Analysis
                </TabsTrigger>
                <TabsTrigger value="results" className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Results
                </TabsTrigger>
                <TabsTrigger value="settings" className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Settings
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-auto">
              <TabsContent value="files" className="h-full m-0">
                <div className="p-6 h-full">
                  {fileManager.selectedFile ? (
                    <div className="space-y-6">
                      <div>
                        <h2 className="text-2xl font-bold mb-4">File Details</h2>
                        <div className="bg-card border rounded-lg p-6">
                          <h3 className="text-lg font-semibold mb-4">{fileManager.selectedFile.file_name}</h3>
                          <div className="grid md:grid-cols-2 gap-6">
                            <div className="space-y-3">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Duration:</span>
                                <span>{fileManager.selectedFile.duration?.toFixed(2) || '0'}s</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Sample Rate:</span>
                                <span>{fileManager.selectedFile.sample_rate} Hz</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Total Samples:</span>
                                <span>{fileManager.selectedFile.total_samples?.toLocaleString() || '0'}</span>
                              </div>
                            </div>
                            <div className="space-y-3">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Channels:</span>
                                <span>{fileManager.selectedFile.channels.length}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">File Size:</span>
                                <span>{(fileManager.selectedFile.file_size / 1024 / 1024).toFixed(2)} MB</span>
                              </div>
                            </div>
                          </div>

                          {fileManager.selectedFile.channels.length > 0 && (
                            <div className="mt-6">
                              <h4 className="font-medium mb-3">Available Channels:</h4>
                              <div className="flex flex-wrap gap-2">
                                {fileManager.selectedFile.channels.slice(0, 20).map((channel, index) => (
                                  <span
                                    key={index}
                                    className="px-2 py-1 bg-secondary text-secondary-foreground rounded text-sm"
                                  >
                                    {channel}
                                  </span>
                                ))}
                                {fileManager.selectedFile.channels.length > 20 && (
                                  <span className="px-2 py-1 bg-muted text-muted-foreground rounded text-sm">
                                    +{fileManager.selectedFile.channels.length - 20} more
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <FileText className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-medium mb-2">No File Selected</h3>
                        <p className="text-muted-foreground">
                          Select a file from the sidebar to view its details
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="plots" className="h-full m-0">
                <div className="p-4 h-full">
                  <TimeSeriesPlot apiService={apiService} />
                </div>
              </TabsContent>

              <TabsContent value="analysis" className="h-full m-0">
                <div className="p-4 h-full">
                  <DDAAnalysis apiService={apiService} />
                </div>
              </TabsContent>

              <TabsContent value="results" className="h-full m-0">
                <div className="p-4 h-full">
                  {(() => {
                    console.log('[DASHBOARD] Results tab render:', {
                      hasCurrentAnalysis: !!dda.currentAnalysis,
                      analysisId: dda.currentAnalysis?.id,
                      autoLoadingResults,
                      historyLength: dda.analysisHistory.length
                    })
                    return null
                  })()}
                  {dda.currentAnalysis ? (
                    <DDAResults result={dda.currentAnalysis} />
                  ) : autoLoadingResults ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                        <h3 className="text-lg font-medium mb-2">Loading Analysis Results</h3>
                        <p className="text-muted-foreground">
                          Fetching the most recent analysis from MinIO storage...
                        </p>
                      </div>
                    </div>
                  ) : dda.analysisHistory.length > 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <Settings className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-medium mb-2">Analysis Available</h3>
                        <p className="text-muted-foreground mb-4">
                          Found {dda.analysisHistory.length} analysis{dda.analysisHistory.length > 1 ? 'es' : ''} in history
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Switch to the DDA Analysis tab to view results
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <Settings className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-medium mb-2">No Analysis Results</h3>
                        <p className="text-muted-foreground">
                          Run a DDA analysis to see results here
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="settings" className="h-full m-0">
                <SettingsPanel />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>

      {/* Health Status Bar */}
      <HealthStatusBar apiService={apiService} />
    </div>
  )
}
