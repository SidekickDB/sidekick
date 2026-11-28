// SidekickDB package-rename rules, shared by normalize-rename.mjs, sync.mjs
// and check.mjs.
//
// This file encodes the rename from PR #7 (merge d3e2719e):
//   @instantdb/<name>   -> @sidekickdb/<name>   (the 16 workspace packages)
//   instant-cli         -> @sidekickdb/cli (package), sidekick-cli (binary)
//   create-instant-app  -> create-sidekick-app  (directory name unchanged)
// and, in the files listed in DOCS_HOST_PATHS only,
//   https://(www.)instantdb.com/docs/... -> https://sidekickdb.co/docs/...
// together with the paths that are never touched and the allowlist of old
// names that stay on purpose (wire identifiers, legacy-project detection,
// history). @instantdb/eventsource is not renamed either: admin has its own
// copy (VENDORED_SCOPED), so the old name is reported wherever it appears.
//
// Only mechanical, unambiguous rewrites are applied. Anything that needs a
// judgement call (for example prose that says "instant-cli" without a
// runner in front of it) is reported as a leftover instead of rewritten.
//
// Keep this file free of side effects: it is imported by the tests.

import path from "node:path";

export const SCOPED_PACKAGES = [
  "admin",
  "components",
  "core",
  "expo-sqlite",
  "mcp",
  "platform",
  "react",
  "react-common",
  "react-native",
  "react-native-mmkv",
  "resumable-stream",
  "solidjs",
  "svelte",
  "version",
  "vue",
  "webhooks",
];

// @instantdb/* packages that are NOT ours and must keep their name.
export const THIRD_PARTY_SCOPED = [];

// @instantdb/* packages SidekickDB replaced with its own copy, and where the
// copy is. Any use of the old name is a leftover.
export const VENDORED_SCOPED = {
  eventsource: "client/packages/admin/src/eventsource/",
};

const SCOPED = new Set(SCOPED_PACKAGES);
const THIRD_PARTY = new Set(THIRD_PARTY_SCOPED);
const VENDORED = new Map(Object.entries(VENDORED_SCOPED));

function vendoredHint(name) {
  return `@instantdb/${name} is replaced by SidekickDB's own copy in ${VENDORED.get(name)}: import that instead and do not add the dependency (UPSTREAM.md, "Own copy of eventsource in admin")`;
}

// ---------------------------------------------------------------------------
// Paths that are never rewritten (and never scanned for leftovers).

// Directory prefixes, relative to the repository root, with trailing slash.
export const EXCLUDED_DIRS = [
  "server/", // includes server/flags-config
  "self-hosting/",
  ".github/",
  "client/packages/python/",
  "client/www/_posts/", // essays
  "client/www/_emails/html/", // archived newsletters
  "client/www/_emails/txt/",
  "client/www/_emails/markdown/",
  "scripts/upstream/", // this tooling names the old identifiers on purpose
];

// Exact files.
export const EXCLUDED_FILES = [
  "LICENSE",
  "LICENSE.md",
  "NOTICE",
  "UPSTREAM.md",
  // Legacy-package compatibility tests: every old name in it is intentional.
  "client/packages/cli/__tests__/legacyPackageCompat.test.ts",
  // Transcript of a recorded video.
  "client/www/public/video-previews/captions.vtt",
];

// Lockfiles are only ever changed by the package manager.
export const LOCKFILE_BASENAMES = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];

export function isLockfile(file) {
  return LOCKFILE_BASENAMES.includes(path.posix.basename(file));
}

export function isExcluded(file) {
  const f = toPosix(file);
  if (EXCLUDED_FILES.includes(f)) return true;
  if (EXCLUDED_DIRS.some((d) => f.startsWith(d))) return true;
  if (isLockfile(f)) return true;
  return false;
}

