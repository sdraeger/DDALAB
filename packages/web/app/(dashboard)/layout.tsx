"use client";

import { ThemeInitializer } from "shared/components/theme/ThemeInitializer";
import { SidebarProvider, SidebarInset } from "shared/components/ui/sidebar";
import { DashboardSidebar } from "shared/components/layout/DashboardSidebar";
import { ProtectedRoute } from "shared/components/higher-order/ProtectedRoute";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <ThemeInitializer />
      <SidebarProvider>
        <div className="flex min-h-[calc(100vh-2rem)] sm:min-h-[calc(100vh-3rem)] lg:min-h-[calc(100vh-4rem)] xl:min-h-[calc(100vh-5rem)] w-full rounded-xl border shadow-lg overflow-hidden">
          <DashboardSidebar />
          <SidebarInset className="flex-1">
            <main className="flex-1 overflow-auto">
              <div className="p-6 sm:p-8 lg:p-10 xl:p-12 2xl:p-16 space-y-6">
                {children}
              </div>
            </main>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </ProtectedRoute>
  );
}
