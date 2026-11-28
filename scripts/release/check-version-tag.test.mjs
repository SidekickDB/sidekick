// Tests for check-version-tag.mjs with a stand-in for ghcr.io, so nothing
// leaves this machine. Run with: node --test scripts/release/*.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkVersionTag, INDEX_TYPES, MANIFEST_TYPES } from './check-version-tag.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-version-tag.mjs');

const OCI_INDEX = 'application/vnd.oci.image.index.v1+json';
const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const respond = (status, body) => {
  const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return { status, arrayBuffer: async () => bytes };
};
const unknown = (message = 'manifest unknown') =>
  respond(404, { errors: [{ code: 'MANIFEST_UNKNOWN', message }] });
const digest = (s) => `sha256:${crypto.createHash('sha256').update(s).digest('hex')}`;

// A manifest as stored in the registry: its exact bytes and type.
const single = (seed, mediaType = OCI_MANIFEST) => ({
  mediaType,
  body: JSON.stringify({ schemaVersion: 2, mediaType, config: { digest: digest(seed) } }),
});
const index = (manifests, mediaType = OCI_INDEX) => ({
  mediaType,
  body: JSON.stringify({
    schemaVersion: 2,
    mediaType,
    manifests: manifests.map((m) => ({ mediaType: m.mediaType, digest: digest(m.body) })),
  }),
});

// Per-arch images of a commit and the multi-arch index made from them.
function release(image, sha) {
  const amd = single(`${image}-${sha}-amd64`);
  const arm = single(`${image}-${sha}-arm64`);
  return { [`${image}:${sha}-amd64`]: amd, [`${image}:${sha}-arm64`]: arm, index: index([amd, arm]) };
}

// Behaves like ghcr.io: a stored manifest whose type is not in Accept is
// answered with 404 MANIFEST_UNKNOWN, as for a tag that does not exist.
// `store` maps "image:ref" to a stored manifest or to a response factory.
function registry(store = {}, { token = () => respond(200, { token: 'anon' }) } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    const u = new URL(url);
    assert.equal(u.origin, 'https://ghcr.io');
    if (u.pathname === '/token') return token(u);
    const m = u.pathname.match(/^\/v2\/sidekickdb\/([^/]+)\/manifests\/([^/]+)$/);
    assert.ok(m, `unexpected request ${url}`);
    assert.equal(opts.headers.Authorization, 'Bearer anon');
    const entry = store[`${m[1]}:${m[2]}`];
    if (typeof entry === 'function') return entry();
    if (!entry) return unknown();
    const accept = (opts.headers.Accept ?? '').split(',').map((s) => s.trim());
    if (!accept.includes(entry.mediaType))
      return unknown(
        INDEX_TYPES.includes(entry.mediaType)
          ? 'OCI index found, but Accept header does not support OCI indexes'
          : 'manifest found, but Accept header does not support its type',
      );
    return respond(200, entry.body);
  };
  return { fetchImpl, calls };
}

const run = (args, reg) =>
  checkVersionTag({ version: 'v2.0.1', move: 'false', images: ['server', 'dashboard'], ...args }, reg.fetchImpl);

test('a version that exists on either image is refused', async () => {
  for (const image of ['server', 'dashboard']) {
    const reg = registry({ [`${image}:v2.0.1`]: release(image, SHA).index });
    const r = await run({}, reg);
    assert.equal(r.ok, false);
    assert.match(r.lines.at(-1), new RegExp(`already exists: ghcr\\.io/sidekickdb/${image}:v2\\.0\\.1\\.`));
    assert.match(r.lines.at(-1), /move_version_tag/);
  }
});

test('an existing tag of every type the workflow can publish is found', async () => {
  for (const stored of [
    index([single('x'), single('y')]),
    index([single('x'), single('y')], INDEX_TYPES[1]),
    single('x'),
    single('x', MANIFEST_TYPES[1]),
  ]) {
    const r = await run({ images: ['server'] }, registry({ 'server:v2.0.1': stored }));
    assert.equal(r.ok, false, stored.mediaType);
    assert.match(r.lines[0], /v2\.0\.1: exists$/);
  }
});

