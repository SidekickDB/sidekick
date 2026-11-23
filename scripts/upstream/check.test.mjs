// Run with: node --test scripts/upstream/*.test.mjs
// Uses temporary copies of the repository's real workflow files.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkWorkflows } from "./check.mjs";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const realDir = path.join(repo, ".github/workflows");

function withWorkflows(mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sk-check-"));
  const dir = path.join(root, ".github/workflows");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(realDir))
    fs.copyFileSync(path.join(realDir, f), path.join(dir, f));
  mutate?.(dir);
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

test('re-enabling the JS "Run tests" step fails', () => {
  const r = withWorkflows((d) =>
    edit(
      d,
      "js.yml",
      "        # api.instantdb.com. Re-enable once tests target a SidekickDB-owned backend.\n        if: false\n",
      "        # api.instantdb.com. Re-enable once tests target a SidekickDB-owned backend.\n",
    ),
  );
  assert.ok(
    r.failures.some((f) => f.includes('step "Run tests"')),
    r.failures.join("\n"),
  );
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
