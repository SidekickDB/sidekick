export default {
  title:
    "Starters bundled with create-sidekick-app",
  resolve:
    "Keep `bundled: true` on every offered base in create-instant-app/src/projectBase.ts, also on a base upstream " +
    "adds, and keep SidekickDB/sidekick as the repository in scaffold.ts. Keep examples/bun-react on " +
    "`latest` and without bun.lock; if upstream changes that lockfile, delete it again. Keep vercel-ai-sdk in " +
    "unavailableProjectBases (it calls api.instantdb.com and needs Instant's platform API) and the " +
    "User-Agent edit in examples/ai-chat/src/lib/mockModel.ts.",
};
