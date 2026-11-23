// Baseline measurement of the single-node self-hosted stack as shipped in
// self-hosting/docker-compose.yml. Meant for a disposable machine (the
// GitHub Actions workflow .github/workflows/sidekick-self-hosted-bench.yml):
// it builds images, starts and deletes containers and volumes.
//
//   node scripts/bench/self-hosted/run.mjs [--samples 5] [--idle-seconds 120]
//     [--out bench-out] [--skip-build]
//
// Each sample:
//   1. `docker compose down -v`, then `up -d` on fresh volumes (cold start);
//   2. polls until the server answers GET / (the compose healthcheck target)
//      and /health/system reports the WAL ok, and until compose reports the
//      server and dashboard healthy;
//   3. waits --idle-seconds, then records per-service memory (docker stats),
//      the server JVM's RSS, swap and thread count (/proc/1/status) and heap
//      (jcmd 1 GC.heap_info);
//   4. runs workload.mjs (live queries, writes, time to client-visible update);
//   5. waits 30 s and records memory again;
//   6. restarts the server container and times it back to GET / (warm restart).
//
// Writes <out>/results.json (environment, config, every sample) and, through
// summarize.mjs, <out>/summary.md. Exits 1 if a sample failed, including a
// workload that missed an update.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { summarize } from './summarize.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');

const { values: args } = parseArgs({
  options: {
    samples: { type: 'string', default: '5' },
    'idle-seconds': { type: 'string', default: '120' },
    'settle-seconds': { type: 'string', default: '30' },
    out: { type: 'string', default: path.join(root, 'bench-out') },
    'skip-build': { type: 'boolean', default: false },
    subscribers: { type: 'string', default: '5' },
    writes: { type: 'string', default: '100' },
    'interval-ms': { type: 'string', default: '100' },
  },
});

const samples = Number(args.samples);
if (!(samples >= 3)) {
  console.error('--samples must be at least 3: never report a single sample');
  process.exit(2);
}
const idleSeconds = Number(args['idle-seconds']);
const settleSeconds = Number(args['settle-seconds']);
const out = path.resolve(args.out);
fs.mkdirSync(out, { recursive: true });

const project = 'sidekickbench';
const serverImage = 'sidekick-bench/server:local';
const dashboardImage = 'sidekick-bench/dashboard:local';
const apiURI = 'http://127.0.0.1:8888';
const composeFiles = [
  path.join(root, 'self-hosting/docker-compose.yml'),
  path.join(here, 'compose.bench.yml'),
];
// Holds generated, throwaway secrets: kept out of <out>, which is uploaded.
const envFile = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-bench-')),
  'bench.env',
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

function log(...a) {
  console.error(`[bench ${new Date().toISOString()}]`, ...a);
}

