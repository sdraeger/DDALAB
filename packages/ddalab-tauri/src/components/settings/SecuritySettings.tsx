'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Shield } from 'lucide-react'

export function SecuritySettings() {

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Security Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure security options for the embedded API server
        </p>
      </div>

      {/* Server Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Server Configuration
          </CardTitle>
          <CardDescription>
            Active API server settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Protocol:</span>
            <span className="font-medium">HTTP</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Default Port:</span>
            <span className="font-medium">8765</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Bind Address:</span>
            <span className="font-medium">127.0.0.1 (localhost only)</span>
          </div>
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              The API server uses HTTP for local connections. Since the server only accepts connections from localhost (127.0.0.1), this is secure for local development and analysis.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
