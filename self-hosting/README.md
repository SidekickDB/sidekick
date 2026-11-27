<!-- SidekickDB: title and docs link point at this repository, not at instantdb.com. -->

# Self-hosting SidekickDB

The self-hosting guides are in this repository: [overview](../client/www/app/docs/self-hosting/page.md), [VPS](../client/www/app/docs/self-hosting/vps/page.md), [AWS](../client/www/app/docs/self-hosting/aws/page.md) and [migrating](../client/www/app/docs/self-hosting/migrate/page.md). Where a guide and this file disagree, this file is right for SidekickDB: the guides are inherited and still name upstream's images in places.

See [UPGRADE_DB.md](UPGRADE_DB.md) for instructions on upgrading existing backends from postgres 16 to 17.

## Variable names

Settings are named `SIDEKICK_*`, for example `SIDEKICK_BACKEND_URL`. Each one
can also be set under its older `INSTANT_*` name (`INSTANT_BACKEND_URL`), so an
existing `.env` keeps working. When both are set, the `SIDEKICK_*` value wins;
an empty `SIDEKICK_*` value counts as unset.

- `docker-compose.yml`, `docker-compose.with-caddy.yml` and
  `docker-compose.local.yml` accept both names from `.env`, with any server
  image.
- `deploy-swarm.sh` accepts both names from the environment. `swarm.yml` itself
  reads only the `INSTANT_*` names, because `docker stack` cannot fall back from
  one variable to another; deploy with the script, or set the `INSTANT_*` names
  when you run `docker stack deploy` yourself.
- A server started without these files reads both names too, including
  `SIDEKICK_CONFIG_*` for the `INSTANT_CONFIG_*` overrides of the config file.

Variables without the prefix (`POSTGRES_PASSWORD`, `STORAGE_*`, `S3_*`,
`JAVA_OPTS` and the others) have one name.

## Required secrets

`docker-compose.yml`, `docker-compose.with-caddy.yml` and `swarm.yml` have no
default credentials. They refuse to start, naming the missing variable, until
these are set in `.env` (or in the environment for `swarm.yml`):

| Variable | Used for | Generate with |
|---|---|---|
| `POSTGRES_PASSWORD` | Postgres superuser, and the server's `DATABASE_URL` | `openssl rand -hex 32` |
| `STORAGE_ACCESS_KEY` | RustFS access key, and the server's S3 access key ID | `openssl rand -hex 16` |
| `STORAGE_SECRET_KEY` | RustFS secret key, and the server's S3 secret key | `openssl rand -hex 32` |

```sh
cp .env.example .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)" >> .env
echo "STORAGE_ACCESS_KEY=$(openssl rand -hex 16)" >> .env
echo "STORAGE_SECRET_KEY=$(openssl rand -hex 32)" >> .env
```

Generate them once and keep them. Postgres and RustFS store the first values
they start with in their volumes, so changing them later locks the server out.
Hex values are safe inside `DATABASE_URL`; a password you choose yourself must
not contain URL characters such as `@ : / ?`. When using AWS S3, set the two
storage variables to your AWS access key ID and secret access key.

`deploy-swarm.sh` reads the same variables, plus `SSH_HOST`, `DASHBOARD_URL`,
`SERVER_URL` and `S3_PUBLIC_ENDPOINT`, from the environment and stops if one is
missing. It does not generate secrets, because a new value on every deploy
would not match the existing volumes. It passes every other variable
`swarm.yml` reads (email, S3, Postgres user and database, images and the
rest) from the environment too, and nothing else.

### The server_config secret (swarm)

`swarm.yml` also needs the Docker secret `server_config`. It is mounted as the
server's `/app/resources/config/override.edn` and holds the keys that encrypt
app secrets and sign webhooks, so every server replica must get the same file.
`docker stack deploy` refuses the stack while the secret is missing, and
`deploy-swarm.sh` stops with these commands instead of deploying. Create it
once, on the swarm manager:

```sh
mkdir -m 700 sidekick-config
docker run --rm -v "$PWD/sidekick-config:/out" ghcr.io/sidekickdb/server:latest \
  /app/start.sh generate-override-config /out/override.edn
docker secret create server_config sidekick-config/override.edn
```

