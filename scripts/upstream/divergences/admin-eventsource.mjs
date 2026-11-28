export default {
  title:
    "Own copy of eventsource in @sidekickdb/admin",
  resolve:
    "Keep @instantdb/eventsource out of client/packages/admin/package.json and the imports on " +
    "./eventsource/index.ts. If upstream bumps or changes the package, diff its src " +
    "(npm pack @instantdb/eventsource@<version>) against client/packages/admin/src/eventsource/ and " +
    "bring over what admin needs, keeping the messageEvent option and the LICENSE. Let pnpm " +
    "regenerate client/pnpm-lock.yaml.",
};
