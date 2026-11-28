# Backing up and restoring a self-hosted SidekickDB

This guide is for the stack in `docker-compose.yml` and
`docker-compose.with-caddy.yml`. It was tested with `docker-compose.yml` on
Docker 29.8.2 and Docker Compose 5.5.0 on a macOS host on 2026-11-28. Not
tested: the Caddy setup, swarm, a Linux host (where the owners of the files in
the bind-mounted `backups/` folder can differ), and `backup.sh` under dash as
`/bin/sh` (the test host's `/bin/sh` is bash; a review ran the script's trap
pattern under dash and bash with the same result).

## What holds state

A deployment keeps its state in four places. A backup needs all of them.

| What | Where | What is lost without it |
|---|---|---|
| Postgres | `backend-db` volume of the `postgres` service | Every app, user, schema, rule and row |
| Uploaded files | `storage_data` volume of the `storage` service (RustFS), buckets `S3_BUCKET` (default `instant-bucket`) and `S3_APP_BACKUPS_BUCKET` (default `instant-backups`) | The files behind every `$files` entity, and the on-demand app backups |
| Server keys | `override.edn` in the `server_config` volume, mounted at `/app/resources/config` in the `server` container | See below |
| Settings | `.env`, the compose files and, with Caddy, the `Caddyfile` | Your settings and credentials |

### The server keys

The server writes `override.edn` the first time it starts, when the file does
not exist yet. It holds two keys:

- An encryption key for the client secrets of an app's OAuth sign-in clients
  (GitHub, Google and the other providers set up under an app's auth
  settings) and for apps' stored database connection strings.
- A signing key for webhooks.

A database restored next to a new `override.edn` works, except for what those
keys protect: OAuth sign-in through an app's own client stops working until its
client secret is entered again, a stored connection string must be set again,
and webhooks are signed with a new key, so receivers that cached the old public
key must fetch it again and payload tokens sent before the restore no longer
verify. Keep a copy of the original file with your other secrets.

### Settings

- `POSTGRES_USER` and `POSTGRES_DB` must be the same on the restored stack:
  the dump assigns every table to that user. `POSTGRES_PASSWORD` sets the
  password of the new database, so a new value works too: in the test, a
  restored database accepted the new password over the Docker network and
  refused the old one.
- RustFS (1.0.6) takes `STORAGE_ACCESS_KEY` and `STORAGE_SECRET_KEY` from the
  environment when it starts. In the test, a restored storage volume started
  with new keys: `createbuckets` succeeded and an uploaded file downloaded
  unchanged.
- With `docker-compose.with-caddy.yml`, the `caddy_data` and `caddy_config`
  volumes hold Caddy's TLS certificates and saved configuration. This guide
  leaves them out: on a fresh stack Caddy issues the certificates again. Each
  restore requests new certificates, so repeated test restores with the same
  domains can hit the certificate authority's rate limits; test on other
  domains or keep `caddy_data`.

If `S3_ENDPOINT` points at an external store (AWS S3, Cloudflare R2), the
files are not in `storage_data`. Back up those buckets with your provider's
tools; the rest of this guide still applies to Postgres and the server keys.

## On-demand app backups are not a database backup

