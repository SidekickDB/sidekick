export const isBrowser = typeof window != 'undefined';

const devBackend = getLocal('devBackend');

let localPort = '8888';

if (devBackend && isBrowser) {
  const portOverride = new URL(location.href).searchParams.get('port');
  if (portOverride) {
    localPort = portOverride;
  }
}

// There is no default server: outside of local development (the devBackend
// flag), the Explorer must be given an `apiURI`.
export const config: { apiURI?: string; websocketURI?: string } = {
  apiURI: getLocal('devBackend') ? `http://localhost:${localPort}` : undefined,
  websocketURI: getLocal('devBackend')
    ? `ws://localhost:${localPort}/runtime/session`
    : undefined,
};

export const isTouchDevice =
  typeof window !== 'undefined' && 'ontouchstart' in window;

export function getLocal(k: string) {
  if (!isBrowser) {
    return null;
  }

  try {
    const raw = localStorage.getItem(k);

    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function setLocal(k: string, v: any) {
  if (!isBrowser) {
    return;
  }

  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {
    return;
  }
}

export const localStorageFlagPrefix = `__instant__flag__`;

export const cliOauthParamName = '_cli_oauth_ticket';

export const discordInviteUrl = 'https://discord.com/invite/VU53p7uQcE';

export const discordOAuthAppsFeedbackInviteUrl =
  'https://discord.gg/GrvbPTBDEX';

export const bugsAndQuestionsInviteUrl = 'https://discord.gg/unA5vyV6mP';
