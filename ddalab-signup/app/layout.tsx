import type React from "react";
import { sourceSans3 } from "../fonts";
import { ThemeProvider } from "@/components/theme-provider";
import "@/app/globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata = {
  title: "DDALAB Sign Up",
  description: "Sign up to express your interest in DDALAB",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sourceSans3.variable} font-sans`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}

import "./globals.css";
