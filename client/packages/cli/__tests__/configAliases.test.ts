import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  applyEnvAliases,
  envNameForDisplay,
  legacyEnvName,
} from '../src/util/envAliases.ts';
import {
  getEmailReadCandidates,
  getPermsReadCandidates,
  getSchemaReadCandidates,
  withSidekickFileNames,
} from '../src/util/findConfigCandidates.ts';
import { readInstantConfigFile } from '../src/util/instantConfig.ts';

describe('legacyEnvName', () => {
  test('maps SIDEKICK_ names onto INSTANT_ names', () => {
    expect(legacyEnvName('SIDEKICK_APP_ID')).toBe('INSTANT_APP_ID');
    expect(legacyEnvName('SIDEKICK_CLI_API_URI')).toBe('INSTANT_CLI_API_URI');
    expect(legacyEnvName('SIDEKICK_SCHEMA_FILE_PATH')).toBe(
      'INSTANT_SCHEMA_FILE_PATH',
    );
  });

  test('keeps a framework prefix', () => {
    expect(legacyEnvName('NEXT_PUBLIC_SIDEKICK_APP_ID')).toBe(
      'NEXT_PUBLIC_INSTANT_APP_ID',
    );
    expect(legacyEnvName('VITE_SIDEKICK_APP_ID')).toBe('VITE_INSTANT_APP_ID');
    expect(legacyEnvName('PUBLIC_SIDEKICK_APP_ID')).toBe(
      'PUBLIC_INSTANT_APP_ID',
    );
  });

  test('ignores every other name', () => {
    expect(legacyEnvName('INSTANT_APP_ID')).toBeNull();
    expect(legacyEnvName('PATH')).toBeNull();
    expect(legacyEnvName('SIDEKICK')).toBeNull();
    expect(legacyEnvName('SIDEKICK_')).toBeNull();
    expect(legacyEnvName('MYSIDEKICK_APP_ID')).toBeNull();
    expect(legacyEnvName('sidekick_app_id')).toBeNull();
  });
});

describe('applyEnvAliases', () => {
  test('a SIDEKICK_ variable sets its INSTANT_ name', () => {
    const env: Record<string, string | undefined> = {
      SIDEKICK_CLI_API_URI: 'https://new.example',
      NEXT_PUBLIC_SIDEKICK_APP_ID: 'new-app',
      PATH: '/bin',
    };
    expect(applyEnvAliases(env)).toEqual({
      INSTANT_CLI_API_URI: 'SIDEKICK_CLI_API_URI',
      NEXT_PUBLIC_INSTANT_APP_ID: 'NEXT_PUBLIC_SIDEKICK_APP_ID',
    });
    expect(env.INSTANT_CLI_API_URI).toBe('https://new.example');
    expect(env.NEXT_PUBLIC_INSTANT_APP_ID).toBe('new-app');
    expect(env.PATH).toBe('/bin');
  });

  test('the SIDEKICK_ name wins when both are set', () => {
    const env: Record<string, string | undefined> = {
      INSTANT_APP_ID: 'old-app',
      SIDEKICK_APP_ID: 'new-app',
    };
    applyEnvAliases(env);
    expect(env.INSTANT_APP_ID).toBe('new-app');
  });

  test('a blank SIDEKICK_ value counts as unset', () => {
    const env: Record<string, string | undefined> = {
      INSTANT_APP_ID: 'old-app',
      SIDEKICK_APP_ID: '  ',
      SIDEKICK_ADMIN_TOKEN: '',
    };
    expect(applyEnvAliases(env)).toEqual({});
    expect(env.INSTANT_APP_ID).toBe('old-app');
    expect('INSTANT_ADMIN_TOKEN' in env).toBe(false);
  });

  test('the INSTANT_ names keep working on their own', () => {
    const env: Record<string, string | undefined> = {
      INSTANT_APP_ID: 'old-app',
    };
    expect(applyEnvAliases(env)).toEqual({});
    expect(env).toEqual({ INSTANT_APP_ID: 'old-app' });
  });

  describe('on process.env', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    test('messages show the name the value was set under', () => {
      vi.stubEnv('SIDEKICK_PERMS_FILE_PATH', 'perms/custom.ts');
      vi.stubEnv('INSTANT_PERMS_FILE_PATH', undefined);
      vi.stubEnv('INSTANT_EMAIL_FILE_PATH', 'email/custom.ts');
      applyEnvAliases();

      expect(process.env.INSTANT_PERMS_FILE_PATH).toBe('perms/custom.ts');
      expect(envNameForDisplay('INSTANT_PERMS_FILE_PATH')).toBe(
        'SIDEKICK_PERMS_FILE_PATH',
      );
      expect(envNameForDisplay('INSTANT_EMAIL_FILE_PATH')).toBe(
        'INSTANT_EMAIL_FILE_PATH',
      );
    });
  });
});

