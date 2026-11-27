// Offline tests: command strings go to the matcher, nothing is executed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, decide } from "./upstream-write-guard.mjs";

const HOOK = fileURLToPath(
  new URL("./upstream-write-guard.mjs", import.meta.url),
);

const blocked = [
  // Spellings of the target.
  "gh pr create -R instantdb/instant --title x --body y",
  "gh pr create --repo instantdb/instant --fill",
  "gh pr create --repo=instantdb/instant --fill",
  "gh pr create -Rinstantdb/instant --fill",
  "gh pr create -R github.com/instantdb/instant --fill",
  "gh pr create -R https://github.com/instantdb/instant --fill",
  "gh pr create -R InstantDB/Instant --fill",
  "gh pr create -R 'instantdb/instant' --fill",
  'gh pr create -R "instantdb/instant" --fill',
  "gh -R instantdb/instant pr create --fill",
  "gh --repo instantdb/instant issue create -t x -b y",
  "GH_REPO=instantdb/instant gh pr create --fill",
  "export GH_REPO=instantdb/instant && gh issue comment 1 --body x",
  "R=instantdb/instant; gh pr comment 5 -R $R --body x",
  "gh pr comment https://github.com/instantdb/instant/pull/2956 --body x",
  "gh pr create -R instantdb/other-repo --fill",
  // Every pr and issue write command, including the less common ones.
  ...[
    "create",
    "comment 1",
    "review 1 --approve",
    "edit 1",
    "close 1",
    "reopen 1",
    "merge 1",
    "ready 1",
    "lock 1",
    "unlock 1",
    "update-branch 1",
  ].map((c) => `gh pr ${c} -R instantdb/instant`),
  ...[
    "create",
    "comment 1",
    "edit 1",
    "close 1",
    "reopen 1",
    "delete 1",
    "transfer 1 other/repo",
    "lock 1",
    "unlock 1",
    "pin 1",
    "unpin 1",
    "develop 1",
  ].map((c) => `gh issue ${c} -R instantdb/instant`),
  "gh label create bug -R instantdb/instant",
  "gh release create v1 -R instantdb/instant",
  "gh workflow run ci.yml -R instantdb/instant",
  "gh repo fork instantdb/instant",
  "gh repo edit instantdb/instant --description x",
  "gh repo set-default instantdb/instant",
  "gh something-new -R instantdb/instant",
  // gh api with a write method.
  "gh api repos/instantdb/instant/issues/1/comments -f body=x",
  "gh api /repos/instantdb/instant/issues/1/comments -F body=@file.md",
  "gh api -X POST repos/instantdb/instant/pulls",
  "gh api --method PATCH repos/instantdb/instant/pulls/1",
  "gh api --method=DELETE repos/instantdb/instant/issues/comments/9",
  "gh api -XPUT repos/instantdb/instant/pulls/1/merge",
  "gh api https://api.github.com/repos/InstantDB/instant/issues --input body.json",
  "GH_REPO=instantdb/instant gh api -X POST 'repos/{owner}/{repo}/issues'",
  "gh api repos//instantdb/instant/issues -f title=x",
  "gh api ./repos/instantdb/instant/issues -f title=x",
  "gh api repos/instantdb%2Finstant/issues -f title=x",
  // Owner-level writes without a repository.
  "gh api -X PUT user/starred/instantdb/instant",
  "gh api -X PUT user/following/instantdb",
  "gh project item-add 1 --owner instantdb --url x",
  "gh project item-add 1 --owner=instantdb --url x",
  // curl and wget against the REST API, including bundled short options.
  "curl -X POST https://api.github.com/repos/instantdb/instant/issues -d '{}'",
  "curl --json '{}' https://api.github.com/repos/instantdb/instant/issues",
  "curl -sX POST https://api.github.com/repos/instantdb/instant/issues",
  "curl -sXPOST https://api.github.com/repos/instantdb/instant/issues",
  "curl -sd '{}' https://api.github.com/repos/instantdb/instant/issues",
  "curl -sF a=b https://api.github.com/repos/instantdb/instant/issues",
  "curl -sT file https://api.github.com/repos/instantdb/instant/issues",
  "curl --request=DELETE https://api.github.com/repos/instantdb/instant/issues/1",
  "wget --post-data=x https://api.github.com/repos/instantdb/instant/issues",
  // git push.
  "git push upstream main",
  "git push upstream HEAD:refs/heads/x",
  "git -C . push upstream main",
  "git -c push.default=current push upstream",
  "git push --repo=upstream",
  "git push -u https://github.com/instantdb/instant.git main",
  "git push git@github.com:instantdb/instant.git main",
  "git -c remote.pushDefault=upstream push",
  "git remote set-url --push upstream https://github.com/instantdb/instant.git",
  "git config --worktree remote.upstream.pushurl https://github.com/instantdb/instant.git",
  "git config --unset remote.upstream.pushurl",
  "git remote add upstream https://github.com/instantdb/instant.git",
  // URLs with a port, and git subtree push.
  "git push https://github.com:443/instantdb/instant main",
  "git push ssh://git@ssh.github.com:443/instantdb/instant.git main",
  "git subtree push --prefix x https://github.com/instantdb/instant main",
  "git subtree push -P x upstream main",
  "git lfs push upstream main",
  // A fork remote's push pointed at upstream.
  "git -c remote.origin.pushurl=git@github.com:instantdb/instant.git push origin main",
  "git config remote.origin.pushurl https://github.com/instantdb/instant.git",
  "git config --worktree remote.origin.url git@github.com:instantdb/instant.git",
  "git config set remote.origin.pushurl https://github.com/instantdb/instant",
  "git remote set-url origin https://github.com/instantdb/instant.git",
  "git remote set-url --push origin git@github.com:instantdb/instant.git",
  "git config url.git@github.com:instantdb/instant.git.pushInsteadOf git@github.com:SidekickDB/sidekick.git",
  "git -c url.https://github.com/instantdb/instant.insteadOf=https://github.com/SidekickDB/sidekick push origin",
  // Hidden in compound commands, wrappers, substitutions and nested shells.
  "cd /tmp && gh pr create -R instantdb/instant --fill",
  "git status; git push upstream main",
  "true || gh issue create -R instantdb/instant",
  "echo $(gh pr comment 1 -R instantdb/instant --body x)",
  "echo `gh pr comment 1 -R instantdb/instant --body x`",
  "(gh pr close 1 -R instantdb/instant)",
  "{ gh pr close 1 -R instantdb/instant; }",
  "if true; then gh pr close 1 -R instantdb/instant; fi",
  "bash -c 'gh pr create -R instantdb/instant --fill'",
  'sh -lc "git push upstream main"',
  "eval gh pr create -R instantdb/instant --fill",
  "timeout 30 gh pr create -R instantdb/instant --fill",
  "env FOO=1 gh pr create -R instantdb/instant --fill",
  "nohup git push upstream main",
  "/opt/homebrew/bin/gh pr create -R instantdb/instant --fill",
  "FOO=bar gh pr create -R instantdb/instant --fill",
  "gh pr create -R instantdb/instant --body-file - <<'EOF'\ntext\nEOF",
  "bash -c -- 'gh pr create -R instantdb/instant --fill'",
  "cat <(gh pr comment 1 -R instantdb/instant -b x)",
  "cat <<EOF\n$(gh pr comment 1 -R instantdb/instant -b x)\nEOF",
  "cat <<EOF\n`git push upstream main`\nEOF",
  // A shell reading its commands from standard input.
  "bash <<'EOF'\ngit push upstream main\nEOF",
  "cat <<EOF | bash\ngit push upstream main\nEOF",
  "echo 'git push upstream main' | bash",
  "bash <(echo git push upstream main)",
  "echo 'git push upstream' | bash -s",
  "find . -maxdepth 0 -exec gh pr comment 1 -R instantdb/instant -b x \\;",
  "echo 1 | xargs sh -c 'gh pr comment $0 -R instantdb/instant -b x'",
  // An unresolved target in a command that mentions upstream.
  'gh pr comment 1 -R "$TARGET" --body "see instantdb/instant#1"',
];

