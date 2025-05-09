"use client";

import { ThemeProvider } from "./theme-provider";
import { EDFPlotProvider } from "../contexts/edf-plot-context";
import { ApolloWrapper } from "./apollo-wrapper";
import { Header } from "./header";
import { Toaster } from "./ui/toaster";
import { SettingsProvider } from "../contexts/settings-context";
import { SessionProvider } from "next-auth/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
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
  );
}
