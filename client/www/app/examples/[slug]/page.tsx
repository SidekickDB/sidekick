import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getAllSlugs,
  getExampleAppBySlug,
  isExampleSlug,
} from '@/lib/examples/server';
import Content from './content';

// SidekickDB: only the slugs from generateStaticParams are served.
export const dynamicParams = false;

export async function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isExampleSlug(slug)) notFound();
  const app = getExampleAppBySlug(slug);
  return {
    title: `${app.title} | InstantDB Examples`,
    description: 'Learn Instant through example apps',
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isExampleSlug(slug)) notFound();
  const app = getExampleAppBySlug(slug);
  return <Content app={app} />;
}
