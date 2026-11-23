import fs from 'fs-extra';
import {
  permsTypescriptFileToCode,
  schemaTypescriptFileToInstantSchema,
} from '@sidekickdb/platform';

export function getRules(
  projectDir: string,
): { code: Record<string, any> } | null {
  // sidekick.* is the SidekickDB name for instant.*, and wins.
  for (const path of [
    'src/sidekick.perms.ts',
    'sidekick.perms.ts',
    'src/instant.perms.ts',
    'instant.perms.ts',
  ]) {
    try {
      const content = fs.readFileSync(`${projectDir}/${path}`, 'utf8');
      return { code: permsTypescriptFileToCode(content, path) };
    } catch (_e) {}
  }
  return null;
}

export function getSchema(
  projectDir: string,
): ReturnType<typeof schemaTypescriptFileToInstantSchema> | null {
  for (const path of [
    'src/sidekick.schema.ts',
    'sidekick.schema.ts',
    'src/instant.schema.ts',
    'instant.schema.ts',
  ]) {
    try {
      const content = fs.readFileSync(`${projectDir}/${path}`, 'utf8');
      return schemaTypescriptFileToInstantSchema(content, path);
    } catch (_e) {}
  }
  return null;
}
