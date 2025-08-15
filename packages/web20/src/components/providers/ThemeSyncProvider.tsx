'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { useAppDispatch } from '@/store/hooks';
import { setTheme } from '@/store/slices/userSlice';

export function ThemeSyncProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const dispatch = useAppDispatch();

  useEffect(() => {
    // Sync next-themes to Redux when theme changes
    if (theme && (theme === 'light' || theme === 'dark' || theme === 'system')) {
      dispatch(setTheme(theme as 'light' | 'dark' | 'system'));
    }
  }, [theme, dispatch]);

  return <>{children}</>;
}