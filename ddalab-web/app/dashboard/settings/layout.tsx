"use client";

import { UnsavedChangesAlert } from "@/components/unsaved-changes-alert";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="container mx-auto">
      {children}
      <UnsavedChangesAlert />
    </div>
  );
}
