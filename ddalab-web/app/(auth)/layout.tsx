"use client";

import { ThemeInitializer } from "@/components/theme-initializer";

export default function AuthLayout({
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
