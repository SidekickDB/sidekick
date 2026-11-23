import { schemaTypescriptFileToInstantSchema } from '@sidekickdb/platform';
import { version } from '@sidekickdb/version';

const dev = Boolean(process.env.INSTANT_CLI_DEV);

// There is no default server or dashboard: both come from the environment
// (or INSTANT_CLI_DEV for local development).
export const instantDashOrigin: string | null =
  process.env.INSTANT_CLI_DASH_URI || (dev ? 'http://localhost:3000' : null);

export const instantBackendOrigin: string | null =
  process.env.INSTANT_CLI_API_URI || (dev ? 'http://localhost:8888' : null);

export const missingBackendOriginMessage =
  'No SidekickDB server URL configured. Set the INSTANT_CLI_API_URI ' +
  'environment variable, for example ' +
  'INSTANT_CLI_API_URI=https://sidekick.example.com. ' +
  'SidekickDB has no default server.';

export const missingDashOriginMessage =
  'No SidekickDB dashboard URL configured. Set the INSTANT_CLI_DASH_URI ' +
  'environment variable, for example ' +
  'INSTANT_CLI_DASH_URI=https://dash.sidekick.example.com. ' +
  'SidekickDB has no default dashboard.';

export function requireBackendOrigin(): string {
  if (!instantBackendOrigin) {
    throw new Error(missingBackendOriginMessage);
  }
  return instantBackendOrigin;
}

export function requireDashOrigin(): string {
  if (!instantDashOrigin) {
    throw new Error(missingDashOriginMessage);
  }
  return instantDashOrigin;
}

export type ScaffoldMetadata = {
  template?: string;
  aiTool?: string;
  usedAiPrompt?: boolean;
  rules?: { code: Record<string, any> } | null;
  schema?: ReturnType<typeof schemaTypescriptFileToInstantSchema> | null;
};

export async function fetchJson<T>({
  path,
  body,
  method = 'GET',
  authToken,
  metadata,
}: {
  path: string;
  body?: any;
  method?: 'POST' | 'GET';
  authToken: string | null;
  metadata?: ScaffoldMetadata;
}): Promise<T> {
  const timeoutMs = 1000 * 60 * 5; // 5 minutes

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Instant-Source': 'create-instant-app',
    'X-Instant-Version': version,
    'X-Instant-Command': 'create',
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  if (metadata) {
    headers['X-Instant-Metadata'] = JSON.stringify(metadata);
  }

  const res = await fetch(`${requireBackendOrigin()}${path}`, {
    method: method ?? 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message: string =
      data.message || data.hint?.errors?.[0]?.message || 'There was an error';
    throw new Error(message);
  }

  return data;
}
