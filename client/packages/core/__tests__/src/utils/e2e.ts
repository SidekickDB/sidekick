import { test as baseTest } from 'vitest';
import {
  init,
  InstantConfig,
  InstantCoreDatabase,
  InstantRules,
  InstantSchemaDef,
} from '../../../src';
import { worker } from './msw';

// SidekickDB: __SIDEKICK_E2E_API_URI__ is set by vitest.config.ts from
// SIDEKICK_E2E_API_URI. The e2e project only runs when it is set; there is no
// default host.
declare const __SIDEKICK_E2E_API_URI__: string;

if (!__SIDEKICK_E2E_API_URI__) {
  throw new Error(
    'core e2e tests need SIDEKICK_E2E_API_URI set to a SidekickDB server URL',
  );
}

const apiUrl = __SIDEKICK_E2E_API_URI__;

const websocketURI = `${apiUrl.replace(/^http/, 'ws')}/runtime/session`;

// Make a factory function that returns a typed test instance
export function makeE2ETest<Schema extends InstantSchemaDef<any, any, any>>({
  schema,
  rules,
  config,
}: {
  schema?: Schema;
  rules?: {
    code: InstantRules;
  };
  config?: Partial<InstantConfig<Schema, any>>;
}) {
  return baseTest.extend<{
    db: InstantCoreDatabase<Schema, false>;
    appId: string;
    adminToken: string;
    worker: typeof worker;
  }>({
    db: async ({ task, signal }, use) => {
      const response = await fetch(`${apiUrl}/dash/apps/ephemeral`, {
        body: JSON.stringify({ title: `e2e-${task.id}`, schema, rules }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const { app } = await response.json();
      const db = init<Schema>({
        ...config,
        appId: app.id,
        apiURI: apiUrl,
        websocketURI,
        schema,
        // SidekickDB: never load the devtool iframe from a dashboard host.
        devtool: false,
      });
      (db as any)._testApp = app;
      await use(db);
    },
    appId: async ({ db }, use) => {
      await use((db as any)._testApp.id);
    },
    adminToken: async ({ db }, use) => {
      await use((db as any)._testApp['admin-token']);
    },
    // https://mswjs.io/docs/integrations/browser
    worker: [
      async ({}, use) => {
        // Start the worker before the test.
        await worker.start({ quiet: true });

        // Expose the worker object on the test's context.
        await use(worker);

        // Remove any request handlers added in individual test cases.
        // This prevents them from affecting unrelated tests.
        worker.resetHandlers();
      },
      {
        auto: true,
      },
    ],
  });
}

export { apiUrl };

export const e2eTest = makeE2ETest({});
