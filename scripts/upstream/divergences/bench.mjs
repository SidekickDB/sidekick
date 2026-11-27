export default {
  title:
    "Self-hosted stack benchmark: harness in scripts/bench/self-hosted and a read-only workflow",
  resolve:
    "Upstream has none of these files. If upstream changes self-hosting/docker-compose.yml, " +
    "server/Dockerfile.self-hosted, client/Dockerfile.www or @sidekickdb/core's init()/subscribeQuery " +
    "in a way the harness depends on, keep upstream's change and adjust run.mjs or workload.mjs; " +
    "re-run the workflow and compare against the last kept result only on the same runner label.",
};
