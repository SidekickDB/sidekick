import { describe, expect, test } from 'vitest';
import { i } from '@sidekickdb/core';
import {
  generatePermsTypescriptFile,
  generateSchemaTypescriptFile,
} from '@sidekickdb/platform';
import { getInstantModuleName } from '../src/context/projectInfo.ts';
import { transformImports } from '../src/util/findConfigCandidates.ts';

const schema = i.schema({
  entities: { todos: i.entity({ text: i.string() }) },
});

describe('getInstantModuleName', () => {
  test('a project that only depends on legacy @instantdb/react keeps it', () => {
    const moduleName = getInstantModuleName({
      dependencies: { '@instantdb/react': '^0.22.0' },
    });
    expect(moduleName).toBe('@instantdb/react');

    // Generated schema and perms files keep importing the legacy package.
    expect(generateSchemaTypescriptFile(null, schema, moduleName!)).toContain(
      `import { i } from "@instantdb/react";`,
    );
    expect(generatePermsTypescriptFile(null, moduleName!)).toContain(
      `import type { InstantRules } from "@instantdb/react";`,
    );
  });

  test('legacy packages in devDependencies are detected too', () => {
    expect(
      getInstantModuleName({ devDependencies: { '@instantdb/admin': '*' } }),
    ).toBe('@instantdb/admin');
  });

  test('prefers @sidekickdb/* when both scopes are present', () => {
    expect(
      getInstantModuleName({
        dependencies: {
          '@instantdb/react': '^0.22.0',
          '@sidekickdb/react': '^1.0.0',
        },
      }),
    ).toBe('@sidekickdb/react');

    // Even when the legacy package comes earlier in the SDK order.
    expect(
      getInstantModuleName({
        dependencies: { '@instantdb/react': '^0.22.0' },
        devDependencies: { '@sidekickdb/vue': '^1.0.0' },
      }),
    ).toBe('@sidekickdb/vue');
  });

  test('a project on @sidekickdb/* resolves to it', () => {
    expect(
      getInstantModuleName({ dependencies: { '@sidekickdb/core': '^1.0.0' } }),
    ).toBe('@sidekickdb/core');
  });

  test('returns undefined when no SDK is installed', () => {
    expect(
      getInstantModuleName({ dependencies: { react: '^18.0.0' } }),
    ).toBeUndefined();
  });
});

describe('transformImports', () => {
  for (const scope of ['@sidekickdb', '@instantdb']) {
    for (const pkg of ['react-native', 'svelte', 'vue']) {
      test(`rewrites ${scope}/${pkg} to its dist/cli entry, keeping the scope`, () => {
        expect(transformImports(`import { i } from '${scope}/${pkg}';`)).toBe(
          `import { i } from "${scope}/${pkg}/dist/cli";`,
        );
        expect(transformImports(`import { i } from "${scope}/${pkg}";`)).toBe(
          `import { i } from "${scope}/${pkg}/dist/cli";`,
        );
      });
    }
  }

  test('leaves other packages and subpaths alone', () => {
    const code = [
      `import { i } from '@sidekickdb/react';`,
      `import { i as j } from '@instantdb/core';`,
      `import { x } from '@instantdb/react-native/dist/cli';`,
      `import { y } from '@other/vue';`,
    ].join('\n');
    expect(transformImports(code)).toBe(code);
  });

  test('rewrites mixed-scope imports in one file independently', () => {
    const code = [
      `import { i } from '@instantdb/vue';`,
      `import { id } from '@sidekickdb/svelte';`,
    ].join('\n');
    expect(transformImports(code)).toBe(
      [
        `import { i } from "@instantdb/vue/dist/cli";`,
        `import { id } from "@sidekickdb/svelte/dist/cli";`,
      ].join('\n'),
    );
  });
});
