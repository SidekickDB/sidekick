export default {
  title:
    "SidekickDB release pipeline: npm trusted publishing and GHCR image workflows, flags-config and mcp private",
  resolve:
    "Upstream has none of these files except server/flags-config/package.json and " +
    "client/packages/mcp/package.json: keep \"private\": true in both and take upstream's other changes. Keep the release workflows' shape (check.mjs enforces it). " +
    "Keep SidekickDB's version in version.ts, not upstream's. Then run client/scripts/sidekick-release-npm.test.mjs: " +
    "if upstream raised a server version minimum above it, raise version.ts above that minimum (RELEASING.md).",
};
