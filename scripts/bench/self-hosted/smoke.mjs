// Smoke checks for the paths the runtime mode changes.
//
//   node --experimental-eventsource scripts/bench/self-hosted/smoke.mjs \
//     --api http://127.0.0.1:8888 --mode self-hosted|default \
//     --server-container <id>
//
// - headers:  GET / carries X-Instant-Server-Hostname in the default mode
//             (development behaviour) and not in the self-hosted mode;
// - presence: two sessions join one room and each sees the other;
// - streams:  one session writes a stream, a second session reads it back;
// - sse:      a session whose WebSocket cannot connect falls back to SSE
//             (the core client switches to SSE only after a failed WebSocket,
//             and only when given an EventSource), checks that its transport
//             is SSE, and receives writes made over WebSocket by another
//             session;
// - login:    dashboard sign-in with a one-time code. No email provider is
//             set, so the server prints the code to its log, which is read
//             with `docker logs` from --server-container;
// - storage:  a session uploads a file, finds it in $files, and downloads the
//             same bytes from its presigned URL (S3_PUBLIC_ENDPOINT, so the
//             storage service must be reachable at that address);
// - backup:   the signed-in user creates an app, writes to it, starts an
//             on-demand backup, waits for the job to complete, and lists the
//             backup's files, which must include config.json and a
//             non-empty entities/items.jsonl (the entity type written).
//
// Prints one JSON object. Exits 1 if any check fails.

import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { core, createApp, openDb, sleep, withTimeout } from './client.mjs';

const { values: args } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://127.0.0.1:8888' },
    mode: { type: 'string', default: 'self-hosted' },
    'server-container': { type: 'string' },
    'timeout-ms': { type: 'string', default: '20000' },
  },
});
const apiURI = args.api.replace(/\/+$/, '');
const timeoutMs = Number(args['timeout-ms']);
const { id } = core;

const results = {};
const dbs = [];

async function check(name, fn) {
  const t0 = performance.now();
  try {
    const detail = await fn();
    results[name] = {
      ok: true,
      ms: Math.round(performance.now() - t0),
      ...detail,
    };
  } catch (e) {
    results[name] = {
      ok: false,
      ms: Math.round(performance.now() - t0),
      error: String(e.message ?? e),
    };
  }
}

function track(db) {
  dbs.push(db);
  return db;
}