Use your `SERVER_IMAGE` if you set one. Copy `sidekick-config/override.edn`
somewhere safe with your other secrets, then delete it from the manager.
Generate it once and keep it: a new file cannot decrypt what the old one
encrypted, so never regenerate or replace the secret of a running deployment.
`deploy-swarm.sh` never creates, replaces or removes it.

### Upgrading an existing deployment

- Keep the values your volumes were created with. Postgres reads
  `POSTGRES_PASSWORD` only when it initializes an empty data volume, so a
  newly generated password does not match an existing database and the server
  fails with `password authentication failed`. If you never set these
  variables, the old compose files used `pass` for Postgres and `rustfsadmin`
  for both storage keys: put those values in `.env` first so the stack starts,
  then rotate.
- To rotate the Postgres password, change it in Postgres first
  (`ALTER USER ... PASSWORD ...`), then set the same value in `.env` and
  recreate the server.
- An `.env` copied from an older `.env.example` may still hold the
  placeholders `pleasegenerateapasswordhere` and `pleasegenerateauserhere`.
  They are not blank, so the compose files accept them. Replace them.
- The storage keys must be named `STORAGE_ACCESS_KEY` and
  `STORAGE_SECRET_KEY`. The old names `MINIO_ROOT_USER` and
  `MINIO_ROOT_PASSWORD` are no longer read, and an `.env` that only has them
  is refused with a message asking to rename them. See
  [Renaming the storage keys](#renaming-the-storage-keys).
- The server now runs in the self-hosted runtime mode by default. See
  [Runtime mode](#runtime-mode) for what changes and how to switch it off.
- The server container now has a memory limit (`SERVER_MEMORY_LIMIT`, default
  `2g`) and the heap is 60% of it. Before, there was no limit and the heap
  could grow to a quarter of the host's memory. On a host with more than about
  5 GB of memory the new default is a smaller heap than you had: raise
  `SERVER_MEMORY_LIMIT` to keep it. See [Server memory](#server-memory).
- Postgres is no longer reachable from other machines. `docker-compose.yml`
  publishes port 8890 on `127.0.0.1` only, and `swarm.yml` does not publish it.
  See [Postgres port](#postgres-port) if a tool on another machine connects to
  it.

### Renaming the storage keys

`MINIO_ROOT_USER` is now `STORAGE_ACCESS_KEY`, and `MINIO_ROOT_PASSWORD` is now
`STORAGE_SECRET_KEY`. Keep the values: they are the credentials your storage
volume was created with. In the directory with your `.env`, run:

```sh
sh -c '
set -e
[ -e .env.before-storage-rename ] || cp -p .env .env.before-storage-rename
rename() {
  if grep -q "^$1=." .env && ! grep -q "^$2=." .env; then
    sed -e "/^$2=\$/d" -e "s/^$1=/$2=/" .env > .env.rename-tmp
    cat .env.rename-tmp > .env
    rm .env.rename-tmp
  fi
}
rename MINIO_ROOT_USER STORAGE_ACCESS_KEY
rename MINIO_ROOT_PASSWORD STORAGE_SECRET_KEY
'
```

It runs under `sh` whatever your shell is (zsh, bash, sh, dash). For each
pair, it renames the old line only when the old name has a value and the new
name has none, and removes an empty line for the new name first, so `.env`
ends up with one line per key. Before the first change it copies `.env` to
`.env.before-storage-rename`, and it never overwrites that copy. Running it
again changes nothing. `.env` keeps its permissions. Check the result with
`docker compose config --quiet`.

It only matches lines that start with the variable name, as `.env.example`
writes them. A line written as `export MINIO_ROOT_USER=...` or with leading
spaces is not renamed; edit such lines by hand.

The compose files used to fall back to the old names with a nested default,
`${STORAGE_ACCESS_KEY:-${MINIO_ROOT_USER:?...}}`. Compose 2.38 evaluates the
inner `:?` even when `STORAGE_ACCESS_KEY` is set, so those files did not start
on it at all. Each key is now read with a plain `${STORAGE_ACCESS_KEY:?...}`.

## Images

The compose files and `swarm.yml` pull SidekickDB's images from
`ghcr.io/sidekickdb`: `server` and `dashboard` (tag `latest`) and `postgresql`
(Postgres 17 with `pg_hint_plan` and `wal2json`). They are public, so no login
is needed. To stay on one release, set a version tag in `.env`:

```
SERVER_IMAGE=ghcr.io/sidekickdb/server:v2.0.0
DASHBOARD_IMAGE=ghcr.io/sidekickdb/dashboard:v2.0.0
```

Each image has the licence in `/licenses/`.

## Local development

`docker-compose.local.yml` is for local development only. It builds the server
and dashboard from source, binds every port to `127.0.0.1`, and falls back to
the well-known credentials `pass` (Postgres) and `rustfsadmin` (storage) when
`.env` does not set them. Do not use it for a deployment.

## Postgres port

Docker-published ports bypass host firewalls such as ufw, so a port published
on all interfaces is open to the internet on a typical VPS. The server reaches
Postgres over the Docker network and needs no published port.

- `docker-compose.yml` publishes Postgres on `127.0.0.1:8890`, reachable from
  the host only. To reach it from another machine, prefer an SSH tunnel
  (`ssh -L 8890:127.0.0.1:8890 user@host`). To publish it on another address,
  set `POSTGRES_BIND_ADDRESS` in `.env`, for example `0.0.0.0` for every
  interface, and restrict the port in your provider's firewall.
- `docker-compose.with-caddy.yml` does not publish Postgres.
- `swarm.yml` does not publish Postgres, because swarm publishes on every
  node's interfaces and ignores a host address. Use
  `docker exec -it $(docker ps -q -f name=instant_postgres) sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`
  on the node that runs it. To publish it anyway, deploy with an extra file
  that publishes it on that node, and restrict the port in your provider's
  firewall:

  ```yaml
  # swarm.postgres-port.yml
  services:
    postgres:
      ports:
        - target: 5432
          published: 8890
          mode: host
  ```

  ```sh
  docker stack deploy -c swarm.yml -c swarm.postgres-port.yml instant
  ```

  `deploy-swarm.sh` deploys `swarm.yml` alone.

## Server memory

The server container has a memory limit, `SERVER_MEMORY_LIMIT` (default `2g`),
and `JAVA_OPTS` defaults to:

```
-XX:MaxRAMPercentage=60 -Djdk.nio.maxCachedBufferSize=131072 -XX:TrimNativeHeapInterval=60000
```

The heap may grow to 60% of the container limit (1.2 GiB with the default),
leaving the rest for metaspace, thread stacks and native buffers. Without a
container limit the JVM would size its heap from host memory instead. The other
two flags are the native-memory settings upstream uses for its own deployment:
they cap the size of cached NIO buffers and return freed native memory to the
OS every 60 seconds. Raise `SERVER_MEMORY_LIMIT` on a bigger host; setting
`JAVA_OPTS` replaces all three defaults, so repeat the ones you want to keep.

Direct (off-heap) buffer memory is not capped separately: the JVM allows it to
grow as large as the heap, so heap plus direct memory can in principle exceed
the container limit, and the kernel then kills the container. If that happens,
raise `SERVER_MEMORY_LIMIT`, or lower `-XX:MaxRAMPercentage` or add
`-XX:MaxDirectMemorySize=...` in `JAVA_OPTS`.

## Runtime mode

The server runs in the **self-hosted** runtime mode, set by
`SIDEKICK_RUNTIME_MODE` (or `INSTANT_RUNTIME_MODE`). The compose files and the
server image default to `self-hosted`; `default` gives upstream's development
behaviour, which a server started outside these files also gets. Any other
value, or `self-hosted` together with `PRODUCTION=true` or `STAGING=true`,
stops the server at startup with a message naming the variable.

In the self-hosted mode:

- Startup skips three Instant Cloud jobs: the `app-proxy` flag listener
  (Instant's backend-migration tool), the join-room analytics logger, and the
  Postgres hint-plan experiment.
- nREPL (port 6005 inside the container, bound to `127.0.0.1`) does not start
  unless `SIDEKICK_NREPL=true`.
- Behaviour meant for developing the server is off: SSE requests and stream
  reads are always served locally (in development about half go through
  Hazelcast or gRPC on purpose), and responses and WebSocket `init-ok` carry no
  server hostname and port.
- OAuth cookies are marked `Secure` when `SIDEKICK_BACKEND_URL` is `https`. A
  plain-`http` deployment such as `http://localhost:8888` keeps working.
- **A startup error stops the server** (exit code 1) instead of leaving it
  running half-initialised. `EXIT_ON_ERROR=false` keeps the old behaviour.
  With a restart policy (`restart: always`, or a swarm service) this shows as
  a server that restarts over and over: read the reason with
  `docker compose logs server`, and look for `Error in startup` just before
  each exit.

To switch it off, set `SIDEKICK_RUNTIME_MODE=default` in `.env` (or pass
`-e INSTANT_RUNTIME_MODE=default` to `docker run`) and recreate the server.

## Startup and DNS

The server only prefetches Google's OpenID configuration and signing keys at
startup when dashboard Google sign-in is configured
(`SIDEKICK_DASHBOARD_GOOGLE_OAUTH_CLIENT_ID` and `_SECRET`). Otherwise they are
fetched on first use, for example when an app uses Google sign-in.

Outbound requests to user-supplied URLs (webhooks, OAuth discovery and keys)
resolve hostnames with DNS-over-HTTPS through Cloudflare and Google by default.
Set `SIDEKICK_DNS_OVER_HTTPS_URLS` to a comma-separated list of DoH endpoints to
use your own, or to `system` to use only the system resolver. Private and
loopback addresses are rejected in every mode.

There is no automatic fallback from DoH to the system resolver. Public DoH
cannot resolve names that exist only inside your network (`/etc/hosts`, search
domains, Docker's embedded DNS, private zones), which keeps app owners from
pointing a webhook or an OAuth provider at an internal service by name. On a
network that blocks the DoH endpoints, those requests fail with a DNS error
after up to 10 seconds; set `SIDEKICK_DNS_OVER_HTTPS_URLS=system` there. With
`system`, internal names resolve, and the address filter is the only
protection left: it rejects private, loopback and link-local addresses, but
not internal services that use public address space.

## Object storage

The compose files run [RustFS](https://rustfs.com), an S3-compatible object
store, as the `storage` service (image `rustfs/rustfs:1.0.6`). The
`createbuckets` service creates `S3_BUCKET` and `S3_APP_BACKUPS_BUCKET` with the
RustFS client (`rustfs/rc:v0.1.38`). Both images can be changed with
`STORAGE_IMAGE` and `STORAGE_CLIENT_IMAGE`; see `.env.example`. The RustFS
console listens on port 9001.

Two settings exist only because of RustFS 1.0.6 behaviour:

- The server runs with `AWS_REQUEST_CHECKSUM_CALCULATION=when_required`.
  Backups upload with `Content-Encoding: zstd`; with the AWS SDK's default
  checksum mode the request carries a second Content-Encoding (`aws-chunked`)
  and RustFS rejects it with `duplicate header: content-encoding`.
- `createbuckets` sets CORS rules (GET and HEAD from any origin) on both
  buckets. MinIO allowed every origin by default; RustFS sends no CORS headers
  without bucket rules, which blocks browser `fetch()` of file URLs.

Upgrading from the MinIO-based compose files: MinIO ran as the `minio` service
with its data in the `minio_data` volume. The `storage` service starts with an
empty `storage_data` volume, so existing files are not carried over. Copy the
buckets to the new store with an S3 client before switching, and change
`S3_ENDPOINT` in `.env` from `http://minio:9000` to `http://storage:9000`.
The upstream `minio/minio` and `minio/mc` images are no longer on Docker Hub.
Like the compose files, `swarm.yml` reads only `STORAGE_ACCESS_KEY` and
`STORAGE_SECRET_KEY` (formerly `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`) and
refuses to deploy without them.

### Cloudflare R2

File URLs are presigned with `S3_PUBLIC_ENDPOINT` (or `S3_ENDPOINT` when it is
unset), with the bucket in the path. For R2, set both to the bucket's S3 API
domain, `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. Do not point
`S3_PUBLIC_ENDPOINT` at an R2 custom domain: R2 does not accept presigned URLs
on custom domains (see Cloudflare's
[presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
page), so file URLs would not load.