const allowed = [
  // Reads of upstream.
  "git fetch upstream",
  "git fetch upstream main",
  "gh pr view 2956 -R instantdb/instant",
  "gh pr view 2956 -R instantdb/instant --json title,body,files",
  "gh pr diff 2956 -R instantdb/instant",
  "gh pr diff 2956 --repo=instantdb/instant | head -50",
  "gh pr list -R instantdb/instant --state open",
  "gh pr checks 2956 -R instantdb/instant",
  "gh pr view https://github.com/instantdb/instant/pull/2956",
  "gh issue view 12 -R instantdb/instant --comments",
  "gh issue list -R instantdb/instant",
  "gh repo view instantdb/instant",
  "gh release list -R instantdb/instant",
  "gh search prs --repo instantdb/instant sync",
  "gh api repos/instantdb/instant/pulls/2956",
  "gh api repos/instantdb/instant/pulls/2956/files --paginate -q '.[].filename'",
  "gh api -X GET repos/instantdb/instant/issues -f state=open",
  "curl -s https://api.github.com/repos/instantdb/instant/pulls/1",
  "git log upstream/main --oneline -5",
  "git merge-base origin/main upstream/main",
  "git config --worktree remote.upstream.pushurl DISABLED",
  "git config --get remote.upstream.pushurl",
  "git remote set-url --push upstream DISABLED",
  "git config remote.upstream.pushurl",
  "git config --show-origin remote.upstream.pushurl",
  "git config --worktree remote.upstream.url https://github.com/instantdb/instant.git",
  "git remote set-url upstream https://github.com/instantdb/instant.git",
  "git -c remote.upstream.url=https://github.com/instantdb/instant.git fetch upstream",
  "git config --list --show-origin | grep upstream",
  // Writes to the fork that only mention upstream in their text.
  'gh pr create -R SidekickDB/sidekick --base main --title "fix: port upstream change" --body "Ports instantdb/instant#2956. Never use -R instantdb/instant here."',
  "gh pr create -R SidekickDB/sidekick --base main --title 'take upstream fix' --body-file /tmp/pr-body.md",
  "gh pr create -R SidekickDB/sidekick --body-file - <<'EOF'\nPorts https://github.com/instantdb/instant/pull/2956.\nIt doesn't push to `upstream`: gh pr comment -R instantdb/instant\nEOF",
  "gh pr comment 30 -R SidekickDB/sidekick --body 'upstream: instantdb/instant#2956'",
  "gh issue create -R SidekickDB/sidekick --title 'upstream sync' --body x",
  'grep -n "gh pr create *-R instantdb/instant" .claude/settings.json',
  "git push -u origin sync/instantdb-instant-2956",
  "git push origin upstream-sync",
  "git push",
  "node scripts/upstream/check.mjs",
  "node --test scripts/upstream/*.test.mjs",
  "git commit -m 'never push to upstream' && git push -u origin agents/x",
  "gh api -X POST repos/SidekickDB/sidekick/issues -f title='upstream x'",
  "gh pr create -R SidekickDB/sidekick --title x --body https://github.com/instantdb/instant/pull/2956",
  "gh pr comment 30 -R SidekickDB/sidekick -b https://github.com/instantdb/instant/pull/2956",
  "gh issue create -R SidekickDB/sidekick -t x --body=https://github.com/instantdb/instant/issues/1",
  // Board cards whose text names upstream.
  `gh api graphql -f query='mutation { updateProjectV2DraftIssue(input: {draftIssueId: "DI_x", body: "Port instantdb/instant#2956"}) { draftIssue { id } } }'`,
  "gh project item-edit --id PVTI_x --project-id PVT_x --title 'Take upstream instantdb/instant#2956'",
  "gh project item-create 1 --owner SidekickDB --title 'upstream sync' --body 'instantdb/instant#1'",
  "gh project item-list 1 --owner SidekickDB --format json | grep instantdb",
  // Quoting that the guard parses.
  "echo $'it\\'s upstream'",
  "cat <<'EOF'\n$(gh pr comment 1 -R instantdb/instant -b x)\nEOF",
  "bash scripts/upstream/sync.sh",
  "which bash; bash --version; git fetch upstream",
  // Unrelated commands are not parsed, even when unbalanced.
  "echo 'unbalanced",
  "ls -la",
];

