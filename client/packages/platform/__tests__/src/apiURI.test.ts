import { describe, expect, test } from 'vitest';
import { MissingApiURIError } from '@sidekickdb/core';
import {
  OAuthHandler,
  PlatformApi,
  exchangeCodeForToken,
  exchangeRefreshToken,
} from '../../src/index';

function missingMessage(target: string) {
  return `No SidekickDB server URL configured. Pass \`apiURI\` to ${target}, for example apiURI: 'https://sidekick.example.com'. SidekickDB has no default server.`;
}

describe('platform server URL configuration', () => {
  test('PlatformApi throws without apiURI', () => {
    expect(() => new PlatformApi()).toThrow(MissingApiURIError);
    expect(() => new PlatformApi({ auth: { token: 'token' } })).toThrow(
      missingMessage('new PlatformApi()'),
    );
  });

  test('OAuthHandler throws without apiURI', () => {
    expect(
      () =>
        new OAuthHandler({
          clientId: 'client-id',
          redirectUri: 'https://app.example.com/callback',
        }),
    ).toThrow(missingMessage('new OAuthHandler()'));
  });

  test('OAuthHandler keeps an explicit apiURI', () => {
    const handler = new OAuthHandler({
      clientId: 'client-id',
      redirectUri: 'https://app.example.com/callback',
      apiURI: 'http://localhost:8888',
    });
    expect(handler.apiURI).toBe('http://localhost:8888');
  });

  test('token exchange helpers reject without apiURI', async () => {
    await expect(
      exchangeCodeForToken({
        code: 'code',
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'https://app.example.com/callback',
      }),
    ).rejects.toThrow(missingMessage('exchangeCodeForToken()'));
    await expect(
      exchangeRefreshToken({
        clientId: 'client-id',
        clientSecret: 'secret',
        refreshToken: 'refresh',
      }),
    ).rejects.toThrow(missingMessage('exchangeRefreshToken()'));
  });
});
