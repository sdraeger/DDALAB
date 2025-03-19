import type React from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ApolloWrapper } from "@/components/apollo-wrapper";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/contexts/auth-context";
import { EDFPlotProvider } from "@/contexts/edf-plot-context";
import { Header } from "@/components/header";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DDALAB - EEG Data Visualization",
  description: "Visualize and analyze EEG data in your browser",
  generator: "v0.dev",
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
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <AuthProvider>
              <EDFPlotProvider>
                <div className="relative flex min-h-screen flex-col">
                  <Header />
                  <div className="flex-1">{children}</div>
                </div>
                <Toaster />
              </EDFPlotProvider>
            </AuthProvider>
          </ThemeProvider>
        </ApolloWrapper>
      </body>
    </html>
  );
}

import "./globals.css";
