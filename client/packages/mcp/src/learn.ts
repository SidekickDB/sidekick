// SidekickDB: the `learn` tool returns the agent rules that ship with this
// package (rules/AGENTS.md, a copy of client/www/lib/intern/instant-rules.md
// written by client/www/scripts/gen-llm-rules.ts). Nothing is fetched.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The nearest rules/AGENTS.md above the compiled file, so src/, dist/ and the
// dev build's dist/esm/ all find the package's copy.
export function findRules(from: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(from));
  for (;;) {
    const file = join(dir, 'rules', 'AGENTS.md');
    if (existsSync(file)) return file;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('rules/AGENTS.md not found');
    dir = parent;
  }
}

export const learnDescription =
  "If you don't have any context provided about SidekickDB, use this tool to learn about it! " +
  'It returns the SidekickDB rules for agents from the version this server was built from.';

export function handleLearn() {
  const rules = readFileSync(findRules(), 'utf8');
  return {
    content: [
      {
        type: 'text' as const,
        text:
          'These are the SidekickDB rules for agents, from the version this MCP server was built from:\n\n' +
          rules,
      },
    ],
  };
}
