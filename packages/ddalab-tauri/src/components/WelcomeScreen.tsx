'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Brain, Server, AlertCircle, RefreshCw, Settings, Layers } from 'lucide-react'
import { DockerStackManager } from '@/components/DockerStackManager'
import { EmbeddedApiManager } from '@/components/EmbeddedApiManager'
import { TauriService } from '@/services/tauriService'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface WelcomeScreenProps {
  apiUrl: string
  onApiUrlChange: (url: string) => void
  onRetryConnection: () => void
}

export function WelcomeScreen({ apiUrl, onApiUrlChange, onRetryConnection }: WelcomeScreenProps) {
  const [localApiUrl, setLocalApiUrl] = useState(apiUrl)
  const isTauri = TauriService.isTauri()

  const handleUrlUpdate = () => {
    onApiUrlChange(localApiUrl)
  }

  const handleApiReady = (apiUrl: string) => {
    onApiUrlChange(apiUrl)
    onRetryConnection()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="flex items-center justify-center mb-6">
              <Brain className="h-16 w-16 text-primary mr-4" />
              <div>
                <h1 className="text-4xl font-bold text-gray-900 dark:text-white">DDALAB</h1>
                <p className="text-lg text-gray-600 dark:text-gray-400">Delay Differential Analysis Laboratory</p>
              </div>
            </div>
            <p className="text-xl text-gray-700 dark:text-gray-300 max-w-2xl mx-auto">
              A powerful desktop application for performing scientific analysis on EDF and ASCII files using advanced delay differential algorithms.
            </p>
          </div>

          {/* Connection Status */}
          <div className="space-y-8 mb-12">
            {/* API Options - Only show in Tauri */}
            {isTauri && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Layers className="h-5 w-5" />
                    Choose Your API Backend
                  </CardTitle>
                  <CardDescription>
                    Select how you want to run the DDALAB API server
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="embedded" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="embedded">Embedded (Recommended)</TabsTrigger>
                      <TabsTrigger value="docker">Docker Services</TabsTrigger>
                    </TabsList>
                    <TabsContent value="embedded" className="mt-6">
                      <EmbeddedApiManager onApiReady={handleApiReady} />
                    </TabsContent>
                    <TabsContent value="docker" className="mt-6">
                      <DockerStackManager onApiReady={handleApiReady} />
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            )}

            <div className="grid md:grid-cols-2 gap-8">
              <Card className="border-l-4 border-l-amber-500">
                <CardHeader>
                  <CardTitle className="flex items-center text-amber-700 dark:text-amber-400">
                    <AlertCircle className="h-5 w-5 mr-2" />
                    {isTauri ? 'No API Connected' : 'API Connection Failed'}
                  </CardTitle>
                  <CardDescription>
                    {isTauri
                      ? 'Start the Embedded API or Docker services above, or manually configure a custom API URL below.'
                      : 'Unable to connect to the DDALAB API server. Please ensure the server is running.'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="api-url" className="block text-sm font-medium mb-2">
                        API Server URL
                      </label>
                      <div className="flex space-x-2">
                        <Input
                          id="api-url"
                          value={localApiUrl}
                          onChange={(e) => setLocalApiUrl(e.target.value)}
                          placeholder="http://localhost:8000"
                          className="flex-1"
                        />
                        <Button onClick={handleUrlUpdate} variant="outline" size="icon">
                          <Settings className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <Button onClick={onRetryConnection} className="w-full">
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Retry Connection
                    </Button>
                  </div>
                </CardContent>
              </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Server className="h-5 w-5 mr-2" />
                  Getting Started
                </CardTitle>
                <CardDescription>
                  Follow these steps to start using DDALAB
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2 text-sm">
                  <li className="flex items-start">
                    <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs mr-3 mt-0.5">1</span>
                    {isTauri ? 'Choose Embedded API (recommended) or Docker services above' : 'Start the Python API server'}
                  </li>
                  <li className="flex items-start">
                    <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs mr-3 mt-0.5">2</span>
                    {isTauri ? 'Click "Start" to launch your chosen backend' : 'Ensure the server is running on the correct port'}
                  </li>
                  <li className="flex items-start">
                    <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs mr-3 mt-0.5">3</span>
                    {isTauri ? 'The app will connect automatically once the API is ready' : 'Click "Retry Connection" to connect'}
                  </li>
                </ol>
              </CardContent>
            </Card>
            </div>
          </div>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">File Analysis</CardTitle>
                <CardDescription>
                  Load and analyze EDF and ASCII files with comprehensive metadata extraction
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">DDA Algorithms</CardTitle>
                <CardDescription>
                  Advanced delay differential analysis with multiple algorithm variants
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Visualization</CardTitle>
                <CardDescription>
                  Interactive plots and real-time data visualization capabilities
                </CardDescription>
              </CardHeader>
            </Card>
          </div>

          {/* Footer */}
          <div className="text-center mt-12 text-sm text-gray-600 dark:text-gray-400">
            <p>Built with Next.js, Tauri, and Python • Desktop Application</p>
          </div>
        </div>
      </div>
    </div>
  )
}
