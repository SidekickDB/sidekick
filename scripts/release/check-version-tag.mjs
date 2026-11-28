// SidekickDB: refuses an image release whose version tag already exists on
// ghcr.io/sidekickdb, unless the release asks to move it. Run by
// .github/workflows/sidekick-release-images.yml before anything is built and
// again just before the version tag is published. See RELEASING.md.
//
//   VERSION=v1.2.3 MOVE_VERSION_TAG=false node scripts/release/check-version-tag.mjs server dashboard
//
// With PUBLISH_SHA=<commit> (the manifest job only) an existing tag is also
// accepted when it is an index of exactly <commit>-amd64 and <commit>-arm64,
// the images that job publishes: a re-run of that job after it published.
//
// Reads only: an anonymous pull token per image (the packages are public), then
// manifests. Fails closed: a version tag counts as free only when the registry
// answers 404 with the single error MANIFEST_UNKNOWN "manifest unknown"; every
// other answer, a timeout or a network error fails the check.

import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const REGISTRY = 'https://ghcr.io';
const OWNER = 'sidekickdb';
const VERSION_RE = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
const IMAGE_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const ARCHES = ['amd64', 'arm64'];
const TIMEOUT_MS = 20_000;
export const INDEX_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
];
export const MANIFEST_TYPES = [
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
];
// ghcr.io answers 404 MANIFEST_UNKNOWN for a tag that exists but has a type
// missing here ("OCI index found, but Accept header does not support OCI
// indexes"), so every type the workflow can publish must stay in this list.
const ACCEPT = [...INDEX_TYPES, ...MANIFEST_TYPES].join(', ');

// Fetches one manifest. Returns { bytes, digest } or null when the registry
// says plainly that the tag does not exist; throws on anything else.
async function fetchManifest(image, ref, fetchImpl, tokens) {
  const name = `ghcr.io/${OWNER}/${image}:${ref}`;
  const get = async (url, headers) => {
    try {
      return await fetchImpl(url, {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new Error(`${name}: registry request failed (${e?.name ?? 'Error'}: ${e?.message ?? e})`);
    }
  };
  const body = async (res) => {
    try {
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      throw new Error(`${name}: reading the registry answer failed (${e?.name ?? 'Error'})`);
    }
  };
  const parse = (bytes) => {
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch {
      return undefined;
    }
  };

  if (!tokens.has(image)) {
    const scope = `repository:${OWNER}/${image}:pull`;
    const res = await get(`${REGISTRY}/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`, {});
    if (res.status !== 200) throw new Error(`${name}: pull token request answered HTTP ${res.status}`);
    const token = parse(await body(res))?.token;
    if (typeof token !== 'string' || !token) throw new Error(`${name}: pull token answer has no token`);
    tokens.set(image, token);
  }

  const res = await get(`${REGISTRY}/v2/${OWNER}/${image}/manifests/${ref}`, {
    Authorization: `Bearer ${tokens.get(image)}`,
    Accept: ACCEPT,
  });
  const bytes = await body(res);
  if (res.status === 200)
    return { bytes, digest: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}` };
  const errors = parse(bytes)?.errors;
  const list = Array.isArray(errors) ? errors : [];
  if (
    res.status === 404 &&
    list.length === 1 &&
    list[0]?.code === 'MANIFEST_UNKNOWN' &&
    list[0]?.message === 'manifest unknown'
  )
    return null;
  const detail = list.map((e) => [e?.code, e?.message].filter(Boolean).join(' ')).join('; ');
  throw new Error(`${name}: registry answered HTTP ${res.status}${detail ? ` (${detail})` : ''}`);
}

// True when the index in `bytes` lists exactly the per-arch images of `sha`.
async function isIndexOf(image, bytes, sha, fetchImpl, tokens) {
  let index;
  try {
    index = JSON.parse(bytes.toString('utf8'));
  } catch {
    return false;
  }
  if (!INDEX_TYPES.includes(index?.mediaType) || !Array.isArray(index.manifests)) return false;
  const listed = index.manifests.map((m) => m?.digest).sort();
  const own = [];
  for (const arch of ARCHES) {
    const m = await fetchManifest(image, `${sha}-${arch}`, fetchImpl, tokens);
    if (!m) throw new Error(`ghcr.io/${OWNER}/${image}:${sha}-${arch} does not exist`);
    own.push(m.digest);
  }
  own.sort();
  return listed.length === own.length && listed.every((d, i) => d === own[i]);
}

// Returns { ok, lines }. `lines` is what to print.
export async function checkVersionTag({ version, move, images, publishSha }, fetchImpl = fetch) {
  const fail = (msg) => ({ ok: false, lines: [msg] });
  if (version === undefined || version === '')
    return { ok: true, lines: ['No version given: no version tag will be published.'] };
  if (!VERSION_RE.test(version)) return fail(`version must look like v1.2.3, got ${version}`);
  if (move !== 'true' && move !== 'false')
    return fail(`MOVE_VERSION_TAG must be true or false, got ${move ?? '(unset)'}`);
  if (!images.length) return fail('no image names given');
  const badImage = images.find((i) => !IMAGE_RE.test(i));
  if (badImage !== undefined) return fail(`not an image name: ${badImage}`);
  if (publishSha !== undefined && !SHA_RE.test(publishSha))
    return fail(`PUBLISH_SHA must be a full commit SHA, got ${publishSha}`);
  if (move === 'true')
    return {
      ok: true,
      lines: [`move_version_tag is set: ${version} will be published even where it already exists.`],
    };

  const lines = [];
  const existing = [];
  const tokens = new Map();
  for (const image of images) {
    const ref = `ghcr.io/${OWNER}/${image}:${version}`;
    try {
      const m = await fetchManifest(image, version, fetchImpl, tokens);
      if (!m) lines.push(`${ref}: not found, free`);
      else if (publishSha && (await isIndexOf(image, m.bytes, publishSha, fetchImpl, tokens)))
        lines.push(`${ref}: exists and already lists exactly ${publishSha}-{${ARCHES.join(',')}}, publishing it again changes no image`);
      else {
        lines.push(`${ref}: exists${publishSha ? `, with images other than ${publishSha}-{${ARCHES.join(',')}}` : ''}`);
        existing.push(ref);
      }
    } catch (e) {
      lines.push(`${e.message}. Cannot tell whether the tag exists, so nothing is published.`);
      return { ok: false, lines };
    }
  }
  if (existing.length) {
    lines.push(
      `Refused, the version tag already exists: ${existing.join(', ')}. Use the next unused version, or set move_version_tag to move the tag.`,
    );
    return { ok: false, lines };
  }
  return { ok: true, lines };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { ok, lines } = await checkVersionTag({
    version: process.env.VERSION,
    move: process.env.MOVE_VERSION_TAG,
    images: process.argv.slice(2),
    publishSha: process.env.PUBLISH_SHA || undefined,
  });
  for (const line of lines) (ok ? console.log : console.error)(line);
  process.exitCode = ok ? 0 : 1;
}
