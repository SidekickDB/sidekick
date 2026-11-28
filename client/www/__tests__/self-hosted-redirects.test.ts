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
  '/logout',
  '/_devtool',
  '/debug-uri/abc',
  '/docs',
  '/docs/auth/magic-codes',
  '/intern',
  '/intern/storage',
  '/intern/restore',
  '/intern/deployment-settings',
  '/_next/static/chunks/main.js',
  '/fonts/Switzer-Regular.woff',
  '/img/docs/devtool-explorer.png',
  '/docs/instaql.md',
  '/docs.md',
  '/llm-rules/AGENTS.md',
  '/img/google_g.svg',
  '/publicSelfHostedVariables.js',
  '/native-file-system-adapter-sw.js',
  // Linked from the docs (using-llms).
  '/llms-full.txt',
  '/docs/auth/magic-codes.md',
])('self-hosted dashboard serves %s', (pathname) => {
  expect(redirectFor(pathname)).toBeUndefined();
});

test.each([
  '/',
  '/examples',
  '/pricing',
  '/status',
  '/discord',
  '/opengraph-image',
  '/api/docs-og',
  '/essays/instant_team_joins_openai',
  '/intern/emails',
  '/intern/emails/feb2026',
  '/intern/investor_updates',
  '/intern/overview',
  '/intern/sunset',
  '/intern/og-preview',
  '/intern/posts/heroui',
  '/api/avatar',
  '/api/webhooks/config',
  '/api/og',
  '/posts/heroui/stars.png',
  '/getadb/provision/x.y',
])('self-hosted dashboard sends %s to /dash', (pathname) => {
  expect(redirectFor(pathname)?.destination).toBe('/dash');
});
