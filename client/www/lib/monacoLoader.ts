// SidekickDB: @monaco-editor/react loads Monaco from a CDN unless told
// otherwise. Load it from the dashboard's own copy, which
// scripts/copy-editor-assets.mjs puts in public/monaco.
import { loader } from '@monaco-editor/react';

export const monacoPath = '/monaco';

loader.config({ paths: { vs: `${monacoPath}/vs` } });
