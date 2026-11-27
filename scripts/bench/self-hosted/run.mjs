// Baseline measurement of the single-node self-hosted stack as shipped in
// self-hosting/docker-compose.yml. Meant for a disposable machine (the
// GitHub Actions workflow .github/workflows/sidekick-self-hosted-bench.yml):
// it builds images, starts and deletes containers and volumes.
//
//   node scripts/bench/self-hosted/run.mjs [--samples 3]
//     [--modes default,self-hosted] [--idle-seconds 120] [--out bench-out]
//     [--skip-build]
//
// --modes lists runtime modes (SIDEKICK_RUNTIME_MODE). With more than one,
// the samples alternate between them in one job, on the same images and
// machine, and --samples is per mode (at least 3 each).
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
//   6. runs smoke.mjs (response headers, presence, streams, SSE, dashboard
//      login, file upload, on-demand backup) for the mode;
//   7. restarts the server container and times it back to GET / (warm restart).
//
// From the server log of each cold start it also records the start-up phases
// (container start, "Starting server...", first init step, "Finished
// initializing") and the duration of every init.finish.<step> span, plus the
// init.skip.<step> lines.
//
// Writes <out>/results.json (environment, config, every sample) and, through
// summarize.mjs, <out>/summary.md. Exits 1 if a sample failed, including a
// workload that missed an update.

import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
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
    samples: { type: 'string', default: '3' },
    modes: { type: 'string', default: 'self-hosted' },
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
const modes = args.modes
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
if (
  !modes.length ||
  modes.some((m) => !['self-hosted', 'default'].includes(m))
) {
  console.error('--modes takes self-hosted and/or default, comma-separated');
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
// Hold generated, throwaway secrets: kept out of <out>, which is uploaded.
// One file per runtime mode; envFile is the one the next command uses.
const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-bench-'));
const baseEnvFile = path.join(envDir, 'bench.env');
let envFile = baseEnvFile;
const envFileFor = (mode) => path.join(envDir, `bench-${mode}.env`);

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

const dcArgs = () => [
  'compose',
  '-p',
  project,
  '--env-file',
  envFile,
  ...composeFiles.flatMap((f) => ['-f', f]),
];
const dc = (...a) => run('docker', [...dcArgs(), ...a]);
const tryDc = (...a) => tryRun('docker', [...dcArgs(), ...a]);

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
    builds[name] = {
      seconds: Math.round((now() - t0) / 1000),
      image_id: localImageId(image),
    };
  }
  return builds;
}

function localImageId(image) {
  const r = tryRun('docker', [
    'image',
    'inspect',
    image,
    '--format',
    '{{.Id}}',
  ]);
  if (!r.ok) throw new Error(`image ${image} is not present locally`);
  return r.stdout.trim();
}

// The server and dashboard images are built locally and must never come from
// a registry: their tags would resolve to docker.io/sidekick-bench/..., a
// namespace anyone could register. Only the services that use published
// images are pulled, `up` runs with --pull never, and every sample checks
// that the containers run exactly the images built from the commit under
// test.
const registryServices = ['postgres', 'storage', 'createbuckets'];
const localImages = {};

