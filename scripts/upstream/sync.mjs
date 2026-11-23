#!/usr/bin/env node
// Merge new upstream (instantdb/instant) commits into SidekickDB.
// See UPSTREAM.md for the full routine and how to resolve what is left.
//
// Usage (repository root, clean working tree):
//   node scripts/upstream/sync.mjs --report     # fetch and report only
//   node scripts/upstream/sync.mjs              # fetch, report, branch, merge
//   node scripts/upstream/sync.mjs --continue   # after resolving conflicts
//
// Steps:
//   1. Fetch origin/main and upstream/main (upstream is fetch-only).
//   2. Report the commits since the last synced point
//      (git merge-base origin/main upstream/main), the areas they touch, and
//      which intentional divergences they overlap.
//   3. Create sync/upstream-<YYYY-MM-DD> from origin/main.
//   4. git merge --no-ff --no-commit upstream/main (a real merge commit;
//      never squash or rebase, upstream history is kept).
//   5. Re-merge each conflicted file with the rename applied to all three
//      sides (base, ours, upstream), so rename-only conflicts disappear.
//      Files SidekickDB deleted on purpose stay deleted. client/pnpm-lock.yaml
//      is regenerated, never merged by hand.
//   6. Run the rename normalizer on every file upstream changed.
//   7. Regenerate client/pnpm-lock.yaml with `pnpm install --ignore-scripts`
//      (starting from SidekickDB's lockfile) if a workspace package.json or
//      the lockfile changed.
//   8. List remaining conflicts grouped by the divergence that causes them,
//      with how to resolve each.
//   9. If nothing is left: run scripts/upstream/check.mjs and commit the
//      merge. Otherwise stop; resolve, `git add`, then run --continue.
//
// Options:
//   --upstream <ref>   Upstream ref to merge (default upstream/main).
//   --onto <ref>       SidekickDB ref to start from (default origin/main).
//   --branch <name>    Branch name (default sync/upstream-<local date>).
//   --no-fetch         Do not fetch (use the refs as they are).
//   --no-commit        Stop before committing even if everything resolved.
//   --no-lockfile      Do not run pnpm (report that the lockfile is stale).
//   --lockfile-only    Regenerate with `pnpm install --lockfile-only` (no
//                      node_modules; re-resolves unrelated versions).
//   --no-prettier      Do not run prettier on files the normalizer changed.
//   --allow-leftovers  Do not block the commit on rename leftovers.
//   --report-file <f>  Also write the report (Markdown) to a file.
//
// Nothing here pushes. Push the branch and open the PR yourself.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, gitTry, lines, repoRoot, run, showBlob } from './git.mjs';
import { areaOf, buildAttribution, cherryPickedUpstreamPRs, describeCategory, groupByDivergence } from './divergences.mjs';
import { normalizeFiles, printReport, regenerateLockfile } from './normalize-rename.mjs';
import { isBinary, isExcluded, isLockfile, isWorkspacePackageJson, normalizeText } from './rename.mjs';
import { printChecks, runChecks } from './check.mjs';

const UPSTREAM_URL_RE = /github\.com[/:]instantdb\/instant(\.git)?$/;
const WORKSPACE_LOCKFILE = 'client/pnpm-lock.yaml';

function parseArgs(argv) {
  const o = {
    report: false,
    cont: false,
    upstream: 'upstream/main',
    onto: 'origin/main',
    branch: null,
    fetch: true,
    commit: true,
    lockfile: true,
    prettier: true,
    allowLeftovers: false,
    reportFile: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report') o.report = true;
    else if (a === '--continue') o.cont = true;
    else if (a === '--upstream') o.upstream = argv[++i];
    else if (a === '--onto') o.onto = argv[++i];
    else if (a === '--branch') o.branch = argv[++i];
    else if (a === '--no-fetch') o.fetch = false;
    else if (a === '--no-commit') o.commit = false;
    else if (a === '--no-lockfile') o.lockfile = false;
    else if (a === '--lockfile-only') o.lockfileOnly = true;
    else if (a === '--no-prettier') o.prettier = false;
    else if (a === '--allow-leftovers') o.allowLeftovers = true;
    else if (a === '--report-file') o.reportFile = argv[++i];
    else if (a === '-h' || a === '--help') {
      const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
      console.log(
        src.split('\n').slice(1).filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'),
      );
      process.exit(0);
    } else throw new Error(`unknown option ${a}`);
  }
  return o;
}

