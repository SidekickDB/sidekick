import { afterEach, describe, expect, test } from 'vitest';

import { createDevtool, getDevtoolSrc } from '../../src/devtool.ts';

const defaultConfig = {
  position: 'bottom-right' as const,
  allowedHosts: ['localhost'],
};

describe('getDevtoolSrc', () => {
  test('has no default dashboard', () => {
    expect(getDevtoolSrc('app-id', defaultConfig)).toBeNull();
  });

  test('uses a configured dashboard URI', () => {
    expect(
      getDevtoolSrc('app-id', {
        ...defaultConfig,
        dashURI: 'https://dash.instant.example/',
      }),
    ).toBe('https://dash.instant.example/_devtool?appId=app-id');
  });
});

describe('createDevtool', () => {
  const g = globalThis as any;
  const hadDocument = 'document' in g;
  const realDocument = g.document;
  afterEach(() => {
    if (hadDocument) {
      g.document = realDocument;
    } else {
      delete g.document;
    }
  });

  test('renders nothing and touches no DOM without a dashURI', () => {
    g.document = new Proxy(
      {},
      {
        get(_target, prop) {
          throw new Error(`document.${String(prop)} accessed`);
        },
      },
    );
    expect(createDevtool('app-id', defaultConfig)).toBeUndefined();
  });
});
