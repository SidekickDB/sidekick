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
//   - a disabled publish/deploy job or step is enabled again, a publish-only
//     workflow regains a trigger, a new schedule/pull_request_target trigger
//     appears, or an enabled job uses secrets, write permissions, publish or
//     deploy tools, or Instant-owned hosts;
//   - files still need the rename normalizer, or rename leftovers remain
//     (unless --allow-leftovers);
//   - the two copies of the LLM rules differ;
//   - conflict markers remain in changed files.
// Lists for review (does not fail): added lines that mention Instant-owned
// hosts, split into runtime/config defaults, build-time files, and
// docs/tests.

import fs from 'node:fs';
import path from 'node:path';
import { git, gitTry, lines, repoRoot } from './git.mjs';
import { normalizeFiles } from './normalize-rename.mjs';
import { isExcluded } from './rename.mjs';

// ---------------------------------------------------------------------------
// Workflow lockdown

// Jobs that must stay disabled (job-level `if:` starting with `false`).
export const DISABLED_JOBS = {
  'clojure.yml': ['publish-image', 'publish-eb'],
  'js.yml': [
    'publish-docs',
    'deploy-remote-mcp',
    'publish-experimental-package',
    'publish-packages',
    'vercel-preview',
    'vercel-prod-deploy',
    'vercel-staging-deploy',
  ],
  'python-publish.yml': ['build', 'publish'],
  'publish-self-hosted-images.yml': ['build', 'publish'],
  'sync-instant-skills.yml': ['sync'],
};

// Steps inside enabled jobs that must stay disabled.
export const DISABLED_STEPS = {
  'clojure.yml': [['detect_changes', 'Fetch timings']],
  'js.yml': [['build', 'Run tests']],
};

// Workflows whose only trigger may be workflow_dispatch.
export const DISPATCH_ONLY = ['python-publish.yml', 'publish-self-hosted-images.yml', 'sync-instant-skills.yml'];

export const KNOWN_WORKFLOWS = ['clojure.yml', 'js.yml', 'python.yml', ...DISPATCH_ONLY];

