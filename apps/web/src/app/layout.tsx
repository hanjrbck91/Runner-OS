import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Space_Mono, VT323 } from 'next/font/google';
import { ServiceWorkerRegister } from '../components/ServiceWorkerRegister.js';

// Self-hosted by Next (no external request, no FOIT fallback to Courier).
const spaceMono = Space_Mono({
  weight: ['400', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-space-mono',
});
const vt323 = VT323({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-vt323',
});

export const metadata: Metadata = {
  title: 'Runner OS',
  applicationName: 'Runner OS',
  description: 'Personal athletic operating system.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Runner OS', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#0b0c09',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceMono.variable} ${vt323.variable}`}>
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
