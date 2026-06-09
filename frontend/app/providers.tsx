'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from '../features/auth/AuthProvider';
import { ThemeProvider, useTheme } from '../features/theme/ThemeProvider';

import { useState } from 'react';

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved === 'dark' ? 'dark' : 'light'} richColors position="top-right" closeButton />;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnMount: true,
        refetchOnWindowFocus: false,
        refetchOnReconnect: 'always',
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        retry: (failureCount, error) => {
          if (failureCount >= 2) return false;
          if (error instanceof Error && error.name === 'BackendWakingError') return true;
          return failureCount < 1;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          {children}
          <ThemedToaster />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
