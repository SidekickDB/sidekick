export default {
  title: "Session-count WebSocket (/dash/session_counts) and its reporter removed",
  resolve:
    "Keep server/src/instant/session_counter.clj deleted, and the route and the start step in core.clj removed. " +
    "Take upstream's other changes in those files. server/test/instant/dash/removed_routes_test.clj must pass.",
};
