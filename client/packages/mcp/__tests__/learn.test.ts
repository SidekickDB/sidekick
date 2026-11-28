import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { findRules, handleLearn, learnDescription } from '../src/learn.ts';

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

  test('finds the package copy from src/, dist/ and dist/esm/', () => {
    const want = fileURLToPath(new URL('../rules/AGENTS.md', import.meta.url));
    for (const p of [
      '../src/learn.ts',
      '../dist/learn.js',
      '../dist/esm/learn.js',
    ])
      expect(findRules(new URL(p, import.meta.url).href)).toBe(want);
  });

  test('never returns a rules file from outside the package', () => {
    const project = mkdtempSync(join(tmpdir(), 'sk-mcp-rules-'));
    try {
      mkdirSync(join(project, 'rules'));
      writeFileSync(join(project, 'rules', 'AGENTS.md'), 'foreign rules\n');
      const pkg = join(project, 'node_modules', '@sidekickdb', 'mcp');
      for (const d of ['dist', join('dist', 'esm')]) {
        const learn = join(pkg, d, 'learn.js');
        expect(() => findRules(pathToFileURL(learn).href)).toThrow(
          `SidekickDB rules file not found at ${join(pkg, 'rules', 'AGENTS.md')}`,
        );
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
