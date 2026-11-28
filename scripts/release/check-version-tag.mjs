// SidekickDB: refuses an image release whose version tag already exists on
// ghcr.io/sidekickdb, unless the release asks to move it. Run by
// .github/workflows/sidekick-release-images.yml before anything is built and
// again just before the version tag is published. See RELEASING.md.
//
//   VERSION=v1.2.3 MOVE_VERSION_TAG=false node scripts/release/check-version-tag.mjs server dashboard
//
// Reads only: an anonymous pull token per image (the packages are public), then
// the tag's manifest. Fails closed: a version tag counts as free only when the
// registry answers 404 MANIFEST_UNKNOWN; every other answer, a timeout or a
// network error fails the check.

import { pathToFileURL } from 'node:url';

const REGISTRY = 'https://ghcr.io';
const OWNER = 'sidekickdb';
const VERSION_RE = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
const IMAGE_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const TIMEOUT_MS = 20_000;
const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

// Returns 'exists' or 'free'; throws on anything else.
export async function tagState(image, tag, fetchImpl = fetch) {
  const ref = `ghcr.io/${OWNER}/${image}:${tag}`;
  const get = async (url, headers) => {
    try {
      return await fetchImpl(url, {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new Error(`${ref}: registry request failed (${e?.name ?? 'Error'}: ${e?.message ?? e})`);
    }
  };

  const scope = `repository:${OWNER}/${image}:pull`;
  const tokenRes = await get(
    `${REGISTRY}/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`,
    {},
  );
  if (tokenRes.status !== 200)
    throw new Error(`${ref}: pull token request answered HTTP ${tokenRes.status}`);
  let token;
  try {
    token = (await tokenRes.json())?.token;
  } catch {
    throw new Error(`${ref}: pull token answer is not JSON`);
  }
  if (typeof token !== 'string' || !token)
    throw new Error(`${ref}: pull token answer has no token`);

  const res = await get(`${REGISTRY}/v2/${OWNER}/${image}/manifests/${tag}`, {
    Authorization: `Bearer ${token}`,
    Accept: ACCEPT,
  });
  if (res.status === 200) return 'exists';
  let codes = [];
  try {
    codes = ((await res.json())?.errors ?? []).map((e) => e?.code);
  } catch {}
  if (res.status === 404 && codes.length === 1 && codes[0] === 'MANIFEST_UNKNOWN')
    return 'free';
  throw new Error(
    `${ref}: registry answered HTTP ${res.status}${codes.length ? ` (${codes.join(', ')})` : ''}`,
  );
}

// Returns { ok, lines }. `lines` is what to print.
export async function checkVersionTag({ version, move, images }, fetchImpl = fetch) {
  const fail = (msg) => ({ ok: false, lines: [msg] });
  if (version === undefined || version === '')
    return { ok: true, lines: ['No version given: no version tag will be published.'] };
  if (!VERSION_RE.test(version)) return fail(`version must look like v1.2.3, got ${version}`);
  if (move !== 'true' && move !== 'false')
    return fail(`MOVE_VERSION_TAG must be true or false, got ${move ?? '(unset)'}`);
  if (!images.length) return fail('no image names given');
  const badImage = images.find((i) => !IMAGE_RE.test(i));
  if (badImage !== undefined) return fail(`not an image name: ${badImage}`);
  if (move === 'true')
    return {
      ok: true,
      lines: [`move_version_tag is set: ${version} will be published even where it already exists.`],
    };

  const lines = [];
  const existing = [];
  for (const image of images) {
    const ref = `ghcr.io/${OWNER}/${image}:${version}`;
    let state;
    try {
      state = await tagState(image, version, fetchImpl);
    } catch (e) {
      lines.push(`${e.message}. Cannot tell whether the tag exists, so nothing is published.`);
      return { ok: false, lines };
    }
    lines.push(`${ref}: ${state === 'exists' ? 'exists' : 'not found, free'}`);
    if (state === 'exists') existing.push(ref);
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
  });
  for (const line of lines) (ok ? console.log : console.error)(line);
  process.exitCode = ok ? 0 : 1;
}
