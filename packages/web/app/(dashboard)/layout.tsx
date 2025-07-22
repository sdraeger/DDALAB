"use client";

import { ProtectedRoute } from "shared/components/higher-order/ProtectedRoute";
import { GlobalLoadingOverlay } from "shared/components/ui/global-loading-overlay";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "shared/components/ui/sidebar";
import { AppSidebar } from "shared/components/layout/AppSidebar";
import { Footer } from "shared/components/layout/Footer";
import { Separator } from "shared/components/ui/separator";
import { EDFPlotProvider } from "shared/contexts/EDFPlotContext";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <EDFPlotProvider>
        <SidebarProvider defaultOpen={true}>
          <div className="flex min-h-screen w-full">
            <AppSidebar />
            <div className="flex flex-1 flex-col min-w-0">
              <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4 sm:px-6">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="mx-2 h-4" />
                <h1 className="text-lg font-semibold">Dashboard</h1>
              </header>
              <main className="flex-1 min-w-0 w-full">{children}</main>
              <Footer />
            </div>
          </div>
        </SidebarProvider>
        <GlobalLoadingOverlay />
      </EDFPlotProvider>
    </ProtectedRoute>
  );
}
