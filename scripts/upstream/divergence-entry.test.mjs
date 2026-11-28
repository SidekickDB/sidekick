// Run with: node --test scripts/upstream/*.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkEntry, recordedSyncCommit, upstreamTips } from "./divergence-entry.mjs";
import { git } from "./git.mjs";

const SCRIPT = fileURLToPath(new URL("./divergence-entry.mjs", import.meta.url));
const tmpDirs = [];
after(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "divergence-entry-"));
  tmpDirs.push(d);
  return d;
};

const upstreamMd = (sha) =>
  [
    "# Upstream",
    "",
    "## Last synced upstream commit",
    "",
    "| | |",
    "|---|---|",
    `| Upstream commit | \`${sha}\`, "a title" |`,
    "",
    "## Setup",
    "",
  ].join("\n");

// SidekickDB's shape: a fork root on main, upstream's history on its own
// line, merged in with upstream as the second parent.
function fixture() {
  const dir = tmpDir();
  const g = (...args) => git(args, { cwd: dir });
  const write = (files) => {
    for (const [p, c] of Object.entries(files)) {
      const f = path.join(dir, p);
      if (c === null) fs.rmSync(f, { recursive: true });
      else {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, c);
      }
    }
    g("add", "-A");
  };
  const commit = (msg, files = {}) => {
    write(files);
    g("commit", "-q", "--allow-empty", "-m", msg);
    return g("rev-parse", "HEAD");
  };
  g("init", "-q", "-b", "main");
  g("config", "user.name", "Test");
  g("config", "user.email", "test@example.com");
  g("config", "commit.gpgsign", "false");
  commit("initial commit", { "notes.txt": "fork\n" });
  g("checkout", "-q", "--orphan", "up");
  g("rm", "-rfq", ".");
  const u1 = commit("upstream 1", {
    "README.md": "upstream\n",
    "server/a.clj": "(ns a)\n",
    "client/b.ts": "b\n",
    "gone.txt": "gone\n",
    "with space.txt": "s\n",
  });
  g("checkout", "-q", "main");
  g("merge", "-q", "--allow-unrelated-histories", "--no-edit", "up");
  commit("fork setup", {
    "UPSTREAM.md": upstreamMd(u1),
    "scripts/upstream/divergences/own-fixes.mjs": "export default {};\n",
    "scripts/upstream/divergence-prs/1": "own-fixes\n",
    "gone.txt": null,
  });
  const branch = (name, fn, from = "main") => {
    g("checkout", "-q", "-b", name, from);
    fn();
    g("checkout", "-q", "main");
    return name;
  };
  const check = (head, pr = 7, base = "main") => checkEntry({ pr, base, head, cwd: dir });
  return { dir, g, write, commit, branch, check, u1 };
}

test("the merged upstream commit is found in the fork's own history", () => {
  const f = fixture();
  assert.deepEqual(upstreamTips("main", f.dir), [f.u1]);
  assert.equal(recordedSyncCommit("main", f.dir), f.u1);
});

test("a pull request that changes only SidekickDB's own files needs no entry", () => {
  const f = fixture();
  const edit = f.branch("own", () => {
    f.commit("edit", { "notes.txt": "changed\n", ".github/workflows/sidekick-x.yml": "x\n" });
    f.commit("rename own file", { "notes.txt": null, "server/c.clj": "fork\n" });
  });
  assert.equal(f.check(edit).ok, true);
  const del = f.branch("del", () => f.commit("delete", { "UPSTREAM.md": null }));
  assert.match(f.check(del).message, /no file inherited/);
});

test("an inherited change without an entry fails and says how to add it", () => {
  const f = fixture();
  const b = f.branch("edit", () => f.commit("edit", { "server/a.clj": "(ns a2)\n" }));
  const r = f.check(b);
  assert.equal(r.ok, false);
  assert.match(r.message, /^  M server\/a\.clj$/m);
  assert.match(r.message, /^  echo '<key>' > scripts\/upstream\/divergence-prs\/7$/m);
  assert.match(r.message, /^  git add scripts\/upstream\/divergence-prs\/7$/m);
  assert.match(r.message, /Keys: own-fixes\./);
  assert.doesNotMatch(r.message, /upstream sync/);
});

test("the entry on the head makes it pass; a directory does not count", () => {
  const f = fixture();
  const b = f.branch("edit", () => {
    f.commit("edit", { "README.md": "fork\n" });
    f.commit("dir", { "scripts/upstream/divergence-prs/7/x": "own-fixes\n" });
  });
  assert.equal(f.check(b).ok, false);
  const fixed = f.branch(
    "fixed",
    () => {
      f.write({ "scripts/upstream/divergence-prs/7": null });
      f.commit("entry", { "scripts/upstream/divergence-prs/7": "own-fixes\n" });
    },
    b,
  );
  assert.equal(f.check(fixed).ok, true);
  assert.equal(f.check("fixed", 8).ok, false, "another PR's entry does not count");
});

