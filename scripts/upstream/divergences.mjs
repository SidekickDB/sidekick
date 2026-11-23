// Which intentional SidekickDB divergence touches a path, and how to resolve
// a conflict caused by it. Attribution is computed from git history (every
// non-upstream commit merged into main), so new SidekickDB PRs are picked
// up automatically; the table below only adds names and resolution hints.
// Keep it in step with the "Intentional divergences" section of UPSTREAM.md.

import { git, lines } from "./git.mjs";

export const DIVERGENCES = {
  "ci-lockdown": {
    title:
      'CI lockdown: publish/deploy jobs disabled, JS "Run tests" disabled, no secrets or timing writes, job timeouts, detect_changes merge base',
    prs: [1, 5],
    resolve:
      'Keep every line marked "# SidekickDB:" / "// SidekickDB:". Take upstream\'s other changes. ' +
      "A new or changed publish/deploy job gets `if: false && (<upstream condition>)`; a new publish-only " +
      'workflow gets its triggers commented out (workflow_dispatch only). Never re-enable "Run tests" or ' +
      '"Fetch timings". Then run scripts/upstream/check.mjs.',
  },
  dashboard: {
    title:
      "Dashboard decoupled from Instant services (Berkeley Mono, GitHub star count, docs feedback, docs AI chat and GitHub webhook removed)",
    prs: [2],
    resolve:
      "Keep the removals. If upstream changed a file SidekickDB deleted, keep it deleted. If upstream " +
      "re-introduces the font (stopaio.s3.amazonaws.com), the star count, the feedback app or the chat, drop " +
      "that part. Take upstream's other changes in these files.",
  },
  "fix-batch-1": {
    title: "Upstream fix batch 1 (sync correctness and quick wins)",
    prs: [3],
    resolve:
      "Upstream may have fixed the same issue its own way. If so, take upstream's fix and drop ours (and a " +
      "test that now duplicates upstream's); otherwise keep ours and apply upstream's other changes. Re-run " +
      "the affected Clojure/JS tests.",
  },
  selfhost: {
    title:
      "Self-hosting defaults: RustFS object store, backups out of the box, no Instant AWS/email defaults, neutral image tags, healthchecks",
    prs: [4],
    resolve:
      "Keep the `storage` (RustFS) service, STORAGE_* variables with MINIO_* fallbacks, the createbuckets " +
      'CORS rule, AWS_REQUEST_CHECKSUM_CALCULATION and the healthchecks. In server config keep "no default ' +
      "outside tests\" for buckets, ARNs and sender addresses. Port upstream's new settings into that form.",
  },
  "test-fixes": {
    title: "Test fixes for flaky or hanging tests on 2-vCPU CI runners",
    prs: [6, 8],
    resolve:
      "Keep SidekickDB's fix unless upstream fixed the same test; then take upstream's version. Take " +
      "upstream's new tests as they are.",
  },
  rename: {
    title:
      "JS package rename to @sidekickdb/* (CLI @sidekickdb/cli, create-sidekick-app)",
    prs: [7],
    resolve:
      "The sync already re-merged this file with the rename applied to all three sides, so what remains is " +
      "a real edit on both sides: keep both intents, written with SidekickDB names. Never hand-edit " +
      "client/pnpm-lock.yaml; `sync.mjs --continue` regenerates it.",
  },
};

// PR number -> divergence key. PR #1 carries the CI lockdown and one test
// fix, so it is split by path.
const PR_CATEGORY = {
  1: (file) => (file.startsWith(".github/") ? "ci-lockdown" : "test-fixes"),
  2: "dashboard",
  3: "fix-batch-1",
  4: "selfhost",
  5: "ci-lockdown",
  6: "test-fixes",
  7: "rename",
  8: "test-fixes",
};

export function categoryFor(pr, file) {
  const c = PR_CATEGORY[pr];
  if (typeof c === "function") return c(file);
  if (c) return c;
  return pr ? `pr-${pr}` : "direct";
}

export function describeCategory(key, prs) {
  if (DIVERGENCES[key]) return DIVERGENCES[key];
  return {
    title: prs?.length
      ? `SidekickDB PR ${prs.map((p) => `#${p.number}: ${p.title}`).join(", ")}`
      : key,
    prs: (prs || []).map((p) => p.number),
    resolve:
      "Read the PR that introduced the change, keep its intent and take upstream's other changes.",
  };
}

