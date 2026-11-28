// Renders the self-hosting compose files with `docker compose config` (and
// swarm.yml with `docker stack config`) for each way a user can fill in .env,
// and checks that each one either renders with the right credentials or stops
// with a message that names the variable to set. It also checks that no file
// publishes the Postgres port beyond 127.0.0.1 unless POSTGRES_BIND_ADDRESS
// asks for another address, that every file starts Postgres with JIT off, and
// that every createbuckets service sets the lifecycle rule for app backups.
// Client-side only: no
// containers, images or daemon are used.
//
//   node scripts/self-hosting/render-check.mjs \
//     [--compose "docker compose"] [--compose /path/to/docker-compose] ...
//
// Each --compose is a Compose command (a plugin form such as "docker compose"
// or a standalone binary). Every case runs on every one, so the result shows
// whether a behaviour depends on the Compose version. Exits 1 if any case
// does not behave as expected.
//
// Rule for the compose files: a required variable is a plain ${VAR:?message}
// and a ":?" never appears inside a default (Compose 2.38 evaluates it even
// when the outer variable is set). Nested ":-" defaults, used by the
// SIDEKICK_* aliases, are fine and asserted here.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const dir = path.join(root, 'self-hosting');

const { values: args } = parseArgs({
  options: { compose: { type: 'string', multiple: true } },
});
const composes = args.compose?.length ? args.compose : ['docker compose'];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-render-check-'));

// A clean environment, so variables of the machine running the check cannot
// change the result. Compose reads the values from --env-file.
const baseEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME ?? tmp,
  ...(process.env.DOCKER_CONFIG
    ? { DOCKER_CONFIG: process.env.DOCKER_CONFIG }
    : {}),
};

function exec(cmd, argv, env = {}) {
  const [bin, ...pre] = cmd.split(' ');
  const r = spawnSync(bin, [...pre, ...argv], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...baseEnv, ...env },
  });
  return {
    ok: r.status === 0,
    stdout: r.stdout ?? '',
    stderr: (r.stderr ?? '') + (r.error ? String(r.error) : ''),
  };
}

function version(cmd) {
  return exec(cmd, ['version', '--short']).stdout.trim() || '(unknown)';
}

