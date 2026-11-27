#!/usr/bin/env node
// SidekickDB: npm release tooling for the @sidekickdb/* packages.
//
//   node scripts/sidekick-release-npm.mjs plan
//       Offline. Validates the version in packages/version/src/version.ts and
//       prints the packages in publish order. Run by CI before publishing.
//
//   node scripts/sidekick-release-npm.mjs pack --out <dir>
//       The release workflow's build job, which has no publish rights. Sets
//       every package.json to the release version, builds, packs each package
//       with pnpm (which rewrites workspace:* ranges) into <dir> and writes
//       <dir>/manifest.json. Restores the package.json versions afterwards.
//
//   node scripts/sidekick-release-npm.mjs publish-tarballs --dir <dir> [--dry-run]
//       The release workflow's publish job: no install, no build, only a
//       sparse checkout of this script and the package manifests. Checks the
//       artifact against the checkout (version, names, order, files, and the
//       name and version inside every tarball), then publishes with npm under
//       the `latest` dist-tag. Authentication is npm trusted publishing (GitHub
//       OIDC): there is no npm token anywhere. Versions already on npm are
//       skipped, so a failed run can be re-run. Real publishes only in
//       GitHub Actions.
//
//   node scripts/sidekick-release-npm.mjs claim-names [--dry-run]
//       Owner only, once, on their own machine while logged in to npm. Publishes
//       a placeholder for every package name that does not exist on npm yet,
//       so trusted publishing can be configured for it. The placeholder is the
//       lowest 0.0.N the name has never had (usually 0.0.0; npm never accepts
//       a version twice, also after an unpublish). npm asks for the 2FA code
//       itself. Never run in CI.
//
//   node scripts/sidekick-release-npm.mjs trust [--dry-run]
//       Owner only, once, after claim-names. Runs `npm trust github` for every
//       package so npm accepts publishes from sidekick-release-npm.yml in the
//       npm-release environment of SidekickDB/sidekick. npm asks for 2FA on
//       the first call and offers to skip it for 5 minutes, which covers all
//       of them. Failures are listed at the end; re-running is safe.
//
// See RELEASING.md at the repository root.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CLIENT_DIR = path.resolve(here, "..");
const REPO = "SidekickDB/sidekick";
const REPO_URL = `git+https://github.com/${REPO}.git`;
export const RELEASE_WORKFLOW = "sidekick-release-npm.yml";
export const RELEASE_ENVIRONMENT = "npm-release";

// The server turns protocol features on by comparing the core package version
// the client reports (session `versions` map) against fixed minimums, and its parser only
// accepts `x.y.z` or `x.y.z-dev` (server/src/instant/reactive/session.clj,
// server/src/instant/util/semver.clj). A lower or unparseable version
// silently drops batch-messages, skip-attrs and patch-presence, so SidekickDB
// keeps upstream's numbering and releases plain versions above this floor.
export const SERVER_FEATURE_FLOOR = [0, 22, 75];

export function parseVersion(v) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m)
    throw new Error(
      `version must look like v1.2.3 (no prerelease suffix: the server cannot parse one), got ${JSON.stringify(v)}`,
    );
  return m.slice(1).map(Number);
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

export function checkVersion(v) {
  const parts = parseVersion(v);
  if (compare(parts, SERVER_FEATURE_FLOOR) <= 0)
    throw new Error(
      `version ${v} must be above ${SERVER_FEATURE_FLOOR.join(".")}, or the server disables protocol features for these clients`,
    );
  return parts.join(".");
}

export function readVersion(clientDir = CLIENT_DIR) {
  const file = path.join(clientDir, "packages/version/src/version.ts");
  const m = /const version = '([^']*)'/.exec(fs.readFileSync(file, "utf8"));
  if (!m) throw new Error(`no \`const version = '...'\` in ${file}`);
  return m[1];
}

// SidekickDB has its own version line, so an upstream sync can raise one of
// the server's version minimums above it without touching version.ts.
// scripts/upstream/check.mjs runs checkServerMinimums on every sync.
export const SERVER_MIN_VERSION_FILES = [
  "server/src/instant/reactive/session.clj",
  "server/src/instant/dash/routes.clj",
];

