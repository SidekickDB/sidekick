// Cross-node checks against two server nodes that share one Postgres.
//
//   node scripts/smoke/two-node/smoke.mjs \
//     --a http://127.0.0.1:8881 --b http://127.0.0.1:8882 [--timeout-ms 20000]
//
// Every session is a separate @sidekickdb/core reactor connected to one node
// only (scripts/bench/self-hosted/client.mjs):
//
// - write-a-to-b: a session on B subscribes to a query, a session on A
//   writes, and B must see the write. A subscriber on A watches the same
//   query, so a failure says whether the write reached its own node;
// - write-b-to-a: the same in the other direction. Each node invalidates its
//   queries from its own replication slot (invalidator_<process-id>), so the
//   write checks pass whether or not the nodes form a cluster: they show that
//   both nodes see writes made through the other, not that the nodes talk;
// - presence: a session on A and a session on B join one room, and each must
//   see the other. This goes through Hazelcast's shared rooms map and fails
//   when the nodes do not form a cluster.
//
// Prints one JSON object. Exits 1 if any check fails.

import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import {
  core,
  createApp,
  openDb,
  sleep,
  withTimeout,
} from "../../bench/self-hosted/client.mjs";

const { values: args } = parseArgs({
  options: {
    a: { type: "string", default: "http://127.0.0.1:8881" },
    b: { type: "string", default: "http://127.0.0.1:8882" },
    "timeout-ms": { type: "string", default: "20000" },
  },
});
const nodes = {
  A: args.a.replace(/\/+$/, ""),
  B: args.b.replace(/\/+$/, ""),
};
const timeoutMs = Number(args["timeout-ms"]);
const { id } = core;

const results = {};
const dbs = [];

async function check(name, fn) {
  const t0 = performance.now();
  const detail = {};
  try {
    await fn(detail);
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
      ...detail,
    };
  }
}

function open(node, key) {
  const db = openDb(nodes[node], app.id, `two-node-${key}`);
  dbs.push(db);
  return db;
}

// Subscribes `db` to the items of one run. Resolves `ready` on the first
// result, and keeps the seqs seen and the last result for diagnostics.
function watch(db, run) {
  const state = { seen: new Map(), last: null, error: null };
  let ready;
  state.ready = new Promise((r) => (ready = r));
  db.subscribeQuery({ items: { $: { where: { run } } } }, (resp) => {
    if (resp.error) {
      state.error = resp.error;
      return;
    }
    if (!resp.data) return;
    ready();
    state.last = resp.data.items.map((i) => ({ seq: i.seq }));
    const now = performance.now();
    for (const item of resp.data.items)
      if (!state.seen.has(item.seq)) state.seen.set(item.seq, now);
  });
  return state;
}

async function waitFor(pred, what) {
  await withTimeout(
    (async () => {
      while (!pred()) await sleep(5);
    })(),
    timeoutMs,
    what,
  );
}

async function crossWrite(from, to, detail) {
  const run = id();
  const writer = open(from, `writer-${from}`);
  const remote = watch(open(to, `sub-${to}`), run);
  const local = watch(open(from, `sub-${from}`), run);
  detail.writer = from;
  detail.subscriber = to;
  try {
    await withTimeout(
      Promise.all([remote.ready, local.ready]),
      timeoutMs,
      `first query result on both nodes`,
    );
    const writes = 3;
    const visible = [];
    for (let seq = 0; seq < writes; seq++) {
      const t0 = performance.now();
      await withTimeout(
        writer.transact(writer.tx.items[id()].update({ run, seq })),
        timeoutMs,
        `transact on node ${from}`,
      );
      await waitFor(
        () => remote.seen.has(seq),
        `subscriber on node ${to} sees write ${seq} made on node ${from}`,
      );
      visible.push(Math.round(remote.seen.get(seq) - t0));
    }
    detail.visible_ms = visible;
  } finally {
    detail.received_on_subscriber_node = remote.last;
    detail.received_on_writer_node = local.last;
    if (remote.error) detail.subscriber_error = remote.error;
    if (local.error) detail.writer_node_error = local.error;
  }
}

// The app is created through node A; node B only ever reads it from Postgres.
const app = await createApp(nodes.A);

await check("write-a-to-b", (d) => crossWrite("A", "B", d));
await check("write-b-to-a", (d) => crossWrite("B", "A", d));

await check("presence", async (detail) => {
  const roomId = id();
  const seen = { A: false, B: false };
  const peersSeen = { A: null, B: null };
  try {
    await withTimeout(
      new Promise((resolve) => {
        for (const node of ["A", "B"]) {
          const other = node === "A" ? "B" : "A";
          const room = open(node, `presence-${node}`).joinRoom(
            "smoke",
            roomId,
            {
              initialPresence: { node },
            },
          );
          room.subscribePresence({}, (state) => {
            const peers = Object.values(state.peers ?? {});
            peersSeen[node] = peers.map((p) => p?.node ?? null);
            if (peers.some((p) => p?.node === other)) {
              seen[node] = true;
              if (seen.A && seen.B) resolve();
            }
          });
        }
      }),
      timeoutMs,
      "the session on each node sees the peer on the other node",
    );
  } finally {
    detail.peers_seen_from = peersSeen;
  }
});

for (const db of dbs) {
  try {
    db.shutdown();
  } catch {}
}

const ok = Object.values(results).every((r) => r.ok);
console.log(JSON.stringify({ ok, nodes, app_id: app.id, checks: results }));
process.exit(ok ? 0 : 1);
