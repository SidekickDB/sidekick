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
            provider: playwright(),
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
