import { describe, expect, test } from 'vitest';

import {
  init,
  MissingApiURIError,
  requireApiURI,
  websocketURIFromApiURI,
} from '../../src';
import uuid from '../../src/utils/id';

const missingMessage =
  "No SidekickDB server URL configured. Pass `apiURI` to init(), for example apiURI: 'https://sidekick.example.com'. SidekickDB has no default server.";

describe('init() server URL configuration', () => {
  test('throws a clear error when apiURI is missing', () => {
    expect(() => init({ appId: uuid() })).toThrow(MissingApiURIError);
    expect(() => init({ appId: uuid() })).toThrow(missingMessage);
  });

  test('throws when apiURI is empty, even if websocketURI is set', () => {
    expect(() =>
      init({
        appId: uuid(),
        apiURI: '',
        websocketURI: 'wss://sidekick.example.com/runtime/session',
      }),
    ).toThrow(missingMessage);
  });

  test('derives the websocket URL from an API-only config', () => {
    const db = init({ appId: uuid(), apiURI: 'https://sidekick.example.com' });
    expect(db._reactor.config.apiURI).toBe('https://sidekick.example.com');
    expect(db._reactor.config.websocketURI).toBe(
      'wss://sidekick.example.com/runtime/session',
    );
  });

  test('keeps an explicit apiURI and websocketURI unchanged', () => {
    const db = init({
      appId: uuid(),
      apiURI: 'http://localhost:8888',
      websocketURI: 'ws://127.0.0.1:9999/custom/session',
    });
    expect(db._reactor.config.apiURI).toBe('http://localhost:8888');
    expect(db._reactor.config.websocketURI).toBe(
      'ws://127.0.0.1:9999/custom/session',
    );
  });
});

describe('websocketURIFromApiURI', () => {
  test.each([
    [
      'https://sidekick.example.com',
      'wss://sidekick.example.com/runtime/session',
    ],
    [
      'https://sidekick.example.com/',
      'wss://sidekick.example.com/runtime/session',
    ],
    ['http://localhost:8888', 'ws://localhost:8888/runtime/session'],
    [
      'https://example.com/sidekick/?x=1#y',
      'wss://example.com/sidekick/runtime/session',
    ],
  ])('derives %s', (apiURI, expected) => {
    expect(websocketURIFromApiURI(apiURI)).toBe(expected);
  });

  test('rejects URLs that are not http(s)', () => {
    expect(() => websocketURIFromApiURI('ftp://example.com')).toThrow(
      'expected an http(s) URL',
    );
    expect(() => websocketURIFromApiURI('not a url')).toThrow(
      'expected an http(s) URL',
    );
  });
});

describe('requireApiURI', () => {
  test('returns the URL unchanged', () => {
    expect(
      requireApiURI('https://sidekick.example.com/', { target: 'init()' }),
    ).toBe('https://sidekick.example.com/');
  });

  test('names the env var when there is one', () => {
    expect(() =>
      requireApiURI(undefined, {
        target: 'createResumableStreamContext()',
        envVar: 'INSTANT_API_URI',
      }),
    ).toThrow(
      'Pass `apiURI` to createResumableStreamContext() or set the INSTANT_API_URI environment variable',
    );
  });
});
