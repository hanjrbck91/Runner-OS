import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ServiceWorkerRegister } from '../components/ServiceWorkerRegister.js';

export const metadata: Metadata = {
  title: 'Runner OS',
  applicationName: 'Runner OS',
  description: 'Personal athletic operating system.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Runner OS', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#0f120d',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
