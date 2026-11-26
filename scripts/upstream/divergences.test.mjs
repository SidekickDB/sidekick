// Run with: node --test scripts/upstream/*.test.mjs
// divergence-prs.txt is merged with merge=union (.gitattributes), which keeps
// both sides without asking. These tests catch what that can leave behind.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  DIVERGENCES,
  DIVERGENCE_FILES,
  DIVERGENCE_PRS_FILE,
  PR_CATEGORY,
  parseDivergencePrs,
} from "./divergences.mjs";

test("divergence-prs.txt reads without problems", () => {
  const { entries, problems } = parseDivergencePrs(
    fs.readFileSync(DIVERGENCE_PRS_FILE, "utf8"),
  );
  assert.deepEqual(problems, []);
  assert.ok(entries.length > 0);
});

test("every file in divergences/ is <key>.mjs with a title and a hint", async () => {
  assert.deepEqual(Object.keys(DIVERGENCES), DIVERGENCE_FILES.map((f) => f.slice(0, -4)));
  for (const f of DIVERGENCE_FILES) {
    assert.match(f, /^[a-z0-9-]+\.mjs$/);
    const { default: d } = await import(`./divergences/${f}`);
    assert.deepEqual(Object.keys(d).sort(), ["resolve", "title"], f);
    assert.ok(typeof d.title === "string" && d.title, `${f}: title`);
    assert.ok(typeof d.resolve === "string" && d.resolve, `${f}: resolve`);
  }
});

test("every key in divergence-prs.txt has a file in divergences/", () => {
  const { entries } = parseDivergencePrs(
    fs.readFileSync(DIVERGENCE_PRS_FILE, "utf8"),
  );
  for (const { pr, keys } of entries)
    for (const k of keys)
      assert.ok(
        DIVERGENCE_FILES.includes(`${k}.mjs`),
        `PR ${pr}: no divergences/${k}.mjs`,
      );
});

test("every PR_CATEGORY value is a divergence key or a split by path", () => {
  for (const [pr, c] of Object.entries(PR_CATEGORY)) {
    assert.ok(Number.isInteger(Number(pr)), `PR_CATEGORY key ${pr}`);
    if (typeof c === "function") {
      const keys = new Set(
        [".github/a", "self-hosting/a", "client/a"].map((f) => c(f)),
      );
      for (const k of keys) {
        assert.ok(DIVERGENCES[k], `PR ${pr} splits to unknown key ${k}`);
        assert.ok(DIVERGENCES[k].prs.includes(Number(pr)), `PR ${pr} in ${k}`);
      }
    } else {
      assert.ok(DIVERGENCES[c], `PR ${pr}: unknown key ${c}`);
    }
  }
});

test("every prs entry is a PR number listed once per divergence", () => {
  for (const [key, d] of Object.entries(DIVERGENCES)) {
    assert.ok(d.prs.length > 0, `${key} has no PR`);
    for (const pr of d.prs) {
      assert.ok(Number.isInteger(pr) && pr > 0, `${key}: ${pr}`);
      assert.ok(PR_CATEGORY[pr], `${key}: PR ${pr} not in PR_CATEGORY`);
    }
    assert.equal(new Set(d.prs).size, d.prs.length, `${key} lists a PR twice`);
  }
});

test("the reader reports conflict markers, duplicates and unknown keys", () => {
  const text = [
    "# comment",
    "4 selfhost",
    "<<<<<<< HEAD",
    "70 selfhost",
    "=======",
    "70 brand",
    ">>>>>>> other",
    "71 no-such-key",
    "72 selfhost brand",
    "73 selfhost,",
  ].join("\n");
  assert.deepEqual(parseDivergencePrs(text).problems, [
    'divergence-prs.txt:3: not "<number> <key>": <<<<<<< HEAD',
    'divergence-prs.txt:5: not "<number> <key>": =======',
    "divergence-prs.txt:6: PR 70 listed twice",
    'divergence-prs.txt:7: not "<number> <key>": >>>>>>> other',
    "divergence-prs.txt:8: unknown divergence key no-such-key",
    "divergence-prs.txt:9: PR 72 needs an entry in SPLIT",
    'divergence-prs.txt:10: not "<number> <key>": 73 selfhost,',
  ]);
});
