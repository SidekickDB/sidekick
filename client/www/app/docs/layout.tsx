import type { Metadata } from 'next';

// SidekickDB: name the docs in every docs page's tab title.
export const metadata: Metadata = {
  title: { template: '%s - SidekickDB Docs', default: 'SidekickDB Docs' },
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
