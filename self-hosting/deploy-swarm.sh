#!/usr/bin/env bash
# SidekickDB: bash with pipefail, so a failed render stops the script before
# anything is sent to the manager.
set -euo pipefail

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

# SidekickDB: every variable swarm.yml reads. `docker stack config` runs with
# only these (and PATH), so nothing else from this machine reaches the stack.
# Empty means the default in swarm.yml. Each INSTANT_* name can also be set as
# SIDEKICK_*, which wins. scripts/self-hosting/deploy-swarm.test.mjs fails when
# swarm.yml reads a variable that is not listed here.
STACK_VARS=(
  DASHBOARD_URL SERVER_URL S3_PUBLIC_ENDPOINT
  POSTGRES_PASSWORD STORAGE_ACCESS_KEY STORAGE_SECRET_KEY
  POSTGRES_USER POSTGRES_DB CONNECTION_POOL_SIZE
  AWS_REGION AWS_REQUEST_CHECKSUM_CALCULATION
  S3_ENDPOINT S3_BUCKET S3_APP_BACKUPS_BUCKET
  JAVA_OPTS SERVER_MEMORY_LIMIT
  INSTANT_RUNTIME_MODE INSTANT_SUPERUSER_EMAIL INSTANT_DNS_OVER_HTTPS_URLS
  INSTANT_SHUTDOWN_DRAIN_SECONDS
  INSTANT_DASHBOARD_GOOGLE_OAUTH_CLIENT_ID INSTANT_DASHBOARD_GOOGLE_OAUTH_CLIENT_SECRET
  STRIPE_API_KEY
  POSTMARK_TOKEN SENDGRID_TOKEN RESEND_TOKEN RESEND_API_KEY
  INSTANT_EMAIL_PROVIDER INSTANT_EMAIL_REPLY_TO
  INSTANT_DASHBOARD_EMAIL_SENDER_NAME INSTANT_DASHBOARD_EMAIL_SENDER_EMAIL
  INSTANT_APP_EMAIL_SENDER_NAME INSTANT_APP_EMAIL_SENDER_EMAIL
  INSTANT_TEAM_EMAIL_SENDER_NAME INSTANT_TEAM_EMAIL_SENDER_EMAIL
  STORAGE_IMAGE STORAGE_CLIENT_IMAGE POSTGRES_IMAGE SERVER_IMAGE DASHBOARD_IMAGE
)

stack_env=(PATH="$PATH")
for name in "${STACK_VARS[@]}"; do
  value=
  case $name in
    INSTANT_*)
      sidekick_name=SIDEKICK_${name#INSTANT_}
      value=${!sidekick_name:-}
      ;;
  esac
  stack_env+=("$name=${value:-${!name:-}}")
done

config=$(env -i "${stack_env[@]}" docker stack config --compose-file swarm.yml)

# SidekickDB: swarm.yml mounts the external secret server_config as the
# server's override.edn (the keys that encrypt app secrets and sign webhooks),
# and `docker stack deploy` refuses a stack whose external secret is missing.
# The script only checks for it and never creates or replaces it: the file is
# generated once and a copy kept, because a new one cannot read what the old
# one encrypted. SSH_HOST stays unquoted so it can carry ssh options.
# shellcheck disable=SC2086
secrets=$(ssh $SSH_HOST 'docker secret ls --format "{{.Name}}"')
if ! printf '%s\n' "$secrets" | grep -qx server_config; then
  server_image=${SERVER_IMAGE:-ghcr.io/sidekickdb/server:latest}
  cat >&2 <<EOF
The swarm on $SSH_HOST has no secret named server_config. swarm.yml mounts it
as the server's /app/resources/config/override.edn, which holds the keys that
encrypt app secrets and sign webhooks. Create it once, on the manager:

  mkdir -m 700 sidekick-config
  docker run --rm -v "\$PWD/sidekick-config:/out" $server_image \\
    /app/start.sh generate-override-config /out/override.edn
  docker secret create server_config sidekick-config/override.edn

Copy sidekick-config/override.edn somewhere safe (for example
scp $SSH_HOST:sidekick-config/override.edn .), then delete it from the
manager. Do not generate it again for this deployment: a new file cannot
decrypt what the old one encrypted. Then run this script again.
EOF
  exit 1
fi

# shellcheck disable=SC2086
printf '%s\n' "$config" | ssh $SSH_HOST 'docker stack deploy -c - instant'
