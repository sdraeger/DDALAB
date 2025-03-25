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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { SessionExpirationSettings } from "@/components/session-expiration-settings";
import { EEGZoomSettings } from "@/components/eeg-zoom-settings";
import { ThemeSettings } from "@/components/theme-settings";
import { SaveSettingsButton } from "@/components/save-settings-button";
import { useSettings } from "@/contexts/settings-context";
import { useSession } from "next-auth/react";
import { useToast } from "@/components/ui/use-toast";

export default function SettingsPage() {
  const { data: session, status, update: updateSession } = useSession();
  const { hasUnsavedChanges } = useSettings();
  const { toast } = useToast();
  const user = session?.user;
  const [email, setEmail] = useState("");
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize email from session
  useEffect(() => {
    if (user?.email) {
      setEmail(user.email);
    }
  }, [user]);

  const handleSaveEmail = async () => {
    if (!user) return;

    setIsSaving(true);
    try {
      console.log("session handleSaveEmail", session);
      const response = await fetch(`/api/users/${user.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.accessToken}`,
        },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        throw new Error("Failed to update email");
      }

      // Update session with new email
      if (session) {
        await updateSession({
          ...session,
          user: {
            ...session.user,
            email: email,
          },
        });
      }

      setIsEditingEmail(false);
      toast({
        title: "Email Updated",
        description: "Your email has been updated successfully.",
      });
    } catch (error) {
      console.error("Error updating email:", error);
      toast({
        title: "Update Failed",
        description: "Could not update your email. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="container mx-auto py-6">
        <h1 className="text-3xl font-bold mb-6">User Settings</h1>
        <p>Please log in to view your settings.</p>
      </div>
    );
  }

  // Get display name and initials
  const displayName = user.name || user.id;
  const userInitials = getInitials(user.name || "", user.id);

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
                src={`https://avatar.vercel.sh/${user.id}`}
                alt={displayName}
              />
              <AvatarFallback>{userInitials}</AvatarFallback>
            </Avatar>
            <div>
              <CardTitle>
                {user.firstName} {user.lastName}
              </CardTitle>
              <CardDescription>Profile Information</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label className="text-sm font-medium text-muted-foreground">
                Username
              </Label>
              <div className="text-lg">{user.name}</div>
            </div>
            <div className="grid gap-2">
              <Label className="text-sm font-medium text-muted-foreground">
                User ID
              </Label>
              <div className="text-lg">{user.id}</div>
            </div>
            <div className="grid gap-2">
              <Label className="text-sm font-medium text-muted-foreground">
                Email
              </Label>
              {isEditingEmail ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="text-base"
                  />
                  <Button
                    onClick={handleSaveEmail}
                    disabled={isSaving}
                    size="sm"
                  >
                    {isSaving ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEmail(user.email || "");
                      setIsEditingEmail(false);
                    }}
                    size="sm"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="text-lg">{user.email || "Not provided"}</div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditingEmail(true)}
                  >
                    Edit
                  </Button>
                </div>
              )}
            </div>
            <div className="grid gap-2">
              <Label className="text-sm font-medium text-muted-foreground">
                Role
              </Label>
              <div className="text-lg">User</div>
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
