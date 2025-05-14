"use client";

import { useState, useEffect, useCallback } from "react";
import { useSettings } from "../../contexts/settings-context";
import { Button } from "./button";
import { Save, Loader2, CheckCircle, Info } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

interface SaveSettingsButtonProps {
  floating?: boolean;
}

export function SaveSettingsButton({
  floating = false,
}: SaveSettingsButtonProps) {
  const {
    hasUnsavedChanges,
    unsavedChangesList,
    saveChanges,
    pendingChanges,
    userPreferences,
  } = useSettings();
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  // Direct check for changes
  const hasDirectChanges = Object.keys(pendingChanges).length > 0;

  // Determine if the button should be enabled
  // Use both the context's hasUnsavedChanges and our direct check
  const shouldEnableButton = hasUnsavedChanges || hasDirectChanges;

  // Debug info for the developer (only in development)
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.log("SaveSettingsButton state:", {
        hasUnsavedChanges,
        hasDirectChanges,
        shouldEnableButton,
        pendingChanges,
        pendingChangesKeys: Object.keys(pendingChanges),
        userPreferences,
        unsavedChangesList,
      });
    }
  }, [
    hasUnsavedChanges,
    hasDirectChanges,
    shouldEnableButton,
    pendingChanges,
    userPreferences,
    unsavedChangesList,
  ]);

  // Memoize the save handler to prevent unnecessary re-renders
  const handleSave = useCallback(async () => {
    if (!shouldEnableButton || isSaving) return;

    setIsSaving(true);
    try {
      const success = await saveChanges();

      if (success) {
        setSaveSuccess(true);
        // Reset success state after 2 seconds
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } finally {
      setIsSaving(false);
    }
  }, [shouldEnableButton, isSaving, saveChanges]);

  // Toggle debug info
  const toggleDebug = useCallback(() => {
    setShowDebug((prev) => !prev);
  }, []);

  // Button appearance based on state
  const getButtonClasses = () => {
    const baseClasses = "flex items-center justify-center";

    if (floating) {
      return cn(
        baseClasses,
        "shadow-lg",
        saveSuccess
          ? "bg-green-600 hover:bg-green-700 text-white"
          : shouldEnableButton
          ? "bg-primary hover:bg-primary/90 text-primary-foreground"
          : "bg-muted hover:bg-muted/80 text-muted-foreground",
        !shouldEnableButton && "opacity-70",
        "min-w-[120px] h-12 rounded-full"
      );
    }

    return cn(
      baseClasses,
      "min-w-[110px]",
      saveSuccess && "bg-green-600 hover:bg-green-700 text-white"
    );
  };

  return (
    <div className="flex items-center gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={handleSave}
              disabled={!shouldEnableButton || isSaving}
              className={getButtonClasses()}
              size={floating ? "lg" : "default"}
            >
              {isSaving ? (
                <>
                  <Loader2
                    className={cn(
                      "animate-spin",
                      floating ? "h-5 w-5 mr-2" : "h-4 w-4 mr-2"
                    )}
                  />
                  Saving...
                </>
              ) : saveSuccess ? (
                <>
                  <CheckCircle
                    className={floating ? "h-5 w-5 mr-2" : "h-4 w-4 mr-2"}
                  />
                  Saved!
                </>
              ) : (
                <>
                  <Save
                    className={floating ? "h-5 w-5 mr-2" : "h-4 w-4 mr-2"}
                  />
                  Save Changes
                </>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side={floating ? "top" : "bottom"}>
            {shouldEnableButton ? (
              <div>
                <p>
                  You have{" "}
                  {unsavedChangesList.length > 0 ? "the following" : ""} unsaved
                  changes{unsavedChangesList.length === 0 && ":"}
                </p>
                {unsavedChangesList.length > 0 ? (
                  <ul className="list-disc pl-4 mt-1">
                    {unsavedChangesList.map((change, index) => (
                      <li key={index} className="text-xs">
                        {change}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs mt-1">
                    Changes detected in {Object.keys(pendingChanges).join(", ")}
                  </p>
                )}
              </div>
            ) : (
              <p>No unsaved changes</p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Only show debug button in non-floating mode and in development */}
      {!floating && process.env.NODE_ENV === "development" && (
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleDebug}
          className="h-8 w-8 rounded-full"
          title="Debug Info"
        >
          <Info className="h-4 w-4" />
        </Button>
      )}

      {showDebug && (
        <div className="fixed bottom-4 right-4 p-4 bg-black/90 text-white rounded-lg shadow-lg max-w-md z-50 text-xs">
          <h3 className="font-bold mb-2">Debug Info</h3>
          <div>
            <div>
              <strong>hasUnsavedChanges (context):</strong>{" "}
              {hasUnsavedChanges ? "true" : "false"}
            </div>
            <div>
              <strong>hasDirectChanges:</strong>{" "}
              {hasDirectChanges ? "true" : "false"}
            </div>
            <div>
              <strong>shouldEnableButton:</strong>{" "}
              {shouldEnableButton ? "true" : "false"}
            </div>
            <div>
              <strong>pendingChanges keys:</strong>{" "}
              {Object.keys(pendingChanges).join(", ") || "none"}
            </div>
            <div>
              <strong>Unsaved changes list:</strong>{" "}
              {unsavedChangesList.length
                ? unsavedChangesList.join(", ")
                : "none"}
            </div>
            <div className="mt-2">
              <strong>Pending Changes:</strong>
            </div>
            <pre>{JSON.stringify(pendingChanges, null, 2)}</pre>
            <div className="mt-2">
              <strong>User Preferences:</strong>
            </div>
            <pre>{JSON.stringify(userPreferences, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