function toPosix(file) {
  return file.split(path.sep).join("/").replace(/^\.\//, "");
}

// ---------------------------------------------------------------------------
// Guards: wire identifiers and internal keys that keep an old name wherever
// they appear, including in new upstream files. Only the matched text is
// protected (masked while the rules run), so other old names on the same
// line are still renamed or reported.

export const GUARDS = [
  // HTTP header values sent to the server.
  {
    re: /(['"`])X-Instant-Source\1\s*[:,]\s*(['"`])[^'"`]*\2/g,
    why: "X-Instant-Source header value",
  },
  // CLI User-Agent `instant-cli/<version>`.
  { re: /\binstant-cli\/(?=\$\{|\d|<)/g, why: "User-Agent value" },
  { re: /\binstant-cli-version\b/g, why: "instant-cli-version header" },
  // Effect service tags such as 'instant-cli/new/context/authToken'.
  { re: /(['"`])instant-cli\/new\/[^'"`]*\1/g, why: "internal Effect tag" },
  // Cross-tab runtime channel name.
  {
    re: /BroadcastChannel\(\s*(['"`])@instantdb\1\s*\)/g,
    why: "BroadcastChannel name",
  },
  // Session `versions` keys, read by server/src/instant/reactive/session.clj:
  // '@instantdb/<pkg>': version / coreVersion / pkg.version / '1.2.3'.
  // check.mjs also fails if the set of these keys changes. Not in a
  // package.json, where "@instantdb/<pkg>": "1.2.3" is a dependency.
  {
    re: /(['"])@instantdb\/[\w-]+\1(?=\s*:\s*(?:[\w.]*[vV]ersion\b|(['"`])\d+\.\d+))/g,
    why: "session versions key (wire protocol)",
    skip: (file) => path.posix.basename(file) === "package.json",
  },
];

const MASK_RE = /\u0000(\d+)\u0000/g;

/** Replace guarded spans with placeholders no rule can match. */
function mask(file, line) {
  const saved = [];
  let masked = line;
  for (const g of GUARDS) {
    if (g.skip?.(file)) continue;
    masked = masked.replace(g.re, (m) => {
      saved.push(m);
      return `\u0000${saved.length - 1}\u0000`;
    });
  }
  return {
    masked,
    unmask: (t) => t.replace(MASK_RE, (_m, n) => saved[Number(n)]),
  };
}

// ---------------------------------------------------------------------------
// Allowlist: specific lines in specific files that keep an old name. Matched
// by path and line content (not line number) so they survive upstream edits.
// Each entry is [path, regex, reason].

export const ALLOWLIST = [
  // Legacy @instantdb/* project detection and aliasing in the CLI.
  [
    "client/packages/cli/src/context/projectInfo.ts",
    /^\s*'@instantdb\/[\w-]+',\s*$/,
    "legacy package detection",
  ],
  [
    "client/packages/cli/src/util/loadConfig.ts",
    /'@instantdb\/[\w-]+': coreDir|Legacy @instantdb\/\*/,
    "legacy package aliasing",
  ],
  [
    "client/packages/cli/src/util/findConfigCandidates.ts",
    /Legacy @instantdb\/\*/,
    "legacy package comment",
  ],
  // The old binary name stays as an alias.
  [
    "client/packages/cli/package.json",
    /^\s*"instant-cli": "bin\/index\.js"/,
    "instant-cli binary alias",
  ],
  // Instant's history timeline.
  ["client/www/app/about/content.tsx", /create-instant-app/, "history"],
  // Paths to the unrenamed create-instant-app directory.
  [
    "client/scripts/publish_packages.clj",
    /:create-instant-app "\.\/packages\/create-instant-app"/,
    "directory path",
  ],
];

const ALLOW_BY_PATH = new Map();
for (const [p, re, why] of ALLOWLIST) {
  if (!ALLOW_BY_PATH.has(p)) ALLOW_BY_PATH.set(p, []);
  ALLOW_BY_PATH.get(p).push({ re, why });
}

function lineIsProtected(file, line) {
  for (const a of ALLOW_BY_PATH.get(file) || [])
    if (a.re.test(line)) return a.why;
  return null;
}

// ---------------------------------------------------------------------------
// Rewrite rules. Applied in order to each unprotected line. Every rule's
// output must not match any rule again (idempotency); the tests check this.

const VERSION = String.raw`(@[\w.^~*<>=-]+)?`;

// Top-level commands of the CLI (client/packages/cli/src/index.ts) and
// common flags. `instant-cli <one of these>` is a command invocation.
export const CLI_SUBCOMMANDS = [
  "init",
  "init-without-files",
  "auth",
  "app",
  "webhook",
  "webhooks",
  "backup",
  "login",
  "logout",
  "info",
  "explorer",
  "push",
  "pull",
  "claim",
  "query",
  "upload",
  "genpy",
  "whoami",
  "--help",
  "-h",
  "--version",
  "-v",
];
// Something that is not part of a longer identifier or path.
const END = String.raw`(?![\w/-])`;

function scopedReplacer(_m, escaped, name) {
  if (!SCOPED.has(name)) return _m;
  return `@sidekickdb${escaped}${name}`;
}

const COMMON_RULES = [
  {
    id: "scoped-package",
    // @instantdb/<name>, also the regex-escaped form @instantdb\/<name>.
    re: /@instantdb(\\?\/)([a-z0-9]+(?:-[a-z0-9]+)*)/g,
    to: scopedReplacer,
  },
  // node_modules/@instantdb/<pkg> is handled by "scoped-package" above,
  // which knows which packages are ours. The bare scope directory
  // (node_modules/@instantdb) is ambiguous, because it can also hold
  // upstream's published packages, so it is reported, not rewritten.
  {
    id: "cli-runner-pkg",
    // pnpm dlx / pnpx / bunx need the binary name because the package
    // ships two binaries (see PR #7).
    re: new RegExp(
      String.raw`\b(pnpm dlx|pnpx|bunx|bun x)\s+instant-cli${VERSION}${END}`,
      "g",
    ),
    to: (_m, runner, ver) =>
      `${runner} --package=@sidekickdb/cli${ver || ""} sidekick-cli`,
  },
  {
    id: "cli-runner-npx",
    re: new RegExp(
      String.raw`\b(npx|npm exec|npm x)((?:\s+(?:-y|--yes))?)\s+instant-cli${VERSION}${END}`,
      "g",
    ),
    to: (_m, runner, flags, ver) =>
      `${runner}${flags} @sidekickdb/cli${ver || ""}`,
  },
  {
    id: "cli-local-bin",
    // Runs or locates an already-installed binary.
    re: new RegExp(
      String.raw`\b(pnpm exec|yarn exec|bun run|which|command -v)\s+instant-cli${END}`,
      "g",
    ),
    to: "$1 sidekick-cli",
  },
  {
    id: "cli-subcommand",
    // `instant-cli <subcommand>` in help text, hints and docs names the
    // installed command. Runner forms were handled by the rules above.
    re: new RegExp(
      String.raw`(?<![\w@/.=-])instant-cli(?= (?:${CLI_SUBCOMMANDS.join("|")})(?![\w-]))`,
      "g",
    ),
    // Docs, the dashboard and examples address users who do not have the
    // binary installed, so they get the npx form (as PR #7 did there).
    to: (file) =>
      USER_FACING.test(file) ? "npx @sidekickdb/cli" : "sidekick-cli",
    perFile: true,
  },
  {
    id: "cli-program-name",
    re: /(\.name\(\s*)(['"])instant-cli\2/g,
    to: "$1$2sidekick-cli$2",
  },
  {
    id: "tmpdir-prefix",
    // Temp-directory name prefixes in tests.
    re: /(tmpdir\(\),\s*['"`])(instant-cli|create-instant-app)-/g,
    to: (_m, pre, name) =>
      `${pre}${name === "instant-cli" ? "sidekick-cli" : "create-sidekick-app"}-`,
  },
  {
    id: "scope-path-segment",
    // join(dir, 'node_modules', '@instantdb', 'react'): only when the next
    // segment is one of our packages. Third-party and unknown packages are
    // left alone (unknown ones are reported as leftovers).
    re: /((['"])node_modules\2,\s*)(['"])@instantdb\3(\s*,\s*)(['"])([a-z0-9]+(?:-[a-z0-9]+)*)\5/g,
    to: (m, pre, _q1, q, sep, q2, name) =>
      SCOPED.has(name) ? `${pre}${q}@sidekickdb${q}${sep}${q2}${name}${q2}` : m,
  },
  {
    id: "cli-install",
    // Installing, linking or removing the package by name.
    re: new RegExp(
      String.raw`\b(npm (?:i|install|add|uninstall|remove|rm|link|unlink)|pnpm (?:add|i|install|remove|rm|link|unlink)|yarn (?:add|remove|global add|global remove)|bun (?:add|i|install|remove|rm))((?:\s+--?[\w-]+)*)\s+instant-cli${VERSION}${END}`,
      "g",
    ),
    to: (_m, cmd, flags, ver) => `${cmd}${flags} @sidekickdb/cli${ver || ""}`,
  },
  {
    id: "cli-turbo-filter",
    re: new RegExp(
      String.raw`(--filter[= ]|turbo prune )(['"]?)instant-cli${END}`,
      "g",
    ),
    to: "$1$2@sidekickdb/cli",
  },
  {
    id: "cli-module-specifier",
    // import ... from 'instant-cli/ui', import('instant-cli'), require(...)
    re: /(\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+|\b(?:vi|jest)\.mock\(\s*)(['"])instant-cli((?:\/(?!new\/)[^'"]*)?)\2/g,
    to: "$1$2@sidekickdb/cli$3$2",
  },
  {
    id: "cli-registry-url",
    re: new RegExp(
      String.raw`((?:npmjs\.com\/package|unpkg\.com|cdn\.jsdelivr\.net\/npm|img\.shields\.io\/npm\/v)\/)instant-cli${END}`,
      "g",
    ),
    to: "$1@sidekickdb/cli",
  },
  {
    id: "create-app-runner",
    // npm create instant-app / pnpm create instant-app / npm init instant-app
    re: /\b(npm|pnpm|yarn|bun) (create|init) instant-app\b/g,
    to: "$1 $2 sidekick-app",
  },
  {
    id: "create-app",
    // create-instant-app everywhere except where it is a path segment
    // (packages/create-instant-app, /docs/create-instant-app, ./create-...)
    re: /(?<![\w/.@:-])create-instant-app(?![\w/-])/g,
    to: "create-sidekick-app",
  },
  {
    id: "docs-host",
    // Docs links in what the CLI and create-sidekick-app print and write, the
    // agent rules, the MCP server, the offered starters and the docs pages
    // point at SidekickDB's docs site; the path stays.
    re: /https?:\/\/(?:www\.)?instantdb\.com(?=\/docs(?![\w-]))/g,
    to: "https://sidekickdb.co",
    only: isDocsHostPath,
  },
];

// Files whose instantdb.com docs links are rewritten by "docs-host"; any
// other instantdb.com link left in them is reported as a leftover.
export const DOCS_HOST_PATHS = [
  "client/packages/cli/src/",
  "client/packages/create-instant-app/src/",
  "client/packages/create-instant-app/template/",
  "client/packages/mcp/src/",
  "client/packages/platform/src/perms.ts",
  "client/packages/platform/src/schema.ts",
  "client/packages/platform/__tests__/src/perms.test.ts",
  "client/packages/platform/__tests__/src/schema.test.ts",
  "client/www/lib/intern/instant-rules.md",
  // The docs pages and their chrome.
  "client/www/app/docs/",
  "client/www/components/docs/",
  "client/www/components/DocsPage.jsx",
  "client/www/data/docsNavigation.js",
  // The starters create-sidekick-app offers.
  ...[
    "next-js-app-dir",
    "vite-react",
    "vite-vanilla",
    "expo",
    "tanstack-start",
    "tanstack-start-with-tanstack-query",
    "bun-react",
    "solidjs-vite",
    "sveltekit",
    "vue-vite",
    "vercel-ai-sdk",
    "ai-chat",
  ].map((s) => `examples/${s}/`),
];

export function isDocsHostPath(file) {
  const f = toPosix(file);
  return DOCS_HOST_PATHS.some((p) =>
    p.endsWith("/") ? f.startsWith(p) : f === p,
  );
}

// Extra rules for package.json files only.
const PACKAGE_JSON_RULES = [
  {
    id: "pkg-name-cli",
    re: /^(\s*"name":\s*)"instant-cli"/,
    to: '$1"@sidekickdb/cli"',
  },
  {
    id: "pkg-dep-cli",
    // "instant-cli": "<version spec>" in a dependency section. The bin alias
    // ("instant-cli": "bin/index.js") is allowlisted and never matches the
    // version-spec lookahead anyway.
    re: /^(\s*)"instant-cli"(\s*:\s*)"(?=workspace:|link:|file:|npm:|catalog:|latest|next|\*|[\^~<>=]|\d)/,
    to: '$1"@sidekickdb/cli"$2"',
  },
  {
    id: "pkg-script-bin",
    // "scripts" values that run the installed binary: "... instant-cli push".
    re: /(?<=^\s*"[^"]+":\s*"(?:[^"]*[\s;&|(])?)instant-cli(?=[\s"])/g,
    to: "sidekick-cli",
  },
  {
    id: "pkg-script-key",
    // Script names such as "instant-cli-init" (renamed in PR #7).
    re: /^(\s*)"instant-cli-([\w:-]+)":(?=\s*")/,
    to: '$1"sidekick-cli-$2":',
  },
  {
    id: "pkg-repo-url",
    // repository / bugs / homepage of our own packages.
    re: /https:\/\/github\.com\/instantdb\/instant(?=[.\/"#])/g,
    to: "https://github.com/SidekickDB/sidekick",
    only: (file) =>
      /^client\/packages\/(?!python\/)[^/]+\/package\.json$/.test(file),
  },
];

// In the client pnpm workspace, a renamed package can only be resolved from
// the workspace: it is not published under the new name yet. A registry
// range would make pnpm look for an unpublished @sidekickdb/* package.
const WORKSPACE_PACKAGE_JSON =
  /^client\/(package\.json|packages\/(?!python\/)[^/]+\/package\.json|sandbox\/[^/]+\/package\.json|www\/package\.json|www\/_emails\/replace-images\/package\.json)$/;

export function isWorkspacePackageJson(file) {
  return WORKSPACE_PACKAGE_JSON.test(toPosix(file));
}

function workspaceSpecRule(file) {
  if (!isWorkspacePackageJson(file)) return null;
  return {
    id: "pkg-workspace-spec",
    re: /^(\s*"(?:@sidekickdb\/[\w-]+|create-sidekick-app)"\s*:\s*)"(?!workspace:)[^"]*"/,
    to: '$1"workspace:*"',
  };
}

const USER_FACING = /^(client\/www\/|examples\/)/;

function rulesFor(file) {
  const rules = COMMON_RULES.filter((r) => !r.only || r.only(file)).map((r) =>
    r.perFile ? { ...r, to: r.to(file) } : r,
  );
  if (path.posix.basename(file) === "package.json") {
    for (const r of PACKAGE_JSON_RULES)
      if (!r.only || r.only(file)) rules.push(r);
  }
  return rules;
}

// ---------------------------------------------------------------------------

const CODE_EXT = /\.(?:[cm]?[jt]sx?|svelte|vue)$/;

// Heuristic for a JS regex literal: a '/' in operand position (after an
// operator, bracket, keyword or line start), a body, a closing '/' and flags.
const REGEX_LITERAL =
  /(?<=(?:^|[=(,:\[!&|?{};~+*%<>-]|\breturn|\btypeof)\s*)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*/g;

function splitLines(text) {
  // Keep line endings attached so joining is lossless.
  return text.match(/[^\n]*\n|[^\n]+$/g) || [];
}

// The workspace-spec rule applies only inside dependency sections; track
// which top-level section a package.json line is in.
function packageJsonSections(lines) {
  const out = [];
  let section = null;
  // Indentation of top-level keys (upstream uses two spaces).
  const first = lines.find((l) => /^\s+"/.test(l));
  const ind = first ? first.match(/^\s+/)[0] : "  ";
  const open = new RegExp(`^${ind}"([^"]+)":\\s*[{[]\\s*$`);
  const close = new RegExp(`^${ind}[}\\]]`);
  for (const line of lines) {
    const m = line.match(open);
    if (m) section = m[1];
    else if (close.test(line)) {
      out.push(section);
      section = null;
      continue;
    }
    out.push(section);
  }
  return out;
}

const DEP_SECTIONS = new Set([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]);

export function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * Apply the rename to one file's text.
 * @returns {{ text: string, changes: {line:number, rule:string, before:string, after:string}[] }}
 */
export function normalizeText(file, text) {
  file = toPosix(file);
  if (isExcluded(file)) return { text, changes: [] };
  const rules = rulesFor(file);
  const lines = splitLines(text);
  const sections =
    path.posix.basename(file) === "package.json"
      ? packageJsonSections(lines)
      : null;
  const changes = [];
  const out = lines.map((line, i) => {
    if (!/instantdb|instant-cli|instant-app/.test(line)) return line;
    if (lineIsProtected(file, line)) return line;
    const orig = line;
    const { masked, unmask } = mask(file, line);
    line = masked;
    const applicable = rules.filter((r) => {
      if (!sections) return true;
      if (r.id === "pkg-dep-cli") return DEP_SECTIONS.has(sections[i]);
      if (r.id === "pkg-script-bin" || r.id === "pkg-script-key")
        return sections[i] === "scripts";
      return true;
    });
    const applied = new Set();
    const apply = (seg, inRegex) => {
      for (const r of applicable) {
        const next = seg.replace(r.re, r.to);
        if (next !== seg) {
          applied.add(r.id);
          seg = next;
        }
      }
      // A JS regex literal cannot contain an unescaped '/', so any
      // '@sidekickdb/' in one was introduced by a rule: escape it.
      return inRegex
        ? seg.replace(/(?<!\\)@sidekickdb\//g, "@sidekickdb\\/")
        : seg;
    };
    let cur = "";
    let last = 0;
    if (CODE_EXT.test(file) && /instant-cli/.test(line)) {
      for (const m of line.matchAll(REGEX_LITERAL)) {
        if (!/instant-cli/.test(m[0])) continue;
        cur += apply(line.slice(last, m.index), false) + apply(m[0], true);
        last = m.index + m[0].length;
      }
    }
    cur = unmask(cur + apply(line.slice(last), false));
    if (cur !== orig) {
      changes.push({
        line: i + 1,
        rule: [...applied].join("+"),
        before: orig.trimEnd(),
        after: cur.trimEnd(),
      });
    }
    return cur;
  });
  // The workspace-spec rule needs the renamed key, so run it as a second
  // pass on lines the first pass produced.
  if (sections && isWorkspacePackageJson(file)) {
    const ws = workspaceSpecRule(file);
    for (let i = 0; i < out.length; i++) {
      if (!DEP_SECTIONS.has(sections[i])) continue;
      const next = out[i].replace(ws.re, ws.to);
      if (next !== out[i]) {
        changes.push({
          line: i + 1,
          rule: ws.id,
          before: out[i].trimEnd(),
          after: next.trimEnd(),
        });
        out[i] = next;
      }
    }
  }
  return { text: out.join(""), changes };
}

// ---------------------------------------------------------------------------
// Leftovers: old names that survive the rules and are not allowlisted. These
// need a person to decide (for example prose about the CLI, or a package
// upstream added after the rename).

const LEFTOVER_CHECKS = [
  {
    id: "unknown-scoped-package",
    re: /@instantdb\\?\/([a-z0-9][a-z0-9-]*)/g,
    test: (m) =>
      !THIRD_PARTY.has(m[1]) && !SCOPED.has(m[1]) && !VENDORED.has(m[1]),
    hint: (m) =>
      `@instantdb/${m[1]} is not in the rename map. If upstream added a new package, add '${m[1]}' to SCOPED_PACKAGES in scripts/upstream/rename.mjs; if it is third-party, add it to THIRD_PARTY_SCOPED.`,
  },
  {
    id: "vendored-package",
    re: /@instantdb\\?\/([a-z0-9][a-z0-9-]*)/g,
    // Unmasked: a vendored package is reported even where a guard masks it.
    unmasked: true,
    test: (m) => VENDORED.has(m[1]),
    hint: (m) => vendoredHint(m[1]),
  },
  {
    id: "scoped-package",
    re: /@instantdb\\?\/([a-z0-9][a-z0-9-]*)/g,
    test: (m) => SCOPED.has(m[1]),
    hint: () => "old package name in a context the rules do not rewrite",
  },
  {
    id: "bare-scope",
    // A quoted '@instantdb' scope, unless the next path segment names a
    // package (join(..., '@instantdb', '<pkg>'), see scope-path-segment).
    re: /(['"`])@instantdb\1(?!\s*,\s*(['"])([a-z0-9-]+)\2)/g,
    test: () => true,
    hint: () =>
      "bare '@instantdb' scope: '@sidekickdb' if it means our packages",
  },
  {
    id: "scope-path-segment",
    // join(..., '@instantdb', '<pkg>') with a package that is neither ours
    // nor known third-party (vendored packages are reported too).
    re: /(['"`])@instantdb\1\s*,\s*(['"])([a-z0-9]+(?:-[a-z0-9]+)*)\2/g,
    test: (m) => !SCOPED.has(m[3]) && !THIRD_PARTY.has(m[3]),
    hint: (m) =>
      VENDORED.has(m[3])
        ? vendoredHint(m[3])
        : `path to @instantdb/${m[3]}, which is not in the rename map: add it to SCOPED_PACKAGES or THIRD_PARTY_SCOPED in scripts/upstream/rename.mjs`,
  },
  {
    id: "scope-directory",
    // node_modules/@instantdb on its own (no package after it).
    re: /node_modules\/@instantdb(?![\\/\w-])/g,
    test: () => true,
    hint: () =>
      "the bare node_modules/@instantdb scope directory can hold upstream's packages too; point it at the package you mean",
  },
  {
    id: "cli-name",
    re: /(?<![\w@/.-])instant-cli(?![\w-])/g,
    test: () => true,
    hint: () =>
      "instant-cli: use @sidekickdb/cli when naming the package, sidekick-cli when naming the command",
  },
  {
    id: "create-app-name",
    re: /(?<![\w/.@:-])create-instant-app(?![\w/-])/g,
    test: () => true,
    hint: () =>
      "create-instant-app: use create-sidekick-app unless it is a path or route",
  },
  {
    id: "repo-url",
    re: /github\.com\/instantdb\/instant(?![\w-])/g,
    test: (_m, file) =>
      /^client\/packages\/(?!python\/)[^/]+\/package\.json$/.test(file),
    hint: () => "package metadata should point at SidekickDB/sidekick",
  },
  {
    id: "instant-site-link",
    // An instantdb.com link "docs-host" does not rewrite (essays, pricing,
    // Discord, the hosted dashboard, a docs link without a scheme).
    re: /(?<![\w.@-])(?:https?:\/\/)?(?:www\.)?instantdb\.com(?![\w-])/g,
    test: (_m, file) => isDocsHostPath(file),
    hint: () =>
      "instantdb.com link: remove it, or point at the user's SidekickDB dashboard; docs links are https://sidekickdb.co/docs/...",
  },
];

/** @returns {{line:number, id:string, text:string, hint:string}[]} */
export function scanLeftovers(file, text) {
  file = toPosix(file);
  if (isExcluded(file)) return [];
  const found = [];
  if (
    /^client\/packages\/(?!python\/)[^/]+\/package\.json$/.test(file) &&
    /"name":\s*"(@sidekickdb\/|create-sidekick-app)/.test(text) &&
    !text.includes("https://github.com/SidekickDB/sidekick/issues")
  ) {
    found.push({
      line: 1,
      id: "package-bugs-field",
      text: file,
      hint: 'add "bugs": { "url": "https://github.com/SidekickDB/sidekick/issues" } after "repository" (as in PR #7)',
    });
  }
  splitLines(text).forEach((line, i) => {
    if (!/instantdb|instant-cli|instant-app/.test(line)) return;
    if (lineIsProtected(file, line)) return;
    const scan = mask(file, line).masked;
    for (const c of LEFTOVER_CHECKS) {
      for (const m of (c.unmasked ? line : scan).matchAll(c.re)) {
        if (c.test(m, file)) {
          found.push({
            line: i + 1,
            id: c.id,
            text: line.trim().slice(0, 200),
            hint: c.hint(m),
          });
        }
      }
    }
  });
  return found;
}
