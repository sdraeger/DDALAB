"use client";

import { ThemeInitializer } from "@/components/theme-initializer";

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