function assertLocalImages() {
  for (const [service, image] of [
    ['server', serverImage],
    ['www', dashboardImage],
  ]) {
    const id = containerId(service);
    const running = run('docker', [
      'inspect',
      '--format',
      '{{.Image}}',
      id,
    ]).trim();
    if (running !== localImages[image]) {
      throw new Error(
        `${service} runs ${running}, not the image built for this run (${image} ${localImages[image]})`,
      );
    }
  }
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
  const secrets = {};
  const lines = fs
    .readFileSync(path.join(root, 'self-hosting/.env.example'), 'utf8')
    .split('\n')
    .map((line) => {
      for (const [name, bytes] of [
        ['POSTGRES_PASSWORD', 32],
        ['STORAGE_ACCESS_KEY', 16],
        ['STORAGE_SECRET_KEY', 32],
      ]) {
        if (line.startsWith(`${name}=`)) {
          secrets[name] = random(bytes);
          return `${name}=${secrets[name]}`;
        }
      }
      return line;
    });
  lines.push(
    `SERVER_IMAGE=${serverImage}`,
    `DASHBOARD_IMAGE=${dashboardImage}`,
  );
  fs.writeFileSync(envFile, lines.join('\n') + '\n', { mode: 0o600 });

  // The env file as a user would write it from .env.example. Some Compose
  // versions reject it: the compose files read the storage keys as
  // ${STORAGE_ACCESS_KEY:-${MINIO_ROOT_USER:?...}}, and if Compose evaluates
  // the inner :? even when STORAGE_ACCESS_KEY is set, it stops with
  // "required variable MINIO_ROOT_USER is missing a value". Record that, and
  // then also set the old names to the same values so the run can go on.
  const check = tryDc('config', '--quiet');
  if (check.ok) return writeModeEnvFiles({ as_shipped_env_accepted: true });
  fs.appendFileSync(
    envFile,
    `MINIO_ROOT_USER=${secrets.STORAGE_ACCESS_KEY}\n` +
      `MINIO_ROOT_PASSWORD=${secrets.STORAGE_SECRET_KEY}\n`,
  );
  const retry = tryDc('config', '--quiet');
  if (!retry.ok) {
    throw new Error(`compose config failed: ${retry.stderr.trim()}`);
  }
  log(
    'compose rejected the env file written from .env.example; set MINIO_ROOT_USER/MINIO_ROOT_PASSWORD too',
  );
  return writeModeEnvFiles({
    as_shipped_env_accepted: false,
    as_shipped_env_error: check.stderr.trim().slice(0, 500),
    workaround:
      'MINIO_ROOT_USER and MINIO_ROOT_PASSWORD set to the STORAGE_* values',
  });
}

