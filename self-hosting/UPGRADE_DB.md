# Upgrading a self-hosted InstantDB

You can ignore this guide if you are creating a new self-hosted Instant deployment.
This doc is only for deployments that were using postgres 16 and want to update.

## PostgreSQL 16 → 17 (one-time migration)

The compose files ship PostgreSQL 17, but reuse the same `backend-db` volume that
older deployments populated with PostgreSQL 16.

A PostgreSQL major version cannot read an older major version's data directory,
so if you pull these images on top of an existing PostgreSQL 16 volume the
container will refuse to start with:

```text
FATAL: database files are incompatible with server
DETAIL: The data directory was initialized by PostgreSQL version 16, which is not compatible with this version 17.x.
```

<!-- SidekickDB: every command reads the user and database from the container, so nothing needs substituting. -->

Run this migration **once**, using dump/restore. The commands below assume the
default `docker-compose.yml` and read the user and database from the `postgres`
container's `POSTGRES_USER` / `POSTGRES_DB`, so there is nothing to substitute.
If your deployment uses a different compose file or project name, add the same
`-f`/`-p` options to **every** `docker compose` command below, including the one
nested inside the volume-lookup in step 2 and the ones in the rollback notes.

### 1. Dump the database while still on PostgreSQL 16

Do this **before** pulling the PostgreSQL 17 image. Check out the previous
revision if you have already pulled it, so the `postgres` service is still
`postgresql-16-...`, then:

<!-- SidekickDB: pg_dump reads the user and database from the container, as steps 3 to 5 do. -->

```bash
docker compose up -d postgres
# wait until it reports healthy
docker compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > instant-pg16.dump
```

Keep `instant-pg16.dump` somewhere safe.

### 2. Start PostgreSQL 17 on a fresh data directory

Postgres stores its data in a Docker volume. Get that volume's exact name
straight from the running container, so you delete the right one. Run this
before `docker compose down`, while the container still exists:

```bash
# Read the volume backing /var/lib/postgresql/data straight from the container
PG_VOLUME=$(docker inspect "$(docker compose ps -aq postgres)" \
  --format '{{ range .Mounts }}{{ if eq .Destination "/var/lib/postgresql/data" }}{{ .Name }}{{ end }}{{ end }}')
echo "Resolved PostgreSQL data volume: $PG_VOLUME"
```

Confirm the printed name is the PostgreSQL data volume you intend to delete
before continuing. If that line printed a blank name, stop and re-run the
resolve step while the container is still up, rather than deleting anything.
This step is destructive and irreversible. If you would rather leave your
PostgreSQL 16 volume untouched, use the alternative at the end of this guide
instead of deleting anything.

```bash
docker compose down

# Check out the PostgreSQL 17 revision, then validate its compose config and
# print the resolved postgres image, all before deleting the old volume so a bad
# checkout can't leave you with no database (you may have checked out PG16 for
# the dump above). Stop here if either command fails:
git checkout <pg17-revision>              # e.g. main
docker compose config >/dev/null          # validates the compose file; errors are fatal
docker compose config --images postgres   # prints the resolved postgres image
```

Confirm that image tag denotes PostgreSQL 17 (e.g. `postgres:17`). If it still
shows 16, your checkout didn't switch revisions, so fix that before deleting the
volume.

```bash
# Only now that the PG17 config and image are confirmed, and $PG_VOLUME is
# verified above:
docker volume rm "$PG_VOLUME"
docker compose up -d --wait postgres
# --wait blocks until the fresh, empty database is healthy
```

### 3. Restore the dump

Only the `postgres` service is running at this point (from step 2). Restore into
it, but **don't** bring up the rest of the stack yet — step 4 has to run before
the server starts:

```bash
docker compose exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --single-transaction' < instant-pg16.dump
```

<!-- SidekickDB: step 4 is new; see BACKUP.md, restore step 6. -->

### 4. Move the database past the positions it already holds

