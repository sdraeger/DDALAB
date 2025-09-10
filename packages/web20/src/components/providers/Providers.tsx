'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { AuthModeProvider } from '@/contexts/AuthModeContext';
import { ThemeProvider } from './ThemeProvider';
import { SearchProvider } from '@/contexts/SearchContext';
import { FileConfigProvider } from '@/contexts/FileConfigContext';

interface ProvidersProps {
	children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
	return (
		<SessionProvider>
			<ThemeProvider>
				<SearchProvider>
					<AuthModeProvider>
						<FileConfigProvider>
							{children}
						</FileConfigProvider>
					</AuthModeProvider>
				</SearchProvider>
			</ThemeProvider>
		</SessionProvider>
	);
} 