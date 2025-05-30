"use client";

import { ThemeProvider } from "next-themes";
import { EDFPlotProvider } from "../contexts/EDFPlotContext";
import { ApolloWrapper } from "./higher-order/ApolloWrapper";
import { Header } from "./layout/Header";
import { Toaster } from "./ui/toaster";
import { SettingsProvider } from "../contexts/SettingsContext";
import { SessionProvider } from "next-auth/react";
import { ReduxProvider } from "../providers/ReduxProvider";

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
              <EDFPlotProvider>
                <div className="relative flex min-h-screen flex-col">
                  <Header />
                  <div className="flex-1">{children}</div>
                </div>
                <Toaster />
              </EDFPlotProvider>
            </SettingsProvider>
          </ThemeProvider>
        </SessionProvider>
      </ApolloWrapper>
    </ReduxProvider>
  );
}
