import { afterEach, describe, expect, test } from 'vitest';

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
    expect(() => websocketURIFromApiURI('https://')).toThrow(
      'expected an http(s) URL',
    );
    expect(() => websocketURIFromApiURI('//example.com')).toThrow(
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

// The previous implementation, built on the WHATWG URL class. On Node and in
// browsers the string-based derivation must give exactly the same result.
function whatwgReference(apiURI: string): string {
  const url = new URL(apiURI);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/runtime/session`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

const equivalenceCases = [
  'https://sidekick.example.com',
  'https://sidekick.example.com/',
  'https://sidekick.example.com///',
  'http://localhost:8888',
  'http://localhost:8888/',
  'http://127.0.0.1:8888',
  'https://example.com/sidekick',
  'https://example.com/sidekick/?x=1#y',
  'https://example.com/a/b/c/',
  'https://example.com?x=1',
  'https://example.com#frag',
  'https://example.com:8443/prefix',
  'https://example.com:443/prefix',
  'http://example.com:80',
  'http://example.com:8080',
  'http://[::1]:8888',
  'http://[::1]',
  'https://[2001:db8::1]:443/x',
  'HTTPS://Sidekick.Example.COM/Prefix',
  'https://user:pass@example.com:9000/p',
  '  https://example.com/padded  ',
];

describe('websocketURIFromApiURI matches the WHATWG URL behaviour', () => {
  test.each(equivalenceCases)('%s', (apiURI) => {
    expect(websocketURIFromApiURI(apiURI)).toBe(whatwgReference(apiURI));
  });
});

// React Native's built-in URL (Libraries/Blob/URL.js): in 0.76 the getters
// throw "not implemented"; in 0.81 they are getters without setters, so
// assigning to them throws in strict mode.
class RN076URL {
  _url: string;
  constructor(url: string) {
    this._url = url;
  }
  get protocol(): string {
    throw new Error('URL.protocol is not implemented');
  }
  get pathname(): string {
    throw new Error('URL.pathname not implemented');
  }
  get search(): string {
    throw new Error('URL.search is not implemented');
  }
  get hash(): string {
    throw new Error('URL.hash is not implemented');
  }
  toString() {
    return this._url;
  }
}

class RN081URL {
  _url: string;
  constructor(url: string) {
    this._url = url;
  }
  get protocol(): string {
    const m = this._url.match(/^([a-zA-Z][a-zA-Z\d+\-.]*):/);
    return m ? m[1] + ':' : '';
  }
  get pathname(): string {
    return '/';
  }
  get search(): string {
    return '';
  }
  get hash(): string {
    return '';
  }
  toString() {
    return this._url;
  }
}

describe('websocket URL derivation without a WHATWG URL (React Native)', () => {
  const realURL = globalThis.URL;
  afterEach(() => {
    globalThis.URL = realURL;
  });

  test('the RN stubs reproduce the original failure', () => {
    globalThis.URL = RN076URL as any;
    expect(() => whatwgReference('https://sidekick.example.com')).toThrow(
      'not implemented',
    );
    globalThis.URL = RN081URL as any;
    expect(() => whatwgReference('https://sidekick.example.com')).toThrow(
      TypeError,
    );
  });

  test.each([
    ['RN 0.76 URL', RN076URL],
    ['RN 0.81 URL', RN081URL],
    ['no global URL', undefined],
  ])('derives the URL and init() works with %s', (_name, impl) => {
    globalThis.URL = impl as any;
    expect(websocketURIFromApiURI('https://sidekick.example.com/api/')).toBe(
      'wss://sidekick.example.com/api/runtime/session',
    );
    expect(websocketURIFromApiURI('http://[::1]:8888')).toBe(
      'ws://[::1]:8888/runtime/session',
    );
    const db = init({ appId: uuid(), apiURI: 'http://10.0.2.2:8888' });
    expect(db._reactor.config.websocketURI).toBe(
      'ws://10.0.2.2:8888/runtime/session',
    );
  });
});
