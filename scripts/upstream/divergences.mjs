// Which intentional SidekickDB divergence touches a path, and how to resolve
// a conflict caused by it. Attribution is computed from git history (every
// non-upstream commit merged into main), so new SidekickDB PRs are picked
// up automatically; the divergences below only add names and resolution
// hints. Keep them in step with the "Intentional divergences" section of
// UPSTREAM.md.
//
// Each divergence is a file of its own, ./divergences/<key>.mjs, and the PR
// numbers are lines in divergence-prs.txt (merged with merge=union), so two
// PRs that each record a divergence touch different lines. UPSTREAM.md
// "Maintaining the tooling" says how to add one.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { git, lines } from "./git.mjs";

/**
 * The divergence files among the names in divergences/, in file name order
 * (nothing depends on the order of the keys). Dotfiles such as .DS_Store or
 * an editor's swap file are ignored; any other name that is not <key>.mjs
 * is an error.
 */
export function divergenceFiles(names) {
  const files = names.filter((f) => !f.startsWith(".")).sort();
  for (const f of files)
    if (!/^[a-z0-9-]+\.mjs$/.test(f))
      throw new Error(`scripts/upstream/divergences/${f}: not <key>.mjs`);
  return files;
}

const DIVERGENCES_DIR = new URL("./divergences/", import.meta.url);
export const DIVERGENCE_FILES = divergenceFiles(fs.readdirSync(DIVERGENCES_DIR));
export const DIVERGENCES = {};
for (const f of DIVERGENCE_FILES) {
  const { default: d } = await import(new URL(f, DIVERGENCES_DIR));
  DIVERGENCES[f.slice(0, -".mjs".length)] = { ...d };
}

// Pull requests that carry two concerns: which of their keys a path belongs
// to. Their line in divergence-prs.txt lists both keys.
const SPLIT = {
  1: (file) => (file.startsWith(".github/") ? "ci-lockdown" : "own-fixes"),
  14: (file) => (file.startsWith("self-hosting/") ? "selfhost" : "dashboard"),
};

/**
 * Read divergence-prs.txt.
 * @returns {{entries: {pr:number, keys:string[]}[], problems: string[]}}
 */
export function parseDivergencePrs(text) {
  const entries = [];
  const problems = [];
  const seen = new Set();
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const where = `divergence-prs.txt:${i + 1}`;
    const m = line.match(/^(\d+)((?: +[a-z0-9-]+)+)$/);
    if (!m) return problems.push(`${where}: not "<number> <key>": ${raw}`);
    const pr = Number(m[1]);
    const keys = m[2].trim().split(/ +/);
    if (seen.has(pr)) problems.push(`${where}: PR ${pr} listed twice`);
    seen.add(pr);
    for (const k of keys)
      if (!DIVERGENCES[k]) problems.push(`${where}: unknown divergence key ${k}`);
    if ((keys.length > 1) !== Boolean(SPLIT[pr]))
      problems.push(
        `${where}: PR ${pr} needs ${keys.length > 1 ? "an entry in SPLIT" : "both keys, as it is in SPLIT"}`,
      );
    entries.push({ pr, keys });
  });
  return { entries, problems };
}

export const DIVERGENCE_PRS_FILE = fileURLToPath(
  new URL("./divergence-prs.txt", import.meta.url),
);

const { entries, problems } = parseDivergencePrs(
  fs.readFileSync(DIVERGENCE_PRS_FILE, "utf8"),
);
if (problems.length) throw new Error(problems.join("\n"));

// PR number -> divergence key, or a function of the path for a split PR.
export const PR_CATEGORY = {};
for (const d of Object.values(DIVERGENCES)) d.prs = [];
for (const { pr, keys } of entries) {
  PR_CATEGORY[pr] = SPLIT[pr] || keys[0];
  for (const k of keys) DIVERGENCES[k].prs.push(pr);
}

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
