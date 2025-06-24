"use client";

import { getInitials } from "shared/lib/utils/misc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "shared/components/ui/card";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "shared/components/ui/avatar";
import { Label } from "shared/components/ui/label";
import { Input } from "shared/components/ui/input";
import { useState } from "react";
import { EEGZoomSettings } from "shared/components/settings/EEGZoomSettings";
import { ThemeSettings } from "shared/components/settings/ThemeSettings";
import { SaveSettingsButton } from "shared/components/ui/save-settings-button";
import { CacheStatus } from "shared/components/ui/cache-status";
import { DashboardStateManager } from "shared/components/ui/dashboard-state-manager";
import { useSession } from "next-auth/react";
import SettingsLayout from "./layout";

export default function SettingsPage() {
  const { data: session } = useSession();
  const [displayName, setDisplayName] = useState(session?.user?.name || "User");

  if (!session) {
    return (
      <SettingsLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">
            Please sign in to access settings.
          </p>
        </div>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Settings</h1>
            <p className="text-muted-foreground">
              Manage your account and application preferences
            </p>
          </div>
          <div className="flex gap-2">
            <CacheStatus />
            <SaveSettingsButton floating />
          </div>
        </div>

        {/* Profile Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Update your profile information and preferences
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center space-x-4">
              <Avatar className="h-16 w-16">
                <AvatarImage
                  src={session.user?.image || ""}
                  alt={session.user?.name || "User"}
                />
                <AvatarFallback className="text-lg">
                  {getInitials(session.user?.name || "User")}
                </AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                <h3 className="text-lg font-medium">
                  {session.user?.name || "User"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {session.user?.email}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your display name"
              />
            </div>
          </CardContent>
        </Card>

        {/* Dashboard State Management */}
        <DashboardStateManager />

        {/* EEG Plot Settings */}
        <Card>
          <CardHeader>
            <CardTitle>EEG Plot Settings</CardTitle>
            <CardDescription>
              Configure how EEG plots behave and respond to interactions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EEGZoomSettings />
          </CardContent>
        </Card>

        {/* Theme Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              Customize the look and feel of the application
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ThemeSettings />
          </CardContent>
        </Card>

        {/* Performance Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Performance</CardTitle>
            <CardDescription>
              Monitor and manage application performance settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Plot Data Cache</Label>
              <p className="text-sm text-muted-foreground">
                Plot data is automatically cached to improve performance when
                navigating between plots and settings. Cache entries expire
                automatically to ensure data freshness.
              </p>
              <div className="pt-2">
                <CacheStatus />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </SettingsLayout>
  );
}