/**
 * Map every path SidekickDB changed (relative to upstream) to the PRs and
 * divergence categories that changed it.
 * @param {string} mainRef  e.g. 'HEAD' or 'origin/main'
 * @param {string} upstreamRef  e.g. 'upstream/main'
 * @returns {Map<string, {pr:number|null, title:string, category:string, deleted:boolean}[]>}
 */
export function buildAttribution(mainRef, upstreamRef) {
  const map = new Map();
  const fp = lines(
    git([
      "rev-list",
      "--first-parent",
      "--parents",
      mainRef,
      "--not",
      upstreamRef,
    ]),
  );
  for (const entry of fp) {
    const [sha, p1, p2] = entry.split(" ");
    if (!p1) continue; // root commit
    const subject = git(["log", "-1", "--format=%s", sha]);
    let pr = null;
    let title = subject;
    const m = subject.match(/^Merge pull request #(\d+)/);
    if (m) {
      pr = Number(m[1]);
      title = git(["log", "-1", "--format=%b", sha]).split("\n")[0] || subject;
    }
    // Files changed by SidekickDB-authored commits only (not upstream ones,
    // not merges): for a PR merge, the commits it brought in.
    const range = p2
      ? [p2, "--not", p1, upstreamRef]
      : [sha, "--not", p1, upstreamRef];
    const out = git([
      "log",
      "--no-merges",
      "--no-renames",
      "--format=",
      "--name-status",
      ...range,
    ]);
    for (const l of lines(out)) {
      const [status, file] = l.split("\t");
      if (!file) continue;
      const category = categoryFor(pr, file);
      const list = map.get(file) || [];
      if (!list.some((x) => x.pr === pr && x.category === category)) {
        list.push({ pr, title, category, deleted: status === "D" });
      } else if (status === "D") {
        list.find((x) => x.pr === pr && x.category === category).deleted = true;
      }
      map.set(file, list);
    }
  }
  return map;
}

/** Group paths by divergence category. Unattributed paths go to 'none'. */
export function groupByDivergence(paths, attribution) {
  const groups = new Map();
  for (const p of paths) {
    const attrs = attribution.get(p) || [];
    const keys = attrs.length
      ? [...new Set(attrs.map((a) => a.category))]
      : ["none"];
    for (const k of keys) {
      if (!groups.has(k)) groups.set(k, { key: k, prs: [], paths: [] });
      const g = groups.get(k);
      g.paths.push(p);
      for (const a of attrs.filter((a) => a.category === k)) {
        if (a.pr && !g.prs.some((x) => x.number === a.pr))
          g.prs.push({ number: a.pr, title: a.title });
      }
    }
  }
  return [...groups.values()];
}

/** Coarse area of the repository a path belongs to, for reports. */
export function areaOf(p) {
  const s = p.split("/");
  if (s[0] === "server")
    return s[1] === "test"
      ? "server (tests)"
      : s[1] === "src"
        ? "server (src)"
        : "server (other)";
  if (s[0] === ".github") return "CI workflows (.github)";
  if (s[0] === "self-hosting") return "self-hosting";
  if (s[0] === "examples") return "examples";
  if (s[0] === "client") {
    if (s[1] === "packages") return `client/packages/${s[2]}`;
    if (s[1] === "sandbox") return "client/sandbox";
    if (s[1] === "www") {
      if (s[2] === "app" && s[3] === "docs")
        return "docs (client/www/app/docs)";
      if (s[2] === "_posts" || s[2] === "_emails")
        return "essays and emails (client/www)";
      return "dashboard and site (client/www)";
    }
    return "client (root)";
  }
  return s.length > 1 ? s[0] : "repository root";
}

/**
 * Upstream PRs SidekickDB cherry-picked before they landed upstream, from
 * the Upstream-PR trailers of commits on mainRef that upstream does not have.
 * @returns {Map<number, string[]>} upstream PR number -> SidekickDB commits
 */
export function cherryPickedUpstreamPRs(mainRef, upstreamRef) {
  const out = new Map();
  const log = git([
    "log",
    "--no-merges",
    "--format=%h%x09%(trailers:key=Upstream-PR,valueonly,separator=%x2C)",
    mainRef,
    "--not",
    upstreamRef,
  ]);
  for (const l of lines(log)) {
    const [sha, prs] = l.split("\t");
    for (const m of (prs || "").matchAll(/instantdb\/instant#(\d+)/g)) {
      const n = Number(m[1]);
      if (!out.has(n)) out.set(n, []);
      out.get(n).push(sha);
    }
  }
  return out;
}
