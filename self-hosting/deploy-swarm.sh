#!/usr/bin/env sh
set -e

cd "$(dirname "$0")"

# Required settings come from the environment; the script stops if one is
# missing. Nothing is generated here: the Postgres password and storage keys
# must stay the same across deploys, so generate them once (see .env.example,
# for example `openssl rand -hex 32`) and keep them somewhere safe.
#
#   SSH_HOST=root@203.0.113.10 \
#   DASHBOARD_URL=https://dashboard.example.com \
#   SERVER_URL=https://api.example.com \
#   S3_PUBLIC_ENDPOINT=https://files.example.com \
#   POSTGRES_PASSWORD=... STORAGE_ACCESS_KEY=... STORAGE_SECRET_KEY=... \
#   ./deploy-swarm.sh
SSH_HOST=${SSH_HOST:?set SSH_HOST, for example root@203.0.113.10}
DASHBOARD_URL=${DASHBOARD_URL:?set DASHBOARD_URL, for example https://dashboard.example.com}
SERVER_URL=${SERVER_URL:?set SERVER_URL, for example https://api.example.com}
# S3_PUBLIC_ENDPOINT must be an origin without a path. Use a dedicated hostname or port.
S3_PUBLIC_ENDPOINT=${S3_PUBLIC_ENDPOINT:?set S3_PUBLIC_ENDPOINT, for example https://files.example.com}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD (see .env.example)}
STORAGE_ACCESS_KEY=${STORAGE_ACCESS_KEY:?set STORAGE_ACCESS_KEY (see .env.example)}
STORAGE_SECRET_KEY=${STORAGE_SECRET_KEY:?set STORAGE_SECRET_KEY (see .env.example)}
INSTANT_DASHBOARD_GOOGLE_OAUTH_CLIENT_ID=${SIDEKICK_DASHBOARD_GOOGLE_OAUTH_CLIENT_ID:-${INSTANT_DASHBOARD_GOOGLE_OAUTH_CLIENT_ID:-}}
INSTANT_DASHBOARD_GOOGLE_OAUTH_CLIENT_SECRET=${SIDEKICK_DASHBOARD_GOOGLE_OAUTH_CLIENT_SECRET:-${INSTANT_DASHBOARD_GOOGLE_OAUTH_CLIENT_SECRET:-}}
# Optional server tuning; empty means the default in swarm.yml.
JAVA_OPTS=${JAVA_OPTS:-}
SERVER_MEMORY_LIMIT=${SERVER_MEMORY_LIMIT:-}
INSTANT_DNS_OVER_HTTPS_URLS=${SIDEKICK_DNS_OVER_HTTPS_URLS:-${INSTANT_DNS_OVER_HTTPS_URLS:-}}
INSTANT_SUPERUSER_EMAIL=${SIDEKICK_SUPERUSER_EMAIL:-${INSTANT_SUPERUSER_EMAIL:-}}
# Optional image overrides; empty means the default in swarm.yml.
STORAGE_IMAGE=${STORAGE_IMAGE:-}
STORAGE_CLIENT_IMAGE=${STORAGE_CLIENT_IMAGE:-}
POSTGRES_IMAGE=${POSTGRES_IMAGE:-}
SERVER_IMAGE=${SERVER_IMAGE:-}
DASHBOARD_IMAGE=${DASHBOARD_IMAGE:-}

stack_config() {
  env -i \
    PATH="$PATH" \
    DASHBOARD_URL="$DASHBOARD_URL" \
    SERVER_URL="$SERVER_URL" \
    S3_PUBLIC_ENDPOINT="$S3_PUBLIC_ENDPOINT" \
    POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    STORAGE_ACCESS_KEY="$STORAGE_ACCESS_KEY" \
    STORAGE_SECRET_KEY="$STORAGE_SECRET_KEY" \
    JAVA_OPTS="$JAVA_OPTS" \
    SERVER_MEMORY_LIMIT="$SERVER_MEMORY_LIMIT" \
    INSTANT_DNS_OVER_HTTPS_URLS="$INSTANT_DNS_OVER_HTTPS_URLS" \
    INSTANT_SUPERUSER_EMAIL="$INSTANT_SUPERUSER_EMAIL" \
    STORAGE_IMAGE="$STORAGE_IMAGE" \
    STORAGE_CLIENT_IMAGE="$STORAGE_CLIENT_IMAGE" \
    POSTGRES_IMAGE="$POSTGRES_IMAGE" \
    SERVER_IMAGE="$SERVER_IMAGE" \
    DASHBOARD_IMAGE="$DASHBOARD_IMAGE" \
    INSTANT_DASHBOARD_GOOGLE_OAUTH_CLIENT_ID="$INSTANT_DASHBOARD_GOOGLE_OAUTH_CLIENT_ID" \
    INSTANT_DASHBOARD_GOOGLE_OAUTH_CLIENT_SECRET="$INSTANT_DASHBOARD_GOOGLE_OAUTH_CLIENT_SECRET" \
    docker stack config --compose-file swarm.yml
}

stack_config | (ssh $SSH_HOST 'docker stack deploy -c - instant')
