"use client";

import { Button } from "./button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card";
import { Badge } from "./badge";
import { RefreshCw, FileText, Eye, EyeOff } from "lucide-react";
import { useDashboardState } from "../../contexts/DashboardStateContext";
import { useToast } from "./use-toast";

export function DashboardStateManager() {
  const {
    selectedFilePath,
    fileBrowserCollapsed,
    selectedChannels,
    clearDashboardState,
  } = useDashboardState();
  const { toast } = useToast();

  const handleClearState = () => {
    clearDashboardState();
    toast({
      title: "Dashboard State Cleared",
      description: "Dashboard has been reset to initial state.",
    });
  };

  const hasState = selectedFilePath || selectedChannels.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Dashboard State</CardTitle>
        <CardDescription>
          Current dashboard state and preferences
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm">Selected File:</span>
            <Badge variant={selectedFilePath ? "default" : "secondary"}>
              {selectedFilePath ? "Set" : "None"}
            </Badge>
          </div>

          {selectedFilePath && (
            <div className="text-xs text-muted-foreground truncate">
              {selectedFilePath}
            </div>
          )}

          <div className="flex justify-between items-center">
            <span className="text-sm">File Browser:</span>
            <Badge variant="outline" className="gap-1">
              {fileBrowserCollapsed ? (
                <>
                  <EyeOff className="h-3 w-3" />
                  Hidden
                </>
              ) : (
                <>
                  <Eye className="h-3 w-3" />
                  Visible
                </>
              )}
            </Badge>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm">Selected Channels:</span>
            <Badge variant="secondary">{selectedChannels.length}</Badge>
          </div>
        </div>

        <div className="pt-2 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearState}
            disabled={!hasState}
            className="gap-2 w-full"
          >
            <RefreshCw className="h-4 w-4" />
            Reset Dashboard State
          </Button>
          {!hasState && (
            <p className="text-xs text-muted-foreground mt-2 text-center">
              No dashboard state to clear
            </p>
          )}
        </div>

        <div className="text-xs text-muted-foreground">
          <p>• Dashboard state persists for 2 hours</p>
          <p>• Includes selected file and sidebar preferences</p>
          <p>• Automatically cleared when expired</p>
        </div>
      </CardContent>
    </Card>
  );
}
