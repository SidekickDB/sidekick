#!/usr/bin/env node
// Fails a pull request that changes a file inherited from upstream when the
// head has no scripts/upstream/divergence-prs/<PR number> (UPSTREAM.md,
// "Maintaining the tooling"). sidekick-checks.yml runs it on pull_request.
//
// Usage:
//   node scripts/upstream/divergence-entry.mjs --pr <number> [--base <ref>] [--head <ref>]
//
// --base defaults to origin/main and --head to HEAD. In CI the head is
// GitHub's merge commit for the pull request and the base its first parent.
//
// Inherited: the path exists in the newest upstream commit merged into the
// base. That commit is read from origin's own history, never from upstream:
// every SidekickDB commit descends from SidekickDB's first commit (the root
// of the first-parent chain) and no upstream commit does, so the upstream
// commits that SidekickDB commits have as parents are the merged upstream
// points, and the newest are those no other one contains. This is
// `git merge-base origin/main upstream/main`; it needs the full history of
// origin (checkout with fetch-depth: 0).
//
// Changed: `git diff --no-renames` from the merge base of base and head to
// head, so a rename counts its old and its new path.
//
// Exempt: an upstream sync. The pull request merges an upstream commit that
// the base does not contain, and the head's "Last synced upstream commit"
// table in UPSTREAM.md names that commit. Both must hold, so merging an
// upstream branch by mistake is not exempt.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { git, gitTry, lines, showBlob } from "./git.mjs";

export const ENTRY_DIR = "scripts/upstream/divergence-prs";
const KEYS_DIR = "scripts/upstream/divergences";
const LIST_LIMIT = 50;

/** The upstream commits merged into ref that no other merged one contains. */
export function upstreamTips(ref, cwd) {
  const root = git(["rev-list", "--first-parent", "--max-parents=0", ref], { cwd });
  const own = new Set([root]);
  const parents = [];
  for (const l of lines(
    git(["rev-list", "--parents", "--ancestry-path", `${root}..${ref}`], { cwd }),
  )) {
    const [sha, ...ps] = l.split(" ");
    own.add(sha);
    parents.push(...ps);
  }
  const merged = [...new Set(parents.filter((p) => !own.has(p)))];
  if (!merged.length) return [];
  return lines(git(["merge-base", "--independent", ...merged], { cwd })).sort();
}

/** Every path in the given commits. */
export function pathsIn(commits, cwd) {
  const out = new Set();
  for (const c of commits)
    for (const p of git(["ls-tree", "-r", "-z", "--name-only", c], { cwd }).split("\0"))
      if (p) out.add(p);
  return out;
}

/** [status letter, path] for each path the head changes since the merge base. */
export function changedPaths(base, head, cwd) {
  const mb = git(["merge-base", base, head], { cwd });
  const parts = git(["diff", "-z", "--no-renames", "--name-status", mb, head], {
    cwd,
  }).split("\0");
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) out.push([parts[i], parts[i + 1]]);
  return out;
}

/** The upstream commit UPSTREAM.md at ref records as last synced, or null. */
export function recordedSyncCommit(ref, cwd) {
  const text = showBlob(`${ref}:UPSTREAM.md`, cwd)?.toString("utf8") || "";
  const section = text.split(/^## Last synced upstream commit$/m)[1]?.split(/^## /m)[0];
  return section?.match(/^\| Upstream commit \|[^\n]*?\b([0-9a-f]{40})\b/m)?.[1] || null;
}

function isAncestor(a, b, cwd) {
  return gitTry(["merge-base", "--is-ancestor", a, b], { cwd }).status === 0;
}

function entryExists(head, pr, cwd) {
  const r = gitTry(["cat-file", "-t", `${head}:${ENTRY_DIR}/${pr}`], { cwd });
  return r.status === 0 && r.stdout.trim() === "blob";
}

function divergenceKeys(head, cwd) {
  return lines(gitTry(["ls-tree", "--name-only", `${head}:${KEYS_DIR}`], { cwd }).stdout)
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => f.slice(0, -".mjs".length));
}

