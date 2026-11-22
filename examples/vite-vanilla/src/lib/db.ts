// Initialize the database

import { init } from "@sidekickdb/core";
import schema from "../instant.schema";

// ---------
export const db = init({
  appId: import.meta.env.VITE_INSTANT_APP_ID,
  schema,
  useDateObjects: true,
});
