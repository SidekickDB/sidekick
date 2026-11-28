// SidekickDB: @monaco-editor/react loads Monaco from a CDN unless told
// otherwise. Load it from the dashboard's own copy, which
// scripts/copy-editor-assets.mjs puts in public/monaco.
import { loader } from '@monaco-editor/react';

export const monacoPath = '/monaco';

// The path must be an absolute URL: Monaco's language workers start from a
// blob: URL and load their code from this path, so a path like /monaco/vs has
// nothing to resolve against there. It stays on the page's own origin.
export function monacoVsUrl(origin: string) {
  return new URL(`${monacoPath}/vs`, origin).toString();
}

if (typeof window !== 'undefined') {
  loader.config({ paths: { vs: `${monacoPath}/vs` } });
}
