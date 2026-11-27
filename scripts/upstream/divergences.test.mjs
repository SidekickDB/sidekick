// Run with: node --test scripts/upstream/*.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  DIVERGENCES,
  DIVERGENCE_FILES,
  PR_CATEGORY,
  divergenceFiles,
  oldListMigration,
  parseDivergencePrs,
  readDivergencePrs,
} from "./divergences.mjs";

test("divergence-prs/ reads without problems", () => {
  const { entries, problems } = parseDivergencePrs(readDivergencePrs());
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

test("the loader skips dotfiles and rejects other names", () => {
  assert.deepEqual(
    divergenceFiles(["selfhost.mjs", ".DS_Store", ".brand.mjs.swp", "brand.mjs"]),
    ["brand.mjs", "selfhost.mjs"],
  );
  for (const bad of ["notes.txt", "Brand.mjs", "brand.mjs~", "brand.js"])
    assert.throws(() => divergenceFiles(["brand.mjs", bad]), /not <key>\.mjs/, bad);
});

test("every key in divergence-prs/ has a file in divergences/", () => {
  const { entries } = parseDivergencePrs(readDivergencePrs());
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

test("the reader reports bad names and contents, duplicates and unknown keys", () => {
  const files = [
    ["4", "selfhost\n"],
    [".DS_Store", "\0\0"],
    ["70", "<<<<<<< HEAD\nselfhost\n=======\nbrand\n>>>>>>> other\n"],
    ["071", "brand\n"],
    ["71", "brand"],
    ["72", "no-such-key\n"],
    ["73", "selfhost brand\n"],
    ["14", "dashboard\n"],
    ["1", "own-fixes own-fixes\n"],
    ["74", "selfhost,\n"],
    ["75.txt", "brand\n"],
    ["76", "\n"],
    ["77", null],
  ];
  const { entries, problems } = parseDivergencePrs(files);
  assert.deepEqual(problems, [
    'divergence-prs/70: not "<key>": "<<<<<<< HEAD\\nselfhost\\n=======\\nbrand\\n>>>>>>> other\\n"',
    "divergence-prs/71: PR 71 listed twice",
    "divergence-prs/72: unknown divergence key no-such-key",
    "divergence-prs/73: PR 73 needs an entry in SPLIT",
    "divergence-prs/14: PR 14 needs both keys, as it is in SPLIT",
    "divergence-prs/1: a key listed twice",
    'divergence-prs/74: not "<key>": "selfhost,\\n"',
    "divergence-prs/75.txt: not a PR number",
    'divergence-prs/76: not "<key>": "\\n"',
    "divergence-prs/77: a directory, not a file",
  ]);
  assert.deepEqual(
    entries.map((e) => e.pr),
    [1, 4, 14, 71, 71, 72, 73],
  );
});

test("readDivergencePrs gives a directory null content", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "divergence-prs-"));
  try {
    fs.writeFileSync(path.join(dir, "4"), "selfhost\n");
    fs.mkdirSync(path.join(dir, "5"));
    assert.deepEqual(
      readDivergencePrs(dir).sort(([a], [b]) => a.localeCompare(b)),
      [
        ["4", "selfhost\n"],
        ["5", null],
      ],
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test("the old list gets the commands that move its new lines", () => {
  const text = [
    "# <PR number> <divergence key>, one per line",
    "4 selfhost",
    "14 dashboard selfhost",
    "70 brand",
    "82 brand",
    "83 ci-lockdown",
  ].join("\n");
  const entries = [
    { pr: 4, keys: ["selfhost"] },
    { pr: 14, keys: ["dashboard", "selfhost"] },
    { pr: 70, keys: ["js-test-guard"] },
  ];
  const msg = oldListMigration(text, entries);
  assert.match(msg, /replaced by one file per PR in scripts\/upstream\/divergence-prs\//);
  const commands = msg.split("\n").filter((l) => l.startsWith("  "));
  assert.deepEqual(commands.slice(0, -1), [
    '  # PR 70: the old list says "brand", divergence-prs/70 says "js-test-guard": keep the right one',
    "  echo 'brand' > scripts/upstream/divergence-prs/82",
    "  git add scripts/upstream/divergence-prs/82",
    "  echo 'ci-lockdown' > scripts/upstream/divergence-prs/83",
    "  git add scripts/upstream/divergence-prs/83",
  ]);
  assert.match(commands.at(-1), /^ {2}git rm -f scripts\/upstream\/divergence-prs\.txt$/);
});
