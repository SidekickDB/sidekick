// Shared helpers for workload.mjs and smoke.mjs: load the locally built
// @sidekickdb/core in Node, open independent client sessions, create an
// ephemeral app.

// @sidekickdb/core expects a browser. `window` must exist for the reactor to
// connect; the network listener and storage are replaced below.
globalThis.window ??= globalThis;

export const core = await import(
  new URL('../../../client/packages/core/dist/esm/index.js', import.meta.url)
);
const { init, StorageInterface } = core;

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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function withTimeout(promise, ms, what) {
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

export async function createApp(apiURI, extra = {}) {
  const res = await fetch(`${apiURI}/dash/apps/ephemeral`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: `bench-${Date.now()}`, ...extra }),
  });
  if (!res.ok) {
    throw new Error(
      `POST /dash/apps/ephemeral: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()).app;
}

// One independent session per key. With `eventSource`, the reactor can fall
// back to SSE when the WebSocket fails.
export function openDb(apiURI, appId, key, { websocketURI, eventSource } = {}) {
  return init(
    {
      appId,
      apiURI,
      ...(websocketURI ? { websocketURI } : {}),
      devtool: false,
      verbose: false,
      __extraDedupeKey: key,
    },
    MemoryStore,
    AlwaysOnline,
    undefined,
    eventSource,
  );
}
