export default {
  title: "Wind-down (sunset) of Instant Cloud removed from the server and the dashboard",
  resolve:
    "Keep sunset.clj, sunset_test.clj, pages/intern/sunset.tsx, SunsetBanner.tsx and lib/sunset.ts deleted. " +
    "Delete again whatever upstream adds for the wind-down: " +
    "anything reading the flags sunset-stage, sunset-app-creation-allowed-emails or final-backup-status, the " +
    "/dash/sunset routes, sign-up, app-creation, claiming or checkout gates tied to the stage, " +
    "paid-features-free, the sunset field and effective_status of the dashboard responses and their dashboard " +
    "readers, the cancel reason sunset. Take upstream's other changes in these files, including anything about the per-app status " +
    "(apps.status, app-status-changed), backups and flags. removed_routes_test.clj, app_status_test.clj and " +
    "runtime_mode_test.clj must pass, and `git grep -n -i sunset -- server/src client/www/components " +
    "client/www/pages client/www/lib` must print only the essay word count in allExactCounts.json.",
};
