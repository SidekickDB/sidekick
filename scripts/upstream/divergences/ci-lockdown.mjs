export default {
  title:
    "CI lockdown",
  resolve:
    'Keep every line marked "# SidekickDB:" / "// SidekickDB:". Take upstream\'s other changes. ' +
    "A new or changed publish/deploy job gets `if: false && (<upstream condition>)`; a new publish-only " +
    'workflow gets its triggers commented out (workflow_dispatch only). Never re-enable "Fetch timings". ' +
    "Keep the clj-check-result job in clojure.yml (the ruleset on main requires it); if upstream renames " +
    "clj-check, update its `needs`. In js.yml keep the turbo restore/save split, the main-only saves, " +
    "the pnpm save skipped on a cache hit and the prune-turbo-cache job (no checkout, no action; " +
    "JOB_RIGHTS in check.mjs); if upstream renames `build`, update its `needs`. " +
    "Then run scripts/upstream/check.mjs.",
};
