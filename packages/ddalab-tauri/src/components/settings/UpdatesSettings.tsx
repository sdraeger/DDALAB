'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Download, RefreshCw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAppVersion } from '@/hooks/useAppInfo'
import { useCheckForUpdates, useDownloadAndInstallUpdate } from '@/hooks/useUpdates'

export function UpdatesSettings() {
  // TanStack Query hooks
  const { data: currentVersion = 'Unknown' } = useAppVersion()
  const checkForUpdatesMutation = useCheckForUpdates()
  const downloadAndInstallMutation = useDownloadAndInstallUpdate()

  // Local UI state
  const [installSuccess, setInstallSuccess] = useState(false)

  const updateStatus = checkForUpdatesMutation.data
  const checking = checkForUpdatesMutation.isPending
  const downloading = downloadAndInstallMutation.isPending
  const error =
    checkForUpdatesMutation.error?.message || downloadAndInstallMutation.error?.message || ''

  const handleCheckForUpdates = async () => {
    setInstallSuccess(false)
    try {
      console.log('[UPDATES] Checking for updates...')
      const status = await checkForUpdatesMutation.mutateAsync()
      console.log('[UPDATES] Update status:', status)

      if (status.available) {
        console.log(`[UPDATES] Update available: ${status.latest_version}`)
      } else {
        console.log('[UPDATES] No updates available')
      }
    } catch (err) {
      console.error('[UPDATES] Error checking for updates:', err)
    }
  }

  const handleDownloadAndInstall = async () => {
    try {
      console.log('[UPDATES] Starting download and installation...')
      await downloadAndInstallMutation.mutateAsync()
      console.log('[UPDATES] Update installed successfully')
      setInstallSuccess(true)
    } catch (err) {
      console.error('[UPDATES] Error installing update:', err)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">App Updates</h2>
        <p className="text-sm text-muted-foreground">
          Keep your application up to date with the latest features and bug fixes
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Version</CardTitle>
          <CardDescription>
            The version of DDALAB currently installed
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-mono font-semibold">v{currentVersion}</p>
              <p className="text-sm text-muted-foreground mt-1">
                Last checked: {updateStatus ? 'Just now' : 'Never'}
              </p>
            </div>
            <Button onClick={handleCheckForUpdates} disabled={checking} variant="outline">
              {checking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Check for Updates
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {installSuccess && (
        <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
          <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
          <AlertDescription className="text-green-800 dark:text-green-200">
            Update installed successfully! Please restart the application to use the new version.
          </AlertDescription>
        </Alert>
      )}

      {updateStatus && !updateStatus.available && (
        <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950">
          <CheckCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <AlertDescription className="text-blue-800 dark:text-blue-200">
            You are running the latest version of DDALAB
          </AlertDescription>
        </Alert>
      )}

      {updateStatus?.available && (
        <Card className="border-amber-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Update Available
            </CardTitle>
            <CardDescription>
              A new version of DDALAB is ready to install
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-sm text-muted-foreground">Current:</span>
                <span className="font-mono font-semibold">v{updateStatus?.current_version}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono font-semibold text-green-600 dark:text-green-400">
                  v{updateStatus?.latest_version}
                </span>
              </div>

              {updateStatus?.release_notes && (
                <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                  <p className="text-sm font-medium mb-2">Release Notes:</p>
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {updateStatus.release_notes}
                  </div>
                </div>
              )}
            </div>

            <Button
              onClick={handleDownloadAndInstall}
              disabled={downloading}
              className="w-full"
              size="lg"
            >
              {downloading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Downloading and Installing...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-5 w-5" />
                  Download and Install v{updateStatus?.latest_version}
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              The application will need to be restarted after installation
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Automatic Updates</CardTitle>
          <CardDescription>
            How updates are handled in DDALAB
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              DDALAB uses semantic versioning (semver) to track releases. Updates are checked manually
              from this page.
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>
                <strong>Major updates</strong> (e.g., 1.0.0 → 2.0.0) may include breaking changes
              </li>
              <li>
                <strong>Minor updates</strong> (e.g., 1.0.0 → 1.1.0) add new features
              </li>
              <li>
                <strong>Patch updates</strong> (e.g., 1.0.0 → 1.0.1) contain bug fixes
              </li>
            </ul>
            <p className="mt-4">
              Updates are downloaded from GitHub Releases and verified before installation.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
