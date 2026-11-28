// SidekickDB: the SDKs have no default server, so every docs sample that calls
// an entry point must pass `apiURI`. Samples use the `__API_URI__` placeholder,
// which components/docs/Fence.jsx fills in.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { docsMarkdownUrl, transformContent } from '../lib/markdoc';

const docsDir = path.join(__dirname, '../app/docs');

// core, react, react-native, solidjs, svelte, vue and admin `init`, the
// platform clients, webhooks, resumable-stream and the components <Explorer>.
// A method called `init` on another object is skipped, except on `instant`
// (the global of a script-tag build).
const ENTRY_POINT =
  /(?<![\w$]|(?<!\binstant)\.|function\s)(?:new\s+(?:PlatformApi|OAuthHandler|Webhooks)|init|exchangeCodeForToken|exchangeRefreshToken|createResumableStreamContext)\s*(?:<[^()]*?>)?\s*\(|<Explorer\b/g;

function markdownFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(p);
    return entry.name.endsWith('.md') ? [p] : [];
  });
}

function codeFences(text: string) {
  const fences: { line: number; code: string }[] = [];
  let open: { marker: string; line: number; body: string[] } | null = null;
  text.split('\n').forEach((line, i) => {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (!open) {
      if (marker) open = { marker, line: i + 2, body: [] };
    } else if (line.trim().startsWith(open.marker)) {
      fences.push({ line: open.line, code: open.body.join('\n') });
      open = null;
    } else {
      open.body.push(line);
    }
  });
  return fences;
}

// The arguments of a call (up to its closing parenthesis) or the props of a
// JSX element (up to its closing `>`).
function callArgs(code: string, start: number, jsx: boolean) {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) {
      depth--;
      if (!jsx && depth === 0) return code.slice(start, i + 1);
    } else if (jsx && depth === 0 && c === '>') {
      return code.slice(start, i + 1);
    }
  }
  return code.slice(start);
}

// Entry-point calls in the Markdown's code fences, as `line call`.
function entryPointCalls(markdown: string) {
  return codeFences(markdown).flatMap((fence) =>
    [...fence.code.matchAll(ENTRY_POINT)].map((match) => {
      const jsx = match[0].startsWith('<');
      const start = match.index + match[0].length - (jsx ? 0 : 1);
      const args = callArgs(fence.code, start, jsx);
      const line =
        fence.line + fence.code.slice(0, match.index).split('\n').length - 1;
      return {
        where: `${line} ${match[0].replace(/\s+/g, ' ')}`,
        // `init(/* ... */)` leaves the config out on purpose.
        ok: /\bapiURI\b/.test(args) || /^\(\s*\/\*[^*]*\*\/\s*\)$/.test(args),
      };
    }),
  );
}

test('every docs sample passes apiURI to the SDK', () => {
  const calls = markdownFiles(docsDir)
    .map((file) => path.relative(docsDir, file))
    .flatMap((rel) =>
      entryPointCalls(fs.readFileSync(path.join(docsDir, rel), 'utf8')).map(
        (call) => ({ ...call, where: `${rel}:${call.where}` }),
      ),
    );
  expect(calls.length).toBeGreaterThan(50);
  expect(calls.filter((call) => !call.ok).map((call) => call.where)).toEqual(
    [],
  );
});

test('the scan finds samples without apiURI', () => {
  const markdown = [
    '```ts',
    'const db = init({ apiURI: API_URI, appId: APP_ID });',
    'const admin = init<Schema>({',
    '  appId: APP_ID,',
    '});',
    'const api = new PlatformApi({});',
    'AppleID.auth.init({ clientId });',
    'const cdn = instant.init({ appId: APP_ID });',
    'const elided = init(/* ... */);',
    '```',
    '',
    '```tsx',
    '<Explorer appId={APP_ID} />',
    '```',
  ].join('\n');
  expect(
    entryPointCalls(markdown)
      .filter((call) => !call.ok)
      .map((call) => call.where),
  ).toEqual([
    '3 init<Schema>(',
    '6 new PlatformApi(',
    '8 init(',
    '13 <Explorer',
  ]);
});

test('Markdown copies of the docs show the placeholder server URL', () => {
  const result = transformContent(
    "```ts\ninit({ apiURI: '__API_URI__', appId: APP_ID });\n```",
  );
  expect(result).toContain("apiURI: 'https://sidekick.example.com'");
  expect(result).not.toContain('__API_URI__');
  expect(result).toContain("replace it with your SidekickDB server's URL");
  expect(transformContent('No samples here.')).not.toContain('replace it');
});

test('llms.txt links the Markdown copies relative when self-hosted', () => {
  expect(docsMarkdownUrl('/docs/init', true)).toBe('/docs/init.md');
  expect(docsMarkdownUrl('/docs/init', false)).toBe(
    'https://sidekickdb.co/docs/init.md',
  );
});

test('code samples use __API_URI__ instead of the placeholder host', () => {
  const literal = markdownFiles(docsDir)
    .map((file) => path.relative(docsDir, file))
    .flatMap((rel) =>
      codeFences(fs.readFileSync(path.join(docsDir, rel), 'utf8'))
        .filter((fence) => fence.code.includes('https://sidekick.example.com'))
        .map((fence) => `${rel}:${fence.line}`),
    );
  expect(literal).toEqual([]);
});