for (const command of blocked) {
  test(`blocks: ${command}`, () => {
    assert.ok(check(command), "expected a reason");
  });
}

for (const command of allowed) {
  test(`allows: ${command}`, () => {
    assert.equal(check(command), null);
  });
}

test("blocks an unparsable command that mentions upstream", () => {
  assert.throws(() => check("gh pr create -R instantdb/instant --body 'oops"));
  assert.equal(
    decide(JSON.stringify({ tool_input: { command: "echo 'upstream" } })).code,
    2,
  );
});

test("fails closed on bad input", () => {
  assert.equal(decide("not json").code, 2);
  assert.equal(decide("{}").code, 2);
  assert.equal(decide(JSON.stringify({ tool_input: {} })).code, 2);
});

function run(stdin) {
  return spawnSync(process.execPath, [HOOK], {
    input: stdin,
    encoding: "utf8",
  });
}

test("hook process: exit 2 with a message when blocked", () => {
  const r = run(
    JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "gh pr comment 1 -R instantdb/instant --body x" },
    }),
  );
  assert.equal(r.status, 2);
  assert.match(r.stderr, /upstream write guard/);
});

test("hook process: exit 0 and no output when allowed", () => {
  const r = run(
    JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "gh pr view 1 -R instantdb/instant" },
    }),
  );
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, "");
});

