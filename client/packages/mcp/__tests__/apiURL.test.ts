import { afterEach, describe, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('MCP server URL configuration', () => {
  test('throws a clear error when no URL is configured', async () => {
    vi.stubEnv('INSTANT_API_URL', '');
    const { getApiURL } = await import('../src/tools.ts');
    expect(() => getApiURL()).toThrow(
      'No SidekickDB server URL configured. Pass --api-url to the MCP server or set the INSTANT_API_URL environment variable',
    );
  });

  test('treats a blank INSTANT_API_URL as unset', async () => {
    vi.stubEnv('INSTANT_API_URL', '   ');
    const { getApiURL } = await import('../src/tools.ts');
    expect(() => getApiURL()).toThrow(
      'No SidekickDB server URL configured. Pass --api-url to the MCP server or set the INSTANT_API_URL environment variable',
    );
  });

  test('treats a blank --api-url as unset', async () => {
    vi.stubEnv('INSTANT_API_URL', '');
    const { getApiURL, resolveApiURL, setApiURL } = await import(
      '../src/tools.ts'
    );
    expect(resolveApiURL('  ')).toBeUndefined();
    setApiURL('  ');
    expect(() => getApiURL()).toThrow('No SidekickDB server URL configured.');

    vi.stubEnv('INSTANT_API_URL', 'http://localhost:8888');
    expect(resolveApiURL('  ')).toBe('http://localhost:8888');
    expect(getApiURL()).toBe('http://localhost:8888');
  });

  test('reads INSTANT_API_URL', async () => {
    vi.stubEnv('INSTANT_API_URL', 'http://localhost:8888');
    const { getApiURL } = await import('../src/tools.ts');
    expect(getApiURL()).toBe('http://localhost:8888');
  });

  test('prefers the --api-url value', async () => {
    vi.stubEnv('INSTANT_API_URL', 'http://localhost:8888');
    const { getApiURL, setApiURL } = await import('../src/tools.ts');
    setApiURL('https://sidekick.example.com');
    expect(getApiURL()).toBe('https://sidekick.example.com');
  });
});
