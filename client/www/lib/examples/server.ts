import fs from 'fs';
import { appMetas, AppMetadata } from './data';

// Content is written in markdown files and additional metadata is stored in
// in a ts file for more expressive fields (longer descriptions, tags, etc).
export interface ExampleApp extends AppMetadata {
  content: string;
}

// SidekickDB: a slug is one listed in appMetas.
export function isExampleSlug(slug: string): boolean {
  return appMetas.some((app) => app.slug === slug);
}

export function getExampleAppBySlug(slug: string): ExampleApp {
  // SidekickDB: look the slug up before reading its file.
  const meta = appMetas.find((app) => app.slug === slug);
  if (!meta) {
    throw new Error(
      `This should not happen. App with slug "${slug}" not found.`,
    );
  }
  const content = fs.readFileSync(`./_examples/${slug}.md`, 'utf-8');
  return { ...meta, content };
}

function removeMdExtension(str: string): string {
  return str.replace(/\.md$/, '');
}

export function getAllSlugs(): string[] {
  const dir = fs.readdirSync('./_examples');
  return dir.map((mdName) => removeMdExtension(mdName));
}

export function getAllExamples(): ExampleApp[] {
  return getAllSlugs().map((slug) => getExampleAppBySlug(slug));
}
