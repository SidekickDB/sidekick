import { execFile } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, '../../dist/index.js');

// SidekickDB: networked suite. It runs only against the backend named by
// SIDEKICK_E2E_API_URI and is skipped when that is unset; there is no default.
export const apiUrl = process.env.SIDEKICK_E2E_API_URI
  ? new URL(process.env.SIDEKICK_E2E_API_URI).href.replace(/\/+$/, '')
  : undefined;
if (!apiUrl) {
  console.warn(
    '[sidekick] Skipping create-sidekick-app e2e: set SIDEKICK_E2E_API_URI to a SidekickDB server URL to run it.',
  );
}

const sandboxHomeDir = join(tmpdir(), 'create-sidekick-app-e2e-home');

export type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/**
 * Run `create-sidekick-app` with the given args inside a fresh temp directory.
 */
export function runCreateInstantApp(
  args: string[],
  opts: {
    env?: Record<string, string>;
    cwd?: string;
    timeout?: number;
  } = {},
): Promise<CliResult> {
  const finalArgs = args;

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...finalArgs],
      {
        env: {
          ...process.env,
          INSTANT_CLI_API_URI: apiUrl ?? '',
          // Prevent reading real auth / dotenv
          DOTENV_CONFIG_PATH: '/dev/null',
          INSTANT_CLI_AUTH_TOKEN: '',
          HOME: sandboxHomeDir,
          XDG_CONFIG_HOME: join(sandboxHomeDir, '.config'),
          XDG_DATA_HOME: join(sandboxHomeDir, '.local', 'share'),
          // Don't open browser
          BROWSER: 'echo',
          ...opts.env,
        },
        cwd: opts.cwd,
        timeout: opts.timeout ?? 120_000,
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() ?? '',
          stderr: stderr?.toString() ?? '',
          exitCode: error
            ? typeof error.code === 'number'
              ? error.code
              : 1
            : 0,
        });
      },
    );
  });
}

export type TestDir = {
  dir: string;
  cleanup: () => Promise<void>;
};

/**
 * Create a temporary directory to run `create-sidekick-app` in.
 * The scaffolded project will appear as a subdirectory inside `dir`.
 */
export async function createTestDir(): Promise<TestDir> {
  const dir = await mkdtemp(join(tmpdir(), 'cia-e2e-'));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
