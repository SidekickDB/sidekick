// Runs the storage-key rename command exactly as written in
// self-hosting/README.md ("Renaming the storage keys"), as if typed into each
// shell installed here (sh, bash, zsh, dash), on several .env shapes, twice
// each. Run with: node --test scripts/self-hosting/
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const readme = fs.readFileSync(
  path.join(root, 'self-hosting/README.md'),
  'utf8',
);

// The first ```sh block after the "Renaming the storage keys" heading.
function readmeCommand() {
  const section = readme.slice(readme.indexOf('### Renaming the storage keys'));
  const m = section.match(/```sh\n([\s\S]*?)\n```/);
  assert.ok(m, 'no ```sh block under "Renaming the storage keys"');
  return m[1];
}

const shells = ['sh', 'bash', 'zsh', 'dash'].filter(
  (s) => spawnSync(s, ['-c', 'true']).status === 0,
);

const shapes = [
  {
    name: 'only the old names',
    env: 'A=1\nMINIO_ROOT_USER=u\nMINIO_ROOT_PASSWORD=p\n',
    want: 'A=1\nSTORAGE_ACCESS_KEY=u\nSTORAGE_SECRET_KEY=p\n',
  },
  {
    name: 'old names and empty new lines',
    env: 'STORAGE_ACCESS_KEY=\nSTORAGE_SECRET_KEY=\nMINIO_ROOT_USER=u\nMINIO_ROOT_PASSWORD=p\n',
    want: 'STORAGE_ACCESS_KEY=u\nSTORAGE_SECRET_KEY=p\n',
  },
  {
    name: 'both set: new names kept, old ignored',
    env: 'STORAGE_ACCESS_KEY=n\nSTORAGE_SECRET_KEY=s\nMINIO_ROOT_USER=u\nMINIO_ROOT_PASSWORD=p\n',
    want: 'STORAGE_ACCESS_KEY=n\nSTORAGE_SECRET_KEY=s\nMINIO_ROOT_USER=u\nMINIO_ROOT_PASSWORD=p\n',
  },
  {
    name: 'neither: nothing changes',
    env: 'STORAGE_ACCESS_KEY=\nSTORAGE_SECRET_KEY=\n',
    want: 'STORAGE_ACCESS_KEY=\nSTORAGE_SECRET_KEY=\n',
  },
];

test('at least sh and bash are available', () => {
  assert.ok(shells.includes('sh') && shells.includes('bash'), shells.join());
});

for (const shell of shells) {
  for (const shape of shapes) {
    test(`${shell}: ${shape.name}`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-rename-'));
      try {
        const env = path.join(dir, '.env');
        fs.writeFileSync(env, shape.env, { mode: 0o600 });
        for (let i = 0; i < 2; i++) {
          const r = spawnSync(shell, ['-c', readmeCommand()], {
            cwd: dir,
            encoding: 'utf8',
          });
          assert.equal(r.status, 0, `run ${i + 1} failed: ${r.stderr}`);
          assert.equal(
            fs.readFileSync(env, 'utf8'),
            shape.want,
            `after run ${i + 1}`,
          );
        }
        // The backup is the original file and was not overwritten.
        assert.equal(
          fs.readFileSync(path.join(dir, '.env.before-storage-rename'), 'utf8'),
          shape.env,
        );
        assert.equal(fs.statSync(env).mode & 0o777, 0o600);
        assert.ok(!fs.existsSync(path.join(dir, '.env.rename-tmp')));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}

test('an existing backup is never overwritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-rename-'));
  try {
    fs.writeFileSync(path.join(dir, '.env.before-storage-rename'), 'KEEP\n');
    fs.writeFileSync(path.join(dir, '.env'), 'MINIO_ROOT_USER=u\n');
    const r = spawnSync('sh', ['-c', readmeCommand()], { cwd: dir });
    assert.equal(r.status, 0);
    assert.equal(
      fs.readFileSync(path.join(dir, '.env.before-storage-rename'), 'utf8'),
      'KEEP\n',
    );
    assert.equal(
      fs.readFileSync(path.join(dir, '.env'), 'utf8'),
      'STORAGE_ACCESS_KEY=u\n',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
