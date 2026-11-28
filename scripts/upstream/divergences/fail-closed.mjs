export default {
  title:
    "Clients fail closed: no default server URL",
  resolve:
    "Keep SidekickDB's side: init()/clients require apiURI (websocketURI derived from it), the CLI needs " +
    "INSTANT_CLI_API_URI or instant.config.ts, MCP needs --api-url/INSTANT_API_URL, the devtool loads " +
    "nothing without devtool.dashURI. If upstream adds a client, option or command that reaches a server, " +
    "make it take the URL explicitly and fail without it. Never re-add a default that points at " +
    "instantdb.com. check.mjs fails on Instant hosts added to package sources.",
};
