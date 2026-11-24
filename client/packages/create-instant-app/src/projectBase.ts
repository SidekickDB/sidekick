export type BackendConfigFile =
  | {
      type: 'typescript';
      path: string;
      initializer: string;
      websocket: boolean;
      injectDevtoolConfig: boolean;
    }
  | {
      type: 'python';
      path: string;
    };

type ProjectBaseConfig = {
  appIdEnvName: string;
  backendConfigFiles: BackendConfigFile[];
  bundled: boolean;
};

const clientDb = (
  path = 'src/lib/db.ts',
  options: { injectDevtoolConfig?: boolean } = {},
): BackendConfigFile => ({
  type: 'typescript',
  path,
  initializer: 'init',
  websocket: true,
  injectDevtoolConfig: options.injectDevtoolConfig ?? true,
});

const adminDb = (initializer = 'init'): BackendConfigFile => ({
  type: 'typescript',
  path: 'src/lib/adminDb.ts',
  initializer,
  websocket: false,
  injectDevtoolConfig: false,
});

export const projectBaseConfig = {
  'next-js-app-dir': {
    appIdEnvName: 'NEXT_PUBLIC_INSTANT_APP_ID',
    backendConfigFiles: [clientDb()],
    bundled: true,
  },
  'vite-react': {
    appIdEnvName: 'VITE_INSTANT_APP_ID',
    backendConfigFiles: [clientDb()],
    bundled: true,
  },
  'vite-vanilla': {
    appIdEnvName: 'VITE_INSTANT_APP_ID',
    backendConfigFiles: [clientDb()],
    bundled: true,
  },
  expo: {
    appIdEnvName: 'EXPO_PUBLIC_INSTANT_APP_ID',
    backendConfigFiles: [clientDb('lib/db.ts', { injectDevtoolConfig: false })],
    bundled: true,
  },
  'tanstack-start': {
    appIdEnvName: 'VITE_INSTANT_APP_ID',
    backendConfigFiles: [clientDb(), adminDb()],
    bundled: true,
  },
  'tanstack-start-with-tanstack-query': {
    appIdEnvName: 'VITE_INSTANT_APP_ID',
    backendConfigFiles: [clientDb(), adminDb()],
    // SidekickDB: bundled, so that no starter is downloaded at run time.
    bundled: true,
  },
  'bun-react': {
    appIdEnvName: 'BUN_PUBLIC_INSTANT_APP_ID',
    backendConfigFiles: [clientDb()],
    // SidekickDB: bundled, so that no starter is downloaded at run time.
    bundled: true,
  },
  'solidjs-vite': {
    appIdEnvName: 'VITE_INSTANT_APP_ID',
    backendConfigFiles: [clientDb()],
    // SidekickDB: bundled, so that no starter is downloaded at run time.
    bundled: true,
  },
  sveltekit: {
    appIdEnvName: 'VITE_INSTANT_APP_ID',
    backendConfigFiles: [clientDb()],
    bundled: true,
  },
  'vue-vite': {
    appIdEnvName: 'VITE_INSTANT_APP_ID',
    backendConfigFiles: [clientDb()],
    bundled: true,
  },
  'vercel-ai-sdk': {
    appIdEnvName: 'NEXT_PUBLIC_INSTANT_APP_ID',
    backendConfigFiles: [clientDb(), adminDb('initAdmin')],
    // SidekickDB: bundled, so that no starter is downloaded at run time.
    bundled: true,
  },
  'ai-chat': {
    appIdEnvName: 'NEXT_PUBLIC_INSTANT_APP_ID',
    backendConfigFiles: [clientDb(), adminDb()],
    // SidekickDB: bundled, so that no starter is downloaded at run time.
    bundled: true,
  },
  'python-script': {
    appIdEnvName: 'INSTANT_APP_ID',
    backendConfigFiles: [{ type: 'python', path: 'main.py' }],
    bundled: true,
  },
} satisfies Record<string, ProjectBaseConfig>;

export type ProjectBase = keyof typeof projectBaseConfig;

// SidekickDB: the Python starter is not offered and not bundled. It installs
// Instant's `instantdb` package from PyPI, and SidekickDB releases no Python
// SDK. Its entry above stays, so the code that handles it merges cleanly with
// upstream.
const unavailableProjectBases: ProjectBase[] = ['python-script'];

export const projectBases = (
  Object.keys(projectBaseConfig) as ProjectBase[]
).filter((base) => !unavailableProjectBases.includes(base));

export const bundledProjectBases = projectBases.filter(
  (base) => projectBaseConfig[base].bundled,
);
