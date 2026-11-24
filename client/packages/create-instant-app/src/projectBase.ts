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
    bundled: false,
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

// SidekickDB: starters that are not offered and not bundled. Their entries
// above stay, so the code that handles them merges cleanly with upstream.
// - python-script installs Instant's `instantdb` package from PyPI, and
//   SidekickDB releases no Python SDK.
// - vercel-ai-sdk is built on Instant's hosted services: without a model key
//   it sends the prompt to api.instantdb.com, and its preview creates apps
//   through the platform API with no server URL.
const unavailableProjectBases: ProjectBase[] = [
  'python-script',
  'vercel-ai-sdk',
];

export const projectBases = (
  Object.keys(projectBaseConfig) as ProjectBase[]
).filter((base) => !unavailableProjectBases.includes(base));

export const bundledProjectBases = projectBases.filter(
  (base) => projectBaseConfig[base].bundled,
);
