import { init } from "@sidekickdb/react";
import schema from "../instant.schema";

export const clientDb = init({
  appId: import.meta.env.VITE_INSTANT_APP_ID!,
  schema,
  useDateObjects: true,
  firstPartyPath: "/api/instant",
});
