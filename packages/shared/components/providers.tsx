"use client";

import { usePathname } from "next/navigation";
import { ThemeProvider } from "next-themes";
import { EDFPlotProvider } from "../contexts/EDFPlotContext";
import { PersistentPlotsProvider } from "../contexts/PersistentPlotsContext";
import { DashboardStateProvider } from "../contexts/DashboardStateContext";
import { ApolloWrapper } from "./higher-order/ApolloWrapper";
import { Header } from "./layout/Header";
import { Toaster } from "./ui/toaster";
import { SettingsProvider } from "../contexts/SettingsContext";
import { SessionProvider } from "next-auth/react";
import { ReduxProvider } from "../providers/ReduxProvider";
import { usePlotCache } from "../hooks/usePlotCache";
import { PersistentPlotContainer } from "./plot/PersistentPlotContainer";

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Don't show Header on dashboard pages as they have their own header in the layout
  const isDashboardPage = pathname?.startsWith('/dashboard');

  return (
    <SessionProvider>
      <ReduxProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SettingsProvider>
            <ApolloWrapper>
              <EDFPlotProvider>
                <PersistentPlotsProvider>
                  <DashboardStateProvider>
                    <div className="relative flex min-h-screen flex-col">
                      {!isDashboardPage && <Header />}
                      <div className="flex-1">
                        {children}
                        <PlotCacheManagerClient />
                      </div>
                    </div>
                    <PersistentPlotContainer />
                    <Toaster />
                  </DashboardStateProvider>
                </PersistentPlotsProvider>
              </EDFPlotProvider>
            </ApolloWrapper>
          </SettingsProvider>
        </ThemeProvider>
      </ReduxProvider>
    </SessionProvider>
  );
}

function PlotCacheManagerClient() {
  usePlotCache();
  return null;
}