test('every request asks for both index types and both single-manifest types', async () => {
  const reg = registry();
  await run({}, reg);
  const manifests = reg.calls.filter((c) => c.url.includes('/manifests/'));
  assert.equal(manifests.length, 2);
  for (const c of manifests) {
    const accept = c.opts.headers.Accept.split(',').map((s) => s.trim());
    for (const t of [...INDEX_TYPES, ...MANIFEST_TYPES]) assert.ok(accept.includes(t), t);
  }
  assert.deepEqual(INDEX_TYPES, [
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
  ]);
  assert.deepEqual(MANIFEST_TYPES, [
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.v2+json',
  ]);
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
  for (const c of reg.calls) {
    assert.equal(c.opts.redirect, 'error');
    assert.ok(c.opts.signal instanceof AbortSignal);
  }
});

test('only a plain "manifest unknown" counts as free', async () => {
  for (const answer of [
    () => unknown('OCI index found, but Accept header does not support OCI indexes'),
    () => unknown('Manifest unknown'),
    () => unknown(''),
    () => respond(404, { errors: [{ code: 'MANIFEST_UNKNOWN' }] }),
    () => respond(404, { errors: [{ code: 'MANIFEST_UNKNOWN', message: 'manifest unknown' }, { code: 'X' }] }),
    () => respond(404, { errors: [{ code: 'NAME_UNKNOWN', message: 'manifest unknown' }] }),
  ]) {
    const r = await run({ images: ['server'] }, registry({ 'server:v2.0.1': answer }));
    assert.equal(r.ok, false);
    assert.match(r.lines.at(-1), /registry answered HTTP 404.*Cannot tell/);
  }
});

test('the override skips the lookup and passes', async () => {
  const reg = registry({ 'server:v2.0.1': release('server', SHA).index });
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
    [{ version: 'vX.Y.Z' }, /version must look like/],
    [{ version: 'v2.0.1-next.0' }, /version must look like/],
    [{ version: 'v2.0.1\n' }, /version must look like/],
    [{ version: 'v2.0.1/../x' }, /version must look like/],
    [{ move: '' }, /MOVE_VERSION_TAG must be true or false/],
    [{ move: undefined }, /MOVE_VERSION_TAG must be true or false, got \(unset\)/],
    [{ move: 'yes' }, /MOVE_VERSION_TAG must be true or false/],
    [{ images: [] }, /no image names/],
    [{ images: ['server', '../x'] }, /not an image name: \.\.\/x/],
    [{ images: ['Server'] }, /not an image name/],
    [{ publishSha: 'abc' }, /PUBLISH_SHA must be a full commit SHA/],
    [{ publishSha: `${SHA}/x` }, /PUBLISH_SHA must be a full commit SHA/],
  ]) {
    const reg = registry();
    const r = await run(args, reg);
    assert.equal(r.ok, false, JSON.stringify(args));
    assert.match(r.lines.join('\n'), re);
    assert.equal(reg.calls.length, 0);
  }
});

test('any registry answer but 200 or a plain 404 fails closed', async () => {
  const answers = {
    'HTTP 401 (UNAUTHORIZED)': () => respond(401, { errors: [{ code: 'UNAUTHORIZED' }] }),
    'HTTP 403 (DENIED invalid token)': () => respond(403, { errors: [{ code: 'DENIED', message: 'invalid token' }] }),
    'HTTP 429': () => respond(429, {}),
    'HTTP 500': () => respond(500, {}),
    'HTTP 503': () => respond(503, 'not json'),
    'HTTP 404 (NAME_UNKNOWN)': () => respond(404, { errors: [{ code: 'NAME_UNKNOWN' }] }),
    'HTTP 404': () => respond(404, {}),
    'HTTP 302': () => respond(302, {}),
  };
  for (const [want, answer] of Object.entries(answers)) {
    const r = await run({}, registry({ 'dashboard:v2.0.1': answer }));
    assert.equal(r.ok, false, want);
    assert.match(r.lines.at(-1), new RegExp(`dashboard:v2\\.0\\.1: registry answered ${want.replace(/[()]/g, '\\$&')}\\. Cannot tell`));
  }
});

