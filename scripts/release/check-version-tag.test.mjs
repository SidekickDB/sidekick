// Tests for check-version-tag.mjs with a stand-in for the registry, so
// nothing leaves this machine. Run with: node --test scripts/release/*.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkVersionTag, tagState } from './check-version-tag.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-version-tag.mjs');

const json = (status, body) => ({ status, json: async () => body });
const notFound = () => json(404, { errors: [{ code: 'MANIFEST_UNKNOWN', message: 'manifest unknown' }] });

// `tags` maps "image:tag" to a response factory; a missing key is not found.
function registry(tags = {}, { token = () => json(200, { token: 'anon' }) } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    const u = new URL(url);
    assert.equal(u.origin, 'https://ghcr.io');
    if (u.pathname === '/token') return token(u);
    const m = u.pathname.match(/^\/v2\/sidekickdb\/([^/]+)\/manifests\/([^/]+)$/);
    assert.ok(m, `unexpected request ${url}`);
    assert.equal(opts.headers.Authorization, 'Bearer anon');
    return (tags[`${m[1]}:${m[2]}`] ?? notFound)();
  };
  return { fetchImpl, calls };
}

const run = (args, reg) =>
  checkVersionTag({ version: 'v2.0.1', move: 'false', images: ['server', 'dashboard'], ...args }, reg.fetchImpl);

test('a version that exists on either image is refused', async () => {
  for (const image of ['server', 'dashboard']) {
    const reg = registry({ [`${image}:v2.0.1`]: () => json(200, {}) });
    const r = await run({}, reg);
    assert.equal(r.ok, false);
    assert.match(r.lines.at(-1), new RegExp(`already exists: ghcr\\.io/sidekickdb/${image}:v2\\.0\\.1\\.`));
    assert.match(r.lines.at(-1), /move_version_tag/);
  }
});

test('a version that exists nowhere passes', async () => {
  const reg = registry();
  const r = await run({}, reg);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines, [
    'ghcr.io/sidekickdb/server:v2.0.1: not found, free',
    'ghcr.io/sidekickdb/dashboard:v2.0.1: not found, free',
  ]);
  assert.equal(reg.calls.length, 4);
  assert.match(reg.calls[0].url, /scope=repository%3Asidekickdb%2Fserver%3Apull/);
  for (const c of reg.calls) assert.equal(c.opts.redirect, 'error');
});

test('the override skips the lookup and passes', async () => {
  const reg = registry({ 'server:v2.0.1': () => json(200, {}) });
  const r = await run({ move: 'true' }, reg);
  assert.equal(r.ok, true);
  assert.match(r.lines[0], /move_version_tag is set/);
  assert.equal(reg.calls.length, 0);
});

test('no version passes without a lookup', async () => {
  for (const version of ['', undefined]) {
    const reg = registry();
    const r = await run({ version }, reg);
    assert.equal(r.ok, true);
    assert.equal(reg.calls.length, 0);
  }
});

test('malformed input fails without a lookup', async () => {
  for (const [args, re] of [
    [{ version: '2.0.1' }, /version must look like v1\.2\.3/],
    [{ version: 'v2.0' }, /version must look like/],
    [{ version: 'v2.0.1-next.0' }, /version must look like/],
    [{ version: 'v2.0.1\n' }, /version must look like/],
    [{ version: 'v2.0.1/../x' }, /version must look like/],
    [{ move: '' }, /MOVE_VERSION_TAG must be true or false/],
    [{ move: undefined }, /MOVE_VERSION_TAG must be true or false, got \(unset\)/],
    [{ move: 'yes' }, /MOVE_VERSION_TAG must be true or false/],
    [{ images: [] }, /no image names/],
    [{ images: ['server', '../x'] }, /not an image name: \.\.\/x/],
    [{ images: ['Server'] }, /not an image name/],
  ]) {
    const reg = registry();
    const r = await run(args, reg);
    assert.equal(r.ok, false, JSON.stringify(args));
    assert.match(r.lines.join('\n'), re);
    assert.equal(reg.calls.length, 0);
  }
});

test('any registry answer but 200 or 404 MANIFEST_UNKNOWN fails closed', async () => {
  const answers = {
    'HTTP 401 (UNAUTHORIZED)': () => json(401, { errors: [{ code: 'UNAUTHORIZED' }] }),
    'HTTP 403 (DENIED)': () => json(403, { errors: [{ code: 'DENIED' }] }),
    'HTTP 429': () => json(429, {}),
    'HTTP 500': () => json(500, {}),
    'HTTP 503': () => ({ status: 503, json: async () => { throw new SyntaxError('not json'); } }),
    'HTTP 404 (NAME_UNKNOWN)': () => json(404, { errors: [{ code: 'NAME_UNKNOWN' }] }),
    'HTTP 404': () => json(404, {}),
    'HTTP 302': () => json(302, {}),
  };
  for (const [want, answer] of Object.entries(answers)) {
    const r = await run({}, registry({ 'dashboard:v2.0.1': answer }));
    assert.equal(r.ok, false, want);
    assert.match(r.lines.at(-1), new RegExp(`dashboard:v2\\.0\\.1: registry answered ${want.replace(/[()]/g, '\\$&')}\\. Cannot tell`));
  }
});

test('a failed pull token request fails closed', async () => {
  for (const [token, re] of [
    [() => json(500, {}), /pull token request answered HTTP 500/],
    [() => json(200, {}), /pull token answer has no token/],
    [() => json(200, { token: '' }), /no token/],
    [() => ({ status: 200, json: async () => { throw new SyntaxError('x'); } }), /not JSON/],
  ]) {
    const r = await run({}, registry({}, { token }));
    assert.equal(r.ok, false);
    assert.match(r.lines.at(-1), re);
    assert.match(r.lines.at(-1), /nothing is published/);
  }
});

test('a network error or timeout fails closed', async () => {
  for (const err of [new TypeError('fetch failed'), new DOMException('timed out', 'TimeoutError')]) {
    const r = await run({}, { fetchImpl: async () => { throw err; } });
    assert.equal(r.ok, false);
    assert.match(r.lines.at(-1), new RegExp(`registry request failed \\(${err.name}`));
  }
});

test('every request has a timeout', async () => {
  const reg = registry();
  await tagState('server', 'v2.0.1', reg.fetchImpl);
  for (const c of reg.calls) assert.ok(c.opts.signal instanceof AbortSignal);
});

test('the command line refuses malformed input with exit 1 and no network', () => {
  const r = spawnSync(process.execPath, [script, 'server'], {
    env: { PATH: process.env.PATH, VERSION: 'latest', MOVE_VERSION_TAG: 'false' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /version must look like v1\.2\.3, got latest/);
});

test('the command line passes with no version', () => {
  const r = spawnSync(process.execPath, [script, 'server'], {
    env: { PATH: process.env.PATH, VERSION: '', MOVE_VERSION_TAG: 'false' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /No version given/);
});
