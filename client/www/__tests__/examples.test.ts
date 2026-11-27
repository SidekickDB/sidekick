import fs from 'fs';
import { afterEach, expect, test, vi } from 'vitest';
import { appMetas } from '../lib/examples/data';
import {
  getAllExamples,
  getAllSlugs,
  getExampleAppBySlug,
  isExampleSlug,
} from '../lib/examples/server';

afterEach(() => {
  vi.restoreAllMocks();
});

test('every example file has metadata and every slug has a file', () => {
  expect(getAllSlugs().sort()).toEqual(appMetas.map((app) => app.slug).sort());
  for (const app of getAllExamples()) {
    expect(app.content.length).toBeGreaterThan(0);
  }
});

test('accepts only listed slugs', () => {
  expect(isExampleSlug('todos')).toBe(true);
  expect(isExampleSlug('missing')).toBe(false);
  expect(isExampleSlug('a/b')).toBe(false);
  expect(isExampleSlug('')).toBe(false);
});

test('reads a file only for a listed slug', () => {
  const read = vi.spyOn(fs, 'readFileSync');
  expect(() => getExampleAppBySlug('missing')).toThrow();
  expect(() => getExampleAppBySlug('a/b')).toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(getExampleAppBySlug('todos').slug).toBe('todos');
  expect(read).toHaveBeenCalledTimes(1);
});
