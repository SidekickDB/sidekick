import dotenvFlow from 'dotenv-flow';
import { applyEnvAliases } from './envAliases.ts';

// index.ts imports this module first, so this runs before any other module is
// evaluated: some of them read INSTANT_ variables when they load.
applyEnvAliases();

export const loadEnv = () => {
  const envIndex = process.argv.indexOf('--env');
  const envFile = envIndex !== -1 ? process.argv[envIndex + 1] : undefined;

  dotenvFlow.config({
    silent: true,
    files: envFile ? [envFile] : undefined,
  });

  // After the env files: a SIDEKICK_ variable can come from them too.
  applyEnvAliases();
};