// Things an enabled job must not do.
const RISKY = [
  [/\$\{\{\s*secrets\.(?!GITHUB_TOKEN\b)/, 'uses a repository secret'],
  [/id-token:\s*write/, 'id-token: write (OIDC publishing/deploys)'],
  [/packages:\s*write/, 'packages: write'],
  [/contents:\s*write/, 'contents: write'],
  [/\b(?:npm|pnpm|yarn) publish\b|publish_packages|make publish/, 'publishes packages'],
  [/flyctl/, 'deploys to Fly'],
  [/\bvercel\b/i, 'deploys to Vercel'],
  [/docker push|push:\s*true|amazon-ecr|docker\/login-action/, 'pushes images'],
  [/aws-actions\/|elastic-beanstalk/, 'uses AWS credentials or deploys'],
  [/gh-action-pypi-publish|twine upload/, 'publishes to PyPI'],
  [/algolia/i, 'writes to Algolia'],
  [/git push/, 'pushes to a repository'],
  [/instantdb\.com|stopaio/, 'contacts an Instant-owned host'],
];

function parseWorkflow(text) {
  const ls = text.split('\n');
  const jobs = [];
  const triggers = [];
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
        const inline = l.replace(/^[^:]+:\s*/, '').replace(/#.*/, '').trim();
        if (inline) triggers.push(...inline.replace(/[[\]]/g, '').split(/[,\s]+/).filter(Boolean));
      }
      job = null;
      continue;
    }
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
  return { jobs, triggers };
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
    if (inSteps && text.trim() && ind <= stepsIndent && !/^\s*-/.test(text) && !/^\s*#/.test(text)) {
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
    if (nm && cur.name === null) cur.name = nm[1].trim().replace(/^['"]|['"]$/g, '');
    const im = text.match(/^\s*-?\s*if:\s*(.*)$/);
    if (im && cur.if === null) cur.if = im[1];
  }
  return steps;
}

const isFalse = (cond) => cond !== null && /^(\$\{\{\s*)?\(?\s*false\b/.test(cond.trim());

export function checkWorkflows(root) {
  const failures = [];
  const warnings = [];
  const dir = path.join(root, '.github/workflows');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)) : [];
  for (const f of Object.keys(DISABLED_JOBS)) {
    if (!files.includes(f)) warnings.push(`.github/workflows/${f} no longer exists (was it renamed upstream? update scripts/upstream/check.mjs)`);
  }
  for (const f of files) {
    const rel = `.github/workflows/${f}`;
    const { jobs, triggers } = parseWorkflow(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!KNOWN_WORKFLOWS.includes(f)) warnings.push(`${rel}: new workflow file, review it by hand`);
    for (const t of triggers) {
      if (t === 'schedule') failures.push(`${rel}: has a schedule trigger (SidekickDB runs no scheduled workflows)`);
      if (t === 'pull_request_target') failures.push(`${rel}: has a pull_request_target trigger`);
      if (t === 'workflow_run') warnings.push(`${rel}: has a workflow_run trigger, review it`);
    }
    if (DISPATCH_ONLY.includes(f)) {
      const extra = triggers.filter((t) => t !== 'workflow_dispatch');
      if (extra.length) failures.push(`${rel}: publish-only workflow has triggers besides workflow_dispatch: ${extra.join(', ')}`);
    }
    for (const name of DISABLED_JOBS[f] || []) {
      const j = jobs.find((x) => x.name === name);
      if (!j) warnings.push(`${rel}: expected disabled job "${name}" not found (renamed upstream?)`);
      else if (!isFalse(j.if)) failures.push(`${rel}:${j.start}: job "${name}" must stay disabled (if: false && (...)), found if: ${j.if ?? '(none)'}`);
    }
    for (const [jobName, stepName] of DISABLED_STEPS[f] || []) {
      const j = jobs.find((x) => x.name === jobName);
      const s = j?.steps.find((x) => x.name === stepName);
      if (!s) warnings.push(`${rel}: expected disabled step "${stepName}" in job "${jobName}" not found`);
      else if (!isFalse(s.if)) failures.push(`${rel}: step "${stepName}" in job "${jobName}" must stay disabled, found if: ${s.if ?? '(none)'}`);
    }
    for (const j of jobs) {
      if (isFalse(j.if)) continue;
      const disabledStepLines = new Set(
        j.steps.filter((s) => isFalse(s.if)).flatMap((s) => s.lines.map((l) => l.n)),
      );
      for (const { n, text } of j.lines) {
        if (disabledStepLines.has(n) || /^\s*#/.test(text)) continue;
        const code = text.replace(/\s#.*$/, '');
        for (const [re, why] of RISKY) {
          if (re.test(code)) failures.push(`${rel}:${n}: enabled job "${j.name}" ${why}: ${text.trim().slice(0, 140)}`);
        }
      }
    }
  }
  return { failures, warnings };
}

// ---------------------------------------------------------------------------
// Instant-owned hosts in added lines

const HOST_RE = /(?:[a-z0-9-]+\.)*instantdb\.com\b|stopaio\.s3\.amazonaws\.com|instant-[a-z0-9-]+\.s3[a-z0-9.-]*\.amazonaws\.com|s3:\/\/instant-|arn:aws:[a-z0-9-]+:[^\s'"]*instant/i;
const EMAIL_RE = /[\w.+-]+@(?:[a-z0-9-]+\.)*instantdb\.com\b/gi;

function classify(file) {
  if (/(^|\/)(__tests__|test|tests|e2e)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || /_test\.clj$/.test(file)) return 'docs-tests';
  if (/\.(md|mdx|markdown|txt|vtt)$/.test(file) || file.startsWith('client/www/app/docs/') || file.startsWith('client/www/_')) return 'docs-tests';
  if (/^(examples|client\/sandbox)\//.test(file)) return 'docs-tests';
  if (
    /(^|\/)Dockerfile[^/]*$/.test(file) ||
    /(^|\/)(next|vite|webpack|rollup|tailwind|postcss)\.config\.[cm]?[jt]s$/.test(file) ||
    /(^|\/)package\.json$/.test(file) ||
    /(^|\/)turbo\.json$/.test(file) ||
    /^client\/www\/scripts\//.test(file) ||
    /^\.github\//.test(file) ||
    /(^|\/)Makefile$/.test(file)
  )
    return 'build';
  return 'runtime';
}

export function checkInstantHosts(base, root) {
  const out = { runtime: [], build: [], 'docs-tests': [] };
  const diff = git(['diff', '--no-color', '--no-ext-diff', '-U0', base, '--'], { cwd: root, raw: true });
  let file = null;
  let ln = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) {
      file = l.startsWith('+++ b/') ? l.slice(6) : null;
      continue;
    }
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (h) {
      ln = Number(h[1]);
      continue;
    }
    if (!file) continue;
    if (l.startsWith('+')) {
      const text = l.slice(1);
      // A comment cannot contact anything.
      if (/^\s*(#|\/\/|;|\*|\/\*|<!--)/.test(text)) {
        ln++;
        continue;
      }
      const withoutEmails = text.replace(EMAIL_RE, '');
      if (HOST_RE.test(withoutEmails) && !file.startsWith('scripts/upstream/') && file !== 'UPSTREAM.md') {
        out[classify(file)].push(`${file}:${ln}: ${text.trim().slice(0, 160)}`);
      }
      ln++;
    } else if (!l.startsWith('-')) ln++;
  }
  return out;
}

// ---------------------------------------------------------------------------

export function changedFiles(base, root) {
  return lines(
    git(['diff', '--name-only', '--no-renames', '-z', '--diff-filter=d', base, '--'], { cwd: root }).replace(/\0/g, '\n'),
  );
}

export function checkConflictMarkers(files, root) {
  const bad = [];
  for (const f of files) {
    const abs = path.join(root, f);
    let t;
    try {
      t = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const m = t.match(/^(<{7}|>{7}) /m);
    if (m) bad.push(f);
  }
  return bad;
}

export const LLM_RULES = [
  'client/www/lib/intern/instant-rules.md',
  'client/packages/create-instant-app/template/rules/AGENTS.md',
];

export function defaultBase(root) {
  if (gitTry(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: root }).status === 0) return 'HEAD';
  const parents = git(['rev-list', '--parents', '-n1', 'HEAD'], { cwd: root }).split(' ');
  if (parents.length > 2) return 'HEAD^1';
  return 'origin/main';
}

export function runChecks({ root, base, allowLeftovers = false }) {
  const failures = [];
  const warnings = [];
  const review = {};

  const wf = checkWorkflows(root);
  failures.push(...wf.failures);
  warnings.push(...wf.warnings);

  const files = changedFiles(base, root);
  const markers = checkConflictMarkers(files, root);
  for (const f of markers) failures.push(`${f}: conflict markers remain`);

  const norm = normalizeFiles(files.filter((f) => !isExcluded(f)), { root, check: true });
  for (const c of norm.changed) failures.push(`${c.file}: needs the rename normalizer (${c.changes.length} rewrite(s))`);
  for (const { file, items } of norm.leftovers) {
    for (const it of items) {
      (allowLeftovers ? warnings : failures).push(`${file}:${it.line}: rename leftover [${it.id}] ${it.text}\n      -> ${it.hint}`);
    }
  }

  const [a, b] = LLM_RULES.map((f) => path.join(root, f));
  if (fs.existsSync(a) && fs.existsSync(b) && fs.readFileSync(a, 'utf8') !== fs.readFileSync(b, 'utf8')) {
    failures.push(`${LLM_RULES[0]} and ${LLM_RULES[1]} differ (regenerate with client/www/scripts/gen-llm-rules.ts)`);
  }

  const hosts = checkInstantHosts(base, root);
  review.hosts = hosts;
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
    runtime: 'runtime code or config defaults (must not point at Instant)',
    build: 'build-time files (Dockerfile, next.config, package.json, workflows)',
    'docs-tests': 'docs, tests, examples (usually fine; check links that users follow)',
  };
  const any = Object.values(h).some((x) => x.length);
  log(`\nAdded lines mentioning Instant-owned hosts: ${any ? '' : 'none.'}`);
  for (const k of Object.keys(labels)) {
    if (!h[k].length) continue;
    log(`  ${labels[k]}: ${h[k].length}`);
    for (const l of h[k].slice(0, 50)) log(`    ${l}`);
    if (h[k].length > 50) log(`    ... ${h[k].length - 50} more`);
  }
  log(r.failures.length ? '\nResult: FAIL' : '\nResult: OK');
}

function main() {
  const argv = process.argv.slice(2);
  const root = repoRoot();
  let base = null;
  let allowLeftovers = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') base = argv[++i];
    else if (argv[i] === '--allow-leftovers') allowLeftovers = true;
    else if (argv[i] === '-h' || argv[i] === '--help') {
      console.log('usage: node scripts/upstream/check.mjs [--base <ref>] [--allow-leftovers]');
      return;
    } else throw new Error(`unknown option ${argv[i]}`);
  }
  const r = runChecks({ root, base: base || defaultBase(root), allowLeftovers });
  printChecks(r);
  if (r.failures.length) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith('check.mjs')) {
  try {
    main();
  } catch (e) {
    console.error(`check: ${e.message}`);
    process.exit(3);
  }
}
