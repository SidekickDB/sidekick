# Backing up and restoring a self-hosted SidekickDB

This guide is for the stack in `docker-compose.yml` and
`docker-compose.with-caddy.yml`. It was tested with `docker-compose.yml` on
Docker 29.8.2 and Docker Compose 5.5.0 on a macOS host on 2026-11-28. Not
tested: the Caddy setup, swarm, a Linux host (where the owners of the files in
the bind-mounted `backups/` folder can differ), and `backup.sh` under dash as
`/bin/sh` (the test host's `/bin/sh` is bash; a review ran the script's trap
pattern under dash and bash with the same result). Restore step 6 was tested
the same day with the v2.0.1 images, with its commands run against
`docker-compose.local.yml`, which has the same Postgres image, settings and
volume as `docker-compose.yml` and differs in ports and the password default.

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
contents. After 30 days the dashboard no longer offers it. Deleting a backup in
the dashboard only hides it: its files stay in storage, and in the storage
archive below, until the lifecycle rule that `createbuckets` sets on the bucket
removes them, 32 days after they were written. The rule also applies to files
written before it was set: after an upgrade to compose files with that rule,
files of backups older than 32 days are removed at the next lifecycle scan. The
server already hides those backups. An external backups bucket needs the rule
set by hand (see "Lifecycle rule for app backups" in `README.md`).

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

### 6. Move the database past the positions it already holds

Do this after step 5 and before step 7, while only Postgres runs and before
the server has ever started on the new database.

The server numbers every write with its position in Postgres' write-ahead log
(WAL), and stores those numbers in four tables: `history` and
`webhook_events` (for webhooks), `app_backups` and `backup_jobs`. The restored
database is a new Postgres cluster whose log starts near the beginning again,
so without this step the server hands out numbers that are already stored.
In the test, the restored database started 12.7 MB of log below the highest
stored position, and of 3,000 writes made after the restore, 1 in one run and
2 in another got a number that was already stored. For such a write:

- no history record is saved and the webhook is not sent; nothing reports an
  error;
- a webhook created after the restore is sent the data of the older write that
  holds that number.

The app data of that write is saved as usual. This stops once the new
database's log passes the highest stored position, that is once it has written
about as much log as the old database had.

This query prints what to do. It reads the highest position stored in those
four tables under the server's slot number (2, `invalidator-slot-num` in
`server/src/instant/config.clj`) and compares it with the database's current
one. Older servers used slot numbers 0 and 1, and rows from them can still be
in these tables. They are left out: numbers compare by slot number first, so
they can never match a new one.

```sh
docker compose exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atq' <<'SQL'
create function pg_temp.max_stored_lsn() returns pg_lsn language plpgsql as $$
declare
  server_slot_num constant int := 2;
  t text;
  m pg_lsn;
  s int;
  r pg_lsn;
begin
  foreach t in array array['history', 'webhook_events', 'app_backups', 'backup_jobs'] loop
    if to_regclass(t) is not null then
      execute format('select max((isn).lsn) filter (where (isn).slot_num = $1), max((isn).slot_num) from %I', t)
        into m, s using server_slot_num;
      if s > server_slot_num then
        raise exception 'STOP: % holds positions with slot number %, above this server''s %.', t, s, server_slot_num;
      end if;
      r := greatest(r, m);
    end if;
  end loop;
  return coalesce(r, '0/0');
end $$;

select case
  when pg_current_wal_lsn() > stored then
    'No step needed: the database is already past every stored position (' || stored || ').'
  when (select count(*) from pg_replication_slots) > 0 then
    'STOP: the database has replication slots, so this step comes too late. See the guide.'
  else
    'Run: docker compose stop -t 300 postgres && docker compose run --rm --no-deps --user postgres --entrypoint pg_resetwal postgres -l '
      || pg_walfile_name(stored + (select setting::numeric from pg_settings where name = 'wal_segment_size'))
      || ' /var/lib/postgresql/data && docker compose up -d --wait postgres'
  end
from (select pg_temp.max_stored_lsn() as stored) s;
SQL
```

