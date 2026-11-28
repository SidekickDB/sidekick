// SidekickDB: the self-hosted dashboard redirects every unlisted page to /dash.
// The server sends users to some of those pages, so they must stay reachable.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createRequire } from 'module';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';

const require = createRequire(import.meta.url);

let redirects: { source: string; destination: string }[];

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SELF_HOSTED = 'true';
  const config = await require('../next.config.js')();
  redirects = await config.redirects();
});

afterAll(() => {
  delete process.env.NEXT_PUBLIC_SELF_HOSTED;
});

// Matches a source the way Next.js compiles it. Redirects with a `has`
// condition (another host, a query value) do not apply to these requests.
function redirectFor(pathname: string) {
  return redirects.find(
    (r) =>
      !('has' in r) &&
      getPathMatch(r.source, { strict: true, removeUnnamedParams: true })(
        pathname,
      ),
  );
}

test.each([
  '/dash',
  '/dash/user-settings',
  '/platform/oauth/start',
  // Linked from the docs (using-llms).
  '/llms-full.txt',
  '/docs/auth/magic-codes.md',
])('self-hosted dashboard serves %s', (pathname) => {
  expect(redirectFor(pathname)).toBeUndefined();
});

test('self-hosted dashboard sends other pages to /dash', () => {
  expect(redirectFor('/')?.destination).toBe('/dash');
  expect(redirectFor('/examples')?.destination).toBe('/dash');
});
