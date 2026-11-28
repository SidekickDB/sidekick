// Synthetic results for summarize.mjs: the smoke table must never read
// "all passed" for a run whose smoke checks failed or did not complete.
// Run: node --test scripts/bench/self-hosted/summarize.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, summarizeModes, smokeSection } from './summarize.mjs';

const pass = () => ({
  ok: true,
  checks: {
    headers: { ok: true, ms: 5 },
    presence: { ok: true, ms: 60 },
    streams: { ok: true, ms: 100 },
    sse: { ok: true, ms: 200, visible_ms: [20, 30] },
  },
});

const crashed = (mode) => ({
  mode,
  ok: false,
  error: 'TypeError: createApp failed\n    at main (smoke.mjs:10)',
});

function results(modes, smokes) {
  return {
    environment: {
      commit: 'c0ffee',
      measured_at: '2026-11-24T00:00:00Z',
      runner: { cpus: 4, cpu_model: 'test CPU', mem_total_mib: 1, kernel: 'k' },
      docker: 'd',
      compose: 'c',
      node: 'n',
    },
    config: {
      modes,
      idle_seconds: 1,
      subscribers: 1,
      writes: 1,
      interval_ms: 1,
      settle_seconds: 1,
    },
    samples: smokes.map((smoke, i) => ({
      sample: i + 1,
      mode: modes[i % modes.length],
      smoke,
      cold_start: {},
      idle: {},
      workload: { missing_updates: 0 },
    })),
  };
}

const rowOf = (md, label) =>
  md.split('\n').find((l) => l.startsWith(`| ${label} |`));

test('a crashed smoke run counts as a failure in every check of its mode', () => {
  const md = summarizeModes(
    results(['default', 'self-hosted'], [
      pass(),
      pass(),
      crashed('default'),
      pass(),
    ]),
  );
  assert.match(
    rowOf(md, 'smoke.mjs completed'),
    /\| 1 of 2 completed \(TypeError: createApp failed at main \(smoke\.mjs:10\)\) \| 2 of 2 completed \|$/,
  );
  for (const c of ['headers', 'presence', 'streams', 'sse']) {
    assert.match(
      rowOf(md, c),
      /\| 1 of 2 passed, 1 did not run \| 2 of 2 passed \|$/,
      c,
    );
  }
  assert.match(
    md,
    /- \*\*Smoke:\*\* \*\*Smoke FAILED\*\* in 1 of 4 samples: #3 default: smoke\.mjs did not complete\./,
  );
  assert.doesNotMatch(md, /Smoke passed in all/);
});

test('a failed check is named, with its error', () => {
  const failed = pass();
  failed.ok = false;
  failed.checks.presence = { ok: false, ms: 20000, error: 'timed out' };
  const md = summarizeModes(
    results(['default', 'self-hosted'], [failed, pass()]),
  );
  assert.match(rowOf(md, 'presence'), /\| 0 of 1 passed \(timed out\) \| 1 of 1 passed \|$/);
  assert.match(md, /#1 default: presence\./);
});

test('a sample missing one check counts it as not run', () => {
  const partial = pass();
  delete partial.checks.sse;
  partial.ok = false;
  const lines = smokeSection([['`a`', [{ sample: 1, smoke: partial }, { sample: 2, smoke: pass() }]]]);
  assert.match(rowOf(lines.join('\n'), 'sse'), /\| 1 of 2 passed, 1 did not run \|$/);
});

test('all passing reads as passed', () => {
  const md = summarizeModes(results(['default', 'self-hosted'], [pass(), pass()]));
  assert.match(md, /- \*\*Smoke:\*\* Smoke passed in all 2 samples\./);
  assert.match(rowOf(md, 'presence'), /\| 1 of 1 passed \| 1 of 1 passed \|$/);
});

test('a single mode reports smoke results too', () => {
  const md = summarize(results(['self-hosted'], [pass(), crashed('self-hosted')]));
  assert.match(md, /### Smoke checks/);
  assert.match(rowOf(md, 'Check'), /\| `self-hosted` \|$/);
  assert.match(rowOf(md, 'smoke.mjs completed'), /\| 1 of 2 completed \(TypeError/);
  assert.match(rowOf(md, 'presence'), /\| 1 of 2 passed, 1 did not run \|$/);
  assert.match(md, /\*\*Smoke FAILED\*\* in 1 of 2 samples: #2 self-hosted: smoke\.mjs did not complete\./);
});

test('results without smoke data (older baselines) get no smoke section', () => {
  const r = results(['self-hosted'], [undefined]);
  delete r.samples[0].smoke;
  const md = summarize(r);
  assert.doesNotMatch(md, /Smoke/);
});

test('three modes get a stated verdict, not an empty cell', () => {
  const r = results(['a', 'b', 'c'], [pass(), pass(), pass()]);
  for (const s of r.samples) s.warm_restart_ms = 20000;
  const md = summarizeModes(r);
  assert.match(
    md,
    /\| Warm restart of the server to `GET \/` \| 20\.0 \(20\.0 to 20\.0\) \| 20\.0 \(20\.0 to 20\.0\) \| 20\.0 \(20\.0 to 20\.0\) \| not compared \(overlap rule needs two modes\) \|/,
  );
  assert.match(md, /Only the modes within this run are comparable with each other/);
});

test('the browser check counts only in the first sample of the run', () => {
  const first = pass();
  first.checks.browser = { ok: true, ms: 30000 };
  const md = summarizeModes(
    results(['default', 'self-hosted'], [first, pass(), pass(), pass()]),
  );
  assert.match(rowOf(md, 'browser'), /\| 1 of 1 passed \| first sample only \|$/);
  assert.match(md, /Smoke passed in all 4 samples\./);

  const failed = pass();
  failed.ok = false;
  failed.checks.browser = { ok: false, ms: 40000, error: 'sandbox editor: worker error' };
  const md2 = summarize(results(['self-hosted'], [failed, pass(), pass()]));
  assert.match(rowOf(md2, 'browser'), /\| 0 of 1 passed \(sandbox editor: worker error\) \|$/);
  assert.match(md2, /\*\*Smoke FAILED\*\* in 1 of 3 samples: #1 self-hosted: browser\./);
});
