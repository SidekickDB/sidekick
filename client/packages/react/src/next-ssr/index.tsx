import {
  InstantConfig,
  InstantSchemaDef,
  InstantUnknownSchema,
} from '@sidekickdb/core';

import version from '../version.ts';

import { InstantNextDatabase } from './InstantNextDatabase.tsx';

export {
  getUnverifiedUserFromInstantCookie,
  getUserFromInstantCookie,
} from './getUserFromInstantCookie.ts';

export { InstantNextDatabase } from './InstantNextDatabase.tsx';
export { InstantSuspenseProvider } from './InstantSuspenseProvider.tsx';

export { createInstantRouteHandler } from '@sidekickdb/core';

/**
 *
 * The first step: init your application!
 *
 * Find your `appId` in your SidekickDB dashboard.
 *
 * @example
 *  import { init } from "@sidekickdb/react"
 *
 *  const db = init({ appId: "my-app-id", apiURI: "https://sidekick.example.com" })
 *
 *  // You can also provide a schema for type safety and editor autocomplete!
 *
 *  import { init } from "@sidekickdb/react"
 *  import schema from ""../instant.schema.ts";
 *
 *  const db = init({ appId: "my-app-id", apiURI: "https://sidekick.example.com", schema })
 *
 *  // To learn more: https://sidekickdb.co/docs/modeling-data
 */
export function init<
  Schema extends InstantSchemaDef<any, any, any> = InstantUnknownSchema,
  UseDates extends boolean = false,
>(
  // Allows config with missing `useDateObjects`, but keeps `UseDates`
  // as a non-nullable in the InstantConfig type.
  config: Omit<InstantConfig<Schema, UseDates>, 'useDateObjects'> & {
    useDateObjects?: UseDates;
  },
): InstantNextDatabase<Schema, UseDates> {
  return new InstantNextDatabase<Schema, UseDates>(config, {
    '@instantdb/react': version,
  });
}