// ---------------------------------------------------------------------------
// Output: everything printed also goes into the Markdown report.

const report = [];
function say(s = '') {
  console.log(s);
  report.push(s);
}

function localDate() {
  // YYYY-MM-DD in the machine's local time zone.
  return new Date().toLocaleDateString('en-CA');
}

function statePath(root) {
  return path.resolve(root, git(['rev-parse', '--git-path', 'sidekick-upstream-sync.json'], { cwd: root }));
}

// ---------------------------------------------------------------------------
// 1. Remote sanity

function checkUpstreamRemote(root) {
  const r = gitTry(['remote', 'get-url', 'upstream'], { cwd: root });
  if (r.status !== 0) {
    throw new Error(
      'no "upstream" remote. Add it fetch-only, in this worktree only:\n' +
        '  git config extensions.worktreeConfig true   # once per repository\n' +
        '  git config --worktree remote.upstream.url https://github.com/instantdb/instant.git\n' +
        '  git config --worktree remote.upstream.fetch "+refs/heads/*:refs/remotes/upstream/*"\n' +
        '  git config --worktree remote.upstream.pushurl DISABLED\n' +
        '  git config --worktree remote.upstream.tagopt --no-tags',
    );
  }
  const url = r.stdout.trim();
  if (!UPSTREAM_URL_RE.test(url)) throw new Error(`"upstream" points at ${url}, expected instantdb/instant`);
  const push = git(['remote', 'get-url', '--push', 'upstream'], { cwd: root });
  if (push !== 'DISABLED') {
    throw new Error(`"upstream" push URL is ${push}; set it to DISABLED (git config --worktree remote.upstream.pushurl DISABLED)`);
  }
}

// ---------------------------------------------------------------------------
// 2. Report

