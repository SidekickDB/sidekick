import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { handleLearn, learnDescription } from '../src/learn.ts';

// SidekickDB: learn returns the bundled rules file; nothing is fetched.
describe('learn tool', () => {
  const text = handleLearn().content[0].text;

  test('returns the bundled SidekickDB rules', () => {
    expect(learnDescription).toContain('SidekickDB');
    expect(text).toContain('# About SidekickDB');
    expect(text).toContain('# SidekickDB SDKs');
  });

  test('points at no rules file URL', () => {
    expect(text).not.toMatch(/https?:\/\/\S*(AGENTS\.md|llm-rules)/);
    expect(learnDescription).not.toMatch(/https?:\/\//);
  });

  test('the bundled copy equals the canonical rules file', () => {
    const read = (p: string) =>
      readFileSync(new URL(p, import.meta.url), 'utf8');
    expect(read('../rules/AGENTS.md')).toBe(
      read('../../../www/lib/intern/instant-rules.md'),
    );
  });
});
