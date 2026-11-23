import { InstantError } from './InstantError.ts';

/**
 * SidekickDB has no default server. Every client has to be told which server
 * to talk to; when it isn't, we throw this error instead of falling back to a
 * hosted service.
 */
export class MissingApiURIError extends InstantError {
  constructor(message: string) {
    super(message);
    this.name = 'MissingApiURIError';
  }

  get [Symbol.toStringTag]() {
    return 'MissingApiURIError';
  }
}

export type RequireApiURIOpts = {
  /** Where the URL is passed, e.g. `init()` or `new PlatformApi()`. */
  target: string;
  /** Name of the option to set. Defaults to `apiURI`. */
  option?: string;
  /** Environment variable that is read as a fallback, if there is one. */
  envVar?: string;
};

export function missingApiURIMessage({
  target,
  option = 'apiURI',
  envVar,
}: RequireApiURIOpts): string {
  const how = envVar
    ? `Pass \`${option}\` to ${target} or set the ${envVar} environment variable`
    : `Pass \`${option}\` to ${target}`;
  return (
    `No SidekickDB server URL configured. ${how}, ` +
    `for example ${option}: 'https://sidekick.example.com'. ` +
    'SidekickDB has no default server.'
  );
}

/**
 * Returns `apiURI` unchanged when it is set, and throws a
 * {@link MissingApiURIError} that names the option to set when it is not.
 */
export function requireApiURI(
  apiURI: string | null | undefined,
  opts: RequireApiURIOpts,
): string {
  if (typeof apiURI === 'string' && apiURI.trim() !== '') {
    return apiURI;
  }
  throw new MissingApiURIError(missingApiURIMessage(opts));
}

function invalidApiURIError(apiURI: string): InstantError {
  return new InstantError(
    `Invalid apiURI ${JSON.stringify(apiURI)}: expected an http(s) URL. ` +
      'Pass `websocketURI` as well if you need a custom websocket URL.',
  );
}

// scheme://authority path, stopping at the query or fragment.
const API_URI_RE = /^(https?):\/\/([^/?#]+)([^?#]*)/i;

/**
 * Derives the websocket URL from the API URL:
 * `https://host/prefix` becomes `wss://host/prefix/runtime/session` and
 * `http://` becomes `ws://`. Query and fragment are dropped, trailing slashes
 * trimmed; ports, path prefixes and IPv6 brackets are kept.
 *
 * Uses string operations only: React Native's built-in `URL` does not
 * implement (or allow setting) `protocol`, `pathname`, `search` or `hash`.
 */
export function websocketURIFromApiURI(apiURI: string): string {
  const match = API_URI_RE.exec(apiURI.trim());
  if (!match) {
    throw invalidApiURIError(apiURI);
  }
  const scheme = match[1].toLowerCase();
  let authority = match[2];
  const path = match[3];

  // Normalise the host like the WHATWG URL parser: lowercase it and drop
  // the scheme's default port (ws/wss share http/https default ports).
  const at = authority.lastIndexOf('@');
  const userinfo = at === -1 ? '' : authority.slice(0, at + 1);
  let host = (at === -1 ? authority : authority.slice(at + 1)).toLowerCase();
  if (!host || host.startsWith(':')) {
    throw invalidApiURIError(apiURI);
  }
  const defaultPort = scheme === 'https' ? ':443' : ':80';
  if (host.endsWith(defaultPort)) {
    host = host.slice(0, -defaultPort.length);
  }
  authority = userinfo + host;

  const wsScheme = scheme === 'https' ? 'wss' : 'ws';
  return `${wsScheme}://${authority}${path.replace(/\/+$/, '')}/runtime/session`;
}
