export default {
  title:
    "Two-node smoke test",
  resolve:
    "Upstream has none of these files. If upstream changes self-hosting/docker-compose.yml, swarm.yml, " +
    "server/Dockerfile.self-hosted or how init-hz discovers peers (SWARM_SERVICE_NAME, tasks.<name>, ports " +
    "5701/5801), keep upstream's change and adapt compose.two-node.yml or run.mjs, then run the workflow.",
};
