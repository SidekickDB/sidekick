export default {
  title:
    "Upstream fixes cherry-picked before upstream merged them (batch 1, batch 2, IndexedDB error handling, permission field subscriptions, Explorer exponent numbers) and their follow-ups",
  resolve:
    "Upstream may have merged the same PR (the report says so) or fixed the issue its own way. Same patch: " +
    "git merges it, and sync.mjs keeps ours where SidekickDB changed the file afterwards. Different fix: " +
    "take upstream's and drop ours (and a test of ours that now duplicates upstream's), but keep a " +
    "SidekickDB follow-up that upstream lacks. Re-run the affected tests.",
};
