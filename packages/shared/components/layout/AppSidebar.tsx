"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../../lib/utils/misc";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	SidebarFooter,
	useSidebar,
} from "../ui/sidebar";
import {
	BarChart3,
	FileText,
	HelpCircle,
	Settings,
	Home,
	FolderOpen,
	BrainCircuit,
	LogOut,
	User,
	Ticket,
	ChevronUp,
	Loader2,
} from "lucide-react";
import { Button } from "../ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Badge } from "../ui/badge";
import { useUnifiedSession, useUnifiedLogout } from "../../hooks/useUnifiedSession";
import { ModeToggle } from "../ModeToggle";
import { HelpButton } from "../ui/help-button";
import { OpenPlotsIndicator } from "../ui/open-plots-indicator";
// import { useAppSettings } from "../../lib/state/examples/DashboardStateExample"; // Removed - file deleted

const mainNavigationItems = [
	{
		title: "Overview",
		url: "/overview",
		icon: Home,
		description: "Dashboard overview and quick actions",
		variant: "default" as const,
	},
	{
		title: "Dashboard",
		url: "/dashboard",
		icon: FolderOpen,
		description: "Main workspace with draggable widgets",
		variant: "default" as const,
	},
	{
		title: "Artifacts",
		url: "/artifacts",
		icon: FileText,
		description: "View and manage analysis results",
		variant: "default" as const,
	},
];

const supportNavigationItems = [
	{
		title: "Help Center",
		url: "/tickets",
		icon: HelpCircle,
		description: "Help tickets and support requests",
		variant: "outline" as const,
	},
	{
		title: "Settings",
		url: "/settings",
		icon: Settings,
		description: "User preferences and configuration",
		variant: "outline" as const,
	},
];

interface AppSidebarProps {
	className?: string;
}

