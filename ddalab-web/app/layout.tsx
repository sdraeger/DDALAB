import type React from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AuthProvider } from "@/contexts/auth-context";
import { ThemeProvider } from "@/components/theme-provider";
import { EDFPlotProvider } from "@/contexts/edf-plot-context";
import { ApolloWrapper } from "@/components/apollo-wrapper";
import { Header } from "@/components/header";
import { Toaster } from "@/components/ui/toaster";
import "@/styles/globals.css";
import { SettingsProvider } from "@/contexts/settings-context";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DDALAB - EEG Data Visualization",
  description: "Visualize and analyze EEG data in your browser",
  creator: "DDALAB Team",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ApolloWrapper>
          <AuthProvider>
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
          </AuthProvider>
        </ApolloWrapper>
      </body>
    </html>
  );
}

import "./globals.css";
