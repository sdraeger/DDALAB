'use client';

import React from 'react';
import { useAppDispatch, useAuthUser, useAuthMode, useIsAuthAuthenticated } from '@/store/hooks';
import { logout } from '@/store/slices/authSlice';
import { toggleSidebar, toggleHeader, setTheme } from '@/store/slices/userSlice';
import {
	Menu,
	Bell,
	Search,
	Settings,
	User,
	Sun,
	Moon,
	Monitor,
	LayoutGrid,
	Plus,
	LogOut
} from 'lucide-react';
import { Button } from '@/components/ui';
import { Avatar, AvatarFallback, AvatarImage, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, Input } from '@/components/ui';
import { useTheme } from '@/store/hooks';

export function Header() {
	const dispatch = useAppDispatch();
	const authUser = useAuthUser();
	const authMode = useAuthMode();
	const isAuthenticated = useIsAuthAuthenticated();
	const theme = useTheme();

	const handleLogout = () => {
		dispatch(logout());
	};

	const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
		dispatch(setTheme(newTheme));
	};

	const getThemeIcon = () => {
		switch (theme) {
			case 'light':
				return <Sun className="h-4 w-4" />;
			case 'dark':
				return <Moon className="h-4 w-4" />;
			default:
				return <Monitor className="h-4 w-4" />;
		}
	};

	// Get user information - prefer auth user if available, fallback to user slice
	const currentUser = authUser || null;
	const displayName = currentUser?.username || 'User';
	const displayEmail = currentUser?.email || '';

	return (
		<header className="flex h-16 items-center justify-between border-b bg-background px-4 shadow-sm">
			<div className="flex items-center gap-4">
				<Button
					variant="ghost"
					size="sm"
					onClick={() => dispatch(toggleSidebar())}
					className="lg:hidden"
				>
					<Menu className="h-4 w-4" />
				</Button>

				<div className="flex items-center gap-2">
					<LayoutGrid className="h-6 w-6 text-primary" />
					<h1 className="text-lg font-semibold">Dashboard</h1>
				</div>
			</div>

			<div className="flex items-center gap-4">
				{/* Search */}
				<div className="relative hidden md:block">
					<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						placeholder="Search..."
						className="pl-9 w-64"
					/>
				</div>

				{/* Actions */}
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="sm">
						<Plus className="h-4 w-4" />
					</Button>

					<Button variant="ghost" size="sm">
						<Bell className="h-4 w-4" />
					</Button>

					{/* Theme Toggle */}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="sm">
								{getThemeIcon()}
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => handleThemeChange('light')}>
								<Sun className="mr-2 h-4 w-4" />
								Light
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => handleThemeChange('dark')}>
								<Moon className="mr-2 h-4 w-4" />
								Dark
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => handleThemeChange('system')}>
								<Monitor className="mr-2 h-4 w-4" />
								System
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>

					{/* User Menu */}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" className="relative h-8 w-8 rounded-full">
								<Avatar className="h-8 w-8">
									<AvatarImage src={currentUser?.id ? `/api/avatar/${currentUser.id}` : undefined} />
									<AvatarFallback>
										{displayName.charAt(0).toUpperCase()}
									</AvatarFallback>
								</Avatar>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent className="w-56" align="end" forceMount>
							<div className="flex items-center justify-start gap-2 p-2">
								<div className="flex flex-col space-y-1 leading-none">
									{currentUser && (
										<>
											<p className="font-medium">{displayName}</p>
											<p className="w-[200px] truncate text-sm text-muted-foreground">
												{displayEmail}
											</p>
											{authMode && (
												<p className="text-xs text-muted-foreground">
													Mode: {authMode}
												</p>
											)}
										</>
									)}
								</div>
							</div>
							<DropdownMenuSeparator />
							<DropdownMenuItem>
								<User className="mr-2 h-4 w-4" />
								Profile
							</DropdownMenuItem>
							<DropdownMenuItem>
								<Settings className="mr-2 h-4 w-4" />
								Settings
							</DropdownMenuItem>
							{authMode === 'multi' && isAuthenticated && (
								<>
									<DropdownMenuSeparator />
									<DropdownMenuItem onClick={handleLogout} className="text-destructive">
										<LogOut className="mr-2 h-4 w-4" />
										Logout
									</DropdownMenuItem>
								</>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
		</header>
	);
} 