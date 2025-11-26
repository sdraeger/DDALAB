"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Settings2, AlertTriangle } from "lucide-react";
import { TauriService, AppPreferences } from "@/services/tauriService";
import { toast } from "@/components/ui/toaster";

export function BehaviorSettings() {
  const [preferences, setPreferences] = useState<AppPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load preferences on mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await TauriService.getAppPreferences();
        setPreferences(prefs);
      } catch (error) {
        console.error("Failed to load preferences:", error);
        toast.error("Failed to load preferences");
      } finally {
        setIsLoading(false);
      }
    };

    loadPreferences();
  }, []);

  // Update a preference value
  const updatePreference = async <K extends keyof AppPreferences>(
    key: K,
    value: AppPreferences[K],
  ) => {
    if (!preferences) return;

    const updatedPreferences = { ...preferences, [key]: value };
    setPreferences(updatedPreferences);

    try {
      await TauriService.saveAppPreferences(updatedPreferences);
      console.log(`[BehaviorSettings] Saved ${key}:`, value);
    } catch (error) {
      console.error(`Failed to save preference ${key}:`, error);
      toast.error("Failed to save preference");
      // Revert on error
      setPreferences(preferences);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium">Behavior Settings</h3>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Behavior Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure application behavior and confirmations
        </p>
      </div>

      {/* Close Confirmation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Close Confirmation
          </CardTitle>
          <CardDescription>
            Control when the application asks for confirmation before closing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="warn-on-close" className="text-base">
                Warn when closing during analysis
              </Label>
              <p className="text-sm text-muted-foreground">
                Show a confirmation dialog when attempting to close the app
                while a DDA analysis is running
              </p>
            </div>
            <Switch
              id="warn-on-close"
              checked={preferences?.warn_on_close_during_analysis ?? true}
              onCheckedChange={(checked) =>
                updatePreference("warn_on_close_during_analysis", checked)
              }
            />
          </div>

          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              When enabled, you&apos;ll see a warning dialog similar to VS
              Code&apos;s &quot;close window?&quot; prompt if you try to close
              the app during an active analysis. You can also disable this
              warning from the dialog itself by checking &quot;Don&apos;t ask
              again&quot;.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
