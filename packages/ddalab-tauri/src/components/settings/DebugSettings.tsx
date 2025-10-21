'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { TauriService } from '@/services/tauriService'
import { FileText, FolderOpen, Bug } from 'lucide-react'

export function DebugSettings() {
  const [logsPath, setLogsPath] = useState<string>('')

  useEffect(() => {
    const fetchLogsPath = async () => {
      if (!TauriService.isTauri()) return
      try {
        const path = await TauriService.getLogsPath()
        setLogsPath(path)
      } catch (error) {
        console.error('Failed to fetch logs path:', error)
      }
    }

    fetchLogsPath()
  }, [])

  const handleOpenLogs = async () => {
    if (!TauriService.isTauri()) return
    try {
      await TauriService.openLogsFolder()
    } catch (error) {
      console.error('Failed to open logs folder:', error)
    }
  }

  const handleReportIssue = async () => {
    try {
      await TauriService.openUrl('https://github.com/anthropics/claude-code/issues/new')
    } catch (error) {
      console.error('Failed to open issue tracker:', error)
    }
  }

  if (!TauriService.isTauri()) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-2xl font-bold mb-2">Debug Information</h3>
          <p className="text-muted-foreground">
            Debug features are only available in the desktop application
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold mb-2">Debug Information</h3>
        <p className="text-muted-foreground">
          View application logs and debug information
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Application Logs
          </CardTitle>
          <CardDescription>
            Access logs for troubleshooting and bug reports
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Logs Location</Label>
              <div className="p-3 bg-muted rounded-lg">
                <code className="text-xs break-all">{logsPath || 'Loading...'}</code>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={handleOpenLogs} variant="outline">
                <FolderOpen className="mr-2 h-4 w-4" />
                View Logs
              </Button>
              <Button onClick={handleReportIssue} variant="outline">
                <Bug className="mr-2 h-4 w-4" />
                Report Issue
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