test('a failed pull token request fails closed', async () => {
  for (const [token, re] of [
    [() => respond(500, {}), /pull token request answered HTTP 500/],
    [() => respond(200, {}), /pull token answer has no token/],
    [() => respond(200, { token: '' }), /no token/],
    [() => respond(200, 'not json'), /no token/],
    [() => ({ status: 200, arrayBuffer: async () => { throw new TypeError('terminated'); } }), /reading the registry answer failed/],
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

// The manifest job passes PUBLISH_SHA: a re-run after it published.
const manifestRun = (store) =>
  run({ images: ['server'], publishSha: SHA }, registry(store));

test('manifest job: first attempt, the version does not exist yet', async () => {
  const { index: _, ...own } = release('server', SHA);
  const r = await manifestRun(own);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines, ['ghcr.io/sidekickdb/server:v2.0.1: not found, free']);
});

test('manifest job: re-run after a publish of exactly these images passes', async () => {
  const { index: idx, ...own } = release('server', SHA);
  // Full publish (<sha> tag too) and partial publish (version tag only): the
  // check looks only at the version tag and this run's per-arch images.
  for (const store of [
    { ...own, 'server:v2.0.1': idx, [`server:${SHA}`]: idx },
    { ...own, 'server:v2.0.1': idx },
  ]) {
    const r = await manifestRun(store);
    assert.equal(r.ok, true);
    assert.match(r.lines[0], new RegExp(`exists and already lists exactly ${SHA}-\\{amd64,arm64\\}`));
  }
});

test('manifest job: a version tag of another release is refused', async () => {
  const mine = release('server', SHA);
  const theirs = release('server', OTHER);
  const { index: _, ...own } = mine;
  const amd = own[`server:${SHA}-amd64`];
  for (const [what, stored] of [
    ['other images', theirs.index],
    ['one image shared', index([amd, theirs[`server:${OTHER}-arm64`]])],
    ['a subset (amd64)', index([amd])],
    ['a subset (arm64)', index([own[`server:${SHA}-arm64`]])],
    ['a superset', index([amd, own[`server:${SHA}-arm64`], single('extra')])],
    ['a single manifest', amd],
    ['not an index type', { mediaType: OCI_INDEX, body: JSON.stringify({ mediaType: OCI_MANIFEST, manifests: [] }) }],
  ]) {
    const r = await manifestRun({ ...own, 'server:v2.0.1': stored });
    assert.equal(r.ok, false, what);
    assert.match(r.lines[0], /exists, with images other than/, what);
    assert.match(r.lines.at(-1), /^Refused, the version tag already exists/, what);
  }
});

test('manifest job: a missing or unreadable per-arch image fails closed', async () => {
  const { index: idx, ...own } = release('server', SHA);
  for (const store of [
    { 'server:v2.0.1': idx, [`server:${SHA}-amd64`]: own[`server:${SHA}-amd64`] },
    { ...own, 'server:v2.0.1': idx, [`server:${SHA}-arm64`]: () => respond(500, {}) },
  ]) {
    const r = await manifestRun(store);
    assert.equal(r.ok, false);
    assert.match(r.lines.at(-1), new RegExp(`${SHA}-arm64.*Cannot tell`));
  }
});

test('without PUBLISH_SHA a version tag of these very images is still refused', async () => {
  const { index: idx, ...own } = release('server', SHA);
  const r = await run({ images: ['server'] }, registry({ ...own, 'server:v2.0.1': idx }));
  assert.equal(r.ok, false);
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
