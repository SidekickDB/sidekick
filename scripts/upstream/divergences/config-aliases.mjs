export default {
  title:
    "Configuration names: SIDEKICK_* and sidekick.* accepted as aliases",
  resolve:
    "The source keeps upstream's INSTANT_* names; only the lookup differs. Server: keep env/getenv " +
    "(instant.util.env) wherever an INSTANT_* variable is read, and use it for a variable upstream adds. " +
    "Self-hosting compose files: keep ${SIDEKICK_X:-${INSTANT_X:-default}} and give a new INSTANT_* " +
    "variable the same form (not in swarm.yml: docker stack cannot nest defaults; add it to " +
    "deploy-swarm.sh instead). CLI: keep applyEnvAliases in loadEnv.ts, withSidekickFileNames in " +
    "findConfigCandidates.ts and the sidekick.config source in instantConfig.ts; a new instant.* file " +
    "kind must be added to LEGACY_CONFIG_FILE. Take upstream's other changes.",
};
