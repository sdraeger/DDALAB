'use client';

import React, { useState } from 'react';
import { useAppDispatch, useAuthLoading, useAuthError } from '@/store/hooks';
import { login, clearError } from '@/store/slices/authSlice';
import { Button, Input, Label, Card, CardContent, CardDescription, CardHeader, CardTitle, Alert, AlertDescription } from '@/components/ui';
import { Loader2 } from 'lucide-react';

interface LoginFormProps {
	onSuccess?: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
	const dispatch = useAppDispatch();
	const isLoading = useAuthLoading();
	const error = useAuthError();

	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!username || !password) {
			return;
		}

		try {
			await dispatch(login({ username, password })).unwrap();
			onSuccess?.();
		} catch (error) {
			// Error is handled by the slice
		}
	};

	const handleInputChange = () => {
		if (error) {
			dispatch(clearError());
		}
	};

	return (
		<div className="flex items-center justify-center min-h-screen bg-background">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>Login to DDALAB</CardTitle>
					<CardDescription>
						Enter your credentials to access the dashboard
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="space-y-4">
						{error && (
							<Alert variant="destructive">
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						)}

						<div className="space-y-2">
							<Label htmlFor="username">Username</Label>
							<Input
								id="username"
								type="text"
								value={username}
								onChange={(e) => {
									setUsername(e.target.value);
									handleInputChange();
								}}
								placeholder="Enter your username"
								disabled={isLoading}
								required
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="password">Password</Label>
							<Input
								id="password"
								type="password"
								value={password}
								onChange={(e) => {
									setPassword(e.target.value);
									handleInputChange();
								}}
								placeholder="Enter your password"
								disabled={isLoading}
								required
							/>
						</div>

						<Button type="submit" className="w-full" disabled={isLoading}>
							{isLoading ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Logging in...
								</>
							) : (
								'Login'
							)}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
} 