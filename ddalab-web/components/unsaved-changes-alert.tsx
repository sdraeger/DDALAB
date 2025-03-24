"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSettings } from "@/contexts/settings-context";
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

export function UnsavedChangesAlert() {
  const { hasUnsavedChanges, unsavedChangesList, saveChanges, resetChanges } =
    useSettings();
  const router = useRouter();
  const pathname = usePathname();
  const [showAlert, setShowAlert] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  // Memoize handlers to prevent unnecessary re-renders
  const handleNavigation = useCallback(
    (e: MouseEvent) => {
      // Only process if we have unsaved changes
      if (!hasUnsavedChanges) return;

      // Check if the click was on an anchor tag
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");

      if (!anchor) return;

      // Get the href attribute
      const href = anchor.getAttribute("href");

      // If there's no href or it's an external link or hash link, don't do anything
      if (!href || href.startsWith("http") || href.startsWith("#")) return;

      // Check if it's not the same page
      if (!pathname?.includes(href)) {
        e.preventDefault();
        setPendingUrl(href);
        setShowAlert(true);
      }
    },
    [hasUnsavedChanges, pathname]
  );

  // Set up a navigation interceptor
  useEffect(() => {
    // Only add listener if we're on the settings page
    if (!pathname?.includes("/dashboard/settings")) return;

    document.addEventListener("click", handleNavigation);

    return () => {
      document.removeEventListener("click", handleNavigation);
    };
  }, [pathname, handleNavigation]);

  const handleContinue = useCallback(() => {
    setShowAlert(false);
    resetChanges();

    if (pendingUrl) {
      router.push(pendingUrl);
      setPendingUrl(null);
    }
  }, [pendingUrl, resetChanges, router]);

  const handleSaveAndContinue = useCallback(async () => {
    const success = await saveChanges();

    if (success && pendingUrl) {
      router.push(pendingUrl);
      setPendingUrl(null);
    }

    setShowAlert(false);
  }, [pendingUrl, saveChanges, router]);

  const handleCancel = useCallback(() => {
    setShowAlert(false);
    setPendingUrl(null);
  }, []);

  // Don't render anything if there are no unsaved changes
  if (!hasUnsavedChanges) return null;

  return (
    <AlertDialog open={showAlert}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved changes. If you leave, these changes will be lost.
            <ul className="mt-2 list-disc pl-5">
              {unsavedChangesList.map((change, index) => (
                <li key={index} className="text-sm">
                  {change}
                </li>
              ))}
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleContinue}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Discard Changes
          </AlertDialogAction>
          <AlertDialogAction onClick={handleSaveAndContinue}>
            Save & Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
