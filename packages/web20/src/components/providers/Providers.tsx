'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { AuthModeProvider } from '@/contexts/AuthModeContext';

interface ProvidersProps {
	children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
	return (
		<SessionProvider>
			<AuthModeProvider>
				{children}
			</AuthModeProvider>
		</SessionProvider>
	);
} 