export default {
  title:
    "SidekickDB's own fixes: flaky or hanging tests on 2-vCPU runners, timed-out refreshes keep and redeliver subscriptions (#2932), attr-sketch loads off the common pool, presence refresh combine keeps snapshots, wal2json allowed in the Postgres image, signing-key refresh runs, team and transfer invites sent through the email router, unmatched routes get the 404, essay preview route development-only",
  resolve:
    "Keep SidekickDB's fix unless upstream fixed the same problem; then take upstream's version. Take " +
    "upstream's new tests as they are. server/dev-postgres: keep sidekick-entrypoint.sh and the ENTRYPOINT " +
    "unless upstream's image allows wal2json another way (start the self-hosting stack to check).",
};
