# Self Hosting InstantDB

Documentation for self hosting is available at [www.instantdb.com/docs/self-hosting](https://instantdb.com/docs/self-hosting)

See [UPGRADE_DB.md](UPGRADE_DB.md) for instructions on upgrading existing backends from postgres 16 to 17.

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
would not match the existing volumes.

## Local development

`docker-compose.local.yml` is for local development only. It builds the server
and dashboard from source, binds every port to `127.0.0.1`, and falls back to
the well-known credentials `pass` (Postgres) and `rustfsadmin` (storage) when
`.env` does not set them. Do not use it for a deployment.

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

## Startup and DNS

The server only prefetches Google's OpenID configuration and signing keys at
startup when dashboard Google sign-in is configured
(`INSTANT_DASHBOARD_GOOGLE_OAUTH_CLIENT_ID` and `_SECRET`). Otherwise they are
fetched on first use, for example when an app uses Google sign-in.

Outbound requests to user-supplied URLs (webhooks, OAuth discovery and keys)
resolve hostnames with DNS-over-HTTPS through Cloudflare and Google by default,
and fall back to the system resolver when both fail (after up to 10 seconds
when they time out). Set
`INSTANT_DNS_OVER_HTTPS_URLS` to a comma-separated list of DoH endpoints to use
your own, or to `system` to use only the system resolver, for example on a
network that blocks those endpoints. Private and loopback addresses are
rejected in every mode.

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
`swarm.yml` cannot fall back to the old names, so it requires
`STORAGE_SECRET_KEY` (formerly `MINIO_ROOT_PASSWORD`) and refuses to deploy
without it; set `STORAGE_ACCESS_KEY` too if you had set `MINIO_ROOT_USER`.
