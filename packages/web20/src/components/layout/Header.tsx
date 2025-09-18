'use client';

import React, { useState, useEffect, useRef } from 'react';
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
	LogOut,
	FileText,
	Folder,
	Clock
} from 'lucide-react';
import { Button } from '@/components/ui';
import { Avatar, AvatarFallback, AvatarImage, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, Input } from '@/components/ui';
import { useTheme as useReduxTheme } from '@/store/hooks';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { NotificationDropdown } from '@/components/notifications/NotificationDropdown';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { SearchProviderRegistry } from '@/components/search/SearchProviderRegistry';
import { InterfaceSelector } from '@shared/components/ui/interface-selector';

export function Header() {
	const dispatch = useAppDispatch();
	const authUser = useAuthUser();
	const authMode = useAuthMode();
	const isAuthenticated = useIsAuthAuthenticated();
	const { theme, setTheme: setNextTheme } = useTheme();
	
	// Global search
	const { query, results, isSearching, search, clearSearch, selectResult } = useGlobalSearch();
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const searchRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const handleLogout = () => {
		dispatch(logout());
	};

	const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
		dispatch(setTheme(newTheme));
		setNextTheme(newTheme);
	};

	// Handle search input change
	const handleSearchChange = (value: string) => {
		search(value);
		setIsSearchOpen(true);
	};

	// Handle search input focus/blur
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
				setIsSearchOpen(false);
			}
		};

		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, []);

	// Handle keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
				event.preventDefault();
				inputRef.current?.focus();
				setIsSearchOpen(true);
			}
			if (event.key === 'Escape') {
				setIsSearchOpen(false);
				clearSearch();
				inputRef.current?.blur();
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, []);

	const handleSearchResultClick = (item: any) => {
		setIsSearchOpen(false);
		selectResult(item);
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
			<SearchProviderRegistry />
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
				
				{/* Interface Selector */}
				<InterfaceSelector currentInterface="web20" />
			</div>

			<div className="flex items-center gap-4">
				{/* Search */}
				<div className="relative hidden md:block" ref={searchRef}>
					<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						ref={inputRef}
						placeholder="Search anything... (⌘K)"
						className="pl-9 w-64"
						value={query}
						onChange={(e) => handleSearchChange(e.target.value)}
						onFocus={() => setIsSearchOpen(true)}
					/>
					
					{/* Search Results Dropdown */}
					{isSearchOpen && (query || results.length > 0) && (
						<div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-md shadow-lg z-50 max-h-96 overflow-y-auto">
							{isSearching && (
								<div className="p-4 text-center text-muted-foreground">
									<Search className="h-4 w-4 animate-pulse mx-auto mb-2" />
									Searching...
								</div>
							)}
							
							{!isSearching && results.length === 0 && query && (
								<div className="p-4 text-center text-muted-foreground">
									No results found for "{query}"
								</div>
							)}
							
							{!isSearching && results.length > 0 && (
								<div className="py-2">
									{results.map((result) => (
										<button
											key={result.id}
											onClick={() => handleSearchResultClick(result)}
											className="w-full px-4 py-3 text-left hover:bg-muted flex items-start gap-3 border-none bg-transparent"
										>
											<div className="mt-0.5 text-muted-foreground">
												{result.icon}
											</div>
											<div className="flex-1 min-w-0">
												<div className="font-medium text-sm truncate">
													{result.title}
												</div>
												<div className="text-xs text-muted-foreground truncate">
													{result.description}
												</div>
											</div>
											<div className="text-xs text-muted-foreground mt-0.5 capitalize">
												{result.category}
											</div>
										</button>
									))}
								</div>
							)}
							
							{!query && (
								<div className="p-4 text-center text-muted-foreground text-sm">
									<div className="mb-2">Search across:</div>
									<div className="text-xs space-y-1">
										<div>• Files and documents</div>
										<div>• Pages and navigation</div>
										<div>• Notifications and alerts</div>
										<div>• Use ⌘K or Ctrl+K to focus</div>
									</div>
								</div>
							)}
						</div>
					)}
				</div>

				{/* Actions */}
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="sm">
						<Plus className="h-4 w-4" />
					</Button>

					<NotificationDropdown />

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