// The server ties no meaning to a minimum's name, so every version string
// literal in these files (what instant.util.semver accepts: x.y.z, optional
// v and -dev) counts as a minimum, whatever form holds it. Comments and
// character literals are skipped. A file with no version literal is an error.
// Not seen: a minimum assembled at runtime, written as a version map by
// hand, or defined in another server file.
const VERSION_LITERAL = /^v?(\d+)\.(\d+)\.(\d+)(?:-dev)?$/;
const CLOJURE_TOKENS = /;[^\n]*|\\.|"((?:[^"\\]|\\.)*)"/g;
const TOP_LEVEL_DEF =
  /^\(def[\w-]*\s+(?:\^(?:\{(?:[^}"]|"(?:[^"\\]|\\.)*")*\}|\S+)\s+)*([^\s()]+)/;

export function serverMinimums(repoRoot = path.resolve(CLIENT_DIR, "..")) {
  return SERVER_MIN_VERSION_FILES.flatMap((f) => {
    const text = fs.readFileSync(path.join(repoRoot, f), "utf8");
    const lineAt = (i) => text.slice(0, i).split("\n").length;
    // The name of the top-level def/defn/... form holding offset i, if any.
    const defAt = (i) => {
      const start = text.lastIndexOf("\n(", i);
      return TOP_LEVEL_DEF.exec(text.slice(start + 1, i))?.[1];
    };
    const out = [];
    for (const t of text.matchAll(CLOJURE_TOKENS)) {
      const m = t[1] !== undefined && VERSION_LITERAL.exec(t[1]);
      if (!m) continue;
      const where = `${f}:${lineAt(t.index)}`;
      const name = defAt(t.index);
      out.push({
        name: name ? `${where} ${name}` : where,
        literal: t[1],
        parts: m.slice(1, 4).map(Number),
      });
    }
    if (!out.length)
      throw new Error(
        `${f}: no version string literal found, but this is where the server keeps its version minimums. If they moved, update serverMinimums in client/scripts/sidekick-release-npm.mjs`,
      );
    return out;
  });
}

// One message per server minimum the version in version.ts is not above.
export function checkServerMinimums(repoRoot = path.resolve(CLIENT_DIR, "..")) {
  const v = readVersion(path.join(repoRoot, "client"));
  const ours = parseVersion(v);
  return serverMinimums(repoRoot)
    .filter(({ parts }) => compare(ours, parts) <= 0)
    .map(
      ({ name, literal }) =>
        `${name} "${literal}": the SidekickDB version in client/packages/version/src/version.ts (${v}) must be above every server version minimum (protocol features in session.clj, the CLI's compatibility floor in routes.clj). Raise version.ts (RELEASING.md). If this string is not a minimum, add an exception to serverMinimums in client/scripts/sidekick-release-npm.mjs`,
    );
}

const DEP_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
];

// Every non-private package under packages/, dependencies first.
export function listPackages(clientDir = CLIENT_DIR) {
  const root = path.join(clientDir, "packages");
  const pkgs = fs
    .readdirSync(root)
    .map((d) => path.join(root, d, "package.json"))
    .filter((f) => fs.existsSync(f))
    .map((file) => ({ file, json: JSON.parse(fs.readFileSync(file, "utf8")) }))
    .filter(({ json }) => json.name && !json.private)
    .map(({ file, json }) => ({
      name: json.name,
      dir: path.dirname(file),
      file,
      deps: new Set(DEP_FIELDS.flatMap((k) => Object.keys(json[k] || {}))),
    }));
  return orderPackages(pkgs);
}

export function orderPackages(pkgs) {
  const byName = new Map(pkgs.map((p) => [p.name, p]));
  const out = [];
  const state = new Map(); // name -> "visiting" | "done"
  const visit = (p, trail) => {
    const s = state.get(p.name);
    if (s === "done") return;
    if (s === "visiting")
      throw new Error(`dependency cycle: ${[...trail, p.name].join(" -> ")}`);
    state.set(p.name, "visiting");
    for (const d of [...p.deps].sort())
      if (byName.has(d) && d !== p.name)
        visit(byName.get(d), [...trail, p.name]);
    state.set(p.name, "done");
    out.push(p);
  };
  for (const p of [...pkgs].sort((a, b) => a.name.localeCompare(b.name)))
    visit(p, []);
  return out;
}

export function checkNames(pkgs) {
  const bad = pkgs.filter(
    (p) => !p.name.startsWith("@sidekickdb/") && p.name !== "create-sidekick-app",
  );
  if (bad.length)
    throw new Error(
      `refusing to publish names outside @sidekickdb/* and create-sidekick-app: ${bad.map((p) => p.name).join(", ")}`,
    );
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    cwd: opts.cwd || CLIENT_DIR,
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (r.error) throw r.error;
  if (!opts.allowFail && r.status !== 0)
    throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`);
  return r;
}

// true / false, or throws when npm fails for another reason than "not found".
function existsOnNpm(spec) {
  const r = run("npm", ["view", spec, "version", "--json"], {
    capture: true,
    allowFail: true,
  });
  if (r.status === 0) return r.stdout.trim() !== "";
  if (/E404|404 Not Found/.test(r.stderr + r.stdout)) return false;
  throw new Error(`npm view ${spec} failed:\n${r.stderr}`);
}

function setVersions(pkgs, version) {
  for (const p of pkgs) {
    const json = JSON.parse(fs.readFileSync(p.file, "utf8"));
    json.version = version;
    fs.writeFileSync(p.file, JSON.stringify(json, null, 2) + "\n");
  }
}

function plan() {
  const v = readVersion();
  const version = checkVersion(v);
  const pkgs = listPackages();
  checkNames(pkgs);
  console.log(`version: ${version} (from packages/version/src/version.ts)`);
  console.log(`packages (${pkgs.length}, publish order):`);
  for (const p of pkgs) console.log(`  ${p.name}`);
  return { version, pkgs };
}

export const MANIFEST = "manifest.json";

// Apache-2.0 section 4(a): everyone who gets a package gets the licence. The
// packages have no copy of their own, so the repository's files go into each
// tarball at pack time and are removed again afterwards.
export const LICENCE_FILES = ["LICENSE.md", "NOTICE"];

// Nothing is copied when a package has a file of its own under one of these
// names, so removeLicenceFiles only ever deletes copies.
export function addLicenceFiles(pkgs, root = path.resolve(CLIENT_DIR, "..")) {
  for (const p of pkgs)
    for (const f of LICENCE_FILES)
      if (fs.existsSync(path.join(p.dir, f)))
        throw new Error(`${path.join(p.dir, f)} already exists`);
  for (const p of pkgs) {
    for (const f of LICENCE_FILES)
      fs.copyFileSync(path.join(root, f), path.join(p.dir, f));
    // A package with a "files" list packs only what the list names.
    const json = JSON.parse(fs.readFileSync(p.file, "utf8"));
    if (json.files) {
      json.files = [...json.files, ...LICENCE_FILES];
      fs.writeFileSync(p.file, JSON.stringify(json, null, 2) + "\n");
    }
  }
}

export function removeLicenceFiles(pkgs) {
  for (const p of pkgs) {
    for (const f of LICENCE_FILES) fs.rmSync(path.join(p.dir, f), { force: true });
    const json = JSON.parse(fs.readFileSync(p.file, "utf8"));
    if (json.files) {
      json.files = json.files.filter((f) => !LICENCE_FILES.includes(f));
      fs.writeFileSync(p.file, JSON.stringify(json, null, 2) + "\n");
    }
  }
}

// Build job (no publish rights): stamp the version, build, pack every package
// into `out` and write the manifest the publish job checks.
function pack({ out }) {
  if (!out) throw new Error("pack needs --out <dir>");
  const { version, pkgs } = plan();
  fs.mkdirSync(out, { recursive: true });
  if (fs.readdirSync(out).length) throw new Error(`${out} is not empty`);
  setVersions(pkgs, version);
  let licenceFilesAdded = false;
  try {
    addLicenceFiles(pkgs);
    licenceFilesAdded = true;
    run("pnpm", ["run", "build-packages"]);
    const packages = [];
    for (const p of pkgs) {
      const dest = fs.mkdtempSync(path.join(os.tmpdir(), "sidekick-pack-"));
      run("pnpm", ["pack", "--pack-destination", dest], { cwd: p.dir });
      const tgz = fs.readdirSync(dest).filter((f) => f.endsWith(".tgz"));
      if (tgz.length !== 1)
        throw new Error(`expected one tarball for ${p.name}, found ${tgz}`);
      fs.copyFileSync(path.join(dest, tgz[0]), path.join(out, tgz[0]));
      packages.push({ name: p.name, file: tgz[0] });
      console.log(`[pack] ${p.name}@${version} -> ${tgz[0]}`);
    }
    fs.writeFileSync(
      path.join(out, MANIFEST),
      JSON.stringify({ version, packages }, null, 2) + "\n",
    );
  } finally {
    if (licenceFilesAdded) removeLicenceFiles(pkgs);
    setVersions(pkgs, "0.0.0");
  }
}

// The name and version inside a tarball, and the paths of its files.
function tarballManifest(tgz) {
  const r = run("tar", ["-xzOf", tgz, "package/package.json"], {
    capture: true,
  });
  const { name, version } = JSON.parse(r.stdout);
  const list = run("tar", ["-tzf", tgz], { capture: true });
  return { name, version, entries: list.stdout.split("\n").filter(Boolean) };
}

// Check the build job's output against this checkout. The artifact is data
// only: the expected names, order and version come from the repository, and
// every tarball must carry exactly that name and version, and the licence
// files.
export function verifyArtifact(dir, { version, names }, readTarball) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), "utf8"));
  if (m.version !== version)
    throw new Error(`artifact is for ${m.version}, this checkout releases ${version}`);
  const got = (m.packages || []).map((p) => p.name);
  if (JSON.stringify(got) !== JSON.stringify(names))
    throw new Error(
      `artifact packages differ from this checkout:\n  artifact: ${got.join(", ")}\n  expected: ${names.join(", ")}`,
    );
  const files = fs.readdirSync(dir).filter((f) => f !== MANIFEST).sort();
  const listed = m.packages.map((p) => p.file).sort();
  if (JSON.stringify(files) !== JSON.stringify(listed))
    throw new Error(`artifact has unexpected files: ${files.join(", ")}`);
  return m.packages.map((p) => {
    if (!/^[\w.-]+\.tgz$/.test(p.file) || p.file.startsWith("."))
      throw new Error(`bad tarball name ${JSON.stringify(p.file)}`);
    const tgz = path.join(dir, p.file);
    const pj = readTarball(tgz);
    if (pj.name !== p.name || pj.version !== version)
      throw new Error(
        `${p.file} contains ${pj.name}@${pj.version}, expected ${p.name}@${version}`,
      );
    for (const f of LICENCE_FILES)
      if (!(pj.entries || []).includes(`package/${f}`))
        throw new Error(`${p.file} has no ${f}`);
    return { name: p.name, tgz };
  });
}

// Publish job (id-token, no install, no build): publish the verified
// tarballs in dependency order. Versions already on npm are skipped.
function publishTarballs({ dir, dryRun }) {
  if (!dir) throw new Error("publish-tarballs needs --dir <dir>");
  if (!process.env.GITHUB_ACTIONS && !dryRun)
    throw new Error(
      "publish-tarballs runs only in GitHub Actions (trusted publishing). Use --dry-run locally.",
    );
  const { version, pkgs } = plan();
  const items = verifyArtifact(
    dir,
    { version, names: pkgs.map((p) => p.name) },
    tarballManifest,
  );
  const published = [];
  let skipped = 0;
  for (const { name, tgz } of items) {
    if (existsOnNpm(`${name}@${version}`)) {
      console.log(`[skip] ${name}@${version} is already on npm`);
      skipped++;
      continue;
    }
    const args = ["publish", tgz, "--access", "public", "--tag", "latest"];
    if (dryRun) args.push("--dry-run");
    else args.push("--provenance");
    console.log(`[publish] ${name}@${version}${dryRun ? " (dry run)" : ""}`);
    run("npm", args, { cwd: dir });
    published.push(name);
  }
  console.log(
    `\n${dryRun ? "would publish" : "published"} ${published.length}, skipped ${skipped} (already on npm)`,
  );
  if (!published.length)
    throw new Error(
      `every package is already on npm at ${version}; bump packages/version/src/version.ts to an unreleased version`,
    );
}

// The lowest 0.0.N npm has never seen for a name. `time` is the `time` object
// of the name's registry document; none means the registry never had the name.
// An unpublished version stays a key of `time` or in `time.unpublished`.
export function placeholderVersion(time) {
  const { created, modified, unpublished, ...versions } = time || {};
  const used = new Set([
    ...Object.keys(versions),
    ...(unpublished?.versions || []),
  ]);
  let n = 0;
  while (used.has(`0.0.${n}`)) n++;
  return `0.0.${n}`;
}

// The `time` object of a name's registry document, or undefined for a 404.
async function registryTime(name) {
  const url = `https://registry.npmjs.org/${name.replace("/", "%2f")}`;
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`GET ${url} failed: ${r.status}`);
  return (await r.json()).time;
}

async function claimNames({ dryRun }) {
  if (process.env.GITHUB_ACTIONS)
    throw new Error("claim-names is for the owner's machine, not CI");
  const pkgs = listPackages();
  checkNames(pkgs);
  const missing = pkgs.filter((p) => !existsOnNpm(p.name));
  console.log(
    `${pkgs.length - missing.length} of ${pkgs.length} names already exist on npm`,
  );
  if (!missing.length) return;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "sidekick-claim-"));
  for (const p of missing) {
    const real = JSON.parse(fs.readFileSync(p.file, "utf8"));
    const version = placeholderVersion(await registryTime(p.name));
    const dir = path.join(out, p.name.replace(/[@/]/g, "_"));
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: p.name,
          version,
          description:
            "Placeholder. The first real SidekickDB release replaces it.",
          license: "Apache-2.0",
          repository: {
            type: "git",
            url: REPO_URL,
            directory: real.repository?.directory,
          },
        },
        null,
        2,
      ) + "\n",
    );
    fs.writeFileSync(
      path.join(dir, "README.md"),
      `# ${p.name}\n\nPlaceholder for SidekickDB (https://github.com/SidekickDB/sidekick).\nDo not install this version.\n`,
    );
    const args = ["publish", "--access", "public"];
    if (dryRun) args.push("--dry-run");
    console.log(`\n[claim] ${p.name}@${version}${dryRun ? " (dry run)" : ""}`);
    run("npm", args, { cwd: dir });
  }
}

