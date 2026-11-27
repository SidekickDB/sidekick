export default {
  title:
    "Docs pages and their chrome present the product as SidekickDB and link to SidekickDB's docs host, the reader's dashboard and server",
  resolve:
    "Keep SidekickDB's words and links in client/www/app/docs (self-hosting and start-python aside), " +
    "components/docs, DocsPage.jsx and docsNavigation.js; the docs-host rule rewrites upstream's absolute docs " +
    "links there. A new www.instantdb.com/dash link becomes the same path relative (/dash...); a new " +
    "api.instantdb.com URL in a sample becomes https://sidekick.example.com and the page keeps its sentence " +
    "about the server URL; remove new links to Discord, essays, pricing, recipes or the examples gallery; " +
    "never invent a URL. Keep the '// Instant app' marker that Fence.jsx matches. Identifiers, file names, " +
    "environment variables, X-Instant-* headers and API names stay upstream's.",
};
