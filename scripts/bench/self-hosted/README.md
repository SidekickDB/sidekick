# Self-hosted stack benchmark

A repeatable baseline of the single-node stack in
`self-hosting/docker-compose.yml`, run on GitHub Actions by
`.github/workflows/sidekick-self-hosted-bench.yml`. It is the "before" for
changes to the self-hosted runtime (optimization plan item S1), so later
changes can be compared on the same runner type.

It builds images, starts and deletes containers and volumes. Run it on a
disposable machine, not a workstation with other Docker workloads.

## Running

On GitHub: **Actions → Self-hosted benchmark → Run workflow** (inputs: number
of samples, idle seconds). It also runs on a pull request that changes this
directory or the workflow. The job summary shows the table; the artifact has
`results.json`, `summary.md` and, for a failed sample, the compose logs.

Locally, on a disposable Linux machine with Docker, Node 24 and pnpm:

```sh
(cd client && pnpm i --frozen-lockfile && pnpm exec turbo run build --filter='@sidekickdb/core...')
node scripts/bench/self-hosted/run.mjs --samples 5 --out bench-out
```

`--skip-build` reuses the `sidekick-bench/server:local` and
`sidekick-bench/dashboard:local` images.

## What a run does

1. Builds the server (`server/Dockerfile.self-hosted`) and dashboard
   (`client/Dockerfile.www`) images from the checked-out commit, once.
2. Writes an env file from `self-hosting/.env.example` with generated secrets
   and the two local image tags. It lives in a temp directory and is deleted
   at the end.
3. Uses `self-hosting/docker-compose.yml` unchanged, plus `compose.bench.yml`,
   which only publishes the server on `127.0.0.1:8888`.
4. Per sample (at least 3, default 5):
   - `down -v`, then `up -d` on fresh volumes, and polls every 250 ms:
     server `GET /` (the compose healthcheck target), `/health/system` WAL ok,
     compose health of server and dashboard; plus the bootstrap JVM's share
     (container start to `Starting server...` in the log);
   - waits `--idle-seconds` (default 120), then records per-service memory
     (`docker stats`, median of 3 readings 2 s apart), and for the server JVM
     (PID 1 in its container) RSS, peak RSS, swap and threads from
     `/proc/1/status`, and heap and metaspace from `jcmd 1 GC.heap_info`;
   - runs `workload.mjs`: an ephemeral app, 5 subscriber sessions and 1
     writer session with `@sidekickdb/core` over WebSocket, 100 writes 100 ms
     apart; per write and subscriber, the time from `transact()` to the first
     query callback that contains it (client-visible update), and the time to
     `transact-ok`. The first 10 writes are warm-up. A missed update fails the
     sample;
   - waits 30 s and records memory again;
   - restarts the server container and times it back to `GET /`.
5. Writes `results.json` (every sample, environment, image sizes, build
   times) and `summary.md` (median, min, max and count per metric).

## What it does not measure

- Throughput or capacity. One small workload on one runner; it says nothing
  about how many users a host can serve.
- Many apps, large apps, large frames, deep permissions, bulk writes,
  pagination, presence, streams, files, backups, sync tables, webhooks,
  offline clients or SSE. Only WebSocket live queries and single writes.
- PostgreSQL internals (WAL bytes, slot lag, query plans, walsender memory),
  GC pauses, native memory breakdown (NMT is off), CPU time, disk I/O.
- Client main-thread cost or bundle size.
- Multi-node behaviour.
- `docker-compose.with-caddy.yml`, `swarm.yml` or external S3/Postgres.
- The time to pull base images and the image build times are recorded once
  per run and only for information: they depend on network and cache.

GitHub-hosted runners are shared VMs. Compare runs on the same runner label
and look at the spread, not single values.

## Results

Kept baselines are in `results/`, one Markdown and one JSON file per run,
named after the date and the commit measured.
