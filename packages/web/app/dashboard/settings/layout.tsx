"use client";

import { UnsavedChangesAlert } from "shared/components/UnsavedChangesAlert";

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
