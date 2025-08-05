"use client";

import { useEffect } from "react";
import { Header } from "shared/components/layout/Header";
import { Footer } from "shared/components/layout/Footer";
import { AppSidebar } from "shared/components/layout/AppSidebar";
import { SidebarProvider } from "shared/components/ui/sidebar";
import { EDFPlotProvider } from "shared/contexts/EDFPlotContext";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Remove debugging logs for production

  return (
    <SidebarProvider>
      <EDFPlotProvider>
        <div className="min-h-screen w-full bg-background">
          <div className="flex h-screen">
            <AppSidebar />
            <div className="flex flex-col flex-1 min-w-0">
              <Header />
              <main className="flex-1 overflow-auto">
                {children}
              </main>
              <Footer />
            </div>
          </div>
        </div>
      </EDFPlotProvider>
    </SidebarProvider>
  );
}
