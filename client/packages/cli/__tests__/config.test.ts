import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readInstantConfigFile: vi.fn(),
}));

vi.mock('../src/util/instantConfig.ts', () => ({
  readInstantConfigFile: mocks.readInstantConfigFile,
}));

import {
  getBaseUrl,
  getDashUrl,
  getOAuthCallbackUrl,
  getOptionalDashUrl,
  missingApiUrlMessage,
  missingDashUrlMessage,
} from '../src/lib/config.ts';

beforeEach(() => {
  vi.stubEnv('INSTANT_CLI_API_URI', undefined);
  vi.stubEnv('INSTANT_CLI_DASH_URI', undefined);
  vi.stubEnv('INSTANT_CLI_DEV', undefined);
  mocks.readInstantConfigFile.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('dashboard URL configuration', () => {
  it('reads dashURI from instant.config.ts', async () => {
    mocks.readInstantConfigFile.mockResolvedValue({
      dashURI: 'https://dash.instant.example',
    });

    await expect(Effect.runPromise(getDashUrl)).resolves.toBe(
      'https://dash.instant.example',
    );
  });

  it('prefers INSTANT_CLI_DASH_URI over instant.config.ts', async () => {
    vi.stubEnv('INSTANT_CLI_DASH_URI', 'https://dash.env.example');
    mocks.readInstantConfigFile.mockResolvedValue({
      dashURI: 'https://dash.config.example',
    });

    await expect(Effect.runPromise(getDashUrl)).resolves.toBe(
      'https://dash.env.example',
    );
  });
});

describe('OAuth callback URL configuration', () => {
  it('uses the configured API URL', async () => {
    vi.stubEnv('INSTANT_CLI_API_URI', 'https://api.instant.example/');

    await expect(Effect.runPromise(getOAuthCallbackUrl)).resolves.toBe(
      'https://api.instant.example/runtime/oauth/callback',
    );
  });
});

describe('API URL configuration', () => {
  it('fails with a clear error when no API URL is configured', async () => {
    await expect(Effect.runPromise(getBaseUrl)).rejects.toThrow(
      missingApiUrlMessage,
    );
    expect(missingApiUrlMessage).toContain('INSTANT_CLI_API_URI');
    expect(missingApiUrlMessage).toContain('instant.config.ts');
  });

  it('uses INSTANT_CLI_API_URI unchanged', async () => {
    vi.stubEnv('INSTANT_CLI_API_URI', 'https://api.env.example/');

    await expect(Effect.runPromise(getBaseUrl)).resolves.toBe(
      'https://api.env.example/',
    );
  });

  it('reads apiURI from instant.config.ts', async () => {
    mocks.readInstantConfigFile.mockResolvedValue({
      apiURI: 'https://api.config.example',
    });

    await expect(Effect.runPromise(getBaseUrl)).resolves.toBe(
      'https://api.config.example',
    );
  });

  it('uses the local server in CLI dev mode', async () => {
    vi.stubEnv('INSTANT_CLI_DEV', 'true');

    await expect(Effect.runPromise(getBaseUrl)).resolves.toBe(
      'http://localhost:8888',
    );
  });
});

describe('dashboard URL without configuration', () => {
  it('fails with a clear error when no dashboard URL is configured', async () => {
    await expect(Effect.runPromise(getDashUrl)).rejects.toThrow(
      missingDashUrlMessage,
    );
    expect(missingDashUrlMessage).toContain('INSTANT_CLI_DASH_URI');
  });

  it('returns none from getOptionalDashUrl', async () => {
    const dashUrl = await Effect.runPromise(getOptionalDashUrl);
    expect(dashUrl._tag).toBe('None');
  });

  it('uses the local dashboard in CLI dev mode', async () => {
    vi.stubEnv('INSTANT_CLI_DEV', 'true');

    await expect(Effect.runPromise(getDashUrl)).resolves.toBe(
      'http://localhost:3000',
    );
  });
});
