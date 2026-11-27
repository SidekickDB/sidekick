// SidekickDB: the dashboard serves the code editor and its type files itself,
// so the browser loads them from the dashboard instead of a CDN. This copies
// Monaco's AMD build and the type declarations of @sidekickdb/core into
// public/monaco (git-ignored). Runs before `next dev` and `next build`.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const www = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(www, 'public', 'monaco');

const packageDir = (name) =>
  path.dirname(require.resolve(`${name}/package.json`, { paths: [www] }));

const vs = path.join(packageDir('monaco-editor'), 'min', 'vs');
const types = path.join(packageDir('@sidekickdb/core'), 'dist', 'esm');

if (!existsSync(types)) {
  console.error(
    `copy-editor-assets: ${types} is missing; build the packages first (pnpm build-packages in client/).`,
  );
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
cpSync(vs, path.join(out, 'vs'), { recursive: true });
mkdirSync(path.join(out, 'types'), { recursive: true });
for (const file of readdirSync(types)) {
  if (file.endsWith('.d.ts')) {
    cpSync(path.join(types, file), path.join(out, 'types', file));
  }
}
