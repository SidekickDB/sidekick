// Smoke checks for the paths the runtime mode changes.
//
//   node --experimental-eventsource scripts/bench/self-hosted/smoke.mjs \
//     --api http://127.0.0.1:8888 --mode self-hosted|default
//
// - headers:  GET / carries X-Instant-Server-Hostname in the default mode
//             (development behaviour) and not in the self-hosted mode;
// - presence: two sessions join one room and each sees the other;
// - streams:  one session writes a stream, a second session reads it back;
// - sse:      a session whose WebSocket cannot connect falls back to SSE
//             (the core client switches to SSE only after a failed WebSocket,
//             and only when given an EventSource), checks that its transport
//             is SSE, and receives writes made over WebSocket by another
//             session.
//
// Prints one JSON object. Exits 1 if any check fails.

import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { core, createApp, openDb, sleep, withTimeout } from './client.mjs';

const { values: args } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://127.0.0.1:8888' },
    mode: { type: 'string', default: 'self-hosted' },
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

// Every app gets these rules: streams are denied when no rule exists.
const app = await createApp(apiURI, {
  rules: { code: { $streams: { allow: { create: 'true', view: 'true' } } } },
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

for (const db of dbs) {
  try {
    db.shutdown();
  } catch {}
}

const ok = Object.values(results).every((r) => r.ok);
console.log(JSON.stringify({ mode: args.mode, ok, checks: results }));
process.exit(ok ? 0 : 1);
