"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FlaskConical } from "lucide-react";
import { useAppStore } from "@/store/appStore";

export function GeneralSettings() {
  const expertMode = useAppStore((state) => state.ui.expertMode);
  const setExpertMode = useAppStore((state) => state.setExpertMode);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">General Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure general application preferences
        </p>
      </div>

      {/* Expert Mode */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Expert Mode
          </CardTitle>
          <CardDescription>
            Control visibility of advanced configuration options
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="expert-mode" className="text-base">
                Enable Expert Mode
              </Label>
              <p className="text-sm text-muted-foreground">
                Show advanced DDA configuration options like custom delay
                parameters and model encoding selection
              </p>
            </div>
            <Switch
              id="expert-mode"
              checked={expertMode}
              onCheckedChange={(checked) => setExpertMode(checked)}
            />
          </div>

          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              When disabled, DDALAB uses sensible defaults optimized for EEG
              analysis (delays: [7, 10], MODEL encoding: 1 2 10). Expert mode
              allows you to customize delays, polynomial terms, and other
              advanced parameters in the DDA analysis panel.
            </p>
          </div>

          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              <strong>Tip:</strong> You can also toggle Expert Mode from the
              status bar at the bottom of the application.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
