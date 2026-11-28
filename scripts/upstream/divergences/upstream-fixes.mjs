export default {
  title:
    "Upstream fixes taken early",
  resolve:
    "Upstream may have merged the same PR (the report says so) or fixed the issue its own way. Same patch: " +
    "git merges it, and sync.mjs keeps ours where SidekickDB changed the file afterwards. Different fix: " +
    "take upstream's and drop ours (and a test of ours that now duplicates upstream's), but keep a " +
    "SidekickDB follow-up that upstream lacks. Re-run the affected tests.",
};
