// Which intentional SidekickDB divergence touches a path, and how to resolve
// a conflict caused by it. Attribution is computed from git history (every
// non-upstream commit merged into main), so new SidekickDB PRs are picked
// up automatically; the table below only adds names and resolution hints.
// Keep it in step with the "Intentional divergences" section of UPSTREAM.md.

import { git, lines } from "./git.mjs";

export const DIVERGENCES = {
  "ci-lockdown": {
    title:
      "CI lockdown: publish/deploy jobs disabled, no secrets or timing writes, job timeouts, detect_changes merge base, runs on main and pull requests only",
    prs: [1, 5, 27],
    resolve:
      'Keep every line marked "# SidekickDB:" / "// SidekickDB:". Take upstream\'s other changes. ' +
      "A new or changed publish/deploy job gets `if: false && (<upstream condition>)`; a new publish-only " +
      'workflow gets its triggers commented out (workflow_dispatch only). Never re-enable "Fetch timings". ' +
      "Then run scripts/upstream/check.mjs.",
  },
  "js-test-guard": {
    title:
      "JS tests run offline in CI behind a network guard; networked suites only with SIDEKICK_E2E_API_URI",
    prs: [9],
    resolve:
      "Keep the \"Run tests\" step's SIDEKICK_E2E_API_URI: '' and SIDEKICK_NETWORK_GUARD_ALLOW: '', the " +
      "client test/bench scripts that run through scripts/with-network-guard.mjs, and the e2e helpers that " +
      "skip without SIDEKICK_E2E_API_URI and have no default host. A new upstream e2e suite must be gated the " +
      "same way (skip unless SIDEKICK_E2E_API_URI is set, pass it explicitly to every client).",
  },
  "fail-closed": {
    title:
      "SDKs, CLI and MCP fail closed: no default server URL (no api.instantdb.com, no localhost default)",
    prs: [11],
    resolve:
      "Keep SidekickDB's side: init()/clients require apiURI (websocketURI derived from it), the CLI needs " +
      "INSTANT_CLI_API_URI or instant.config.ts, MCP needs --api-url/INSTANT_API_URL, the devtool loads " +
      "nothing without devtool.dashURI. If upstream adds a client, option or command that reaches a server, " +
      "make it take the URL explicitly and fail without it. Never re-add a default that points at " +
      "instantdb.com. check.mjs fails on Instant hosts added to package sources.",
  },
  dashboard: {
    title:
      "Dashboard decoupled from Instant services (Berkeley Mono, star count, docs feedback/AI chat/GitHub webhook removed; self-hosted: no Stripe.js, billing hidden)",
    prs: [2, 14],
    resolve:
      "Keep the removals. If upstream changed a file SidekickDB deleted, keep it deleted. If upstream " +
      "re-introduces the font (stopaio.s3.amazonaws.com), the star count, the feedback app or the chat, drop " +
      "that part. Keep loadStripe from @stripe/stripe-js/pure (loaded only at checkout) and the self-hosted " +
      "billing/Google-login conditions. Take upstream's other changes in these files.",
  },
  "upstream-fixes": {
    title:
      "Upstream fixes cherry-picked before upstream merged them (batch 1, batch 2, IndexedDB error handling) and their follow-ups",
    prs: [3, 10, 32],
    resolve:
      "Upstream may have merged the same PR (the report says so) or fixed the issue its own way. Same patch: " +
      "git merges it, and sync.mjs keeps ours where SidekickDB changed the file afterwards. Different fix: " +
      "take upstream's and drop ours (and a test of ours that now duplicates upstream's), but keep a " +
      "SidekickDB follow-up that upstream lacks. Re-run the affected tests.",
  },
  selfhost: {
    title:
      "Self-hosting defaults: RustFS object store, backups out of the box, no Instant AWS/email defaults, neutral image tags, healthchecks",
    prs: [4, 14, 21, 31],
    resolve:
      "Keep the `storage` (RustFS) service, the required STORAGE_* variables as plain ${VAR:?message} " +
      "(never a :? inside a default: Compose 2.38 rejects that; nested :- defaults such as the SIDEKICK_* aliases " +
      "are fine; run scripts/self-hosting/render-check.mjs), the createbuckets " +
      "CORS rule, AWS_REQUEST_CHECKSUM_CALCULATION, the healthchecks and the unpublished Postgres port " +
      "(${POSTGRES_BIND_ADDRESS:-127.0.0.1}:8890 in docker-compose.yml, no ports in swarm.yml). " +
      'In server config keep "no default ' +
      "outside tests\" for buckets, ARNs and sender addresses. Port upstream's new settings into that form.",
  },
  "own-fixes": {
    title:
      "SidekickDB's own fixes: flaky or hanging tests on 2-vCPU runners, attr-sketch loads off the common pool, presence refresh combine keeps snapshots",
    prs: [6, 8, 16, 24],
    resolve:
      "Keep SidekickDB's fix unless upstream fixed the same problem; then take upstream's version. Take " +
      "upstream's new tests as they are.",
  },
  release: {
    title:
      "SidekickDB release pipeline: npm trusted publishing and GHCR image workflows, flags-config private",
    prs: [18],
    resolve:
      "Upstream has none of these files except server/flags-config/package.json: keep \"private\": true " +
      "there and take upstream's other changes. Keep the release workflows' shape (check.mjs enforces it). " +
      "Take upstream's version.ts; if it names a version SidekickDB already published, bump the patch " +
      "before releasing (RELEASING.md).",
  },
  "config-aliases": {
    title:
      "Configuration names: SIDEKICK_* variables and sidekick.* config files accepted next to INSTANT_* / instant.*",
    prs: [19],
    resolve:
      "The source keeps upstream's INSTANT_* names; only the lookup differs. Server: keep env/getenv " +
      "(instant.util.env) wherever an INSTANT_* variable is read, and use it for a variable upstream adds. " +
      "Self-hosting compose files: keep ${SIDEKICK_X:-${INSTANT_X:-default}} and give a new INSTANT_* " +
      "variable the same form (not in swarm.yml: docker stack cannot nest defaults; add it to " +
      "deploy-swarm.sh instead). CLI: keep applyEnvAliases in loadEnv.ts, withSidekickFileNames in " +
      "findConfigCandidates.ts and the sidekick.config source in instantConfig.ts; a new instant.* file " +
      "kind must be added to LEGACY_CONFIG_FILE. Take upstream's other changes.",
  },
  bench: {
    title:
      "Self-hosted stack benchmark: harness in scripts/bench/self-hosted and a read-only workflow",
    prs: [20, 23],
    resolve:
      "Upstream has none of these files. If upstream changes self-hosting/docker-compose.yml, " +
      "server/Dockerfile.self-hosted, client/Dockerfile.www or @sidekickdb/core's init()/subscribeQuery " +
      "in a way the harness depends on, keep upstream's change and adjust run.mjs or workload.mjs; " +
      "re-run the workflow and compare against the last kept result only on the same runner label.",
  },
  "runtime-mode": {
    title: "Self-hosted runtime mode (INSTANT_RUNTIME_MODE / SIDEKICK_RUNTIME_MODE)",
    prs: [22],
    resolve:
      "Keep config.clj's runtime-mode helpers and their call sites: the skip check in core.clj's with-log-init, " +
      "dev-only? instead of dev? in sse.clj, session.clj, app_stream.clj and wrap-dev-server-info, secure-cookies? " +
      "at the three OAuth cookie sites, exit-on-startup-error? in -main. A new upstream startup step makes " +
      "runtime_mode_test.clj fail: decide whether self-hosted skips it, then update the recorded count and hash.",
  },
  "removed-session-counter": {
    title: "Session-count WebSocket (/dash/session_counts) and its reporter removed",
    prs: [29],
    resolve:
      "Keep server/src/instant/session_counter.clj deleted, and the route and the start step in core.clj removed. " +
      "Take upstream's other changes in those files. server/test/instant/dash/removed_routes_test.clj must pass.",
  },
  "security-policy": {
    title: "SidekickDB's own security policy (SECURITY.md)",
    prs: [30],
    resolve: "Upstream has no SECURITY.md. If it adds one, keep SidekickDB's.",
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

// PR number -> divergence key. Some PRs carry two concerns and are split by
// path.
const PR_CATEGORY = {
  1: (file) => (file.startsWith(".github/") ? "ci-lockdown" : "own-fixes"),
  2: "dashboard",
  3: "upstream-fixes",
  4: "selfhost",
  5: "ci-lockdown",
  6: "own-fixes",
  7: "rename",
  8: "own-fixes",
  9: "js-test-guard",
  10: "upstream-fixes",
  11: "fail-closed",
  14: (file) => (file.startsWith("self-hosting/") ? "selfhost" : "dashboard"),
  16: "own-fixes",
  18: "release",
  19: "config-aliases",
  20: "bench",
  21: "selfhost",
  22: "runtime-mode",
  23: "bench",
  24: "own-fixes",
  27: "ci-lockdown",
  29: "removed-session-counter",
  30: "security-policy",
  31: "selfhost",
  32: "upstream-fixes",
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
