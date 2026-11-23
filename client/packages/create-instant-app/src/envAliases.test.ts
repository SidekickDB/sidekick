import { describe, expect, it } from 'vitest';
import { applyEnvAliases, legacyEnvName } from './envAliases.js';

describe('legacyEnvName', () => {
  it('maps SIDEKICK_ names onto INSTANT_ names', () => {
    expect(legacyEnvName('SIDEKICK_CLI_API_URI')).toBe('INSTANT_CLI_API_URI');
    expect(legacyEnvName('SIDEKICK_CLI_DEV')).toBe('INSTANT_CLI_DEV');
    expect(legacyEnvName('VITE_SIDEKICK_APP_ID')).toBe('VITE_INSTANT_APP_ID');
  });

  it('ignores every other name', () => {
    expect(legacyEnvName('INSTANT_CLI_API_URI')).toBeNull();
    expect(legacyEnvName('MYSIDEKICK_APP_ID')).toBeNull();
    expect(legacyEnvName('PATH')).toBeNull();
  });
});

describe('applyEnvAliases', () => {
  it('sets the INSTANT_ name from the SIDEKICK_ one, which wins', () => {
    const env: Record<string, string | undefined> = {
      INSTANT_CLI_API_URI: 'https://old.example',
      SIDEKICK_CLI_API_URI: 'https://new.example',
      SIDEKICK_CLI_DASH_URI: 'https://dash.new.example',
    };
    applyEnvAliases(env);
    expect(env.INSTANT_CLI_API_URI).toBe('https://new.example');
    expect(env.INSTANT_CLI_DASH_URI).toBe('https://dash.new.example');
  });

  it('treats a blank SIDEKICK_ value as unset', () => {
    const env: Record<string, string | undefined> = {
      INSTANT_CLI_API_URI: 'https://old.example',
      SIDEKICK_CLI_API_URI: ' ',
    };
    applyEnvAliases(env);
    expect(env.INSTANT_CLI_API_URI).toBe('https://old.example');
  });
});
