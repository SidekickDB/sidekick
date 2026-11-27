export default {
  title: "Self-hosted runtime mode (INSTANT_RUNTIME_MODE / SIDEKICK_RUNTIME_MODE)",
  resolve:
    "Keep config.clj's runtime-mode helpers and their call sites: the skip check in core.clj's with-log-init, " +
    "dev-only? instead of dev? in sse.clj, session.clj, app_stream.clj and wrap-dev-server-info, secure-cookies? " +
    "at the three OAuth cookie sites, exit-on-startup-error? in -main. A new upstream startup step makes " +
    "runtime_mode_test.clj fail: decide whether self-hosted skips it, then update the recorded count and hash.",
};
