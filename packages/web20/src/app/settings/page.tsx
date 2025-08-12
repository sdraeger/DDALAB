'use client';

import React from 'react';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { Footer } from '@/components/layout/Footer';
import { UserPreferences } from '@/components/settings/UserPreferences';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { useHeaderVisible, useFooterVisible } from '@/store/hooks';

export default function SettingsPage() {
	const headerVisible = useHeaderVisible();
	const footerVisible = useFooterVisible();

	return (
		<AuthProvider>
			<div className="min-h-screen w-full bg-background">
				<div className="flex h-screen">
					<Sidebar />
					<div className="flex flex-col flex-1 min-w-0">
						{headerVisible && <Header />}
						<main className="flex-1 overflow-auto">
							<div className="p-6">
								<div className="max-w-4xl mx-auto">
									<div className="mb-6">
										<h1 className="text-3xl font-bold">Settings</h1>
										<p className="text-muted-foreground">
											Manage your application preferences and settings
										</p>
									</div>
									<UserPreferences />
								</div>
							</div>
						</main>
						{footerVisible && <Footer />}
					</div>
				</div>
			</div>
		</AuthProvider>
	);
} 