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

/**
 * Derives the websocket URL from the API URL:
 * `https://host/prefix` becomes `wss://host/prefix/runtime/session` and
 * `http://` becomes `ws://`.
 */
export function websocketURIFromApiURI(apiURI: string): string {
  let url: URL;
  try {
    url = new URL(apiURI);
  } catch (_e) {
    throw new InstantError(
      `Invalid apiURI ${JSON.stringify(apiURI)}: expected an http(s) URL. ` +
        'Pass `websocketURI` as well if you need a custom websocket URL.',
    );
  }
  if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  } else if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  } else {
    throw new InstantError(
      `Invalid apiURI ${JSON.stringify(apiURI)}: expected an http(s) URL. ` +
        'Pass `websocketURI` as well if you need a custom websocket URL.',
    );
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/runtime/session`;
  url.search = '';
  url.hash = '';
  return url.toString();
}
