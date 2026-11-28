#!/usr/bin/env node
// Post-sync checks. Run after every upstream merge (sync.mjs runs them
// before it commits) and whenever a change touches .github/.
//
// Usage:
//   node scripts/upstream/check.mjs [--base <ref>] [--allow-leftovers]
//
// --base is the SidekickDB side before the merge. Default: HEAD while a
// merge is in progress, otherwise the first parent of HEAD if HEAD is a
// merge, otherwise origin/main. Changes are taken between --base and the
// working tree.
//
// Fails (exit 1) when:
//   - a publish/deploy job or step that was disabled before the merge is
//     enabled, a condition is `false || ...`, a publish-only workflow regains
//     a trigger, a schedule/pull_request_target trigger appears, or an enabled
//     job, a workflow-level block or a local action it uses relies on secrets,
//     `secrets: inherit`, write permissions, publish or deploy tools, or
//     Instant-owned hosts;
//   - the JS "Run tests" step or the client test/bench scripts leave the
//     network guard (PR #9);
//   - an Instant host is added to SDK/CLI/MCP source (PR #11; --accept-hosts
//     once a person confirmed it is only a link);
//   - a session `versions` key is renamed or removed;
//   - the version in client/packages/version/src/version.ts is not above
//     every server version minimum;
//   - files still need the rename normalizer, or rename leftovers remain
//     (unless --allow-leftovers);
//   - the two copies of the LLM rules differ;
//   - conflict markers remain in changed files.
// Lists for review (does not fail): added lines that mention Instant-owned
// hosts (runtime/config, build-time, docs/tests), and Instant-domain email
// addresses outside docs and tests.

import fs from "node:fs";
import path from "node:path";
import { checkServerMinimums } from "../../client/scripts/sidekick-release-npm.mjs";
import { git, gitTry, lines, repoRoot } from "./git.mjs";
import { normalizeFiles } from "./normalize-rename.mjs";
import { isExcluded } from "./rename.mjs";

// ---------------------------------------------------------------------------
// Workflow lockdown

// Jobs that must stay disabled (job-level `if:` starting with `false`).
export const DISABLED_JOBS = {
  "clojure.yml": ["publish-image", "publish-eb"],
  "js.yml": [
    "publish-docs",
    "deploy-remote-mcp",
    "publish-experimental-package",
    "publish-packages",
    "vercel-preview",
    "vercel-prod-deploy",
    "vercel-staging-deploy",
  ],
  "python-publish.yml": ["build", "publish"],
  "publish-self-hosted-images.yml": ["build", "publish"],
  "sync-instant-skills.yml": ["sync"],
};

// Steps inside enabled jobs that must stay disabled.
export const DISABLED_STEPS = {
  "clojure.yml": [["detect_changes", "Fetch timings"]],
};

// Steps that may run only behind the network guard (PR #9). Each must be
// disabled, or keep exactly these env values and run command. The `test`
// script in client/package.json must keep running through the guard.
export const GUARDED_STEPS = {
  "js.yml": [
    {
      job: "build",
      step: "Run tests",
      env: { SIDEKICK_E2E_API_URI: "", SIDEKICK_NETWORK_GUARD_ALLOW: "" },
      run: /^pnpm run test(\s|$)/,
    },
  ],
};
export const GUARDED_SCRIPTS = [
  {
    file: "client/package.json",
    script: "test",
    must: /with-network-guard\.mjs/,
  },
  {
    file: "client/package.json",
    script: "bench",
    must: /with-network-guard\.mjs/,
  },
];

// Workflows whose only trigger may be workflow_dispatch.
export const DISPATCH_ONLY = [
  "python-publish.yml",
  "publish-self-hosted-images.yml",
  "sync-instant-skills.yml",
];

