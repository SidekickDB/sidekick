---
nextjs:
  metadata:
    title: 'Self Hosting SidekickDB on AWS'
    description: 'Run SidekickDB with multiple backend servers and Aurora PostgreSQL.'
---

For more serious projects where you need higher availability and point-in-time
restores, we recommend starting with two backend servers and
Aurora PostgreSQL. This setup is modelled on the architecture upstream describes
for Instant Cloud and lets you scale the backend and database separately.

The resources and instance types are up to you. The important parts are how the
SidekickDB containers connect to PostgreSQL, object storage, and each other.

## Architecture

SidekickDB does not require a particular AWS container platform. Your deployment
needs:

- HTTPS traffic routed to every healthy backend
- At least two backend tasks for redundancy
- Private DNS resolving `tasks.<service-name>` to all backend tasks
- Shared environment variables, secrets, and `override.edn`
- Aurora PostgreSQL 17 with logical replication
- Private S3 object storage
- A separately deployed dashboard

Set `SWARM_SERVICE_NAME` to the service name used in private DNS. Backend tasks
must be able to communicate over ports 5701–5708 and 5801–5808.

Do not set `PRODUCTION=true`. The server image runs in the self-hosted runtime
mode, which stops at startup when `PRODUCTION=true` is set.

## Configure AWS access

Before creating resources, choose an AWS CLI profile and Region, then confirm
that they point to the account where you intend to deploy:

```
aws sts get-caller-identity --profile your-profile
aws configure get region --profile your-profile
```

If AWS is not configured yet, use any AWS-supported authentication method to
create a CLI profile. An agent can help with this process. Use the selected
profile and Region consistently throughout the deployment.

## Configure Aurora PostgreSQL

SidekickDB requires PostgreSQL 17 with logical replication and `pg_hint_plan`.
Create an Aurora PostgreSQL 17 cluster and apply these settings in a custom DB
cluster parameter group:

```text
rds.logical_replication = 1
shared_preload_libraries = pg_stat_statements,pg_hint_plan
max_replication_slots = 10
max_wal_senders = 10
random_page_cost = 1.1
rds.force_ssl = 0
```

Keep any existing entries in `shared_preload_libraries`. The replication
settings require a reboot.

{% callout type="note" %}
SidekickDB opens its migration connection without TLS, so Aurora PostgreSQL 17
requires `rds.force_ssl = 0`. Restrict port 5432 to the backend servers.
{% /callout %}

Create a database and login for SidekickDB. The login needs the RDS replication
role:

```sql
CREATE ROLE instant LOGIN PASSWORD 'replace-with-a-generated-password';
GRANT rds_replication TO instant;
CREATE DATABASE instant OWNER instant;
```

Use the Aurora writer endpoint in `DATABASE_URL`:

```shell
DATABASE_URL=postgresql://instant:PERCENT_ENCODED_PASSWORD@WRITER_ENDPOINT:5432/instant
```

Each backend opens `CONNECTION_POOL_SIZE` database connections. Make sure
Aurora's `max_connections` can support every backend instance with room for
migrations and administration. Increase `max_replication_slots` and
`max_wal_senders` if you run more than ten backend instances.

## Configure S3

Create a private S3 bucket for SidekickDB Storage. The backend needs permission to
list the bucket and to read, write, delete, and manage multipart uploads for its
objects.

Set these values on every backend server:

```shell
AWS_REGION=your-region
S3_BUCKET=instant-bucket
AWS_ACCESS_KEY_ID=replace-with-the-storage-access-key
AWS_SECRET_ACCESS_KEY=replace-with-the-storage-secret-key
```

Be sure to configure CORS on the bucket so SidekickDB apps can upload files directly from the browser.

Leave `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` unset when using AWS S3. SidekickDB
currently needs static IAM credentials to sign S3 URLs, so provide an access
key even when the application servers also have an instance role.

## Share the encryption configuration

