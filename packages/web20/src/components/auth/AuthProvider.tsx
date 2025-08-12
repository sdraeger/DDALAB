'use client';

import React, { useEffect } from 'react';
import { useAppDispatch, useAuthMode, useIsAuthAuthenticated, useAuthLoading } from '@/store/hooks';
import { getAuthMode } from '@/store/slices/authSlice';
import { LoginForm } from './LoginForm';

interface AuthProviderProps {
	children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
	const dispatch = useAppDispatch();
	const authMode = useAuthMode();
	const isAuthenticated = useIsAuthAuthenticated();
	const isLoading = useAuthLoading();

	useEffect(() => {
		// Check auth mode on mount
		dispatch(getAuthMode());
	}, [dispatch]);

	// Show loading state while checking auth mode
	if (isLoading || authMode === null) {
		return (
			<div className="flex items-center justify-center min-h-screen">
				<div className="text-center">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
					<p className="text-muted-foreground">Loading...</p>
				</div>
			</div>
		);
	}

	// In local mode, always show the app
	if (authMode === 'local') {
		return <>{children}</>;
	}

	// In multi-user mode, show login if not authenticated
	if (authMode === 'multi' && !isAuthenticated) {
		return <LoginForm />;
	}

	// Show the app if authenticated in multi-user mode
	return <>{children}</>;
} 