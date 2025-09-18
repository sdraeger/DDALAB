'use client';

import React, { useEffect, useState } from 'react';
import { SessionProvider } from 'next-auth/react';

interface ConditionalSessionProviderProps {
  children: React.ReactNode;
}

export function ConditionalSessionProvider({ children }: ConditionalSessionProviderProps) {
  const [authMode, setAuthMode] = useState<'local' | 'multi-user' | null>(null);

  useEffect(() => {
    // Check auth mode from API
    fetch('/api-backend/auth/mode')
      .then(response => {
        if (response.ok) {
          return response.json();
        }
        throw new Error('API not accessible');
      })
      .then(data => {
        setAuthMode(data.auth_mode === 'local' ? 'local' : 'multi-user');
      })
      .catch(() => {
        // Default to local mode if API is not accessible
        setAuthMode('local');
      });
  }, []);

  // While detecting auth mode, show loading
  if (authMode === null) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <span className="ml-2">Initializing...</span>
      </div>
    );
  }

  // In local mode, bypass SessionProvider entirely
  if (authMode === 'local') {
    return <>{children}</>;
  }

  // In multi-user mode, use SessionProvider
  return (
    <SessionProvider>
      {children}
    </SessionProvider>
  );
}