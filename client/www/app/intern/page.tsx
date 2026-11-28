import type { Metadata } from 'next';
import Content from './content';

export const metadata: Metadata = {
  title: 'SidekickDB Intern tools',
  description: 'Internal tools and analytics for SidekickDB',
};

export default function Page() {
  return <Content />;
}
