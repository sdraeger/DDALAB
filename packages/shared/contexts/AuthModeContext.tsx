"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
	AuthModeType,
	switchAuthMode,
	getCurrentAuthMode,
	userPreferencesStorage,
	dashboardStorage,
	plotStorage,
	widgetLayoutStorage
} from '../lib/utils/authModeStorage';

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

	// Check API for auth mode on mount
	useEffect(() => {
		async function checkAuthMode() {
			try {
				// Use relative URL to go through Traefik (browser) or direct URL (server)
				// In browser: relative '/api/auth/mode' -> goes through Traefik -> Python API
				// In server: direct 'http://localhost:8001/api/auth/mode' -> Python API
				const apiUrl = typeof window !== 'undefined'
					? '' // Use relative URL in browser to go through Traefik
					: 'http://localhost:8001'; // Direct connection on server
				const response = await fetch(`${apiUrl}/api/auth/mode`);
				if (response.ok) {
					const data = await response.json();
					const detectedMode: AuthModeType = data.auth_mode;

					// Only update if different from current mode
					if (detectedMode !== authMode) {
						console.log(`Auth mode detected from API: ${detectedMode}`);
						setAuthModeState(detectedMode);
						switchAuthMode(detectedMode);
					}
				} else {
					console.warn('Failed to detect auth mode from API, using default:', authMode);
				}
			} catch (error) {
				console.warn('Failed to check auth mode from API, using default:', authMode, error);
				// Set to multi-user mode as default when API is not available
				setAuthModeState('multi-user');
				switchAuthMode('multi-user');
			} finally {
				setIsInitialized(true);
			}
		}

		// Add a small delay to ensure API is ready
		const timer = setTimeout(() => {
			checkAuthMode();
		}, 1000);

		return () => clearTimeout(timer);
	}, []);

	// Update storage contexts when auth mode changes
	useEffect(() => {
		if (isInitialized) {
			switchAuthMode(authMode);
			console.log(`Auth mode context switched to: ${authMode}`);
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
