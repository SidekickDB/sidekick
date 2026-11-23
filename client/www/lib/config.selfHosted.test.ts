import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadConfig(selfHosted: boolean) {
  vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', selfHosted ? 'true' : '');
  vi.resetModules();
  return import('./config');
}

test('self-hosted dashboards offer Google sign-in only when configured', async () => {
  const { isDashboardGoogleOAuthEnabled } = await loadConfig(true);
  expect(isDashboardGoogleOAuthEnabled(undefined)).toBe(false);
  expect(isDashboardGoogleOAuthEnabled({})).toBe(false);
  expect(isDashboardGoogleOAuthEnabled({ dashboardGoogleOAuth: false })).toBe(
    false,
  );
  expect(isDashboardGoogleOAuthEnabled({ dashboardGoogleOAuth: true })).toBe(
    true,
  );
});

test('the hosted dashboard always offers Google sign-in', async () => {
  const { isDashboardGoogleOAuthEnabled } = await loadConfig(false);
  expect(isDashboardGoogleOAuthEnabled(undefined)).toBe(true);
});
