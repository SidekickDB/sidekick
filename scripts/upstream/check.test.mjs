// Run with: node --test scripts/upstream/*.test.mjs
// Uses temporary copies of the repository's real workflow files.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkWorkflows,
  compareVersionsKeys,
  scanAddedLines,
  versionsKeys,
} from "./check.mjs";

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