// SidekickDB's own release workflows (RELEASING.md). Upstream has no files
// with these names. Each may use the rights matched by `allow` (whole job
// lines), and only while checkReleaseShape finds nothing: workflow_dispatch as
// the only trigger, `permissions: {}` at workflow level, the repository + main
// guard and job-level permissions on every job, and the named environment on
// every job that has an allowed line. Everything else in RISKY still fails in
// these files.
export const RELEASE_WORKFLOWS = {
  "sidekick-release-npm.yml": {
    environment: "npm-release",
    allow: [
      /^\s+id-token:\s*write\s*$/,
      /^\s+node scripts\/sidekick-release-npm\.mjs "\$\{args\[@\]\}"\s*$/,
      // The publish job's sparse checkout of the script.
      /^\s+client\/scripts\/sidekick-release-npm\.mjs\s*$/,
    ],
  },
  "sidekick-release-images.yml": {
    environment: "image-release",
    allow: [
      /^\s+packages:\s*write\s*$/,
      /^\s+uses:\s*docker\/login-action@[0-9a-f]{40}(\s+#.*)?$/,
      /^\s+push:\s*\$\{\{\s*inputs\.push\s*\}\}\s*$/,
    ],
  },
};

// SidekickDB's self-hosted benchmark (scripts/bench/self-hosted). Upstream
// has no file with this name. It gets no exception: every RISKY rule applies.
export const BENCH_WORKFLOWS = ["sidekick-self-hosted-bench.yml"];

// SidekickDB's compose render check (scripts/self-hosting/render-check.mjs).
// Upstream has no file with this name. No exception: every RISKY rule applies.
export const SELF_HOSTING_CHECK_WORKFLOWS = ["sidekick-self-hosting-check.yml"];

// SidekickDB's two-node smoke test (scripts/smoke/two-node). Upstream has no
// file with this name. No exception: every RISKY rule applies.
export const TWO_NODE_SMOKE_WORKFLOWS = ["sidekick-two-node-smoke.yml"];

// SidekickDB's networked JS e2e suites against a server started in the job
// (scripts/e2e). Upstream has no file with this name. No exception: every
// RISKY rule applies.
export const E2E_WORKFLOWS = ["sidekick-e2e.yml"];

// In E2E_WORKFLOWS every value given to SIDEKICK_E2E_API_URI (`KEY: value` or
// `KEY=value`) must be a localhost URL: the suites talk only to the server
// the job starts.
const E2E_LOCAL_URI = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?$/;

export function checkE2EApiURIs(rel, text) {
  const failures = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/SIDEKICK_E2E_API_URI\s*[:=]\s*(\S*)/g)) {
      const value = m[1].replace(/^(['"])(.*)\1$/, "$2");
      if (!E2E_LOCAL_URI.test(value))
        failures.push(
          `${rel}:${i + 1}: SIDEKICK_E2E_API_URI must be a localhost URL (the server started in the job), found ${m[1] || "(empty)"}`,
        );
    }
  });
  return failures;
}

// SidekickDB's own jobs in inherited workflows that may hold the rights
// matched by `allow` (whole job lines), only while checkJobRightsShape finds
// nothing: the job is guarded to main and uses no action, so it runs no
// repository or pull request code. Everything else in RISKY still applies.
export const JOB_RIGHTS = {
  "js.yml": {
    // Deletes older turbo cache entries on main (cache API).
    "prune-turbo-cache": [/^\s+actions:\s*write\s*$/],
  },
};

export const KNOWN_WORKFLOWS = [
  "clojure.yml",
  "js.yml",
  "python.yml",
  // SidekickDB's own checks (tooling tests, this script, the network guard).
  "sidekick-checks.yml",
  ...DISPATCH_ONLY,
  ...BENCH_WORKFLOWS,
  ...SELF_HOSTING_CHECK_WORKFLOWS,
  ...TWO_NODE_SMOKE_WORKFLOWS,
  ...E2E_WORKFLOWS,
  ...Object.keys(RELEASE_WORKFLOWS),
];

const RELEASE_GUARDS = [
  "github.repository == 'SidekickDB/sidekick'",
  "github.ref == 'refs/heads/main'",
];

