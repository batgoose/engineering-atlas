import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Navigation } from '@/components/navigation';
import { FrameworkSwitcher } from '@/components/framework-switcher';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
});

export const metadata: Metadata = {
  title: {
    default: 'Jason Booth | Engineering Atlas',
    template: '%s | Engineering Atlas',
  },
  description: 'A knowledge graph portfolio showcasing software engineering expertise.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} dark`}>
      <body>
        <Providers>
          <Navigation />
          <main>{children}</main>
          <FrameworkSwitcher />
        </Providers>
      </body>
    </html>
  );
}
