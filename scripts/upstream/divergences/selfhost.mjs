export default {
  title:
    "Self-hosting defaults: RustFS object store, backups out of the box, no Instant AWS/email defaults, required secrets, JVM memory defaults, Google prefetch only when configured, DoH setting, neutral image tags, healthchecks, loopback-only Postgres and dev compose ports",
  resolve:
    "Keep the `storage` (RustFS) service, the required STORAGE_* variables as plain ${VAR:?message} " +
    "(never a :? inside a default: Compose 2.38 rejects that; nested :- defaults such as the SIDEKICK_* aliases " +
    "are fine; run scripts/self-hosting/render-check.mjs), the createbuckets " +
    "CORS rule, AWS_REQUEST_CHECKSUM_CALCULATION, the healthchecks and the unpublished Postgres port " +
    "(${POSTGRES_BIND_ADDRESS:-127.0.0.1}:8890 in docker-compose.yml, no ports in swarm.yml), the " +
    "127.0.0.1: prefix on every port in server/docker-compose-dev.yml, and the " +
    'UPGRADE_DB.md pg_dump that reads "$POSTGRES_USER" and "$POSTGRES_DB" from the container ' +
    "(and its intro paragraph that says nothing needs substituting). " +
    "Keep the ghcr.io/sidekickdb image defaults in the compose files, swarm.yml, server/docker-compose-dev.yml " +
    "and the clojure.yml Postgres service; if upstream changes an image tag, release that tag from SidekickDB first. " +
    "In client/www/app/docs/self-hosting keep SidekickDB's wording (Instant Cloud only for upstream's hosted " +
    "service), the SIDEKICK_* names, ghcr.io/sidekickdb images and example.com hosts; write upstream's changes " +
    "into that text and check each command against the shipped files. " +
    'In server config keep "no default ' +
    "outside tests\" for buckets, ARNs and sender addresses. Port upstream's new settings into that form. " +
    "Keep the required POSTGRES_PASSWORD, mem_limit and the default JAVA_OPTS (PR #13). " +
    "In deploy-swarm.sh keep bash with set -euo pipefail, STACK_VARS listing every variable swarm.yml reads " +
    "(add upstream's new ones; scripts/self-hosting/deploy-swarm.test.mjs names them) and the check that " +
    "stops when the server_config secret is missing without ever creating or replacing it. In jwt.clj and " +
    "oauth.clj keep the dashboard-google-oauth-configured? condition around the boot prefetch; in config.clj " +
    "and webhook_sender.clj keep INSTANT_DNS_OVER_HTTPS_URLS and no system-resolver fallback after a failed " +
    "DoH lookup.",
};
