import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { StoreProvider } from '@/store/providers/StoreProvider';
import { Providers } from '@/components/providers/Providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
	title: 'DDALAB Dashboard',
	description: 'Modern dashboard with modular state management',
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<body className={inter.className}>
				<StoreProvider>
					<Providers>
						{children}
					</Providers>
				</StoreProvider>
			</body>
		</html>
	);
}
