import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// SidekickDB: the browser e2e project creates apps on a real backend. It is
// included only when SIDEKICK_E2E_API_URI names that backend; there is no
// default host.
const e2eApiURI = process.env.SIDEKICK_E2E_API_URI
  ? new URL(process.env.SIDEKICK_E2E_API_URI).href.replace(/\/+$/, '')
  : undefined;
if (!e2eApiURI) {
  console.warn(
    '[sidekick] Skipping core e2e (browser) project: set SIDEKICK_E2E_API_URI to a SidekickDB server URL to run it.',
  );
}

// SidekickDB: the Node network guard does not cover the browser, so Chromium
// gets resolver rules: every host name except localhost and the e2e host fails
// to resolve. IP literals are not resolved and so are not covered.
const e2eHost = e2eApiURI ? new URL(e2eApiURI).hostname : '';
// Like the Node guard, never allow instantdb.com, even when named explicitly:
// the browser would otherwise create apps on it unseen by that guard.
const normalizedE2EHost = e2eHost.toLowerCase().replace(/\.$/, '');
if (
  normalizedE2EHost === 'instantdb.com' ||
  normalizedE2EHost.endsWith('.instantdb.com')
) {
  throw new Error(
    'SIDEKICK_E2E_API_URI must not point at instantdb.com; use a SidekickDB server.',
  );
}
const hostResolverRules = [
  'MAP * ~NOTFOUND',
  'EXCLUDE localhost',
  ...(e2eHost && !/^[\d.]+$|^\[/.test(e2eHost) ? [`EXCLUDE ${e2eHost}`] : []),
].join(', ');

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        define: {
          __SIDEKICK_E2E_API_URI__: JSON.stringify(e2eApiURI ?? ''),
        },
        test: {
          name: 'e2e',
          include: ['**/**.e2e.test.ts'],
          expect: {
            poll: {
              timeout: 10_000,
            },
          },
          browser: {
            enabled: true,
            provider: playwright({
              launchOptions: {
                args: [`--host-resolver-rules=${hostResolverRules}`],
              },
            }),
            screenshotFailures: false,
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        test: {
          name: 'node',
          include: ['**/**.test.ts'],
          exclude: ['**/**.e2e.test.{ts,js}'],
        },
      },
    ].filter((project) => e2eApiURI || project.test?.name !== 'e2e'),
  },
});
