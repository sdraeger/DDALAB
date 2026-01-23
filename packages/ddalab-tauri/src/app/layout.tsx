import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "@/styles/focus.css";
import "@/styles/design-tokens.css";
import { QueryProvider } from "@/providers/QueryProvider";
import { StateManagerProvider } from "@/providers/StateManagerProvider";
import { ZoomWrapper } from "@/components/ZoomWrapper";
import { ZoomKeyboardShortcuts } from "@/components/ZoomKeyboardShortcuts";
import { ThemeProvider } from "@/components/theme-provider";
import { GlobalSearchProvider } from "@/components/GlobalSearchProvider";
import { SkipLinks } from "@/components/ui/skip-links";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DDALAB - Delay Differential Analysis Laboratory",
  description:
    "Scientific computing application for performing Delay Differential Analysis on EDF and ASCII files",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <ErrorBoundary>
            <StateManagerProvider>
              <QueryProvider>
                <SkipLinks />
                <ZoomKeyboardShortcuts />
                <GlobalSearchProvider>
                  <ZoomWrapper>
                    <div
                      id="main-content"
                      className="min-h-screen bg-background text-foreground"
                    >
                      {children}
                    </div>
                  </ZoomWrapper>
                </GlobalSearchProvider>
              </QueryProvider>
            </StateManagerProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  );
}