function trust({ dryRun }) {
  if (process.env.GITHUB_ACTIONS)
    throw new Error("trust is for the owner's machine, not CI");
  const help = run("npm", ["trust", "--help"], { capture: true, allowFail: true });
  if (help.status !== 0)
    throw new Error("this npm has no `npm trust` command; update npm (npm install -g npm@latest)");
  const pkgs = listPackages();
  checkNames(pkgs);
  const failed = [];
  for (const p of pkgs) {
    const args = [
      "trust",
      "github",
      p.name,
      "--repository",
      REPO,
      "--file",
      RELEASE_WORKFLOW,
      "--environment",
      RELEASE_ENVIRONMENT,
      "--allow-publish",
      "--yes",
    ];
    if (dryRun) args.push("--dry-run");
    console.log(`\n[trust] ${p.name}${dryRun ? " (dry run)" : ""}`);
    // Inherit stdio: npm prints its 2FA link or prompt here.
    if (run("npm", args, { allowFail: true }).status !== 0) failed.push(p.name);
    // npm recommends a pause between calls to avoid rate limiting.
    spawnSync("sleep", ["2"]);
  }
  console.log(`\nconfigured ${pkgs.length - failed.length} of ${pkgs.length}`);
  if (failed.length) {
    console.log(
      `failed: ${failed.join(", ")}\n` +
        "A package that already has a trusted publisher fails here too; check it with\n" +
        "`npm trust list <package>` and re-run this command for the rest.",
    );
    process.exitCode = 1;
  }
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (f) => rest.includes(f);
  const opt = (f, d) => {
    const i = rest.indexOf(f);
    return i >= 0 ? rest[i + 1] : d;
  };
  if (cmd === "plan") return plan();
  if (cmd === "pack") return pack({ out: opt("--out") });
  if (cmd === "publish-tarballs")
    return publishTarballs({ dir: opt("--dir"), dryRun: flag("--dry-run") });
  if (cmd === "claim-names") return claimNames({ dryRun: flag("--dry-run") });
  if (cmd === "trust") return trust({ dryRun: flag("--dry-run") });
  console.error(
    "usage: sidekick-release-npm.mjs plan | pack --out <dir> | publish-tarballs --dir <dir> [--dry-run] | claim-names [--dry-run] | trust [--dry-run]",
  );
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
