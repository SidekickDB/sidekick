import { describe, expect, test } from 'vitest';
import { init, MissingApiURIError } from '../../src';

const missingMessage =
  "No SidekickDB server URL configured. Pass `apiURI` to init() in @sidekickdb/admin, for example apiURI: 'https://sidekick.example.com'. SidekickDB has no default server.";

describe('admin init() server URL configuration', () => {
  test('throws a clear error when apiURI is missing', () => {
    expect(() => init({ appId: 'app-id', adminToken: 'token' })).toThrow(
      MissingApiURIError,
    );
    expect(() => init({ appId: 'app-id', adminToken: 'token' })).toThrow(
      missingMessage,
    );
  });

  test('throws when apiURI is empty', () => {
    expect(() =>
      init({ appId: 'app-id', adminToken: 'token', apiURI: '' }),
    ).toThrow(missingMessage);
  });

  test('keeps an explicit apiURI unchanged', () => {
    const db = init({
      appId: 'app-id',
      adminToken: 'token',
      apiURI: 'http://localhost:8888',
    });
    expect(db.config.apiURI).toBe('http://localhost:8888');
  });
});