// .env.example with the given values set (or blanked) and nothing else
// changed. Lines for variables the example does not have are appended.
function envFile(name, values) {
  const lines = fs
    .readFileSync(path.join(dir, '.env.example'), 'utf8')
    .split('\n');
  const seen = new Set();
  const out = lines.map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m && m[1] in values) {
      seen.add(m[1]);
      return `${m[1]}=${values[m[1]]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(values))
    if (!seen.has(k)) out.push(`${k}=${v}`);
  const file = path.join(tmp, `${name}.env`);
  fs.writeFileSync(file, out.join('\n') + '\n');
  return file;
}

function renderCompose(cmd, file, env) {
  const r = exec(cmd, [
    '-f',
    file,
    '--env-file',
    env,
    'config',
    '--format',
    'json',
  ]);
  let config = null;
  if (r.ok) {
    try {
      config = JSON.parse(r.stdout);
    } catch {
      return {
        ok: false,
        stderr: `could not parse JSON: ${r.stdout.slice(0, 200)}`,
      };
    }
  }
  return { ok: r.ok, config, stderr: r.stderr };
}

const envOf = (config, service) =>
  config?.services?.[service]?.environment ?? {};

// What a user can have in .env. Values are recognisable so the rendered output
// shows where each credential came from.
const PG = 'pg-secret-value';
const AK = 'storage-access-value';
const SK = 'storage-secret-value';
const OLD_AK = 'old-minio-user-value';
const OLD_SK = 'old-minio-password-value';

const cases = [
  {
    name: 'STORAGE_* set',
    values: {
      POSTGRES_PASSWORD: PG,
      STORAGE_ACCESS_KEY: AK,
      STORAGE_SECRET_KEY: SK,
    },
    expect: { ok: true, access: AK, secret: SK },
  },
  {
    name: 'only MINIO_ROOT_* set (older .env)',
    values: {
      POSTGRES_PASSWORD: PG,
      STORAGE_ACCESS_KEY: '',
      STORAGE_SECRET_KEY: '',
      MINIO_ROOT_USER: OLD_AK,
      MINIO_ROOT_PASSWORD: OLD_SK,
    },
    // Must stop, naming the new variables and telling the user to rename the
    // old ones. Never an empty credential.
    expect: {
      ok: false,
      mentions: [
        /STORAGE_(ACCESS|SECRET)_KEY/,
        /MINIO_ROOT_USER/,
        /MINIO_ROOT_PASSWORD/,
        /rename/i,
      ],
    },
  },
  {
    name: 'both set',
    values: {
      POSTGRES_PASSWORD: PG,
      STORAGE_ACCESS_KEY: AK,
      STORAGE_SECRET_KEY: SK,
      MINIO_ROOT_USER: OLD_AK,
      MINIO_ROOT_PASSWORD: OLD_SK,
    },
    expect: { ok: true, access: AK, secret: SK },
  },
  {
    name: 'neither set',
    values: {
      POSTGRES_PASSWORD: PG,
      STORAGE_ACCESS_KEY: '',
      STORAGE_SECRET_KEY: '',
    },
    expect: { ok: false, mentions: [/STORAGE_(ACCESS|SECRET)_KEY/] },
  },
  {
    name: 'STORAGE_ACCESS_KEY empty, secret set',
    values: {
      POSTGRES_PASSWORD: PG,
      STORAGE_ACCESS_KEY: '',
      STORAGE_SECRET_KEY: SK,
    },
    expect: { ok: false, mentions: [/STORAGE_ACCESS_KEY/] },
  },
  {
    name: 'POSTGRES_PASSWORD empty',
    values: {
      POSTGRES_PASSWORD: '',
      STORAGE_ACCESS_KEY: AK,
      STORAGE_SECRET_KEY: SK,
    },
    expect: { ok: false, mentions: [/POSTGRES_PASSWORD/] },
  },
];

// Credentials as the services receive them.
function credentials(config) {
  return {
    storage: [
      envOf(config, 'storage').RUSTFS_ACCESS_KEY,
      envOf(config, 'storage').RUSTFS_SECRET_KEY,
    ],
    createbuckets: [
      envOf(config, 'createbuckets').ACCESS_KEY,
      envOf(config, 'createbuckets').SECRET_KEY,
    ],
    server: [
      envOf(config, 'server').AWS_ACCESS_KEY_ID,
      envOf(config, 'server').AWS_SECRET_ACCESS_KEY,
    ],
    postgres: envOf(config, 'postgres').POSTGRES_PASSWORD,
    database_url: envOf(config, 'server').DATABASE_URL,
  };
}

function checkRendered(config, access, secret, pg) {
  const c = credentials(config);
  const problems = [];
  for (const svc of ['storage', 'createbuckets', 'server']) {
    if (c[svc][0] !== access || c[svc][1] !== secret) {
      problems.push(
        `${svc} got ${JSON.stringify(c[svc])}, expected ["${access}","${secret}"]`,
      );
    }
  }
  if (c.postgres !== pg)
    problems.push(
      `postgres got ${JSON.stringify(c.postgres)}, expected "${pg}"`,
    );
  if (!String(c.database_url).includes(`:${pg}@`)) {
    problems.push(
      `DATABASE_URL does not carry the postgres password: ${c.database_url}`,
    );
  }
  return problems;
}

// The createbuckets script (its `sh -c` argument) must import the lifecycle
// rule that removes app backup files: tag expire=true, 32 days, on the backups
// bucket only, after that bucket exists, with `set -e` so a failed import
// fails the service (see README.md, "Object storage").
function lifecycleProblems(script) {
  const problems = [];
  if (!script.trim().startsWith('set -e;'))
    problems.push('createbuckets script does not start with set -e');
  const m = script.match(/printf '%s' '(\{[^']*\})' > (\S+);/);
  if (!m) return [...problems, 'createbuckets writes no lifecycle JSON'];
  let rules = [];
  try {
    rules = JSON.parse(m[1]).rules ?? [];
  } catch {
    return [...problems, `lifecycle JSON does not parse: ${m[1]}`];
  }
  const r = rules[0] ?? {};
  if (
    rules.length !== 1 ||
    r.status !== 'Enabled' ||
    JSON.stringify(r.tags) !== '{"expire":"true"}' ||
    r.expiration?.days !== 32 ||
    'prefix' in r
  )
    problems.push(
      `expected one enabled rule, tag expire=true, 32 days: ${m[1]}`,
    );
  const bucket = '\\$+S3_APP_BACKUPS_BUCKET';
  const create = script.search(
    new RegExp(`rc bucket create --ignore-existing local/${bucket};`),
  );
  const imp = new RegExp(
    `rc bucket lifecycle rule import local/${bucket} (\\S+);`,
  ).exec(script);
  if (imp?.[1] !== m[2])
    problems.push(
      `no rc bucket lifecycle rule import of ${m[2]} on the backups bucket`,
    );
  else if (create === -1 || create > imp.index)
    problems.push('lifecycle import runs before the backups bucket exists');
  return problems;
}

const results = [];
function record(compose, file, name, problems, detail = '') {
  results.push({
    compose,
    file,
    name,
    pass: problems.length === 0,
    problems,
    detail,
  });
}

for (const cmd of composes) {
  const v = version(cmd);
  const label = `${cmd} (${v})`;

  for (const file of ['docker-compose.yml', 'docker-compose.with-caddy.yml']) {
    for (const c of cases) {
      const r = renderCompose(
        cmd,
        file,
        envFile(`${file}-${c.name.replace(/\W+/g, '_')}`, c.values),
      );
      const problems = [];
      if (c.expect.ok) {
        if (!r.ok)
          problems.push(
            `did not render: ${r.stderr.trim().split('\n').at(-1)}`,
          );
        else
          problems.push(
            ...checkRendered(r.config, c.expect.access, c.expect.secret, PG),
          );
      } else if (r.ok) {
        problems.push(
          `rendered, but should have stopped. Credentials: ${JSON.stringify(credentials(r.config))}`,
        );
      } else {
        for (const re of c.expect.mentions) {
          if (!re.test(r.stderr))
            problems.push(
              `error does not mention ${re}: ${r.stderr.trim().split('\n').at(-1)}`,
            );
        }
      }
      record(
        label,
        file,
        c.name,
        problems,
        r.ok ? 'rendered' : r.stderr.trim().split('\n').at(-1),
      );
    }
  }

  // Local development file: renders without any secrets and then uses the
  // documented local defaults; values from .env win.
  {
    const file = 'docker-compose.local.yml';
    const none = renderCompose(
      cmd,
      file,
      envFile('local-none', {
        POSTGRES_PASSWORD: '',
        STORAGE_ACCESS_KEY: '',
        STORAGE_SECRET_KEY: '',
      }),
    );
    const p1 = none.ok
      ? checkRendered(none.config, 'rustfsadmin', 'rustfsadmin', 'pass')
      : [`did not render: ${none.stderr.trim().split('\n').at(-1)}`];
    record(
      label,
      file,
      'no secrets: local defaults',
      p1,
      none.ok ? 'rendered' : none.stderr.trim(),
    );
    const set = renderCompose(
      cmd,
      file,
      envFile('local-set', {
        POSTGRES_PASSWORD: PG,
        STORAGE_ACCESS_KEY: AK,
        STORAGE_SECRET_KEY: SK,
      }),
    );
    const p2 = set.ok
      ? checkRendered(set.config, AK, SK, PG)
      : [`did not render: ${set.stderr.trim().split('\n').at(-1)}`];
    record(
      label,
      file,
      'secrets set',
      p2,
      set.ok ? 'rendered' : set.stderr.trim(),
    );
  }

  // The SIDEKICK_* aliases (#19) use nested ":-" defaults,
  // ${SIDEKICK_X:-${INSTANT_X:-default}}, in every compose file, so this is
  // asserted, not just shown: the new name wins, the old name still works,
  // and the default applies when neither is set.
  for (const file of [
    'docker-compose.yml',
    'docker-compose.with-caddy.yml',
    'docker-compose.local.yml',
  ]) {
    const secrets = {
      POSTGRES_PASSWORD: PG,
      STORAGE_ACCESS_KEY: AK,
      STORAGE_SECRET_KEY: SK,
    };
    for (const [name, values, want] of [
      [
        'alias: only SIDEKICK_BACKEND_URL',
        { SIDEKICK_BACKEND_URL: 'http://new.example', INSTANT_BACKEND_URL: '' },
        'http://new.example',
      ],
      [
        'alias: only INSTANT_BACKEND_URL',
        { SIDEKICK_BACKEND_URL: '', INSTANT_BACKEND_URL: 'http://old.example' },
        'http://old.example',
      ],
      [
        'alias: both set, SIDEKICK wins',
        {
          SIDEKICK_BACKEND_URL: 'http://new.example',
          INSTANT_BACKEND_URL: 'http://old.example',
        },
        'http://new.example',
      ],
      [
        'alias: neither set, default',
        { SIDEKICK_BACKEND_URL: '', INSTANT_BACKEND_URL: '' },
        'http://localhost:8888',
      ],
    ]) {
      const r = renderCompose(
        cmd,
        file,
        envFile(`${file}-${name.replace(/\W+/g, '_')}`, {
          ...secrets,
          ...values,
        }),
      );
      const problems = [];
      if (!r.ok)
        problems.push(`did not render: ${r.stderr.trim().split('\n').at(-1)}`);
      else {
        for (const svc of ['server', 'www']) {
          const got = envOf(r.config, svc).INSTANT_BACKEND_URL;
          if (got !== want)
            problems.push(
              `${svc} INSTANT_BACKEND_URL is ${JSON.stringify(got)}, expected "${want}"`,
            );
        }
      }
      record(
        label,
        file,
        name,
        problems,
        r.ok ? 'rendered' : r.stderr.trim().split('\n').at(-1),
      );
    }
  }

  // The runtime mode defaults to self-hosted in every compose file, and both
  // names work.
  for (const file of [
    'docker-compose.yml',
    'docker-compose.with-caddy.yml',
    'docker-compose.local.yml',
  ]) {
    const secrets = {
      POSTGRES_PASSWORD: PG,
      STORAGE_ACCESS_KEY: AK,
      STORAGE_SECRET_KEY: SK,
    };
    for (const [name, values, want] of [
      [
        'runtime mode: neither set',
        { SIDEKICK_RUNTIME_MODE: '', INSTANT_RUNTIME_MODE: '' },
        'self-hosted',
      ],
      [
        'runtime mode: only SIDEKICK_RUNTIME_MODE',
        { SIDEKICK_RUNTIME_MODE: 'default', INSTANT_RUNTIME_MODE: '' },
        'default',
      ],
      [
        'runtime mode: only INSTANT_RUNTIME_MODE',
        { SIDEKICK_RUNTIME_MODE: '', INSTANT_RUNTIME_MODE: 'default' },
        'default',
      ],
      [
        'runtime mode: both set, SIDEKICK wins',
        {
          SIDEKICK_RUNTIME_MODE: 'self-hosted',
          INSTANT_RUNTIME_MODE: 'default',
        },
        'self-hosted',
      ],
    ]) {
      const r = renderCompose(
        cmd,
        file,
        envFile(`${file}-${name.replace(/\W+/g, '_')}`, {
          ...secrets,
          ...values,
        }),
      );
      const problems = [];
      if (!r.ok)
        problems.push(`did not render: ${r.stderr.trim().split('\n').at(-1)}`);
      else {
        const got = envOf(r.config, 'server').INSTANT_RUNTIME_MODE;
        if (got !== want)
          problems.push(
            `server INSTANT_RUNTIME_MODE is ${JSON.stringify(got)}, expected "${want}"`,
          );
      }
      record(
        label,
        file,
        name,
        problems,
        r.ok ? 'rendered' : r.stderr.trim().split('\n').at(-1),
      );
    }
  }

  // SIDEKICK_NREPL (or INSTANT_NREPL) from .env reaches the server; unset
  // leaves it empty, which keeps nREPL off in the self-hosted mode.
  for (const file of [
    'docker-compose.yml',
    'docker-compose.with-caddy.yml',
    'docker-compose.local.yml',
  ]) {
    const secrets = {
      POSTGRES_PASSWORD: PG,
      STORAGE_ACCESS_KEY: AK,
      STORAGE_SECRET_KEY: SK,
    };
    for (const [name, values, want] of [
      ['nrepl: neither set', { SIDEKICK_NREPL: '', INSTANT_NREPL: '' }, ''],
      [
        'nrepl: only SIDEKICK_NREPL',
        { SIDEKICK_NREPL: 'true', INSTANT_NREPL: '' },
        'true',
      ],
      [
        'nrepl: only INSTANT_NREPL',
        { SIDEKICK_NREPL: '', INSTANT_NREPL: 'true' },
        'true',
      ],
    ]) {
      const r = renderCompose(
        cmd,
        file,
        envFile(`${file}-${name.replace(/\W+/g, '_')}`, {
          ...secrets,
          ...values,
        }),
      );
      const problems = [];
      if (!r.ok)
        problems.push(`did not render: ${r.stderr.trim().split('\n').at(-1)}`);
      else {
        const got = envOf(r.config, 'server').INSTANT_NREPL;
        if (got !== want)
          problems.push(
            `server INSTANT_NREPL is ${JSON.stringify(got)}, expected "${want}"`,
          );
      }
      record(
        label,
        file,
        name,
        problems,
        r.ok ? 'rendered' : r.stderr.trim().split('\n').at(-1),
      );
    }
  }

  // Postgres is not published beyond 127.0.0.1 unless POSTGRES_BIND_ADDRESS
  // says so. A port without host_ip is published on every interface.
  {
    const secrets = {
      POSTGRES_PASSWORD: PG,
      STORAGE_ACCESS_KEY: AK,
      STORAGE_SECRET_KEY: SK,
    };
    for (const [file, name, values, want] of [
      [
        'docker-compose.yml',
        'postgres port: POSTGRES_BIND_ADDRESS unset',
        {},
        '127.0.0.1',
      ],
      [
        'docker-compose.yml',
        'postgres port: POSTGRES_BIND_ADDRESS empty',
        { POSTGRES_BIND_ADDRESS: '' },
        '127.0.0.1',
      ],
      [
        'docker-compose.yml',
        'postgres port: POSTGRES_BIND_ADDRESS=0.0.0.0',
        { POSTGRES_BIND_ADDRESS: '0.0.0.0' },
        '0.0.0.0',
      ],
      ['docker-compose.with-caddy.yml', 'postgres port: none', {}, null],
      ['docker-compose.local.yml', 'postgres port: 127.0.0.1', {}, '127.0.0.1'],
    ]) {
      const r = renderCompose(
        cmd,
        file,
        envFile(`${file}-${name.replace(/\W+/g, '_')}`, {
          ...secrets,
          ...values,
        }),
      );
      const problems = [];
      if (!r.ok)
        problems.push(`did not render: ${r.stderr.trim().split('\n').at(-1)}`);
      else {
        const ports = r.config.services?.postgres?.ports ?? [];
        if (want === null) {
          if (ports.length)
            problems.push(
              `postgres publishes ${JSON.stringify(ports)}, expected no port`,
            );
        } else if (!ports.length) {
          problems.push(`postgres publishes no port, expected one on ${want}`);
        } else {
          for (const p of ports) {
            if (p?.host_ip !== want)
              problems.push(
                `postgres port ${JSON.stringify(p)} is not bound to ${want}`,
              );
          }
        }
      }
      record(
        label,
        file,
        name,
        problems,
        r.ok ? 'rendered' : r.stderr.trim().split('\n').at(-1),
      );
    }
  }

  // Postgres runs with JIT off in every compose file (see README.md,
  // "Postgres JIT").
  for (const file of [
    'docker-compose.yml',
    'docker-compose.with-caddy.yml',
    'docker-compose.local.yml',
  ]) {
    const r = renderCompose(
      cmd,
      file,
      envFile(`${file}-jit`, {
        POSTGRES_PASSWORD: PG,
        STORAGE_ACCESS_KEY: AK,
        STORAGE_SECRET_KEY: SK,
      }),
    );
    const problems = [];
    if (!r.ok)
      problems.push(`did not render: ${r.stderr.trim().split('\n').at(-1)}`);
    else {
      const command = r.config.services?.postgres?.command ?? [];
      if (!command.includes('jit=off'))
        problems.push(
          `postgres command ${JSON.stringify(command)} lacks jit=off`,
        );
    }
    record(
      label,
      file,
      'postgres: jit=off',
      problems,
      r.ok ? 'rendered' : r.stderr.trim().split('\n').at(-1),
    );
  }

  // createbuckets sets the lifecycle rule for app backups in every file.
  for (const file of [
    'docker-compose.yml',
    'docker-compose.with-caddy.yml',
    'docker-compose.local.yml',
  ]) {
    const r = renderCompose(
      cmd,
      file,
      envFile(`${file}-lifecycle`, {
        POSTGRES_PASSWORD: PG,
        STORAGE_ACCESS_KEY: AK,
        STORAGE_SECRET_KEY: SK,
      }),
    );
    const problems = r.ok
      ? lifecycleProblems(
          String(r.config.services?.createbuckets?.entrypoint?.at(-1) ?? ''),
        )
      : [`did not render: ${r.stderr.trim().split('\n').at(-1)}`];
    record(
      label,
      file,
      'createbuckets: backups lifecycle rule',
      problems,
      r.ok ? 'rendered' : r.stderr.trim().split('\n').at(-1),
    );
  }

  // Informational: the bare nested ":-" form. The compose files rely on it
  // for the SIDEKICK_* aliases, which the cases above assert. What Compose
  // 2.38 rejects is a required ":?" inside a default, which no file uses.
  {
    const probe = path.join(tmp, 'nested.yml');
    fs.writeFileSync(
      probe,
      'services:\n  probe:\n    image: busybox\n    environment:\n      X: ${A:-${B:-fallback}}\n',
    );
    const out = (env) => {
      const r = exec(cmd, ['-f', probe, 'config', '--format', 'json'], env);
      return r.ok
        ? JSON.stringify(JSON.parse(r.stdout).services.probe.environment.X)
        : `error: ${r.stderr.trim().split('\n').at(-1)}`;
    };
    console.log(
      `info ${label}: X: \${A:-\${B:-fallback}} renders as A=a -> ${out({ A: 'a' })}; A unset, B=b -> ${out({ B: 'b' })}; both unset -> ${out({})}`,
    );
  }
}

// swarm.yml goes through `docker stack config`, which reads the process
// environment, not .env. It only uses STORAGE_* (no old names).
{
  const swarmEnv = {
    SERVER_URL: 'http://server.localhost',
    DASHBOARD_URL: 'http://dash.localhost',
    S3_PUBLIC_ENDPOINT: 'http://storage.localhost',
  };
  const stack = (env) =>
    exec('docker', ['stack', 'config', '--compose-file', 'swarm.yml'], {
      ...swarmEnv,
      ...env,
    });
  const set = stack({
    POSTGRES_PASSWORD: PG,
    STORAGE_ACCESS_KEY: AK,
    STORAGE_SECRET_KEY: SK,
  });
  const p1 = [];
  if (!set.ok)
    p1.push(`did not render: ${set.stderr.trim().split('\n').at(-1)}`);
  else {
    for (const want of [
      'INSTANT_RUNTIME_MODE: self-hosted',
      `RUSTFS_ACCESS_KEY: ${AK}`,
      `AWS_SECRET_ACCESS_KEY: ${SK}`,
      `:${PG}@`,
    ]) {
      if (!set.stdout.includes(want)) p1.push(`output lacks ${want}`);
    }
  }
  record(
    'docker stack config',
    'swarm.yml',
    'STORAGE_* set',
    p1,
    set.ok ? 'rendered' : set.stderr.trim(),
  );
  // Swarm publishes on every node's interfaces and ignores a host IP, so the
  // postgres service must publish nothing. The output is YAML with services
  // indented two spaces and their keys four: take the lines from "  postgres:"
  // to the next service or top-level key.
  const p3 = [];
  const p4 = [];
  if (!set.ok) {
    p3.push(`did not render: ${set.stderr.trim().split('\n').at(-1)}`);
    p4.push(...p3);
  } else {
    const lines = set.stdout.split('\n');
    const start = lines.indexOf('  postgres:');
    if (start === -1) {
      p3.push('output has no postgres service');
      p4.push(...p3);
    } else {
      const rest = lines.slice(start + 1);
      const end = rest.findIndex((l) => /^ {0,2}\S/.test(l));
      const block = end === -1 ? rest : rest.slice(0, end);
      if (block.some((l) => /^ {4}ports:/.test(l)))
        p3.push('postgres service publishes a port, expected none');
      // The command is a list, one "- item" line per argument.
      if (!block.some((l) => /^\s+- "?jit=off"?$/.test(l)))
        p4.push('postgres command lacks jit=off');
    }
  }
  record('docker stack config', 'swarm.yml', 'postgres port: none', p3);
  record('docker stack config', 'swarm.yml', 'postgres: jit=off', p4);
  // The createbuckets script is the last item of its entrypoint, one YAML
  // single-quoted line ('' stands for ').
  let p6 = [];
  if (!set.ok)
    p6.push(`did not render: ${set.stderr.trim().split('\n').at(-1)}`);
  else {
    const lines = set.stdout.split('\n');
    const start = lines.indexOf('  createbuckets:');
    const rest = start === -1 ? [] : lines.slice(start + 1);
    const end = rest.findIndex((l) => /^ {0,2}\S/.test(l));
    const block = end === -1 ? rest : rest.slice(0, end);
    const line = block.find((l) => /^ {6}- ' set -e;/.test(l));
    p6 = line
      ? lifecycleProblems(line.trim().slice(3, -1).replaceAll("''", "'"))
      : ['createbuckets entrypoint has no script starting with set -e'];
  }
  record(
    'docker stack config',
    'swarm.yml',
    'createbuckets: backups lifecycle rule',
    p6,
  );
  // INSTANT_NREPL in the environment reaches the server. (deploy-swarm.sh
  // maps SIDEKICK_NREPL to it; deploy-swarm.test.mjs covers that.)
  const nrepl = stack({
    POSTGRES_PASSWORD: PG,
    STORAGE_ACCESS_KEY: AK,
    STORAGE_SECRET_KEY: SK,
    INSTANT_NREPL: 'true',
  });
  const p5 = !nrepl.ok
    ? [`did not render: ${nrepl.stderr.trim().split('\n').at(-1)}`]
    : /^ {6}INSTANT_NREPL: "?true"?$/m.test(nrepl.stdout)
      ? []
      : ['server environment lacks INSTANT_NREPL: "true"'];
  record('docker stack config', 'swarm.yml', 'nrepl: INSTANT_NREPL=true', p5);
  const none = stack({ POSTGRES_PASSWORD: PG });
  const p2 = none.ok
    ? ['rendered without storage keys']
    : /STORAGE_(ACCESS|SECRET)_KEY/.test(none.stderr)
      ? []
      : [`error does not name the storage key: ${none.stderr.trim()}`];
  record(
    'docker stack config',
    'swarm.yml',
    'neither set',
    p2,
    none.ok ? 'rendered' : none.stderr.trim().split('\n').at(-1),
  );
}

fs.rmSync(tmp, { recursive: true, force: true });

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(
    `${r.pass ? 'PASS' : 'FAIL'}  ${r.compose}  ${r.file}  ${r.name}${r.pass ? '' : `\n        ${r.problems.join('\n        ')}`}`,
  );
}
console.log(
  `\n${results.length - failed} of ${results.length} cases as expected.`,
);
process.exit(failed ? 1 : 0);
