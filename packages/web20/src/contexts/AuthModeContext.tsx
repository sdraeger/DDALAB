"use client";

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import {
	AuthModeType,
	switchAuthMode,
	userPreferencesStorage,
	dashboardStorage,
	plotStorage,
	widgetLayoutStorage
} from '@/lib/utils/authModeStorage';

interface AuthModeContextType {
	authMode: AuthModeType;
	isLocalMode: boolean;
	isMultiUserMode: boolean;
	switchToLocalMode: () => void;
	switchToMultiUserMode: () => void;
	setAuthMode: (mode: AuthModeType) => void;
	clearCurrentModeData: () => void;
	hasDataForMode: (mode: AuthModeType) => boolean;
	migrateDataBetweenModes: (fromMode: AuthModeType, toMode: AuthModeType) => void;
}

const AuthModeContext = createContext<AuthModeContextType | null>(null);

interface AuthModeProviderProps {
	children: ReactNode;
	initialMode?: AuthModeType;
}

export function AuthModeProvider({ children, initialMode = 'multi-user' }: AuthModeProviderProps) {
	const [authMode, setAuthModeState] = useState<AuthModeType>(initialMode);
	const [isInitialized, setIsInitialized] = useState(false);
	const authModeRef = useRef<AuthModeType>(initialMode);

	// Keep ref in sync with state
	useEffect(() => {
		authModeRef.current = authMode;
	}, [authMode]);

	// Improved auth mode detection with stable dependencies
	useEffect(() => {
		let isMounted = true;

		const detectAuthMode = async () => {
			try {
				console.log("[AuthModeContext] Detecting auth mode...");
				const response = await fetch('/api/config');

				if (!isMounted) return; // Prevent state updates if unmounted

				if (response.ok) {
					console.log("[AuthModeContext] API accessible, using multi-user mode");
					setAuthModeState('multi-user');
				} else {
					console.log("[AuthModeContext] API not accessible, using local mode");
					setAuthModeState('local');
				}
			} catch (error) {
				if (!isMounted) return;
				console.log("[AuthModeContext] API detection failed, using local mode");
				setAuthModeState('local');
			} finally {
				if (isMounted) {
					setIsInitialized(true);
				}
			}
		};

		detectAuthMode();

		return () => {
			isMounted = false;
		};
	}, []); // Empty dependency array - only run once

	// Update storage contexts when auth mode changes - but with debouncing
	useEffect(() => {
		if (isInitialized) {
			const timeoutId = setTimeout(() => {
				switchAuthMode(authMode);
				console.log(`Auth mode context switched to: ${authMode}`);
			}, 100); // Small delay to prevent rapid switches

			return () => clearTimeout(timeoutId);
		}
	}, [authMode, isInitialized]);

	const setAuthMode = (mode: AuthModeType) => {
		if (mode !== authMode) {
			console.log(`Switching auth mode from ${authMode} to ${mode}`);
			setAuthModeState(mode);
		}
	};

	const switchToLocalMode = () => {
		setAuthMode('local');
	};

	const switchToMultiUserMode = () => {
		setAuthMode('multi-user');
	};

	const clearCurrentModeData = () => {
		console.log(`Clearing data for ${authMode} mode`);
		userPreferencesStorage.clear();
		dashboardStorage.clear();
		plotStorage.clear();
		widgetLayoutStorage.clear();
	};

	const hasDataForMode = (mode: AuthModeType): boolean => {
		return (
			userPreferencesStorage.hasDataForMode(mode) ||
			dashboardStorage.hasDataForMode(mode) ||
			plotStorage.hasDataForMode(mode) ||
			widgetLayoutStorage.hasDataForMode(mode)
		);
	};

	const migrateDataBetweenModes = (fromMode: AuthModeType, toMode: AuthModeType) => {
		console.log(`Migrating data from ${fromMode} to ${toMode}`);
		userPreferencesStorage.migrateData(fromMode, toMode);
		dashboardStorage.migrateData(fromMode, toMode);
		plotStorage.migrateData(fromMode, toMode);
		widgetLayoutStorage.migrateData(fromMode, toMode);
	};

	const value: AuthModeContextType = {
		authMode,
		isLocalMode: authMode === 'local',
		isMultiUserMode: authMode === 'multi-user',
		switchToLocalMode,
		switchToMultiUserMode,
		setAuthMode,
		clearCurrentModeData,
		hasDataForMode,
		migrateDataBetweenModes,
	};

	// Don't render children until we've initialized the auth mode
	if (!isInitialized) {
		return (
			<div className="flex h-screen w-full items-center justify-center">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
				<span className="ml-2">Detecting authentication mode...</span>
			</div>
		);
	}

	return (
		<AuthModeContext.Provider value={value}>
			{children}
		</AuthModeContext.Provider>
	);
}

export function useAuthMode(): AuthModeContextType {
	const context = useContext(AuthModeContext);
	if (!context) {
		throw new Error('useAuthMode must be used within an AuthModeProvider');
	}
	return context;
}

// Hook for checking if we're in local mode
export function useIsLocalMode(): boolean {
	const { isLocalMode } = useAuthMode();
	return isLocalMode;
}

// Hook for checking if we're in multi-user mode
export function useIsMultiUserMode(): boolean {
	const { isMultiUserMode } = useAuthMode();
	return isMultiUserMode;
}
