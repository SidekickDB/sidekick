import { afterEach, expect, test, vi } from 'vitest';
import { uploadFile } from '../../src/StorageAPI.ts';

// Captures what uploadFile hands to fetch, and builds the request headers the
// same way fetch does, so a header value fetch would reject throws here too.
function stubFetch() {
  const calls: { url: string; headers: Headers }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, headers: new Headers(init.headers) });
      return new Response(JSON.stringify({ data: { id: 'file-id' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const base = {
  apiURI: 'http://localhost:8888',
  appId: 'app-id',
  refreshToken: 'token',
  file: new Blob(['hello'], { type: 'text/plain' }),
};

test('a non-ISO-8859-1 header value is what fetch rejects', () => {
  // macOS hands out NFD names: "à" is "a" + U+0300 COMBINING GRAVE ACCENT.
  expect(
    () => new Headers({ path: 'café à noite.txt'.normalize('NFD') }),
  ).toThrow(TypeError);
});

test('uploads a non-ASCII filename through the query string only', async () => {
  const calls = stubFetch();
  const path = 'café à noite.txt'.normalize('NFD');
  const contentDisposition = `attachment; filename="${path}"`;

  const res = await uploadFile({ ...base, path, contentDisposition });

  expect(res).toEqual({ data: { id: 'file-id' } });
  expect(calls).toHaveLength(1);
  const url = new URL(calls[0].url);
  expect(url.pathname).toBe('/storage/upload');
  expect(url.searchParams.get('app_id')).toBe('app-id');
  expect(url.searchParams.get('path')).toBe(path);
  expect(url.searchParams.get('content-disposition')).toBe(contentDisposition);
  expect(calls[0].headers.has('path')).toBe(false);
  expect(calls[0].headers.has('content-disposition')).toBe(false);
});

test('still mirrors ASCII values into headers for older servers', async () => {
  const calls = stubFetch();

  await uploadFile({
    ...base,
    path: 'photos/a b+c.png',
    contentDisposition: 'inline',
  });

  const url = new URL(calls[0].url);
  expect(url.searchParams.get('path')).toBe('photos/a b+c.png');
  expect(calls[0].headers.get('path')).toBe('photos/a b+c.png');
  expect(calls[0].headers.get('content-disposition')).toBe('inline');
});
