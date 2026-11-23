# Presence smoke failure in the first two-mode run (commit 45e4cccb)

Not a baseline: this records a failure the smoke checks found, its evidence
and the fix. No numbers from this run are kept as a baseline, because the run
failed.

- **Run:** [45239761906](https://github.com/SidekickDB/sidekick/actions/runs/45239761906),
  commit `45e4cccb8518b35525fb5b7110da0ece07342b59` (PR #23), 2026-11-23
- **Runner:** ubuntu-24.04, AMD EPYC 9V74, 2 vCPU, Docker 28.0.4,
  Compose 2.38.2
- **Samples:** 6, alternating `default` and `self-hosted`, 3 each

## What failed

24 smoke checks ran (headers, presence, streams and SSE in each of the 6
samples). 23 passed. One failed: presence in sample 5 (`default` mode),
`timed out after 20000 ms: both peers see each other`. Presence passed in the
other 5 samples, in 85 to 138 ms. The workload had 0 missed updates in every
sample, so start-up, memory, workload and init-step values were measured, but
the run as a whole failed.

## Evidence

From `logs-sample-5-smoke.txt` in the run's artifact: the two smoke sessions
joined the room and set presence within the same millisecond, and the server
handled a `:refresh-presence` for each session with `combined=2` (two queued
events merged into one):

```
19:10:31.597500  session_id=6b048fa7-07a8-…  combined=1  op=:refresh-presence
19:10:31.597519  session_id=6b048fa7-59ba-…  combined=2  op=:refresh-presence
19:10:31.597526  session_id=6b048fa7-07a8-…  combined=2  op=:refresh-presence
```

After that, neither session saw the other for the 20 s the check waits.

## Cause and fix

A server bug present in both runtime modes, not in the harness and not
specific to `default`: `handle-refresh-presence` sends a full snapshot of the
room when the event's `:edits` is nil (a session that just joined) and a patch
otherwise. When two refresh-presence events were queued for one session,
`combine` kept the second and concatenated the edits, so a snapshot followed
by a patch became a patch alone. The session never got the snapshot, so it
never learned about the peers already in the room.

Fixed in PR #24 (merged as `abbe7cfb`, fix commit `280031a6`): `combine` keeps
a patch only when both events are patches and otherwise sends a snapshot of
the latest room data. Unit test `combine-refresh-presence` in
`server/test/instant/reactive/session_test.clj` covers the four combinations.

The race needs the two events to queue before the session handles the first,
so it shows up rarely; one run of 6 samples cannot show it is gone. The smoke
check stays in every run and would catch it again.
