// Run with: node --test scripts/upstream/
import assert from "node:assert/strict";
import { test } from "node:test";
import { isExcluded, normalizeText, scanLeftovers } from "./rename.mjs";

function norm(file, text) {
  const once = normalizeText(file, text).text;
  // Every rewrite must be a fixed point.
  assert.equal(
    normalizeText(file, once).changes.length,
    0,
    `not idempotent:\n${once}`,
  );
  return once;
}

test("scoped packages are renamed, vendored and unknown ones are not", () => {
  assert.equal(
    norm(
      "client/packages/x/src/a.ts",
      "import { init } from '@instantdb/react-native';\n",
    ),
    "import { init } from '@sidekickdb/react-native';\n",
  );
  assert.equal(
    norm(
      "client/packages/x/src/a.ts",
      "import '@instantdb/react/nextjs'; import '@instantdb/eventsource';\n",
    ),
    "import '@sidekickdb/react/nextjs'; import '@instantdb/eventsource';\n",
  );
  // admin has its own copy of eventsource, so the old import is reported.
  const es = scanLeftovers(
    "client/packages/admin/src/subscribe.ts",
    "import { EventSource } from '@instantdb/eventsource';\n",
  );
  assert.deepEqual(
    es.map((l) => l.id),
    ["vendored-package"],
  );
  assert.match(es[0].hint, /client\/packages\/admin\/src\/eventsource\//);
  assert.equal(
    norm("client/a.md", "see @instantdb/newthing\n"),
    "see @instantdb/newthing\n",
  );
  const left = scanLeftovers("client/a.md", "see @instantdb/newthing\n");
  assert.equal(left[0].id, "unknown-scoped-package");
});

test("regex-escaped scoped names keep their escaping", () => {
  assert.equal(
    norm(
      "client/www/recipes.ts",
      "x.match(/from\\s+['\"]@instantdb\\/react['\"]/)\n",
    ),
    "x.match(/from\\s+['\"]@sidekickdb\\/react['\"]/)\n",
  );
});

test("emails and hosts are not package names", () => {
  const t = "email: 'stopa@instantdb.com', url: 'https://api.instantdb.com'\n";
  assert.equal(norm("client/www/a.ts", t), t);
});

test("CLI runner forms", () => {
  const cases = [
    ["npx instant-cli@latest push", "npx @sidekickdb/cli@latest push"],
    ["npx -y instant-cli init", "npx -y @sidekickdb/cli init"],
    [
      "pnpx instant-cli login",
      "pnpx --package=@sidekickdb/cli sidekick-cli login",
    ],
    [
      "pnpm dlx instant-cli@latest pull",
      "pnpm dlx --package=@sidekickdb/cli@latest sidekick-cli pull",
    ],
    [
      "bunx instant-cli push",
      "bunx --package=@sidekickdb/cli sidekick-cli push",
    ],
    ["pnpm exec instant-cli pull", "pnpm exec sidekick-cli pull"],
    ["which instant-cli", "which sidekick-cli"],
    ["npm i -g instant-cli", "npm i -g @sidekickdb/cli"],
    [
      "pnpm unlink --global instant-cli",
      "pnpm unlink --global @sidekickdb/cli",
    ],
    [
      "turbo run build --filter=instant-cli",
      "turbo run build --filter=@sidekickdb/cli",
    ],
    [
      "https://www.npmjs.com/package/instant-cli",
      "https://www.npmjs.com/package/@sidekickdb/cli",
    ],
  ];
  for (const [a, b] of cases)
    assert.equal(norm("client/www/app/docs/x/page.md", a + "\n"), b + "\n");
});

test("bare CLI subcommands: binary in CLI source, npx form in docs", () => {
  assert.equal(
    norm(
      "client/packages/cli/src/a.ts",
      "'hint: run `instant-cli auth client add --help`'\n",
    ),
    "'hint: run `sidekick-cli auth client add --help`'\n",
  );
  assert.equal(
    norm(
      "client/www/components/dash/Foo.tsx",
      'commandTemplate="instant-cli login"\n',
    ),
    'commandTemplate="npx @sidekickdb/cli login"\n',
  );
});

test("prose without a runner is left for a person and reported", () => {
  const t = "Use `instant-cli` to set up a new project.\n";
  assert.equal(norm("client/www/app/docs/a/page.md", t), t);
  assert.equal(
    scanLeftovers("client/www/app/docs/a/page.md", t)[0].id,
    "cli-name",
  );
});

test("module specifiers", () => {
  assert.equal(
    norm(
      "client/packages/create-instant-app/src/a.ts",
      "import { x } from 'instant-cli/ui';\nconst m = await import(\"instant-cli\");\n",
    ),
    "import { x } from '@sidekickdb/cli/ui';\nconst m = await import(\"@sidekickdb/cli\");\n",
  );
});

test("rewrites inside JS regex literals escape the new slash", () => {
  assert.equal(
    norm(
      "client/packages/create-instant-app/__tests__/e2e/a.test.ts",
      "expect(out).toMatch(/npx instant-cli push/);\n",
    ),
    "expect(out).toMatch(/npx @sidekickdb\\/cli push/);\n",
  );
});

test("wire identifiers are guarded wherever they appear", () => {
  const t =
    [
      "  'X-Instant-Source': 'instant-cli',",
      "  'X-Instant-Source': 'create-instant-app',",
      "const userAgent = `instant-cli/${version}`;",
      "export class A extends Context.Tag('instant-cli/new/context/a')<",
      "  'instant-cli/new/lib/http/X',",
      "new BroadcastChannel('@instantdb');",
      "  '@instantdb/newframework': version,",
      "    { ...(versions || {}), '@instantdb/core': coreVersion },",
    ].join("\n") + "\n";
  assert.equal(norm("client/packages/newpkg/src/a.ts", t), t);
  assert.deepEqual(scanLeftovers("client/packages/newpkg/src/a.ts", t), []);
});

test("create-instant-app: renamed except as a path or route", () => {
  const t =
    [
      "npx create-instant-app@latest my-app",
      "cd client/packages/create-instant-app && pnpm dev",
      "[docs](/docs/create-instant-app)",
      "see create-instant-app/template/rules/AGENTS.md",
      "const home = join(tmpdir(), 'create-instant-app-e2e-home');",
      "npm create instant-app",
    ].join("\n") + "\n";
  assert.equal(
    norm("client/www/app/docs/a/page.md", t),
    [
      "npx create-sidekick-app@latest my-app",
      "cd client/packages/create-instant-app && pnpm dev",
      "[docs](/docs/create-instant-app)",
      "see create-instant-app/template/rules/AGENTS.md",
      "const home = join(tmpdir(), 'create-sidekick-app-e2e-home');",
      "npm create sidekick-app",
    ].join("\n") + "\n",
  );
});

test("package.json: names, deps, scripts, metadata; bin alias kept", () => {
  const pkg = `{
  "name": "instant-cli",
  "homepage": "https://github.com/instantdb/instant/tree/main/client/packages/cli",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/instantdb/instant.git",
    "directory": "client/packages/cli"
  },
  "bugs": {
    "url": "https://github.com/SidekickDB/sidekick/issues"
  },
  "bin": {
    "sidekick-cli": "bin/index.js",
    "instant-cli": "bin/index.js"
  },
  "files": ["dist"],
  "scripts": {
    "instant-cli-init": "FOO=1 instant-cli init --app x",
    "build": "tsc"
  },
  "dependencies": {
    "@instantdb/core": "workspace:*",
    "@instantdb/eventsource": "4.1.0-2"
  },
  "devDependencies": {
    "instant-cli": "^0.19.20"
  }
}
`;
  const out = norm("client/packages/cli/package.json", pkg);
  assert.match(out, /"name": "@sidekickdb\/cli"/);
  assert.match(
    out,
    /"homepage": "https:\/\/github.com\/SidekickDB\/sidekick\/tree\/main\/client\/packages\/cli"/,
  );
  assert.match(
    out,
    /"url": "git\+https:\/\/github.com\/SidekickDB\/sidekick.git"/,
  );
  assert.match(out, /"instant-cli": "bin\/index.js"/);
  assert.match(out, /"sidekick-cli-init": "FOO=1 sidekick-cli init --app x"/);
  assert.match(out, /"@sidekickdb\/core": "workspace:\*"/);
  assert.match(out, /"@instantdb\/eventsource": "4.1.0-2"/);
  // A renamed package is only resolvable from the workspace.
  assert.match(out, /"@sidekickdb\/cli": "workspace:\*"/);
  // The eventsource dependency is not renamed but reported: admin has its
  // own copy.
  assert.deepEqual(
    scanLeftovers("client/packages/cli/package.json", out).map((l) => l.id),
    ["vendored-package"],
  );
});

test("examples keep registry specs (they are outside the workspace)", () => {
  const pkg =
    '{\n  "dependencies": {\n    "@instantdb/react": "latest"\n  }\n}\n';
  assert.equal(
    norm("examples/foo/package.json", pkg),
    '{\n  "dependencies": {\n    "@sidekickdb/react": "latest"\n  }\n}\n',
  );
});

test("excluded paths are never touched", () => {
  for (const f of [
    "server/flags-config/package.json",
    "self-hosting/README.md",
    ".github/workflows/js.yml",
    "client/packages/python/README.md",
    "client/www/_posts/essay.md",
    "client/www/_emails/markdown/x.md",
    "client/pnpm-lock.yaml",
    "examples/a/bun.lock",
    "LICENSE.md",
    "UPSTREAM.md",
  ]) {
    assert.ok(isExcluded(f), f);
    const t = "npx instant-cli push @instantdb/react\n";
    assert.equal(normalizeText(f, t).text, t, f);
  }
});

test("allowlisted lines keep old names", () => {
  const t = "    '@instantdb/react',\n";
  assert.equal(norm("client/packages/cli/src/context/projectInfo.ts", t), t);
  assert.equal(
    norm("client/packages/other/src/a.ts", t),
    "    '@sidekickdb/react',\n",
  );
});

test("CRLF line endings are preserved", () => {
  assert.equal(
    norm("client/a.md", "a @instantdb/core\r\nb\r\n"),
    "a @sidekickdb/core\r\nb\r\n",
  );
});

test("path forms: our packages renamed, vendored kept and reported, unknown reported", () => {
  const f = "client/packages/x/src/a.ts";
  assert.equal(
    norm(f, "COPY node_modules/@instantdb/react ./r\n"),
    "COPY node_modules/@sidekickdb/react ./r\n",
  );
  assert.equal(
    norm(
      f,
      "join(dir, 'node_modules', '@instantdb', 'react', 'package.json')\n",
    ),
    "join(dir, 'node_modules', '@sidekickdb', 'react', 'package.json')\n",
  );
  // eventsource paths are left alone and reported (admin has its own copy).
  for (const [t, id] of [
    [
      "alias: { es: 'node_modules/@instantdb/eventsource' }\n",
      "vendored-package",
    ],
    [
      "join(dir, 'node_modules', '@instantdb', 'eventsource')\n",
      "scope-path-segment",
    ],
  ]) {
    assert.equal(norm(f, t), t);
    const left = scanLeftovers(f, t);
    assert.deepEqual(
      left.map((l) => l.id),
      [id],
    );
    assert.match(left[0].hint, /own copy in client\/packages\/admin/);
  }
  const cases = [
    [
      "join(dir, 'node_modules', '@instantdb', 'newpkg')\n",
      "scope-path-segment",
    ],
    ["x node_modules/@instantdb/newpkg/index.js\n", "unknown-scoped-package"],
    ["ls node_modules/@instantdb\n", "scope-directory"],
  ];
  for (const [t, id] of cases) {
    assert.equal(norm(f, t), t);
    assert.deepEqual(
      scanLeftovers(f, t).map((l) => l.id),
      [id],
    );
  }
});

test("guards protect only the wire token, not the rest of the line", () => {
  const f = "client/packages/x/src/a.ts";
  assert.equal(
    norm(
      f,
      "h({ 'X-Instant-Source': 'instant-cli' }); import('@instantdb/core');\n",
    ),
    "h({ 'X-Instant-Source': 'instant-cli' }); import('@sidekickdb/core');\n",
  );
  assert.equal(
    norm(f, "const ua = `instant-cli/${v}`; // see npx instant-cli push\n"),
    "const ua = `instant-cli/${v}`; // see npx @sidekickdb/cli push\n",
  );
  // A leftover on a guarded line is still reported.
  const t = "new BroadcastChannel('@instantdb'); // Use instant-cli here\n";
  assert.equal(norm(f, t), t);
  assert.deepEqual(
    scanLeftovers(f, t).map((l) => l.id),
    ["cli-name"],
  );
});

test("session versions keys are kept for several value shapes", () => {
  const f = "client/packages/newfw/src/a.ts";
  for (const t of [
    "  '@instantdb/newfw': version,\n",
    "  '@instantdb/core': coreVersion,\n",
    "  '@instantdb/core': pkg.version,\n",
    "  '@instantdb/core': '1.2.3',\n",
  ]) {
    assert.equal(norm(f, t), t);
  }
});

test("an exact-version dependency in a package.json is renamed", () => {
  const pkg =
    '{\n  "dependencies": {\n    "@instantdb/core": "1.2.3",\n    "@instantdb/react": "^1.2.3"\n  }\n}\n';
  const out = norm("examples/foo/package.json", pkg);
  assert.equal(
    out,
    '{\n  "dependencies": {\n    "@sidekickdb/core": "1.2.3",\n    "@sidekickdb/react": "^1.2.3"\n  }\n}\n',
  );
  assert.deepEqual(
    scanLeftovers("examples/foo/package.json", pkg).map((l) => l.id),
    ["scoped-package", "scoped-package"],
  );
  assert.deepEqual(scanLeftovers("examples/foo/package.json", out), []);
  assert.match(
    norm("client/packages/react/package.json", pkg),
    /"@sidekickdb\/core": "workspace:\*"/,
  );
});

test("docs links get SidekickDB's host only in the listed paths", () => {
  const cases = [
    [
      "examples/vite-react/src/instant.perms.ts",
      "// Docs: https://www.instantdb.com/docs/permissions\n",
      "// Docs: https://sidekickdb.co/docs/permissions\n",
    ],
    [
      "client/www/lib/intern/instant-rules.md",
      "- [Auth](https://www.instantdb.com/docs/auth/magic-codes.md): x\n",
      "- [Auth](https://sidekickdb.co/docs/auth/magic-codes.md): x\n",
    ],
    [
      "client/packages/cli/src/a.ts",
      "see http://instantdb.com/docs/cli#push and https://instantdb.com/docs\n",
      "see https://sidekickdb.co/docs/cli#push and https://sidekickdb.co/docs\n",
    ],
    [
      "examples/bun-react/src/App.tsx",
      '<a href="https://www.instantdb.com/docs">\n',
      '<a href="https://sidekickdb.co/docs">\n',
    ],
    [
      "client/www/app/docs/a/page.md",
      "[x](https://www.instantdb.com/docs/x.md)\n",
      "[x](https://sidekickdb.co/docs/x.md)\n",
    ],
  ];
  for (const [f, t, want] of cases) {
    assert.equal(norm(f, t), want, f);
    assert.deepEqual(scanLeftovers(f, want), [], f);
  }
  // Outside the listed paths, and paths that only start with "/docs", stay.
  for (const [f, t] of [
    ["client/www/app/essays/a.md", "https://www.instantdb.com/docs/x\n"],
    ["client/packages/mcp/README.md", "https://www.instantdb.com/docs/x\n"],
    ["examples/todos/src/a.ts", "https://www.instantdb.com/docs/x\n"],
    ["client/packages/platform/src/other.ts", "https://instantdb.com/docs\n"],
    ["client/packages/cli/src/a.ts", "https://www.instantdb.com/docsearch\n"],
  ]) {
    assert.equal(norm(f, t), t, f);
  }
});

test("other instantdb.com links in the docs-host paths are leftovers", () => {
  const f = "examples/expo/README.md";
  for (const t of [
    "Get started at https://instantdb.com\n",
    "Open https://www.instantdb.com/dash to see your app\n",
    "Read https://www.instantdb.com/essays/next_firebase\n",
    "Docs: instantdb.com/docs/permissions\n",
  ]) {
    assert.equal(norm(f, t), t);
    assert.deepEqual(
      scanLeftovers(f, t).map((l) => l.id),
      ["instant-site-link"],
      t,
    );
  }
  // Other hosts and addresses on the same domain are not links to the site.
  for (const t of [
    "fetch('https://api.instantdb.com/examples/mma')\n",
    "mail founders@instantdb.com\n",
  ]) {
    assert.deepEqual(scanLeftovers(f, t), [], t);
  }
  // Outside the listed paths nothing is reported.
  assert.deepEqual(
    scanLeftovers("examples/todos/README.md", "https://instantdb.com\n"),
    [],
  );
});
