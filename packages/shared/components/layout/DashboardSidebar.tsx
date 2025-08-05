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
} from "../ui/sidebar";
import {
	BarChart3,
	FileText,
	HelpCircle,
	Settings,
	Home,
	FolderOpen,
} from "lucide-react";

const navigationItems = [
	{
		title: "Workspace",
		url: "/dashboard",
		icon: FolderOpen,
		description: "Flexible dashboard with draggable widgets",
	},
	{
		title: "Overview",
		url: "/dashboard/overview",
		icon: Home,
		description: "Dashboard overview and quick actions",
	},
	{
		title: "Artifacts",
		url: "/dashboard/artifacts",
		icon: FileText,
		description: "View and manage analysis results",
	},
	{
		title: "Support Tickets",
		url: "/tickets",
		icon: HelpCircle,
		description: "Help tickets and support requests",
	},
	{
		title: "Settings",
		url: "/dashboard/settings",
		icon: Settings,
		description: "User preferences and configuration",
	},
];

interface DashboardSidebarProps {
	className?: string;
}

export function DashboardSidebar({ className }: DashboardSidebarProps) {
	const pathname = usePathname();

	return (
		<Sidebar collapsible="icon" className={className}>
			<SidebarHeader>
				<div className="flex items-center gap-2 px-2">
					<FolderOpen className="h-6 w-6" />
					<span className="font-semibold">Dashboard</span>
				</div>
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Navigation</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{navigationItems.map((item) => {
								const isActive = pathname === item.url;
								return (
									<SidebarMenuItem key={item.title}>
										<SidebarMenuButton
											asChild
											isActive={isActive}
											tooltip={item.description}
										>
											<Link href={item.url}>
												<item.icon className="h-4 w-4" />
												<span>{item.title}</span>
											</Link>
										</SidebarMenuButton>
									</SidebarMenuItem>
								);
							})}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>

			<SidebarRail />
		</Sidebar>
	);
}
