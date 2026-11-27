# Backing up and restoring a self-hosted SidekickDB

This guide is for the stack in `docker-compose.yml` and
`docker-compose.with-caddy.yml`. The commands were written from the compose
files and the server's code, and have not yet been run end to end. Try a
restore on a spare machine before you rely on them.

## What holds state

A deployment keeps its state in four places. A backup needs all of them.

| What | Where | What is lost without it |
|---|---|---|
| Postgres | `backend-db` volume of the `postgres` service | Every app, user, schema, rule and row |
| Uploaded files | `storage_data` volume of the `storage` service (RustFS), buckets `S3_BUCKET` (default `instant-bucket`) and `S3_APP_BACKUPS_BUCKET` (default `instant-backups`) | The files behind every `$files` entity, and the on-demand app backups |
| Server keys | `override.edn` in the `server_config` volume, mounted at `/app/resources/config` in the `server` container | The keys that encrypt app secrets and sign webhooks |
| `.env` | the directory you run `docker compose` in | `POSTGRES_PASSWORD`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` and your other settings |

The server writes `override.edn` the first time it starts, when the file does
not exist yet. A database restored next to a new `override.edn` is not usable:
the new keys cannot decrypt what the old ones encrypted. Keep a copy of the
original file with your other secrets.

Keep `.env` too. Postgres and RustFS store the credentials they were first
started with in their volumes, so restored volumes only work with the same
values.

If `S3_ENDPOINT` points at an external store (AWS S3, Cloudflare R2), the
files are not in `storage_data`. Back up those buckets with your provider's
tools; the rest of this guide still applies to Postgres and the server keys.

`docker-compose.with-caddy.yml` also has the `caddy_data` and `caddy_config`
volumes. They hold Caddy's TLS certificates and its saved configuration, which
Caddy creates again on a fresh stack, so this guide leaves them out.

## On-demand app backups are not a database backup

The dashboard and `sidekick-cli backup` can make a backup of a single app. The
server writes it to `S3_APP_BACKUPS_BUCKET`, which the compose files create in
the same RustFS store, and records it in Postgres. It holds that app's data and
configuration (schema, rules and the like). For files it holds the `$files`
entries, which point at the objects in the storage bucket, not the file
contents. Each one expires after 30 days.

So an app backup lives on the same disks as the data it protects, and covers
one app, not the deployment. It is useful for exporting an app or recovering
from a mistake in it. It does not replace the backup below.

The server's scheduled backup of every app runs only in production mode on
AWS, so a self-hosted server never runs it.

## Back up

Run these in the directory with your compose files and `.env`. If you use
`docker-compose.with-caddy.yml` or a project name, add the same `-f` and `-p`
options to every `docker compose` command.

The backup below stops the server and the storage service for as long as the
copy takes, so the database and the files are copied at the same point in
time. Clients reconnect on their own when the server is back. The server needs
up to a few minutes to start.

Save this as `backup.sh` next to your compose files:

```sh
#!/bin/sh
set -eu
cd "$(dirname "$0")"
umask 077
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p backups

# Start everything again, also when a step below fails.
trap 'docker compose start storage server' EXIT

docker compose stop server

docker compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/db-$stamp.dump"

docker compose stop storage
docker run --rm --volumes-from "$(docker compose ps -aq storage)" \
  -v "$PWD/backups:/backup" alpine:3 \
  tar czf "/backup/storage-$stamp.tar.gz" -C /data .

docker compose cp server:/app/resources/config/override.edn "backups/override-$stamp.edn"
cp .env "backups/env-$stamp"
```

```sh
chmod 700 backup.sh
./backup.sh
```

`pg_dump` runs inside the `postgres` container and reads the user and database
from its `POSTGRES_USER` and `POSTGRES_DB`. `--volumes-from` mounts the
storage container's volume in a throwaway `alpine` container, so you do not
need the volume's name. `backups/` then holds four files per run. They contain
your keys and passwords: copy them to another machine or bucket, and keep them
private.

`pg_dump` alone is safe while the server runs, so you can dump the database
more often than you copy the files. A dump made that way can refer to files
uploaded after the last copy of `storage_data`.

### Run it every night

With `crontab -e`, as a user that can run `docker`:

```
0 3 * * * /path/to/self-hosting/backup.sh >> /path/to/self-hosting/backups/backup.log 2>&1
```

To keep the last 14 days, add this at the end of `backup.sh`:

```sh
find backups -type f ! -name backup.log -mtime +14 -delete
```

## Restore

Restore into a fresh stack: a machine (or a project) whose volumes do not exist
yet. Use the same server version as the backup or a newer one; the server
applies newer migrations when it starts. Replace `STAMP` with the time stamp
of the backup you restore.

### 1. Put the files in place

Copy your compose files, the backup's `env-STAMP` as `.env`, and the backup
files into `backups/`.

### 2. Create the containers without starting them

```sh
docker compose up --no-start
```

This creates the volumes and containers. Nothing runs yet, so the server
cannot write a new `override.edn`.

### 3. Restore the files and the server keys

```sh
docker run --rm --volumes-from "$(docker compose ps -aq storage)" \
  -v "$PWD/backups:/backup" alpine:3 \
  tar xzf /backup/storage-STAMP.tar.gz -C /data

docker compose cp backups/override-STAMP.edn server:/app/resources/config/override.edn
```

### 4. Restore the database

Start only Postgres, on its empty volume, and restore the dump:

```sh
docker compose up -d --wait postgres
docker compose exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction --exit-on-error' \
  < backups/db-STAMP.dump
```

### 5. Recreate the aggregator replication slot

The server reads Postgres' write-ahead log through logical replication slots.
A dump does not contain them, so the new database has none.

- The `invalidator` slot is created by the server when it starts.
- The `aggregator` slot keeps per-attribute counts (the "attr sketches") up to
  date and records how far it has read in the `wal_aggregator_status` table.
  The dump restored that row, which now points at a position in the old
  database's slot. Reading the server's code, it would fail at startup trying
  to set the slot up again.

Before the server starts, create the slot at the current position and point
the row at it:

```sh
docker compose exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
UPDATE wal_aggregator_status
    SET lsn = (SELECT lsn FROM pg_create_logical_replication_slot('aggregator', 'wal2json'))
  WHERE slot_name = 'aggregator';
SQL
```

This prints `UPDATE 1`. `UPDATE 0` means the old server never set up the
aggregator; the slot stays uncreated and the server sets it up on its first
start. This is the same step as in [UPGRADE_DB.md](UPGRADE_DB.md).

### 6. Start the stack

```sh
docker compose up -d
```

`createbuckets` finds the restored buckets and leaves them as they are. Check
that you can log in to the dashboard, that your apps and their data are there,
and that an uploaded file loads.

## Swarm

`swarm.yml` uses the same Postgres image, service names and volumes, but the
server keys are the Docker secret `server_config`, which you already keep (see
[The server_config secret](README.md#the-server_config-secret-swarm)), and
`docker compose` does not reach the services. Run the `pg_dump`, `pg_restore`
and `psql` commands with
`docker exec -i $(docker ps -q -f name=instant_postgres) sh -c '...'` on the
node that runs Postgres. This guide has no step-by-step swarm procedure.
