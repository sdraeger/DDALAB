"use client";

import Link from "next/link";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  LogOut,
  User,
  BrainCircuit,
  Ticket,
  Settings,
} from "lucide-react";
import { ModeToggle } from "../ModeToggle";
import { HelpButton } from "../ui/help-button";
import { OpenPlotsIndicator } from "../ui/open-plots-indicator";
import { signOut } from "next-auth/react";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useUnifiedSessionData } from "../../hooks/useUnifiedSession";

interface ConfigResponse {
  institutionName: string;
}

export function Header() {
  const { data: session } = useUnifiedSessionData();
  const user = session?.user;
  const isLoggedIn = !!session;

  const handleLogout = async () => {
    await signOut({ callbackUrl: "/" });
  };

  const { data: configData, loading: configLoading, error: configError } = useApiQuery<ConfigResponse>({
    url: "/api/config",
    method: "GET",
    responseType: "json",
    enabled: true,
  });

  const institutionName = configData?.institutionName;

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <div className="flex items-center mr-4">
          <BrainCircuit className="h-6 w-6 mr-2" />
          <Link href="/" className="font-bold">
            DDALAB
            {institutionName && !configLoading ? ` @ ${institutionName}` : ""}
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
          <nav className="flex items-center">
            {isLoggedIn && (
              <Link
                href="/dashboard"
                className="text-sm font-medium transition-colors hover:text-primary mr-6"
              >
                Dashboard
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-2">
            {isLoggedIn && (
              <>
                <OpenPlotsIndicator />
                <HelpButton />
              </>
            )}
            <ModeToggle />

            {isLoggedIn ? (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2">
                    <User className="h-4 w-4" />
                    <span className="hidden md:inline-block">{user?.name}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  side="bottom"
                  sideOffset={8}
                  avoidCollisions={false}
                  className="z-[9999] min-w-[180px] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
                  onCloseAutoFocus={(e) => e.preventDefault()}
                  onEscapeKeyDown={(e) => e.preventDefault()}
                  onFocusOutside={(e) => e.preventDefault()}
                  onInteractOutside={(e) => {
                    const target = e.target as Element;
                    if (target && target.closest('[data-radix-dropdown-menu-trigger]')) {
                      e.preventDefault();
                    }
                  }}
                  style={{
                    position: 'fixed',
                    willChange: 'transform',
                    top: 'var(--radix-popper-anchor-height, 0px)',
                    left: 'var(--radix-popper-anchor-width, 0px)',
                    transformOrigin: 'top right',
                  }}
                >
                  <DropdownMenuLabel>My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard/settings">
                      <Settings className="mr-2 h-4 w-4" />
                      <span>Settings</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/tickets">
                      <Ticket className="mr-2 h-4 w-4" />
                      <span>Help Tickets</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Button size="sm" asChild className="mr-2">
                  <Link href="/login">Login</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* CSS to stabilize dropdown positioning */}
      <style jsx global>{`
        /* Prevent layout shifts when dropdowns open */
        [data-radix-dropdown-menu-trigger] {
          position: relative;
        }

        /* Stable dropdown positioning */
        [data-radix-dropdown-menu-content] {
          z-index: 9999 !important;
          transform-origin: top center !important;
        }

        /* Prevent header from changing size */
        .sticky.top-0 {
          transform: translateZ(0);
        }
      `}</style>
    </header>
  );
}
