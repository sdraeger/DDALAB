import type React from "react";
import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import { Providers } from "shared/components/providers";
import "./styles/globals.css";
import { LoadingOverlay } from "shared/components/ui/loading-overlay";

const sourceSans3 = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "DDALAB - EEG Data Visualization",
  description: "Visualize and analyze EEG data in your browser",
  creator: "DDALAB Team",
  icons: {
    icon: [
      {
        url: "/brain-circuit.svg",
        type: "image/svg+xml",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={sourceSans3.className}>
        <Providers>
          <LoadingOverlay />
          {children}
        </Providers>
      </body>
    </html>
  );
}
