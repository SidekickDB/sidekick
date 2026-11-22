import type { InstantConfig, InstantSchemaDef } from '@sidekickdb/core';
import { InstantReactAbstractDatabase } from '@sidekickdb/react-common';
import { EventSource } from 'eventsource';

export default class InstantReactWebDatabase<
  Schema extends InstantSchemaDef<any, any, any>,
  UseDates extends boolean = false,
  Config extends InstantConfig<Schema, UseDates> = InstantConfig<
    Schema,
    UseDates
  >,
> extends InstantReactAbstractDatabase<Schema, UseDates, Config> {
  static EventSourceImpl = EventSource;
}
