import type React from "react";
import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import { Providers } from "shared/components/providers";
import { Footer } from "shared/components/footer";
import "./styles/globals.css";

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
        <div className="flex flex-col min-h-screen">
          <Providers>{children}</Providers>
          <Footer />
        </div>
      </body>
    </html>
  );
}
