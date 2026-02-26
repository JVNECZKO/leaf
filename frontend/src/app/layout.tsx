import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { AppShell } from '@/components/layout/app-shell';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = {
  title: 'Leaf — Google Maps Lead Scraper',
  description: 'Unlimited Google Maps lead generation platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-bg-base text-text-primary antialiased">
        <Providers>
          <AppShell>
            {children}
          </AppShell>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: '#0D1220',
                color: '#F1F5F9',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: '10px',
                fontSize: '14px',
              },
              success: {
                iconTheme: { primary: '#10B981', secondary: '#0D1220' },
              },
              error: {
                iconTheme: { primary: '#EF4444', secondary: '#0D1220' },
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
