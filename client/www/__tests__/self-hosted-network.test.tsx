// SidekickDB: a self-hosted dashboard makes the browser contact only itself and
// the configured server. These checks cover what can be seen without a
// browser: the source, the docs, the editor loader and the Next.js config.
import { afterEach, expect, test, vi } from 'vitest';
import { createRequire } from 'module';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { renderToStaticMarkup } from 'react-dom/server';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';

const require = createRequire(import.meta.url);

const monacoLoader = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock('@monaco-editor/react', () => ({ loader: monacoLoader }));
const www = path.resolve(__dirname, '..');
const components = path.resolve(www, '../packages/components/src');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function walk(dir: string, skip: Set<string>): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return skip.has(e.name) ? [] : walk(p, skip);
    return [p];
  });
}

const rel = (p: string) => path.relative(www, p);

// Code that ships in the dashboard. Tests, build scripts, essays, emails and
// generated files are not loaded by the browser.
const sourceFiles = [
  ...walk(
    www,
    new Set([
      'node_modules',
      '.next',
      'public',
      '_posts',
      '_emails',
      '__tests__',
      'scripts',
    ]),
  ),
  ...walk(components, new Set(['node_modules'])),
].filter(
  (f) => /\.(ts|tsx|js|jsx|mjs|cjs|css)$/.test(f) && !/\.test\.tsx?$/.test(f),
);

// Hosts the dashboard must never load code, styles or fonts from.
const cdnHosts =
  /unpkg\.com|cdn\.jsdelivr\.net|esm\.sh|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/;
// A Google Analytics 4 measurement id.
const analyticsId = /\bG-[A-Z0-9]{10}\b/;

// Text that names a CDN without loading from it.
const cdnTextAllowed: Record<string, string> = {
  // Instructions shown to an LLM on a marketing page (redirected when
  // self-hosted).
  'app/getadb/generateMarkdown.ts': 'unpkg.com',
};

test('no source file loads from a CDN or carries an analytics id', () => {
  const found: string[] = [];
  for (const file of sourceFiles) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const cdn = line.match(cdnHosts)?.[0];
      if (cdn && cdnTextAllowed[rel(file)] !== cdn) {
        found.push(`${rel(file)}:${i + 1}: ${cdn}`);
      }
      if (analyticsId.test(line)) {
        found.push(`${rel(file)}:${i + 1}: analytics id`);
      }
    });
  }
  expect(found).toEqual([]);
});

test('Google Analytics loads only with an id from the environment', () => {
  for (const file of ['app/layout.tsx', 'pages/_app.tsx']) {
    const src = readFileSync(path.join(www, file), 'utf8');
    expect(src).toContain('googletagmanager.com/gtag/js?id=${id}');
    expect(src).toMatch(
      /!isDev && !isSelfHosted && googleAnalyticsId && \(\s*<GoogleScripts id=\{googleAnalyticsId\} \/>/,
    );
  }
  const config = readFileSync(path.join(www, 'lib/config.ts'), 'utf8');
  expect(config).toMatch(
    /googleAnalyticsId = process\.env\.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID;/,
  );
});

test('the code editor loads Monaco from the dashboard', async () => {
  // Without configuration the loader fetches Monaco from a CDN.
  const loaderDir = path.dirname(
    require.resolve('@monaco-editor/loader/package.json', {
      paths: [path.dirname(require.resolve('@monaco-editor/react'))],
    }),
  );
  const defaults = readFileSync(
    path.join(loaderDir, 'lib/es/config/index.js'),
    'utf8',
  );
  expect(defaults).toMatch(cdnHosts);

  await import('../lib/monacoLoader');
  expect(monacoLoader.config).toHaveBeenCalledWith({
    paths: { vs: '/monaco/vs' },
  });

  // Both routers configure the loader before any editor mounts.
  for (const file of ['pages/_app.tsx', 'app/providers.tsx']) {
    expect(readFileSync(path.join(www, file), 'utf8')).toContain(
      "import '@/lib/monacoLoader';",
    );
  }
});

test('docs pages load no images from other hosts when self-hosted', () => {
  const found: string[] = [];
  for (const file of walk(path.join(www, 'app/docs'), new Set())) {
    if (!file.endsWith('.md')) continue;
    // Code samples and hosted-only parts are not rendered as images.
    const shown = readFileSync(file, 'utf8')
      .replace(/^```[\s\S]*?^```/gm, '')
      .replace(/\{% hosted-only %\}[\s\S]*?\{% \/hosted-only %\}/g, '');
    const inline =
      /!\[[^\]]*\]\(\s*<?(https?:\/\/[^)\s>]+)|<img[^>]*src=["'](https?:\/\/[^"']+)/gi;
    for (const m of shown.matchAll(inline)) {
      found.push(`${rel(file)}: ${m[1] ?? m[2]}`);
    }
    // Reference-style images: ![alt][label], ![alt][] and ![alt].
    const defs = new Map(
      [...shown.matchAll(/^ {0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s|$)/gm)].map(
        (m) => [m[1].toLowerCase(), m[2]],
      ),
    );
    for (const m of shown.matchAll(/!\[([^\]]*)\](?:\[([^\]]*)\])?(?!\()/g)) {
      const url = defs.get((m[2] || m[1]).toLowerCase());
      if (url && /^https?:\/\//i.test(url)) found.push(`${rel(file)}: ${url}`);
    }
  }
  expect(found).toEqual([]);
});

test('docs search, which queries an outside index, is hidden when self-hosted', () => {
  const layout = readFileSync(
    path.join(www, 'components/docs/Layout.jsx'),
    'utf8',
  );
  const uses = layout.match(/.*<Search \/>.*/g) ?? [];
  expect(uses.length).toBeGreaterThan(0);
  for (const use of uses) expect(use).toContain('!isSelfHosted && <Search />');
});

async function renderYouTube(selfHosted: boolean) {
  vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', selfHosted ? 'true' : '');
  vi.resetModules();
  const { YouTube } = await import('../components/docs/YouTube');
  return renderToStaticMarkup(
    <YouTube src="https://www.youtube.com/watch?v=jyVR5NDjNJ4" title="Demo" />,
  );
}

// Each render imports the component and lib/config afresh, which is slow on a
// busy CI runner.
test(
  'docs videos are links, not embeds, when self-hosted',
  { timeout: 60_000 },
  async () => {
    expect(await renderYouTube(true)).not.toContain('<iframe');
    expect(await renderYouTube(false)).toContain('<iframe');
  },
);

test('the self-hosted Next.js config proxies nothing to other hosts', async () => {
  vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true');
  const config = await require('../next.config.js')();
  expect(await config.rewrites()).toEqual([]);

  // The editor files are served, not redirected to /dash.
  const redirects: { source: string }[] = await config.redirects();
  for (const pathname of ['/monaco/vs/loader.js', '/monaco/types/index.d.ts']) {
    const hit = redirects.find(
      (r) =>
        !('has' in r) &&
        getPathMatch(r.source, { strict: true, removeUnnamedParams: true })(
          pathname,
        ),
    );
    expect(hit).toBeUndefined();
  }
});
