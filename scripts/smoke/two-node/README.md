# Two-node smoke test

`self-hosting/swarm.yml` runs the server with `replicas: 2`. This test boots
two server nodes against one Postgres and checks that they work as one
cluster:

- **write-a-to-b**: a client on node B subscribes to a query, a client on
  node A writes, and B sees the write. A subscriber on A watches the same
  query, so a failure shows whether the write reached its own node.
- **write-b-to-a**: the same in the other direction.
- **presence**: a client on A and a client on B join one room and each sees
  the other (Hazelcast's shared rooms map, port 5701).

Only presence needs the nodes to form a cluster. Each node invalidates its
live queries from its own Postgres replication slot
(`invalidator_<process-id>`), so the write checks pass even when the nodes do
not find each other: with `SWARM_SERVICE_NAME` removed, both write checks
passed and presence failed. The singleton invalidator, which holds one shared
slot and forwards WAL records to the other nodes over gRPC (port 5801), has
no effect a client can see, so this test does not check it.

It runs on GitHub Actions in `.github/workflows/sidekick-two-node-smoke.yml`.

It builds an image, starts and deletes containers and volumes. Run it on a
disposable machine, not a workstation with other Docker workloads.

## Running

On GitHub: **Actions → Two-node smoke test → Run workflow**. The `restart`
input also restarts node A after the first pass and runs the checks again.
It also runs on pull requests that change `self-hosting/`, the server's
clustering code (`server/src/instant/reactive/ephemeral.clj`,
`reactive/invalidator.clj`, `util/hazelcast.clj`, `grpc*.clj`, `config.clj`),
`server/deps.edn` (Hazelcast and gRPC versions), the self-hosted Dockerfile,
the shared client helper
(`scripts/bench/self-hosted/client.mjs`), this directory or the workflow. The job summary
shows the result; the artifact has `result.json` and every container's log.

Locally, with Docker, Node 24 and pnpm:

```sh
(cd client && pnpm i --frozen-lockfile && pnpm exec turbo run build --filter='@sidekickdb/core...')
node scripts/smoke/two-node/run.mjs --out two-node-out [--restart]
```

`--skip-build` reuses the `sidekick-smoke/server:local` image. The nodes are
published on `127.0.0.1:8881` and `127.0.0.1:8882`, and the shipped compose
file publishes Postgres on `127.0.0.1:8890`; those ports must be free.

## How the nodes find each other

`run.mjs` uses `self-hosting/docker-compose.yml` unchanged, plus
`compose.two-node.yml`, which changes only the `server` service:

- `deploy.replicas: 2`, as in `swarm.yml`;
- `SWARM_SERVICE_NAME=server`, as in `swarm.yml`. This selects the swarm
  branch of `init-hz` in `server/src/instant/reactive/ephemeral.clj`: it
  resolves `tasks.server`, gives Hazelcast every address it gets as a TCP/IP
  member on port 5701, and uses its own address among them as its public
  address. gRPC between nodes goes to that address on port 5801;
- the network alias `tasks.server` on both containers. Swarm's DNS answers
  `tasks.server` with every replica's address; Docker's embedded DNS answers
  a shared alias the same way;
- one `override.edn`, generated once with `start.sh generate-override-config`
  and mounted read-only into both nodes, where `swarm.yml` mounts the
  `server_config` secret. The shared `server_config` volume of the compose
  file is not used;
- one loopback port per node, so each client talks to one node.

So discovery, membership and presence run the same code path as in a swarm
deployment: the same server image, environment, startup script and ports.

## What is not the same as `swarm.yml`

- Not a swarm: no swarm mode, no overlay network, no routing mesh, no
  `docker stack deploy`, no swarm secret. Both nodes run on one Docker host
  on one bridge network. Problems that only appear across hosts (overlay MTU,
  firewalls between hosts, the `docker_gwbridge` interface that
  `get-swarm-ip` has to skip) are not covered.
- No Caddy in front: clients connect to a node directly, so the load
  balancer's behaviour (sticky sessions, WebSocket upgrades, health-based
  routing) is not tested.
- No restart policy: Compose starts each node once. In swarm a crashed
  replica is restarted. A node that exits makes the test fail.
- Swarm restarts and reschedules replicas on its own; here only `--restart`
  restarts node A, once, with `docker restart` (same address).
- Two nodes only, one Postgres, one runner. It says nothing about load,
  failover of Postgres or more than two nodes.
- Not covered: the gRPC forwarding of the singleton invalidator (see above),
  streams, SSE, files, the dashboard, rate limits shared across nodes.
