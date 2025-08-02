'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

interface AuthRedirectProps {
  children: React.ReactNode;
  redirectTo?: string;
}

export function AuthRedirect({
  children,
  redirectTo = '/dashboard',
}: AuthRedirectProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push(redirectTo);
    }
  }, [isAuthenticated, isLoading, router, redirectTo]);

  if (isLoading) {
    return <>{children}</>; // Show the page while loading
  }

  if (isAuthenticated) {
    return null; // Will redirect via useEffect
  }

  return <>{children}</>;
}
