export default {
  title:
    "CI lockdown: publish/deploy jobs disabled, no secrets or timing writes, job timeouts, detect_changes merge base, runs on main and pull requests only",
  resolve:
    'Keep every line marked "# SidekickDB:" / "// SidekickDB:". Take upstream\'s other changes. ' +
    "A new or changed publish/deploy job gets `if: false && (<upstream condition>)`; a new publish-only " +
    'workflow gets its triggers commented out (workflow_dispatch only). Never re-enable "Fetch timings". ' +
    "Keep the clj-check-result job in clojure.yml (the ruleset on main requires it); if upstream renames " +
    "clj-check, update its `needs`. Then run scripts/upstream/check.mjs.",
};