The dashboard and `sidekick-cli backup` can make a backup of a single app. The
server writes it to `S3_APP_BACKUPS_BUCKET`, which the compose files create in
the same RustFS store, and records it in Postgres. It holds that app's data and
configuration (schema, rules and the like). For files it holds the `$files`
entries, which point at the objects in the storage bucket, not the file
contents. After 30 days the dashboard no longer offers it. Deleting a backup
in the dashboard only hides it: its files stay in storage, and in the storage
archive below, until the lifecycle rule that `createbuckets` sets on the
bucket removes them, 32 days after they were written. After an upgrade to
compose files with that rule, files of backups older than 32 days are removed
at the next lifecycle scan; the server already hides those backups. An
external backups bucket needs the rule set by hand (see "Lifecycle rule for
app backups" in `README.md`).

So an app backup lives on the same disks as the data it protects and covers
one app, not the deployment. It is useful for exporting an app or recovering
from a mistake in it, but it does not replace the backup below.

The server's scheduled backup of every app runs only in production mode on
AWS, so a self-hosted server never runs it.

## Back up

Run these in the directory with your compose files and `.env`. If you use
`docker-compose.with-caddy.yml` or a project name, add the same `-f` and `-p`
options to every `docker compose` command.

The script stops the server and the storage service for as long as the copy
takes, so the database and the files are copied at the same point in time.
Postgres and the dashboard keep running. Clients reconnect on their own when
the server is back; it needs up to a few minutes to start.

Save this as `backup.sh` next to your compose files:

```sh
#!/bin/sh
set -eu
cd "$(dirname "$0")"
umask 077
stamp=$(date +%Y%m%d-%H%M%S)
dir="backups/$stamp.partial"
mkdir -p "$dir"

# Start the stopped services again, also when a step fails or the script is interrupted.
trap 'docker compose start storage server' EXIT
trap 'exit 1' INT TERM HUP

docker compose images > "$dir/images.txt"
cp .env "$dir/env"

docker compose stop server
docker compose cp server:/app/resources/config/override.edn "$dir/override.edn"
docker compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$dir/db.dump"

docker compose stop storage
docker run --rm --volumes-from "$(docker compose ps -aq storage)" \
  -v "$PWD/$dir:/backup" alpine:3 \
  tar czf /backup/storage.tar.gz --numeric-owner -C /data .

mv "$dir" "backups/$stamp"
```

```sh
chmod 700 backup.sh
./backup.sh
```

Each run writes a folder `backups/<date>-<time>/` with:

| File | What |
|---|---|
| `db.dump` | the database, from `pg_dump` in custom format |
| `storage.tar.gz` | the storage volume, with numeric owners |
| `override.edn` | the server keys |
| `env` | your `.env` |
| `images.txt` | the images the stack ran, from `docker compose images` |

The script writes into `<date>-<time>.partial/` and renames the folder as its
last step, so only a folder without `.partial` is a complete backup. A failed
run leaves its `.partial` folder behind and exits with a non-zero status.

`pg_dump` runs inside the `postgres` container and reads the user and database
from its `POSTGRES_USER` and `POSTGRES_DB`. `--volumes-from` mounts the
storage container's volume in a throwaway `alpine` container, so you do not
need the volume's name. The archive keeps the storage files' numeric owners
(`10001`, the `rustfs` user), so a restore needs no `chown`.

The files hold your keys and passwords. `storage.tar.gz` is written by root
in the `alpine` container, and `override.edn` keeps the mode it has in the
server container; both are readable by anyone who can enter the folder, so
only the folder's `0700` permissions keep other users of the host out. Copy
the folders to another machine or bucket and keep them private.

In the test, with a small database, the server and storage were stopped for
about 20 seconds.

`pg_dump` alone is safe while the server runs, so you can dump the database
more often than you copy the files. A dump made that way can refer to files
uploaded after the last copy of `storage_data`.

### Run it every night

With `crontab -e`, as a user that can run `docker`:

```
0 3 * * * /path/to/self-hosting/backup.sh >> /path/to/self-hosting/backups/backup.log 2>&1
```

To keep 14 days of backups, add this at the end of `backup.sh`. It removes
whole backup folders, complete or `.partial`, by the age of the folder. Do
not select files by their own age: `override.edn` keeps the time the server
first wrote it, so every copy of it looks old.

```sh
find backups -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +14 -exec rm -rf {} +
```

## Restore

Restore into a fresh stack, on another machine or in a compose project whose
volumes do not exist yet. Stop at the first command that fails or prints
something other than what is described: carrying on can leave a stack that
starts but runs on an empty database or with new keys.

Use the images listed in the backup's `images.txt`, or newer ones; a newer
server applies its migrations when it starts. Replace `STAMP` with the name of
the backup folder you restore.

### 1. Put the files in place

Copy your compose files (and `Caddyfile`), the backup's `env` as `.env`, and the
backup folder to `backups/STAMP/`. Set the image tags in `.env` if
`images.txt` lists ones other than the defaults.

### 2. Check that the stack is fresh

```sh
docker compose config | sed -n 's/^name: //p'
docker volume ls --filter label=com.docker.compose.project=<name>
```

The first command prints the project name; put it in the second. The second
must list no volumes. If it lists any, they are from an earlier stack and would
be reused: pick another project name with `-p`, or remove them only if you are
sure they hold nothing you need.

### 3. Create the containers without starting them

```sh
docker compose up --no-start
```

This creates the volumes and containers. Nothing runs yet, so the server
cannot write a new `override.edn`.

### 4. Restore the files and the server keys

```sh
docker run --rm --volumes-from "$(docker compose ps -aq storage)" \
  -v "$PWD/backups/STAMP:/backup:ro" alpine:3 \
  tar xzf /backup/storage.tar.gz --numeric-owner -C /data

docker compose cp backups/STAMP/override.edn server:/app/resources/config/override.edn
docker compose cp server:/app/resources/config/override.edn override.check
cmp backups/STAMP/override.edn override.check && rm override.check
```

`docker compose cp` works on the created container before it ever starts,
and writes into its `server_config` volume. `cmp` prints nothing when the
copy in the container matches the backup, and `override.check` is then
removed. Do not go on if `cmp` prints anything.

### 5. Restore the database

Start only Postgres, on its empty volume, and restore the dump:

```sh
docker compose up -d --wait postgres
docker compose exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction --exit-on-error' \
  < backups/STAMP/db.dump
```

It prints nothing when it succeeds.

### 6. Recreate the aggregator replication slot

The server reads Postgres' write-ahead log through logical replication slots.
A dump does not contain them, so the new database has none.

- The `invalidator` slot is created by the server when it starts.
- The `aggregator` slot keeps per-attribute counts (the "attr sketches") up to
  date and records how far it has read in the `wal_aggregator_status` table.
  The dump restored that row, which points at a position in the old
  database's slot. Reading the server's code, while that row exists it fails
  at startup when it tries to set the slot up again.

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

### 7. Start the stack

```sh
docker compose up -d --wait
```

`createbuckets` finds the restored buckets and leaves them as they are. Check
that you can log in to the dashboard, that your apps and their data are there,
and that an uploaded file loads. The `aggregator` and `invalidator` slots
should be listed and active; the server also keeps one slot per running
server process, named `invalidator_` followed by the process id:

```sh
docker compose exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select slot_name, plugin, active from pg_replication_slots"'
```

## Swarm

`swarm.yml` uses the same Postgres image, service names and volumes, but the
server keys are the Docker secret `server_config`, which you already keep (see
[The server_config secret](README.md#the-server_config-secret-swarm)), and
`docker compose` does not reach the services. Run the `pg_dump`, `pg_restore`
and `psql` commands with
`docker exec -i $(docker ps -q -f name=instant_postgres) sh -c '...'` on the
node that runs Postgres, and scale the server to zero before restoring
(`docker service scale instant_server=0`). This guide has no tested swarm
procedure.