function reportNewCommits({ root, ours, theirs, base, attribution }) {
  const commits = lines(
    git(['log', '--format=%H%x09%ad%x09%an%x09%s', '--date=short', `${base}..${theirs}`], { cwd: root }),
  );
  say(`# Upstream sync report (${localDate()})`);
  say('');
  say(`- SidekickDB: \`${ours}\` = ${git(['rev-parse', '--short=10', ours], { cwd: root })}`);
  say(`- Upstream:   \`${theirs}\` = ${git(['rev-parse', '--short=10', theirs], { cwd: root })} (${git(['log', '-1', '--format=%ad', '--date=short', theirs], { cwd: root })})`);
  say(`- Last synced upstream commit (merge base): ${base} (${git(['log', '-1', '--format=%ad %s', '--date=short', base], { cwd: root })})`);
  say(`- New upstream commits: ${commits.length}`);
  if (!commits.length) return { commits, files: [] };

  // Areas per commit, from one git log call.
  const perCommit = new Map();
  let cur = null;
  for (const l of lines(git(['log', '--no-renames', '--name-only', '--format=@@%H', `${base}..${theirs}`], { cwd: root }))) {
    if (l.startsWith('@@')) perCommit.set((cur = l.slice(2)), new Set());
    else if (cur) perCommit.get(cur).add(areaOf(l));
  }
  say('');
  say('## Commits');
  for (const c of commits.slice(0, 300)) {
    const [sha, date, , subject] = c.split('\t');
    const pr = subject.match(/\(#(\d+)\)\s*$/);
    const areas = [...(perCommit.get(sha) || [])].join(', ');
    say(`- ${sha.slice(0, 10)} ${date} ${subject}${pr ? ` (https://github.com/instantdb/instant/pull/${pr[1]})` : ''} [${areas}]`);
  }
  if (commits.length > 300) say(`- ... ${commits.length - 300} more`);

  const files = lines(git(['diff', '--name-only', '--no-renames', base, theirs], { cwd: root }));
  const areas = new Map();
  for (const f of files) areas.set(areaOf(f), (areas.get(areaOf(f)) || 0) + 1);
  say('');
  say(`## Areas touched (${files.length} files)`);
  for (const [a, n] of [...areas].sort((x, y) => y[1] - x[1])) say(`- ${a}: ${n}`);

  const overlap = files.filter((f) => attribution.has(f));
  say('');
  say(`## Overlap with intentional divergences (${overlap.length} files; these may conflict)`);
  if (!overlap.length) say('- none');
  for (const g of groupByDivergence(overlap, attribution)) {
    const d = describeCategory(g.key, g.prs);
    say(`- **${d.title}** (${g.prs.map((p) => `#${p.number}`).join(', ') || g.key}): ${g.paths.length}`);
    for (const p of g.paths.slice(0, 40)) say(`  - ${p}`);
    if (g.paths.length > 40) say(`  - ... ${g.paths.length - 40} more`);
  }

  const flags = [];
  if (files.some((f) => f.startsWith('.github/'))) flags.push('Upstream changed .github/: re-check the CI lockdown (check.mjs does).');
  if (files.includes(WORKSPACE_LOCKFILE)) flags.push('Upstream changed client/pnpm-lock.yaml: it will be regenerated.');
  if (files.includes('client/www/next.config.js')) flags.push('Upstream changed client/www/next.config.js: check for build-time fetches.');
  const newPkgs = files.filter((f) => /^client\/packages\/[^/]+\/package\.json$/.test(f) && gitTry(['cat-file', '-e', `${base}:${f}`], { cwd: root }).status !== 0);
  const picked = cherryPickedUpstreamPRs(ours, theirs);
  for (const c of commits) {
    const [sha, , , subject] = c.split('\t');
    const n = Number(subject.match(/\(#(\d+)\)\s*$/)?.[1]);
    if (picked.has(n)) {
      flags.push(
        `Upstream merged instantdb/instant#${n} as ${sha.slice(0, 10)}; SidekickDB cherry-picked it earlier as ${picked.get(n).join(', ')}. ` +
          'Expect overlap there: prefer upstream\'s merged version and drop the cherry-pick\'s leftovers.',
      );
    }
  }
  for (const p of newPkgs) flags.push(`New upstream package ${p}: add it to SCOPED_PACKAGES in scripts/upstream/rename.mjs if it is published as @instantdb/*.`);
  say('');
  say('## Things to look at');
  if (!flags.length) say('- nothing special');
  for (const f of flags) say(`- ${f}`);
  return { commits, files };
}

// ---------------------------------------------------------------------------
// 5. Conflict handling

function unmergedEntries(root) {
  // "<mode> <sha> <stage>\t<path>"
  const m = new Map();
  for (const l of lines(git(['ls-files', '-u', '-z'], { cwd: root }).replace(/\0/g, '\n'))) {
    const [meta, p] = l.split('\t');
    const stage = Number(meta.split(' ')[2]);
    if (!m.has(p)) m.set(p, new Set());
    m.get(p).add(stage);
  }
  return m;
}

function normalizedStage(root, stage, file, normalize) {
  const buf = showBlob(`:${stage}:${file}`, root);
  if (buf === null) return null;
  if (isBinary(buf)) return { binary: true, buf };
  const text = buf.toString('utf8');
  return { binary: false, text: normalize ? normalizeText(file, text).text : text };
}

// Re-merge one conflicted file from its index stages with `git merge-file
// --diff3`, after applying the rename to all three sides (normalize=true).
// Excluded paths (workflows, server, ...) are re-merged without renaming,
// only to get the same diff3 markers, which show the upstream base.
function remergeNormalized(root, file, stages, tmp, normalize = true) {
  const base = stages.has(1) ? normalizedStage(root, 1, file, normalize) : { binary: false, text: '' };
  const ours = normalizedStage(root, 2, file, normalize);
  const theirs = normalizedStage(root, 3, file, normalize);
  if (!ours || !theirs || base.binary || ours.binary || theirs.binary) return { status: 'skipped' };
  if (ours.text === theirs.text) {
    fs.writeFileSync(path.join(root, file), ours.text);
    git(['add', '--', file], { cwd: root });
    return { status: 'resolved', note: 'identical after the rename' };
  }
  const id = Math.random().toString(36).slice(2);
  const fo = path.join(tmp, `${id}.ours`);
  const fb = path.join(tmp, `${id}.base`);
  const ft = path.join(tmp, `${id}.theirs`);
  fs.writeFileSync(fo, ours.text);
  fs.writeFileSync(fb, base.text);
  fs.writeFileSync(ft, theirs.text);
  const r = run(
    'git',
    ['merge-file', '-p', '--diff3', '-L', 'SidekickDB', '-L', 'last synced upstream', '-L', 'upstream', fo, fb, ft],
    { allowFail: true, cwd: root },
  );
  for (const f of [fo, fb, ft]) fs.rmSync(f, { force: true });
  if (r.status < 0 || r.status === null || r.status > 127) return { status: 'skipped' };
  fs.writeFileSync(path.join(root, file), r.stdout);
  if (r.status === 0) {
    git(['add', '--', file], { cwd: root });
    return { status: 'resolved', note: 'clean after the rename' };
  }
  return { status: 'conflict', hunks: r.status };
}

function resolveConflicts({ root, attribution, upstreamFiles }) {
  const results = { resolved: [], keptDeleted: [], lockfiles: [], remaining: [] };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sidekick-sync-'));
  try {
    for (const [file, stages] of unmergedEntries(root)) {
      if (file === WORKSPACE_LOCKFILE) {
        // Regenerated by pnpm later; start from our side.
        git(['checkout', '--ours', '--', file], { cwd: root });
        git(['add', '--', file], { cwd: root });
        results.lockfiles.push(file);
        continue;
      }
      if (isLockfile(file)) {
        // Lockfiles of examples are upstream's; SidekickDB does not edit them.
        if (stages.has(3)) {
          git(['checkout', '--theirs', '--', file], { cwd: root });
          git(['add', '--', file], { cwd: root });
        } else git(['rm', '-q', '--', file], { cwd: root });
        results.lockfiles.push(file);
        continue;
      }
      const attrs = attribution.get(file) || [];
      if (!stages.has(2) && stages.has(3)) {
        // Deleted by SidekickDB, changed upstream.
        const by = attrs.find((a) => a.deleted);
        if (by) {
          git(['rm', '-q', '--', file], { cwd: root });
          results.keptDeleted.push({ file, by, upstream: upstreamFiles.commitsFor(file) });
          continue;
        }
        results.remaining.push({ file, kind: 'deleted by SidekickDB, modified upstream' });
        continue;
      }
      if (stages.has(2) && !stages.has(3)) {
        results.remaining.push({ file, kind: 'modified by SidekickDB, deleted upstream' });
        continue;
      }
      const normalize = !isExcluded(file);
      const r = remergeNormalized(root, file, stages, tmp, normalize);
      if (r.status === 'resolved') results.resolved.push({ file, note: r.note });
      else {
        const kind =
          r.status !== 'conflict' ? 'content' : normalize ? 'content; rename already applied to all sides' : 'content';
        results.remaining.push({ file, kind });
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return results;
}

// ---------------------------------------------------------------------------
// 6./7. Normalize, prettier, lockfile

function runPrettier(root, files) {
  const client = path.join(root, 'client');
  const bin = path.join(client, 'node_modules/.bin/prettier');
  const targets = files
    .filter((f) => f.startsWith('client/') && /\.(ts|tsx|js|jsx|json|md)$/.test(f))
    .map((f) => path.relative(client, path.join(root, f)));
  if (!targets.length) return { ran: false, files: [] };
  if (!fs.existsSync(bin)) return { ran: false, missing: true, files: targets };
  run(bin, ['--write', '--log-level', 'warn', '--ignore-path', '.prettierignore', '--ignore-path', '../.gitignore', ...targets], { cwd: client });
  return { ran: true, files: targets };
}

function normalizeAndStage({ root, files }) {
  const unmerged = unmergedEntries(root);
  const todo = files.filter((f) => !unmerged.has(f) && !isExcluded(f));
  const result = normalizeFiles(todo, { root });
  const changed = result.changed.map((c) => c.file);
  if (changed.length) git(['add', '--', ...changed], { cwd: root });
  return { result };
}

function lockfileNeeded(root, ours) {
  const changed = lines(git(['diff', '--name-only', ours, '--'], { cwd: root }));
  return changed.some((f) => isWorkspacePackageJson(f) || f === WORKSPACE_LOCKFILE);
}

function workspaceManifestHash(root) {
  const files = lines(git(['ls-files', '--', 'client/package.json', 'client/*/package.json', 'client/*/*/package.json', 'client/www/_emails/replace-images/package.json'], { cwd: root }))
    .filter(isWorkspacePackageJson)
    .sort();
  const h = crypto.createHash('sha256');
  for (const f of files) {
    h.update(f);
    try {
      h.update(fs.readFileSync(path.join(root, f)));
    } catch {
      h.update('(missing)');
    }
  }
  return h.digest('hex');
}

function maybeRegenerateLockfile({ root, ours, o, state }) {
  if (!lockfileNeeded(root, ours)) return 'not needed';
  const hash = workspaceManifestHash(root);
  if (state.lockHash === hash) return 'up to date';
  const unmerged = [...unmergedEntries(root).keys()];
  if (unmerged.some((f) => isWorkspacePackageJson(f))) return 'deferred: a workspace package.json is still conflicted';
  if (!o.lockfile) return 'needed but skipped (--no-lockfile); run `pnpm install --ignore-scripts` in client/';
  // Start from SidekickDB's lockfile; pnpm brings it in line with the merged
  // package.json files.
  if (gitTry(['diff', '--quiet', ours, '--', WORKSPACE_LOCKFILE], { cwd: root }).status !== 0) {
    git(['checkout', ours, '--', WORKSPACE_LOCKFILE], { cwd: root });
  }
  regenerateLockfile(root, { mode: o.lockfileOnly ? 'lockfile-only' : 'install', log: say });
  git(['add', '--', WORKSPACE_LOCKFILE], { cwd: root });
  state.lockHash = hash;
  return 'regenerated';
}

// ---------------------------------------------------------------------------
// 8. Grouped conflict list

function printRemaining(remaining, attribution) {
  if (!remaining.length) {
    say('');
    say('## Remaining conflicts: none');
    return;
  }
  say('');
  say(`## Remaining conflicts: ${remaining.length}`);
  // Rename conflicts were re-merged already; if a file also carries another
  // divergence, that one is the likely cause.
  const attr = new Map();
  for (const { file } of remaining) {
    const a = attribution.get(file) || [];
    const nonRename = a.filter((x) => x.category !== 'rename');
    attr.set(file, nonRename.length ? nonRename : a);
  }
  const kinds = new Map(remaining.map((r) => [r.file, r.kind]));
  for (const g of groupByDivergence(remaining.map((r) => r.file), attr)) {
    const d =
      g.key === 'none'
        ? { title: 'Not attributed to a SidekickDB divergence (upstream-only, or a previous sync resolution)', resolve: 'Usually take upstream\'s version; check git log for a previous sync merge that touched it.' }
        : describeCategory(g.key, g.prs);
    say('');
    say(`### ${d.title}${g.prs.length ? ` (${g.prs.map((p) => `#${p.number}`).join(', ')})` : ''}`);
    say(`How to resolve: ${d.resolve}`);
    for (const p of g.paths) say(`- ${p} (${kinds.get(p)})`);
  }
}

// ---------------------------------------------------------------------------
// 9. Commit

function commitMessage(state, summary) {
  const short = state.theirs.slice(0, 10);
  return [
    `Merge upstream instantdb/instant main (${short}) into SidekickDB`,
    '',
    `Upstream: https://github.com/instantdb/instant/commit/${state.theirs}`,
    `Previous sync point: ${state.base}`,
    `Upstream commits merged: ${state.commitCount}`,
    '',
    ...summary,
    ...(state.handResolved?.length
      ? [`Resolved by hand: ${state.handResolved.length}`, ...state.handResolved.map((f) => `- ${f}`)]
      : []),
    '',
    'Merged with scripts/upstream/sync.mjs (see UPSTREAM.md).',
  ].join('\n');
}

function finish({ root, o, state, summary }) {
  const checks = runChecks({ root, base: state.ours, allowLeftovers: o.allowLeftovers });
  say('');
  say('## Post-sync checks');
  printChecks(checks, say);
  if (checks.failures.length) {
    const files = checks.failures.map((f) => f.match(/^([^\s:]+)[:\s]/)?.[1]).filter(Boolean);
    const leftForHand = [...new Set([...(state.leftForHand || []), ...files])];
    fs.writeFileSync(statePath(root), JSON.stringify({ ...state, leftForHand }, null, 2));
    say('');
    say('Not committing: fix the failures above, `git add` the files, then run `node scripts/upstream/sync.mjs --continue`.');
    return 1;
  }
  if (!o.commit) {
    say('');
    say('Everything resolved; not committing (--no-commit). Commit with `node scripts/upstream/sync.mjs --continue`.');
    return 0;
  }
  const msgFile = path.join(os.tmpdir(), `sidekick-sync-msg-${process.pid}`);
  fs.writeFileSync(msgFile, commitMessage(state, summary) + '\n');
  try {
    git(['commit', '-q', '-F', msgFile], { cwd: root });
  } finally {
    fs.rmSync(msgFile, { force: true });
  }
  fs.rmSync(statePath(root), { force: true });
  const sha = git(['rev-parse', '--short=10', 'HEAD'], { cwd: root });
  say('');
  say(`Committed merge ${sha} on ${state.branch}. Parents: ${git(['log', '-1', '--format=%p', 'HEAD'], { cwd: root })}.`);
  say('Next: build and test (see UPSTREAM.md "After the merge"), push the branch, open a PR against main.');
  return 0;
}

function summarize(state, parts) {
  const s = [];
  if (parts.conf) {
    s.push(`Conflicts auto-resolved after applying the rename to all sides: ${parts.conf.resolved.length}`);
    for (const r of parts.conf.resolved) s.push(`- ${r.file} (${r.note})`);
    if (parts.conf.keptDeleted.length) {
      s.push(`Kept deleted (removed on purpose by SidekickDB, changed upstream): ${parts.conf.keptDeleted.length}`);
      for (const k of parts.conf.keptDeleted) s.push(`- ${k.file} (PR #${k.by.pr}; upstream: ${k.upstream.join(', ')})`);
    }
  }
  if (parts.norm) {
    const n = parts.norm.result.changed.reduce((a, c) => a + c.changes.length, 0);
    if (n || !parts.continued) s.push(`Rename normalizer: ${parts.norm.result.changed.length} file(s), ${n} rewrite(s).`);
  }
  if (parts.lock && (!parts.continued || parts.lock === 'regenerated')) {
    s.push(`client/pnpm-lock.yaml: ${parts.lock}${parts.continued ? ' (after hand resolutions)' : ''}.`);
  }
  return s;
}

// ---------------------------------------------------------------------------

function upstreamFilesHelper(root, base, theirs) {
  return {
    commitsFor: (file) =>
      lines(git(['log', '--format=%h', `${base}..${theirs}`, '--', file], { cwd: root })).slice(0, 5),
  };
}

function start(o, root) {
  checkUpstreamRemote(root);
  if (o.fetch) {
    say(`Fetching origin and upstream ...`);
    git(['fetch', '-q', 'origin', 'main'], { cwd: root });
    git(['fetch', '-q', '--no-tags', 'upstream', 'main'], { cwd: root });
  }
  const ours = git(['rev-parse', o.onto], { cwd: root });
  const theirs = git(['rev-parse', o.upstream], { cwd: root });
  const base = git(['merge-base', ours, theirs], { cwd: root });
  const attribution = buildAttribution(ours, theirs);
  const { commits, files } = reportNewCommits({ root, ours: o.onto, theirs: o.upstream, base, attribution });
  if (!commits.length) {
    say('');
    say(`Up to date: upstream has no commits after ${base.slice(0, 10)}. Nothing to merge.`);
    return 0;
  }
  if (o.report) return 0;

  const dirty = git(['status', '--porcelain', '--untracked-files=no'], { cwd: root });
  if (dirty) throw new Error('working tree has uncommitted changes; commit or set them aside first');
  if (gitTry(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: root }).status === 0) {
    throw new Error('a merge is already in progress (use --continue, or git merge --abort)');
  }
  const branch = o.branch || `sync/upstream-${localDate()}`;
  if (gitTry(['rev-parse', '-q', '--verify', `refs/heads/${branch}`], { cwd: root }).status === 0) {
    throw new Error(`branch ${branch} already exists; pass --branch ${branch}-2 (or delete it)`);
  }
  git(['switch', '-q', '--no-track', '-c', branch, ours], { cwd: root });
  say('');
  say(`## Merge`);
  say(`Created ${branch} from ${o.onto} (${ours.slice(0, 10)}); merging ${o.upstream} (${theirs.slice(0, 10)}) with --no-ff.`);

  const state = { branch, ours, theirs, base, commitCount: commits.length, upstreamFiles: files };
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2));

  const m = gitTry(['merge', '--no-ff', '--no-commit', '--no-edit', theirs], { cwd: root });
  if (m.status !== 0 && gitTry(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: root }).status !== 0) {
    throw new Error(`git merge failed:\n${m.stdout}${m.stderr}`);
  }
  const conflictsBefore = unmergedEntries(root).size;
  say(`git merge: ${conflictsBefore} conflicted path(s).`);

  const conf = resolveConflicts({ root, attribution, upstreamFiles: upstreamFilesHelper(root, base, theirs) });
  say(`Re-merged with the rename applied to all sides: ${conf.resolved.length} resolved.`);
  for (const r of conf.resolved) say(`- ${r.file} (${r.note})`);
  if (conf.keptDeleted.length) {
    say(`Kept deleted (SidekickDB removed them on purpose; upstream changed them): ${conf.keptDeleted.length}`);
    for (const k of conf.keptDeleted) say(`- ${k.file} (deleted in PR #${k.by.pr}; upstream commits ${k.upstream.join(', ')}: check nothing there is needed)`);
  }
  if (conf.lockfiles.length) say(`Lockfiles taken as-is for regeneration: ${conf.lockfiles.join(', ')}`);

  return afterMerge({ o, root, state, attribution, conf });
}

function afterMerge({ o, root, state, attribution, conf }) {
  say('');
  say('## Rename normalizer (files upstream changed)');
  const files = [...new Set([...state.upstreamFiles, ...lines(git(['diff', '--name-only', '--no-renames', state.ours, '--'], { cwd: root }))])];
  const norm = normalizeAndStage({ root, files });
  printReport(norm.result, { verbose: true, out: say });

  const lock = maybeRegenerateLockfile({ root, ours: state.ours, o, state });
  say(`client/pnpm-lock.yaml: ${lock}.`);

  // Lines the rename made longer may need rewrapping (PR #7 had two).
  const normalized = norm.result.changed.map((c) => c.file);
  if (o.prettier && normalized.length) {
    const p = runPrettier(root, normalized);
    if (p.ran) {
      git(['add', '--', ...normalized], { cwd: root });
      say(`Prettier checked ${p.files.length} normalized file(s).`);
    } else if (p.missing) {
      say('Prettier is not installed (client/node_modules); run `pnpm format` in client/ before pushing.');
    }
  }

  const remaining = [...unmergedEntries(root).keys()].map((file) => ({
    file,
    kind: (conf?.remaining || []).find((r) => r.file === file)?.kind || 'content',
  }));
  printRemaining(remaining, attribution);
  const continued = !conf;
  const summary = [...(state.summary || []), ...summarize(state, { conf, norm, lock, continued })];
  // Files a person resolves by hand: those left unmerged, plus files the
  // checks rejected. Once --continue runs, they count as resolved.
  const next = {
    ...state,
    summary,
    handResolved: continued
      ? [...new Set([...(state.handResolved || []), ...(state.leftForHand || [])])]
      : state.handResolved || [],
    leftForHand: [
      ...new Set([
        ...(continued ? [] : state.leftForHand || []),
        ...remaining.map((r) => r.file),
        ...norm.result.leftovers.map((l) => l.file),
      ]),
    ],
  };
  if (o.reportFile) fs.writeFileSync(o.reportFile, report.join('\n') + '\n');
  fs.writeFileSync(statePath(root), JSON.stringify(next, null, 2));
  if (remaining.length) {
    say('');
    say('Resolve the files above, `git add` them, then run: node scripts/upstream/sync.mjs --continue');
    return 2;
  }
  return finish({ root, o, state: next, summary });
}

function cont(o, root) {
  const sp = statePath(root);
  if (!fs.existsSync(sp)) throw new Error('no sync in progress (state file missing)');
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  const mh = gitTry(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: root });
  if (mh.status !== 0 || mh.stdout.trim() !== state.theirs) {
    throw new Error(`expected a merge of ${state.theirs} in progress`);
  }
  const unmerged = [...unmergedEntries(root).keys()];
  if (unmerged.length) {
    say(`Still unmerged (resolve and \`git add\` them): ${unmerged.join(', ')}`);
    return 2;
  }
  // Stage hand resolutions so the normalizer and checks see them.
  git(['add', '-u'], { cwd: root });
  const attribution = buildAttribution(state.ours, state.theirs);
  return afterMerge({ o, root, state, attribution, conf: null });
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  process.chdir(root);
  const code = o.cont ? cont(o, root) : start(o, root);
  if (o.reportFile) fs.writeFileSync(o.reportFile, report.join('\n') + '\n');
  process.exitCode = code;
}

try {
  main();
} catch (e) {
  console.error(`sync: ${e.message}`);
  process.exit(3);
}