// True when `cond` can only be true with all `guards` (default: both
// RELEASE_GUARDS): they must be top-level `&&` terms and the condition must
// have no top-level `||`.
export function hasReleaseGuard(cond, guards = RELEASE_GUARDS) {
  if (cond === null || cond === undefined) return false;
  let expr = cond.trim().replace(/\s+#.*$/, "");
  if (expr.includes("${{")) {
    const m = expr.match(/^\$\{\{([\s\S]*)\}\}$/);
    if (!m || m[1].includes("}}") || m[1].includes("${{")) return false;
    expr = m[1];
  }
  expr = stripParens(expr);
  if (splitTopLevel(expr, "||").length > 1) return false;
  // `(a && b) && c` is a && b && c; a parenthesised `||` stays one term.
  const terms = [];
  const flatten = (e) => {
    const parts = splitTopLevel(stripParens(e), "&&");
    if (parts.length === 1) terms.push(stripParens(e).replace(/\s+/g, " "));
    else parts.forEach(flatten);
  };
  flatten(expr);
  return guards.every((g) => terms.includes(g));
}

const MAIN_GUARD = "github.ref == 'refs/heads/main'";
const JOB_KEYS = ["name", "timeout-minutes", "runs-on", "needs", "if", "permissions", "steps"];
const STEP_KEYS = [
  "name",
  "id",
  "if",
  "env",
  "run",
  "shell",
  "working-directory",
  "timeout-minutes",
  "continue-on-error",
];

function checkJobRightsShape(rel, j) {
  const out = [];
  if (!hasReleaseGuard(j.if, [MAIN_GUARD]))
    out.push(
      `${rel}:${j.start}: job "${j.name}" holds a write right and must be guarded with if: ${MAIN_GUARD} && ... (no ||), found if: ${j.if ?? "(none)"}`,
    );
  // The job may only have the lines below, so that nothing can bring in an
  // action or another job's steps (uses in any spelling, a container, a YAML
  // anchor, alias or merge key). The body of a `run: |` block is free text.
  const plain = (v) => v === "" || !/^[*&!?{\[|>%@`]/.test(v);
  const bad = (n, text) =>
    out.push(
      `${rel}:${n}: job "${j.name}" holds a write right and may not contain this line (allowed: ${JOB_KEYS.join(", ")}; in a step: ${STEP_KEYS.join(", ")}): ${text.trim().slice(0, 140)}`,
    );
  let section = null; // "permissions" | "steps"
  let inEnv = false;
  let inRun = false;
  for (const { n, text } of j.lines) {
    const indent = text.match(/^ */)[0].length;
    if (inRun && (!text.trim() || indent >= 10)) continue;
    inRun = false;
    if (!text.trim() || /^\s*#/.test(text) || indent < 4) continue;
    let m;
    if ((m = text.match(/^    ([a-z-]+):(?: (.*))?$/)) && JOB_KEYS.includes(m[1])) {
      const [, key, value = ""] = m;
      section = key === "permissions" || key === "steps" ? key : null;
      inEnv = false;
      const ok = section
        ? value === ""
        : key === "needs"
          ? /^(\[ *[\w-]+( *, *[\w-]+)* *\]|[\w-]+)$/.test(value)
          : value !== "" && plain(value);
      if (!ok) bad(n, text);
    } else if (section === "permissions" && /^      [a-z-]+: (read|write|none)$/.test(text)) {
      continue;
    } else if (
      section === "steps" &&
      (m = text.match(/^      (?:- |  )([a-z-]+):(?: (.*))?$/)) &&
      STEP_KEYS.includes(m[1])
    ) {
      const [, key, value = ""] = m;
      inEnv = key === "env";
      if (key === "run" && value === "|") inRun = true;
      else if (inEnv ? value !== "" : value === "" || !plain(value)) bad(n, text);
    } else if (
      section === "steps" &&
      inEnv &&
      (m = text.match(/^          [A-Za-z_][A-Za-z0-9_]*: (.+)$/)) &&
      plain(m[1])
    ) {
      continue;
    } else bad(n, text);
  }
  return out;
}

function checkReleaseShape(rel, spec, { jobs, triggers, top }) {
  const out = [];
  if (triggers.length !== 1 || triggers[0] !== "workflow_dispatch")
    out.push(
      `${rel}: release workflow must be started by workflow_dispatch only, found: ${triggers.join(", ") || "(none)"}`,
    );
  if (!top.some(({ text }) => /^permissions:\s*\{\}\s*(#.*)?$/.test(text)))
    out.push(`${rel}: release workflow must set \`permissions: {}\` at workflow level`);
  if (!jobs.length) out.push(`${rel}: release workflow has no jobs`);
  for (const j of jobs) {
    if (!hasReleaseGuard(j.if))
      out.push(
        `${rel}:${j.start}: release job "${j.name}" must be guarded with if: ${RELEASE_GUARDS.join(" && ")} (no ||), found if: ${j.if ?? "(none)"}`,
      );
    const env = j.lines
      .map(({ text }) => text.match(/^    environment:\s*(.*?)\s*$/)?.[1])
      .find((x) => x !== undefined);
    const holdsRights = j.lines.some(({ text }) =>
      spec.allow.some((re) => re.test(text)),
    );
    if (holdsRights && env !== spec.environment)
      out.push(
        `${rel}:${j.start}: release job "${j.name}" must use \`environment: ${spec.environment}\`, found ${env ?? "(none)"}`,
      );
    if (!j.lines.some(({ text }) => /^    permissions:/.test(text)))
      out.push(`${rel}:${j.start}: release job "${j.name}" must set its own permissions`);
  }
  return out;
}

// Things an enabled job must not do.
const RISKY = [
  [/\$\{\{\s*secrets\.(?!GITHUB_TOKEN\b)/, "uses a repository secret"],
  [
    /\bid-token:\s*['"]?write(?![\w-])/,
    "id-token: write (OIDC publishing/deploys)",
  ],
  // Any other write scope: contents, packages, actions, pull-requests,
  // deployments, pages, attestations, statuses, issues, ...
  [
    /\b(?!id-token\b)[a-z-]+:\s*['"]?write(?![\w-])/,
    "asks for a write permission",
  ],
  [/\bwrite-all\b/, "asks for every write permission (write-all)"],
  [
    /\b(?:npm|pnpm|yarn) publish\b|publish_packages|make publish/,
    "publishes packages",
  ],
  [/flyctl/, "deploys to Fly"],
  [/\bvercel\b/i, "deploys to Vercel"],
  [
    /docker push|push:\s*(?:true|\$\{\{)|amazon-ecr|docker\/login-action/,
    "pushes images",
  ],
  [/aws-actions\/|elastic-beanstalk/, "uses AWS credentials or deploys"],
  [/gh-action-pypi-publish|twine upload/, "publishes to PyPI"],
  [
    /sidekick-release-npm\.mjs(?!\s+(?:plan|pack)\b)/,
    "runs the SidekickDB npm release script (publish-tarballs, claim-names or trust)",
  ],
  [/algolia/i, "writes to Algolia"],
  [/git push/, "pushes to a repository"],
  [
    /secrets:\s*inherit/,
    "passes every secret to a reusable workflow (secrets: inherit)",
  ],
  [/instantdb\.com|stopaio/, "contacts an Instant-owned host"],
];

function parseWorkflow(text) {
  const ls = text.split("\n");
  const jobs = [];
  const triggers = [];
  const top = []; // workflow-level lines outside `on:` and `jobs:` (env, permissions, ...)
  let i = 0;
  let inOn = false;
  let inJobs = false;
  let job = null;
  for (; i < ls.length; i++) {
    const l = ls[i];
    if (/^\S/.test(l) && !/^#/.test(l)) {
      inOn = /^(on|"on"|'on'):/.test(l);
      inJobs = /^jobs:/.test(l);
      if (inOn) {
        const inline = l
          .replace(/^[^:]+:\s*/, "")
          .replace(/#.*/, "")
          .trim();
        if (inline)
          triggers.push(
            ...inline
              .replace(/[[\]]/g, "")
              .split(/[,\s]+/)
              .filter(Boolean),
          );
      }
      job = null;
      if (!inOn && !inJobs) top.push({ n: i + 1, text: l });
      continue;
    }
    if (!inOn && !inJobs && l.trim()) top.push({ n: i + 1, text: l });
    if (inOn) {
      const m = l.match(/^  ([A-Za-z_]+):/);
      if (m) triggers.push(m[1]);
      const li = l.match(/^  - ([A-Za-z_]+)/);
      if (li) triggers.push(li[1]);
    }
    if (inJobs) {
      const m = l.match(/^  ([A-Za-z0-9_-]+):\s*$/);
      if (m) {
        job = { name: m[1], if: null, lines: [], start: i + 1 };
        jobs.push(job);
        continue;
      }
      if (job) {
        job.lines.push({ n: i + 1, text: l });
        const im = l.match(/^    if:\s*(.*)$/);
        if (im && job.if === null) job.if = im[1];
      }
    }
  }
  for (const j of jobs) j.steps = parseSteps(j.lines);
  return { jobs, triggers, top };
}

function parseSteps(jobLines) {
  const steps = [];
  let cur = null;
  let inSteps = false;
  let stepsIndent = -1;
  for (const { n, text } of jobLines) {
    const ind = text.match(/^\s*/)[0].length;
    if (/^\s*steps:\s*$/.test(text)) {
      inSteps = true;
      stepsIndent = ind;
      continue;
    }
    if (
      inSteps &&
      text.trim() &&
      ind <= stepsIndent &&
      !/^\s*-/.test(text) &&
      !/^\s*#/.test(text)
    ) {
      inSteps = false;
    }
    if (!inSteps) continue;
    const sm = text.match(/^(\s*)- (\w[\w-]*):\s*(.*)$/);
    if (sm && sm[1].length >= stepsIndent) {
      cur = { name: null, if: null, lines: [], dash: sm[1].length };
      steps.push(cur);
    }
    if (!cur) continue;
    cur.lines.push({ n, text });
    const nm = text.match(/^\s*-?\s*name:\s*(.*)$/);
    if (nm && cur.name === null)
      cur.name = nm[1].trim().replace(/^['"]|['"]$/g, "");
    const im = text.match(/^\s*-?\s*if:\s*(.*)$/);
    if (im && cur.if === null) cur.if = im[1];
  }
  return steps;
}

// True only for a condition that is always false: `false`, `(false)`,
// `false && (...)`, `(false) && ...`, or one `${{ ... }}` expression
// wrapping the whole condition with that shape. Anything else counts as
// possibly true: `false || ...`, `(false) || ...`, `false && x || y` (`&&`
// binds tighter than `||`), and text outside `${{ }}` such as
// `${{ false }} || true` (GitHub then evaluates a non-empty string, which is
// truthy).
export function isFalse(cond) {
  if (cond === null || cond === undefined) return false;
  let expr = cond.trim().replace(/\s+#.*$/, ""); // trailing YAML comment
  if (expr.includes("${{")) {
    const m = expr.match(/^\$\{\{([\s\S]*)\}\}$/);
    if (!m || m[1].includes("}}") || m[1].includes("${{")) return false;
    expr = m[1];
  }
  expr = stripParens(expr);
  if (splitTopLevel(expr, "||").length > 1) return false;
  const first = splitTopLevel(expr, "&&")[0];
  return first !== undefined && stripParens(first) === "false";
}

// Split on an operator outside parentheses and single-quoted strings.
function splitTopLevel(expr, op) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (quoted) {
      if (c === "'") quoted = false;
    } else if (c === "'") quoted = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && expr.startsWith(op, i)) {
      parts.push(expr.slice(start, i));
      start = i + op.length;
      i += op.length - 1;
    }
  }
  parts.push(expr.slice(start));
  return parts;
}

// Remove parentheses that wrap the whole expression, repeatedly.
function stripParens(expr) {
  let e = expr.trim();
  while (e.startsWith("(") && e.endsWith(")")) {
    let depth = 0;
    let quoted = false;
    let wraps = true;
    for (let i = 0; i < e.length; i++) {
      const c = e[i];
      if (quoted) {
        if (c === "'") quoted = false;
        continue;
      }
      if (c === "'") quoted = true;
      else if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0 && i < e.length - 1) {
          wraps = false;
          break;
        }
      }
    }
    if (!wraps) break;
    e = e.slice(1, -1).trim();
  }
  return e;
}

/**
 * Jobs and steps that are disabled in the workflows at `ref` (the SidekickDB
 * side before a merge). They must stay disabled after it, so a job gated
 * during one sync is protected in every later one without editing the lists
 * above.
 */
export function disabledAt(ref, root) {
  const jobs = {};
  const steps = {};
  const names = lines(
    gitTry(["ls-tree", "--name-only", `${ref}:.github/workflows`], {
      cwd: root,
    }).stdout || "",
  );
  for (const f of names.filter((n) => /\.ya?ml$/.test(n))) {
    const r = gitTry(["show", `${ref}:.github/workflows/${f}`], { cwd: root });
    if (r.status !== 0) continue;
    const wf = parseWorkflow(r.stdout);
    jobs[f] = wf.jobs.filter((j) => isFalse(j.if)).map((j) => j.name);
    steps[f] = wf.jobs
      .filter((j) => !isFalse(j.if))
      .flatMap((j) =>
        j.steps
          .filter((st) => st.name && isFalse(st.if))
          .map((st) => [j.name, st.name]),
      );
  }
  return { jobs, steps };
}

function union(a, b, key = (x) => JSON.stringify(x)) {
  const out = new Map();
  for (const x of [...(a || []), ...(b || [])]) out.set(key(x), x);
  return [...out.values()];
}

export function checkWorkflows(root, learned = { jobs: {}, steps: {} }) {
  const failures = [];
  const warnings = [];
  const dir = path.join(root, ".github/workflows");
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))
    : [];
  for (const f of Object.keys(DISABLED_JOBS)) {
    if (!files.includes(f))
      warnings.push(
        `.github/workflows/${f} no longer exists (was it renamed upstream? update scripts/upstream/check.mjs)`,
      );
  }
  for (const f of files) {
    const rel = `.github/workflows/${f}`;
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    const parsed = parseWorkflow(text);
    const { jobs, triggers, top } = parsed;
    if (E2E_WORKFLOWS.includes(f)) failures.push(...checkE2EApiURIs(rel, text));
    // Rights a SidekickDB release workflow may use, only while its shape holds.
    let allowed = [];
    if (RELEASE_WORKFLOWS[f]) {
      const shape = checkReleaseShape(rel, RELEASE_WORKFLOWS[f], parsed);
      failures.push(...shape);
      if (!shape.length) allowed = RELEASE_WORKFLOWS[f].allow;
    }
    // Workflow-level env/permissions apply to every job.
    if (jobs.some((j) => !isFalse(j.if))) {
      for (const { n, text } of top) {
        if (/^\s*#/.test(text)) continue;
        const code = text.replace(/\s#.*$/, "");
        for (const [re, why] of RISKY) {
          if (re.test(code))
            failures.push(
              `${rel}:${n}: workflow-level setting ${why}, which every enabled job inherits: ${text.trim().slice(0, 140)}`,
            );
        }
      }
    }
    for (const g of GUARDED_STEPS[f] || []) {
      const j = jobs.find((x) => x.name === g.job);
      const st = j?.steps.find((x) => x.name === g.step);
      if (!st) {
        warnings.push(
          `${rel}: expected guarded step "${g.step}" in job "${g.job}" not found`,
        );
        continue;
      }
      if (isFalse(st.if) || isFalse(j.if)) continue;
      const body = st.lines.map((l) => l.text).join("\n");
      for (const [k, v] of Object.entries(g.env)) {
        const m = body.match(new RegExp(`^\\s*${k}:\\s*(.*?)\\s*$`, "m"));
        const val = m ? m[1].replace(/^(['"])(.*)\1$/, "$2") : null;
        if (val !== v)
          failures.push(
            `${rel}: step "${g.step}" must set ${k}: '${v}' (network guard, PR #9), found ${m ? m[1] : "(unset)"}`,
          );
      }
      const run = body.match(/^\s*run:\s*(.*)$/m)?.[1]?.trim() ?? "";
      if (!g.run.test(run))
        failures.push(
          `${rel}: step "${g.step}" must run \`pnpm run test\` (which preloads the network guard), found run: ${run || "(none)"}`,
        );
    }
    if (!KNOWN_WORKFLOWS.includes(f))
      warnings.push(`${rel}: new workflow file, review it by hand`);
    for (const t of triggers) {
      if (t === "schedule")
        failures.push(
          `${rel}: has a schedule trigger (SidekickDB runs no scheduled workflows)`,
        );
      if (t === "pull_request_target")
        failures.push(`${rel}: has a pull_request_target trigger`);
      if (t === "workflow_run")
        warnings.push(`${rel}: has a workflow_run trigger, review it`);
    }
    if (DISPATCH_ONLY.includes(f)) {
      const extra = triggers.filter((t) => t !== "workflow_dispatch");
      if (extra.length)
        failures.push(
          `${rel}: publish-only workflow has triggers besides workflow_dispatch: ${extra.join(", ")}`,
        );
    }
    for (const name of union(DISABLED_JOBS[f], learned.jobs[f])) {
      const j = jobs.find((x) => x.name === name);
      if (!j)
        warnings.push(
          `${rel}: expected disabled job "${name}" not found (renamed upstream?)`,
        );
      else if (!isFalse(j.if))
        failures.push(
          `${rel}:${j.start}: job "${name}" must stay disabled (if: false && (...)), found if: ${j.if ?? "(none)"}`,
        );
    }
    for (const [jobName, stepName] of union(
      DISABLED_STEPS[f],
      learned.steps[f],
    )) {
      const j = jobs.find((x) => x.name === jobName);
      const s = j?.steps.find((x) => x.name === stepName);
      if (!s)
        warnings.push(
          `${rel}: expected disabled step "${stepName}" in job "${jobName}" not found`,
        );
      else if (!isFalse(s.if))
        failures.push(
          `${rel}: step "${stepName}" in job "${jobName}" must stay disabled, found if: ${s.if ?? "(none)"}`,
        );
    }
    for (const j of jobs) {
      if (isFalse(j.if)) continue;
      // Local composite actions used by an enabled step run with its rights.
      for (const st of j.steps.filter((x) => !isFalse(x.if))) {
        for (const { text } of st.lines) {
          const u = text.match(/uses:\s*\.\/(\.github\/actions\/[^\s@#]+)/);
          if (!u) continue;
          const adir = path.join(root, u[1]);
          const afile = ["action.yml", "action.yaml"]
            .map((x) => path.join(adir, x))
            .find((x) => fs.existsSync(x));
          if (!afile) {
            warnings.push(
              `${rel}: job "${j.name}" uses ${u[1]}, which has no action.yml`,
            );
            continue;
          }
          fs.readFileSync(afile, "utf8")
            .split("\n")
            .forEach((at, k) => {
              if (/^\s*#/.test(at)) return;
              for (const [re, why] of RISKY) {
                if (re.test(at.replace(/\s#.*$/, "")))
                  failures.push(
                    `${path.relative(root, afile)}:${k + 1}: action used by enabled job "${j.name}" (${rel}) ${why}: ${at.trim().slice(0, 140)}`,
                  );
              }
            });
        }
      }
      const disabledStepLines = new Set(
        j.steps
          .filter((s) => isFalse(s.if))
          .flatMap((s) => s.lines.map((l) => l.n)),
      );
      let jobAllowed = allowed;
      const rights = JOB_RIGHTS[f]?.[j.name];
      if (rights) {
        const shape = checkJobRightsShape(rel, j);
        failures.push(...shape);
        if (!shape.length) jobAllowed = [...allowed, ...rights];
      }
      for (const { n, text } of j.lines) {
        if (disabledStepLines.has(n) || /^\s*#/.test(text)) continue;
        if (jobAllowed.some((re) => re.test(text))) continue;
        const code = text.replace(/\s#.*$/, "");
        for (const [re, why] of RISKY) {
          if (re.test(code)) {
            failures.push(
              `${rel}:${n}: enabled job "${j.name}" ${why}: ${text.trim().slice(0, 140)}\n` +
                '      -> disable the job with a "# SidekickDB:" comment and `if: false && (<upstream condition>)`',
            );
          }
        }
      }
    }
  }
  for (const g of GUARDED_SCRIPTS) {
    const p = path.join(root, g.file);
    if (!fs.existsSync(p)) continue;
    let cmd;
    try {
      cmd = JSON.parse(fs.readFileSync(p, "utf8")).scripts?.[g.script];
    } catch {
      warnings.push(`${g.file}: not valid JSON`);
      continue;
    }
    if (cmd !== undefined && !g.must.test(cmd))
      failures.push(
        `${g.file}: script "${g.script}" must run through scripts/with-network-guard.mjs (PR #9), found: ${cmd}`,
      );
  }
  return { failures, warnings };
}

// ---------------------------------------------------------------------------
// Instant-owned hosts in added lines

const HOST_RE =
  /(?:[a-z0-9-]+\.)*instantdb\.com\b|stopaio\.s3\.amazonaws\.com|instant-[a-z0-9-]+\.s3[a-z0-9.-]*\.amazonaws\.com|s3:\/\/instant-|arn:aws:[a-z0-9-]+:[^\s'"]*instant/i;
const EMAIL_RE = /[\w.+-]+@(?:[a-z0-9-]+\.)*instantdb\.com\b/gi;

function classify(file) {
  if (
    /(^|\/)(__tests__|test|tests|e2e)\//.test(file) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
    /_test\.clj$/.test(file)
  )
    return "docs-tests";
  if (
    /\.(md|mdx|markdown|txt|vtt)$/.test(file) ||
    file.startsWith("client/www/app/docs/") ||
    file.startsWith("client/www/_")
  )
    return "docs-tests";
  if (/^(examples|client\/sandbox)\//.test(file)) return "docs-tests";
  if (
    /(^|\/)Dockerfile[^/]*$/.test(file) ||
    /(^|\/)(next|vite|webpack|rollup|tailwind|postcss)\.config\.[cm]?[jt]s$/.test(
      file,
    ) ||
    /(^|\/)package\.json$/.test(file) ||
    /(^|\/)turbo\.json$/.test(file) ||
    /^client\/www\/scripts\//.test(file) ||
    /^\.github\//.test(file) ||
    /(^|\/)Makefile$/.test(file)
  )
    return "build";
  return "runtime";
}

// SDK, CLI and MCP sources (not tests). Since PR #11 they have no default
// server; an Instant host added here fails the checks.
const SDK_SOURCE = /^client\/packages\/(?!python\/)[^/]+\/(src|bin)\//;

/**
 * Classify the added lines of a unified diff (git diff -U0).
 * Hosts: lines naming an Instant-owned host, by file class. Emails: lines
 * with an Instant-domain email address outside docs and tests (sender or
 * contact defaults; PR #4 removed several). In docs and tests, emails are
 * listed with the hosts.
 */
export function scanAddedLines(diff) {
  const out = { runtime: [], build: [], "docs-tests": [], emails: [], sdk: [] };
  let file = null;
  let ln = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++ ")) {
      file = l.startsWith("+++ b/") ? l.slice(6) : null;
      continue;
    }
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (h) {
      ln = Number(h[1]);
      continue;
    }
    if (!file) continue;
    if (l.startsWith("+")) {
      const text = l.slice(1);
      const here = `${file}:${ln}: ${text.trim().slice(0, 160)}`;
      ln++;
      if (file.startsWith("scripts/upstream/") || file === "UPSTREAM.md")
        continue;
      // A comment cannot contact anything or set a default.
      if (/^\s*(#|\/\/|;|\*|\/\*|<!--)/.test(text)) continue;
      const cls = classify(file);
      const hasEmail = new RegExp(EMAIL_RE.source, "i").test(text);
      const hasHost = HOST_RE.test(text.replace(EMAIL_RE, ""));
      if (hasEmail && cls !== "docs-tests") out.emails.push(here);
      if (hasHost || (hasEmail && cls === "docs-tests")) out[cls].push(here);
      if (hasHost && SDK_SOURCE.test(file) && cls !== "docs-tests")
        out.sdk.push(here);
    } else if (!l.startsWith("-")) ln++;
  }
  return out;
}

export function checkInstantHosts(base, root) {
  const diff = git(["diff", "--no-color", "--no-ext-diff", "-U0", base, "--"], {
    cwd: root,
    raw: true,
  });
  return scanAddedLines(diff);
}

// ---------------------------------------------------------------------------
// Session `versions` keys ('@instantdb/<pkg>': version) are part of the wire
// protocol: the server reads them. The rename must never touch them.

const VERSIONS_KEY_RE =
  /(['"])@(instantdb|sidekickdb)\/([a-z0-9-]+)\1\s*:\s*[^,}\n]*version/gi;
const VERSIONS_SCOPE =
  /^client\/packages\/(?!python\/)[^/]+\/src\/.*\.(?:[cm]?[jt]sx?|svelte|vue)$/;

export function versionsKeys(texts) {
  const keys = new Set();
  for (const [file, text] of texts) {
    if (!VERSIONS_SCOPE.test(file)) continue;
    for (const m of text.matchAll(VERSIONS_KEY_RE))
      keys.add(`${file} @${m[2]}/${m[3]}`);
  }
  return keys;
}

function filesAt(ref, root) {
  const names = lines(
    git(["ls-tree", "-r", "--name-only", "-z", ref, "--", "client/packages"], {
      cwd: root,
    }).replace(/\0/g, "\n"),
  ).filter((f) => VERSIONS_SCOPE.test(f));
  return names.map((f) => [
    f,
    git(["show", `${ref}:${f}`], { cwd: root, raw: true }),
  ]);
}

function filesInTree(root) {
  const names = lines(
    git(["ls-files", "-z", "--", "client/packages"], { cwd: root }).replace(
      /\0/g,
      "\n",
    ),
  ).filter((f) => VERSIONS_SCOPE.test(f));
  const out = [];
  for (const f of names) {
    try {
      out.push([f, fs.readFileSync(path.join(root, f), "utf8")]);
    } catch {
      // deleted in the working tree
    }
  }
  return out;
}

export function compareVersionsKeys(before, after) {
  const failures = [];
  const info = [];
  for (const k of after) {
    if (k.includes(" @sidekickdb/"))
      failures.push(
        `${k.replace(" ", ": ")} is a session versions key under the new name; it must stay '@instantdb/...' (wire protocol)`,
      );
  }
  for (const k of before) {
    if (!after.has(k) && k.includes(" @instantdb/"))
      failures.push(
        `${k.replace(" ", ": ")} versions key is gone; if upstream removed it on purpose, say so in the sync PR`,
      );
  }
  for (const k of after)
    if (!before.has(k) && k.includes(" @instantdb/"))
      info.push(`new versions key ${k.replace(" ", ": ")}`);
  return { failures, info };
}

// ---------------------------------------------------------------------------

export function changedFiles(base, root) {
  return lines(
    git(
      [
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        "--diff-filter=d",
        base,
        "--",
      ],
      { cwd: root },
    ).replace(/\0/g, "\n"),
  );
}

export function checkConflictMarkers(files, root) {
  const bad = [];
  for (const f of files) {
    const abs = path.join(root, f);
    let t;
    try {
      t = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const m = t.match(/^(<{7}|>{7}) /m);
    if (m) bad.push(f);
  }
  return bad;
}

export const LLM_RULES = [
  "client/www/lib/intern/instant-rules.md",
  "client/packages/create-instant-app/template/rules/AGENTS.md",
];

export function defaultBase(root) {
  if (
    gitTry(["rev-parse", "-q", "--verify", "MERGE_HEAD"], { cwd: root })
      .status === 0
  )
    return "HEAD";
  const parents = git(["rev-list", "--parents", "-n1", "HEAD"], {
    cwd: root,
  }).split(" ");
  if (parents.length > 2) return "HEAD^1";
  return "origin/main";
}

export function runChecks({
  root,
  base,
  allowLeftovers = false,
  acceptHosts = false,
}) {
  const failures = [];
  const warnings = [];
  const review = {};

  const wf = checkWorkflows(root, disabledAt(base, root));
  failures.push(...wf.failures);
  warnings.push(...wf.warnings);

  const files = changedFiles(base, root);
  const markers = checkConflictMarkers(files, root);
  for (const f of markers) failures.push(`${f}: conflict markers remain`);

  const norm = normalizeFiles(
    files.filter((f) => !isExcluded(f)),
    { root, check: true },
  );
  for (const c of norm.changed)
    failures.push(
      `${c.file}: needs the rename normalizer (${c.changes.length} rewrite(s))`,
    );
  for (const { file, items } of norm.leftovers) {
    for (const it of items) {
      (allowLeftovers ? warnings : failures).push(
        `${file}:${it.line}: rename leftover [${it.id}] ${it.text}\n      -> ${it.hint}`,
      );
    }
  }

  const [a, b] = LLM_RULES.map((f) => path.join(root, f));
  if (
    fs.existsSync(a) &&
    fs.existsSync(b) &&
    fs.readFileSync(a, "utf8") !== fs.readFileSync(b, "utf8")
  ) {
    failures.push(
      `${LLM_RULES[0]} and ${LLM_RULES[1]} differ (regenerate with client/www/scripts/gen-llm-rules.ts)`,
    );
  }

  const vk = compareVersionsKeys(
    versionsKeys(filesAt(base, root)),
    versionsKeys(filesInTree(root)),
  );
  failures.push(...vk.failures);
  warnings.push(...vk.info);

  try {
    failures.push(...checkServerMinimums(root));
  } catch (e) {
    failures.push(e.message);
  }

  const hosts = checkInstantHosts(base, root);
  review.hosts = hosts;
  for (const l of hosts.sdk) {
    (acceptHosts ? warnings : failures).push(
      `${l}\n      -> Instant host in SDK/CLI/MCP source: the packages have no default server (PR #11). If it is only a link for people, re-run with --accept-hosts`,
    );
  }
  return { base, files: files.length, failures, warnings, review };
}

export function printChecks(r, log = console.log) {
  log(`Post-sync checks against ${r.base} (${r.files} changed file(s)):`);
  if (r.failures.length) {
    log(`\nFAIL (${r.failures.length}):`);
    for (const f of r.failures) log(`  - ${f}`);
  }
  if (r.warnings.length) {
    log(`\nWarnings (${r.warnings.length}):`);
    for (const w of r.warnings) log(`  - ${w}`);
  }
  const h = r.review.hosts;
  const labels = {
    runtime: "runtime code or config defaults (must not point at Instant)",
    build:
      "build-time files (Dockerfile, next.config, package.json, workflows)",
    "docs-tests":
      "docs, tests, examples (usually fine; check links that users follow)",
  };
  const any = Object.keys(labels).some((k) => h[k].length);
  log(`\nAdded lines mentioning Instant-owned hosts: ${any ? "" : "none."}`);
  for (const k of Object.keys(labels)) {
    if (!h[k].length) continue;
    log(`  ${labels[k]}: ${h[k].length}`);
    for (const l of h[k].slice(0, 50)) log(`    ${l}`);
    if (h[k].length > 50) log(`    ... ${h[k].length - 50} more`);
  }
  log(
    `\nAdded Instant-domain email addresses outside docs and tests (possible sender or contact defaults; PR #4 removed these): ${h.emails.length ? h.emails.length : "none."}`,
  );
  for (const l of h.emails.slice(0, 50)) log(`    ${l}`);
  if (h.emails.length > 50) log(`    ... ${h.emails.length - 50} more`);
  log(r.failures.length ? "\nResult: FAIL" : "\nResult: OK");
}

function main() {
  const argv = process.argv.slice(2);
  const root = repoRoot();
  let base = null;
  let allowLeftovers = false;
  let acceptHosts = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") base = argv[++i];
    else if (argv[i] === "--allow-leftovers") allowLeftovers = true;
    else if (argv[i] === "--accept-hosts") acceptHosts = true;
    else if (argv[i] === "-h" || argv[i] === "--help") {
      console.log(
        "usage: node scripts/upstream/check.mjs [--base <ref>] [--allow-leftovers] [--accept-hosts]",
      );
      return;
    } else throw new Error(`unknown option ${argv[i]}`);
  }
  const r = runChecks({
    root,
    base: base || defaultBase(root),
    allowLeftovers,
    acceptHosts,
  });
  printChecks(r);
  if (r.failures.length) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("check.mjs")) {
  try {
    main();
  } catch (e) {
    console.error(`check: ${e.message}`);
    process.exit(3);
  }
}
