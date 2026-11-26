// Run with: node --test scripts/upstream/*.test.mjs
// Uses temporary copies of the repository's real workflow files.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkWorkflows,
  hasReleaseGuard,
  isFalse,
  compareVersionsKeys,
  runChecks,
  scanAddedLines,
  versionsKeys,
} from "./check.mjs";
import { checkServerMinimums } from "../../client/scripts/sidekick-release-npm.mjs";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const realDir = path.join(repo, ".github/workflows");

function withWorkflows(mutate, mutateRoot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sk-check-"));
  const dir = path.join(root, ".github/workflows");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(realDir))
    fs.copyFileSync(path.join(realDir, f), path.join(dir, f));
  mutate?.(dir);
  mutateRoot?.(root);
  try {
    return checkWorkflows(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function edit(dir, file, from, to) {
  const p = path.join(dir, file);
  const s = fs.readFileSync(p, "utf8");
  assert.ok(s.includes(from), `${file} does not contain ${from}`);
  fs.writeFileSync(p, s.replace(from, to));
}

test("current workflows pass", () => {
  const r = withWorkflows();
  assert.deepEqual(r.failures, []);
});

test("re-enabling a disabled publish job fails", () => {
  const r = withWorkflows((d) =>
    edit(
      d,
      "js.yml",
      "    if: false && (github.ref == 'refs/heads/main' && needs.detect_changes.outputs.version_did_change == 'true')",
      "    if: github.ref == 'refs/heads/main' && needs.detect_changes.outputs.version_did_change == 'true'",
    ),
  );
  assert.ok(
    r.failures.some((f) => f.includes('"publish-packages" must stay disabled')),
    r.failures.join("\n"),
  );
});

test('"Run tests" without the network-guard env or command fails', () => {
  const r1 = withWorkflows((d) =>
    edit(
      d,
      "js.yml",
      "          SIDEKICK_E2E_API_URI: ''\n",
      "          SIDEKICK_E2E_API_URI: https://api.instantdb.com\n",
    ),
  );
  assert.ok(
    r1.failures.some((f) => f.includes("SIDEKICK_E2E_API_URI")),
    r1.failures.join("\n"),
  );
  const r2 = withWorkflows((d) =>
    edit(d, "js.yml", "          SIDEKICK_NETWORK_GUARD_ALLOW: ''\n", ""),
  );
  assert.ok(
    r2.failures.some((f) => f.includes("SIDEKICK_NETWORK_GUARD_ALLOW")),
    r2.failures.join("\n"),
  );
  const r3 = withWorkflows((d) =>
    edit(
      d,
      "js.yml",
      "        run: pnpm run test --continue\n",
      "        run: pnpm exec turbo run test:ci\n",
    ),
  );
  assert.ok(
    r3.failures.some((f) => f.includes("must run `pnpm run test`")),
    r3.failures.join("\n"),
  );
});

test("client test script must keep the network guard", () => {
  const r = withWorkflows(null, (root) => {
    fs.mkdirSync(path.join(root, "client"));
    fs.writeFileSync(
      path.join(root, "client/package.json"),
      JSON.stringify({
        scripts: {
          test: "turbo run test:ci",
          bench: "node scripts/with-network-guard.mjs turbo run bench:ci",
        },
      }),
    );
  });
  assert.ok(
    r.failures.some((f) => f.includes('script "test"')),
    r.failures.join("\n"),
  );
  assert.ok(!r.failures.some((f) => f.includes('script "bench"')));
});

test("workflow-level secrets, secrets: inherit and `false ||` are caught", () => {
  const a = withWorkflows((d) =>
    edit(
      d,
      "python.yml",
      "jobs:\n",
      "env:\n  NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n\njobs:\n",
    ),
  );
  assert.ok(
    a.failures.some((f) =>
      f.includes("workflow-level setting uses a repository secret"),
    ),
    a.failures.join("\n"),
  );
  const b = withWorkflows((d) =>
    fs.appendFileSync(
      path.join(d, "js.yml"),
      "\n  call-release:\n    uses: ./.github/workflows/release.yml\n    secrets: inherit\n",
    ),
  );
  assert.ok(
    b.failures.some((f) => f.includes("secrets: inherit")),
    b.failures.join("\n"),
  );
  const c = withWorkflows((d) =>
    edit(
      d,
      "js.yml",
      "    if: false && (github.ref == 'refs/heads/main' && needs.detect_changes.outputs.version_did_change == 'true')",
      "    if: false || (github.ref == 'refs/heads/main' && needs.detect_changes.outputs.version_did_change == 'true')",
    ),
  );
  assert.ok(
    c.failures.some((f) => f.includes('"publish-packages" must stay disabled')),
    c.failures.join("\n"),
  );
});

test("a local action used by an enabled job is scanned", () => {
  const r = withWorkflows(
    (d) =>
      edit(
        d,
        "js.yml",
        "      - name: Build sandbox\n",
        "      - name: Release\n        uses: ./.github/actions/release\n\n      - name: Build sandbox\n",
      ),
    (root) => {
      fs.mkdirSync(path.join(root, ".github/actions/release"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(root, ".github/actions/release/action.yml"),
        "runs:\n  using: composite\n  steps:\n    - run: npm publish\n      shell: bash\n",
      );
    },
  );
  assert.ok(
    r.failures.some(
      (f) =>
        f.includes("action used by enabled job") &&
        f.includes("publishes packages"),
    ),
    r.failures.join("\n"),
  );
});

test("added lines: hosts by class, Instant emails outside docs and tests, SDK hosts", () => {
  const diff = [
    "+++ b/server/src/instant/postmark.clj",
    "@@ -1,0 +10,2 @@",
    '+(def default-from "teams@pm.instantdb.com")',
    "+(def x 1)",
    "+++ b/client/packages/core/src/endpoints.ts",
    "@@ -1,0 +5,1 @@",
    "+const apiURI = 'https://api.instantdb.com';",
    "+++ b/client/packages/core/__tests__/src/a.test.ts",
    "@@ -1,0 +1,1 @@",
    "+lookup('email', 'stopa@instantdb.com')",
    "+++ b/client/www/app/docs/a/page.md",
    "@@ -1,0 +1,1 @@",
    "+See https://www.instantdb.com/docs",
  ].join("\n");
  const r = scanAddedLines(diff);
  assert.deepEqual(r.emails, [
    'server/src/instant/postmark.clj:10: (def default-from "teams@pm.instantdb.com")',
  ]);
  assert.equal(r.runtime.length, 1);
  assert.match(r.sdk[0], /endpoints\.ts:5/);
  assert.equal(r["docs-tests"].length, 2);
});

test("versions keys: a renamed or removed key fails, a new one is reported", () => {
  const before = versionsKeys([
    ["client/packages/react/src/init.ts", "  '@instantdb/react': version,\n"],
  ]);
  const renamed = versionsKeys([
    ["client/packages/react/src/init.ts", "  '@sidekickdb/react': version,\n"],
  ]);
  const r = compareVersionsKeys(before, renamed);
  assert.equal(r.failures.length, 2);
  const grown = versionsKeys([
    ["client/packages/react/src/init.ts", "  '@instantdb/react': version,\n"],
    ["client/packages/newfw/src/a.ts", "  '@instantdb/newfw': pkg.version,\n"],
  ]);
  const g = compareVersionsKeys(before, grown);
  assert.deepEqual(g.failures, []);
  assert.equal(g.info.length, 1);
});

test("a new enabled job that publishes fails; gated it passes", () => {
  const job = (cond) => `
  publish-canary:
    runs-on: ubuntu-latest
    if: ${cond}
    permissions:
      id-token: write
    steps:
      - run: pnpm publish -r --tag canary
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
`;
  const bad = withWorkflows((d) =>
    fs.appendFileSync(
      path.join(d, "js.yml"),
      job("github.ref == 'refs/heads/main'"),
    ),
  );
  assert.ok(
    bad.failures.some((f) => f.includes('"publish-canary" publishes packages')),
    bad.failures.join("\n"),
  );
  assert.ok(
    bad.failures.some((f) =>
      f.includes('"publish-canary" uses a repository secret'),
    ),
  );
  const ok = withWorkflows((d) =>
    fs.appendFileSync(
      path.join(d, "js.yml"),
      job("false && (github.ref == 'refs/heads/main')"),
    ),
  );
  assert.deepEqual(ok.failures, []);
});

test("a publish-only workflow regaining a push trigger fails", () => {
  const r = withWorkflows((d) =>
    edit(d, "sync-instant-skills.yml", "  # push:\n", "  push:\n"),
  );
  assert.ok(
    r.failures.some((f) =>
      f.includes("triggers besides workflow_dispatch: push"),
    ),
    r.failures.join("\n"),
  );
});

test("schedule triggers fail anywhere", () => {
  const r = withWorkflows((d) =>
    edit(
      d,
      "python.yml",
      "on:\n",
      "on:\n  schedule:\n    - cron: '0 3 * * *'\n",
    ),
  );
  assert.ok(
    r.failures.some((f) => f.includes("schedule trigger")),
    r.failures.join("\n"),
  );
});

test("jobs disabled at the base must stay disabled", () => {
  const learned = { jobs: { "python.yml": ["check"] }, steps: {} };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sk-check-"));
  try {
    fs.mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
    fs.copyFileSync(
      path.join(realDir, "python.yml"),
      path.join(root, ".github/workflows/python.yml"),
    );
    const r = checkWorkflows(root, learned);
    assert.ok(
      r.failures.some((f) => f.includes('job "check" must stay disabled')),
      r.failures.join("\n"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an enabled step that calls an Instant host fails", () => {
  const r = withWorkflows((d) =>
    edit(
      d,
      "js.yml",
      "      - name: Build sandbox\n",
      "      - name: Upload timings\n        run: curl -X POST https://api.instantdb.com/admin/transact\n\n      - name: Build sandbox\n",
    ),
  );
  assert.ok(
    r.failures.some((f) => f.includes("contacts an Instant-owned host")),
    r.failures.join("\n"),
  );
});

test("isFalse accepts only conditions that are always false", () => {
  for (const c of [
    "false",
    "(false)",
    "false && (github.ref == 'refs/heads/main')",
    "(false) && x",
    "${{ false }}",
    "${{ false && fromJSON(steps.detect_changes.outputs.result) }}",
    "false && (a || b)",
  ]) {
    assert.equal(isFalse(c), true, c);
  }
  for (const c of [
    "(false) || always()",
    "${{ false }} || true",
    "${{ false && x }} || true",
    "false || x",
    "false && x || y",
    "(false && x) || y",
    "${{ false || x }}",
    "x && false",
    "true",
    null,
  ]) {
    assert.equal(isFalse(c), false, String(c));
  }
});

test("a publish job re-enabled with `(false) ||` or `${{ false }} ||` fails", () => {
  const before =
    "    if: false && (github.ref == 'refs/heads/main' && needs.detect_changes.outputs.version_did_change == 'true')";
  for (const after of [
    "    if: (false) || always()",
    "    if: ${{ false }} || true",
  ]) {
    const r = withWorkflows((d) => edit(d, "js.yml", before, after));
    assert.ok(
      r.failures.some((f) => f.includes('"publish-packages" must stay disabled')),
      `${after}\n${r.failures.join("\n")}`,
    );
  }
});

test("any write permission or write-all in an enabled job or at workflow level fails", () => {
  const top = withWorkflows((d) =>
    edit(d, "js.yml", "jobs:\n", "permissions: write-all\n\njobs:\n"),
  );
  assert.ok(
    top.failures.some((f) => f.includes("workflow-level setting asks for every write permission (write-all)")),
    top.failures.join("\n"),
  );
  assert.equal(top.failures.length, 1, top.failures.join("\n"));
  for (const scope of ["actions", "pull-requests", "deployments", "pages", "attestations", "statuses", "issues"]) {
    const r = withWorkflows((d) =>
      fs.appendFileSync(
        path.join(d, "python.yml"),
        `\n  cache-warm:\n    runs-on: ubuntu-latest\n    permissions:\n      ${scope}: write\n    steps:\n      - run: echo hi\n`,
      ),
    );
    assert.ok(
      r.failures.some((f) => f.includes('enabled job "cache-warm" asks for a write permission')),
      `${scope}\n${r.failures.join("\n")}`,
    );
  }
  const quoted = withWorkflows((d) =>
    fs.appendFileSync(
      path.join(d, "python.yml"),
      "\n  q:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: 'write'\n    steps:\n      - run: echo hi\n",
    ),
  );
  assert.ok(quoted.failures.some((f) => f.includes('"q" asks for a write permission')), quoted.failures.join("\n"));
});

// SidekickDB release workflows (RELEASING.md).
const NPM = "sidekick-release-npm.yml";
const IMAGES = "sidekick-release-images.yml";
const GUARD =
  "    if: github.repository == 'SidekickDB/sidekick' && github.ref == 'refs/heads/main'\n";

function failsWith(r, ...needles) {
  for (const n of needles)
    assert.ok(
      r.failures.some((f) => f.includes(n)),
      `expected a failure containing ${JSON.stringify(n)}, got:\n${r.failures.join("\n")}`,
    );
}

test("release workflows keep their rights only while their shape holds", () => {
  failsWith(
    withWorkflows((d) => edit(d, NPM, "    environment: npm-release\n", "")),
    'must use `environment: npm-release`',
    "id-token: write (OIDC publishing/deploys)",
    "runs the SidekickDB npm release script",
  );
  failsWith(
    withWorkflows((d) =>
      edit(d, NPM, "on:\n  workflow_dispatch:\n", "on:\n  push:\n  workflow_dispatch:\n"),
    ),
    "workflow_dispatch only, found: push, workflow_dispatch",
  );
  failsWith(
    withWorkflows((d) => edit(d, IMAGES, "permissions: {}\n", "")),
    "must set `permissions: {}`",
    'enabled job "build" pushes images',
  );
  failsWith(
    withWorkflows((d) =>
      edit(d, IMAGES, "    environment: image-release\n", "    environment: npm-release\n"),
    ),
    "must use `environment: image-release`, found npm-release",
  );
  failsWith(
    withWorkflows((d) =>
      edit(d, NPM, GUARD, GUARD.replace("refs/heads/main'", "refs/heads/main' || true")),
    ),
    'release job "build" must be guarded',
  );
  // The build job must never hold the publish credential.
  failsWith(
    withWorkflows((d) =>
      edit(d, NPM, "    permissions:\n      contents: read\n    steps:\n      - name: Checkout\n",
        "    permissions:\n      contents: read\n      id-token: write\n    steps:\n      - name: Checkout\n"),
    ),
    'release job "build" must use `environment: npm-release`, found (none)',
    'enabled job "build" id-token: write',
  );
  // Moving the environment off the publish job drops its rights.
  failsWith(
    withWorkflows((d) => {
      edit(d, NPM, "    environment: npm-release\n", "");
      edit(d, NPM, "    timeout-minutes: 45\n", "    timeout-minutes: 45\n    environment: npm-release\n");
    }),
    'release job "publish" must use `environment: npm-release`, found (none)',
    'enabled job "publish" id-token: write',
  );
});

test("a release workflow still may not use secrets or other write rights", () => {
  failsWith(
    withWorkflows((d) =>
      edit(d, NPM, "          DRY_RUN: ${{ inputs.dry_run }}\n",
        "          DRY_RUN: ${{ inputs.dry_run }}\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n"),
    ),
    'enabled job "publish" uses a repository secret',
  );
  failsWith(
    withWorkflows((d) => edit(d, NPM, "      contents: read\n", "      contents: write\n")),
    'enabled job "build" asks for a write permission: contents: write',
  );
  failsWith(
    withWorkflows((d) =>
      edit(d, NPM, "      contents: read\n      id-token: write\n", "      contents: write\n      id-token: write\n"),
    ),
    'enabled job "publish" asks for a write permission: contents: write',
  );
  // An image push right is not a publish right in the npm workflow.
  failsWith(
    withWorkflows((d) =>
      edit(d, NPM, "      contents: read\n      id-token: write\n", "      contents: read\n      id-token: write\n      packages: write\n"),
    ),
    'enabled job "publish" asks for a write permission: packages: write',
  );
});

test("the npm release script may run only from its release workflow", () => {
  const r = withWorkflows((d) =>
    fs.appendFileSync(
      path.join(d, "python.yml"),
      `
  sneaky:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/sidekick-release-npm.mjs publish --tag latest
`,
    ),
  );
  failsWith(r, 'enabled job "sneaky" runs the SidekickDB npm release script');
  const plan = withWorkflows((d) =>
    fs.appendFileSync(
      path.join(d, "python.yml"),
      `
  plan:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/sidekick-release-npm.mjs plan
`,
    ),
  );
  assert.deepEqual(plan.failures, []);
});

test("hasReleaseGuard needs both guards as top-level && terms", () => {
  const g = "github.repository == 'SidekickDB/sidekick' && github.ref == 'refs/heads/main'";
  assert.equal(hasReleaseGuard(g), true);
  assert.equal(hasReleaseGuard(`\${{ ${g} }}`), true);
  assert.equal(hasReleaseGuard(`(${g}) && inputs.push`), true);
  assert.equal(hasReleaseGuard(`${g} && inputs.push`), true);
  assert.equal(hasReleaseGuard("github.repository == 'SidekickDB/sidekick'"), false);
  assert.equal(hasReleaseGuard(`${g} || true`), false);
  assert.equal(hasReleaseGuard(`(${g}) || always()`), false);
  assert.equal(hasReleaseGuard(`\${{ ${g} }} || true`), false);
  assert.equal(hasReleaseGuard(null), false);
});

test("push: ${{ ... }} counts as an image push outside the release workflow", () => {
  const r = withWorkflows((d) =>
    fs.appendFileSync(
      path.join(d, "python.yml"),
      `
  images:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/build-push-action@v6
        with:
          push: \${{ github.event_name == 'push' }}
`,
    ),
  );
  failsWith(r, 'enabled job "images" pushes images');
});

test("the self-hosted benchmark workflow stays read-only", () => {
  const file = "sidekick-self-hosted-bench.yml";
  const r0 = withWorkflows();
  assert.ok(
    !r0.warnings.some((w) => w.includes(file)),
    r0.warnings.join("\n"),
  );
  const r1 = withWorkflows((d) =>
    edit(d, file, "  contents: read\n", "  contents: read\n  packages: write\n"),
  );
  assert.ok(
    r1.failures.some(
      (f) => f.includes(file) && f.includes("write permission"),
    ),
    r1.failures.join("\n"),
  );
  const r2 = withWorkflows((d) =>
    edit(
      d,
      file,
      "  workflow_dispatch:\n",
      "  schedule:\n    - cron: '0 3 * * *'\n  workflow_dispatch:\n",
    ),
  );
  assert.ok(
    r2.failures.some((f) => f.includes(file) && f.includes("schedule")),
    r2.failures.join("\n"),
  );
});

test("the self-hosting compose check workflow stays read-only", () => {
  const file = "sidekick-self-hosting-check.yml";
  const r0 = withWorkflows();
  assert.deepEqual(r0.failures, []);
  assert.ok(
    !r0.warnings.some((w) => w.includes(file)),
    r0.warnings.join("\n"),
  );
  const r1 = withWorkflows((d) =>
    edit(d, file, "  contents: read\n", "  contents: write\n"),
  );
  assert.ok(
    r1.failures.some(
      (f) => f.includes(file) && f.includes("write permission"),
    ),
    r1.failures.join("\n"),
  );
});

test("the two-node smoke workflow stays read-only and does not push", () => {
  const file = "sidekick-two-node-smoke.yml";
  const r0 = withWorkflows();
  assert.deepEqual(r0.failures, []);
  assert.ok(
    !r0.warnings.some((w) => w.includes(file)),
    r0.warnings.join("\n"),
  );
  const r1 = withWorkflows((d) =>
    edit(d, file, "  contents: read\n", "  contents: read\n  packages: write\n"),
  );
  assert.ok(
    r1.failures.some(
      (f) => f.includes(file) && f.includes("write permission"),
    ),
    r1.failures.join("\n"),
  );
  const r2 = withWorkflows((d) =>
    edit(d, file, "          push: false\n", "          push: true\n"),
  );
  assert.ok(
    r2.failures.some((f) => f.includes(file) && f.includes("pushes images")),
    r2.failures.join("\n"),
  );
});

function withServerMinimums({ version, session, routes }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sk-minimums-"));
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write("client/packages/version/src/version.ts", `const version = '${version}';\n`);
  write("server/src/instant/reactive/session.clj", session);
  write("server/src/instant/dash/routes.clj", routes);
  try {
    return checkServerMinimums(root);
  } catch (e) {
    return [e.message];
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("the version must be above every server version minimum", () => {
  const session =
    '(def patch-presence-min-version\n  (semver/parse "v0.17.5"))\n' +
    '(def batch-messages-min-version\n  (semver/parse "0.22.75"))\n';
  const routes = '(def cli-min-version (semver/parse "v0.19.0"))\n';
  assert.deepEqual(withServerMinimums({ version: "v2.0.0", session, routes }), []);

  const raised = withServerMinimums({
    version: "v2.0.0",
    session: session.replace('"0.22.75"', '"2.0.0"'),
    routes: routes.replace("v0.19.0", "v2.1.3"),
  });
  assert.equal(raised.length, 2, raised.join("\n"));
  assert.ok(
    raised[0].startsWith('server/src/instant/reactive/session.clj:4 batch-messages-min-version "2.0.0": '),
    raised[0],
  );
  assert.ok(raised[0].includes("version.ts (v2.0.0) must be above every server version minimum"), raised[0]);
  assert.ok(raised[1].startsWith('server/src/instant/dash/routes.clj:1 cli-min-version "v2.1.3": '), raised[1]);
  // Equal is not above, also for a -dev minimum (the server ranks -dev higher).
  assert.equal(
    withServerMinimums({ version: "v2.0.0", session: session.replace('"0.22.75"', '"2.0.0-dev"'), routes }).length,
    1,
  );
});

test("every version literal counts as a minimum, whatever its form or name", () => {
  const session = '(def patch-presence-min-version\n  (semver/parse "v0.17.5"))\n';
  const routes = '(def cli-min-version (semver/parse "v0.19.0"))\n';
  // Each case adds one minimum above v2.0.0 that must be reported, named by
  // its enclosing def when there is one, by file and line otherwise.
  for (const [added, name] of [
    ['(def ^:private private-min-version (semver/parse "9.0.0"))', "private-min-version"],
    ['(def ^:private ^:dynamic two-min-version (semver/parse "9.0.0"))', "two-min-version"],
    ['(def ^{:private true} map-min-version\n  (semver/parse "v9.0.0"))', "map-min-version"],
    ['(defonce once-min-version (semver/parse "9.0.0"))', "once-min-version"],
    ['(def doc-min-version\n  "Docstring."\n  (semver/parse "9.0.0"))', "doc-min-version"],
    // A strict-only form and a loose-only form must not cancel out.
    [
      '(def ^{:doc "(x)"} a-min-version (semver/parse "1.0.0"))\n(def b-min-version-v2 (semver/parse "99.0.0"))',
      "b-min-version-v2",
    ],
    ['(def min-x-version (semver/parse "9.0.0"))', "min-x-version"],
    ['(def x-minimum-version (semver/parse "9.0.0"))', "x-minimum-version"],
    ['(def X-MIN-VERSION (semver/parse "9.0.0"))', "X-MIN-VERSION"],
    ['(def ^{:doc "a } inside"} y-min-version (semver/parse "9.0.0"))', "y-min-version"],
    ['(def new-min-version "9.0.0")', "new-min-version"],
    ['(defn f [v]\n  (pos? (semver/compare-semver v (semver/parse "9.0.0"))))', "f"],
    ['(defn g [v]\n  (pos? (semver/compare-semver v "9.0.0")))', "g"],
    ['(let [m (semver/parse "9.0.0")] m)', null],
  ]) {
    const r = withServerMinimums({ version: "v2.0.0", session: session + added + "\n", routes });
    assert.equal(r.length, 1, `${added}\n${r.join("\n")}`);
    const named = name ? ` ${name}` : "";
    assert.match(
      r[0],
      new RegExp(`^server/src/instant/reactive/session\\.clj:\\d+${named} "v?99?\\.0\\.0": `),
      r[0],
    );
  }

  // Runtime code, comments and non-version strings are not minimums.
  assert.deepEqual(
    withServerMinimums({
      version: "v2.0.0",
      session:
        session +
        '; (semver/parse "99.0.0")\n(def s "see 9.0.0 notes")\n(def c \\")\n' +
        "(defn a [versions] (semver/parse (get versions core-version-key)))\n" +
        "(defn b [versions] (some-> versions (get core-version-key) (semver/parse)))\n" +
        "(defn c [v] (:major (semver/parse v)))\n",
      routes,
    }),
    [],
  );

  const none = withServerMinimums({ version: "v2.0.0", session: "(ns x)\n", routes });
  assert.match(none[0], /^server\/src\/instant\/reactive\/session\.clj: no version string literal found/);
});

test("the repository's version is above its server minimums", () => {
  assert.deepEqual(checkServerMinimums(repo), []);
});

test("runChecks fails on a raised server minimum and names it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sk-minimums-run-"));
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const run = (...args) =>
    assert.equal(spawnSync("git", args, { cwd: root }).status, 0, `git ${args.join(" ")}`);
  try {
    write("client/packages/version/src/version.ts", "const version = 'v2.0.0';\n");
    write(
      "server/src/instant/reactive/session.clj",
      '(def ^:private batch-messages-min-version\n  (semver/parse "0.22.75"))\n',
    );
    write("server/src/instant/dash/routes.clj", '(def cli-min-version (semver/parse "v0.19.0"))\n');
    run("init", "-q");
    run("add", "-A");
    run("-c", "user.name=t", "-c", "user.email=t@example.org", "commit", "-qm", "base");
    assert.deepEqual(runChecks({ root, base: "HEAD" }).failures, []);

    write(
      "server/src/instant/reactive/session.clj",
      '(def ^:private batch-messages-min-version\n  (semver/parse "9.0.0"))\n',
    );
    const r = runChecks({ root, base: "HEAD" });
    assert.equal(r.failures.length, 1, r.failures.join("\n"));
    assert.match(
      r.failures[0],
      /^server\/src\/instant\/reactive\/session\.clj:2 batch-messages-min-version "9\.0\.0": the SidekickDB version .* \(v2\.0\.0\) must be above/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
