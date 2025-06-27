"use client";

import { ThemeInitializer } from "shared/components/theme/ThemeInitializer";
import { SidebarProvider, SidebarInset } from "shared/components/ui/sidebar";
import { DashboardSidebar } from "shared/components/layout/DashboardSidebar";
import { ProtectedRoute } from "shared/components/higher-order/ProtectedRoute";
import { GlobalLoadingOverlay } from "shared/components/ui/global-loading-overlay";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <ThemeInitializer />
      <SidebarProvider>
        <div className="flex h-[calc(100vh-60px)] w-full border border-border/40">
          <DashboardSidebar />
          <SidebarInset className="flex-1 flex flex-col h-full">
            <main className="flex-1 flex flex-col h-full">
              <div className="flex-1 p-1">
                {children}
              </div>
            </main>
          </SidebarInset>
        </div>
        <GlobalLoadingOverlay />
      </SidebarProvider>
    </ProtectedRoute>
  );
}
