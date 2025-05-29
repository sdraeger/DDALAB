"use client";

import { ThemeInitializer } from "shared/components/theme/ThemeInitializer";

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
