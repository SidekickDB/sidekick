import { loadConfig } from './loadConfig.ts';

export type InstantConfig = {
  apiURI?: string;
  dashURI?: string;
  apps?: Record<string, { id: string }>;
};

export async function readInstantConfigFile() {
  return (
    await loadConfig<InstantConfig>({
      // sidekick.config.* is the SidekickDB name for instant.config.*. With
      // `merge: false` the first source that exists is used, so it wins.
      sources: ['sidekick.config', 'instant.config'].map((files) => ({
        files,
        extensions: ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs', 'json'],
      })),
      merge: false,
    })
  ).config;
}
