export default {
  title: "create-sidekick-app does not offer or bundle the Python starter; docs say the Python SDK is Instant's",
  resolve:
    "Keep unavailableProjectBases in create-instant-app/src/projectBase.ts with python-script in it, and no " +
    "--python option or menu entry in cli.ts. Take upstream's other changes to the Python handling as they " +
    "are (it stays unreachable). Keep the Python docs page out of docsNavigation.js and keep its note. If " +
    "upstream adds another starter that installs a package SidekickDB does not release, add it to the list.",
};