/**
 * @returns {{ok: boolean, message: string}}
 */
export function checkEntry({ pr, base = "origin/main", head = "HEAD", cwd }) {
  if (git(["rev-parse", "--is-shallow-repository"], { cwd }) === "true")
    throw new Error(
      "shallow clone: the last merged upstream commit is found in the full history (actions/checkout with fetch-depth: 0, or git fetch --unshallow origin)",
    );
  const baseTips = upstreamTips(base, cwd);
  if (!baseTips.length)
    throw new Error(`no upstream commit is merged into ${base}`);
  const upstreamPaths = pathsIn(baseTips, cwd);
  const inherited = changedPaths(base, head, cwd).filter(([, p]) => upstreamPaths.has(p));
  const tips = baseTips.map((t) => t.slice(0, 12)).join(", ");
  const entry = `${ENTRY_DIR}/${pr}`;

  if (!inherited.length)
    return { ok: true, message: `OK: no file inherited from upstream (${tips}) changed.` };
  if (entryExists(head, pr, cwd))
    return {
      ok: true,
      message: `OK: ${inherited.length} inherited file(s) changed, ${entry} exists.`,
    };

  const newTips = upstreamTips(head, cwd).filter((t) => !isAncestor(t, base, cwd));
  const recorded = recordedSyncCommit(head, cwd);
  if (recorded && newTips.includes(recorded) && recorded !== recordedSyncCommit(base, cwd))
    return {
      ok: true,
      message: `OK: upstream sync to ${recorded.slice(0, 12)} (merged here and recorded in UPSTREAM.md), no entry needed.`,
    };

  const shown = inherited.slice(0, LIST_LIMIT).map(([s, p]) => `  ${s} ${p}`);
  if (inherited.length > LIST_LIMIT)
    shown.push(`  ... and ${inherited.length - LIST_LIMIT} more`);
  const keys = divergenceKeys(head, cwd);
  const message = [
    `FAILED: this pull request changes ${inherited.length} file(s) inherited from upstream`,
    `(present in ${tips}, the last upstream commit merged into the base), and ${entry} does not exist:`,
    "",
    ...shown,
    "",
    "Record the pull request under the divergence key its change belongs to",
    `(UPSTREAM.md, "Maintaining the tooling"). Keys: ${keys.join(", ") || "none found"}.`,
    "A new divergence also needs scripts/upstream/divergences/<key>.mjs and a section in UPSTREAM.md.",
    "From the repository root, with <key> replaced:",
    "",
    `  echo '<key>' > ${entry}`,
    `  git add ${entry}`,
    `  git commit -m 'repo: record PR #${pr} under <key>'`,
    "  git push",
  ];
  if (newTips.length)
    message.push(
      "",
      `This pull request merges upstream ${newTips.map((t) => t.slice(0, 12)).join(", ")}. If it is an upstream sync,`,
      `set "Upstream commit" in UPSTREAM.md "Last synced upstream commit" to ${newTips.join(" or ")}`,
      "instead; a sync needs no entry.",
    );
  return { ok: false, message: message.join("\n") };
}

function main(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const name = { "--pr": "pr", "--base": "base", "--head": "head" }[argv[i]];
    if (!name || argv[i + 1] === undefined) {
      console.error(`unknown or incomplete argument: ${argv[i]}`);
      return 2;
    }
    opts[name] = argv[++i];
  }
  if (!/^[1-9]\d*$/.test(opts.pr || "")) {
    console.error(
      "usage: node scripts/upstream/divergence-entry.mjs --pr <number> [--base <ref>] [--head <ref>]",
    );
    return 2;
  }
  let result;
  try {
    result = checkEntry(opts);
  } catch (e) {
    console.log(`::error::Divergence entry check could not run: ${e.message}`);
    return 2;
  }
  const { ok, message } = result;
  console.log(`Divergence entry: ${message}`);
  if (!ok)
    console.log(
      `::error::Pull request #${opts.pr} changes files inherited from upstream without ${ENTRY_DIR}/${opts.pr}; the log above says how to add it.`,
    );
  return ok ? 0 : 1;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
