import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { subscribe } from '../../src/subscribe.ts';

// SidekickDB: covers the admin streaming path on the package's own copy of
// eventsource, with a stub fetch (no network, no server).

const realFetch = globalThis.fetch;
const realMessageEvent = globalThis.MessageEvent;

type FetchCall = { url: string; init: RequestInit };

function stubFetch(events: object[]): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const e of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        }
        init?.signal?.addEventListener('abort', () =>
          controller.error(new DOMException('aborted', 'AbortError')),
        );
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof fetch;
  return calls;
}

describe('admin subscribe over the vendored EventSource', () => {
  beforeEach(() => {
    // The Vercel edge runtime defines a MessageEvent that throws; admin
    // passes its own constructor, so a throwing global must not matter.
    globalThis.MessageEvent = class {
      constructor() {
        throw new Error('global MessageEvent must not be used');
      }
    } as unknown as typeof MessageEvent;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    globalThis.MessageEvent = realMessageEvent;
  });

  test('posts the query and delivers the result', async () => {
    const calls = stubFetch([
      { op: 'sse-init', 'machine-id': 'm-1', 'session-id': 's-1' },
      { op: 'add-query-ok', result: [{ data: 'first' }] },
    ]);

    const results: any[] = [];
    const query = { goals: {} };
    const sub = subscribe(query as any, (r) => results.push(r), {
      headers: { authorization: 'Bearer token' },
      inference: false,
      apiURI: 'http://sidekick.test',
    });

    try {
      for (let i = 0; i < 100 && !results.length; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }

      expect(results).toEqual([
        {
          type: 'ok',
          data: [{ data: 'first' }],
          pageInfo: undefined,
          sessionInfo: { machineId: 'm-1', sessionId: 's-1' },
        },
      ]);

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toMatch(
        /^http:\/\/sidekick\.test\/admin\/subscribe-query\?local_connection_id=/,
      );
      expect(calls[0].init.method).toBe('POST');
      expect(calls[0].init.headers).toEqual({ authorization: 'Bearer token' });
      const body = JSON.parse(String(calls[0].init.body));
      expect(body.query).toEqual(query);
      expect(body['inference?']).toBe(false);
    } finally {
      sub.close();
    }
  });
});
