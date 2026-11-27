import { afterEach, expect, test, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getPostBySlug, isPostSlug } from '../lib/posts';
import handler from '../pages/api/intern/posts/watch/[slug]';

afterEach(() => {
  vi.unstubAllEnvs();
});

function call(slug: unknown) {
  let onClose = () => {};
  const req = {
    query: { slug },
    on: (event: string, fn: () => void) => {
      if (event === 'close') onClose = fn;
    },
  } as unknown as NextApiRequest;
  const res = {
    statusCode: 0,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    },
    writeHead(code: number) {
      this.statusCode = code;
    },
    write() {},
  };
  handler(req, res as unknown as NextApiResponse);
  onClose();
  return res.statusCode;
}

test('accepts only plain slugs', () => {
  expect(isPostSlug('architecture')).toBe(true);
  expect(isPostSlug('a_b-1')).toBe(true);
  expect(isPostSlug('a.b')).toBe(false);
  expect(isPostSlug('a/b')).toBe(false);
  expect(isPostSlug('')).toBe(false);
  expect(isPostSlug(['a'])).toBe(false);
  expect(() => getPostBySlug('a.b')).toThrow('Invalid post slug');
  expect(getPostBySlug('architecture').slug).toBe('architecture');
});

test('preview route answers 404 outside development', () => {
  vi.stubEnv('NODE_ENV', 'production');
  expect(call('architecture')).toBe(404);
});

test('preview route in development serves plain slugs only', () => {
  vi.stubEnv('NODE_ENV', 'development');
  expect(call('architecture')).toBe(200);
  expect(call('a.b')).toBe(404);
  expect(call('missing')).toBe(404);
});