export function AppSidebar({ className }: AppSidebarProps) {
	const pathname = usePathname();
	const { user, status } = useUnifiedSession();
	const { state } = useSidebar();
	const isLoggedIn = !!user;
	const isLoading = status === "loading";

	// Use centralized state for sidebar preferences - temporarily disabled
	// const { sidebarCollapsed, toggleSidebar } = useAppSettings();
	const sidebarCollapsed = false;
	const toggleSidebar = () => { };

	const { logout } = useUnifiedLogout();

	const handleLogout = async () => {
		await logout({ callbackUrl: "/" });
	};

	const getUserInitials = (name?: string | null) => {
		if (!name) return "U";
		return name
			.split(" ")
			.map((n) => n[0])
			.join("")
			.toUpperCase()
			.slice(0, 2);
	};

	return (
		<Sidebar collapsible="icon" className={cn("border-r", className)}>
			<SidebarHeader className="border-b border-border/50">
				<div className={cn(
					"flex items-center gap-2 px-2 py-2",
					state === "collapsed" && "justify-center"
				)}>
					<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
						<BrainCircuit className="size-4" />
					</div>
					{state === "expanded" && (
						<div className="grid flex-1 text-left text-sm leading-tight">
							<span className="truncate font-semibold">DDALAB</span>
							<span className="truncate text-xs text-muted-foreground">
								DDA Laboratory
							</span>
						</div>
					)}
				</div>
			</SidebarHeader>

			<SidebarContent className="gap-0">
				{isLoading ? (
					// Loading state
					<SidebarGroup>
						<SidebarGroupContent>
							<div className="flex items-center justify-center py-8">
								<Loader2 className="h-6 w-6 animate-spin" />
								{state === "expanded" && (
									<span className="ml-2 text-sm text-muted-foreground">Loading...</span>
								)}
							</div>
						</SidebarGroupContent>
					</SidebarGroup>
				) : isLoggedIn ? (
					// Authenticated content
					<>
						{/* Main Navigation */}
						<SidebarGroup>
							{state === "expanded" && <SidebarGroupLabel>Workspace</SidebarGroupLabel>}
							<SidebarGroupContent>
								<SidebarMenu>
									{mainNavigationItems.map((item) => {
										const isActive = pathname === item.url || pathname.startsWith(item.url + "/");
										return (
											<SidebarMenuItem key={item.title}>
												<SidebarMenuButton
													asChild
													isActive={isActive}
													tooltip={state === "collapsed" ? item.title : item.description}
												>
													<Link href={item.url}>
														<item.icon />
														<span>{item.title}</span>
													</Link>
												</SidebarMenuButton>
											</SidebarMenuItem>
										);
									})}
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>

						{/* Support & Settings */}
						<SidebarGroup>
							{state === "expanded" && <SidebarGroupLabel>Support</SidebarGroupLabel>}
							<SidebarGroupContent>
								<SidebarMenu>
									{supportNavigationItems.map((item) => {
										const isActive = pathname === item.url || pathname.startsWith(item.url + "/");
										return (
											<SidebarMenuItem key={item.title}>
												<SidebarMenuButton
													asChild
													isActive={isActive}
													tooltip={state === "collapsed" ? item.title : item.description}
													variant={item.variant}
												>
													<Link href={item.url}>
														<item.icon />
														<span>{item.title}</span>
													</Link>
												</SidebarMenuButton>
											</SidebarMenuItem>
										);
									})}
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>

						{/* Quick Actions - only visible when expanded */}
						{state === "expanded" && (
							<SidebarGroup>
								<SidebarGroupLabel>Quick Actions</SidebarGroupLabel>
								<SidebarGroupContent>
									<div className="flex flex-col gap-2 px-2">
										<div className="flex items-center justify-between">
											<span className="text-xs text-muted-foreground">Tools</span>
											<div className="flex gap-1">
												<HelpButton />
												<OpenPlotsIndicator />
												<ModeToggle />
											</div>
										</div>
									</div>
								</SidebarGroupContent>
							</SidebarGroup>
						)}
					</>
				) : (
					// Unauthenticated state
					<SidebarGroup>
						<SidebarGroupContent>
							<div className="flex flex-col items-center justify-center py-8 px-4">
								<User className="h-8 w-8 text-muted-foreground mb-2" />
								{state === "expanded" && (
									<>
										<p className="text-sm text-muted-foreground text-center mb-4">
											Please log in to access the dashboard
										</p>
										<Button asChild size="sm" className="w-full">
											<Link href="/login">Login</Link>
										</Button>
									</>
								)}
							</div>
						</SidebarGroupContent>
					</SidebarGroup>
				)}
			</SidebarContent>

			{isLoggedIn && (
				<SidebarFooter className="border-t border-border/50">
					<SidebarMenu>
						<SidebarMenuItem>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<SidebarMenuButton
										className={cn(
											"data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
											state === "collapsed" && "justify-center"
										)}
										tooltip={state === "collapsed" ? user?.name || "User" : undefined}
									>
										<Avatar className="h-8 w-8 rounded-lg">
											<AvatarImage
												src={user?.image || undefined}
												alt={user?.name || "User"}
											/>
											<AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
												{getUserInitials(user?.name)}
											</AvatarFallback>
										</Avatar>
										{state === "expanded" && (
											<>
												<div className="grid flex-1 text-left text-sm leading-tight">
													<span className="truncate font-semibold">
														{user?.name || "User"}
													</span>
													<span className="truncate text-xs text-muted-foreground">
														{user?.email || "No email"}
													</span>
												</div>
												<ChevronUp className="ml-auto size-4" />
											</>
										)}
									</SidebarMenuButton>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
									side={state === "collapsed" ? "right" : "bottom"}
									align="end"
									sideOffset={4}
								>
									<DropdownMenuLabel className="p-0 font-normal">
										<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
											<Avatar className="h-8 w-8 rounded-lg">
												<AvatarImage
													src={user?.image || undefined}
													alt={user?.name || "User"}
												/>
												<AvatarFallback className="rounded-lg">
													{getUserInitials(user?.name)}
												</AvatarFallback>
											</Avatar>
											<div className="grid flex-1 text-left text-sm leading-tight">
												<span className="truncate font-semibold">
													{user?.name || "User"}
												</span>
												<span className="truncate text-xs text-muted-foreground">
													{user?.email || "No email"}
												</span>
											</div>
										</div>
									</DropdownMenuLabel>
									<DropdownMenuSeparator />
									<DropdownMenuItem asChild>
										<Link href="/dashboard/settings" className="cursor-pointer">
											<Settings className="mr-2 h-4 w-4" />
											Account Settings
										</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild>
										<Link href="/tickets" className="cursor-pointer">
											<Ticket className="mr-2 h-4 w-4" />
											Support Tickets
										</Link>
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
										<LogOut className="mr-2 h-4 w-4" />
										Log out
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarFooter>
			)}

			<SidebarRail />
		</Sidebar>
	);
}
