import { afterEach, describe, expect, test, vi } from 'vitest';
import { createResumableStreamContext } from '../../src/index.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resumable stream server URL configuration', () => {
  test('throws and names the env var when no URL is configured', () => {
    vi.stubEnv('INSTANT_API_URI', '');
    expect(() =>
      createResumableStreamContext({ appId: 'app-id', adminToken: 'token' }),
    ).toThrow(
      "No SidekickDB server URL configured. Pass `apiURI` to createResumableStreamContext() or set the INSTANT_API_URI environment variable, for example apiURI: 'https://sidekick.example.com'. SidekickDB has no default server.",
    );
  });
});
