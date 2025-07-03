"use client";

import { Button } from "./button";
import { PanelLeft } from "lucide-react";
import { useSidebar } from "./sidebar";
import { cn } from "../../lib/utils/misc";

interface SidebarTriggerProps {
	className?: string;
	variant?: "default" | "outline" | "ghost";
	size?: "default" | "sm" | "lg" | "icon";
}

export function SidebarTrigger({
	className,
	variant = "ghost",
	size = "icon"
}: SidebarTriggerProps) {
	const { toggleSidebar } = useSidebar();

	return (
		<Button
			variant={variant}
			size={size}
			className={cn("", className)}
			onClick={toggleSidebar}
		>
			<PanelLeft className="h-4 w-4" />
			<span className="sr-only">Toggle Sidebar</span>
		</Button>
	);
}
