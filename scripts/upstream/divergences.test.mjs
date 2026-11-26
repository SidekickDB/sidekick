// Run with: node --test scripts/upstream/*.test.mjs
// divergences.mjs is merged with merge=union (.gitattributes), which keeps
// both sides without asking. These tests catch what that can leave behind.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const file = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "divergences.mjs",
);

function problems(src) {
  const out = [];
  for (const m of src.matchAll(/^(<{7}|={7}|>{7}|\|{7})( |$)/gm))
    out.push(`conflict marker ${m[1]}`);
  const body = src.match(/^const PR_CATEGORY = \{\n([\s\S]*?)^\};/m);
  if (!body) return [...out, "PR_CATEGORY not found"];
  const seen = new Set();
  for (const m of body[1].matchAll(/^ {2}(\d+):/gm)) {
    if (seen.has(m[1])) out.push(`duplicate PR_CATEGORY key ${m[1]}`);
    seen.add(m[1]);
  }
  return out;
}

test("divergences.mjs has no conflict marker and no duplicate PR_CATEGORY key", () => {
  assert.deepEqual(problems(fs.readFileSync(file, "utf8")), []);
});

test("the check finds conflict markers and duplicate keys", () => {
  const src = [
    "const PR_CATEGORY = {",
    '  1: "a",',
    "<<<<<<< HEAD",
    '  2: "b",',
    "=======",
    '  2: "c",',
    ">>>>>>> other",
    "};",
  ].join("\n");
  assert.deepEqual(problems(src), [
    "conflict marker <<<<<<<",
    "conflict marker =======",
    "conflict marker >>>>>>>",
    "duplicate PR_CATEGORY key 2",
  ]);
});
