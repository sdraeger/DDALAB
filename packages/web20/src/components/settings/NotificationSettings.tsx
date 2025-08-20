'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAppDispatch } from '@/store/hooks';
import { startMonitoring, fetchNotifications } from '@/store/slices/notificationsSlice';
import apiService from '@/lib/api';

export function NotificationSettings() {
  const dispatch = useAppDispatch();
  const [isMonitoring, setIsMonitoring] = useState(true);
  const [lastCheck, setLastCheck] = useState<string | null>(null);

  const handleToggleMonitoring = async () => {
    try {
      if (isMonitoring) {
        await apiService.stopNotificationMonitoring();
        setIsMonitoring(false);
      } else {
        await apiService.startNotificationMonitoring();
        dispatch(startMonitoring());
        setIsMonitoring(true);
      }
    } catch (error) {
      console.error('Failed to toggle monitoring:', error);
    }
  };

  const handleManualCheck = async () => {
    try {
      dispatch(fetchNotifications());
      setLastCheck(new Date().toLocaleTimeString());
    } catch (error) {
      console.error('Failed to check notifications:', error);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Notification Monitoring</CardTitle>
          <CardDescription>
            Control automated system monitoring and notifications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="monitoring-toggle">Background Monitoring</Label>
              <p className="text-sm text-muted-foreground">
                Monitor system health, memory usage, and Docker updates
              </p>
            </div>
            <Switch
              id="monitoring-toggle"
              checked={isMonitoring}
              onCheckedChange={handleToggleMonitoring}
            />
          </div>

          <div className="space-y-2">
            <Label>Monitoring Status</Label>
            <div className="flex items-center gap-2">
              <Badge variant={isMonitoring ? "default" : "secondary"}>
                {isMonitoring ? "Active" : "Inactive"}
              </Badge>
              {lastCheck && (
                <span className="text-sm text-muted-foreground">
                  Last manual check: {lastCheck}
                </span>
              )}
            </div>
          </div>

          <div className="pt-4">
            <Button onClick={handleManualCheck} variant="outline">
              Check for Updates Now
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monitored Systems</CardTitle>
          <CardDescription>
            Systems and services being monitored for notifications
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>Memory Usage</Label>
                <p className="text-sm text-muted-foreground">
                  Alerts when memory usage exceeds 85%
                </p>
              </div>
              <Badge variant="outline">System</Badge>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>CPU Usage</Label>
                <p className="text-sm text-muted-foreground">
                  Alerts when CPU usage exceeds 90%
                </p>
              </div>
              <Badge variant="outline">System</Badge>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Disk Space</Label>
                <p className="text-sm text-muted-foreground">
                  Alerts when disk usage exceeds 85%
                </p>
              </div>
              <Badge variant="outline">System</Badge>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Docker Updates</Label>
                <p className="text-sm text-muted-foreground">
                  Checks Docker Hub for ddalab updates
                </p>
              </div>
              <Badge variant="outline">External</Badge>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>System Uptime</Label>
                <p className="text-sm text-muted-foreground">
                  Recommendations based on system uptime
                </p>
              </div>
              <Badge variant="outline">Insights</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}