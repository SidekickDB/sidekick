// SidekickDB: tests for scripts/sidekick-release-npm.mjs.
//   node --test scripts/sidekick-release-npm.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  checkNames,
  checkVersion,
  CLIENT_DIR,
  listPackages,
  orderPackages,
  parseVersion,
  readVersion,
  RELEASE_ENVIRONMENT,
  RELEASE_WORKFLOW,
  MANIFEST,
  verifyArtifact,
} from "./sidekick-release-npm.mjs";

test("only plain vX.Y.Z versions parse", () => {
  assert.deepEqual(parseVersion("v1.0.67"), [1, 0, 67]);
  for (const bad of ["1.0.67", "v1.0", "v1.0.67-next.0", "v1.0.67-dev", ""])
    assert.throws(() => parseVersion(bad), /must look like v1\.2\.3/);
});

test("versions at or below the server's feature floor are refused", () => {
  assert.equal(checkVersion("v1.0.67"), "1.0.67");
  assert.equal(checkVersion("v0.22.76"), "0.22.76");
  for (const low of ["v0.22.75", "v0.1.0", "v0.0.0"])
    assert.throws(() => checkVersion(low), /must be above 0\.22\.75/);
});

test("the checked-in version is releasable", () => {
  assert.doesNotThrow(() => checkVersion(readVersion()));
});

test("the repo's publishable packages are the expected 18, in dependency order", () => {
  const pkgs = listPackages();
  const names = pkgs.map((p) => p.name);
  assert.equal(names.length, 18);
  assert.ok(names.includes("create-sidekick-app"));
  assert.ok(names.every((n) => n === "create-sidekick-app" || n.startsWith("@sidekickdb/")));
  const pos = (n) => names.indexOf(n);
  for (const p of pkgs)
    for (const d of p.deps)
      if (names.includes(d)) assert.ok(pos(d) < pos(p.name), `${d} before ${p.name}`);
  assert.doesNotThrow(() => checkNames(pkgs));
});

test("names outside the SidekickDB scope are refused", () => {
  assert.throws(
    () => checkNames([{ name: "@acme/core" }, { name: "@sidekickdb/core" }]),
    /@acme\/core/,
  );
  // The unscoped sidekick-cli name belongs to someone else on npm.
  assert.throws(() => checkNames([{ name: "sidekick-cli" }]), /sidekick-cli/);
  assert.throws(() => checkNames([{ name: "left-pad" }]), /left-pad/);
});

test("ordering puts dependencies first and reports cycles", () => {
  const p = (name, ...deps) => ({ name, deps: new Set(deps) });
  const order = orderPackages([p("c", "b"), p("b", "a"), p("a", "lodash")]).map((x) => x.name);
  assert.deepEqual(order, ["a", "b", "c"]);
  assert.throws(() => orderPackages([p("a", "b"), p("b", "a")]), /dependency cycle/);
});

test("the trust settings match the release workflow", () => {
  const wf = fs.readFileSync(
    path.join(CLIENT_DIR, "..", ".github/workflows", RELEASE_WORKFLOW),
    "utf8",
  );
  assert.match(wf, new RegExp(`^    environment: ${RELEASE_ENVIRONMENT}$`, "m"));
  // Only the publish job, which installs and builds nothing, holds id-token.
  const jobs = wf.split(/^  (?=[\w-]+:\s*$)/m).slice(1);
  const withToken = jobs.filter((j) => /^      id-token: write$/m.test(j));
  assert.equal(withToken.length, 1);
  assert.match(withToken[0], /^publish:/);
  assert.doesNotMatch(withToken[0], /\bpnpm\b|\bnpm (?:install|ci|i)\b(?! -g npm@\d+\.\d+\.\d+ --ignore-scripts\b)/);
  assert.match(withToken[0], new RegExp(`^    environment: ${RELEASE_ENVIRONMENT}$`, "m"));
});

function artifact(files, manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sk-artifact-"));
  for (const f of files) fs.writeFileSync(path.join(dir, f), "");
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest));
  return dir;
}

test("the publish job accepts only the artifact this checkout expects", () => {
  const expect = { version: "1.0.68", names: ["@sidekickdb/version", "@sidekickdb/core"] };
  const files = ["sidekickdb-version-1.0.68.tgz", "sidekickdb-core-1.0.68.tgz"];
  const good = {
    version: "1.0.68",
    packages: [
      { name: "@sidekickdb/version", file: files[0] },
      { name: "@sidekickdb/core", file: files[1] },
    ],
  };
  const inside = (map) => (tgz) => map[path.basename(tgz)];
  const ok = inside({
    [files[0]]: { name: "@sidekickdb/version", version: "1.0.68" },
    [files[1]]: { name: "@sidekickdb/core", version: "1.0.68" },
  });
  const items = verifyArtifact(artifact(files, good), expect, ok);
  assert.deepEqual(items.map((i) => i.name), expect.names);

  assert.throws(
    () => verifyArtifact(artifact(files, { ...good, version: "1.0.67" }), expect, ok),
    /artifact is for 1\.0\.67/,
  );
  assert.throws(
    () => verifyArtifact(artifact(files, { ...good, packages: [...good.packages].reverse() }), expect, ok),
    /artifact packages differ/,
  );
  assert.throws(
    () => verifyArtifact(artifact([...files, "evil.tgz"], good), expect, ok),
    /unexpected files/,
  );
  assert.throws(
    () =>
      verifyArtifact(artifact(files, good), expect, inside({
        [files[0]]: { name: "@sidekickdb/version", version: "1.0.68" },
        [files[1]]: { name: "@sidekickdb/admin", version: "1.0.68" },
      })),
    /contains @sidekickdb\/admin@1\.0\.68, expected @sidekickdb\/core@1\.0\.68/,
  );
  const dotfile = { ...good, packages: [good.packages[0], { name: "@sidekickdb/core", file: ".core.tgz" }] };
  assert.throws(
    () => verifyArtifact(artifact([files[0], ".core.tgz"], dotfile), expect, ok),
    /bad tarball name/,
  );
});