describe('sidekick.* config file names', () => {
  const transform = (code: string) => code;

  test('each instant.* candidate gets a sidekick.* one, listed first', () => {
    const candidates = [
      { files: 'instant.schema', extensions: ['ts'], transform },
      { files: 'src/lib/instant.schema', extensions: ['ts'], transform },
      { files: 'app/instant.schema', extensions: ['ts'], transform },
    ];
    expect(withSidekickFileNames(candidates).map((c) => c.files)).toEqual([
      'sidekick.schema',
      'src/lib/sidekick.schema',
      'app/sidekick.schema',
      'instant.schema',
      'src/lib/instant.schema',
      'app/instant.schema',
    ]);
  });

  test('only the file name changes', () => {
    const candidates = [
      { files: 'src/instant.app/instant.perms', transform },
      { files: 'my-instant.email', transform },
    ];
    expect(withSidekickFileNames(candidates).map((c) => c.files)).toEqual([
      'src/instant.app/sidekick.perms',
      'src/instant.app/instant.perms',
      'my-instant.email',
    ]);
  });

  describe('read candidates', () => {
    beforeEach(() => {
      vi.stubEnv('INSTANT_SCHEMA_FILE_PATH', undefined);
      vi.stubEnv('INSTANT_PERMS_FILE_PATH', undefined);
      vi.stubEnv('INSTANT_EMAIL_FILE_PATH', undefined);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    test.each([
      ['schema', getSchemaReadCandidates],
      ['perms', getPermsReadCandidates],
      ['email', () => getEmailReadCandidates()],
    ] as const)('%s: sidekick.* comes before instant.*', (kind, candidates) => {
      const files = candidates().map((c) => c.files);
      const firstLegacy = files.findIndex((f) => f.includes('instant.'));

      expect(files[0]).toBe(`sidekick.${kind}`);
      expect(files).toContain(`app/sidekick.${kind}`);
      expect(files).toContain(`instant.${kind}`);
      expect(files).toContain(`app/instant.${kind}`);
      expect(firstLegacy).toBeGreaterThan(0);
      expect(
        files.slice(firstLegacy).some((f) => f.includes('sidekick.')),
      ).toBe(false);
    });

    test('an explicit path is used as it is', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.stubEnv('INSTANT_SCHEMA_FILE_PATH', 'db/instant.schema.ts');
      expect(getSchemaReadCandidates().map((c) => c.files)).toEqual([
        'db/instant.schema.ts',
      ]);
    });
  });
});

describe('sidekick.config', () => {
  let dir: string;
  let cwd: { mockRestore: () => void };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sidekick-cli-config-'));
    writeFileSync(join(dir, 'package.json'), '{"name":"config-test"}');
    cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir);
  });

  afterEach(() => {
    cwd.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  test('instant.config.json still works', async () => {
    writeFileSync(
      join(dir, 'instant.config.json'),
      JSON.stringify({ apiURI: 'https://old.example' }),
    );
    expect(await readInstantConfigFile()).toEqual({
      apiURI: 'https://old.example',
    });
  });

  test('sidekick.config.json is read', async () => {
    writeFileSync(
      join(dir, 'sidekick.config.json'),
      JSON.stringify({ apiURI: 'https://new.example' }),
    );
    expect(await readInstantConfigFile()).toEqual({
      apiURI: 'https://new.example',
    });
  });

  test('sidekick.config wins over instant.config', async () => {
    writeFileSync(
      join(dir, 'instant.config.json'),
      JSON.stringify({ apiURI: 'https://old.example' }),
    );
    writeFileSync(
      join(dir, 'sidekick.config.json'),
      JSON.stringify({ apiURI: 'https://new.example' }),
    );
    expect(await readInstantConfigFile()).toEqual({
      apiURI: 'https://new.example',
    });
  });
});
