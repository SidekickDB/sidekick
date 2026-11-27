'use client';

// SidekickDB: self-hosted, the admin tools show a link back to the dashboard
// instead of the Instant website's navigation and footer.
import Link from 'next/link';
import { LegacyNav } from '@/components/marketingUi';
import { Footer } from '@/components/new-landing/Footer';
import { isSelfHosted } from '@/lib/config';

export function InternNav() {
  if (!isSelfHosted) return <LegacyNav />;
  return (
    <div className="landing-width mx-auto py-4">
      <Link href="/dash" className="text-sm text-gray-500 hover:text-gray-900">
        Back to dashboard
      </Link>
    </div>
  );
}

export function InternFooter() {
  return isSelfHosted ? null : <Footer />;
}
