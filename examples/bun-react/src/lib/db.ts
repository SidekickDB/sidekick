import { init } from "@sidekickdb/react";
import schema from "../instant.schema";

export const db = init({
  appId: process.env.BUN_PUBLIC_INSTANT_APP_ID!,
  schema,
  useDateObjects: true,
});
