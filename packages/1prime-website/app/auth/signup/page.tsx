'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { AuthRedirect } from '@/components/AuthRedirect';

export default function SignUpPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        'https://shortcut-auth.tanweihup.workers.dev/sign-up/email',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, password }),
        },
      );

      if (response.ok) {
        // Try parsing as JSON first, fallback to text
        let authToken;
        try {
          const data = await response.json();
          authToken =
            typeof data === 'string' ? data : data.token || data.authToken;
        } catch {
          authToken = await response.text();
        }

        const cleanToken = authToken.trim();
        setToken(cleanToken);
        login(cleanToken); // Use auth context
        setSuccess(true);
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to create account');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <AuthRedirect>
        <div className="flex min-h-screen items-center justify-center bg-white p-6">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Account Created!</CardTitle>
              <CardDescription>
                Your EVM and NEAR wallets have been generated automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-gray-50 p-4">
                <Label className="text-sm font-medium">Your Auth Token:</Label>
                <div className="mt-2 rounded border bg-white p-2 font-mono text-xs break-all">
                  {token}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Save this token to your Downloads/ folder for Apple Shortcuts
                  access.
                </p>
              </div>
              <Link href="/dashboard">
                <Button className="w-full">View Your Wallet</Button>
              </Link>
              <Link href="/" className="block text-center">
                <Button variant="outline" className="w-full bg-transparent">
                  <ArrowLeft className="h-4 w-4" />
                  Back to Home
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </AuthRedirect>
    );
  }

  return (
    <AuthRedirect>
      <div className="flex min-h-screen items-center justify-center bg-white p-6">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Join 1Prime</CardTitle>
            <CardDescription className="mt-[-6px]">
              Start swapping tokens via voice.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-[-4px]">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  maxLength={10}
                  placeholder="6-10 characters"
                />
              </div>
              {error && (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Account
              </Button>
            </form>
            <div className="mt-6 text-center">
              <p className="text-sm text-gray-600">
                Already have an account?{' '}
                <Link
                  href="/auth/signin"
                  className="font-medium hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </div>
            <div className="mt-4 text-center">
              <Link href="/">
                <Button variant="outline" size="sm">
                  <ArrowLeft className="h-4 w-4" />
                  Back to Home
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </AuthRedirect>
  );
}