test("hook process: exit 2 on empty input", () => {
  assert.equal(run("").status, 2);
});

// The registration in .claude/settings.json: an inline loader that finds the
// guard at CLAUDE_PROJECT_DIR or at the git toplevel of the input's cwd.
const REPO = fileURLToPath(new URL("../..", import.meta.url));
const SETTINGS = JSON.parse(
  readFileSync(join(REPO, ".claude/settings.json"), "utf8"),
);
const REGISTRATION = SETTINGS.hooks.PreToolUse[0].hooks[0];
const BLOCKED = "git push upstream main";
const ALLOWED = "git fetch upstream";

function load({ projectDir, cwd, command }) {
  assert.equal(REGISTRATION.command, "node");
  return spawnSync(process.execPath, REGISTRATION.args, {
    input: JSON.stringify({ cwd, tool_input: { command } }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
}

function fakeCheckout(guardSource) {
  const dir = mkdtempSync(join(tmpdir(), "guard-test-"));
  if (guardSource !== undefined) {
    mkdirSync(join(dir, ".claude/hooks"), { recursive: true });
    writeFileSync(
      join(dir, ".claude/hooks/upstream-write-guard.mjs"),
      guardSource,
    );
  }
  return dir;
}

test("registration blocks on failure and has no shell placeholders", () => {
  assert.equal(REGISTRATION.onFailure, "block");
  assert.equal(REGISTRATION.args[0], "-e");
  assert.ok(!REGISTRATION.args[1].includes("${"));
});

test("loader: runs the guard at CLAUDE_PROJECT_DIR", () => {
  const empty = fakeCheckout();
  assert.equal(
    load({ projectDir: REPO, cwd: empty, command: BLOCKED }).status,
    2,
  );
  assert.equal(
    load({ projectDir: REPO, cwd: empty, command: ALLOWED }).status,
    0,
  );
});

test("loader: falls back to the git toplevel of cwd", () => {
  const empty = fakeCheckout();
  const r = load({
    projectDir: empty,
    cwd: join(REPO, ".claude"),
    command: BLOCKED,
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /upstream write guard/);
});

test("loader: no guard anywhere lets the command through with a warning", () => {
  const empty = fakeCheckout();
  const r = load({ projectDir: empty, cwd: empty, command: BLOCKED });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /not found/);
});

test("loader: a guard that crashes or exits 1 blocks", () => {
  const empty = fakeCheckout();
  for (const source of ["throw new Error('boom');", "process.exit(1);"]) {
    const r = load({
      projectDir: fakeCheckout(source),
      cwd: empty,
      command: ALLOWED,
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /failed/);
  }
});

test("loader: bad input still reaches the guard and blocks", () => {
  const r = spawnSync(process.execPath, REGISTRATION.args, {
    input: "not json",
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO },
  });
  assert.equal(r.status, 2);
});
