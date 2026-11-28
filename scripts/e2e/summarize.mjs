// Summary of the e2e suites run by .github/workflows/sidekick-e2e.yml.
//
//   node scripts/e2e/summarize.mjs --dir <junit dir> [--note <suite>=<text>]...
//     <suite>=<minimum ran>...
//
// Reads <dir>/<suite>.xml (vitest's JUnit reporter) for every suite named,
// prints a Markdown table (to $GITHUB_STEP_SUMMARY when set) with the notes
// under it, and exits 1 if a suite left no report or one that is not
// well-formed, had a failing test, or ran fewer tests than its minimum: a
// networked suite skips itself when SIDEKICK_E2E_API_URI does not reach it,
// and that must not pass as a green run.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const count = (xml, tag) =>
  (xml.match(new RegExp(`<${tag}\\b`, "g")) ?? []).length;

// A whole vitest JUnit report: an XML declaration or <testsuites> first, and
// the closing </testsuites> last.
const wellFormed = (xml) =>
  /^\s*(?:<\?xml[^>]*\?>\s*)?<testsuites\b/.test(xml) &&
  /<\/testsuites>\s*$/.test(xml);

export function summarize({ dir, suites, notes = {} }) {
  let ok = true;
  const rows = suites.map(({ name, min }) => {
    const file = path.join(dir, `${name}.xml`);
    if (!fs.existsSync(file)) {
      ok = false;
      return `| ${name} | | | | | ${min} | no report |`;
    }
    const xml = fs.readFileSync(file, "utf8");
    if (!wellFormed(xml)) {
      ok = false;
      return `| ${name} | | | | | ${min} | report not well-formed |`;
    }
    const tests = count(xml, "testcase");
    const skipped = count(xml, "skipped");
    const failed = count(xml, "failure") + count(xml, "error");
    const ran = tests - skipped;
    let result = "passed";
    if (failed > 0) result = "failed";
    else if (ran < min) result = `ran fewer than ${min}`;
    if (result !== "passed") ok = false;
    return `| ${name} | ${ran} | ${ran - failed} | ${failed} | ${skipped} | ${min} | ${result} |`;
  });
  const noteLines = Object.entries(notes).map(([s, t]) => `- ${s}: ${t}`);
  const md = [
    "## e2e suites against the local server",
    "",
    "| Suite | Ran | Passed | Failed | Skipped | Minimum | Result |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows,
    "",
    ...(noteLines.length ? ["Notes:", "", ...noteLines, ""] : []),
  ].join("\n");
  return { ok, md };
}

function splitPair(arg, what) {
  const i = arg.indexOf("=");
  if (i <= 0) throw new Error(`expected ${what}, found ${arg}`);
  return [arg.slice(0, i), arg.slice(i + 1)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    options: {
      dir: { type: "string" },
      note: { type: "string", multiple: true, default: [] },
    },
    allowPositionals: true,
  });
  let suites, notes;
  try {
    suites = positionals.map((p) => {
      const [name, min] = splitPair(p, "<suite>=<minimum ran>");
      if (!/^\d+$/.test(min)) throw new Error(`bad minimum in ${p}`);
      return { name, min: Number(min) };
    });
    notes = Object.fromEntries(
      values.note.map((n) => splitPair(n, "<suite>=<text>")),
    );
  } catch (e) {
    console.error(e.message);
    suites = [];
  }
  if (!values.dir || suites.length === 0) {
    console.error(
      "usage: summarize.mjs --dir <junit dir> [--note <suite>=<text>]... <suite>=<minimum ran>...",
    );
    process.exit(2);
  }
  const { ok, md } = summarize({ dir: values.dir, suites, notes });
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }
  console.log(md);
  process.exit(ok ? 0 : 1);
}