function run(cmd, argv, opts = {}) {
  return execFileSync(cmd, argv, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}

function tryRun(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const dcArgs = [
  'compose',
  '-p',
  project,
  '--env-file',
  envFile,
  ...composeFiles.flatMap((f) => ['-f', f]),
];
const dc = (...a) => run('docker', [...dcArgs, ...a]);
const tryDc = (...a) => tryRun('docker', [...dcArgs, ...a]);

function containerId(service) {
  return dc('ps', '-a', '-q', service).trim();
}

// ---------------------------------------------------------------------------
// Environment

function environment() {
  const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
  const memTotalKb = Number(meminfo.match(/MemTotal:\s+(\d+)/)?.[1]);
  const cpuModel = fs
    .readFileSync('/proc/cpuinfo', 'utf8')
    .match(/model name\s*:\s*(.+)/)?.[1];
  const gitSha =
    process.env.GITHUB_SHA_UNDER_TEST ||
    tryRun('git', ['rev-parse', 'HEAD']).stdout.trim();
  return {
    commit: gitSha,
    measured_at: new Date().toISOString(),
    runner: {
      github_runner: process.env.RUNNER_NAME ?? null,
      runner_os: process.env.RUNNER_OS ?? null,
      runner_arch: process.env.RUNNER_ARCH ?? null,
      runner_environment: process.env.RUNNER_ENVIRONMENT ?? null,
      image_os: process.env.ImageOS ?? null,
      image_version: process.env.ImageVersion ?? null,
      labels: process.env.BENCH_RUNNER_LABEL ?? null,
      cpus: os.cpus().length,
      cpu_model: cpuModel ?? null,
      mem_total_mib: Math.round(memTotalKb / 1024),
      kernel: os.release(),
    },
    docker: tryRun('docker', [
      'version',
      '--format',
      '{{.Server.Version}}',
    ]).stdout.trim(),
    compose: tryRun('docker', ['compose', 'version', '--short']).stdout.trim(),
    node: process.version,
    github_run:
      process.env.GITHUB_RUN_ID &&
      `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  };
}

// ---------------------------------------------------------------------------
// Images

function buildImages() {
  const builds = {};
  for (const [name, image, context, dockerfile] of [
    ['server', serverImage, 'server', 'server/Dockerfile.self-hosted'],
    ['dashboard', dashboardImage, 'client', 'client/Dockerfile.www'],
  ]) {
    log(`building ${name} image`);
    const t0 = now();
    run('docker', ['build', '-t', image, '-f', dockerfile, context], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, DOCKER_BUILDKIT: '1' },
    });
    builds[name] = { seconds: Math.round((now() - t0) / 1000) };
  }
  return builds;
}

function imageInfo() {
  const info = {};
  dc('config', '--images')
    .trim()
    .split('\n')
    .filter(Boolean)
    .forEach((image) => {
      const r = tryRun('docker', [
        'image',
        'inspect',
        image,
        '--format',
        '{{.Id}} {{.Size}}',
      ]);
      const [id, size] = r.stdout.trim().split(' ');
      info[image] = r.ok
        ? { id, size_mib: Math.round(Number(size) / 1024 / 1024) }
        : { error: 'not present' };
    });
  return info;
}

// ---------------------------------------------------------------------------
// Environment file: self-hosting/.env.example with generated secrets.

function writeEnvFile() {
  const random = (bytes) =>
    run('openssl', ['rand', '-hex', String(bytes)]).trim();
  const lines = fs
    .readFileSync(path.join(root, 'self-hosting/.env.example'), 'utf8')
    .split('\n')
    .map((line) => {
      if (/^POSTGRES_PASSWORD=/.test(line))
        return `POSTGRES_PASSWORD=${random(32)}`;
      if (/^STORAGE_ACCESS_KEY=/.test(line))
        return `STORAGE_ACCESS_KEY=${random(16)}`;
      if (/^STORAGE_SECRET_KEY=/.test(line))
        return `STORAGE_SECRET_KEY=${random(32)}`;
      return line;
    });
  lines.push(
    `SERVER_IMAGE=${serverImage}`,
    `DASHBOARD_IMAGE=${dashboardImage}`,
  );
  fs.writeFileSync(envFile, lines.join('\n') + '\n', { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Probes

async function httpOk(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    const body = await res.text();
    return { ok: res.ok, body };
  } catch {
    return { ok: false, body: '' };
  }
}

function health(service) {
  const id = containerId(service);
  if (!id) return null;
  return tryRun('docker', [
    'inspect',
    '--format',
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
    id,
  ]).stdout.trim();
}

async function waitForStack(t0, timeoutMs = 360_000) {
  const marks = {};
  while (now() - t0 < timeoutMs) {
    const elapsed = now() - t0;
    if (marks.server_http_ms === undefined) {
      if ((await httpOk(`${apiURI}/`)).ok) marks.server_http_ms = elapsed;
    }
    if (marks.wal_ok_ms === undefined) {
      const h = await httpOk(`${apiURI}/health/system`);
      if (h.ok && /"wal"\s*:\s*"ok"/.test(h.body)) marks.wal_ok_ms = elapsed;
    }
    if (marks.server_healthy_ms === undefined && health('server') === 'healthy')
      marks.server_healthy_ms = elapsed;
    if (marks.www_healthy_ms === undefined && health('www') === 'healthy')
      marks.www_healthy_ms = elapsed;
    if (
      [
        'server_http_ms',
        'wal_ok_ms',
        'server_healthy_ms',
        'www_healthy_ms',
      ].every((k) => marks[k] !== undefined)
    )
      return marks;
    await sleep(250);
  }
  throw new Error(
    `stack not ready after ${timeoutMs} ms: ${JSON.stringify(marks)}`,
  );
}

// Seconds from the server container's start to the main server JVM's start
// ("Starting server..." is printed after the bootstrap JVM, which applies
// migrations and the OSS config, exits).
function serverBootPhases() {
  const id = containerId('server');
  const startedAt = Date.parse(
    run('docker', ['inspect', '--format', '{{.State.StartedAt}}', id]).trim(),
  );
  const logs = run('docker', ['logs', '--timestamps', id], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const line = logs.split('\n').find((l) => l.includes('Starting server...'));
  const at = line ? Date.parse(line.split(' ')[0]) : NaN;
  return {
    bootstrap_jvm_ms: Number.isFinite(at) ? at - startedAt : null,
  };
}

// ---------------------------------------------------------------------------
// Memory

function toMiB(s) {
  const m = s.trim().match(/^([\d.]+)\s*([KMGT]?i?B)$/i);
  if (!m) return null;
  const f = {
    b: 1 / 1024 / 1024,
    kib: 1 / 1024,
    kb: 1 / 1024,
    mib: 1,
    mb: 1,
    gib: 1024,
    gb: 1024,
    tib: 1024 * 1024,
  }[m[2].toLowerCase()];
  return Math.round(Number(m[1]) * f * 10) / 10;
}

function dockerStats() {
  const ids = dc('ps', '-q').trim().split('\n').filter(Boolean);
  const raw = run('docker', [
    'stats',
    '--no-stream',
    '--format',
    '{{json .}}',
    ...ids,
  ]);
  const byService = {};
  for (const line of raw.trim().split('\n').filter(Boolean)) {
    const s = JSON.parse(line);
    const service = s.Name.replace(`${project}-`, '').replace(/-\d+$/, '');
    byService[service] = {
      mem_mib: toMiB(s.MemUsage.split('/')[0]),
      mem_limit_mib: toMiB(s.MemUsage.split('/')[1]),
      cpu_percent: Number(String(s.CPUPerc).replace('%', '')),
      pids: Number(s.PIDs),
    };
  }
  return byService;
}

function serverProcess() {
  const id = containerId('server');
  const exec = (...a) => tryRun('docker', ['exec', id, ...a]);
  const status = exec('cat', '/proc/1/status').stdout;
  const kb = (k) => Number(status.match(new RegExp(`${k}:\\s+(\\d+)`))?.[1]);
  const heap = exec('jcmd', '1', 'GC.heap_info');
  const h = heap.stdout;
  const k2m = (x) => (x === undefined ? null : Math.round(Number(x) / 1024));
  const g1 = h.match(/total reserved (\d+)K, committed (\d+)K, used (\d+)K/);
  const meta = h.match(/Metaspace\s+used (\d+)K, committed (\d+)K/);
  const cmd = exec('cat', '/proc/1/cmdline').stdout.split('\0').join(' ');
  return {
    comm: exec('cat', '/proc/1/comm').stdout.trim(),
    rss_mib: k2m(kb('VmRSS')),
    rss_peak_mib: k2m(kb('VmHWM')),
    swap_mib: k2m(kb('VmSwap')),
    threads: kb('Threads'),
    heap_reserved_mib: k2m(g1?.[1]),
    heap_committed_mib: k2m(g1?.[2]),
    heap_used_mib: k2m(g1?.[3]),
    metaspace_used_mib: k2m(meta?.[1]),
    metaspace_committed_mib: k2m(meta?.[2]),
    jcmd_ok: heap.ok && !!g1,
    jcmd_error: heap.ok ? null : heap.stderr.trim().slice(0, 300),
    java_flags: cmd.slice(0, 1000),
  };
}

async function memorySnapshot() {
  // docker stats is a point-in-time value; take three, 2 s apart, and keep
  // the median per service.
  const runs = [];
  for (let i = 0; i < 3; i++) {
    runs.push(dockerStats());
    if (i < 2) await sleep(2000);
  }
  const services = {};
  for (const name of Object.keys(runs[0])) {
    const vals = runs.map((r) => r[name]).filter(Boolean);
    const med = (k) =>
      vals.map((v) => v[k]).sort((a, b) => a - b)[Math.floor(vals.length / 2)];
    services[name] = {
      mem_mib: med('mem_mib'),
      mem_limit_mib: vals[0].mem_limit_mib,
      cpu_percent: med('cpu_percent'),
      pids: med('pids'),
    };
  }
  return { services, server_jvm: serverProcess() };
}

// ---------------------------------------------------------------------------
// Workload

function workload() {
  const r = tryRun(
    process.execPath,
    [
      path.join(here, 'workload.mjs'),
      '--api',
      apiURI,
      '--subscribers',
      args.subscribers,
      '--writes',
      args.writes,
      '--interval-ms',
      args['interval-ms'],
    ],
    { timeout: 180_000 },
  );
  const line = r.stdout.trim().split('\n').filter(Boolean).at(-1);
  let parsed = null;
  try {
    parsed = JSON.parse(line);
  } catch {}
  if (!r.ok || !parsed) {
    throw new Error(
      `workload failed: ${r.stderr.trim().slice(-2000)} ${r.stdout.slice(-500)}`,
    );
  }
  return parsed;
}

// ---------------------------------------------------------------------------

function saveLogs(label) {
  const r = tryDc('logs', '--timestamps', '--no-color');
  fs.writeFileSync(path.join(out, `logs-${label}.txt`), r.stdout + r.stderr);
}

async function sample(n) {
  log(`sample ${n}: down -v`);
  tryDc('down', '-v', '--remove-orphans');
  const t0 = now();
  dc('up', '-d');
  const upReturnedMs = now() - t0;
  const marks = await waitForStack(t0);
  log(`sample ${n}: ready`, JSON.stringify(marks));
  const phases = serverBootPhases();

  log(`sample ${n}: idle ${idleSeconds} s`);
  await sleep(idleSeconds * 1000);
  const idle = await memorySnapshot();

  log(`sample ${n}: workload`);
  const work = workload();
  log(
    `sample ${n}: visible p50 ${work.visible_ms.p50} ms, p95 ${work.visible_ms.p95} ms`,
  );

  await sleep(settleSeconds * 1000);
  const after = await memorySnapshot();

  log(`sample ${n}: restart server`);
  const r0 = now();
  dc('restart', 'server');
  while (!(await httpOk(`${apiURI}/`)).ok) {
    if (now() - r0 > 300_000) throw new Error('server did not come back');
    await sleep(250);
  }
  const restartMs = now() - r0;

  return {
    sample: n,
    cold_start: { up_returned_ms: upReturnedMs, ...marks, ...phases },
    idle,
    workload: work,
    after_workload: after,
    warm_restart_ms: restartMs,
  };
}

const config = {
  samples,
  idle_seconds: idleSeconds,
  settle_seconds: settleSeconds,
  subscribers: Number(args.subscribers),
  writes: Number(args.writes),
  interval_ms: Number(args['interval-ms']),
  compose_files: composeFiles.map((f) => path.relative(root, f)),
};

const results = { environment: environment(), config, samples: [] };
log('environment', JSON.stringify(results.environment));

writeEnvFile();
if (!args['skip-build']) results.builds = buildImages();
log('pulling images');
dc('pull', '--ignore-buildable', '--ignore-pull-failures', '--quiet');
results.images = imageInfo();

let failed = false;
for (let n = 1; n <= samples; n++) {
  try {
    results.samples.push(await sample(n));
  } catch (e) {
    failed = true;
    log(`sample ${n} failed:`, e.message);
    results.samples.push({ sample: n, error: e.message });
    saveLogs(`sample-${n}`);
  }
  fs.writeFileSync(
    path.join(out, 'results.json'),
    JSON.stringify(results, null, 2),
  );
}
saveLogs('last');
tryDc('down', '-v', '--remove-orphans');
fs.rmSync(envFile, { force: true });

fs.writeFileSync(path.join(out, 'summary.md'), summarize(results));
log(`wrote ${out}/results.json and ${out}/summary.md`);
process.exit(failed ? 1 : 0);
