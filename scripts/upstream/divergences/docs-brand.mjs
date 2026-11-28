export default {
  title: "Docs pages: SidekickDB name and links",
  resolve:
    "Keep SidekickDB's words and links in client/www/app/docs (self-hosting aside), " +
    "components/docs, DocsPage.jsx and docsNavigation.js; the docs-host rule rewrites upstream's absolute docs " +
    "links there. A new www.instantdb.com/dash link becomes the same path relative (/dash...); a new " +
    "api.instantdb.com URL in prose or inline code becomes https://sidekick.example.com and the page " +
    "keeps its sentence about the server URL (a URL in a code fence, callbacks included, gets " +
    "__API_URI__); keep start-python/page.md deleted; remove new links to " +
    "Discord, essays, pricing, recipes or the examples gallery; check a new sentence about Instant's " +
    "hosted service against the server and write what a self-hosted server does, or drop it; " +
    "never invent a URL. using-llms: no hosted MCP server and no Instant skill; @sidekickdb/mcp is " +
    "unpublished, so keep the build-from-checkout steps and --api-url in the samples. Keep the " +
    "'// Instant app' marker that Fence.jsx matches. Identifiers, file names, " +
    "environment variables, X-Instant-* headers and API names stay upstream's. Docs samples pass " +
    "apiURI: '__API_URI__' (Fence.jsx fills it in); give a sample upstream adds the same, docs-samples.test.ts " +
    "names any that lacks it. Links to files the dashboard serves (llms-full.txt) stay relative.",
};
