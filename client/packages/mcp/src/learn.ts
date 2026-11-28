// SidekickDB: the `learn` tool returns the agent rules that ship with this
// package (rules/AGENTS.md, a copy of client/www/lib/intern/instant-rules.md
// written by client/www/scripts/gen-llm-rules.ts). Nothing is fetched.
import { readFileSync } from 'node:fs';

// The same relative path works from src/ (tests) and dist/ (the built server).
const RULES_URL = new URL('../rules/AGENTS.md', import.meta.url);

export const learnDescription =
  "If you don't have any context provided about SidekickDB, use this tool to learn about it! " +
  'It returns the SidekickDB rules for agents from the version this server was built from.';

export function handleLearn() {
  const rules = readFileSync(RULES_URL, 'utf8');
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
