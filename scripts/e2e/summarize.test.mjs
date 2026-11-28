import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarize } from "./summarize.mjs";

const script = fileURLToPath(new URL("./summarize.mjs", import.meta.url));

const report = (cases) =>
  `<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites name="vitest tests">\n<testsuite name="s">\n${cases}\n</testsuite>\n</testsuites>\n`;
const pass = '<testcase name="p"></testcase>';
const skip = '<testcase name="s"><skipped/></testcase>';
const fail = '<testcase name="f"><failure message="x"/></testcase>';

function withReports(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sk-e2e-summary-"));
  try {
    for (const [name, xml] of Object.entries(files))
      fs.writeFileSync(path.join(dir, `${name}.xml`), xml);
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const row = (md, suite) => md.split("\n").find((l) => l.startsWith(`| ${suite} |`));

test("a suite that ran at least its minimum and failed nothing passes", () => {
  withReports({ a: report([pass, pass, skip].join("\n")) }, (dir) => {
    const r = summarize({ dir, suites: [{ name: "a", min: 2 }] });
    assert.equal(r.ok, true);
    assert.match(row(r.md, "a"), /\| 2 \| 2 \| 0 \| 1 \| 2 \| passed \|$/);
  });
});

test("a failing test fails the run", () => {
  withReports({ a: report([pass, fail].join("\n")) }, (dir) => {
    const r = summarize({ dir, suites: [{ name: "a", min: 1 }] });
    assert.equal(r.ok, false);
    assert.match(row(r.md, "a"), /failed \|$/);
  });
});

test("running fewer tests than the minimum fails, also when some ran", () => {
  withReports({ a: report([pass, skip, skip].join("\n")) }, (dir) => {
    const r = summarize({ dir, suites: [{ name: "a", min: 3 }] });
    assert.equal(r.ok, false);
    assert.match(row(r.md, "a"), /ran fewer than 3 \|$/);
  });
});

test("a missing or truncated report fails", () => {
  const full = report([pass, pass].join("\n"));
  withReports(
    { cut: full.slice(0, full.indexOf("</testsuite>")), junk: "not xml\n" },
    (dir) => {
      const r = summarize({
        dir,
        suites: [
          { name: "cut", min: 1 },
          { name: "junk", min: 1 },
          { name: "missing", min: 1 },
        ],
      });
      assert.equal(r.ok, false);
      assert.match(row(r.md, "cut"), /report not well-formed \|$/);
      assert.match(row(r.md, "junk"), /report not well-formed \|$/);
      assert.match(row(r.md, "missing"), /no report \|$/);
    },
  );
});

test("notes are printed under the table and do not change the result", () => {
  withReports({ a: report(pass) }, (dir) => {
    const out = execFileSync(
      process.execPath,
      [script, "--dir", dir, "--note", "a=install stubbed (npm on PATH)", "a=1"],
      { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } },
    );
    assert.match(out, /\| a \| 1 \| 1 \| 0 \| 0 \| 1 \| passed \|/);
    assert.match(out, /Notes:\n\n- a: install stubbed \(npm on PATH\)\n/);
  });
});

test("a suite without a minimum is a usage error", () => {
  withReports({ a: report(pass) }, (dir) => {
    assert.throws(
      () =>
        execFileSync(process.execPath, [script, "--dir", dir, "a"], {
          stdio: "pipe",
        }),
      (e) => e.status === 2,
    );
  });
});
