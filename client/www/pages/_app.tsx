import '../styles/globals.css';
import '../styles/docs/tailwind.css';

import type { AppProps } from 'next/app';
import Script from 'next/script';
import { NuqsAdapter } from 'nuqs/adapters/next/pages';
import Head from 'next/head';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button } from '@/components/ui';
import { isDev, isSelfHosted } from '@/lib/config';
import { Dev } from '@/components/Dev';
import {
  patchFirefoxClicks,
  patchNumberInputScroll,
} from '@/lib/patchBrowserEvents';
import { ReactElement, ReactNode, useEffect } from 'react';
import { PostHogIdentify } from '@/components/PostHogIdentify';
import { NextPage } from 'next';
import { SWRConfig } from 'swr';
import { localStorageProvider } from '@/lib/swrCache';
import posthog from '@/lib/posthog';
import { PostHogProvider } from 'posthog-js/react';
import { BackupDownloadProvider } from '@/components/dash/BackupDownloadDialog';

declare global {
  function __getAppId(): any;
}

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: ReactElement) => ReactNode;
};

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
};

(globalThis as any)._nodevtool = true;

// hack to pass app ID to examples pages
globalThis.__getAppId = () =>
  typeof window !== 'undefined'
    ? (new URL(location.href).searchParams.get('__appId') ??
      localStorage.getItem('examples-appId'))
    : undefined;

function App({ Component, pageProps }: AppPropsWithLayout) {
  const getLayout = Component.getLayout ?? ((page) => page);

  const mainEl = getLayout(<Component {...pageProps} />);

  useEffect(() => {
    patchNumberInputScroll();
    return patchFirefoxClicks();
  }, []);

  return (
    <PostHogProvider client={posthog}>
      <AppHead />
      <PostHogIdentify />
      <ErrorBoundary renderError={() => <Oops />}>
        <SWRConfig
          value={{
            provider: localStorageProvider,
          }}
        >
          <NuqsAdapter>
            <BackupDownloadProvider>{mainEl}</BackupDownloadProvider>
          </NuqsAdapter>
        </SWRConfig>
      </ErrorBoundary>
      {!isDev && !isSelfHosted && <GoogleScripts />}
      {isDev ? <Dev /> : null}
    </PostHogProvider>
  );
}

// SidekickDB: no favicons or tiles until a SidekickDB mark is approved
// (Instant's stay in public/img/icon); the application name is SidekickDB.
function FavIconMeta() {
  return <meta name="application-name" content="SidekickDB" />;
}

function AppHead() {
  return (
    <Head>
      <FavIconMeta />
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1, maximum-scale=1"
      />
      <meta name="theme-color" content="#ffffff" />
      <meta key="og:type" property="og:type" content="website" />
    </Head>
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
        {
          /* js */ `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());

          gtag('config', 'G-45H27NT87Z');
        `
        }
      </Script>
    </>
  );
}

function Oops() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8">
      <div className="text-4xl">🙈</div>
      <p className="text-2xl font-bold text-gray-600">Oops!</p>
      <p>An unexpected error occurred. We're on it!</p>
      <Button type="link" href="/dash">
        Back to the dash
      </Button>
    </div>
  );
}

export default App;
