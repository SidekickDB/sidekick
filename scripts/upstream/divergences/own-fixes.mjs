export default {
  title:
    "SidekickDB's own fixes",
  resolve:
    "Keep SidekickDB's fix unless upstream fixed the same problem; then take upstream's version. Take " +
    "upstream's new tests as they are. server/dev-postgres: keep sidekick-entrypoint.sh and the ENTRYPOINT " +
    "unless upstream's image allows wal2json another way (start the self-hosting stack to check).",
};
