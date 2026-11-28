import '../styles/globals.css';
import '../styles/docs/tailwind.css';

import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Providers } from './providers';
import { isSelfHosted } from '@/lib/config';

const isDev = process.env.NODE_ENV === 'development';

// SidekickDB: metadataBase no longer falls back to Instant's site (unset
// outside Vercel and dev, as in the self-hosted image), the name is SidekickDB,
// and no icons are linked until a SidekickDB mark is approved.
export const metadata: Metadata = {
  metadataBase: process.env.NEXT_PUBLIC_VERCEL_URL
    ? new URL(`https://${process.env.NEXT_PUBLIC_VERCEL_URL}`)
    : isDev
      ? new URL(`http://localhost:${process.env.PORT || 3000}`)
      : undefined,
  applicationName: 'SidekickDB',
  openGraph: {
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#ffffff',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preload"
          href="/fonts/Switzer-Regular.woff"
          as="font"
          type="font/woff"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/Switzer-Medium.woff"
          as="font"
          type="font/woff"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/Switzer-Semibold.woff"
          as="font"
          type="font/woff"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/Switzer-Bold.woff"
          as="font"
          type="font/woff"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/Switzer-Italic.woff"
          as="font"
          type="font/woff"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        {isSelfHosted && (
          <Script
            src="/publicSelfHostedVariables.js"
            strategy="beforeInteractive"
          />
        )}
        <Providers>{children}</Providers>
        {!isDev && !isSelfHosted && <GoogleScripts />}
      </body>
    </html>
  );
}

function GoogleScripts() {
  return (
    <>
      <Script
        src="https://www.googletagmanager.com/gtag/js?id=G-45H27NT87Z"
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-45H27NT87Z');
        `}
      </Script>
    </>
  );
}
