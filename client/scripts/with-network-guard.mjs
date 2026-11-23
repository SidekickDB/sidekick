#!/usr/bin/env node
// SidekickDB: run a command with the network guard preloaded into every Node
// process it starts (see scripts/network-guard.cjs).
//
//   node scripts/with-network-guard.mjs <command> [args...]
//
// Exits non-zero if the command fails or if any process tried to reach a
// non-localhost host, even when the test that did it passed.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: with-network-guard.mjs <command> [args...]');
  process.exit(2);
}

const guardPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'network-guard.cjs',
);
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-netguard-'));
const logFile = path.join(logDir, 'violations.jsonl');

const env = {
  ...process.env,
  NODE_OPTIONS: [
    process.env.NODE_OPTIONS,
    `--require ${JSON.stringify(guardPath)}`,
  ]
    .filter(Boolean)
    .join(' '),
  SIDEKICK_NETWORK_GUARD_LOG: logFile,
};

const e2e = process.env.SIDEKICK_E2E_API_URI;
console.error(
  `[sidekick network-guard] enabled: only localhost${
    e2e ? ` and ${e2e}` : ''
  } may be contacted.${
    e2e ? '' : ' Networked suites are skipped (SIDEKICK_E2E_API_URI is unset).'
  }`,
);

const child = spawn(cmd, args, {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const forward = (signal) => child.kill(signal);
process.on('SIGINT', forward);
process.on('SIGTERM', forward);

child.on('exit', (code, signal) => {
  let violations = [];
  try {
    violations = fs
      .readFileSync(logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {}
  fs.rmSync(logDir, { recursive: true, force: true });

  if (violations.length > 0) {
    console.error(
      `\n[sidekick network-guard] FAILED: ${violations.length} blocked outbound attempt(s):`,
    );
    for (const v of violations) {
      console.error(
        `  - ${v.kind} to ${v.target} (pid ${v.pid}: ${v.argv.slice(1).join(' ')})`,
      );
    }
    process.exit(code || 1);
  }
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