Every backend instance must use the same `override.edn`. SidekickDB uses this file
to encrypt secrets and sign webhooks. Generate it once:

```sh {% showCopy=true %}
mkdir instant-config
docker run --rm \
  -v "$PWD/instant-config:/out" \
  ghcr.io/sidekickdb/server:latest \
  /app/start.sh generate-override-config /out/override.edn
```

Store it with your other deployment secrets and mount it at
`/app/resources/config/override.edn` on every backend. Do not generate a
different file for each server.

## Deploy SidekickDB

### Run the backend servers

Deploy the backend image on your preferred container platform:

```
ghcr.io/sidekickdb/server:latest
```

Start with two backend tasks in the same Availability Zone as the Aurora writer.
Route public backend traffic through the load balancer and use `/health/system`
for health checks.

Every backend task must use the same environment variables and the same
`override.edn`. Mount it at:

```
/app/resources/config/override.edn
```

At minimum, configure:

```
WAL_HISTORY_STORAGE=pg
DATABASE_URL=postgresql://instant:PERCENT_ENCODED_PASSWORD@WRITER_ENDPOINT:5432/instant
CONNECTION_POOL_SIZE=20

SIDEKICK_BACKEND_URL=https://api.example.com
SIDEKICK_DASHBOARD_URL=https://dash.example.com

AWS_REGION=your-region
S3_BUCKET=instant-bucket
AWS_ACCESS_KEY_ID=replace-with-the-storage-access-key
AWS_SECRET_ACCESS_KEY=replace-with-the-storage-secret-key

JAVA_OPTS=-Xmx4g -Xms4g -Djdk.nio.maxCachedBufferSize=131072 -XX:TrimNativeHeapInterval=60000
```

Leave `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` unset when using AWS S3.

### Configure backend discovery

Multiple backend tasks must form a single Hazelcast cluster for presence, topics, and distributed state to work correctly.

Set a service name on every backend:

```
SWARM_SERVICE_NAME=server
```

Configure private DNS so that `tasks.server` resolves to the private IP address
of every backend task. Each task must be able to reach the others over TCP ports
5701–5708 and 5801–5808.

ECS with AWS Cloud Map, Docker Swarm DNSRR, or another scheduler that provides
equivalent private DNS can satisfy this requirement.

Keep `PRODUCTION` unset. In the self-hosted runtime mode the server stops at
startup when `PRODUCTION=true` is set.

A successful `/health/system` response verifies the database WAL but does not
verify backend clustering. After deployment, test presence and realtime updates
while requests are distributed across both backend tasks.

### Run the dashboard

Deploy the dashboard image separately:

```
ghcr.io/sidekickdb/dashboard:latest
```

Set its public backend URL:

```
SIDEKICK_BACKEND_URL=https://api.example.com
```

Route the dashboard hostname to port 3000:

```
https://dash.example.com
```

The dashboard does not participate in backend service discovery.

## Verify the deployment

The load balancer should only send traffic to backends where
`/health/system` returns `{"wal":"ok"}`. Open the dashboard and create an app to
check queries, writes, realtime updates, and file uploads.

Until an email provider is configured, login codes are written to the backend
logs. For an ECS deployment using CloudWatch Logs, tail the log group configured
on the backend task definition:

```shell {% showCopy=true %}
aws logs tail /your/backend/log-group \
  --follow \
  --region your-region \
  --profile your-profile
```

Send application logs and infrastructure metrics wherever your team normally
monitors AWS services. At a minimum, watch request errors and latency, backend
health, server CPU and memory, Aurora connections and query latency, and S3
errors.

## Scale the deployment

Add backend servers when CPU, memory, or request latency stays high.
Resize the Aurora writer when database CPU, memory, connections, or query
latency becomes the bottleneck. Revisit the connection pool and replication
settings whenever you add backend servers.

Start small and scale each part from observed usage.

Once SidekickDB is running, see [Operating SidekickDB](/docs/self-hosting#operating)
to configure email, dashboard access, the CLI, and health checks.
