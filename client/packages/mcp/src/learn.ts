// SidekickDB: the `learn` tool returns the agent rules that ship with this
// package (rules/AGENTS.md, a copy of client/www/lib/intern/instant-rules.md
// written by client/www/scripts/gen-llm-rules.ts). Nothing is fetched.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The package's own rules/AGENTS.md: one level above src/ and dist/, two
// above the dev build's dist/esm/. Never looks outside the package.
export function findRules(from: string = import.meta.url): string {
  const dir = dirname(fileURLToPath(from));
  const root =
    basename(dir) === 'esm' ? join(dir, '..', '..') : join(dir, '..');
  const file = join(root, 'rules', 'AGENTS.md');
  if (!existsSync(file)) {
    throw new Error(
      `SidekickDB rules file not found at ${file}; rebuild the MCP package from a checkout.`,
    );
  }
  return file;
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