It prints one line:

- `No step needed: ...`: go on with step 7.
- `Run: ...`: run the command after `Run: ` exactly as printed (with your `-f`
  and `-p` options added to each `docker compose`), then run the query again.
  It must now print `No step needed`. In the test, a restore printed
  `Run: ... -l 000000010000000000000004 ...`.
- `STOP: the database has replication slots ...`: do not run `pg_resetwal`;
  see [If the server started without this step](#if-the-server-started-without-this-step).
- `ERROR:  STOP: <table> holds positions with slot number ...`: a newer
  server, with a higher slot number than 2, wrote that data. Do not continue:
  restore with the server version that wrote it.

The printed command stops Postgres and waits up to 300 seconds for it to shut
down cleanly, runs `pg_resetwal -l` from the Postgres image on the same volume
as the `postgres` user, and starts Postgres again. `pg_resetwal -l` moves the
start of the write-ahead log forward to the file it is given, one 16 MB file
past the highest stored position (the query reads the file size and the
timeline from the database). It removes the old log files, which after a clean
shutdown hold nothing that is not already in the data files, and it does not
change any table. In the test, every app, row, history record and webhook
event was there afterwards. Running the same command a second time moved the
position one more file forward and did no harm.

Two rules keep it safe:

- Postgres must have stopped cleanly. If it did not, `pg_resetwal` stops with
  `lock file "postmaster.pid" exists` and changes nothing. Start Postgres
  again with `docker compose up -d --wait postgres` and run the query again.
  Never delete that file and never add `-f`.
- Never run it on a database that has replication slots or standby servers
  reading from it: they keep positions in the old log files that it removes.
  At this point the restored database has neither. The dump holds no slots
  (the query prints `STOP` if there are any) and the shipped stack runs no
  standby. That is why this step comes before step 7, which creates the
  `aggregator` slot, and before the server first starts, which creates the
  others.

### 7. Recreate the aggregator replication slot

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

### 8. Start the stack

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

### If the server started without this step

This applies to a database restored before step 6 was in this guide, or when
step 6 was skipped. Writes made since the restore may be missing history
records or webhooks as described in step 6; this does not bring those back,
it stops new ones from being skipped.

1. Stop your apps' writes, then the server: `docker compose stop server`.
2. Run the query from step 6. `No step needed` means the database is already
   past every stored position: start the server again and you are done.
3. `STOP: the database has replication slots` is expected here. With the
   server stopped, drop them:

   ```sh
   docker compose exec -T postgres sh -c \
     'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select pg_drop_replication_slot(slot_name) from pg_replication_slots"'
   ```

   Changes the server had not yet read from its slots when it stopped get no
   history record or webhook, and the per-attribute counts the server uses to
   plan queries (the "attr sketches", kept by the `aggregator` slot) miss
   them. That is why the writes stop first.
4. Run the query again, run the command it prints, and run the query once
   more: it must print `No step needed`.
5. Do step 7 (it prints `UPDATE 1`) and step 8. The server creates its own
   slots again when it starts.

In the test, a restored database whose server had already started and taken
writes went through these steps, and the 3,000 writes after them all got a
history record and a webhook with their own data.

## Swarm

`swarm.yml` uses the same Postgres image, service names and volumes, but the
server keys are the Docker secret `server_config`, which you already keep (see
[The server_config secret](README.md#the-server_config-secret-swarm)), and
`docker compose` does not reach the services. Run the `pg_dump`, `pg_restore`
and `psql` commands with
`docker exec -i $(docker ps -q -f name=instant_postgres) sh -c '...'` on the
node that runs Postgres, and scale the server to zero before restoring
(`docker service scale instant_server=0`). Step 6 is needed there too, but the
command its query prints is for the Compose files and cannot run on swarm:
adapt it by stopping the Postgres service cleanly, running `pg_resetwal` with
the same `-l` argument against the same volume as the `postgres` user, and
starting the service again. That path is untested. This guide has no tested
swarm procedure.
