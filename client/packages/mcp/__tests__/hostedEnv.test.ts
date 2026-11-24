import { afterEach, describe, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

// Starting the module runs the hosted (SSE) server, which reads
// INSTANT_API_URL first and exits when it is missing.
async function startHosted(apiURL: string) {
  vi.stubEnv('SERVER_TYPE', 'http');
  vi.stubEnv('HONEYCOMB_API_KEY', '');
  vi.stubEnv('INSTANT_API_URL', apiURL);
  const exited = new Promise<void>((resolve) => {
    vi.spyOn(process, 'exit').mockImplementation((() => {
      resolve();
    }) as typeof process.exit);
  });
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('../src/index.ts');
  await exited;
  return error.mock.calls.flat().map(String).join('\n');
}

describe('MCP hosted server configuration', () => {
  test('fails when INSTANT_API_URL is missing', async () => {
    expect(await startHosted('')).toContain(
      'Missing environment variable INSTANT_API_URL',
    );
  });

  test('fails the same way when INSTANT_API_URL is blank', async () => {
    expect(await startHosted('   ')).toContain(
      'Missing environment variable INSTANT_API_URL',
    );
  });
});