// The base file plus SIDEKICK_RUNTIME_MODE, one per mode. The compose files
// default to self-hosted; setting it explicitly records what each sample ran.
function writeModeEnvFiles(result) {
  const base = fs.readFileSync(baseEnvFile, 'utf8');
  for (const mode of modes) {
    fs.writeFileSync(
      envFileFor(mode),
      base + `SIDEKICK_RUNTIME_MODE=${mode}\n`,
      {
        mode: 0o600,
      },
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Probes

const execFileAsync = promisify(execFile);

async function httpOk(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    const body = await res.text();
    return { ok: res.ok, body };
  } catch {
    return { ok: false, body: '' };
  }
}

async function healthAsync(service) {
  try {
    const { stdout: id } = await execFileAsync('docker', [
      ...dcArgs(),
      'ps',
      '-a',
      '-q',
      service,
    ]);
    if (!id.trim()) return null;
    const { stdout } = await execFileAsync('docker', [
      'inspect',
      '--format',
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
      id.trim(),
    ]);
    return stdout.trim();
  } catch {
    return null;
  }
}

// Polls one condition every 250 ms and returns the ms from t0 at which a
// check that succeeded completed. Each signal has its own poller, so a slow
// check cannot delay another signal's timestamp.
async function pollUntil(t0, check, timeoutMs, stop = { stopped: false }) {
  while (now() - t0 < timeoutMs && !stop.stopped) {
    if (await check()) return now() - t0;
    await sleep(250);
  }
  return null;
}

// `docker compose up -d` itself waits for depends_on conditions (the
// dashboard waits for a healthy server), so it is started without waiting,
// and the pollers run from the same t0.
async function startStack(timeoutMs = 360_000) {
  const t0 = now();
  const up = spawn('docker', [...dcArgs(), 'up', '-d', '--pull', 'never'], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let upStderr = '';
  up.stderr.on('data', (d) => (upStderr += d));
  // If up -d fails, stop the pollers at once instead of waiting them out.
  const stop = { stopped: false };
  const upDone = new Promise((resolve) =>
    up.on('close', (code) => {
      if (code !== 0) stop.stopped = true;
      resolve({ code, ms: now() - t0 });
    }),
  );
  const [serverHttp, walOk, serverHealthy, wwwHealthy, upResult] =
    await Promise.all([
      pollUntil(
        t0,
        async () => (await httpOk(`${apiURI}/`)).ok,
        timeoutMs,
        stop,
      ),
      pollUntil(
        t0,
        async () => {
          const h = await httpOk(`${apiURI}/health/system`);
          return h.ok && /"wal"\s*:\s*"ok"/.test(h.body);
        },
        timeoutMs,
        stop,
      ),
      pollUntil(
        t0,
        async () => (await healthAsync('server')) === 'healthy',
        timeoutMs,
        stop,
      ),
      pollUntil(
        t0,
        async () => (await healthAsync('www')) === 'healthy',
        timeoutMs,
        stop,
      ),
      upDone,
    ]);
  const marks = {
    up_returned_ms: upResult.ms,
    server_http_ms: serverHttp,
    wal_ok_ms: walOk,
    server_healthy_ms: serverHealthy,
    www_healthy_ms: wwwHealthy,
  };
  if (upResult.code !== 0) {
    throw new Error(
      `docker compose up -d exited ${upResult.code}: ${upStderr.slice(-1500)}`,
    );
  }
  if (Object.values(marks).some((v) => v === null)) {
    throw new Error(
      `stack not ready after ${timeoutMs} ms: ${JSON.stringify(marks)} ${upStderr.slice(-1000)}`,
    );
  }
  return marks;
}

// Start-up phases and init steps from the server log of the current start:
// container start, "Starting server..." (after the bootstrap JVM, which
// applies migrations and the OSS config), the first init step, and
// "Finished initializing"; plus every init.finish.<step> duration and the
// init.skip.<step> lines (the tracer prints them as "<ms>ms [init.finish.x]").
const ANSI = /\x1b\[[0-9;]*m/g;

function serverBootPhases() {
  const id = containerId('server');
  const startedAt = Date.parse(
    run('docker', ['inspect', '--format', '{{.State.StartedAt}}', id]).trim(),
  );
  const lines = run('docker', ['logs', '--timestamps', id], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .replace(ANSI, '')
    .split('\n');
  const at = (pred) => {
    const line = lines.find(pred);
    const t = line ? Date.parse(line.split(' ')[0]) : NaN;
    return Number.isFinite(t) ? t : null;
  };
  const serverJvm = at((l) => l.includes('Starting server...'));
  const firstInit = at((l) => /\[init\.(start|skip)\./.test(l));
  const finished = at((l) => l.includes('Finished initializing'));
  const steps = {};
  const skipped = [];
  for (const l of lines) {
    const m = l.match(
      /(\d+(?:\.\d+)?)ms \[init\.(finish|skip)\.([a-z0-9-]+)\]/,
    );
    if (!m) continue;
    if (m[2] === 'skip') skipped.push(m[3]);
    else steps[m[3]] = Number(m[1]);
  }
  const diff = (a, b) => (a !== null && b !== null ? a - b : null);
  return {
    bootstrap_jvm_ms: diff(serverJvm, startedAt),
    server_jvm_to_first_init_ms: diff(firstInit, serverJvm),
    init_steps_ms: diff(finished, firstInit),
    container_to_initialized_ms: diff(finished, startedAt),
    init_finish_ms: steps,
    init_skipped: [...new Set(skipped)],
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
    jcmd_ok: heap.ok && !!g1,
    jcmd_error: heap.ok ? null : heap.stderr.trim().slice(0, 300),
    heap_info_raw: h.slice(0, 1500),
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

function smoke(mode) {
  const r = tryRun(
    process.execPath,
    [
      '--experimental-eventsource',
      path.join(here, 'smoke.mjs'),
      '--api',
      apiURI,
      '--mode',
      mode,
      '--server-container',
      containerId('server'),
    ],
    { timeout: 180_000 },
  );
  const line = r.stdout.trim().split('\n').filter(Boolean).at(-1);
  try {
    return JSON.parse(line);
  } catch {
    return {
      mode,
      ok: false,
      error: `${r.stderr.trim().slice(-1500)} ${r.stdout.slice(-300)}`,
    };
  }
}

// ---------------------------------------------------------------------------

function saveLogs(label) {
  const r = tryDc('logs', '--timestamps', '--no-color');
  fs.writeFileSync(path.join(out, `logs-${label}.txt`), r.stdout + r.stderr);
}

async function sample(n, mode) {
  envFile = envFileFor(mode);
  log(`sample ${n} (${mode}): down -v`);
  tryDc('down', '-v', '--remove-orphans');
  const marks = await startStack();
  assertLocalImages();
  log(`sample ${n}: ready`, JSON.stringify(marks));

  log(`sample ${n}: idle ${idleSeconds} s`);
  await sleep(idleSeconds * 1000);
  const idle = await memorySnapshot();
  // Read after the idle wait: span lines are exported asynchronously and can
  // follow "Finished initializing" in the log.
  const phases = serverBootPhases();

  log(`sample ${n}: workload`);
  const work = workload();
  log(
    `sample ${n}: visible p50 ${work.visible_ms.p50} ms, p95 ${work.visible_ms.p95} ms`,
  );

  await sleep(settleSeconds * 1000);
  const after = await memorySnapshot();

  log(`sample ${n}: smoke`);
  const smokeResult = smoke(mode);
  log(
    `sample ${n}: smoke ${smokeResult.ok ? 'ok' : 'FAILED'}`,
    JSON.stringify(smokeResult.checks ?? smokeResult.error),
  );

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
    mode,
    smoke: smokeResult,
    cold_start: { ...marks, ...phases },
    idle,
    workload: work,
    after_workload: after,
    warm_restart_ms: restartMs,
  };
}

const config = {
  samples,
  modes,
  idle_seconds: idleSeconds,
  settle_seconds: settleSeconds,
  subscribers: Number(args.subscribers),
  writes: Number(args.writes),
  interval_ms: Number(args['interval-ms']),
  compose_files: composeFiles.map((f) => path.relative(root, f)),
};

const results = { environment: environment(), config, samples: [] };
log('environment', JSON.stringify(results.environment));

results.env_file = writeEnvFile();
if (!args['skip-build']) results.builds = buildImages();
for (const image of [serverImage, dashboardImage]) {
  localImages[image] = localImageId(image);
}
log('pulling images', registryServices.join(', '));
dc('pull', '--quiet', ...registryServices);
for (const image of [serverImage, dashboardImage]) {
  if (localImageId(image) !== localImages[image]) {
    throw new Error(
      `${image} changed during the pull: not the image built for this run`,
    );
  }
}
results.images = imageInfo();

let failed = false;
// Alternate the modes: with default,self-hosted the order is d, s, d, s, ...
for (let n = 1; n <= samples * modes.length; n++) {
  const mode = modes[(n - 1) % modes.length];
  try {
    const result = await sample(n, mode);
    results.samples.push(result);
    if (!result.smoke?.ok) {
      failed = true;
      saveLogs(`sample-${n}-smoke`);
    }
  } catch (e) {
    failed = true;
    log(`sample ${n} failed:`, e.message);
    results.samples.push({ sample: n, mode, error: e.message });
    saveLogs(`sample-${n}`);
  }
  fs.writeFileSync(
    path.join(out, 'results.json'),
    JSON.stringify(results, null, 2),
  );
}
saveLogs('last');
tryDc('down', '-v', '--remove-orphans');
fs.rmSync(envDir, { recursive: true, force: true });

fs.writeFileSync(path.join(out, 'summary.md'), summarize(results));
log(`wrote ${out}/results.json and ${out}/summary.md`);
process.exit(failed ? 1 : 0);
