// Small live-query workload against a running SidekickDB server.
//
//   node scripts/bench/self-hosted/workload.mjs --api http://127.0.0.1:8888 \
//     [--subscribers 5] [--writes 100] [--warmup 10] [--interval-ms 100]
//
// It creates an ephemeral app (POST /dash/apps/ephemeral, no login), opens
// one WebSocket session per subscriber and one for the writer with
// @sidekickdb/core, subscribes every subscriber to the same query, then
// writes one entity at a time from the writer. For each write it records:
//
//   - ack: time from db.transact() to its promise resolving (transact-ok);
//   - visible: for each subscriber, time from db.transact() to the first
//     callback whose result contains the new entity.
//
// Writer and subscribers are separate reactors, so a subscriber only sees a
// write after the server has committed it, the invalidator has picked it up
// from the WAL and the refresh has reached that session. All clocks are this
// process's performance.now(), so no clock sync is involved.
//
// The first --warmup writes are not counted. The run fails (exit 1) if any
// subscriber misses any write: a fast run that drops updates is not a result.
// Prints one JSON object on stdout.
//
// Needs @sidekickdb/core built (pnpm --filter @sidekickdb/core... build).

import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://127.0.0.1:8888' },
    subscribers: { type: 'string', default: '5' },
    writes: { type: 'string', default: '100' },
    warmup: { type: 'string', default: '10' },
    'interval-ms': { type: 'string', default: '100' },
    'timeout-ms': { type: 'string', default: '30000' },
  },
});

const apiURI = args.api.replace(/\/+$/, '');
const subscriberCount = Number(args.subscribers);
const writeCount = Number(args.writes);
const warmup = Number(args.warmup);
const intervalMs = Number(args['interval-ms']);
const timeoutMs = Number(args['timeout-ms']);

// @sidekickdb/core expects a browser. These are the parts it needs in Node:
// `window` must exist for the reactor to connect, and the network listener
// and storage are replaced below.
globalThis.window ??= globalThis;

const core = await import(
  new URL('../../../client/packages/core/dist/esm/index.js', import.meta.url)
);
const { init, id, StorageInterface } = core;

class MemoryStore extends StorageInterface {
  constructor(appId, storeName) {
    super(appId, storeName);
    this.map = new Map();
  }
  async getItem(k) {
    return this.map.get(k) ?? null;
  }
  async setItem(k, v) {
    this.map.set(k, v);
  }
  async getAllKeys() {
    return [...this.map.keys()];
  }
  async multiSet(pairs) {
    for (const [k, v] of pairs) this.map.set(k, v);
  }
  async removeItem(k) {
    this.map.delete(k);
  }
}

class AlwaysOnline {
  static async getIsOnline() {
    return true;
  }
  static listen() {
    return () => {};
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${ms} ms: ${what}`)),
        ms,
      );
    }),
  ]);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (x) => (x == null ? null : Math.round(x * 100) / 100);
  return {
    count: sorted.length,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    max: round(sorted.at(-1) ?? null),
    min: round(sorted[0] ?? null),
  };
}

async function createApp() {
  const res = await fetch(`${apiURI}/dash/apps/ephemeral`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: `bench-${Date.now()}` }),
  });
  if (!res.ok) {
    throw new Error(
      `POST /dash/apps/ephemeral: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()).app;
}

function openDb(appId, key) {
  return init(
    {
      appId,
      apiURI,
      devtool: false,
      verbose: false,
      __extraDedupeKey: key,
    },
    MemoryStore,
    AlwaysOnline,
  );
}

const startedAt = performance.now();
const app = await createApp();
const runId = id();
const query = { items: { $: { where: { run: runId } } } };

// sentAt[seq] = performance.now() just before db.transact().
const sentAt = new Map();
// seenAt[subscriber][seq] = first time that subscriber saw seq.
const subscribers = [];

for (let s = 0; s < subscriberCount; s++) {
  const db = openDb(app.id, `bench-sub-${s}`);
  const seen = new Map();
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  const unsubscribe = db.subscribeQuery(query, (resp) => {
    if (resp.error) {
      console.error(`subscriber ${s}: query error`, resp.error);
      return;
    }
    if (!resp.data) return;
    resolveReady();
    const now = performance.now();
    for (const item of resp.data.items) {
      if (!seen.has(item.seq)) seen.set(item.seq, now);
    }
  });
  subscribers.push({ db, seen, ready, unsubscribe });
}

const subscribeStart = performance.now();
await withTimeout(
  Promise.all(subscribers.map((s) => s.ready)),
  timeoutMs,
  'initial query results for every subscriber',
);
const subscribeMs = performance.now() - subscribeStart;

const writer = openDb(app.id, 'bench-writer');
const ackMs = [];
const pendingAcks = [];

for (let seq = 0; seq < writeCount; seq++) {
  const t0 = performance.now();
  sentAt.set(seq, t0);
  const ack = writer
    .transact(writer.tx.items[id()].update({ run: runId, seq }))
    .then(() => {
      if (seq >= warmup) ackMs.push(performance.now() - t0);
    });
  pendingAcks.push(ack);
  await sleep(intervalMs);
}

await withTimeout(Promise.all(pendingAcks), timeoutMs, 'every transact-ok');

// Wait until every subscriber has seen every write, or the timeout.
const deadline = performance.now() + timeoutMs;
while (
  performance.now() < deadline &&
  subscribers.some((s) => s.seen.size < writeCount)
) {
  await sleep(50);
}

const visibleMs = [];
const perSubscriber = [];
let missing = 0;
for (const [i, s] of subscribers.entries()) {
  const lat = [];
  for (let seq = 0; seq < writeCount; seq++) {
    const at = s.seen.get(seq);
    if (at === undefined) {
      missing++;
      continue;
    }
    if (seq >= warmup) lat.push(at - sentAt.get(seq));
  }
  visibleMs.push(...lat);
  perSubscriber.push({ subscriber: i, ...stats(lat) });
}

for (const s of subscribers) {
  s.unsubscribe();
  s.db.shutdown();
}
writer.shutdown();

const result = {
  app_id: app.id,
  subscribers: subscriberCount,
  writes: writeCount,
  warmup_writes: warmup,
  interval_ms: intervalMs,
  missing_updates: missing,
  initial_subscribe_ms: Math.round(subscribeMs),
  ack_ms: stats(ackMs),
  visible_ms: stats(visibleMs),
  per_subscriber_visible_ms: perSubscriber,
  total_ms: Math.round(performance.now() - startedAt),
};

console.log(JSON.stringify(result));
if (missing > 0) {
  console.error(`${missing} updates never reached a subscriber`);
  process.exit(1);
}
process.exit(0);
