'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Brain, Server } from 'lucide-react'
import { EmbeddedApiManager } from '@/components/EmbeddedApiManager'
import { TauriService } from '@/services/tauriService'

interface WelcomeScreenProps {
  onApiUrlChange: (url: string) => void
  onRetryConnection: () => void
}

export function WelcomeScreen({ onApiUrlChange, onRetryConnection }: WelcomeScreenProps) {
  const isTauri = TauriService.isTauri()

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
            {/* Embedded API - Only show in Tauri */}
            {isTauri && (
              <EmbeddedApiManager onApiReady={handleApiReady} />
            )}

            {!isTauri && (
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
                      Start the API server
                    </li>
                    <li className="flex items-start">
                      <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs mr-3 mt-0.5">2</span>
                      Ensure the server is running on the correct port
                    </li>
                    <li className="flex items-start">
                      <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs mr-3 mt-0.5">3</span>
                      Click "Retry Connection" to connect
                    </li>
                  </ol>
                </CardContent>
              </Card>
            )}
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
