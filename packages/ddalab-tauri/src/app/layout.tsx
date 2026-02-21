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
import { KeyboardShortcutsProvider } from "@/components/KeyboardShortcutsProvider";
import { SkipLinks } from "@/components/ui/skip-links";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const inter = Inter({ subsets: ["latin"] });

const chunkRecoveryScript = `
(() => {
  const KEY = "ddalab:chunk-recovery";
  const MAX_RELOADS = 6;
  const COOLDOWN_MS = 120_000;
  const BASE_DELAY_MS = 800;
  const MAX_DELAY_MS = 8_000;

  const readState = () => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) {
        return { count: 0, ts: 0 };
      }
      const parsed = JSON.parse(raw);
      return {
        count: Number.isFinite(parsed?.count) ? parsed.count : 0,
        ts: Number.isFinite(parsed?.ts) ? parsed.ts : 0,
      };
    } catch {
      return { count: 0, ts: 0 };
    }
  };

  const shouldRecover = (value, meta = "") => {
    const text =
      typeof value === "string"
        ? value
        : value && (value.message || value.stack)
          ? value.message || value.stack
          : String(value || "");
    const haystack = (text + " " + String(meta || "")).toLowerCase();
    return (
      haystack.includes("chunkloaderror") ||
      haystack.includes("loading chunk") ||
      haystack.includes("failed to fetch dynamically imported module") ||
      haystack.includes("_next/static/chunks/app/layout") ||
      haystack.includes("unexpected eof") ||
      haystack.includes("unexpected end of input")
    );
  };

  const tryReload = (source) => {
    const now = Date.now();
    const state = readState();
    const resetWindow = now - state.ts > COOLDOWN_MS;
    const nextCount = resetWindow ? 1 : state.count + 1;
    if (nextCount > MAX_RELOADS) {
      return;
    }

    const delay = Math.min(
      MAX_DELAY_MS,
      BASE_DELAY_MS * Math.pow(2, Math.max(0, nextCount - 1)),
    );

    try {
      sessionStorage.setItem(
        KEY,
        JSON.stringify({ count: nextCount, ts: now, source }),
      );

      globalThis.setTimeout(() => {
        const url = new URL(window.location.href);
        url.searchParams.set("__ddalab_chunk_retry", String(now));
        window.location.replace(url.toString());
      }, delay);
    } catch {
      globalThis.setTimeout(() => {
        window.location.reload();
      }, delay);
    }
  };

  window.addEventListener(
    "error",
    (event) => {
      const meta = String(event?.filename || "");
      if (shouldRecover(event?.error || event?.message, meta)) {
        tryReload("error");
      }
    },
    true,
  );

  window.addEventListener(
    "unhandledrejection",
    (event) => {
      if (shouldRecover(event?.reason)) {
        try {
          event.preventDefault();
        } catch {}
        tryReload("rejection");
      }
    },
    true,
  );

  if (window.location.search.includes("__ddalab_chunk_retry=")) {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("__ddalab_chunk_retry");
    window.history.replaceState(null, "", cleanUrl.toString());
  } else {
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
  }
})();
`;

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
        <script
          id="ddalab-chunk-recovery"
          dangerouslySetInnerHTML={{ __html: chunkRecoveryScript }}
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem={true}
          disableTransitionOnChange
        >
          <ErrorBoundary>
            <StateManagerProvider>
              <QueryProvider>
                <SkipLinks />
                <ZoomKeyboardShortcuts />
                <GlobalSearchProvider>
                  <KeyboardShortcutsProvider>
                    <ZoomWrapper>
                      <div
                        id="main-content"
                        className="min-h-screen bg-background text-foreground"
                      >
                        {children}
                      </div>
                    </ZoomWrapper>
                  </KeyboardShortcutsProvider>
                </GlobalSearchProvider>
              </QueryProvider>
            </StateManagerProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  );
}
