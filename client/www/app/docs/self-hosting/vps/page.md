---
nextjs:
  metadata:
    title: 'Self hosting on VPS'
    description: 'Run SidekickDB on a VPS.'
---

You can run the SidekickDB backend, dashboard, PostgreSQL, RustFS (S3-compatible
object storage), and Caddy on a single VPS. A server with 2 vCPUs and 4 GB of
RAM is enough to get started and usually costs around $30 per month.

Already have a VPS and domain? Continue with the server's SSH address and the
hostnames you want to use.

Starting from scratch? Ask your agent for guided help creating the VPS and
setting up DNS.

Any provider that offers a recent Ubuntu image will work. We've tested this
setup with [DigitalOcean](https://www.digitalocean.com/pricing/droplets/) and
[Hetzner](https://www.hetzner.com/cloud/).

## Create the server

Start with:

- Ubuntu 24.04 LTS
- 2 vCPUs
- 4 GB of RAM

You will also need a domain where you can create DNS records. This guide uses:

```text
dash.example.com
api.example.com
files.example.com
```

Point each hostname to the server.

Allow inbound HTTP, HTTPS, and administrator access to the server. PostgreSQL
and RustFS only need to be reachable by the other containers on the host.

## Install Docker

Skip this section if Docker and the Compose plugin are already installed. These
commands come from Docker's [Ubuntu installation guide](https://docs.docker.com/engine/install/ubuntu/):

```sh {% showCopy=true %}
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

```sh {% showCopy=true %}
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

## Configure SidekickDB

Clone SidekickDB and copy the example environment file:

```sh {% showCopy=true %}
git clone https://github.com/SidekickDB/sidekick.git
cd sidekick/self-hosting
cp .env.example .env
nano .env
```

Set the public URLs and the domains Caddy should use:

```shell {% showCopy=true %}
SIDEKICK_BACKEND_URL=https://api.example.com
SIDEKICK_DASHBOARD_URL=https://dash.example.com
S3_PUBLIC_ENDPOINT=https://files.example.com

DASHBOARD_DOMAIN=dash.example.com
BACKEND_DOMAIN=api.example.com
STORAGE_DOMAIN=files.example.com
```

The `_DOMAIN` variables are only used by Caddy. You can ignore them if you use a
different reverse proxy.

`S3_PUBLIC_ENDPOINT` must be an origin without a path, such as
`https://files.example.com`. The S3 API cannot be served from a path such as
`/storage`.

The compose files refuse to start until the PostgreSQL and RustFS credentials
are set. Generate them once and keep them, because changing them later locks the
server out of the existing database and storage volumes:

```sh {% showCopy=true %}
echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)" >> .env
echo "STORAGE_ACCESS_KEY=$(openssl rand -hex 16)" >> .env
echo "STORAGE_SECRET_KEY=$(openssl rand -hex 32)" >> .env
```

Review the rest of `.env`. The storage bucket is private and SidekickDB serves
files with signed URLs.

## Start SidekickDB

Once the DNS records resolve to the server, run:

```sh {% showCopy=true %}
sudo docker compose -f docker-compose.with-caddy.yml --env-file .env up -d
```

Caddy will request TLS certificates for the three domains. Check the containers
and backend health:

```sh {% showCopy=true %}
sudo docker compose -f docker-compose.with-caddy.yml --env-file .env ps
curl -fsS https://api.example.com/health/system
```

A healthy backend returns `{"wal":"ok"}`. Open the dashboard and create an app
to check queries, writes, and file uploads.

Until an email provider is configured, login codes are written to the backend
logs. Tail them with:

```sh {% showCopy=true %}
sudo docker compose -f docker-compose.with-caddy.yml --env-file .env logs --follow server
```

## Scale the server

As your apps grow, watch CPU, memory, disk usage, and query latency. Moving to a
larger VPS is usually the simplest way to add capacity. A common next step is 4
vCPUs and 8 GB of RAM, but you can size the server to match your workload.

If you want to scale application servers and PostgreSQL independently, use the
[AWS guide](/docs/self-hosting/aws).

Once SidekickDB is running, see [Operating SidekickDB](/docs/self-hosting#operating)
to configure email, dashboard access, the CLI, and health checks.
