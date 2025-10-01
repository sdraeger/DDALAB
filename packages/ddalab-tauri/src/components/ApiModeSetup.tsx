'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Server, Zap, ExternalLink, Loader2 } from 'lucide-react'

interface ApiModeSetupProps {
  onSelectMode: (mode: 'embedded' | 'external', externalUrl?: string) => Promise<void>
}

export function ApiModeSetup({ onSelectMode }: ApiModeSetupProps) {
  const [selectedMode, setSelectedMode] = useState<'embedded' | 'external' | null>(null)
  const [externalUrl, setExternalUrl] = useState('http://localhost:8000')
  const [isLoading, setIsLoading] = useState(false)

  const handleContinue = async () => {
    if (!selectedMode) return

    setIsLoading(true)
    try {
      if (selectedMode === 'embedded') {
        await onSelectMode('embedded')
      } else if (selectedMode === 'external') {
        await onSelectMode('external', externalUrl)
      }
    } catch (error) {
      console.error('Failed to initialize API mode:', error)
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">Welcome to DDALAB</h1>
          <p className="text-muted-foreground text-lg">
            Choose how you want to run the analysis engine
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* Embedded API Option */}
          <Card
            className={`cursor-pointer transition-all ${
              selectedMode === 'embedded'
                ? 'ring-2 ring-primary border-primary'
                : 'hover:border-primary/50'
            }`}
            onClick={() => setSelectedMode('embedded')}
          >
            <CardHeader>
              <div className="flex items-center justify-between mb-2">
                <Zap className="h-8 w-8 text-primary" />
                <div
                  className={`w-5 h-5 rounded-full border-2 ${
                    selectedMode === 'embedded'
                      ? 'bg-primary border-primary'
                      : 'border-muted-foreground'
                  }`}
                />
              </div>
              <CardTitle>Embedded Engine</CardTitle>
              <CardDescription>Built-in analysis (Recommended)</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start">
                  <span className="text-primary mr-2">✓</span>
                  <span>No setup required - works immediately</span>
                </li>
                <li className="flex items-start">
                  <span className="text-primary mr-2">✓</span>
                  <span>Fast local processing</span>
                </li>
                <li className="flex items-start">
                  <span className="text-primary mr-2">✓</span>
                  <span>Data never leaves your computer</span>
                </li>
                <li className="flex items-start">
                  <span className="text-primary mr-2">✓</span>
                  <span>Persistent analysis history</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* External API Option */}
          <Card
            className={`cursor-pointer transition-all ${
              selectedMode === 'external'
                ? 'ring-2 ring-primary border-primary'
                : 'hover:border-primary/50'
            }`}
            onClick={() => setSelectedMode('external')}
          >
            <CardHeader>
              <div className="flex items-center justify-between mb-2">
                <Server className="h-8 w-8 text-primary" />
                <div
                  className={`w-5 h-5 rounded-full border-2 ${
                    selectedMode === 'external'
                      ? 'bg-primary border-primary'
                      : 'border-muted-foreground'
                  }`}
                />
              </div>
              <CardTitle>External Server</CardTitle>
              <CardDescription>Connect to FastAPI backend</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm mb-4">
                <li className="flex items-start">
                  <span className="text-primary mr-2">✓</span>
                  <span>Advanced customization options</span>
                </li>
                <li className="flex items-start">
                  <span className="text-primary mr-2">✓</span>
                  <span>Shared team analyses</span>
                </li>
                <li className="flex items-start">
                  <span className="text-muted-foreground mr-2">•</span>
                  <span className="text-muted-foreground">
                    Requires separate server setup
                  </span>
                </li>
              </ul>

              {selectedMode === 'external' && (
                <div className="space-y-2">
                  <Label htmlFor="api-url">Server URL</Label>
                  <Input
                    id="api-url"
                    type="text"
                    value={externalUrl}
                    onChange={(e) => setExternalUrl(e.target.value)}
                    placeholder="http://localhost:8000"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-center gap-4">
          <Button
            size="lg"
            onClick={handleContinue}
            disabled={!selectedMode || isLoading}
            className="min-w-[200px]"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {selectedMode === 'embedded' ? 'Starting Engine...' : 'Connecting...'}
              </>
            ) : (
              <>
                Continue
                <ExternalLink className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          You can change this setting later in the Settings tab
        </p>
      </div>
    </div>
  )
}