The server numbers every write with its position in the write-ahead log and
stores those numbers in `history`, `webhook_events`, `app_backups` and
`backup_jobs`. The PostgreSQL 17 database is a new cluster whose log starts
near the beginning again, so without this step some writes get a number that
is already stored: they get no history record and no webhook, and a webhook
created after the upgrade can be sent an older write's data. App data is not
affected. [BACKUP.md](BACKUP.md#6-move-the-database-past-the-positions-it-already-holds)
explains this, what the command does and how to recover if the server already
started without this step.

Run this query. It prints `No step needed`, a `Run:` line, or `STOP`:

```bash
docker compose exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atq' <<'SQL'
create function pg_temp.max_stored_lsn() returns pg_lsn language plpgsql as $$
declare
  t text;
  m pg_lsn;
  s int;
  r pg_lsn;
begin
  foreach t in array array['history', 'webhook_events', 'app_backups', 'backup_jobs'] loop
    if to_regclass(t) is not null then
      execute format('select max((isn).lsn), max((isn).slot_num) from %I', t) into m, s;
      if s is distinct from null and s <> 2 then
        raise exception 'STOP: % holds positions with slot number %, not 2. Do not run pg_resetwal.', t, s;
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

On a `Run:` line, run the command after `Run: ` exactly as printed (with your
`-f`/`-p` options added to each `docker compose`), then run the query again: it
must print `No step needed`. The command stops PostgreSQL cleanly, runs
`pg_resetwal -l` to move the start of its log past the highest stored position,
and starts it again; it does not change any table. It is only safe here, before
step 5 creates the `aggregator` slot and before the server first starts. On
`STOP`, do not run `pg_resetwal`; see the link above.

### 5. Reset the aggregator replication slot

The server keeps an internal count of your data (the "attr sketches") up to date
by streaming Postgres' write-ahead log from a logical replication slot named
`aggregator`, remembering how far it has read in the `wal_aggregator_status`
table.

`pg_dump`/`pg_restore` copies the sketches and the `wal_aggregator_status` row,
but the dump does not include the replication slots. On the fresh PostgreSQL 17
database the sketches are current, yet the `aggregator` slot is gone and
`wal_aggregator_status` still points at a position in the old PostgreSQL 16
slot that no longer exists. If you start the server as-is it can't resume the
stream.

Because the whole stack is down (no writes happen between the dump and now), you
can recreate the slot at the database's current position and point
`wal_aggregator_status` at it. The restored sketches are already accurate, so the
aggregator simply resumes streaming from here:

```bash
docker compose exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
UPDATE wal_aggregator_status
    SET lsn = (SELECT lsn FROM pg_create_logical_replication_slot('aggregator', 'wal2json'))
  WHERE slot_name = 'aggregator';
SQL
```

This should print `UPDATE 1`. If it prints `UPDATE 0`, this deployment never
initialized the aggregator (no status row) — the slot is left uncreated and the
server will bootstrap it itself on first start, which is fine; continue to
step 6.

### 6. Start the rest of the stack

```bash
docker compose up -d
```

Verify the app comes up and your data is present, then you can delete
`instant-pg16.dump`.

> If you would rather not migrate in place, point the `postgres` service at a
> brand-new volume (e.g. `backend-db-17`) instead of `backend-db` and restore
> the dump into it. That keeps the untouched PostgreSQL 16 volume around as a
> rollback.
>
> To roll back to PostgreSQL 16 after using the alternative volume, stop the
> stack, restore the previous compose/image configuration, and start it again
> against the original `backend-db` volume. **Never delete `backend-db`**. It
> still holds your PostgreSQL 16 data:
>
> ```bash
> docker compose down
> # restore the PostgreSQL 16 compose file and image tag, e.g. by checking out
> # the previous revision (use your own compose file if it isn't the default):
> git checkout <previous-revision> -- docker-compose.yml
> # the untouched backend-db volume is still attached by that compose file,
> # so do NOT run `docker volume rm` against it
> docker compose up -d
> ```
