/**
 * SidekickDB names for environment variables.
 *
 * Every variable with `INSTANT_` in its name can also be set with `SIDEKICK_`
 * in that place: `SIDEKICK_CLI_API_URI` for `INSTANT_CLI_API_URI`, and so on.
 * The `SIDEKICK_` name wins when both are set; a blank value counts as unset.
 *
 * The rest of this package keeps reading the `INSTANT_` names, so that its
 * source stays close to upstream. Importing this module copies each
 * `SIDEKICK_` value onto its `INSTANT_` name. index.ts imports it first,
 * because other modules read their variables when they load.
 *
 * The same rule as in @sidekickdb/cli (src/util/envAliases.ts).
 */

const SIDEKICK_NAME = /^((?:[A-Z0-9]+_)*?)SIDEKICK_([A-Z0-9_]+)$/;

/** `INSTANT_` name that `name` stands for, or null when it is not an alias. */
export function legacyEnvName(name: string): string | null {
  const match = SIDEKICK_NAME.exec(name);
  return match ? `${match[1]}INSTANT_${match[2]}` : null;
}

/** Copies every `SIDEKICK_` variable in `env` onto its `INSTANT_` name. */
export function applyEnvAliases(
  env: Record<string, string | undefined> = process.env,
): void {
  for (const [name, value] of Object.entries(env)) {
    const legacyName = legacyEnvName(name);
    if (!legacyName || value === undefined || value.trim() === '') {
      continue;
    }
    env[legacyName] = value;
  }
}

applyEnvAliases();
