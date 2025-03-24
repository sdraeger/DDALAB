"use client";

import { getInitials } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { SessionExpirationSettings } from "@/components/session-expiration-settings";
import { EEGZoomSettings } from "@/components/eeg-zoom-settings";
import { ThemeSettings } from "@/components/theme-settings";
import { SaveSettingsButton } from "@/components/save-settings-button";
import { useSettings } from "@/contexts/settings-context";
import { useSession } from "next-auth/react";
export default function SettingsPage() {
  const { data: session, status } = useSession();
  const { hasUnsavedChanges } = useSettings();
  const user = session?.user;

  if (!user) {
    return (
      <div className="container mx-auto py-6">
        <h1 className="text-3xl font-bold mb-6">User Settings</h1>
        <p>Please log in to view your settings.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">User Settings</h1>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center gap-4 pb-2">
            <Avatar className="h-16 w-16">
              <AvatarImage
                src={`https://avatar.vercel.sh/${user.username}`}
                alt={user.name || user.username}
              />
              <AvatarFallback>
                {getInitials(user.name, user.username)}
              </AvatarFallback>
            </Avatar>
            <div>
              <CardTitle>{user.name || user.username}</CardTitle>
              <CardDescription>Profile Information</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label className="text-sm font-medium text-muted-foreground">
                Username
              </Label>
              <div className="text-lg">{user.username}</div>
            </div>
            <div className="grid gap-2">
              <Label className="text-sm font-medium text-muted-foreground">
                Email
              </Label>
              <div className="text-lg">{user.email || "Not provided"}</div>
            </div>
            <div className="grid gap-2">
              <Label className="text-sm font-medium text-muted-foreground">
                Role
              </Label>
              <div className="text-lg">{user.role || "User"}</div>
            </div>
          </CardContent>
        </Card>

        <ThemeSettings />

        <SessionExpirationSettings />

        <EEGZoomSettings />
      </div>

      {/* Always show floating button at the bottom */}
      <div className="fixed bottom-6 right-6 z-50">
        <SaveSettingsButton floating />
      </div>
    </div>
  );
}
