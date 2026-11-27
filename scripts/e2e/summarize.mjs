// Summary of the e2e suites run by .github/workflows/sidekick-e2e.yml.
//
//   node scripts/e2e/summarize.mjs --dir <junit dir> <suite>...
//
// Reads <dir>/<suite>.xml (vitest's JUnit reporter) for every suite named,
// prints a Markdown table (to $GITHUB_STEP_SUMMARY when set) and exits 1 if a
// suite left no report, had a failing test, or skipped all of its tests: a
// networked suite skips itself when SIDEKICK_E2E_API_URI does not reach it,
// and that must not pass as a green run.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values, positionals: suites } = parseArgs({
  options: { dir: { type: "string" } },
  allowPositionals: true,
});
if (!values.dir || suites.length === 0) {
  console.error("usage: summarize.mjs --dir <junit dir> <suite>...");
  process.exit(2);
}

const count = (xml, tag) =>
  (xml.match(new RegExp(`<${tag}\\b`, "g")) ?? []).length;

let ok = true;
const rows = suites.map((suite) => {
  const file = path.join(values.dir, `${suite}.xml`);
  if (!fs.existsSync(file)) {
    ok = false;
    return `| ${suite} | | | | | no report |`;
  }
  const xml = fs.readFileSync(file, "utf8");
  const tests = count(xml, "testcase");
  const skipped = count(xml, "skipped");
  const failed = count(xml, "failure") + count(xml, "error");
  const ran = tests - skipped;
  let result = "passed";
  if (failed > 0) result = "failed";
  else if (ran === 0) result = "nothing ran";
  if (result !== "passed") ok = false;
  return `| ${suite} | ${ran} | ${ran - failed} | ${failed} | ${skipped} | ${result} |`;
});

const md = [
  "## e2e suites against the local server",
  "",
  "| Suite | Ran | Passed | Failed | Skipped | Result |",
  "| --- | ---: | ---: | ---: | ---: | --- |",
  ...rows,
  "",
].join("\n");

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
console.log(md);
process.exit(ok ? 0 : 1);
