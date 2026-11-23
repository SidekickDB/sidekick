/**
 * SidekickDB names for environment variables.
 *
 * Every variable with `INSTANT_` in its name can also be set with `SIDEKICK_`
 * in that place: `SIDEKICK_CLI_API_URI` for `INSTANT_CLI_API_URI`,
 * `NEXT_PUBLIC_SIDEKICK_APP_ID` for `NEXT_PUBLIC_INSTANT_APP_ID`, and so on.
 * The `SIDEKICK_` name wins when both are set; a blank value counts as unset.
 *
 * The rest of the CLI keeps reading the `INSTANT_` names, so that its source
 * stays close to upstream. `applyEnvAliases` copies each `SIDEKICK_` value onto
 * its `INSTANT_` name once, right after the env files are loaded.
 */

const SIDEKICK_NAME = /^((?:[A-Z0-9]+_)*?)SIDEKICK_([A-Z0-9_]+)$/;

/** `INSTANT_` name that `name` stands for, or null when it is not an alias. */
export function legacyEnvName(name: string): string | null {
  const match = SIDEKICK_NAME.exec(name);
  return match ? `${match[1]}INSTANT_${match[2]}` : null;
}

// INSTANT_ name -> the SIDEKICK_ name its value came from.
const applied = new Map<string, string>();

/**
 * Copies every `SIDEKICK_` variable in `env` onto its `INSTANT_` name.
 * Returns the names it set, as `INSTANT_` name -> `SIDEKICK_` name.
 */
export function applyEnvAliases(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    const legacyName = legacyEnvName(name);
    if (!legacyName || value === undefined || value.trim() === '') {
      continue;
    }
    env[legacyName] = value;
    result[legacyName] = name;
    if (env === process.env) {
      applied.set(legacyName, name);
    }
  }
  return result;
}

/**
 * The name to show for an `INSTANT_` variable: the `SIDEKICK_` name when the
 * value was set under it, otherwise the name itself.
 */
export function envNameForDisplay(legacyName: string): string {
  return applied.get(legacyName) ?? legacyName;
}
