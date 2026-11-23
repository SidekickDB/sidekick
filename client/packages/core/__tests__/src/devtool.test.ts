import { describe, expect, test } from 'vitest';

import { getDevtoolSrc } from '../../src/devtool.ts';

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
