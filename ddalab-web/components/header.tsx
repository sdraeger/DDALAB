"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User, BrainCircuit, Ticket, Settings } from "lucide-react";
import { ModeToggle } from "@/components/mode-toggle";
import { HelpButton } from "@/components/help-button";
import { useState } from "react";
import { RegisterDialog } from "@/components/register-dialog";

export function Header() {
  const { user, logout, isLoggedIn } = useAuth();
  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <div className="flex items-center mr-4">
          <BrainCircuit className="h-6 w-6 mr-2" />
          <Link href="/" className="font-bold">
            DDALAB
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
          <nav className="flex items-center">
            {isLoggedIn && (
              <>
                <Link
                  href="/dashboard"
                  className="text-sm font-medium transition-colors hover:text-primary mr-6"
                >
                  Dashboard
                </Link>
                <Link
                  href="/dashboard/tickets"
                  className="text-sm font-medium transition-colors hover:text-primary mr-6"
                >
                  <span className="flex items-center">
                    <Ticket className="h-4 w-4 mr-1" />
                    My Tickets
                  </span>
                </Link>
              </>
            )}
          </nav>

          <div className="flex items-center gap-2">
            {isLoggedIn && <HelpButton />}
            <ModeToggle />

            {isLoggedIn ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2">
                    <User className="h-4 w-4" />
                    <span className="hidden md:inline-block">{user?.name}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard/settings">
                      <Settings className="mr-2 h-4 w-4" />
                      <span>Settings</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard/tickets">
                      <Ticket className="mr-2 h-4 w-4" />
                      <span>Help Tickets</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout}>
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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRegisterDialogOpen(true)}
                >
                  Register
                </Button>
                <RegisterDialog
                  open={registerDialogOpen}
                  onOpenChange={setRegisterDialogOpen}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
