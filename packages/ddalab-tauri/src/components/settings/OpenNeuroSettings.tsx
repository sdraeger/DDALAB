'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Key, Eye, EyeOff, ExternalLink, Check, X, Database } from 'lucide-react'
import { openNeuroService } from '@/services/openNeuroService'
import { TauriService } from '@/services/tauriService'

export function OpenNeuroSettings() {
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [hasExistingKey, setHasExistingKey] = useState(false)
  const [keyPreview, setKeyPreview] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    checkExistingKey()
    // Refresh status every 10 seconds
    const interval = setInterval(checkExistingKey, 10000)
    return () => clearInterval(interval)
  }, [])

  const checkExistingKey = async () => {
    try {
      const status = await openNeuroService.checkApiKey()
      setHasExistingKey(status.has_key)
      setKeyPreview(status.key_preview)
    } catch (err) {
      console.error('Failed to check API key:', err)
    }
  }

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      await openNeuroService.saveApiKey(apiKey.trim())
      setSuccess(true)
      setHasExistingKey(true)
      setApiKey('')

      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccess(false)
      }, 3000)

      // Refresh key status
      await checkExistingKey()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API key')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete your OpenNeuro API key?')) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      await openNeuroService.deleteApiKey()
      setHasExistingKey(false)
      setKeyPreview(undefined)
      setApiKey('')
      setSuccess(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete API key')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenKeyGen = async () => {
    if (TauriService.isTauri()) {
      try {
        await TauriService.openUrl('https://openneuro.org/keygen')
      } catch (error) {
        console.error('Failed to open URL:', error)
        window.open('https://openneuro.org/keygen', '_blank')
      }
    } else {
      window.open('https://openneuro.org/keygen', '_blank')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold mb-2">OpenNeuro Integration</h3>
        <p className="text-muted-foreground">
          Configure your OpenNeuro API key for dataset uploads
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            API Key Configuration
          </CardTitle>
          <CardDescription>
            Manage your OpenNeuro API credentials for uploading datasets
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Existing key status */}
          {hasExistingKey && (
            <Alert>
              <Check className="h-4 w-4" />
              <AlertDescription>
                <div className="font-medium">API Key Configured</div>
                {keyPreview && (
                  <div className="mt-1 text-xs font-mono text-muted-foreground">
                    {keyPreview}
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Instructions */}
          <div className="p-4 bg-muted rounded-lg space-y-3">
            <div className="font-medium flex items-center gap-2">
              <Key className="h-4 w-4" />
              How to get an API key
            </div>
            <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground ml-2">
              <li>Log into OpenNeuro with ORCID or GitHub</li>
              <li>Visit the API key generation page</li>
              <li>Copy the generated key and paste it below</li>
            </ol>
            <Button
              onClick={handleOpenKeyGen}
              variant="outline"
              className="w-full"
              size="sm"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Open OpenNeuro Key Generator
            </Button>
          </div>

          {/* API key input */}
          <div className="space-y-2">
            <Label htmlFor="openneuro-api-key">API Key</Label>
            <div className="relative">
              <Input
                id="openneuro-api-key"
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your OpenNeuro API key..."
                className="font-mono pr-10"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-accent rounded transition-colors"
                tabIndex={-1}
              >
                {showApiKey ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <Alert variant="destructive">
              <X className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Success message */}
          {success && (
            <Alert>
              <Check className="h-4 w-4" />
              <AlertDescription>API key saved successfully!</AlertDescription>
            </Alert>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={loading || !apiKey.trim()}
              className="flex-1"
            >
              {loading ? 'Saving...' : hasExistingKey ? 'Update Key' : 'Save Key'}
            </Button>
            {hasExistingKey && (
              <Button
                onClick={handleDelete}
                disabled={loading}
                variant="destructive"
              >
                Delete Key
              </Button>
            )}
          </div>

          {/* Security note */}
          <div className="text-xs text-muted-foreground text-center pt-2 border-t">
            Your API key is stored securely in your system keychain
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
