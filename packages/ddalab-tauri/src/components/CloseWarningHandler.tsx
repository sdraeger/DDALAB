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

/**
 * CloseWarningHandler - Handles window close requests and shows a warning
 * dialog if a DDA analysis is running. Similar to VS Code's "close window?" dialog.
 *
 * This component:
 * 1. Listens for the 'close-requested' event from Tauri
 * 2. Checks if DDA is running and if the warning preference is enabled
 * 3. Shows a confirmation dialog if needed
 * 4. Handles the "don't ask again" checkbox
 * 5. Calls force_close_window to actually close the app
 */
export function CloseWarningHandler() {
  const [showDialog, setShowDialog] = useState(false);
  const [dontAskAgain, setDontAskAgain] = useState(false);

  // Get DDA running state from store
  const isDDARunning = useAppStore((state) => state.dda.isRunning);

  // Use a ref to always have the current value in the callback
  // This avoids recreating the listener every time isDDARunning changes
  const isDDARunningRef = useRef(isDDARunning);
  isDDARunningRef.current = isDDARunning;

  // Log state changes for debugging
  useEffect(() => {
    console.log(
      "[CloseWarningHandler] DDA running state changed:",
      isDDARunning,
    );
  }, [isDDARunning]);

  // Force close the window via Tauri command
  const forceClose = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("force_close_window");
    } catch (error) {
      console.error("[CloseWarningHandler] Failed to force close:", error);
      // Fallback: try to close via window API
      window.close();
    }
  }, []);

  // Save the preference if "don't ask again" is checked
  const savePreference = useCallback(async (value: boolean) => {
    try {
      const preferences = await TauriService.getAppPreferences();
      preferences.warn_on_close_during_analysis = value;
      await TauriService.saveAppPreferences(preferences);
      console.log(
        "[CloseWarningHandler] Saved preference warn_on_close_during_analysis:",
        value,
      );
    } catch (error) {
      console.error("[CloseWarningHandler] Failed to save preference:", error);
    }
  }, []);

  // Handle the close request - use ref to get current value
  const handleCloseRequest = useCallback(async () => {
    // Use ref to get current value (avoids stale closures)
    const currentIsDDARunning = isDDARunningRef.current;
    console.log(
      "[CloseWarningHandler] Close requested, DDA running:",
      currentIsDDARunning,
      "(from ref)",
    );

    // If DDA is not running, just close immediately
    if (!currentIsDDARunning) {
      console.log("[CloseWarningHandler] DDA not running, closing immediately");
      await forceClose();
      return;
    }

    // Check if warning is enabled in preferences
    try {
      const preferences = await TauriService.getAppPreferences();
      const shouldWarn = preferences.warn_on_close_during_analysis !== false; // Default true
      console.log("[CloseWarningHandler] Should warn:", shouldWarn);

      if (!shouldWarn) {
        // User has disabled warnings, close immediately
        console.log(
          "[CloseWarningHandler] Warnings disabled, closing immediately",
        );
        await forceClose();
        return;
      }

      // Show the warning dialog
      console.log("[CloseWarningHandler] Showing warning dialog");
      setShowDialog(true);
    } catch (error) {
      console.error(
        "[CloseWarningHandler] Failed to check preferences:",
        error,
      );
      // On error, show the dialog to be safe
      setShowDialog(true);
    }
  }, [forceClose]); // Only depend on forceClose, use ref for isDDARunning

  // Handle user confirming close
  const handleConfirmClose = useCallback(async () => {
    setShowDialog(false);

    // Save preference if "don't ask again" was checked
    if (dontAskAgain) {
      await savePreference(false);
    }

    // Close the window
    await forceClose();
  }, [dontAskAgain, savePreference, forceClose]);

  // Handle user canceling close
  const handleCancelClose = useCallback(() => {
    setShowDialog(false);
    setDontAskAgain(false);
  }, []);

  // Store handleCloseRequest in a ref so the listener always uses the latest version
  const handleCloseRequestRef = useRef(handleCloseRequest);
  handleCloseRequestRef.current = handleCloseRequest;

  // Listen for close-requested event from Tauri
  // Setup only once on mount, use ref for the callback to avoid recreating listener
  useEffect(() => {
    if (!TauriService.isTauri()) {
      console.log(
        "[CloseWarningHandler] Not in Tauri environment, skipping listener setup",
      );
      return;
    }

    let unlisten: (() => void) | null = null;
    let mounted = true;

    const setupListener = async () => {
      try {
        console.log(
          "[CloseWarningHandler] Setting up close-requested listener...",
        );
        const { listen } = await import("@tauri-apps/api/event");

        if (!mounted) {
          console.log(
            "[CloseWarningHandler] Component unmounted before listener setup completed",
          );
          return;
        }

        unlisten = await listen("close-requested", () => {
          console.log(
            "[CloseWarningHandler] ✅ Received close-requested event!",
          );
          // Use ref to always call the latest handler
          handleCloseRequestRef.current();
        });

        console.log(
          "[CloseWarningHandler] ✅ Listener successfully registered",
        );
      } catch (error) {
        console.error(
          "[CloseWarningHandler] ❌ Failed to set up listener:",
          error,
        );
      }
    };

    setupListener();

    return () => {
      mounted = false;
      if (unlisten) {
        console.log("[CloseWarningHandler] Cleaning up listener on unmount");
        unlisten();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array - setup only once, use refs for current values

  // Don't render anything if not in Tauri
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
          <AlertDialogAction
            onClick={handleConfirmClose}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Close Anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
