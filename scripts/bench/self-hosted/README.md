# Self-hosted stack benchmark

A repeatable baseline of the single-node stack in
`self-hosting/docker-compose.yml`, run on GitHub Actions by
`.github/workflows/sidekick-self-hosted-bench.yml`. It is the "before" for
changes to the self-hosted runtime (optimization plan item S1), so later
changes can be compared on the same runner type.

It builds images, starts and deletes containers and volumes. Run it on a
disposable machine, not a workstation with other Docker workloads.

## Running

On GitHub: **Actions → Self-hosted benchmark → Run workflow** (inputs:
samples per runtime mode, the modes to compare, idle seconds). By default it
compares the `default` and `self-hosted` runtime modes, 3 samples each,
alternating in one job. It also runs on a pull request that changes this
directory or the workflow, on every push to it; a pull request that changes
only `results/` does not start it. A pull request run only checks that the
harness works: `self-hosted` mode alone, 20 idle seconds, and images built
by the workflow instead of by the harness (the server one with the release
workflow's layer cache), so there are no build times.
Do not keep its numbers as a baseline. The job summary shows the table; the artifact has
`results.json`, `summary.md` and, for a failed sample, the compose logs.

Locally, on a disposable Linux machine with Docker, Node 24 and pnpm:

```sh
(cd client && pnpm i --frozen-lockfile && pnpm exec turbo run build --filter='@sidekickdb/core...')
node scripts/bench/self-hosted/run.mjs --samples 3 --modes default,self-hosted --out bench-out \
  --browser-image mcr.microsoft.com/playwright:v1.58.2-noble
```

`--skip-build` reuses the `sidekick-bench/server:local` and
`sidekick-bench/dashboard:local` images. `--browser-image` names the
Playwright image for the browser check, at the playwright version in
`client/pnpm-lock.yaml`; without it the check is left out.

## What a run does

1. Builds the server (`server/Dockerfile.self-hosted`) and dashboard
   (`client/Dockerfile.www`) images from the checked-out commit, once.
2. Writes an env file from `self-hosting/.env.example` with generated secrets
   and the two local image tags. It lives in a temp directory and is deleted
   at the end. It then checks the file with `docker compose config`. If Compose
   rejects it, the run also sets `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` to
   the same values and records that deviation in the results (seen with
   Compose 2.38.2, which evaluated the inner `:?` of
   `${STORAGE_ACCESS_KEY:-${MINIO_ROOT_USER:?...}}` although
   `STORAGE_ACCESS_KEY` was set).
3. Uses `self-hosting/docker-compose.yml` unchanged, plus `compose.bench.yml`,
   which only publishes the server on `127.0.0.1:8888`, the dashboard on
   `127.0.0.1:3000` and the storage API on `127.0.0.1:9000` (the
   `S3_PUBLIC_ENDPOINT` file URLs are presigned for).
   Only postgres, storage and createbuckets are pulled; `up` runs with
   `--pull never`, and each sample checks that the server and dashboard
   containers run the image IDs built in step 1 (their local tags would
   otherwise resolve to Docker Hub).
4. Per sample (at least 3 per mode; with several `--modes` the samples
   alternate, each with `SIDEKICK_RUNTIME_MODE` set in its env file):
   - `down -v`, then `up -d` on fresh volumes, and polls every 250 ms:
     server `GET /` (the compose healthcheck target), `/health/system` WAL ok,
     compose health of server and dashboard; plus the bootstrap JVM's share
     (container start to `Starting server...` in the log);
   - waits `--idle-seconds` (default 120), then records per-service memory
     (`docker stats`, median of 3 readings 2 s apart), and for the server JVM
     (PID 1 in its container) RSS, peak RSS, swap and threads from
     `/proc/1/status`, and heap reserved, committed and used from
     `jcmd 1 GC.heap_info` (its raw output is kept in `results.json`);
   - runs `workload.mjs`: an ephemeral app, 5 subscriber sessions and 1
     writer session with `@sidekickdb/core` over WebSocket, 100 writes 100 ms
     apart; per write and subscriber, the time from `transact()` to the first
     query callback that contains it (client-visible update), and the time to
     `transact-ok`. The first 10 writes are warm-up. A missed update fails the
     sample;
   - waits 30 s and records memory again;
   - runs `smoke.mjs` for the paths the runtime mode changes: the dev
     response header (`X-Instant-Server-Hostname` on `GET /`, expected only in
     `default`), presence (two sessions see each other in a room), streams
     (one session writes, another reads it back) and SSE (a session whose
     WebSocket cannot connect falls back to SSE, which needs Node's
     `--experimental-eventsource`, and receives writes made over WebSocket);
     and three paths a self-hoster uses first: dashboard login (no email
     provider is set, so the one-time code is read from the server log),
     file upload (a session uploads a file and downloads the same bytes from
     its presigned URL) and an on-demand backup (the signed-in user creates
     an app, writes to it, backs it up, waits for the job and checks that the
     backup holds `config.json` and a non-empty `entities/items.jsonl`, the
     entity type it wrote);
   - in the first sample of the run only, with `--browser-image`, the
     `browser` smoke check (`browser.mjs`): Chromium from that image (a
     `playwright run-server` container on the host network) opens
     `http://localhost:3000/dash`, signs in with the code from the server
     log, opens a new app in the dashboard and its Sandbox tab, and checks
     that the code editor's TypeScript worker starts and returns quick info
     for `db`, that its JSON worker starts, and that no console message says
     a worker failed to load. Then it opens `/_devtool?appId=<id>` and waits
     for the app's explorer. It records the host of every request and
     WebSocket and fails on any host other than `localhost:3000` and
     `localhost:8888`. The job log shows the quick info, the worker scripts
     and the hosts; a failure saves `browser-sample-1.png` to the artifact;
   - from the server log of the cold start: the phases container start,
     `Starting server...`, first init step and `Finished initializing`, the
     duration of every `init.finish.<step>` span, and the `init.skip.<step>`
     lines;
   - restarts the server container and times it back to `GET /`.
5. Writes `results.json` (every sample, environment, image sizes, build
   times) and `summary.md` (median, min, max and count per metric; with
   several modes, side by side, and a difference counts only when the ranges
   do not overlap). The smoke table counts every sample: one whose
   `smoke.mjs` did not complete, or that lacks a check, counts as a failure
   of that check, and the header names every failed sample.
   `summarize.test.mjs` checks this on synthetic results; the workflow runs
   it before the benchmark.

## What it does not measure

- Throughput or capacity. One small workload on one runner; it says nothing
  about how many users a host can serve.
- Many apps, large apps, large frames, deep permissions, bulk writes,
  pagination, presence, streams, files, backups, sync tables, webhooks,
  offline clients or SSE. Only WebSocket live queries and single writes are
  timed; the smoke checks only confirm that presence, streams, SSE, login,
  a file upload, a backup and the dashboard in a browser work.
- PostgreSQL internals (WAL bytes, slot lag, query plans, walsender memory),
  GC pauses, metaspace (JDK 26's `GC.heap_info` no longer prints it), native
  memory breakdown (NMT is off), CPU time, disk I/O.
- Client main-thread cost or bundle size.
- Multi-node behaviour.
- `docker-compose.with-caddy.yml`, `swarm.yml` or external S3/Postgres.
- The time to pull base images and the image build times are recorded once
  per run and only for information: they depend on network and cache.

GitHub-hosted runners are shared VMs, and one label can land on different
CPU models: two runs of `ubuntu-24.04` an hour apart got an AMD EPYC 7763 and
an EPYC 9V45. Every result records the CPU model. Compare runs on the same
label and CPU model, and look at the spread, not single values.

## Results

Kept baselines are in `results/`, one Markdown and one JSON file per run,
named after the date and the commit measured. A Markdown file alone with a
suffix (such as `2026-11-23-45e4cccb-presence-failure.md`) records a failure
a run found, with its evidence and fix, rather than a baseline.
