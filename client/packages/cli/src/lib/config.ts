import { Config, Effect, Option, Schema } from 'effect';
import { oauthCallbackURL } from '@sidekickdb/platform';
import { BadArgsError } from '../errors.ts';
import { readInstantConfigFile } from '../util/instantConfig.ts';

const HttpUrl = Schema.URL.pipe(
  Schema.filter(
    (url) =>
      url.protocol === 'http:' ||
      url.protocol === 'https:' ||
      'Expected an HTTP(S) URL',
  ),
);

export const missingApiUrlMessage =
  'No SidekickDB server URL configured. Set the SIDEKICK_CLI_API_URI ' +
  'environment variable (for example SIDEKICK_CLI_API_URI=https://sidekick.example.com; ' +
  'its older name, INSTANT_CLI_API_URI, works too) ' +
  'or add `apiURI` to sidekick.config.ts or instant.config.ts. SidekickDB has no default server.';

export const missingDashUrlMessage =
  'No SidekickDB dashboard URL configured. Set the SIDEKICK_CLI_DASH_URI ' +
  'environment variable (for example SIDEKICK_CLI_DASH_URI=https://dash.sidekick.example.com; ' +
  'its older name, INSTANT_CLI_DASH_URI, works too) ' +
  'or add `dashURI` to sidekick.config.ts or instant.config.ts. SidekickDB has no default dashboard.';

export const getBaseUrl = Effect.gen(function* () {
  const setEnv = yield* Config.string('INSTANT_CLI_API_URI').pipe(
    Config.option,
  );
  const dev = yield* Config.boolean('INSTANT_CLI_DEV').pipe(
    Config.withDefault(false),
  );

  // SidekickDB: a blank value counts as unset.
  if (Option.isSome(setEnv) && setEnv.value.trim() !== '') {
    return setEnv.value;
  }

  const instantConfig = yield* Effect.tryPromise(readInstantConfigFile);
  if (instantConfig?.apiURI !== undefined) {
    yield* Schema.decodeUnknown(HttpUrl)(instantConfig.apiURI).pipe(
      Effect.mapError(() =>
        BadArgsError.make({
          message:
            'Invalid apiURI in instant.config.ts. Expected a valid HTTP(S) URL.',
        }),
      ),
    );
    return instantConfig.apiURI;
  }

  if (dev) {
    return 'http://localhost:8888';
  }

  return yield* BadArgsError.make({ message: missingApiUrlMessage });
});

export const getOAuthCallbackUrl = getBaseUrl.pipe(
  Effect.map(oauthCallbackURL),
);

/**
 * Dashboard URL from INSTANT_CLI_DASH_URI, instant.config.ts or
 * INSTANT_CLI_DEV, or `Option.none()` when none of them is set.
 */
export const getOptionalDashUrl = Effect.gen(function* () {
  const setEnv = yield* Config.string('INSTANT_CLI_DASH_URI').pipe(
    Config.option,
  );
  const dev = yield* Config.boolean('INSTANT_CLI_DEV').pipe(
    Config.withDefault(false),
  );

  // SidekickDB: a blank value counts as unset.
  if (Option.isSome(setEnv) && setEnv.value.trim() !== '') {
    return Option.some(setEnv.value);
  }

  const instantConfig = yield* Effect.tryPromise(readInstantConfigFile);
  if (instantConfig?.dashURI !== undefined) {
    yield* Schema.decodeUnknown(HttpUrl)(instantConfig.dashURI).pipe(
      Effect.mapError(() =>
        BadArgsError.make({
          message:
            'Invalid dashURI in instant.config.ts. Expected a valid HTTP(S) URL.',
        }),
      ),
    );
    return Option.some(instantConfig.dashURI);
  }

  if (dev) {
    return Option.some('http://localhost:3000');
  }

  return Option.none<string>();
});

export const getDashUrl = getOptionalDashUrl.pipe(
  Effect.flatMap((dashUrl) =>
    Option.isSome(dashUrl)
      ? Effect.succeed(dashUrl.value)
      : BadArgsError.make({ message: missingDashUrlMessage }),
  ),
);
