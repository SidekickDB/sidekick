export default {
  title:
    "JS tests run offline in CI behind a network guard; networked suites only with SIDEKICK_E2E_API_URI",
  resolve:
    "Keep the \"Run tests\" step's SIDEKICK_E2E_API_URI: '' and SIDEKICK_NETWORK_GUARD_ALLOW: '', the " +
    "client test/bench scripts that run through scripts/with-network-guard.mjs, and the e2e helpers that " +
    "skip without SIDEKICK_E2E_API_URI and have no default host. A new upstream e2e suite must be gated the " +
    "same way (skip unless SIDEKICK_E2E_API_URI is set, pass it explicitly to every client).",
};
