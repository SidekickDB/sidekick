import { describe, expect, test } from 'vitest';
import { Webhooks } from '../../src/index';

describe('webhooks server URL configuration', () => {
  test('throws without apiURI', () => {
    expect(() => new Webhooks({ appId: 'app', adminToken: 'tok' })).toThrow(
      "No SidekickDB server URL configured. Pass `apiURI` to new Webhooks(), for example apiURI: 'https://sidekick.example.com'. SidekickDB has no default server.",
    );
  });

  test('keeps an explicit apiURI unchanged', () => {
    const webhooks = new Webhooks({
      appId: 'app',
      adminToken: 'tok',
      apiURI: 'http://localhost:8888',
    });
    expect(webhooks.apiURI).toBe('http://localhost:8888');
  });
});