// A dashboard API call; throws on a non-2xx response or after timeoutMs.
async function dash(path, { token, body } = {}) {
  let res, text;
  try {
    res = await fetch(`${apiURI}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (e) {
    if (e.name === 'TimeoutError') {
      throw new Error(`${path}: no response after ${timeoutMs} ms`);
    }
    throw e;
  }
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function serverLog(since) {
  const r = spawnSync(
    'docker',
    ['logs', '--since', since, args['server-container']],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`docker logs: ${r.stderr.trim()}`);
  return r.stdout + r.stderr;
}

// The code is on a line of its own in the banner the server logs. Only the
// code is matched, not the banner's wording.
function loginCode(log) {
  return (
    log.match(/^\s*(\d{6})\s*$/m)?.[1] ??
    log.match(/code\D{0,40}?\b(\d{6})\b/i)?.[1]
  );
}

// Every app gets these rules: streams and files are denied when no rule
// exists.
const app = await createApp(apiURI, {
  rules: {
    code: {
      $streams: { allow: { create: 'true', view: 'true' } },
      $files: { allow: { create: 'true', view: 'true' } },
    },
  },
});

await check('headers', async () => {
  const res = await fetch(`${apiURI}/`);
  await res.text();
  const host = res.headers.get('x-instant-server-hostname');
  const expected = args.mode === 'default';
  if (Boolean(host) !== expected) {
    throw new Error(
      `X-Instant-Server-Hostname ${host ? 'present' : 'absent'} in ${args.mode} mode`,
    );
  }
  return { dev_headers: Boolean(host) };
});

await check('presence', async () => {
  const roomId = id();
  const seen = [false, false];
  const done = new Promise((resolve) => {
    for (const i of [0, 1]) {
      const db = track(openDb(apiURI, app.id, `smoke-presence-${i}`));
      const room = db.joinRoom('bench', roomId, {
        initialPresence: { name: `peer-${i}` },
      });
      room.subscribePresence({}, (state) => {
        const other = `peer-${1 - i}`;
        if (Object.values(state.peers ?? {}).some((p) => p?.name === other)) {
          seen[i] = true;
          if (seen[0] && seen[1]) resolve();
        }
      });
    }
  });
  await withTimeout(done, timeoutMs, 'both peers see each other');
  return {};
});

await check('streams', async () => {
  const clientId = `smoke-${id()}`;
  const writer = track(openDb(apiURI, app.id, 'smoke-stream-writer'));
  const reader = track(openDb(apiURI, app.id, 'smoke-stream-reader'));
  const parts = ['hello ', 'from ', 'a stream'];
  const w = writer.streams.createWriteStream({ clientId }).getWriter();
  for (const p of parts) await w.write(p);
  await w.close();
  const readAll = (async () => {
    let text = '';
    for await (const chunk of reader.streams.createReadStream({ clientId })) {
      text += chunk;
    }
    return text;
  })();
  const text = await withTimeout(readAll, timeoutMs, 'read the stream back');
  if (text !== parts.join('')) {
    throw new Error(
      `read ${JSON.stringify(text)}, wrote ${JSON.stringify(parts.join(''))}`,
    );
  }
  return { bytes: text.length };
});

await check('sse', async () => {
  if (typeof EventSource !== 'function') {
    throw new Error(
      'no EventSource in this Node; run with --experimental-eventsource',
    );
  }
  const run = id();
  const sse = track(
    openDb(apiURI, app.id, 'smoke-sse', {
      // Nothing listens on port 9: the WebSocket fails and the reactor falls
      // back to SSE on apiURI.
      websocketURI: 'ws://127.0.0.1:9/runtime/session',
      eventSource: EventSource,
    }),
  );
  const writer = track(openDb(apiURI, app.id, 'smoke-sse-writer'));
  const seen = new Map();
  let ready;
  const readyP = new Promise((r) => (ready = r));
  sse.subscribeQuery({ items: { $: { where: { run } } } }, (resp) => {
    if (!resp.data) return;
    ready();
    const now = performance.now();
    for (const item of resp.data.items)
      if (!seen.has(item.seq)) seen.set(item.seq, now);
  });
  await withTimeout(readyP, timeoutMs, 'first SSE query result');
  const transport = sse._reactor._transport?.type;
  if (transport !== 'sse')
    throw new Error(`transport is ${transport}, not sse`);
  const latencies = [];
  for (let seq = 0; seq < 5; seq++) {
    const t0 = performance.now();
    await writer.transact(writer.tx.items[id()].update({ run, seq }));
    await withTimeout(
      (async () => {
        while (!seen.has(seq)) await sleep(5);
      })(),
      timeoutMs,
      `SSE subscriber sees write ${seq}`,
    );
    latencies.push(Math.round(seen.get(seq) - t0));
  }
  return { transport, visible_ms: latencies };
});

let dashToken;

await check('login', async () => {
  if (!args['server-container']) {
    throw new Error('no --server-container: the login code is in its log');
  }
  const email = `smoke-${id()}@example.com`;
  const since = new Date(Date.now() - 2000).toISOString();
  await dash('/dash/auth/send_magic_code', { body: { email } });
  const deadline = performance.now() + timeoutMs;
  let code;
  while (!(code = loginCode(serverLog(since)))) {
    if (performance.now() > deadline) {
      throw new Error(`no login code in the server log after ${timeoutMs} ms`);
    }
    await sleep(250);
  }
  const { token } = await dash('/dash/auth/verify_magic_code', {
    body: { email, code },
  });
  const { user } = await dash('/dash/me', { token });
  if (user?.email !== email) {
    throw new Error(`/dash/me returned ${JSON.stringify(user?.email)}`);
  }
  dashToken = token;
  return {};
});

await check('storage', async () => {
  const db = track(openDb(apiURI, app.id, 'smoke-storage'));
  const path = `smoke/${id()}.txt`;
  const text = `hello from smoke ${id()}`;
  await withTimeout(
    db.storage.uploadFile(path, new Blob([text], { type: 'text/plain' })),
    timeoutMs,
    'upload the file',
  );
  const { data } = await withTimeout(
    db.queryOnce({ $files: { $: { where: { path } } } }),
    timeoutMs,
    'find the file in $files',
  );
  const url = data.$files[0]?.url;
  if (!url) throw new Error('no $files row with a url for the uploaded path');
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const got = await res.text();
  if (!res.ok || got !== text) {
    throw new Error(
      `GET the file url: ${res.status} ${JSON.stringify(got.slice(0, 200))}`,
    );
  }
  return { bytes: got.length };
});

await check('backup', async () => {
  if (!dashToken) throw new Error('needs the token from the login check');
  const token = dashToken;
  const appId = id();
  await dash('/dash/apps', {
    token,
    body: { id: appId, title: `smoke-backup-${Date.now()}`, admin_token: id() },
  });
  const db = track(openDb(apiURI, appId, 'smoke-backup'));
  await withTimeout(
    db.transact(db.tx.items[id()].update({ name: 'backed up' })),
    timeoutMs,
    'write to the app',
  );
  let { job } = await dash(`/dash/apps/${appId}/backups`, {
    token,
    body: { description: 'smoke' },
  });
  // A backup streams the whole app to storage: allow longer than one write.
  const deadline = performance.now() + 3 * timeoutMs;
  while (['waiting', 'processing'].includes(job.job_status)) {
    if (performance.now() > deadline) {
      throw new Error(
        `backup job still ${job.job_status} after ${3 * timeoutMs} ms`,
      );
    }
    await sleep(500);
    ({ job } = await dash(`/dash/apps/${appId}/backup-jobs/${job.id}`, {
      token,
    }));
  }
  if (job.job_status !== 'completed') {
    throw new Error(`backup job ${job.job_status}`);
  }
  const { files } = await dash(
    `/dash/apps/${appId}/backups/${job.app_backup_id}/files`,
    { token },
  );
  const names = files.map((f) => `${f.name} (${f.size})`).join(', ');
  if (!files.some((f) => f.name === 'config.json')) {
    throw new Error(`backup has no config.json: ${names}`);
  }
  // One zstd-compressed JSONL file per entity type: the write must be there.
  if (!files.some((f) => f.name === 'entities/items.jsonl' && f.size > 0)) {
    throw new Error(`backup has no non-empty entities/items.jsonl: ${names}`);
  }
  return {
    files: files.length,
    bytes: files.reduce((n, f) => n + (f.size ?? 0), 0),
  };
});

for (const db of dbs) {
  try {
    db.shutdown();
  } catch {}
}

const ok = Object.values(results).every((r) => r.ok);
console.log(JSON.stringify({ mode: args.mode, ok, checks: results }));
process.exit(ok ? 0 : 1);
