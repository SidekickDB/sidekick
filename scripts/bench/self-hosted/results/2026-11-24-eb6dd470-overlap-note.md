# Reading the "no overlap" rows of the runtime-mode comparison

A note on `2026-11-24-eb6dd470.md` and `.json`, which are the unchanged
output of run
[45263046836](https://github.com/SidekickDB/sidekick/actions/runs/45263046836).
It covers what those rows mean with 3 samples per mode. It is not a baseline.

## The chance rate

The summary marks a metric **no overlap** when the min-to-max ranges of the
two modes do not overlap. With 3 samples per mode, that happens by chance
alone even when both modes behave the same. If all 6 values come from one
distribution, each of the 20 ways to split them into two sets of 3 is
equally likely, and in 2 of the 20 the sets do not overlap (all three of one
below all three of the other). So about 1 metric in 10 is marked no overlap
by chance. With 27 metrics, two or three such rows per run are expected when
the modes do not differ at all. The metrics are not independent, so the
number per run varies more than that.

## Two runs on the same hardware

Both runs used `ubuntu-24.04` runners with an Intel Xeon 6975P-C, 4 vCPU, the
same images per run, and the same measurement code. Between them only the
summary formatting changed.

| Run | Head | Metrics outside the overlap (lower in) |
|---|---|---|
| [45255714706](https://github.com/SidekickDB/sidekick/actions/runs/45255714706) | `aa3c947b` | Warm restart to `GET /`, 0.3 s (`self-hosted`); idle server JVM threads, 2 (`self-hosted`) |
| [45263046836](https://github.com/SidekickDB/sidekick/actions/runs/45263046836) | `eb6dd470` | Compose: server healthy, 0.2 s (`self-hosted`); initial results for every subscriber, 50 ms (`self-hosted`); pipelined client-visible update p95, 6.6 ms (`default`); sequential client-visible update p50, 1.4 ms (`default`); sequential transact-ok p50, 1.3 ms (`default`) |

None of these metrics is outside the overlap in both runs. Each one that is
outside in one run overlaps in the other, and the directions are mixed. That
is 2 and 5 rows, against about 2.7 expected by chance. An earlier run of the
same comparison on different hardware
([45239761906](https://github.com/SidekickDB/sidekick/actions/runs/45239761906),
AMD EPYC 9V74, 2 vCPU; see `2026-11-23-45e4cccb-presence-failure.md`) had
none of 27 outside the overlap.

So these runs show no measurable difference between `default` and
`self-hosted` in start-up, memory or workload latency. The difference they
do show every time is in the init-step table: `self-hosted` skips `nrepl`,
`sunset`, `app-proxy`, `join-room-logger` and `hint-testing` in every sample.
The smoke checks pass in both modes.

## Rule for later comparisons

A "no overlap" row in one run is not an effect by itself. A difference
between modes counts only if:

- it shows in the same direction in two runs on the same runner label and
  CPU model, or
- it shows in one run with more samples per mode (the workflow's `samples`
  input), where a chance non-overlap is much rarer: about 1 in 35 metrics
  with 4 per mode, about 1 in 126 with 5.

Compare runs only on the same hardware; the CPU model is in each summary's
header.