test("deletions, renames and re-adding a file the fork deleted are inherited changes", () => {
  const f = fixture();
  const cases = {
    del: [{ "client/b.ts": null }, /^  D client\/b\.ts$/m],
    ren: [{ "server/a.clj": null, "server/moved.clj": "(ns a)\n" }, /^  D server\/a\.clj$/m],
    readd: [{ "gone.txt": "back\n" }, /^  A gone\.txt$/m],
    space: [{ "with space.txt": "t\n" }, /^  M with space\.txt$/m],
  };
  for (const [name, [files, re]] of Object.entries(cases)) {
    const r = f.check(f.branch(name, () => f.commit(name, files)));
    assert.equal(r.ok, false, name);
    assert.match(r.message, re, name);
    assert.doesNotMatch(r.message, /moved\.clj/, name);
  }
});

test("GitHub's merge commit: base is its first parent", () => {
  const f = fixture();
  f.branch("own", () => f.commit("own", { "notes.txt": "x\n" }));
  f.branch("edit", () => f.commit("edit", { "README.md": "x\n" }));
  f.commit("main moves", { "client/b.ts": "main\n" });
  for (const [name, ok] of [["own", true], ["edit", false]]) {
    f.g("checkout", "-q", "--detach", "main");
    f.g("merge", "-q", "--no-ff", "--no-edit", name);
    assert.equal(f.check("HEAD", 7, "HEAD^1").ok, ok, name);
  }
});

test("changes the branch took from main by merging it are not its own", () => {
  const f = fixture();
  f.branch("own", () => f.commit("own", { "notes.txt": "x\n" }));
  f.commit("inherited change on main", { "README.md": "main\n" });
  f.g("checkout", "-q", "own");
  f.g("merge", "-q", "--no-edit", "main");
  f.g("checkout", "-q", "main");
  assert.equal(f.check("own").ok, true);
});

test("an upstream sync is exempt only when it also records the merged commit", () => {
  const f = fixture();
  f.g("checkout", "-q", "up");
  const u2 = f.commit("upstream 2", { "README.md": "upstream 2\n", "new.txt": "n\n" });
  f.g("checkout", "-q", "main");
  const merge = () => f.g("merge", "-q", "--no-edit", "up");

  const noTable = f.branch("sync-no-table", merge);
  const r = f.check(noTable);
  assert.equal(r.ok, false);
  assert.match(r.message, new RegExp(`merges upstream ${u2.slice(0, 12)}`));
  assert.match(r.message, new RegExp(`"Last synced upstream commit" to ${u2}`));

  const tableOnly = f.branch("table-only", () =>
    f.commit("table", { "UPSTREAM.md": upstreamMd(u2), "README.md": "fork\n" }),
  );
  assert.equal(f.check(tableOnly).ok, false);

  const sync = f.branch("sync", () => {
    merge();
    f.commit("record the sync", { "UPSTREAM.md": upstreamMd(u2) });
  });
  assert.match(f.check(sync).message, /upstream sync to/);

  // Once merged, the next pull request measures against the new commit.
  f.g("merge", "-q", "--no-ff", "--no-edit", "sync");
  assert.deepEqual(upstreamTips("main", f.dir), [u2]);
  const next = f.branch("next", () => f.commit("edit", { "new.txt": "fork\n" }));
  assert.equal(f.check(next).ok, false);
  assert.equal(f.check(next).message.includes("upstream sync"), false);
});

test("a shallow clone is refused, not guessed at", () => {
  const f = fixture();
  const clone = tmpDir();
  git(["clone", "-q", "--depth", "2", `file://${f.dir}`, clone]);
  assert.throws(
    () => checkEntry({ pr: 7, base: "HEAD^1", head: "HEAD", cwd: clone }),
    /fetch-depth: 0/,
  );
});

test("the command exits 1 on a missing entry and 2 on bad arguments", () => {
  const f = fixture();
  const b = f.branch("edit", () => f.commit("edit", { "README.md": "x\n" }));
  const run = (...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { cwd: f.dir, encoding: "utf8" });
  const fail = run("--pr", "7", "--base", "main", "--head", b);
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /^::error::Pull request #7 /m);
  assert.equal(run("--pr", "7", "--base", "main", "--head", "main").status, 0);
  for (const bad of [[], ["--pr", ""], ["--pr", "07"], ["--pr", "7", "--bogus", "x"]])
    assert.equal(run(...bad).status, 2, bad.join(" "));
});
