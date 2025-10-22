'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { TauriService } from '@/services/tauriService'
import { AlertTriangle, Shield, RefreshCw, ExternalLink } from 'lucide-react'

interface AppPreferences {
  api_config: {
    url: string
    timeout: number
  }
  window_state: Record<string, any>
  theme: string
  use_https: boolean
}

export function SecuritySettings() {
  const [useHttps, setUseHttps] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [needsRestart, setNeedsRestart] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    loadPreferences()
  }, [])

  const loadPreferences = async () => {
    if (!TauriService.isTauri()) return

    try {
      const prefs = await TauriService.getAppPreferences()
      setUseHttps(prefs.use_https ?? true)
    } catch (error) {
      console.error('Failed to load preferences:', error)
    }
  }

  const handleHttpsToggle = async (enabled: boolean) => {
    setUseHttps(enabled)
    setNeedsRestart(true)
  }

  const saveAndRestartServer = async () => {
    if (!TauriService.isTauri()) return

    setIsSaving(true)
    try {
      // Get current preferences
      const prefs = await TauriService.getAppPreferences()

      // Update use_https
      prefs.use_https = useHttps

      // IMPORTANT: Also update the URL in api_config to match
      const protocol = useHttps ? 'https' : 'http'
      prefs.api_config = {
        url: `${protocol}://localhost:8765`,
        timeout: prefs.api_config?.timeout || 30
      }

      console.log('[SECURITY] Saving preferences with use_https:', useHttps, 'and URL:', prefs.api_config.url)

      // Save preferences
      await TauriService.saveAppPreferences(prefs)

      // Stop the current server
      try {
        await TauriService.stopLocalApiServer()
        await new Promise(resolve => setTimeout(resolve, 1000))
      } catch (error) {
        console.log('Server stop returned error (may not be running):', error)
      }

      // Start server with new settings
      console.log('[SECURITY] Starting API server with new HTTPS setting:', useHttps)
      await TauriService.startLocalApiServer()

      // Wait a bit for server to fully start
      await new Promise(resolve => setTimeout(resolve, 500))

      // Verify server is using correct protocol
      const apiConfig = await TauriService.getApiConfig()
      console.log('[SECURITY] Server started with config:', apiConfig)

      if (apiConfig.use_https !== useHttps) {
        console.error('[SECURITY] WARNING: Server use_https mismatch! Expected:', useHttps, 'Got:', apiConfig.use_https)
        throw new Error(`Server started with wrong protocol. Expected ${useHttps ? 'HTTPS' : 'HTTP'} but got ${apiConfig.use_https ? 'HTTPS' : 'HTTP'}`)
      }

      setNeedsRestart(false)

      // Reload the page to use new URL
      console.log('[SECURITY] Reloading page to use new API URL:', apiConfig.url)
      window.location.reload()
    } catch (error) {
      console.error('Failed to save preferences and restart server:', error)
      alert(`Failed to apply changes: ${error}`)
    } finally {
      setIsSaving(false)
    }
  }

  const openMkcertInstructions = async () => {
    if (TauriService.isTauri()) {
      await TauriService.openUrl('https://github.com/FiloSottile/mkcert#installation')
    } else {
      window.open('https://github.com/FiloSottile/mkcert#installation', '_blank')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Security Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure security options for the embedded API server
        </p>
      </div>

      {/* HTTPS Toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            HTTPS Encryption
          </CardTitle>
          <CardDescription>
            Enable or disable HTTPS for the local API server
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="use-https">Use HTTPS</Label>
              <p className="text-sm text-muted-foreground">
                Encrypts communication between the UI and API server
              </p>
            </div>
            <Checkbox
              id="use-https"
              checked={useHttps}
              onCheckedChange={handleHttpsToggle}
            />
          </div>

          {useHttps && (
            <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="space-y-2 flex-1">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Known Issue: HTTPS May Not Work</p>
                <p className="text-sm text-muted-foreground">
                  The desktop app's WebView has strict security policies that may block HTTPS connections even with trusted certificates. If you experience connection errors, switch to HTTP mode.
                </p>
                <p className="text-sm text-muted-foreground">
                  Since the API server only accepts connections from localhost, HTTP is reasonably secure for local development.
                </p>
                <details className="text-sm text-muted-foreground">
                  <summary className="cursor-pointer font-medium">Advanced: Try mkcert (may not work)</summary>
                  <div className="mt-2 space-y-2">
                    <p>You can try installing mkcert to generate trusted certificates:</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openMkcertInstructions}
                      className="gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Install mkcert Instructions
                    </Button>
                    <p className="text-xs">However, this may still not work due to WebView restrictions.</p>
                  </div>
                </details>
              </div>
            </div>
          )}

          {needsRestart && (
            <div className="flex items-center justify-between p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-medium">Restart required</span>
              </div>
              <Button
                onClick={saveAndRestartServer}
                disabled={isSaving}
                size="sm"
              >
                {isSaving ? 'Restarting...' : 'Save & Restart Server'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Server Status */}
      <Card>
        <CardHeader>
          <CardTitle>Current Configuration</CardTitle>
          <CardDescription>
            Active API server settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Protocol:</span>
            <span className="font-medium">{useHttps ? 'HTTPS (Secure)' : 'HTTP (Insecure)'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Default Port:</span>
            <span className="font-medium">8765</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Bind Address:</span>
            <span className="font-medium">127.0.0.1 (localhost only)</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
