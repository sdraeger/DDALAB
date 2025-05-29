"use client";

import { ThemeInitializer } from "shared/components/theme/ThemeInitializer";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ThemeInitializer />
      {children}
    </>
  );
}
