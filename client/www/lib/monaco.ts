import { Monaco } from '@monaco-editor/react';
import { monacoPath } from './monacoLoader';

export async function addInstantLibs(monaco: Monaco) {
  const files = [
    'index.d.ts',
    'schema.d.ts',
    'queryTypes.d.ts',
    'schemaTypes.d.ts',
    'presence.d.ts',
    'instatx.d.ts',
  ];

  // SidekickDB: the dashboard serves the type declarations of the
  // @sidekickdb/core it was built with (scripts/copy-editor-assets.mjs), so
  // nothing is loaded from a CDN.
  const fetched = await Promise.all(
    files.map(async (file) => {
      try {
        const r = await fetch(`${monacoPath}/types/${file}`);
        // Skip files that fail to load instead of registering an error page
        // as type declarations.
        if (!r.ok) return null;
        return { file, content: await r.text() };
      } catch {
        return null;
      }
    }),
  );
  const fileContents = fetched.filter(
    (f): f is { file: string; content: string } => f !== null,
  );

  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs, // Node-style lookup
    baseUrl: 'file:///', // virtual project root
    ...monaco.languages.typescript.typescriptDefaults.getCompilerOptions(),

    paths: {
      '@sidekickdb/core': ['file:///node_modules/@sidekickdb/core/index.d.ts'],
      '@sidekickdb/admin': [
        'file:///node_modules/@sidekickdb/admin/index.d.ts',
      ],
      '@sidekickdb/react': [
        'file:///node_modules/@sidekickdb/react/index.d.ts',
      ],
      '@sidekickdb/react-native': [
        'file:///node_modules/@sidekickdb/react-native/index.d.ts',
      ],
    },
  });

  for (const { file, content } of fileContents) {
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      content,
      `file:///node_modules/@sidekickdb/core/${file}`,
    );
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      content,
      `file:///node_modules/@sidekickdb/admin/${file}`,
    );
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      content,
      `file:///node_modules/@sidekickdb/react/${file}`,
    );
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      content,
      `file:///node_modules/@sidekickdb/react-native/${file}`,
    );
  }
}
