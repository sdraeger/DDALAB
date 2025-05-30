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
  FileIcon,
} from "lucide-react";
import { ModeToggle } from "../ModeToggle";
import { HelpButton } from "../ui/help-button";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { signOut } from "next-auth/react";

export function Header() {
  const { data: session } = useSession();
  const user = session?.user;
  const isLoggedIn = !!session;
  const [institutionName, setInstitutionName] = useState("DEFAULT");

  const handleLogout = async () => {
    await signOut({ callbackUrl: "/" });
  };

  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => {
        setInstitutionName(data.institution_name);
      });
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <div className="flex items-center mr-4">
          <BrainCircuit className="h-6 w-6 mr-2" />
          <Link href="/" className="font-bold">
            DDALAB
            {institutionName ? ` @ ${institutionName}` : ""}
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
                <Link
                  href="/dashboard/artifacts"
                  className="text-sm font-medium transition-colors hover:text-primary mr-6"
                >
                  <span className="flex items-center">
                    <FileIcon className="h-4 w-4 mr-1" />
                    Artifacts
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
    </header>
  );
}
