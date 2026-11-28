// Runs self-hosting/deploy-swarm.sh with stand-ins for `docker` and `ssh`, so
// nothing is rendered by Docker and nothing leaves this machine. Checks that
// the script passes every variable swarm.yml reads, that SIDEKICK_* names win,
// and that it deploys only when the server_config secret exists and never
// creates or replaces it. Run with: node --test scripts/self-hosting/
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
const script = path.join(root, 'self-hosting/deploy-swarm.sh');
const swarm = fs.readFileSync(path.join(root, 'self-hosting/swarm.yml'), 'utf8');

// Every ${VAR...} that `docker stack config` substitutes. $${VAR} is an
// escaped literal for the container's shell, not read from the environment.
const swarmVars = [
  ...new Set(
    [...swarm.matchAll(/(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)/g)].map(
      (m) => m[1],
    ),
  ),
].sort();
const serverImage = swarm.match(/\$\{SERVER_IMAGE:-([^}]+)\}/)[1];

const RENDERED = 'rendered-stack-config';

// A directory with `docker` and `ssh` stand-ins. Paths are written into the
// stand-ins because the script runs `docker stack config` under `env -i`.
function stubs({ secrets = '', renderFails = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-deploy-swarm-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(dir, 'secrets'), secrets);
  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/sh
[ "$*" = "stack config --compose-file swarm.yml" ] || { echo "unexpected docker $*" >&2; exit 2; }
env > '${dir}/stack-env'
${renderFails ? 'echo "render failed" >&2; exit 1' : `echo ${RENDERED}`}
`,
  );
  fs.writeFileSync(
    path.join(bin, 'ssh'),
    `#!/bin/sh
printf '%s\\n' "$*" >> '${dir}/ssh-log'
case "$*" in
  *"docker secret ls"*) cat '${dir}/secrets' ;;
  *"docker stack deploy -c - instant"*) cat > '${dir}/deployed' ;;
  *) echo "unexpected ssh $*" >&2; exit 2 ;;
esac
`,
  );
  fs.chmodSync(path.join(bin, 'docker'), 0o755);
  fs.chmodSync(path.join(bin, 'ssh'), 0o755);
  const read = (f) => {
    const p = path.join(dir, f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };
  return { dir, bin, read };
}

function run(stub, env) {
  return spawnSync(script, [], {
    encoding: 'utf8',
    env: {
      PATH: `${stub.bin}:${process.env.PATH}`,
      HOME: stub.dir,
      SSH_HOST: 'root@203.0.113.10',
      ...env,
    },
  });
}

const valueFor = (name) => `value-of-${name}`;
const allSet = Object.fromEntries(swarmVars.map((v) => [v, valueFor(v)]));

function stackEnv(stub) {
  const text = stub.read('stack-env');
  assert.ok(text !== null, 'docker stack config did not run');
  return Object.fromEntries(
    text
      .trim()
      .split('\n')
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
}

function neverTouchesSecrets(stub) {
  const log = stub.read('ssh-log') ?? '';
  assert.doesNotMatch(log, /secret (create|rm|remove|update)/);
}

test('swarm.yml variables are found', () => {
  for (const v of [
    'POSTGRES_PASSWORD',
    'POSTMARK_TOKEN',
    'POSTMARK_ACCOUNT_TOKEN',
    'INSTANT_TEAM_EMAIL_SENDER_EMAIL',
    'INSTANT_NREPL',
    'S3_BUCKET',
    'SERVER_IMAGE',
  ])
    assert.ok(swarmVars.includes(v), `${v} not found in swarm.yml`);
  assert.ok(!swarmVars.includes('ACCESS_KEY'), 'escaped $$ read as a variable');
});

test('passes every variable swarm.yml reads, and nothing else', () => {
  const stub = stubs({ secrets: 'server_config\n' });
  const r = run(stub, { ...allSet, UNRELATED_HOST_VARIABLE: 'leak' });
  assert.equal(r.status, 0, r.stderr);
  // PATH is passed on purpose; the others are set by the stand-in's shell.
  const passed = stackEnv(stub);
  for (const k of ['PATH', 'PWD', 'OLDPWD', 'SHLVL', '_']) delete passed[k];
  const missing = swarmVars.filter((v) => passed[v] !== valueFor(v));
  assert.deepEqual(missing, [], 'swarm.yml reads these, the script drops them');
  const extra = Object.keys(passed).filter((k) => !swarmVars.includes(k));
  assert.deepEqual(extra, [], 'passed although swarm.yml does not read them');
});

test('SIDEKICK_* names win over INSTANT_* names', () => {
  const instant = swarmVars.filter((v) => v.startsWith('INSTANT_'));
  assert.ok(instant.length > 0);
  const sidekick = Object.fromEntries(
    instant.map((v) => [`SIDEKICK_${v.slice(8)}`, `sidekick-${v}`]),
  );
  const stub = stubs({ secrets: 'server_config\n' });
  const r = run(stub, { ...allSet, ...sidekick });
  assert.equal(r.status, 0, r.stderr);
  const env = stackEnv(stub);
  for (const v of instant) assert.equal(env[v], `sidekick-${v}`, v);
});

test('existing server_config: deploys the rendered config, secret untouched', () => {
  const stub = stubs({ secrets: 'other\nserver_config\n' });
  const r = run(stub, allSet);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(stub.read('deployed'), `${RENDERED}\n`);
  neverTouchesSecrets(stub);
});

test('missing server_config: stops with the commands, deploys nothing', () => {
  // Names that only contain server_config do not count.
  const stub = stubs({ secrets: 'server_config_old\nmy_server_config\n' });
  // Without SERVER_IMAGE the commands name swarm.yml's default image.
  const { SERVER_IMAGE: _image, ...env } = allSet;
  const r = run(stub, env);
  assert.notEqual(r.status, 0);
  assert.equal(stub.read('deployed'), null);
  neverTouchesSecrets(stub);
  assert.match(r.stderr, /no secret named server_config/);
  assert.ok(
    r.stderr.includes(
      `${serverImage} \\\n    /app/start.sh generate-override-config /out/override.edn`,
    ),
    r.stderr,
  );
  assert.match(
    r.stderr,
    /docker secret create server_config sidekick-config\/override\.edn/,
  );
  assert.match(r.stderr, /Do not generate it again/);
});

test('a failed render stops before anything is sent to the manager', () => {
  const stub = stubs({ secrets: 'server_config\n', renderFails: true });
  const r = run(stub, allSet);
  assert.notEqual(r.status, 0);
  assert.equal(stub.read('ssh-log'), null);
});

test('README documents creating server_config once', () => {
  const readme = fs.readFileSync(
    path.join(root, 'self-hosting/README.md'),
    'utf8',
  );
  for (const want of [
    'generate-override-config /out/override.edn',
    'docker secret create server_config',
  ])
    assert.ok(readme.includes(want), `README.md lacks ${want}`);
});
