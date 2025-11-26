import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { QueryProvider } from "@/providers/QueryProvider";
import { ZoomWrapper } from "@/components/ZoomWrapper";
import { ZoomKeyboardShortcuts } from "@/components/ZoomKeyboardShortcuts";
import { ThemeProvider } from "@/components/theme-provider";
import { GlobalSearchProvider } from "@/components/GlobalSearchProvider";

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
        {process.env.NODE_ENV === "development" && (
          <Script
            src="//unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="afterInteractive"
          />
        )}
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <QueryProvider>
            <ZoomKeyboardShortcuts />
            <GlobalSearchProvider>
              <ZoomWrapper>
                <div className="min-h-screen bg-background text-foreground">
                  {children}
                </div>
              </ZoomWrapper>
            </GlobalSearchProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
