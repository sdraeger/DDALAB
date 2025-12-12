"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAppStore } from "@/store/appStore";
import { TauriService, AppPreferences } from "@/services/tauriService";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";

export function CloseWarningHandler() {
  const [showDialog, setShowDialog] = useState(false);
  const [dontAskAgain, setDontAskAgain] = useState(false);

  const isDDARunning = useAppStore((state) => state.dda.isRunning);
  const isDDARunningRef = useRef(isDDARunning);
  isDDARunningRef.current = isDDARunning;

  const forceClose = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("force_close_window");
    } catch {
      window.close();
    }
  }, []);

  const savePreference = useCallback(async (value: boolean) => {
    try {
      const preferences = await TauriService.getAppPreferences();
      preferences.warn_on_close_during_analysis = value;
      await TauriService.saveAppPreferences(preferences);
    } catch {
      // Preference save failed silently
    }
  }, []);

  const handleCloseRequest = useCallback(async () => {
    const currentIsDDARunning = isDDARunningRef.current;

    if (!currentIsDDARunning) {
      await forceClose();
      return;
    }

    try {
      const preferences = await TauriService.getAppPreferences();
      const shouldWarn = preferences.warn_on_close_during_analysis !== false;

      if (!shouldWarn) {
        await forceClose();
        return;
      }

      setShowDialog(true);
    } catch {
      setShowDialog(true);
    }
  }, [forceClose]);

  const handleConfirmClose = useCallback(async () => {
    setShowDialog(false);
    if (dontAskAgain) {
      await savePreference(false);
    }
    await forceClose();
  }, [dontAskAgain, savePreference, forceClose]);

  const handleCancelClose = useCallback(() => {
    setShowDialog(false);
    setDontAskAgain(false);
  }, []);

  const handleCloseRequestRef = useRef(handleCloseRequest);
  handleCloseRequestRef.current = handleCloseRequest;

  useEffect(() => {
    if (!TauriService.isTauri()) return;

    let unlisten: (() => void) | null = null;
    let mounted = true;

    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (!mounted) return;

        unlisten = await listen("close-requested", () => {
          handleCloseRequestRef.current();
        });
      } catch {
        // Listener setup failed
      }
    };

    setupListener();

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  if (!TauriService.isTauri()) {
    return null;
  }

  return (
    <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/30">
              <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />
            </div>
            <AlertDialogTitle>Analysis in Progress</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="pt-2">
            A DDA analysis is currently running. If you close the application
            now, the analysis will be interrupted and any unsaved results will
            be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex items-center space-x-2 py-4">
          <Checkbox
            id="dont-ask-again"
            checked={dontAskAgain}
            onCheckedChange={(checked) => setDontAskAgain(checked === true)}
          />
          <Label
            htmlFor="dont-ask-again"
            className="text-sm text-muted-foreground cursor-pointer"
          >
            Don&apos;t ask again
          </Label>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancelClose}>
            Keep Running
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirmClose} variant="destructive">
            Close Anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
