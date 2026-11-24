import { afterEach, describe, expect, test, vi } from 'vitest';
import { createResumableStreamContext } from '../../src/index.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resumable stream server URL configuration', () => {
  test('throws and names the env var when no URL is configured', () => {
    vi.stubEnv('INSTANT_API_URI', '');
    vi.stubEnv('SIDEKICK_API_URI', '');
    expect(() =>
      createResumableStreamContext({ appId: 'app-id', adminToken: 'token' }),
    ).toThrow(
      "No SidekickDB server URL configured. Pass `apiURI` to createResumableStreamContext() or set the SIDEKICK_API_URI environment variable, for example apiURI: 'https://sidekick.example.com'. SidekickDB has no default server.",
    );
  });

  test('treats a blank SIDEKICK_API_URI as unset', () => {
    vi.stubEnv('INSTANT_API_URI', '');
    vi.stubEnv('SIDEKICK_API_URI', '   ');
    expect(() =>
      createResumableStreamContext({ appId: 'app-id', adminToken: 'token' }),
    ).toThrow(
      "No SidekickDB server URL configured. Pass `apiURI` to createResumableStreamContext() or set the SIDEKICK_API_URI environment variable, for example apiURI: 'https://sidekick.example.com'. SidekickDB has no default server.",
    );
  });

  test('a blank SIDEKICK_API_URI does not hide INSTANT_API_URI', () => {
    vi.stubEnv('INSTANT_API_URI', 'https://sidekick.example.com');
    vi.stubEnv('SIDEKICK_API_URI', '   ');
    expect(() =>
      createResumableStreamContext({ appId: 'app-id', adminToken: 'token' }),
    ).not.toThrow();
  });

  test('names the app id and admin token variables when they are missing', () => {
    for (const name of [
      'SIDEKICK_APP_ID',
      'INSTANT_APP_ID',
      'NEXT_PUBLIC_SIDEKICK_APP_ID',
      'NEXT_PUBLIC_INSTANT_APP_ID',
      'SIDEKICK_APP_ADMIN_TOKEN',
      'INSTANT_APP_ADMIN_TOKEN',
    ]) {
      vi.stubEnv(name, '');
    }
    expect(() => createResumableStreamContext({ waitUntil: null })).toThrow(
      'SIDEKICK_APP_ID or NEXT_PUBLIC_SIDEKICK_APP_ID',
    );
    vi.stubEnv('INSTANT_APP_ID', 'old-app-id');
    expect(() => createResumableStreamContext({ waitUntil: null })).toThrow(
      'SIDEKICK_APP_ADMIN_TOKEN',
    );
  });
});
