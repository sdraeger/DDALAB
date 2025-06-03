"use client";

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

function CacheInitializer() {
  usePlotCache();
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ReduxProvider>
      <ApolloWrapper>
        <SessionProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <SettingsProvider>
              <DashboardStateProvider>
                <EDFPlotProvider>
                  <PersistentPlotsProvider>
                    <CacheInitializer />
                    <div className="relative flex min-h-screen flex-col">
                      <Header />
                      <div className="flex-1">{children}</div>
                      <PersistentPlotContainer />
                    </div>
                    <Toaster />
                  </PersistentPlotsProvider>
                </EDFPlotProvider>
              </DashboardStateProvider>
            </SettingsProvider>
          </ThemeProvider>
        </SessionProvider>
      </ApolloWrapper>
    </ReduxProvider>
  );
}
